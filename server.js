const express = require("express");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(process.cwd(), "data");
const AGENTS_FILE = path.join(DATA_DIR, "agents.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

const DEFAULT_BASE_URL = process.env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1";
const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";
const HISTORY_LIMIT = 200;

let agents = [];
let config = { baseUrl: DEFAULT_BASE_URL };

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

async function saveConfig() {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

async function saveAgents() {
  await fs.writeFile(AGENTS_FILE, JSON.stringify(agents, null, 2) + "\n", "utf-8");
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
    integrations: agent.integrations,
    lastResponseId: agent.lastResponseId,
    lastStats: agent.lastStats,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt
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
        output: outputItem.output ?? null
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

function findAgent(agentId) {
  return agents.find((agent) => agent.id === agentId) || null;
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    baseUrl: config.baseUrl,
    nativeApiBaseUrl: getNativeApiBaseUrl(),
    agentCount: agents.length
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
    const payload = buildChatRequest(agent, messageParts, {
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

    const payload = buildChatRequest(agent, messageParts, {
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

  app.listen(PORT, () => {
    console.log(`LM Studio Agent Builder running at http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
