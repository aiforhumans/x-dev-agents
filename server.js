const express = require("express");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(process.cwd(), "data");
const AGENTS_FILE = path.join(DATA_DIR, "agents.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const PIPELINES_FILE = path.join(DATA_DIR, "pipelines.json");
const RUNS_FILE = path.join(DATA_DIR, "runs.json");

const DEFAULT_BASE_URL = process.env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1";
const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";
const HISTORY_LIMIT = 200;
const RUNS_LIMIT = 2000;
const WEB_SEARCH_MAX_RESULTS = 5;
const WEB_SEARCH_TIMEOUT_MS = 8000;
const CANONICAL_PIPELINE_STAGES = [
  {
    stageId: "discovery",
    role: "discovery",
    name: "Discovery + Retrieval",
    defaultArtifactNames: ["evidence.json", "reading_notes.md"]
  },
  {
    stageId: "synthesis",
    role: "synthesis",
    name: "Technical Synthesis",
    defaultArtifactNames: ["foundation_report.md", "claims_table.json"]
  },
  {
    stageId: "draft",
    role: "draft",
    name: "Primary Draft",
    defaultArtifactNames: ["draft_longform.md"]
  },
  {
    stageId: "adapt",
    role: "adapt",
    name: "Platform Adapters",
    defaultArtifactNames: ["platform_pack.md"]
  },
  {
    stageId: "style",
    role: "style",
    name: "Style Calibration",
    defaultArtifactNames: ["platform_pack_styled.md"]
  },
  {
    stageId: "audit",
    role: "audit",
    name: "Reflection / Fact Audit",
    defaultArtifactNames: ["fact_audit.md", "final_pack.md"]
  }
];
const CANONICAL_STAGE_IDS = new Set(CANONICAL_PIPELINE_STAGES.map((stage) => stage.stageId));
const RUN_STATUS_VALUES = new Set(["queued", "running", "completed", "failed", "cancelled"]);
const RUN_STREAM_HEARTBEAT_MS = 20_000;

let agents = [];
let pipelines = [];
let runs = [];
let config = { baseUrl: DEFAULT_BASE_URL };
const runStreamSubscribers = new Map();
const activePipelineRuns = new Map();

app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(process.cwd(), "public")));

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

function sanitizeRunCreate(raw) {
  const pipelineId = sanitizeTrimmedString(raw?.pipelineId, { maxLength: 120 });
  if (!pipelineId) {
    throw buildRequestError(400, "pipelineId is required.");
  }
  if (!findPipeline(pipelineId)) {
    throw buildRequestError(404, "Pipeline not found.");
  }

  const topic = sanitizeTrimmedString(raw?.topic, { maxLength: 1000 });
  if (!topic) {
    throw buildRequestError(400, "topic is required.");
  }

  const pipeline = findPipeline(pipelineId);
  const requestedOutputs = sanitizePipelineOutputs(raw?.outputs);
  const resolvedOutputs = requestedOutputs.length > 0 ? requestedOutputs : sanitizePipelineOutputs(pipeline?.outputs);

  const resolvedToolsPolicy = isPlainObject(raw?.toolsPolicy ?? raw?.tools_policy)
    ? sanitizeToolsPolicy(raw?.toolsPolicy ?? raw?.tools_policy)
    : sanitizeToolsPolicy(pipeline?.toolsPolicy);

  return {
    pipelineId,
    status: sanitizeRunStatus(raw?.status, "queued"),
    topic,
    seedLinks: sanitizeSeedLinks(raw?.seedLinks),
    brandVoice: sanitizeTrimmedString(raw?.brandVoice, { maxLength: 4000 }) || "",
    targetPlatforms: sanitizeStringArray(raw?.targetPlatforms, { maxItems: 40, maxLength: 140 }),
    artifacts: sanitizeRunArtifacts(raw?.artifacts),
    evidence: sanitizeRunEvidence(raw?.evidence),
    logs: sanitizeRunLogs(raw?.logs),
    metrics: sanitizeRunMetrics(raw?.metrics),
    outputs: resolvedOutputs,
    toolsPolicy: resolvedToolsPolicy,
    stageState: buildInitialStageState(pipeline),
    failedStage: null,
    errorMessage: null,
    errorAt: null
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

  return updates;
}

function hydrateRun(raw) {
  const now = new Date().toISOString();
  const fallbackPipelineId =
    sanitizeTrimmedString(raw?.pipelineId, { maxLength: 120 }) ||
    sanitizeTrimmedString(pipelines[0]?.id, { maxLength: 120 }) ||
    "";
  const pipeline = findPipeline(fallbackPipelineId);

  const run = {
    runId: sanitizeTrimmedString(raw?.runId || raw?.id, { maxLength: 120 }) || randomUUID(),
    pipelineId: fallbackPipelineId,
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

function stripUtf8Bom(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(CONFIG_FILE);
  } catch {
    await fs.writeFile(CONFIG_FILE, JSON.stringify({ baseUrl: DEFAULT_BASE_URL }, null, 2), "utf-8");
  }

  try {
    await fs.access(AGENTS_FILE);
  } catch {
    await fs.writeFile(AGENTS_FILE, "[]\n", "utf-8");
  }

  try {
    await fs.access(PIPELINES_FILE);
  } catch {
    await fs.writeFile(PIPELINES_FILE, "[]\n", "utf-8");
  }

  try {
    await fs.access(RUNS_FILE);
  } catch {
    await fs.writeFile(RUNS_FILE, "[]\n", "utf-8");
  }
}

async function loadConfig() {
  try {
    const contents = stripUtf8Bom(await fs.readFile(CONFIG_FILE, "utf-8"));
    const parsed = JSON.parse(contents);
    config.baseUrl = normalizeBaseUrl(parsed.baseUrl || DEFAULT_BASE_URL);
  } catch {
    config.baseUrl = normalizeBaseUrl(DEFAULT_BASE_URL);
    await saveConfig();
  }
}

async function loadAgents() {
  try {
    const contents = stripUtf8Bom(await fs.readFile(AGENTS_FILE, "utf-8"));
    const parsed = JSON.parse(contents);
    const list = Array.isArray(parsed) ? parsed : [];
    agents = list.map(hydrateAgent);
  } catch {
    agents = [];
    await saveAgents();
  }
}

async function loadPipelines() {
  try {
    const contents = stripUtf8Bom(await fs.readFile(PIPELINES_FILE, "utf-8"));
    const parsed = JSON.parse(contents);
    const list = Array.isArray(parsed) ? parsed : [];
    pipelines = list.map(hydratePipeline);
  } catch {
    pipelines = [];
    await savePipelines();
  }
}

async function loadRuns() {
  try {
    const contents = stripUtf8Bom(await fs.readFile(RUNS_FILE, "utf-8"));
    const parsed = JSON.parse(contents);
    const list = Array.isArray(parsed) ? parsed : [];
    runs = list.map(hydrateRun).slice(-RUNS_LIMIT);

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
  } catch {
    runs = [];
    await saveRuns();
  }
}

async function saveConfig() {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

async function saveAgents() {
  await fs.writeFile(AGENTS_FILE, JSON.stringify(agents, null, 2) + "\n", "utf-8");
}

async function savePipelines() {
  await fs.writeFile(PIPELINES_FILE, JSON.stringify(pipelines, null, 2) + "\n", "utf-8");
}

async function saveRuns() {
  await fs.writeFile(RUNS_FILE, JSON.stringify(runs, null, 2) + "\n", "utf-8");
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

function runToClient(run) {
  return {
    runId: run.runId,
    pipelineId: run.pipelineId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    status: run.status,
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
    metrics: run.metrics
  };
}

function buildRequestError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function lmStudioJsonRequest({ endpoint, method = "GET", body = null, native = true }) {
  const baseUrl = native ? getNativeApiBaseUrl() : getOpenAIBaseUrl();
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.error ||
      payload?.message ||
      `LM Studio request failed (${response.status}).`;
    throw buildRequestError(response.status, String(message));
  }

  return payload;
}

async function lmStudioStreamRequest({ endpoint, body }) {
  const baseUrl = getNativeApiBaseUrl();
  return fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
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
    console.warn("Online search unavailable, continuing without search context:", error.message || error);
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
  res.write(`event: ${event}\n`);
  if (data !== undefined) {
    const serialized = typeof data === "string" ? data : JSON.stringify(data);
    res.write(`data: ${serialized}\n`);
  }
  res.write("\n");
}

function parseSseBlock(block) {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (!dataLines.length) {
    return null;
  }

  const rawData = dataLines.join("\n");
  let parsedData = rawData;
  try {
    parsedData = JSON.parse(rawData);
  } catch {
    parsedData = rawData;
  }

  return { event, data: parsedData };
}

function stageById(stageId) {
  return CANONICAL_PIPELINE_STAGES.find((stage) => stage.stageId === stageId) || null;
}

function setRunStageStatus(run, stageId, status, patch = {}) {
  if (!run?.stageState || !run.stageState[stageId]) {
    return;
  }
  const entry = run.stageState[stageId];
  entry.status = status;
  if (status === "running") {
    entry.startedAt = entry.startedAt || new Date().toISOString();
  }
  if (status === "completed" || status === "failed") {
    entry.completedAt = new Date().toISOString();
  }
  if (patch.agentId !== undefined) {
    entry.agentId = patch.agentId;
  }
  if (patch.error !== undefined) {
    entry.error = patch.error;
  }
  if (patch.stats !== undefined) {
    entry.stats = patch.stats;
  }
  if (Array.isArray(patch.artifacts)) {
    entry.artifacts = patch.artifacts;
  }
}

function normalizeToolEventPayload(event, data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = {
    event,
    type: String(data.type || event || "").toLowerCase()
  };

  if (data.tool) {
    payload.tool = data.tool;
  }
  if (data.arguments !== undefined) {
    payload.arguments = data.arguments;
  }
  if (data.output !== undefined) {
    payload.output = data.output;
  }
  if (data.provider_info !== undefined) {
    payload.providerInfo = data.provider_info;
  } else if (data.providerInfo !== undefined) {
    payload.providerInfo = data.providerInfo;
  }

  return payload;
}

function appendRunLog(run, level, message, { stageId = null } = {}) {
  run.logs.push({
    at: new Date().toISOString(),
    level,
    message: String(message || ""),
    ...(stageId ? { stageId } : {})
  });
  run.logs = run.logs.slice(-5000);
}

function pushRunArtifact(run, artifact) {
  run.artifacts.push(artifact);
  run.artifacts = run.artifacts.slice(-1000);
}

function buildArtifact(run, { stageId, name, content, type = "text/markdown", metadata = null }) {
  const now = new Date().toISOString();
  const ext = String(name || "").split(".").pop()?.toLowerCase();
  const artifactType = ext === "json" ? "application/json" : type;

  return {
    artifactId: randomUUID(),
    stageId,
    type: artifactType,
    title: name,
    uri: `run://${run.runId}/${name}`,
    content: String(content || ""),
    createdAt: now,
    updatedAt: now,
    ...(metadata && typeof metadata === "object" ? { metadata } : {})
  };
}

function extractJsonObjectFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }

  const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // continue
    }
  }

  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch && objectMatch[0]) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // continue
    }
  }

  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch && arrayMatch[0]) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      // continue
    }
  }

  return null;
}

function agentSupportsSearxLikeRetrieval(agent) {
  const integrations = Array.isArray(agent?.integrations) ? agent.integrations : [];
  return integrations.some((entry) => {
    if (typeof entry === "string") {
      return /searx|search|retrieval/i.test(entry);
    }
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const id = String(entry.id || entry.server_label || entry.serverLabel || "").trim();
    const url = String(entry.server_url || entry.serverUrl || "").trim();
    return /searx|search|retrieval/i.test(id) || /searx/i.test(url);
  });
}

function getRunSubscribers(runId) {
  if (!runStreamSubscribers.has(runId)) {
    runStreamSubscribers.set(runId, new Set());
  }
  return runStreamSubscribers.get(runId);
}

function streamRunEvent(run, event, payload = {}) {
  const subscribers = runStreamSubscribers.get(run.runId);
  if (!subscribers || !subscribers.size) {
    return;
  }

  const data = {
    runId: run.runId,
    pipelineId: run.pipelineId,
    at: new Date().toISOString(),
    ...payload
  };

  for (const res of subscribers) {
    try {
      writeSse(res, event, data);
    } catch {
      // Ignore write failures; connection cleanup handles stale clients.
    }
  }
}

function closeRunStream(runId) {
  const subscribers = runStreamSubscribers.get(runId);
  if (!subscribers) {
    return;
  }
  for (const res of subscribers) {
    try {
      res.end();
    } catch {
      // Ignore.
    }
  }
  runStreamSubscribers.delete(runId);
}

async function saveRunsAndBroadcast(run, event = null, payload = null) {
  await saveRuns();
  if (event) {
    streamRunEvent(run, event, payload || {});
  }
}

function createPromptForStage({ stageId, topic, brandVoice, targetPlatforms, priorArtifacts }) {
  const artifactsByName = Object.fromEntries(
    (priorArtifacts || []).map((artifact) => [String(artifact.title || ""), String(artifact.content || "")])
  );

  if (stageId === "discovery") {
    return [
      `Topic: ${topic}`,
      "Goal: Build an evidence pack with grounded sources.",
      "Return concise research output plus source-backed notes.",
      "Include clearly structured findings and references."
    ].join("\n");
  }

  if (stageId === "synthesis") {
    return [
      `Topic: ${topic}`,
      "Use these inputs to produce synthesis artifacts:",
      `reading_notes.md:\n${artifactsByName["reading_notes.md"] || ""}`,
      `evidence.json:\n${artifactsByName["evidence.json"] || "[]"}`,
      "Output key claims with traceable source links, risks/limitations, and guardrails."
    ].join("\n\n");
  }

  if (stageId === "draft") {
    return [
      `Topic: ${topic}`,
      `foundation_report.md:\n${artifactsByName["foundation_report.md"] || ""}`,
      `claims_table.json:\n${artifactsByName["claims_table.json"] || "[]"}`,
      "Produce a strong long-form draft."
    ].join("\n\n");
  }

  if (stageId === "adapt") {
    return [
      `Topic: ${topic}`,
      `Target platforms: ${(targetPlatforms || []).join(", ") || "linkedin, x, instagram, exec-summary"}`,
      `draft_longform.md:\n${artifactsByName["draft_longform.md"] || ""}`,
      "Adapt into platform-specific variants."
    ].join("\n\n");
  }

  if (stageId === "style") {
    return [
      `Topic: ${topic}`,
      `Brand voice: ${brandVoice || "Use professional and clear tone."}`,
      `platform_pack.md:\n${artifactsByName["platform_pack.md"] || ""}`,
      "Apply consistent brand style and formatting."
    ].join("\n\n");
  }

  if (stageId === "audit") {
    return [
      `Topic: ${topic}`,
      `platform_pack_styled.md:\n${artifactsByName["platform_pack_styled.md"] || ""}`,
      `claims_table.json:\n${artifactsByName["claims_table.json"] || "[]"}`,
      `evidence.json:\n${artifactsByName["evidence.json"] || "[]"}`,
      "Audit factual grounding and produce final publishable pack."
    ].join("\n\n");
  }

  return `Topic: ${topic}`;
}

function resolveStageToolsPolicy(run, pipeline, stageId) {
  const runPolicy = isPlainObject(run?.toolsPolicy) ? run.toolsPolicy : null;
  const pipelinePolicy = isPlainObject(pipeline?.toolsPolicy) ? pipeline.toolsPolicy : null;
  const rootPolicy = runPolicy || pipelinePolicy || {};
  const defaultPolicy = isPlainObject(rootPolicy.default) ? rootPolicy.default : {};
  const stagePolicyRaw = isPlainObject(rootPolicy.byStage?.[stageId]) ? rootPolicy.byStage[stageId] : {};

  return {
    allowWebSearch:
      stagePolicyRaw.allowWebSearch !== undefined
        ? toBoolean(stagePolicyRaw.allowWebSearch, false)
        : toBoolean(defaultPolicy.allowWebSearch, false),
    allowedTools: sanitizeStringArray(stagePolicyRaw.allowedTools ?? defaultPolicy.allowedTools, {
      maxItems: 200,
      maxLength: 200
    }),
    allowedIntegrations: sanitizeStringArray(stagePolicyRaw.allowedIntegrations ?? defaultPolicy.allowedIntegrations, {
      maxItems: 200,
      maxLength: 320
    })
  };
}

function applyIntegrationPolicy(agent, stagePolicy) {
  if (!stagePolicy.allowedIntegrations.length) {
    return agent;
  }

  const allowed = new Set(stagePolicy.allowedIntegrations.map((item) => String(item || "").trim()).filter(Boolean));
  const integrations = (Array.isArray(agent.integrations) ? agent.integrations : []).filter((integration) => {
    if (typeof integration === "string") {
      return allowed.has(integration);
    }
    if (!integration || typeof integration !== "object") {
      return false;
    }
    const key = String(integration.id || integration.server_label || integration.serverLabel || "").trim();
    return key ? allowed.has(key) : false;
  });

  return {
    ...agent,
    integrations
  };
}

function composeStagePayload(agent, stagePrompt, { reset = true } = {}) {
  const parts = [{ type: "message", content: stagePrompt }];
  return buildChatRequest(agent, parts, { stream: true, reset });
}

async function executeLmStudioStage({
  run,
  pipeline,
  stageId,
  agent,
  promptText,
  allowSearchFallback = false
}) {
  const stagePolicy = resolveStageToolsPolicy(run, pipeline, stageId);
  const agentWithPolicy = applyIntegrationPolicy(agent, stagePolicy);
  const payload = composeStagePayload(agentWithPolicy, promptText, { reset: true });
  let enrichedInputParts = [{ type: "message", content: promptText }];
  if (
    allowSearchFallback &&
    stagePolicy.allowWebSearch &&
    !agentSupportsSearxLikeRetrieval(agentWithPolicy) &&
    toBoolean(agentWithPolicy.webSearch, true)
  ) {
    enrichedInputParts = await enrichMessageWithSearch({ webSearch: true }, enrichedInputParts);
    payload.input = enrichedInputParts.length === 1 ? enrichedInputParts[0].content : enrichedInputParts;
  }
  payload.stream = true;

  const upstream = await lmStudioStreamRequest({
    endpoint: "/chat",
    body: payload
  });

  if (!upstream.ok) {
    const payloadError = await parseJsonResponse(upstream);
    const message =
      payloadError?.error?.message ||
      payloadError?.error ||
      payloadError?.message ||
      `LM Studio streaming request failed (${upstream.status}).`;
    throw buildRequestError(upstream.status, String(message));
  }
  if (!upstream.body) {
    throw buildRequestError(502, "No stream body returned by LM Studio.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult = null;
  let assistantText = "";
  const toolEvents = [];

  for await (const chunk of upstream.body) {
    buffer += decoder.decode(chunk, { stream: true });

    while (true) {
      const boundaryMatch = buffer.match(/\r?\n\r?\n/);
      if (!boundaryMatch || boundaryMatch.index === undefined) {
        break;
      }
      const boundaryIndex = boundaryMatch.index;
      const boundaryLength = boundaryMatch[0].length;
      const block = buffer.slice(0, boundaryIndex).trim();
      buffer = buffer.slice(boundaryIndex + boundaryLength);
      if (!block) {
        continue;
      }

      const parsed = parseSseBlock(block);
      if (!parsed) {
        continue;
      }

      const { event, data } = parsed;
      if (event === "chat.end" && data && typeof data === "object" && data.result) {
        finalResult = data.result;
      } else if (event === "message.delta" && data && typeof data === "object") {
        const delta = String(data.content || "");
        if (delta) {
          assistantText += delta;
          streamRunEvent(run, "assistant_delta", { stageId, delta });
        }
      } else if (/tool_call|tool\.call|tool_call\.delta/i.test(event)) {
        const payloadEvent = normalizeToolEventPayload("tool_call", data);
        if (payloadEvent) {
          toolEvents.push(payloadEvent);
          streamRunEvent(run, "tool_call", { stageId, ...payloadEvent });
        }
      } else if (/tool_result|tool\.result|tool_output/i.test(event)) {
        const payloadEvent = normalizeToolEventPayload("tool_result", data);
        if (payloadEvent) {
          toolEvents.push(payloadEvent);
          streamRunEvent(run, "tool_result", { stageId, ...payloadEvent });
        }
      }
    }
  }

  if (!finalResult) {
    finalResult = {
      output: [{ type: "message", content: assistantText }],
      response_id: null,
      stats: null
    };
  }

  if (!assistantText) {
    const outputItems = Array.isArray(finalResult.output) ? finalResult.output : [];
    assistantText = outputItems
      .filter((item) => String(item?.type || "").toLowerCase() === "message")
      .map((item) => String(item?.content || ""))
      .join("");
  }

  const outputItems = Array.isArray(finalResult.output) ? finalResult.output : [];
  for (const item of outputItems) {
    const type = String(item?.type || "").trim().toLowerCase();
    if (type === "tool_call") {
      const payloadEvent = normalizeToolEventPayload("tool_call", item);
      if (payloadEvent) {
        toolEvents.push(payloadEvent);
        streamRunEvent(run, "tool_call", { stageId, ...payloadEvent });
      }
    }
    if (type === "tool_result") {
      const payloadEvent = normalizeToolEventPayload("tool_result", item);
      if (payloadEvent) {
        toolEvents.push(payloadEvent);
        streamRunEvent(run, "tool_result", { stageId, ...payloadEvent });
      }
    }
  }

  return {
    prompt: promptText,
    responseText: assistantText,
    result: finalResult,
    toolEvents,
    input: enrichedInputParts
  };
}

async function persistStageArtifacts(run, stageId, stageResult) {
  const stage = stageById(stageId);
  const artifactNames = stage?.defaultArtifactNames || [];
  const artifactsCreated = [];
  const text = String(stageResult?.responseText || "");
  const now = new Date().toISOString();

  if (stageId === "discovery") {
    let evidenceJson = extractJsonObjectFromText(text);
    const ddgFallback = [];
    if (!evidenceJson) {
      try {
        const query = run.topic;
        const results = await searchOnline(query);
        for (const item of results) {
          ddgFallback.push({
            sourceId: randomUUID(),
            title: item.title || "",
            url: item.url || "",
            snippet: item.snippet || "",
            snapshot: item.snippet || "",
            retrievedAt: now
          });
        }
      } catch {
        // ignore
      }
      evidenceJson = ddgFallback;
    }
    if (!Array.isArray(evidenceJson)) {
      evidenceJson = [evidenceJson].filter(Boolean);
    }

    run.evidence = sanitizeRunEvidence(evidenceJson);
    const evidenceArtifact = buildArtifact(run, {
      stageId,
      name: artifactNames[0] || "evidence.json",
      content: JSON.stringify(run.evidence, null, 2),
      type: "application/json"
    });
    const notesArtifact = buildArtifact(run, {
      stageId,
      name: artifactNames[1] || "reading_notes.md",
      content: text || "No reading notes generated."
    });
    artifactsCreated.push(evidenceArtifact, notesArtifact);
  } else if (stageId === "synthesis") {
    const claimsTable = extractJsonObjectFromText(text) || [];
    artifactsCreated.push(
      buildArtifact(run, {
        stageId,
        name: artifactNames[0] || "foundation_report.md",
        content: text || "No foundation report generated."
      }),
      buildArtifact(run, {
        stageId,
        name: artifactNames[1] || "claims_table.json",
        content: JSON.stringify(Array.isArray(claimsTable) ? claimsTable : [claimsTable], null, 2),
        type: "application/json"
      })
    );
  } else if (stageId === "draft") {
    artifactsCreated.push(
      buildArtifact(run, {
        stageId,
        name: artifactNames[0] || "draft_longform.md",
        content: text || "No draft generated."
      })
    );
  } else if (stageId === "adapt") {
    artifactsCreated.push(
      buildArtifact(run, {
        stageId,
        name: artifactNames[0] || "platform_pack.md",
        content: text || "No platform pack generated."
      })
    );
  } else if (stageId === "style") {
    artifactsCreated.push(
      buildArtifact(run, {
        stageId,
        name: artifactNames[0] || "platform_pack_styled.md",
        content: text || "No styled pack generated."
      })
    );
  } else if (stageId === "audit") {
    artifactsCreated.push(
      buildArtifact(run, {
        stageId,
        name: artifactNames[0] || "fact_audit.md",
        content: text || "No fact audit generated."
      }),
      buildArtifact(run, {
        stageId,
        name: artifactNames[1] || "final_pack.md",
        content: text || "No final pack generated."
      })
    );
  }

  const stageEntry = run.stageState[stageId];
  stageEntry.artifacts = artifactsCreated.map((artifact) => artifact.title);
  for (const artifact of artifactsCreated) {
    pushRunArtifact(run, artifact);
    streamRunEvent(run, "artifact_written", {
      stageId,
      artifact: {
        artifactId: artifact.artifactId,
        title: artifact.title,
        uri: artifact.uri,
        type: artifact.type
      }
    });
  }
}

async function runPipelineOrchestration(runId) {
  const run = findRun(runId);
  if (!run) {
    return;
  }
  const pipeline = findPipeline(run.pipelineId);
  if (!pipeline) {
    run.status = "failed";
    run.failedStage = "unknown";
    run.errorMessage = "Pipeline not found.";
    run.errorAt = new Date().toISOString();
    run.updatedAt = run.errorAt;
    await saveRunsAndBroadcast(run, "run_failed", {
      stageId: run.failedStage,
      error: run.errorMessage
    });
    closeRunStream(run.runId);
    return;
  }

  run.status = "running";
  run.updatedAt = new Date().toISOString();
  appendRunLog(run, "info", "Pipeline run started.");
  await saveRunsAndBroadcast(run, "run_started", {
    status: run.status,
    stageState: run.stageState
  });

  const stageList = pipeline.stages
    .filter((stage) => stage.enabled !== false)
    .sort((a, b) => a.order - b.order);

  try {
    for (const stage of stageList) {
      const stageId = stage.stageId;
      const agentId = pipeline.agentsByRole?.[stage.role];
      const agent = findAgent(agentId);
      if (!agent) {
        throw buildRequestError(400, `Stage ${stageId} references unknown agent: ${agentId || "none"}`);
      }

      setRunStageStatus(run, stageId, "running", { agentId });
      run.updatedAt = new Date().toISOString();
      appendRunLog(run, "info", `Stage started: ${stageId}`, { stageId });
      await saveRunsAndBroadcast(run, "stage_started", {
        stageId,
        agentId,
        stage: run.stageState[stageId]
      });

      const priorStageArtifacts = run.artifacts;
      const promptText = createPromptForStage({
        stageId,
        topic: run.topic,
        brandVoice: run.brandVoice,
        targetPlatforms: run.targetPlatforms,
        priorArtifacts: priorStageArtifacts
      });

      const stageResult = await executeLmStudioStage({
        run,
        pipeline,
        stageId,
        agent,
        promptText,
        allowSearchFallback: stageId === "discovery"
      });

      run.metrics = run.metrics || {};
      run.metrics.perStage = run.metrics.perStage || {};
      run.metrics.perStage[stageId] = sanitizeStats(stageResult.result?.stats) || null;
      setRunStageStatus(run, stageId, "completed", {
        stats: run.metrics.perStage[stageId],
        error: null
      });

      await persistStageArtifacts(run, stageId, stageResult);
      run.updatedAt = new Date().toISOString();
      appendRunLog(run, "info", `Stage completed: ${stageId}`, { stageId });
      await saveRunsAndBroadcast(run, "stage_completed", {
        stageId,
        stage: run.stageState[stageId]
      });
    }

    run.status = "completed";
    run.updatedAt = new Date().toISOString();
    run.failedStage = null;
    run.errorMessage = null;
    run.errorAt = null;
    appendRunLog(run, "info", "Pipeline run completed.");
    await saveRunsAndBroadcast(run, "run_completed", {
      status: run.status
    });
    closeRunStream(run.runId);
  } catch (error) {
    const activeStage =
      Object.values(run.stageState || {}).find((stageEntry) => stageEntry.status === "running")?.stageId || "unknown";
    setRunStageStatus(run, activeStage, "failed", {
      error: error.message || "Stage execution failed."
    });
    run.status = "failed";
    run.failedStage = activeStage;
    run.errorMessage = error.message || "Pipeline run failed.";
    run.errorAt = new Date().toISOString();
    run.updatedAt = run.errorAt;
    appendRunLog(run, "error", run.errorMessage, { stageId: activeStage });
    await saveRunsAndBroadcast(run, "run_failed", {
      stageId: activeStage,
      error: run.errorMessage
    });
    closeRunStream(run.runId);
  } finally {
    activePipelineRuns.delete(runId);
  }
}

function findAgent(agentId) {
  return agents.find((agent) => agent.id === agentId) || null;
}

function findPipeline(pipelineId) {
  return pipelines.find((pipeline) => pipeline.id === pipelineId) || null;
}

function findRun(runId) {
  return runs.find((run) => run.runId === runId) || null;
}

function ensurePipelineReadyForRun(pipeline) {
  if (!pipeline) {
    throw buildRequestError(404, "Pipeline not found.");
  }

  for (const stage of CANONICAL_PIPELINE_STAGES) {
    const mappedAgentId = pipeline.agentsByRole?.[stage.role];
    if (!mappedAgentId) {
      throw buildRequestError(400, `Pipeline missing agentsByRole.${stage.role}.`);
    }
    if (!findAgent(mappedAgentId)) {
      throw buildRequestError(400, `Pipeline stage ${stage.stageId} references unknown agent: ${mappedAgentId}`);
    }
  }
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    baseUrl: config.baseUrl,
    nativeApiBaseUrl: getNativeApiBaseUrl(),
    agentCount: agents.length,
    pipelineCount: pipelines.length,
    runCount: runs.length
  });
});

app.get("/api/config", (req, res) => {
  res.json(config);
});

app.put("/api/config", async (req, res, next) => {
  try {
    config.baseUrl = normalizeBaseUrl(req.body?.baseUrl);
    await saveConfig();
    res.json(config);
  } catch (error) {
    next(error);
  }
});

app.get("/api/models", async (req, res, next) => {
  try {
    try {
      const payload = await lmStudioJsonRequest({ endpoint: "/models", native: true });
      const models = Array.isArray(payload?.models)
        ? payload.models
            .filter((model) => model && typeof model === "object")
            .filter((model) => model.type === "llm" || !model.type)
            .map((model) => model.key || model.id)
            .filter(Boolean)
        : [];
      if (models.length || Array.isArray(payload?.models)) {
        res.json({ models });
        return;
      }
    } catch {
      // Fallback to OpenAI-compatible models endpoint.
    }

    const payload = await lmStudioJsonRequest({ endpoint: "/models", native: false });
    const models = Array.isArray(payload?.data) ? payload.data.map((item) => item.id).filter(Boolean) : [];
    res.json({ models });
  } catch (error) {
    next(error);
  }
});

app.get("/api/agents", (req, res) => {
  res.json(agents.map(agentToClient));
});

app.post("/api/mcp/test", async (req, res, next) => {
  try {
    const model = String(req.body?.model || "").trim();
    const systemPrompt = String(req.body?.systemPrompt || "").trim();
    const integrations = sanitizeIntegrations(req.body?.integrations);

    if (!model) {
      throw buildRequestError(400, "Model is required.");
    }
    if (!integrations.length) {
      throw buildRequestError(400, "At least one integration is required.");
    }

    const payload = {
      model,
      input:
        "MCP integration test. If MCP tools are available, briefly confirm and include any discovered tool names.",
      stream: false,
      store: false,
      temperature: 0,
      max_output_tokens: 160,
      integrations
    };
    if (systemPrompt) {
      payload.system_prompt = systemPrompt;
    }

    const result = await lmStudioJsonRequest({
      endpoint: "/chat",
      method: "POST",
      body: payload,
      native: true
    });

    const output = Array.isArray(result?.output) ? result.output : [];
    const toolSignalsDetected = output.some((item) => {
      const type = String(item?.type || "").trim().toLowerCase();
      return type === "tool_call" || type === "invalid_tool_call";
    });

    res.json({
      ok: true,
      toolSignalsDetected,
      outputTypes: summarizeOutputTypes(result)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/agents", async (req, res, next) => {
  try {
    const agentInput = sanitizeAgent(req.body);
    const now = new Date().toISOString();
    const agent = {
      id: randomUUID(),
      ...agentInput,
      chatHistory: [],
      lastResponseId: null,
      lastStats: null,
      createdAt: now,
      updatedAt: now
    };
    agents.push(agent);
    await saveAgents();
    res.status(201).json(agentToClient(agent));
  } catch (error) {
    next(error);
  }
});

app.put("/api/agents/:id", async (req, res, next) => {
  try {
    const index = agents.findIndex((agent) => agent.id === req.params.id);
    if (index === -1) {
      throw buildRequestError(404, "Agent not found.");
    }

    const updates = sanitizeAgent(req.body);
    const previous = agents[index];
    const updated = {
      ...previous,
      ...updates,
      lastResponseId: updates.store ? previous.lastResponseId : null,
      updatedAt: new Date().toISOString()
    };
    agents[index] = updated;
    await saveAgents();
    res.json(agentToClient(updated));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/agents/:id", async (req, res, next) => {
  try {
    const index = agents.findIndex((agent) => agent.id === req.params.id);
    if (index === -1) {
      throw buildRequestError(404, "Agent not found.");
    }

    agents.splice(index, 1);
    await saveAgents();
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/pipelines", (req, res) => {
  res.json(pipelines.map(pipelineToClient));
});

app.get("/api/pipelines/:id", (req, res, next) => {
  try {
    const pipeline = findPipeline(req.params.id);
    if (!pipeline) {
      throw buildRequestError(404, "Pipeline not found.");
    }
    res.json(pipelineToClient(pipeline));
  } catch (error) {
    next(error);
  }
});

app.post("/api/pipelines", async (req, res, next) => {
  try {
    const input = sanitizePipeline(req.body, { strict: true });
    const requestedId = sanitizeTrimmedString(req.body?.id, { maxLength: 120 });
    const now = new Date().toISOString();

    if (requestedId) {
      const index = pipelines.findIndex((pipeline) => pipeline.id === requestedId);
      if (index === -1) {
        throw buildRequestError(404, "Pipeline not found.");
      }
      const previous = pipelines[index];
      const updated = {
        ...previous,
        ...input,
        updatedAt: now
      };
      pipelines[index] = updated;
      await savePipelines();
      res.json(pipelineToClient(updated));
      return;
    }

    const created = {
      id: randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now
    };

    pipelines.push(created);
    await savePipelines();
    res.status(201).json(pipelineToClient(created));
  } catch (error) {
    next(error);
  }
});

app.put("/api/pipelines/:id", async (req, res, next) => {
  try {
    const index = pipelines.findIndex((pipeline) => pipeline.id === req.params.id);
    if (index === -1) {
      throw buildRequestError(404, "Pipeline not found.");
    }

    const updates = sanitizePipeline(req.body, { strict: true });
    const previous = pipelines[index];
    const updated = {
      ...previous,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    pipelines[index] = updated;
    await savePipelines();
    res.json(pipelineToClient(updated));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/pipelines/:id", async (req, res, next) => {
  try {
    const index = pipelines.findIndex((pipeline) => pipeline.id === req.params.id);
    if (index === -1) {
      throw buildRequestError(404, "Pipeline not found.");
    }

    pipelines.splice(index, 1);
    await savePipelines();
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/pipelines/:id/run", async (req, res, next) => {
  try {
    const pipeline = findPipeline(req.params.id);
    ensurePipelineReadyForRun(pipeline);

    const runInput = sanitizeRunCreate({
      ...req.body,
      pipelineId: pipeline.id
    });

    const now = new Date().toISOString();
    const run = {
      runId: randomUUID(),
      ...runInput,
      status: "queued",
      createdAt: now,
      updatedAt: now
    };

    runs.unshift(run);
    if (runs.length > RUNS_LIMIT) {
      runs = runs.slice(0, RUNS_LIMIT);
    }
    await saveRuns();

    if (!activePipelineRuns.has(run.runId)) {
      const execution = runPipelineOrchestration(run.runId).catch((error) => {
        const currentRun = findRun(run.runId);
        if (!currentRun) {
          return;
        }
        currentRun.status = "failed";
        currentRun.failedStage = currentRun.failedStage || "unknown";
        currentRun.errorMessage = error.message || "Pipeline orchestration failed.";
        currentRun.errorAt = new Date().toISOString();
        currentRun.updatedAt = currentRun.errorAt;
        appendRunLog(currentRun, "error", currentRun.errorMessage);
        saveRunsAndBroadcast(currentRun, "run_failed", {
          stageId: currentRun.failedStage,
          error: currentRun.errorMessage
        }).finally(() => closeRunStream(currentRun.runId));
      });
      activePipelineRuns.set(run.runId, execution);
    }

    res.status(202).json({ runId: run.runId });
  } catch (error) {
    next(error);
  }
});

app.get("/api/runs", (req, res, next) => {
  try {
    const pipelineId = sanitizeTrimmedString(req.query?.pipelineId, { maxLength: 120 });
    const statusQuery = sanitizeTrimmedString(req.query?.status, { maxLength: 240 });
    const limit = clamp(toInteger(req.query?.limit, 100), 1, 500);

    let list = [...runs];
    if (pipelineId) {
      list = list.filter((run) => run.pipelineId === pipelineId);
    }

    if (statusQuery) {
      const statuses = statusQuery
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);

      for (const status of statuses) {
        if (!RUN_STATUS_VALUES.has(status)) {
          throw buildRequestError(400, `Unsupported run status filter: ${status}`);
        }
      }
      list = list.filter((run) => statuses.includes(run.status));
    }

    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json(list.slice(0, limit).map(runToClient));
  } catch (error) {
    next(error);
  }
});

app.get("/api/runs/:runId", (req, res, next) => {
  try {
    const run = findRun(req.params.runId);
    if (!run) {
      throw buildRequestError(404, "Run not found.");
    }
    res.json(runToClient(run));
  } catch (error) {
    next(error);
  }
});

app.get("/api/runs/:runId/stream", (req, res, next) => {
  try {
    const run = findRun(req.params.runId);
    if (!run) {
      throw buildRequestError(404, "Run not found.");
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const isTerminal = run.status === "completed" || run.status === "failed" || run.status === "cancelled";
    if (isTerminal) {
      const terminalEvent = run.status === "completed" ? "run_completed" : "run_failed";
      writeSse(res, terminalEvent, {
        runId: run.runId,
        pipelineId: run.pipelineId,
        status: run.status,
        stageState: run.stageState,
        failedStage: run.failedStage,
        error: run.errorMessage
      });
      res.end();
      return;
    }

    const subscribers = getRunSubscribers(run.runId);
    subscribers.add(res);

    writeSse(res, "run_started", {
      runId: run.runId,
      pipelineId: run.pipelineId,
      status: run.status,
      stageState: run.stageState
    });

    const heartbeat = setInterval(() => {
      try {
        writeSse(res, "heartbeat", { runId: run.runId, at: new Date().toISOString() });
      } catch {
        // ignore write errors
      }
    }, RUN_STREAM_HEARTBEAT_MS);

    req.on("close", () => {
      clearInterval(heartbeat);
      subscribers.delete(res);
      if (!subscribers.size) {
        runStreamSubscribers.delete(run.runId);
      }
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/runs", async (req, res, next) => {
  try {
    const input = sanitizeRunCreate(req.body);
    const pipeline = findPipeline(input.pipelineId);
    const now = new Date().toISOString();
    const run = {
      runId: randomUUID(),
      ...input,
      outputs: input.outputs.length ? input.outputs : pipeline?.outputs || [],
      createdAt: now,
      updatedAt: now
    };

    runs.unshift(run);
    if (runs.length > RUNS_LIMIT) {
      runs = runs.slice(0, RUNS_LIMIT);
    }
    await saveRuns();
    res.status(201).json(runToClient(run));
  } catch (error) {
    next(error);
  }
});

app.put("/api/runs/:runId", async (req, res, next) => {
  try {
    const index = runs.findIndex((run) => run.runId === req.params.runId);
    if (index === -1) {
      throw buildRequestError(404, "Run not found.");
    }

    const previous = runs[index];
    const updates = sanitizeRunUpdate(req.body, previous);
    const updated = {
      ...previous,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    runs[index] = updated;
    await saveRuns();
    res.json(runToClient(updated));
  } catch (error) {
    next(error);
  }
});

app.post("/api/runs/:runId/logs", async (req, res, next) => {
  try {
    const run = findRun(req.params.runId);
    if (!run) {
      throw buildRequestError(404, "Run not found.");
    }

    const logs = sanitizeRunLogs([req.body]);
    if (!logs.length) {
      throw buildRequestError(400, "A non-empty log message is required.");
    }

    run.logs = [...run.logs, ...logs].slice(-5000);
    run.updatedAt = new Date().toISOString();
    await saveRuns();
    res.status(201).json(runToClient(run));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/runs/:runId", async (req, res, next) => {
  try {
    const index = runs.findIndex((run) => run.runId === req.params.runId);
    if (index === -1) {
      throw buildRequestError(404, "Run not found.");
    }

    runs.splice(index, 1);
    await saveRuns();
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/chat/:agentId/history", (req, res, next) => {
  try {
    const agent = findAgent(req.params.agentId);
    if (!agent) {
      throw buildRequestError(404, "Agent not found.");
    }
    res.json({
      history: agent.chatHistory || [],
      lastResponseId: agent.lastResponseId || null,
      lastStats: agent.lastStats || null
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/chat", async (req, res, next) => {
  try {
    const agentId = String(req.body?.agentId || "").trim();
    const reset = toBoolean(req.body?.reset, false);
    if (!agentId) {
      throw buildRequestError(400, "agentId is required.");
    }

    const agent = findAgent(agentId);
    if (!agent) {
      throw buildRequestError(404, "Agent not found.");
    }

    if (reset) {
      resetConversation(agent);
      await saveAgents();
    }

    const messageParts = normalizeMessageParts(req.body?.message, req.body?.messageParts);
    if (!messageParts.length) {
      res.json({ history: agent.chatHistory || [], lastResponseId: agent.lastResponseId || null });
      return;
    }

    const userHistoryItem = {
      role: "user",
      content: summarizeUserInput(messageParts)
    };
    const enrichedMessageParts = await enrichMessageWithSearch(agent, messageParts);
    const payload = buildChatRequest(agent, enrichedMessageParts, {
      stream: false,
      reset
    });
    const result = await lmStudioJsonRequest({
      endpoint: "/chat",
      method: "POST",
      body: payload,
      native: true
    });

    applyChatResult(agent, userHistoryItem, result);
    await saveAgents();

    res.json({
      history: agent.chatHistory,
      output: Array.isArray(result?.output) ? result.output : [],
      responseId: agent.lastResponseId || null,
      stats: agent.lastStats
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/chat/stream", async (req, res) => {
  let headersSent = false;

  try {
    const agentId = String(req.body?.agentId || "").trim();
    const reset = toBoolean(req.body?.reset, false);
    if (!agentId) {
      throw buildRequestError(400, "agentId is required.");
    }

    const agent = findAgent(agentId);
    if (!agent) {
      throw buildRequestError(404, "Agent not found.");
    }

    if (reset) {
      resetConversation(agent);
      await saveAgents();
    }

    const messageParts = normalizeMessageParts(req.body?.message, req.body?.messageParts);
    if (!messageParts.length) {
      throw buildRequestError(400, "A message or messageParts payload is required.");
    }

    const userHistoryItem = {
      role: "user",
      content: summarizeUserInput(messageParts)
    };

    const enrichedMessageParts = await enrichMessageWithSearch(agent, messageParts);
    const payload = buildChatRequest(agent, enrichedMessageParts, {
      stream: true,
      reset
    });
    payload.stream = true;

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    headersSent = true;

    const upstream = await lmStudioStreamRequest({
      endpoint: "/chat",
      body: payload
    });

    if (!upstream.ok) {
      const payloadError = await parseJsonResponse(upstream);
      const message =
        payloadError?.error?.message ||
        payloadError?.error ||
        payloadError?.message ||
        `LM Studio streaming request failed (${upstream.status}).`;
      writeSse(res, "error", { message });
      res.end();
      return;
    }

    if (!upstream.body) {
      writeSse(res, "error", { message: "No stream body returned by LM Studio." });
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult = null;
    let streamedAssistant = "";
    let streamedReasoning = "";

    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true });

      while (true) {
        const boundaryMatch = buffer.match(/\r?\n\r?\n/);
        if (!boundaryMatch || boundaryMatch.index === undefined) {
          break;
        }
        const boundaryIndex = boundaryMatch.index;
        const boundaryLength = boundaryMatch[0].length;

        const block = buffer.slice(0, boundaryIndex).trim();
        buffer = buffer.slice(boundaryIndex + boundaryLength);
        if (!block) {
          continue;
        }

        const parsed = parseSseBlock(block);
        if (!parsed) {
          continue;
        }

        const { event, data } = parsed;
        if (event === "chat.end" && data && typeof data === "object" && data.result) {
          finalResult = data.result;
        } else if (event === "message.delta" && data && typeof data === "object") {
          streamedAssistant += String(data.content || "");
        } else if (event === "reasoning.delta" && data && typeof data === "object") {
          streamedReasoning += String(data.content || "");
        }

        writeSse(res, event, data);
      }
    }

    if (!finalResult) {
      finalResult = {
        output: [
          ...(streamedReasoning ? [{ type: "reasoning", content: streamedReasoning }] : []),
          ...(streamedAssistant ? [{ type: "message", content: streamedAssistant }] : [])
        ],
        response_id: null,
        stats: null
      };
    }

    applyChatResult(agent, userHistoryItem, finalResult);
    await saveAgents();
    writeSse(res, "app.history", {
      history: agent.chatHistory,
      responseId: agent.lastResponseId || null,
      stats: agent.lastStats
    });
    res.end();
  } catch (error) {
    if (!headersSent) {
      res.status(Number(error.status) || 500).json({ error: error.message || "Internal server error." });
      return;
    }

    writeSse(res, "error", {
      message: error.message || "Internal server error."
    });
    res.end();
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.use((error, req, res, next) => {
  const status = Number(error.status) || 500;
  const message = error.message || "Internal server error.";
  if (status >= 500) {
    console.error(error);
  }
  res.status(status).json({ error: message });
});

async function start() {
  await ensureDataFiles();
  await loadConfig();
  await loadAgents();
  await loadPipelines();
  await loadRuns();

  app.listen(PORT, () => {
    console.log(`LM Studio Agent Builder running at http://localhost:${PORT}`);
  });
}

module.exports = {
  app,
  start,
  __serverInternals: {
    CANONICAL_PIPELINE_STAGES,
    sanitizePipeline,
    sanitizeRunCreate,
    sanitizeRunUpdate,
    buildInitialStageState,
    runToClient,
    pipelineToClient,
    ensurePipelineReadyForRun,
    setTestState(nextState = {}) {
      if (Array.isArray(nextState.agents)) {
        agents = nextState.agents;
      }
      if (Array.isArray(nextState.pipelines)) {
        pipelines = nextState.pipelines;
      }
      if (Array.isArray(nextState.runs)) {
        runs = nextState.runs;
      }
    },
    getTestState() {
      return { agents, pipelines, runs };
    }
  }
};

if (require.main === module) {
  start().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}
