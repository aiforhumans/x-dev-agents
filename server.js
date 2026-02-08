const express = require("express");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { PORT, DEFAULT_BASE_URL } = require("./src/server/config/env");
const {
  PUBLIC_DIR,
  AGENTS_FILE,
  AGENT_GROUPS_FILE,
  CONFIG_FILE,
  PIPELINES_FILE,
  RUNS_FILE,
  RUN_PROFILES_FILE
} = require("./src/server/config/paths");
const {
  DEFAULT_SYSTEM_PROMPT,
  HISTORY_LIMIT,
  RUNS_LIMIT,
  WEB_SEARCH_MAX_RESULTS,
  WEB_SEARCH_TIMEOUT_MS,
  CANONICAL_PIPELINE_STAGES,
  CANONICAL_STAGE_IDS,
  RUN_STATUS_VALUES,
  RUN_STREAM_HEARTBEAT_MS
} = require("./src/server/config/constants");
const logger = require("./src/server/utils/logger");
const runtimeState = require("./src/server/state/runtimeState");
const { createLmStudioClient, parseJsonResponse } = require("./src/server/services/lmstudioClient");
const { parseSseBlock } = require("./src/server/services/lmstudioStreamParser");
const { openSse, sendEvent, closeSse } = require("./src/server/sse/sseHelpers");
const { createOrchestrator } = require("./src/server/services/orchestrator/orchestrator");
const { registerApiRoutes } = require("./src/server/routes");
const { createErrorHandler } = require("./src/server/middleware/errorHandler");
const {
  createRequestIdMiddleware,
  createRequestLoggingMiddleware
} = require("./src/server/middleware/requestContext");
const {
  ensureConfigFile: ensureConfigFileInStore,
  loadConfig: loadConfigFromStore,
  saveConfig: saveConfigToStore
} = require("./src/server/storage/configRepo");
const {
  ensureAgentsFile,
  loadAgents: loadAgentsFromStore,
  saveAgents: saveAgentsToStore
} = require("./src/server/storage/agentsRepo");
const {
  ensureAgentGroupsFile,
  loadAgentGroups: loadAgentGroupsFromStore,
  saveAgentGroups: saveAgentGroupsToStore
} = require("./src/server/storage/agentGroupsRepo");
const {
  ensurePipelinesFile,
  loadPipelines: loadPipelinesFromStore,
  savePipelines: savePipelinesToStore
} = require("./src/server/storage/pipelinesRepo");
const {
  ensureRunsFile,
  loadRuns: loadRunsFromStore,
  saveRuns: saveRunsToStore
} = require("./src/server/storage/runsRepo");
const {
  ensureRunProfilesFile,
  loadRunProfiles: loadRunProfilesFromStore,
  saveRunProfiles: saveRunProfilesToStore
} = require("./src/server/storage/runProfilesRepo");

const app = express();
let agents = runtimeState.agents;
let agentGroups = runtimeState.agentGroups;
let pipelines = runtimeState.pipelines;
let runs = runtimeState.runs;
let runProfiles = runtimeState.runProfiles;
let config = runtimeState.config;
const runStreamSubscribers = runtimeState.runStreamSubscribers;
const activePipelineRuns = runtimeState.activePipelineRuns;

app.use(express.json({ limit: "20mb" }));
app.use(createRequestIdMiddleware());
app.use(createRequestLoggingMiddleware({ logger }));
app.use(express.static(PUBLIC_DIR));

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("LM Studio base URL is required.");
  }
  return trimmed;
}

function getOpenAIBaseUrl() {
  const base = normalizeBaseUrl(config.baseUrl);
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function getNativeApiBaseUrl() {
  const base = normalizeBaseUrl(config.baseUrl);
  if (base.endsWith("/api/v1")) {
    return base;
  }
  if (base.endsWith("/v1")) {
    return `${base.slice(0, -3)}/api/v1`;
  }
  return `${base}/api/v1`;
}

function toNumber(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toInteger(value, fallback) {
  const num = toNumber(value, fallback);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function optionalNumber(raw, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  const num = integer ? toInteger(raw, NaN) : toNumber(raw, NaN);
  if (!Number.isFinite(num)) {
    return null;
  }
  if (num < min || num > max) {
    return null;
  }
  return num;
}

function sanitizeReasoning(raw) {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  const normalized = String(raw).trim().toLowerCase();
  const allowed = new Set(["off", "low", "medium", "high"]);
  return allowed.has(normalized) ? normalized : null;
}

function sanitizeHeaders(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const entries = Object.entries(raw)
    .filter(([key]) => Boolean(String(key || "").trim()))
    .map(([key, value]) => [String(key).trim(), String(value ?? "")]);
  if (!entries.length) {
    return null;
  }
  return Object.fromEntries(entries);
}

function sanitizeAllowedTools(raw) {
  if (!Array.isArray(raw)) {
    return null;
  }
  const tools = raw.map((value) => String(value || "").trim()).filter(Boolean);
  return tools.length ? tools : null;
}

function sanitizeIntegrations(raw, strict = true) {
  let parsed = raw;

  if (typeof parsed === "string") {
    const text = parsed.trim();
    if (!text) {
      return [];
    }
    try {
      parsed = JSON.parse(text);
    } catch {
      if (!strict) {
        return text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
      }
      const err = new Error("Integrations must be valid JSON or an array.");
      err.status = 400;
      throw err;
    }
  }

  if (parsed === null || parsed === undefined || parsed === "") {
    return [];
  }
  if (!Array.isArray(parsed)) {
    if (!strict) {
      return [];
    }
    const err = new Error("Integrations must be an array.");
    err.status = 400;
    throw err;
  }

  const normalized = [];
  for (const integration of parsed) {
    if (typeof integration === "string") {
      const id = integration.trim();
      if (id) {
        normalized.push(id);
      }
      continue;
    }

    if (!integration || typeof integration !== "object") {
      continue;
    }

    const type = String(integration.type || (integration.id ? "plugin" : "")).trim().toLowerCase();
    if (type === "plugin") {
      const id = String(integration.id || "").trim();
      if (!id) {
        if (strict) {
          const err = new Error("Integration plugin entries require an id.");
          err.status = 400;
          throw err;
        }
        continue;
      }
      const plugin = { type: "plugin", id };
      const allowedTools = sanitizeAllowedTools(integration.allowed_tools || integration.allowedTools);
      if (allowedTools) {
        plugin.allowed_tools = allowedTools;
      }
      normalized.push(plugin);
      continue;
    }

    if (type === "ephemeral_mcp") {
      const serverLabel = String(integration.server_label || integration.serverLabel || "").trim();
      const serverUrl = String(integration.server_url || integration.serverUrl || "").trim();
      if (!serverLabel || !serverUrl) {
        if (strict) {
          const err = new Error("ephemeral_mcp integrations require server_label and server_url.");
          err.status = 400;
          throw err;
        }
        continue;
      }
      const mcp = {
        type: "ephemeral_mcp",
        server_label: serverLabel,
        server_url: serverUrl
      };
      const headers = sanitizeHeaders(integration.headers);
      if (headers) {
        mcp.headers = headers;
      }
      const allowedTools = sanitizeAllowedTools(integration.allowed_tools || integration.allowedTools);
      if (allowedTools) {
        mcp.allowed_tools = allowedTools;
      }
      normalized.push(mcp);
      continue;
    }

    if (strict) {
      const err = new Error(`Unsupported integration type: ${type || "unknown"}.`);
      err.status = 400;
      throw err;
    }
  }

  return normalized;
}

function sanitizeStats(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const fields = [
    "tokens_per_second",
    "time_to_first_token_seconds",
    "generation_time_seconds",
    "stop_reason",
    "input_tokens",
    "cached_input_tokens",
    "total_output_tokens",
    "reasoning_output_tokens",
    "model_load_time_seconds"
  ];

  const output = {};
  for (const field of fields) {
    if (raw[field] === null || raw[field] === undefined) {
      continue;
    }
    output[field] = raw[field];
  }

  return Object.keys(output).length ? output : null;
}

function sanitizeHistoryItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const role = String(item.role || "").trim() || "assistant";
  const normalized = {
    role,
    content: String(item.content || "")
  };

  if (item.tool !== undefined) {
    normalized.tool = item.tool;
  }
  if (item.arguments !== undefined) {
    normalized.arguments = item.arguments;
  }
  if (item.output !== undefined) {
    normalized.output = item.output;
  }
  if (item.providerInfo !== undefined) {
    normalized.providerInfo = item.providerInfo;
  }
  if (item.provider_info !== undefined) {
    normalized.providerInfo = item.provider_info;
  }
  if (item.metadata !== undefined) {
    normalized.metadata = item.metadata;
  }
  if (item.responseId) {
    normalized.responseId = String(item.responseId);
  }

  const stats = sanitizeStats(item.stats);
  if (stats) {
    normalized.stats = stats;
  }

  return normalized;
}

function sanitizeChatHistory(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map(sanitizeHistoryItem).filter(Boolean).slice(-HISTORY_LIMIT);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeTrimmedString(raw, { maxLength = 4000, allowEmpty = false } = {}) {
  const text = String(raw ?? "").trim();
  if (!text) {
    return allowEmpty ? "" : null;
  }
  return text.slice(0, maxLength);
}

function sanitizeStringArray(raw, { maxItems = 200, maxLength = 500 } = {}) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const output = [];
  const seen = new Set();
  for (const item of raw) {
    const text = sanitizeTrimmedString(item, { maxLength });
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    output.push(text);
    if (output.length >= maxItems) {
      break;
    }
  }
  return output;
}

function roleKeyFromText(text, fallback = "stage") {
  const normalized = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function buildCanonicalPipelineStages(rawPresentationStages) {
  const overridesById = new Map();
  if (Array.isArray(rawPresentationStages)) {
    for (const item of rawPresentationStages) {
      if (!item) {
        continue;
      }
      const source = isPlainObject(item) ? item : { stageId: item, name: item };
      const stageId = roleKeyFromText(source.stageId || source.id || source.role || source.name);
      if (!CANONICAL_STAGE_IDS.has(stageId)) {
        continue;
      }
      const name = sanitizeTrimmedString(source.name || source.label, { maxLength: 140 });
      const enabled = source.enabled === undefined ? undefined : toBoolean(source.enabled, true);
      const description = sanitizeTrimmedString(source.description, { maxLength: 1600 });
      overridesById.set(stageId, { name, enabled, description });
    }
  }

  return CANONICAL_PIPELINE_STAGES.map((stage, index) => {
    const override = overridesById.get(stage.stageId) || {};
    const output = {
      stageId: stage.stageId,
      role: stage.role,
      name: override.name || stage.name,
      order: index + 1,
      enabled: override.enabled === undefined ? true : override.enabled,
      defaultArtifactNames: [...stage.defaultArtifactNames]
    };

    if (override.description) {
      output.description = override.description;
    }

    return output;
  });
}

function sanitizeToolsPolicyEntry(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }

  const entry = {};
  if (raw.allowWebSearch !== undefined || raw.allow_web_search !== undefined) {
    entry.allowWebSearch = toBoolean(raw.allowWebSearch ?? raw.allow_web_search, false);
  }

  const allowedTools = sanitizeStringArray(raw.allowedTools ?? raw.allowed_tools, {
    maxItems: 200,
    maxLength: 200
  });
  if (allowedTools.length) {
    entry.allowedTools = allowedTools;
  }

  const allowedIntegrations = sanitizeStringArray(raw.allowedIntegrations ?? raw.allowed_integrations, {
    maxItems: 200,
    maxLength: 320
  });
  if (allowedIntegrations.length) {
    entry.allowedIntegrations = allowedIntegrations;
  }

  return Object.keys(entry).length ? entry : null;
}

function sanitizeToolsPolicy(raw) {
  if (!isPlainObject(raw)) {
    return {
      default: {},
      byStage: {}
    };
  }

  const policy = {
    default: sanitizeToolsPolicyEntry(raw.default) || {},
    byStage: {}
  };

  if (isPlainObject(raw.byStage)) {
    for (const [stageIdRaw, value] of Object.entries(raw.byStage)) {
      const stageId = roleKeyFromText(stageIdRaw);
      if (!stageId || !CANONICAL_STAGE_IDS.has(stageId)) {
        continue;
      }
      const entry = sanitizeToolsPolicyEntry(value);
      if (entry) {
        policy.byStage[stageId] = entry;
      }
    }
  }

  return policy;
}

function sanitizePipelineOutputs(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  const outputs = [];
  for (const output of raw) {
    if (typeof output === "string") {
      const type = sanitizeTrimmedString(output, { maxLength: 120 });
      if (!type) {
        continue;
      }
      outputs.push({
        outputId: randomUUID(),
        type,
        enabled: true
      });
      continue;
    }

    if (!isPlainObject(output)) {
      continue;
    }

    const type = sanitizeTrimmedString(output.type || output.kind || output.name, { maxLength: 120 });
    if (!type) {
      continue;
    }

    const outputModel = {
      outputId: sanitizeTrimmedString(output.outputId || output.id, { maxLength: 120 }) || randomUUID(),
      type,
      enabled: toBoolean(output.enabled, true)
    };

    const platform = sanitizeTrimmedString(output.platform, { maxLength: 80 });
    if (platform) {
      outputModel.platform = platform;
    }

    const format = sanitizeTrimmedString(output.format, { maxLength: 80 });
    if (format) {
      outputModel.format = format;
    }

    const description = sanitizeTrimmedString(output.description, { maxLength: 1000 });
    if (description) {
      outputModel.description = description;
    }

    if (isPlainObject(output.options)) {
      outputModel.options = output.options;
    }

    outputs.push(outputModel);
  }

  return outputs.slice(0, 200);
}

function sanitizeAgentsByRole(raw, { strict = true } = {}) {
  if (!isPlainObject(raw)) {
    if (strict) {
      throw buildRequestError(400, "agentsByRole is required.");
    }
    return Object.create(null);
  }

  const mapping = Object.create(null);
  for (const [roleRaw, agentIdRaw] of Object.entries(raw)) {
    const role = roleKeyFromText(roleRaw);
    const agentId = sanitizeTrimmedString(agentIdRaw, { maxLength: 120 });
    if (!role || !agentId || !CANONICAL_STAGE_IDS.has(role)) {
      continue;
    }

    if (strict && !findAgent(agentId)) {
      throw buildRequestError(400, `agentsByRole references unknown agent id: ${agentId}`);
    }

    mapping[role] = agentId;
  }

  if (strict) {
    for (const stage of CANONICAL_PIPELINE_STAGES) {
      if (!mapping[stage.role]) {
        throw buildRequestError(400, `agentsByRole.${stage.role} is required.`);
      }
    }
  }

  return mapping;
}

function sanitizePipeline(raw, { strict = true } = {}) {
  const name = sanitizeTrimmedString(raw?.name, { maxLength: 140 });
  if (strict && !name) {
    throw buildRequestError(400, "Pipeline name is required.");
  }

  const stages = buildCanonicalPipelineStages(raw?.stages);
  const pipeline = {
    name: name || "Untitled Pipeline",
    description: sanitizeTrimmedString(raw?.description, { maxLength: 2000, allowEmpty: true }) || "",
    stages,
    agentsByRole: sanitizeAgentsByRole(raw?.agentsByRole ?? raw?.agents_by_role, { strict }),
    toolsPolicy: sanitizeToolsPolicy(raw?.toolsPolicy ?? raw?.tools_policy),
    outputs: sanitizePipelineOutputs(raw?.outputs)
  };

  return pipeline;
}

function hydratePipeline(raw) {
  const now = new Date().toISOString();
  const normalized = sanitizePipeline(raw, { strict: false });
  const id = sanitizeTrimmedString(raw?.id, { maxLength: 120 }) || randomUUID();
  const createdAt = sanitizeTrimmedString(raw?.createdAt, { maxLength: 60 }) || now;
  const updatedAt = sanitizeTrimmedString(raw?.updatedAt, { maxLength: 60 }) || createdAt;

  return {
    id,
    ...normalized,
    createdAt,
    updatedAt
  };
}

function sanitizeEnabledStages(raw, { strict = true } = {}) {
  if (raw === undefined || raw === null) {
    return CANONICAL_PIPELINE_STAGES.map((stage) => stage.stageId);
  }
  if (!Array.isArray(raw)) {
    if (strict) {
      throw buildRequestError(400, "execution.enabledStages must be an array.");
    }
    return CANONICAL_PIPELINE_STAGES.map((stage) => stage.stageId);
  }

  const seen = new Set();
  const list = [];
  for (const value of raw) {
    const stageId = roleKeyFromText(value);
    if (!stageId || !CANONICAL_STAGE_IDS.has(stageId) || seen.has(stageId)) {
      continue;
    }
    seen.add(stageId);
    list.push(stageId);
  }

  if (!list.length && strict) {
    throw buildRequestError(400, "execution.enabledStages must include at least one canonical stage.");
  }
  return list.length ? list : CANONICAL_PIPELINE_STAGES.map((stage) => stage.stageId);
}

function sanitizeAgentGroupDefaults(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }

  const defaults = {};
  if (raw.toolsPolicy !== undefined || raw.tools_policy !== undefined) {
    defaults.toolsPolicy = sanitizeToolsPolicy(raw.toolsPolicy ?? raw.tools_policy);
  }
  if (raw.outputs !== undefined) {
    defaults.outputs = sanitizePipelineOutputs(raw.outputs);
  }
  if (raw.targetPlatforms !== undefined) {
    defaults.targetPlatforms = sanitizeStringArray(raw.targetPlatforms, { maxItems: 40, maxLength: 140 });
  }
  if (raw.brandVoice !== undefined) {
    defaults.brandVoice = sanitizeTrimmedString(raw.brandVoice, { maxLength: 4000, allowEmpty: true }) || "";
  }

  return Object.keys(defaults).length ? defaults : null;
}

function sanitizeAgentGroup(raw, { strict = true } = {}) {
  const name = sanitizeTrimmedString(raw?.name, { maxLength: 140 });
  if (strict && !name) {
    throw buildRequestError(400, "Agent group name is required.");
  }

  const execution = isPlainObject(raw?.execution) ? raw.execution : {};
  const mode = sanitizeTrimmedString(execution.mode, { maxLength: 40 }) || "sequential";
  if (mode !== "sequential") {
    throw buildRequestError(400, "Agent group execution.mode must be sequential.");
  }

  const roles = sanitizeAgentsByRole(raw?.roles ?? raw?.agentsByRole, { strict });
  const enabledStages = sanitizeEnabledStages(execution.enabledStages ?? execution.enabled_stages, { strict: false });

  return {
    name: name || "Untitled Agent Group",
    description: sanitizeTrimmedString(raw?.description, { maxLength: 2000, allowEmpty: true }) || "",
    roles,
    execution: {
      mode: "sequential",
      enabledStages
    },
    defaults: sanitizeAgentGroupDefaults(raw?.defaults)
  };
}

function hydrateAgentGroup(raw) {
  const now = new Date().toISOString();
  const normalized = sanitizeAgentGroup(raw, { strict: false });
  const groupId =
    sanitizeTrimmedString(raw?.groupId ?? raw?.id, { maxLength: 120 }) ||
    sanitizeTrimmedString(raw?.group_id, { maxLength: 120 }) ||
    randomUUID();
  const createdAt = sanitizeTrimmedString(raw?.createdAt, { maxLength: 60 }) || now;
  const updatedAt = sanitizeTrimmedString(raw?.updatedAt, { maxLength: 60 }) || createdAt;

  return {
    groupId,
    ...normalized,
    createdAt,
    updatedAt
  };
}

function buildInitialStageStateFromAgentGroup(group) {
  const enabled = new Set(group?.execution?.enabledStages || []);
  const syntheticPipeline = {
    stages: CANONICAL_PIPELINE_STAGES.map((stage, index) => ({
      stageId: stage.stageId,
      role: stage.role,
      name: stage.name,
      order: index + 1,
      enabled: enabled.size ? enabled.has(stage.stageId) : true
    }))
  };
  const stageState = buildInitialStageState(syntheticPipeline);
  for (const stage of CANONICAL_PIPELINE_STAGES) {
    stageState[stage.stageId].agentId = sanitizeTrimmedString(group?.roles?.[stage.role], { maxLength: 120 }) || null;
  }
  return stageState;
}

function mergeAgentGroupRunDefaults(group, runBody) {
  const defaults = isPlainObject(group?.defaults) ? group.defaults : {};
  const payload = isPlainObject(runBody) ? { ...runBody } : {};

  if (payload.toolsPolicy === undefined && payload.tools_policy === undefined && defaults.toolsPolicy !== undefined) {
    payload.toolsPolicy = defaults.toolsPolicy;
  }
  if (payload.outputs === undefined && defaults.outputs !== undefined) {
    payload.outputs = defaults.outputs;
  }
  if (payload.targetPlatforms === undefined && defaults.targetPlatforms !== undefined) {
    payload.targetPlatforms = defaults.targetPlatforms;
  }
  if (payload.brandVoice === undefined && defaults.brandVoice !== undefined) {
    payload.brandVoice = defaults.brandVoice;
  }

  return payload;
}

function sanitizeRunProfileMode(raw, { strict = true } = {}) {
  const mode = sanitizeTrimmedString(raw, { maxLength: 80 })?.toLowerCase();
  if (!mode) {
    return "inherit_defaults";
  }
  if (!new Set(["inherit_defaults", "override_per_role", "override_per_stage"]).has(mode)) {
    if (strict) {
      throw buildRequestError(400, `Unsupported run profile mode: ${mode}`);
    }
    return "inherit_defaults";
  }
  return mode;
}

function sanitizeRunProfileRoles(raw, { strict = true } = {}) {
  if (!isPlainObject(raw)) {
    if (strict) {
      return {};
    }
    return {};
  }

  const roles = {};
  for (const stage of CANONICAL_PIPELINE_STAGES) {
    const role = stage.role;
    if (!isPlainObject(raw[role])) {
      continue;
    }
    const source = raw[role];
    const entry = {};
    const agentId = sanitizeTrimmedString(source.agentId, { maxLength: 120 });
    if (agentId) {
      entry.agentId = agentId;
    }
    const modelOverride = sanitizeTrimmedString(source.modelOverride, { maxLength: 160 });
    if (modelOverride) {
      entry.modelOverride = modelOverride;
    }
    const promptAddendum = sanitizeTrimmedString(source.promptAddendum, { maxLength: 12000, allowEmpty: true });
    if (promptAddendum) {
      entry.promptAddendum = promptAddendum;
    }
    if (source.sampling !== undefined) {
      entry.sampling = source.sampling;
    }
    if (source.outputSchema !== undefined) {
      entry.outputSchema = source.outputSchema;
    }
    if (source.toolsPolicy !== undefined) {
      entry.toolsPolicy = sanitizeToolsPolicy(source.toolsPolicy);
    }
    if (source.memoryPolicy !== undefined) {
      entry.memoryPolicy = source.memoryPolicy;
    }
    if (Object.keys(entry).length) {
      roles[role] = entry;
    }
  }

  return roles;
}

function sanitizeRunProfileStages(raw, { strict = true } = {}) {
  if (raw === undefined || raw === null) {
    return CANONICAL_PIPELINE_STAGES.map((stage, index) => ({
      stageId: stage.stageId,
      name: stage.name,
      role: stage.role,
      enabled: true,
      order: index + 1,
      inputs: ["topic", "prior_artifacts", "evidence"],
      outputs: [...stage.defaultArtifactNames],
      toolsPolicy: null,
      retryPolicy: null
    }));
  }
  if (!Array.isArray(raw)) {
    if (strict) {
      throw buildRequestError(400, "Run profile stages must be an array.");
    }
    return sanitizeRunProfileStages(undefined, { strict: false });
  }
  const byId = new Map();
  for (const item of raw) {
    if (!isPlainObject(item)) {
      continue;
    }
    const stageId = roleKeyFromText(item.stageId ?? item.id);
    if (!stageId || !CANONICAL_STAGE_IDS.has(stageId)) {
      continue;
    }
    const canonical = CANONICAL_PIPELINE_STAGES.find((entry) => entry.stageId === stageId);
    byId.set(stageId, {
      stageId,
      name: sanitizeTrimmedString(item.name, { maxLength: 140 }) || canonical?.name || stageId,
      role: roleKeyFromText(item.role) || canonical?.role || stageId,
      enabled: toBoolean(item.enabled, true),
      order: optionalNumber(item.order, { min: 1, integer: true }) || canonical?.order || byId.size + 1,
      inputs: sanitizeStringArray(item.inputs, { maxItems: 40, maxLength: 120 }),
      outputs: sanitizeStringArray(item.outputs, { maxItems: 40, maxLength: 120 }),
      toolsPolicy: isPlainObject(item.toolsPolicy) ? sanitizeToolsPolicy(item.toolsPolicy) : null,
      retryPolicy: isPlainObject(item.retryPolicy) ? item.retryPolicy : null
    });
  }

  return CANONICAL_PIPELINE_STAGES.map((stage, index) => {
    const existing = byId.get(stage.stageId);
    if (existing) {
      return existing;
    }
    return {
      stageId: stage.stageId,
      name: stage.name,
      role: stage.role,
      enabled: true,
      order: index + 1,
      inputs: ["topic", "prior_artifacts", "evidence"],
      outputs: [...stage.defaultArtifactNames],
      toolsPolicy: null,
      retryPolicy: null
    };
  });
}

function sanitizeRunProfile(raw, { strict = true } = {}) {
  if (!isPlainObject(raw)) {
    throw buildRequestError(400, "Run profile payload must be an object.");
  }

  const name = sanitizeTrimmedString(raw.name, { maxLength: 180 });
  if (strict && !name) {
    throw buildRequestError(400, "Run profile name is required.");
  }

  const scopeType = sanitizeTrimmedString(raw.scopeType, { maxLength: 40 })?.toLowerCase();
  if (strict && !new Set(["group", "pipeline"]).has(scopeType)) {
    throw buildRequestError(400, "Run profile scopeType must be group or pipeline.");
  }

  const scopeId = sanitizeTrimmedString(raw.scopeId, { maxLength: 120 });
  if (strict && !scopeId) {
    throw buildRequestError(400, "Run profile scopeId is required.");
  }

  return {
    name: name || "Untitled Profile",
    version: optionalNumber(raw.version, { min: 1, integer: true }) || 1,
    scopeType: scopeType || "group",
    scopeId: scopeId || "",
    mode: sanitizeRunProfileMode(raw.mode, { strict }),
    roles: sanitizeRunProfileRoles(raw.roles, { strict }),
    stages: sanitizeRunProfileStages(raw.stages, { strict }),
    outputPolicy: isPlainObject(raw.outputPolicy) ? raw.outputPolicy : {},
    runSafety: isPlainObject(raw.runSafety) ? raw.runSafety : {}
  };
}

function hydrateRunProfile(raw) {
  const now = new Date().toISOString();
  const sanitized = sanitizeRunProfile(raw || {}, { strict: false });
  return {
    profileId: sanitizeTrimmedString(raw?.profileId ?? raw?.id, { maxLength: 120 }) || randomUUID(),
    ...sanitized,
    createdAt: sanitizeTrimmedString(raw?.createdAt, { maxLength: 60 }) || now,
    updatedAt: sanitizeTrimmedString(raw?.updatedAt, { maxLength: 60 }) || now
  };
}

function runProfileToClient(profile) {
  return {
    profileId: profile.profileId,
    name: profile.name,
    version: profile.version,
    scopeType: profile.scopeType,
    scopeId: profile.scopeId,
    mode: profile.mode,
    roles: profile.roles,
    stages: profile.stages,
    outputPolicy: profile.outputPolicy,
    runSafety: profile.runSafety,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
}

function findRunProfile(profileId) {
  return runProfiles.find((profile) => profile.profileId === profileId) || null;
}

function sanitizeRunControl(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const status = sanitizeTrimmedString(source.status, { maxLength: 40 })?.toLowerCase() || "queued";
  const allowed = new Set(["queued", "running", "paused", "cancelling", "cancelled", "completed", "failed"]);
  return {
    status: allowed.has(status) ? status : "queued",
    resumeFromStageId: sanitizeTrimmedString(source.resumeFromStageId, { maxLength: 80, allowEmpty: true }) || null,
    cancelRequestedAt: sanitizeTrimmedString(source.cancelRequestedAt, { maxLength: 80, allowEmpty: true }) || null
  };
}

function sanitizeTimelineMeta(raw) {
  if (!isPlainObject(raw)) {
    return { perStage: {} };
  }
  return {
    perStage: isPlainObject(raw.perStage) ? raw.perStage : {}
  };
}

function resolveProfileSnapshot({ runType, sourceId, profileId, profileOverrides, freezeSettings, fallback }) {
  const selectedProfile = profileId ? findRunProfile(profileId) : null;
  const base = isPlainObject(selectedProfile)
    ? {
        profileId: selectedProfile.profileId,
        name: selectedProfile.name,
        version: selectedProfile.version,
        mode: selectedProfile.mode,
        roles: selectedProfile.roles,
        stages: selectedProfile.stages,
        outputPolicy: selectedProfile.outputPolicy,
        runSafety: selectedProfile.runSafety
      }
    : {
        profileId: null,
        name: "Ad-hoc",
        version: 1,
        mode: "inherit_defaults",
        roles: {},
        stages: sanitizeRunProfileStages(undefined, { strict: false }),
        outputPolicy: {},
        runSafety: {}
      };

  const overrides = isPlainObject(profileOverrides) ? profileOverrides : {};
  const merged = {
    ...base,
    ...overrides,
    roles: isPlainObject(overrides.roles) ? overrides.roles : base.roles,
    stages: Array.isArray(overrides.stages) ? sanitizeRunProfileStages(overrides.stages, { strict: false }) : base.stages,
    outputPolicy: isPlainObject(overrides.outputPolicy) ? overrides.outputPolicy : base.outputPolicy,
    runSafety: isPlainObject(overrides.runSafety) ? overrides.runSafety : base.runSafety,
    scopeType: runType,
    scopeId: sourceId,
    freezeSettings: freezeSettings !== false
  };

  return merged || fallback || null;
}

function sanitizeRunStatus(raw, fallback = "queued", { strict = true } = {}) {
  const status = sanitizeTrimmedString(raw, { maxLength: 40 })?.toLowerCase();
  if (!status) {
    return fallback;
  }
  if (!RUN_STATUS_VALUES.has(status)) {
    if (!strict) {
      return fallback;
    }
    throw buildRequestError(400, `Unsupported run status: ${status}`);
  }
  return status;
}

function buildInitialStageState(pipeline) {
  const byId = new Map((pipeline?.stages || []).map((stage) => [stage.stageId, stage]));
  const state = Object.create(null);

  for (const canonicalStage of CANONICAL_PIPELINE_STAGES) {
    const stage = byId.get(canonicalStage.stageId) || canonicalStage;
    state[canonicalStage.stageId] = {
      stageId: canonicalStage.stageId,
      name: stage.name || canonicalStage.name,
      role: canonicalStage.role,
      order: stage.order || canonicalStage.order || CANONICAL_PIPELINE_STAGES.indexOf(canonicalStage) + 1,
      enabled: stage.enabled !== false,
      status: "pending",
      startedAt: null,
      completedAt: null,
      error: null,
      agentId: null,
      artifacts: [],
      stats: null
    };
  }

  return state;
}

function sanitizeStageState(raw, pipeline) {
  const defaults = buildInitialStageState(pipeline);
  if (!isPlainObject(raw)) {
    return defaults;
  }

  for (const canonicalStage of CANONICAL_PIPELINE_STAGES) {
    const key = canonicalStage.stageId;
    const current = defaults[key];
    const source = raw[key];
    if (!isPlainObject(source)) {
      continue;
    }

    current.status = sanitizeRunStatus(source.status, "pending", { strict: false });
    current.enabled = source.enabled !== undefined ? toBoolean(source.enabled, current.enabled) : current.enabled;
    current.startedAt = sanitizeTrimmedString(source.startedAt, { maxLength: 80, allowEmpty: true }) || null;
    current.completedAt = sanitizeTrimmedString(source.completedAt, { maxLength: 80, allowEmpty: true }) || null;
    current.error = sanitizeTrimmedString(source.error, { maxLength: 4000, allowEmpty: true }) || null;
    current.agentId = sanitizeTrimmedString(source.agentId, { maxLength: 120, allowEmpty: true }) || null;
    current.artifacts = sanitizeStringArray(source.artifacts, { maxItems: 40, maxLength: 120 });
    current.stats = sanitizeStats(source.stats);
  }

  return defaults;
}

function sanitizeSeedLinks(raw) {
  if (Array.isArray(raw)) {
    return sanitizeStringArray(raw, { maxItems: 80, maxLength: 2000 });
  }
  const text = sanitizeTrimmedString(raw, { maxLength: 4000 });
  if (!text) {
    return [];
  }
  return sanitizeStringArray(text.split(/\r?\n|,/), { maxItems: 80, maxLength: 2000 });
}

function sanitizeRunArtifacts(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const now = new Date().toISOString();
  const artifacts = [];

  for (const item of raw) {
    if (typeof item === "string") {
      const content = sanitizeTrimmedString(item, { maxLength: 10000 });
      if (!content) {
        continue;
      }
      artifacts.push({
        artifactId: randomUUID(),
        type: "note",
        title: content.slice(0, 120),
        content,
        createdAt: now,
        updatedAt: now
      });
      continue;
    }

    if (!isPlainObject(item)) {
      continue;
    }

    const artifact = {
      artifactId: sanitizeTrimmedString(item.artifactId || item.id, { maxLength: 120 }) || randomUUID(),
      type: sanitizeTrimmedString(item.type, { maxLength: 80 }) || "artifact",
      title: sanitizeTrimmedString(item.title, { maxLength: 200 }) || "",
      content: sanitizeTrimmedString(item.content, { maxLength: 200000, allowEmpty: true }) || "",
      createdAt: sanitizeTrimmedString(item.createdAt, { maxLength: 60 }) || now,
      updatedAt: sanitizeTrimmedString(item.updatedAt, { maxLength: 60 }) || now
    };

    const stageId = sanitizeTrimmedString(item.stageId || item.stage, { maxLength: 120 });
    if (stageId) {
      artifact.stageId = roleKeyFromText(stageId, stageId);
    }

    const platform = sanitizeTrimmedString(item.platform, { maxLength: 80 });
    if (platform) {
      artifact.platform = platform;
    }

    const uri = sanitizeTrimmedString(item.uri || item.path || item.url, { maxLength: 4000 });
    if (uri) {
      artifact.uri = uri;
    }

    const mimeType = sanitizeTrimmedString(item.mimeType || item.mime_type, { maxLength: 120 });
    if (mimeType) {
      artifact.mimeType = mimeType;
    }

    if (isPlainObject(item.metadata)) {
      artifact.metadata = item.metadata;
    }

    artifacts.push(artifact);
  }

  return artifacts.slice(0, 1000);
}

function sanitizeRunEvidence(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }

  const now = new Date().toISOString();
  const evidence = [];
  for (const item of raw) {
    if (!isPlainObject(item)) {
      continue;
    }

    const entry = {
      sourceId: sanitizeTrimmedString(item.sourceId || item.evidenceId || item.id, { maxLength: 120 }) || randomUUID(),
      title: sanitizeTrimmedString(item.title || item.sourceTitle, { maxLength: 240 }) || "",
      url: sanitizeTrimmedString(item.url, { maxLength: 4000 }) || "",
      snippet: sanitizeTrimmedString(item.snippet || item.quote, { maxLength: 6000, allowEmpty: true }) || "",
      snapshot: sanitizeTrimmedString(item.snapshot, { maxLength: 200000, allowEmpty: true }) || "",
      retrievedAt:
        sanitizeTrimmedString(item.retrievedAt || item.accessedAt || item.accessed_at, { maxLength: 60 }) || now
    };

    if (!entry.title && !entry.url && !entry.snippet && !entry.snapshot) {
      continue;
    }
    evidence.push(entry);
  }

  return evidence.slice(0, 1000);
}

function sanitizeRunLogs(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const logs = [];
  for (const item of raw) {
    if (!isPlainObject(item)) {
      continue;
    }
    const message = sanitizeTrimmedString(item.message, { maxLength: 6000 });
    if (!message) {
      continue;
    }
    const levelRaw = sanitizeTrimmedString(item.level, { maxLength: 20 }) || "info";
    const level = new Set(["debug", "info", "warn", "error"]).has(levelRaw.toLowerCase())
      ? levelRaw.toLowerCase()
      : "info";
    const logEntry = {
      at: sanitizeTrimmedString(item.at, { maxLength: 60 }) || new Date().toISOString(),
      level,
      message
    };

    const stageId = sanitizeTrimmedString(item.stageId || item.stage, { maxLength: 120 });
    if (stageId) {
      logEntry.stageId = roleKeyFromText(stageId, stageId);
    }

    logs.push(logEntry);
  }
  return logs.slice(0, 5000);
}

function sanitizeRunMetrics(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }

  const metrics = sanitizeStats(raw) || {};
  if (isPlainObject(raw.perStage)) {
    metrics.perStage = raw.perStage;
  } else if (isPlainObject(raw.per_stage)) {
    metrics.perStage = raw.per_stage;
  }

  return Object.keys(metrics).length ? metrics : null;
}

function sanitizeRunCreateInput(raw) {
  const topic = sanitizeTrimmedString(raw?.topic, { maxLength: 1000 });
  if (!topic) {
    throw buildRequestError(400, "topic is required.");
  }

  return {
    status: sanitizeRunStatus(raw?.status, "queued"),
    topic,
    seedLinks: sanitizeSeedLinks(raw?.seedLinks),
    brandVoice: sanitizeTrimmedString(raw?.brandVoice, { maxLength: 4000 }) || "",
    targetPlatforms: sanitizeStringArray(raw?.targetPlatforms, { maxItems: 40, maxLength: 140 }),
    artifacts: sanitizeRunArtifacts(raw?.artifacts),
    evidence: sanitizeRunEvidence(raw?.evidence),
    logs: sanitizeRunLogs(raw?.logs),
    metrics: sanitizeRunMetrics(raw?.metrics),
    outputs: sanitizePipelineOutputs(raw?.outputs),
    toolsPolicy: sanitizeToolsPolicy(raw?.toolsPolicy ?? raw?.tools_policy),
    profileId: sanitizeTrimmedString(raw?.profileId, { maxLength: 120 }) || null,
    profileOverrides: isPlainObject(raw?.profileOverrides) ? raw.profileOverrides : null,
    freezeSettings: raw?.freezeSettings === undefined ? true : toBoolean(raw?.freezeSettings, true),
    failedStage: null,
    errorMessage: null,
    errorAt: null
  };
}

function sanitizeRunCreate(raw) {
  const pipelineId = sanitizeTrimmedString(raw?.pipelineId, { maxLength: 120 });
  if (!pipelineId) {
    throw buildRequestError(400, "pipelineId is required.");
  }
  if (!findPipeline(pipelineId)) {
    throw buildRequestError(404, "Pipeline not found.");
  }

  const pipeline = findPipeline(pipelineId);
  const input = sanitizeRunCreateInput(raw);
  const resolvedOutputs = input.outputs.length > 0 ? input.outputs : sanitizePipelineOutputs(pipeline?.outputs);
  const resolvedToolsPolicy =
    isPlainObject(raw?.toolsPolicy ?? raw?.tools_policy) || raw?.toolsPolicy || raw?.tools_policy
      ? sanitizeToolsPolicy(raw?.toolsPolicy ?? raw?.tools_policy)
      : sanitizeToolsPolicy(pipeline?.toolsPolicy);
  return {
    pipelineId,
    ...input,
    outputs: resolvedOutputs,
    toolsPolicy: resolvedToolsPolicy,
    stageState: buildInitialStageState(pipeline),
    runType: "pipeline",
    profileId: input.profileId,
    profileSnapshot: resolveProfileSnapshot({
      runType: "pipeline",
      sourceId: pipelineId,
      profileId: input.profileId,
      profileOverrides: input.profileOverrides,
      freezeSettings: input.freezeSettings
    }),
    control: sanitizeRunControl({ status: "queued" }),
    timelineMeta: sanitizeTimelineMeta(null),
    groupId: null,
    groupSnapshot: null
  };
}

function sanitizeRunUpdate(raw, previousRun) {
  if (!isPlainObject(raw)) {
    throw buildRequestError(400, "Run update payload must be an object.");
  }

  const updates = {};

  if (raw.status !== undefined) {
    updates.status = sanitizeRunStatus(raw.status, previousRun.status);
  }

  if (raw.topic !== undefined) {
    const topic = sanitizeTrimmedString(raw.topic, { maxLength: 1000 });
    if (!topic) {
      throw buildRequestError(400, "topic cannot be empty.");
    }
    updates.topic = topic;
  }

  if (raw.seedLinks !== undefined) {
    updates.seedLinks = sanitizeSeedLinks(raw.seedLinks);
  }

  if (raw.brandVoice !== undefined) {
    updates.brandVoice = sanitizeTrimmedString(raw.brandVoice, { maxLength: 4000, allowEmpty: true }) || "";
  }

  if (raw.targetPlatforms !== undefined) {
    updates.targetPlatforms = sanitizeStringArray(raw.targetPlatforms, { maxItems: 40, maxLength: 140 });
  }

  if (raw.outputs !== undefined) {
    updates.outputs = sanitizePipelineOutputs(raw.outputs);
  }

  if (raw.artifacts !== undefined) {
    updates.artifacts = sanitizeRunArtifacts(raw.artifacts);
  }

  if (raw.evidence !== undefined) {
    updates.evidence = sanitizeRunEvidence(raw.evidence);
  }

  if (raw.logs !== undefined) {
    updates.logs = sanitizeRunLogs(raw.logs);
  }

  if (raw.metrics !== undefined) {
    updates.metrics = sanitizeRunMetrics(raw.metrics);
  }

  if (raw.stageState !== undefined) {
    const pipeline = findPipeline(raw.pipelineId || previousRun.pipelineId);
    updates.stageState = sanitizeStageState(raw.stageState, pipeline);
  }

  if (raw.failedStage !== undefined) {
    const stageId = sanitizeTrimmedString(raw.failedStage, { maxLength: 80, allowEmpty: true });
    updates.failedStage = stageId ? roleKeyFromText(stageId) : null;
  }

  if (raw.errorMessage !== undefined) {
    updates.errorMessage = sanitizeTrimmedString(raw.errorMessage, { maxLength: 4000, allowEmpty: true }) || null;
  }

  if (raw.errorAt !== undefined) {
    updates.errorAt = sanitizeTrimmedString(raw.errorAt, { maxLength: 80, allowEmpty: true }) || null;
  }

  if (raw.toolsPolicy !== undefined || raw.tools_policy !== undefined) {
    updates.toolsPolicy = sanitizeToolsPolicy(raw.toolsPolicy ?? raw.tools_policy);
  }

  if (raw.pipelineId !== undefined) {
    const pipelineId = sanitizeTrimmedString(raw.pipelineId, { maxLength: 120 });
    if (!pipelineId) {
      throw buildRequestError(400, "pipelineId cannot be empty.");
    }
    if (!findPipeline(pipelineId)) {
      throw buildRequestError(404, "Pipeline not found.");
    }
    updates.pipelineId = pipelineId;
  }

  if (raw.profileId !== undefined) {
    updates.profileId = sanitizeTrimmedString(raw.profileId, { maxLength: 120 }) || null;
  }
  if (raw.profileSnapshot !== undefined) {
    updates.profileSnapshot = isPlainObject(raw.profileSnapshot) ? raw.profileSnapshot : null;
  }
  if (raw.runType !== undefined) {
    const runType = sanitizeTrimmedString(raw.runType, { maxLength: 20 })?.toLowerCase();
    updates.runType = new Set(["group", "pipeline"]).has(runType) ? runType : previousRun.runType || "pipeline";
  }
  if (raw.control !== undefined) {
    updates.control = sanitizeRunControl(raw.control);
  }
  if (raw.timelineMeta !== undefined) {
    updates.timelineMeta = sanitizeTimelineMeta(raw.timelineMeta);
  }

  return updates;
}

function hydrateRun(raw) {
  const now = new Date().toISOString();
  const groupId = sanitizeTrimmedString(raw?.groupId ?? raw?.group_id, { maxLength: 120 }) || null;
  const requestedPipelineId = sanitizeTrimmedString(raw?.pipelineId, { maxLength: 120 });
  const fallbackPipelineId = requestedPipelineId || (groupId ? "" : sanitizeTrimmedString(pipelines[0]?.id, { maxLength: 120 }) || "");
  const pipeline = findPipeline(fallbackPipelineId);

  const run = {
    runId: sanitizeTrimmedString(raw?.runId || raw?.id, { maxLength: 120 }) || randomUUID(),
    pipelineId: fallbackPipelineId || null,
    groupId,
    groupSnapshot: isPlainObject(raw?.groupSnapshot) ? raw.groupSnapshot : null,
    runType: sanitizeTrimmedString(raw?.runType, { maxLength: 20 })?.toLowerCase() || (groupId ? "group" : "pipeline"),
    profileId: sanitizeTrimmedString(raw?.profileId, { maxLength: 120 }) || null,
    profileSnapshot: isPlainObject(raw?.profileSnapshot) ? raw.profileSnapshot : null,
    createdAt: sanitizeTrimmedString(raw?.createdAt, { maxLength: 60 }) || now,
    updatedAt: sanitizeTrimmedString(raw?.updatedAt, { maxLength: 60 }) || now,
    status: sanitizeRunStatus(raw?.status, "queued", { strict: false }),
    topic: sanitizeTrimmedString(raw?.topic, { maxLength: 1000 }) || "",
    seedLinks: sanitizeSeedLinks(raw?.seedLinks),
    brandVoice: sanitizeTrimmedString(raw?.brandVoice, { maxLength: 4000, allowEmpty: true }) || "",
    targetPlatforms: sanitizeStringArray(raw?.targetPlatforms, { maxItems: 40, maxLength: 140 }),
    artifacts: sanitizeRunArtifacts(raw?.artifacts),
    evidence: sanitizeRunEvidence(raw?.evidence),
    logs: sanitizeRunLogs(raw?.logs),
    metrics: sanitizeRunMetrics(raw?.metrics),
    outputs: sanitizePipelineOutputs(raw?.outputs),
    toolsPolicy: sanitizeToolsPolicy(raw?.toolsPolicy ?? raw?.tools_policy),
    stageState: sanitizeStageState(raw?.stageState, pipeline),
    control: sanitizeRunControl(raw?.control || { status: raw?.status || "queued" }),
    timelineMeta: sanitizeTimelineMeta(raw?.timelineMeta),
    failedStage: sanitizeTrimmedString(raw?.failedStage, { maxLength: 80, allowEmpty: true }) || null,
    errorMessage: sanitizeTrimmedString(raw?.errorMessage, { maxLength: 4000, allowEmpty: true }) || null,
    errorAt: sanitizeTrimmedString(raw?.errorAt, { maxLength: 80, allowEmpty: true }) || null
  };

  return run;
}

function sanitizeAgent(raw) {
  const name = String(raw?.name || "").trim();
  const model = String(raw?.model || "").trim();
  const description = String(raw?.description || "").trim();
  const systemPrompt = String(raw?.systemPrompt || "").trim();

  if (!name) {
    const err = new Error("Agent name is required.");
    err.status = 400;
    throw err;
  }
  if (!model) {
    const err = new Error("Model is required.");
    err.status = 400;
    throw err;
  }

  const temperature = clamp(toNumber(raw?.temperature, 0.7), 0, 1);
  const topP = optionalNumber(raw?.topP, { min: 0, max: 1 });
  const topK = optionalNumber(raw?.topK, { min: 1, integer: true });
  const minP = optionalNumber(raw?.minP, { min: 0, max: 1 });
  const repeatPenalty = optionalNumber(raw?.repeatPenalty, { min: 1 });
  const maxOutputTokens = optionalNumber(raw?.maxOutputTokens, { min: 1, integer: true });
  const contextLength = optionalNumber(raw?.contextLength, { min: 1, integer: true });
  const reasoning = sanitizeReasoning(raw?.reasoning);
  const store = toBoolean(raw?.store, true);
  const stream = toBoolean(raw?.stream, true);
  const webSearch = toBoolean(raw?.webSearch, false);
  const integrations = sanitizeIntegrations(raw?.integrations);

  return {
    name,
    model,
    description,
    systemPrompt,
    temperature,
    topP,
    topK,
    minP,
    repeatPenalty,
    maxOutputTokens,
    contextLength,
    reasoning,
    store,
    stream,
    webSearch,
    integrations
  };
}

function hydrateAgent(raw) {
  const fallback = {
    id: randomUUID(),
    name: "Recovered Agent",
    model: "",
    description: "",
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: 0.7,
    topP: null,
    topK: null,
    minP: null,
    repeatPenalty: null,
    maxOutputTokens: null,
    contextLength: null,
    reasoning: null,
    store: true,
    stream: true,
    webSearch: false,
    integrations: [],
    chatHistory: [],
    lastResponseId: null,
    lastStats: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (!raw || typeof raw !== "object") {
    return fallback;
  }

  const id = String(raw.id || "").trim() || fallback.id;
  const name = String(raw.name || "").trim() || fallback.name;
  const model = String(raw.model || "").trim();
  const description = String(raw.description || "").trim();
  const systemPrompt = String(raw.systemPrompt || "").trim() || DEFAULT_SYSTEM_PROMPT;
  const temperature = clamp(toNumber(raw.temperature, 0.7), 0, 1);
  const topP = optionalNumber(raw.topP, { min: 0, max: 1 });
  const topK = optionalNumber(raw.topK, { min: 1, integer: true });
  const minP = optionalNumber(raw.minP, { min: 0, max: 1 });
  const repeatPenalty = optionalNumber(raw.repeatPenalty, { min: 1 });
  const maxOutputTokens = optionalNumber(raw.maxOutputTokens, { min: 1, integer: true });
  const contextLength = optionalNumber(raw.contextLength, { min: 1, integer: true });
  const reasoning = sanitizeReasoning(raw.reasoning);
  const store = toBoolean(raw.store, true);
  const stream = toBoolean(raw.stream, true);
  const webSearch = toBoolean(raw.webSearch, false);
  const integrations = sanitizeIntegrations(raw.integrations, false);
  const chatHistory = sanitizeChatHistory(raw.chatHistory || raw.history);
  const lastResponseId =
    typeof raw.lastResponseId === "string" && raw.lastResponseId.trim() ? raw.lastResponseId.trim() : null;
  const lastStats = sanitizeStats(raw.lastStats);
  const createdAt = String(raw.createdAt || "").trim() || fallback.createdAt;
  const updatedAt = String(raw.updatedAt || "").trim() || createdAt;

  return {
    id,
    name,
    model,
    description,
    systemPrompt,
    temperature,
    topP,
    topK,
    minP,
    repeatPenalty,
    maxOutputTokens,
    contextLength,
    reasoning,
    store,
    stream,
    webSearch,
    integrations,
    chatHistory,
    lastResponseId: store ? lastResponseId : null,
    lastStats,
    createdAt,
    updatedAt
  };
}

async function ensureDataFiles() {
  await ensureConfigFileInStore({
    configFile: CONFIG_FILE,
    defaultBaseUrl: DEFAULT_BASE_URL
  });
  await Promise.all([
    ensureAgentsFile({ agentsFile: AGENTS_FILE }),
    ensureAgentGroupsFile({ agentGroupsFile: AGENT_GROUPS_FILE }),
    ensurePipelinesFile({ pipelinesFile: PIPELINES_FILE }),
    ensureRunsFile({ runsFile: RUNS_FILE }),
    ensureRunProfilesFile({ runProfilesFile: RUN_PROFILES_FILE })
  ]);
}

async function loadConfig() {
  const loaded = await loadConfigFromStore({
    configFile: CONFIG_FILE,
    defaultBaseUrl: DEFAULT_BASE_URL,
    normalizeBaseUrl
  });
  config.baseUrl = loaded.baseUrl;
}

async function loadAgents() {
  const list = await loadAgentsFromStore({ agentsFile: AGENTS_FILE });
  agents = list.map(hydrateAgent);
  runtimeState.agents = agents;
}

async function loadAgentGroups() {
  const list = await loadAgentGroupsFromStore({ agentGroupsFile: AGENT_GROUPS_FILE });
  agentGroups = list.map(hydrateAgentGroup);
  runtimeState.agentGroups = agentGroups;
}

async function loadPipelines() {
  const list = await loadPipelinesFromStore({ pipelinesFile: PIPELINES_FILE });
  pipelines = list.map(hydratePipeline);
  runtimeState.pipelines = pipelines;
}

async function loadRuns() {
  const list = await loadRunsFromStore({ runsFile: RUNS_FILE });
  runs = list.map(hydrateRun).slice(-RUNS_LIMIT);
  runtimeState.runs = runs;

  let changed = false;
  for (const run of runs) {
    if (run.status !== "running") {
      continue;
    }
    run.status = "failed";
    run.failedStage = run.failedStage || "unknown";
    run.errorMessage = run.errorMessage || "Run was interrupted by server restart.";
    run.errorAt = new Date().toISOString();
    run.updatedAt = run.errorAt;
    changed = true;
  }
  if (changed) {
    await saveRuns();
  }
}

async function loadRunProfiles() {
  const list = await loadRunProfilesFromStore({ runProfilesFile: RUN_PROFILES_FILE });
  runProfiles = list.map(hydrateRunProfile);
  runtimeState.runProfiles = runProfiles;
}

async function saveConfig() {
  await saveConfigToStore({
    configFile: CONFIG_FILE,
    config
  });
}

async function saveAgents() {
  await saveAgentsToStore({
    agentsFile: AGENTS_FILE,
    agents
  });
}

async function saveAgentGroups() {
  await saveAgentGroupsToStore({
    agentGroupsFile: AGENT_GROUPS_FILE,
    agentGroups
  });
}

async function savePipelines() {
  await savePipelinesToStore({
    pipelinesFile: PIPELINES_FILE,
    pipelines
  });
}

async function saveRuns() {
  await saveRunsToStore({
    runsFile: RUNS_FILE,
    runs
  });
}

async function saveRunProfiles() {
  await saveRunProfilesToStore({
    runProfilesFile: RUN_PROFILES_FILE,
    runProfiles
  });
}

function agentToClient(agent) {
  return {
    id: agent.id,
    name: agent.name,
    model: agent.model,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    temperature: agent.temperature,
    topP: agent.topP,
    topK: agent.topK,
    minP: agent.minP,
    repeatPenalty: agent.repeatPenalty,
    maxOutputTokens: agent.maxOutputTokens,
    contextLength: agent.contextLength,
    reasoning: agent.reasoning,
    store: agent.store,
    stream: agent.stream,
    webSearch: agent.webSearch === true,
    integrations: agent.integrations,
    lastResponseId: agent.lastResponseId,
    lastStats: agent.lastStats,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt
  };
}

function pipelineToClient(pipeline) {
  return {
    id: pipeline.id,
    name: pipeline.name,
    description: pipeline.description,
    stages: pipeline.stages,
    agentsByRole: pipeline.agentsByRole,
    toolsPolicy: pipeline.toolsPolicy,
    outputs: pipeline.outputs,
    createdAt: pipeline.createdAt,
    updatedAt: pipeline.updatedAt
  };
}

function agentGroupToClient(group) {
  return {
    groupId: group.groupId,
    name: group.name,
    description: group.description,
    roles: group.roles,
    execution: group.execution,
    defaults: group.defaults,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt
  };
}

function runToClient(run) {
  return {
    runId: run.runId,
    pipelineId: run.pipelineId,
    groupId: run.groupId || null,
    groupSnapshot: run.groupSnapshot || null,
    runType: run.runType || (run.groupId ? "group" : "pipeline"),
    profileId: run.profileId || null,
    profileSnapshot: run.profileSnapshot || null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    status: run.status,
    control: run.control || { status: run.status },
    topic: run.topic,
    seedLinks: run.seedLinks,
    brandVoice: run.brandVoice,
    targetPlatforms: run.targetPlatforms,
    toolsPolicy: run.toolsPolicy,
    stageState: run.stageState,
    failedStage: run.failedStage,
    errorMessage: run.errorMessage,
    errorAt: run.errorAt,
    outputs: run.outputs,
    artifacts: run.artifacts,
    evidence: run.evidence,
    logs: run.logs,
    metrics: run.metrics,
    timelineMeta: run.timelineMeta || { perStage: {} }
  };
}

function buildRequestError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const lmStudioClient = createLmStudioClient({
  getNativeApiBaseUrl,
  getOpenAIBaseUrl,
  buildRequestError
});

async function lmStudioJsonRequest({ endpoint, method = "GET", body = null, native = true }) {
  return lmStudioClient.jsonRequest({ endpoint, method, body, native });
}

async function lmStudioStreamRequest({ endpoint, body }) {
  return lmStudioClient.streamRequest({ endpoint, body });
}

function normalizeMessageParts(message, messageParts) {
  if (Array.isArray(messageParts) && messageParts.length) {
    const normalized = [];
    for (const part of messageParts) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const type = String(part.type || "").trim().toLowerCase();
      if (type === "message") {
        const content = String(part.content || "").trim();
        if (content) {
          normalized.push({ type: "message", content });
        }
      } else if (type === "image") {
        const dataUrl = String(part.data_url || part.dataUrl || "").trim();
        if (dataUrl.startsWith("data:image/")) {
          normalized.push({ type: "image", data_url: dataUrl });
        }
      }
    }
    return normalized;
  }

  const text = String(message || "").trim();
  return text ? [{ type: "message", content: text }] : [];
}

function summarizeUserInput(parts) {
  const texts = parts.filter((part) => part.type === "message").map((part) => part.content.trim()).filter(Boolean);
  const imageCount = parts.filter((part) => part.type === "image").length;
  const textSummary = texts.join("\n").trim();

  if (!textSummary && imageCount) {
    return `[Image input: ${imageCount}]`;
  }
  if (textSummary && imageCount) {
    return `${textSummary}\n[Images attached: ${imageCount}]`;
  }
  return textSummary;
}

function extractMessageText(parts) {
  return parts
    .filter((part) => part.type === "message")
    .map((part) => String(part.content || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function truncateText(text, maxLength = 280) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function appendSearchResult(results, { title = "", url = "", snippet = "" }) {
  const normalized = {
    title: truncateText(title, 140),
    url: String(url || "").trim(),
    snippet: truncateText(snippet, 280)
  };

  if (!normalized.title && !normalized.snippet) {
    return;
  }

  const duplicate = results.some((existing) => {
    if (normalized.url && existing.url) {
      return normalized.url === existing.url;
    }
    return existing.title === normalized.title && existing.snippet === normalized.snippet;
  });
  if (!duplicate) {
    results.push(normalized);
  }
}

function collectRelatedTopics(topics, results) {
  if (!Array.isArray(topics)) {
    return;
  }

  for (const topic of topics) {
    if (Array.isArray(topic?.Topics)) {
      collectRelatedTopics(topic.Topics, results);
      continue;
    }
    appendSearchResult(results, {
      title: topic?.Text || "",
      url: topic?.FirstURL || "",
      snippet: topic?.Text || ""
    });
  }
}

async function searchOnline(query) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);

  try {
    const searchUrl = new URL("https://api.duckduckgo.com/");
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("no_html", "1");
    searchUrl.searchParams.set("no_redirect", "1");
    searchUrl.searchParams.set("skip_disambig", "1");

    const response = await fetch(searchUrl, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Search request failed (${response.status}).`);
    }

    const payload = await parseJsonResponse(response);
    const results = [];

    appendSearchResult(results, {
      title: payload?.Heading || "",
      url: payload?.AbstractURL || "",
      snippet: payload?.AbstractText || ""
    });

    if (Array.isArray(payload?.Results)) {
      for (const item of payload.Results) {
        appendSearchResult(results, {
          title: item?.Text || "",
          url: item?.FirstURL || "",
          snippet: item?.Text || ""
        });
      }
    }

    collectRelatedTopics(payload?.RelatedTopics, results);
    return results.slice(0, WEB_SEARCH_MAX_RESULTS);
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildSearchContext(query, results) {
  if (!results.length) {
    return "";
  }

  const lines = [
    `Online search context for: "${query}"`,
    `Retrieved at: ${new Date().toISOString()}`,
    "Use these references when useful and cite URLs when relying on them."
  ];

  for (const [index, result] of results.entries()) {
    lines.push(`[${index + 1}] ${result.title || "Result"}`);
    if (result.url) {
      lines.push(`URL: ${result.url}`);
    }
    if (result.snippet) {
      lines.push(`Snippet: ${result.snippet}`);
    }
  }

  return lines.join("\n");
}

async function enrichMessageWithSearch(agent, messageParts) {
  if (!agent?.webSearch) {
    return messageParts;
  }

  const query = extractMessageText(messageParts);
  if (!query) {
    return messageParts;
  }

  try {
    const results = await searchOnline(query);
    if (!results.length) {
      return messageParts;
    }

    const searchContext = buildSearchContext(query, results);
    if (!searchContext) {
      return messageParts;
    }

    return [{ type: "message", content: searchContext }, ...messageParts];
  } catch (error) {
    logger.warn(`Online search unavailable, continuing without search context: ${error.message || error}`);
    return messageParts;
  }
}

function buildChatRequest(agent, inputParts, { stream = false, reset = false } = {}) {
  const payload = {
    model: agent.model,
    input:
      inputParts.length === 1 && inputParts[0].type === "message"
        ? inputParts[0].content
        : inputParts,
    stream,
    store: agent.store
  };

  if (agent.systemPrompt) {
    payload.system_prompt = agent.systemPrompt;
  }
  if (agent.temperature !== null && agent.temperature !== undefined) {
    payload.temperature = agent.temperature;
  }
  if (agent.topP !== null) {
    payload.top_p = agent.topP;
  }
  if (agent.topK !== null) {
    payload.top_k = agent.topK;
  }
  if (agent.minP !== null) {
    payload.min_p = agent.minP;
  }
  if (agent.repeatPenalty !== null) {
    payload.repeat_penalty = agent.repeatPenalty;
  }
  if (agent.maxOutputTokens !== null) {
    payload.max_output_tokens = agent.maxOutputTokens;
  }
  if (agent.contextLength !== null) {
    payload.context_length = agent.contextLength;
  }
  if (agent.reasoning) {
    payload.reasoning = agent.reasoning;
  }
  if (agent.integrations && agent.integrations.length) {
    payload.integrations = agent.integrations;
  }
  if (agent.store && !reset && agent.lastResponseId) {
    payload.previous_response_id = agent.lastResponseId;
  }

  return payload;
}

function buildOutputHistoryItems(result) {
  const output = Array.isArray(result?.output) ? result.output : [];
  const items = [];

  for (const outputItem of output) {
    const type = String(outputItem?.type || "").trim().toLowerCase();
    if (type === "message") {
      items.push({
        role: "assistant",
        content: String(outputItem.content || "")
      });
      continue;
    }

    if (type === "reasoning") {
      items.push({
        role: "reasoning",
        content: String(outputItem.content || "")
      });
      continue;
    }

    if (type === "tool_call") {
      const content = `${outputItem.tool || "tool"} call`;
      items.push({
        role: "tool_call",
        content,
        tool: outputItem.tool || null,
        arguments: outputItem.arguments ?? null,
        output: outputItem.output ?? null,
        providerInfo: outputItem.provider_info ?? outputItem.providerInfo ?? null
      });
      continue;
    }

    if (type === "invalid_tool_call") {
      items.push({
        role: "invalid_tool_call",
        content: String(outputItem.reason || "Invalid tool call."),
        metadata: outputItem.metadata ?? null
      });
      continue;
    }

    items.push({
      role: "assistant",
      content: typeof outputItem === "string" ? outputItem : JSON.stringify(outputItem, null, 2)
    });
  }

  if (!items.length) {
    items.push({ role: "assistant", content: "" });
  }

  const stats = sanitizeStats(result?.stats);
  if (stats) {
    items[items.length - 1].stats = stats;
  }
  if (result?.response_id) {
    items[items.length - 1].responseId = String(result.response_id);
  }

  return items;
}

function summarizeOutputTypes(result) {
  const output = Array.isArray(result?.output) ? result.output : [];
  const counts = {};

  for (const item of output) {
    const type = String(item?.type || "unknown").trim().toLowerCase() || "unknown";
    counts[type] = (counts[type] || 0) + 1;
  }

  return counts;
}

function resetConversation(agent) {
  agent.chatHistory = [];
  agent.lastResponseId = null;
  agent.lastStats = null;
  agent.updatedAt = new Date().toISOString();
}

function applyChatResult(agent, userHistoryItem, result) {
  const outputItems = buildOutputHistoryItems(result);
  agent.chatHistory = [...agent.chatHistory, userHistoryItem, ...outputItems].slice(-HISTORY_LIMIT);
  agent.lastStats = sanitizeStats(result?.stats);
  if (agent.store) {
    const responseId =
      typeof result?.response_id === "string" && result.response_id.trim() ? result.response_id.trim() : null;
    agent.lastResponseId = responseId || agent.lastResponseId || null;
  } else {
    agent.lastResponseId = null;
  }
  agent.updatedAt = new Date().toISOString();
}

function writeSse(res, event, data) {
  sendEvent(res, { type: event, data });
}

function findAgent(agentId) {
  return agents.find((agent) => agent.id === agentId) || null;
}

function findAgentGroup(groupId) {
  return agentGroups.find((group) => group.groupId === groupId) || null;
}

function findPipeline(pipelineId) {
  return pipelines.find((pipeline) => pipeline.id === pipelineId) || null;
}

function findRun(runId) {
  return runs.find((run) => run.runId === runId) || null;
}

function setRuns(nextRuns) {
  runs = nextRuns;
  runtimeState.runs = runs;
}

const orchestration = createOrchestrator({
  canonicalStages: CANONICAL_PIPELINE_STAGES,
  runStreamSubscribers,
  activePipelineRuns,
  saveRuns,
  findRun,
  findPipeline,
  findAgent,
  parseSseBlock,
  parseJsonResponse,
  lmStudioStreamRequest,
  buildRequestError,
  sanitizeStats,
  sanitizeRunEvidence,
  sanitizeStringArray,
  isPlainObject,
  toBoolean,
  buildChatRequest,
  enrichMessageWithSearch,
  randomUUID,
  writeSse,
  searchOnline
});

registerApiRoutes(app, {
  system: {
    getConfig: () => config,
    getNativeApiBaseUrl,
    getAgents: () => agents,
    getAgentGroups: () => agentGroups,
    getPipelines: () => pipelines,
    getRuns: () => runs,
    getRunProfiles: () => runProfiles,
    normalizeBaseUrl,
    saveConfig,
    lmStudioJsonRequest,
    modelCacheTtlMs: 15_000
  },
  mcp: {
    sanitizeIntegrations,
    buildRequestError,
    lmStudioJsonRequest,
    summarizeOutputTypes
  },
  agents: {
    getAgents: () => agents,
    saveAgents,
    sanitizeAgent,
    agentToClient,
    buildRequestError,
    randomUUID
  },
  agentGroups: {
    getAgentGroups: () => agentGroups,
    findAgentGroup,
    findRun,
    findAgent,
    setRuns,
    getRuns: () => runs,
    runsLimit: RUNS_LIMIT,
    saveRuns,
    saveAgentGroups,
    sanitizeAgentGroup,
    sanitizeTrimmedString,
    sanitizeRunCreateInput,
    buildInitialStageStateFromAgentGroup,
    resolveProfileSnapshot,
    sanitizeRunControl,
    sanitizeTimelineMeta,
    canonicalStages: CANONICAL_PIPELINE_STAGES,
    buildRequestError,
    randomUUID,
    activePipelineRuns,
    orchestration,
    agentGroupToClient,
    mergeAgentGroupRunDefaults
  },
  runProfiles: {
    getRunProfiles: () => runProfiles,
    findRunProfile,
    sanitizeRunProfile,
    sanitizeTrimmedString,
    buildRequestError,
    saveRunProfiles,
    runProfileToClient,
    randomUUID
  },
  pipelines: {
    getPipelines: () => pipelines,
    findPipeline,
    pipelineToClient,
    sanitizePipeline,
    sanitizeTrimmedString,
    buildRequestError,
    savePipelines,
    randomUUID,
    orchestration,
    sanitizeRunCreate,
    getRuns: () => runs,
    setRuns,
    runsLimit: RUNS_LIMIT,
    saveRuns,
    activePipelineRuns,
    findRun
  },
  runs: {
    getRuns: () => runs,
    setRuns,
    findRun,
    findPipeline,
    runToClient,
    sanitizeTrimmedString,
    clamp,
    toInteger,
    runStatusValues: RUN_STATUS_VALUES,
    buildRequestError,
    openSse,
    writeSse,
    closeSse,
    orchestration,
    runStreamHeartbeatMs: RUN_STREAM_HEARTBEAT_MS,
    runStreamSubscribers,
    sanitizeRunCreate,
    runsLimit: RUNS_LIMIT,
    randomUUID,
    saveRuns,
    sanitizeRunUpdate,
    sanitizeRunLogs,
    activePipelineRuns
  },
  chat: {
    findAgent,
    buildRequestError,
    resetConversation,
    saveAgents,
    normalizeMessageParts,
    summarizeUserInput,
    enrichMessageWithSearch,
    buildChatRequest,
    lmStudioJsonRequest,
    applyChatResult,
    lmStudioStreamRequest,
    parseJsonResponse,
    writeSse,
    closeSse,
    openSse,
    parseSseBlock,
    toBoolean
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use(createErrorHandler({ logger }));

async function start() {
  await ensureDataFiles();
  await loadConfig();
  await loadAgents();
  await loadAgentGroups();
  await loadPipelines();
  await loadRunProfiles();
  await loadRuns();

  app.listen(PORT, () => {
    logger.info(`LM Studio Agent Builder running at http://localhost:${PORT}`);
  });
}

module.exports = {
  app,
  start,
  __serverInternals: {
    CANONICAL_PIPELINE_STAGES,
    sanitizePipeline,
    sanitizeAgentGroup,
    sanitizeRunProfile,
    sanitizeRunCreate,
    sanitizeRunCreateInput,
    sanitizeRunUpdate,
    buildInitialStageState,
    buildInitialStageStateFromAgentGroup,
    mergeAgentGroupRunDefaults,
    resolveProfileSnapshot,
    runToClient,
    pipelineToClient,
    agentGroupToClient,
    ensurePipelineReadyForRun: orchestration.ensurePipelineReadyForRun,
    setTestState(nextState = {}) {
      if (Array.isArray(nextState.agents)) {
        agents = nextState.agents;
        runtimeState.agents = agents;
      }
      if (Array.isArray(nextState.agentGroups)) {
        agentGroups = nextState.agentGroups;
        runtimeState.agentGroups = agentGroups;
      }
      if (Array.isArray(nextState.pipelines)) {
        pipelines = nextState.pipelines;
        runtimeState.pipelines = pipelines;
      }
      if (Array.isArray(nextState.runProfiles)) {
        runProfiles = nextState.runProfiles;
        runtimeState.runProfiles = runProfiles;
      }
      if (Array.isArray(nextState.runs)) {
        runs = nextState.runs;
        runtimeState.runs = runs;
      }
    },
    getTestState() {
      return { agents, agentGroups, pipelines, runProfiles, runs };
    }
  }
};

if (require.main === module) {
  start().catch((error) => {
    logger.error(`Failed to start server: ${error?.stack || error?.message || error}`);
    process.exit(1);
  });
}
