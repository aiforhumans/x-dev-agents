const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";
const GROUP_STATE_PREFIX = "ui.agentForm.groupState.";
const LEFT_PANE_WIDTH_STORAGE_KEY = "ui.layout.leftPaneWidthPx";
const NEW_AGENT_GROUP_KEY = "__new__";
const MIN_LEFT_PANE_WIDTH = 360;
const MIN_RIGHT_PANE_WIDTH = 560;
const DESKTOP_BREAKPOINT = 1080;
const RESIZER_WIDTH = 12;
const NODE_GROUP_KEYS = ["identity", "model", "generation", "prompt", "mcp", "runtime"];
const DEFAULT_GROUP_STATE = {
  identity: true,
  model: true,
  generation: false,
  prompt: false,
  mcp: false,
  runtime: false
};

const state = {
  baseUrl: "",
  models: [],
  agents: [],
  selectedAgentId: null,
  chatHistory: [],
  isStreaming: false,
  leftPaneWidthPx: null
};

function queryAll(selector) {
  if (typeof document.querySelectorAll !== "function") {
    return [];
  }
  return Array.from(document.querySelectorAll(selector));
}

const elements = {
  layout: document.getElementById("layout"),
  agentsPanel: document.getElementById("agentsPanel"),
  chatPanel: document.getElementById("chatPanel"),
  layoutResizer: document.getElementById("layoutResizer"),
  baseUrlInput: document.getElementById("baseUrlInput"),
  saveBaseUrlBtn: document.getElementById("saveBaseUrlBtn"),
  testConnectionBtn: document.getElementById("testConnectionBtn"),
  agentList: document.getElementById("agentList"),
  newAgentBtn: document.getElementById("newAgentBtn"),
  agentForm: document.getElementById("agentForm"),
  agentId: document.getElementById("agentId"),
  agentName: document.getElementById("agentName"),
  agentDescription: document.getElementById("agentDescription"),
  agentModel: document.getElementById("agentModel"),
  refreshModelsBtn: document.getElementById("refreshModelsBtn"),
  agentTemperature: document.getElementById("agentTemperature"),
  agentTopP: document.getElementById("agentTopP"),
  agentTopK: document.getElementById("agentTopK"),
  agentMinP: document.getElementById("agentMinP"),
  agentRepeatPenalty: document.getElementById("agentRepeatPenalty"),
  agentMaxOutputTokens: document.getElementById("agentMaxOutputTokens"),
  agentContextLength: document.getElementById("agentContextLength"),
  agentReasoning: document.getElementById("agentReasoning"),
  agentSystemPrompt: document.getElementById("agentSystemPrompt"),
  agentMcpPlugins: document.getElementById("agentMcpPlugins"),
  agentEphemeralMcp: document.getElementById("agentEphemeralMcp"),
  agentIntegrations: document.getElementById("agentIntegrations"),
  mcpTestBtn: document.getElementById("mcpTestBtn"),
  agentStore: document.getElementById("agentStore"),
  agentStream: document.getElementById("agentStream"),
  agentWebSearch: document.getElementById("agentWebSearch"),
  deleteAgentBtn: document.getElementById("deleteAgentBtn"),
  chatTitle: document.getElementById("chatTitle"),
  chatLog: document.getElementById("chatLog"),
  chatForm: document.getElementById("chatForm"),
  chatAttachBtn: document.getElementById("chatAttachBtn"),
  chatMessage: document.getElementById("chatMessage"),
  chatImages: document.getElementById("chatImages"),
  chatAttachmentCount: document.getElementById("chatAttachmentCount"),
  resetChatBtn: document.getElementById("resetChatBtn"),
  statusBar: document.getElementById("statusBar"),
  nodeGroups: queryAll(".node-group[data-group]")
};

function setStatus(message, isError = false) {
  elements.statusBar.textContent = message;
  elements.statusBar.classList.toggle("error", isError);
}

function canUseLocalStorage() {
  return typeof localStorage !== "undefined" && localStorage !== null;
}

function getFromLocalStorage(key) {
  if (!canUseLocalStorage()) {
    return null;
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setToLocalStorage(key, value) {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage write failures.
  }
}

function isDesktopLayout() {
  if (typeof window === "undefined" || typeof window.innerWidth !== "number") {
    return true;
  }
  return window.innerWidth > DESKTOP_BREAKPOINT;
}

function getGroupStateStorageKey(agentId) {
  const normalizedAgentId = String(agentId || "").trim();
  return `${GROUP_STATE_PREFIX}${normalizedAgentId || NEW_AGENT_GROUP_KEY}`;
}

function getCurrentGroupStorageKey() {
  return getGroupStateStorageKey(state.selectedAgentId);
}

function sanitizeGroupState(rawState) {
  const sanitized = { ...DEFAULT_GROUP_STATE };
  if (!rawState || typeof rawState !== "object") {
    return sanitized;
  }

  for (const key of NODE_GROUP_KEYS) {
    if (rawState[key] === undefined) {
      continue;
    }
    sanitized[key] = Boolean(rawState[key]);
  }

  return sanitized;
}

function readStoredGroupState(storageKey) {
  const raw = getFromLocalStorage(storageKey);
  if (!raw) {
    return { ...DEFAULT_GROUP_STATE };
  }

  try {
    return sanitizeGroupState(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_GROUP_STATE };
  }
}

function getCurrentGroupStateFromUi() {
  const current = { ...DEFAULT_GROUP_STATE };
  for (const group of elements.nodeGroups) {
    const key = String(group?.dataset?.group || "").trim();
    if (!NODE_GROUP_KEYS.includes(key)) {
      continue;
    }
    current[key] = Boolean(group.open);
  }
  return current;
}

function applyGroupStateToUi(groupState) {
  const normalized = sanitizeGroupState(groupState);
  for (const group of elements.nodeGroups) {
    const key = String(group?.dataset?.group || "").trim();
    if (!NODE_GROUP_KEYS.includes(key)) {
      continue;
    }
    group.open = normalized[key] === true;
  }
}

function loadGroupStateForCurrentAgent() {
  applyGroupStateToUi(readStoredGroupState(getCurrentGroupStorageKey()));
}

function saveGroupStateForCurrentAgent() {
  const key = getCurrentGroupStorageKey();
  const stateFromUi = getCurrentGroupStateFromUi();
  setToLocalStorage(key, JSON.stringify(stateFromUi));
}

function clampPaneWidthPx(widthPx, containerWidth) {
  const minWidth = MIN_LEFT_PANE_WIDTH;
  const maxWidth = Math.max(minWidth, containerWidth - MIN_RIGHT_PANE_WIDTH - RESIZER_WIDTH);
  return Math.min(maxWidth, Math.max(minWidth, widthPx));
}

function getLayoutWidth() {
  if (!elements.layout || typeof elements.layout.getBoundingClientRect !== "function") {
    return 0;
  }
  return elements.layout.getBoundingClientRect().width || 0;
}

function applyLeftPaneWidth(widthPx) {
  if (!elements.layout || !elements.layout.style || typeof elements.layout.style.setProperty !== "function") {
    return;
  }
  elements.layout.style.setProperty("--left-pane-width", `${Math.round(widthPx)}px`);
  state.leftPaneWidthPx = Math.round(widthPx);
}

function loadLeftPaneWidth() {
  if (!isDesktopLayout()) {
    return;
  }
  const raw = Number(getFromLocalStorage(LEFT_PANE_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(raw)) {
    return;
  }

  const layoutWidth = getLayoutWidth();
  if (!layoutWidth) {
    return;
  }
  applyLeftPaneWidth(clampPaneWidthPx(raw, layoutWidth));
}

function saveLeftPaneWidth() {
  if (!Number.isFinite(state.leftPaneWidthPx)) {
    return;
  }
  setToLocalStorage(LEFT_PANE_WIDTH_STORAGE_KEY, String(Math.round(state.leftPaneWidthPx)));
}

function initializeResizableLayout() {
  if (!elements.layout || !elements.layoutResizer || typeof elements.layoutResizer.addEventListener !== "function") {
    return;
  }

  loadLeftPaneWidth();

  const stopDragging = () => {
    elements.layout.classList.remove("resizing");
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    }
    saveLeftPaneWidth();
  };

  const onPointerMove = (event) => {
    if (!isDesktopLayout()) {
      return;
    }
    const layoutWidth = getLayoutWidth();
    if (!layoutWidth || typeof elements.layout.getBoundingClientRect !== "function") {
      return;
    }

    const layoutRect = elements.layout.getBoundingClientRect();
    const nextWidth = clampPaneWidthPx(event.clientX - layoutRect.left, layoutWidth);
    applyLeftPaneWidth(nextWidth);
  };

  elements.layoutResizer.addEventListener("pointerdown", (event) => {
    if (!isDesktopLayout()) {
      return;
    }
    if (typeof event.preventDefault === "function") {
      event.preventDefault();
    }

    elements.layout.classList.add("resizing");
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", stopDragging);
      window.addEventListener("pointercancel", stopDragging);
    }
  });

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("resize", () => {
      if (!isDesktopLayout()) {
        return;
      }
      if (!Number.isFinite(state.leftPaneWidthPx)) {
        return;
      }
      const layoutWidth = getLayoutWidth();
      if (!layoutWidth) {
        return;
      }
      applyLeftPaneWidth(clampPaneWidthPx(state.leftPaneWidthPx, layoutWidth));
    });
  }
}

function bindNodeGroupPersistence() {
  for (const group of elements.nodeGroups) {
    if (!group || typeof group.addEventListener !== "function") {
      continue;
    }
    group.addEventListener("toggle", () => {
      saveGroupStateForCurrentAgent();
    });
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `Request failed (${response.status}).`);
  }
  return payload;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getSelectedAgent() {
  return state.agents.find((agent) => agent.id === state.selectedAgentId) || null;
}

function renderAgentList() {
  if (!state.agents.length) {
    elements.agentList.innerHTML = '<li class="agent-item empty">No agents yet.</li>';
    return;
  }

  const html = state.agents
    .map((agent) => {
      const selected = agent.id === state.selectedAgentId ? "selected" : "";
      return `<li class="agent-item ${selected}" data-id="${escapeHtml(agent.id)}">
        <strong>${escapeHtml(agent.name)}</strong>
        <small>${escapeHtml(agent.model)}</small>
      </li>`;
    })
    .join("");
  elements.agentList.innerHTML = html;
}

function renderModelOptions(selectedModel = "") {
  const options = state.models.length ? state.models : [selectedModel].filter(Boolean);

  if (!options.length) {
    elements.agentModel.innerHTML = '<option value="">No models found</option>';
    return;
  }

  elements.agentModel.innerHTML = options
    .map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`)
    .join("");

  const fallbackModel = options[0];
  elements.agentModel.value = options.includes(selectedModel) ? selectedModel : fallbackModel;
}

function toInputValue(value) {
  return value === null || value === undefined ? "" : String(value);
}

function resetAgentForm() {
  elements.agentId.value = "";
  elements.agentName.value = "";
  elements.agentDescription.value = "";
  elements.agentTemperature.value = "0.7";
  elements.agentTopP.value = "";
  elements.agentTopK.value = "";
  elements.agentMinP.value = "";
  elements.agentRepeatPenalty.value = "";
  elements.agentMaxOutputTokens.value = "";
  elements.agentContextLength.value = "";
  elements.agentReasoning.value = "";
  elements.agentSystemPrompt.value = DEFAULT_SYSTEM_PROMPT;
  elements.agentMcpPlugins.value = "";
  elements.agentEphemeralMcp.value = "";
  elements.agentIntegrations.value = "";
  elements.agentStore.checked = true;
  elements.agentStream.checked = true;
  elements.agentWebSearch.checked = false;
  renderModelOptions();
  elements.deleteAgentBtn.disabled = true;
}

function fillAgentForm(agent) {
  elements.agentId.value = agent.id;
  elements.agentName.value = agent.name || "";
  elements.agentDescription.value = agent.description || "";
  elements.agentTemperature.value = toInputValue(agent.temperature ?? "0.7");
  elements.agentTopP.value = toInputValue(agent.topP);
  elements.agentTopK.value = toInputValue(agent.topK);
  elements.agentMinP.value = toInputValue(agent.minP);
  elements.agentRepeatPenalty.value = toInputValue(agent.repeatPenalty);
  elements.agentMaxOutputTokens.value = toInputValue(agent.maxOutputTokens);
  elements.agentContextLength.value = toInputValue(agent.contextLength);
  elements.agentReasoning.value = agent.reasoning || "";
  elements.agentSystemPrompt.value = agent.systemPrompt || "";
  const integrations = splitIntegrationsForForm(agent.integrations);
  elements.agentMcpPlugins.value = integrations.mcpPluginIds.join("\n");
  elements.agentEphemeralMcp.value = integrations.ephemeralMcp.length
    ? JSON.stringify(integrations.ephemeralMcp, null, 2)
    : "";
  elements.agentIntegrations.value = integrations.extraIntegrations.length
    ? JSON.stringify(integrations.extraIntegrations, null, 2)
    : "";
  elements.agentStore.checked = agent.store !== false;
  elements.agentStream.checked = agent.stream !== false;
  elements.agentWebSearch.checked = agent.webSearch === true;
  renderModelOptions(agent.model || "");
  elements.deleteAgentBtn.disabled = false;
}

function formatStats(stats) {
  if (!stats || typeof stats !== "object") {
    return "";
  }

  const labels = [
    ["input_tokens", "in"],
    ["cached_input_tokens", "cached"],
    ["total_output_tokens", "out"],
    ["reasoning_output_tokens", "reasoning"],
    ["tokens_per_second", "tok/s"],
    ["time_to_first_token_seconds", "ttft"],
    ["generation_time_seconds", "gen"],
    ["model_load_time_seconds", "load"],
    ["stop_reason", "stop"]
  ];

  const parts = [];
  for (const [key, label] of labels) {
    if (stats[key] === null || stats[key] === undefined || stats[key] === "") {
      continue;
    }
    parts.push(`${label}: ${stats[key]}`);
  }
  return parts.join(" | ");
}

function renderMessage(item) {
  const role = String(item.role || "assistant").toLowerCase();
  const safeClass = role.replace(/[^a-z0-9_-]/g, "");
  const meta = role;
  const content = escapeHtml(item.content || "");
  const statsText = formatStats(item.stats);
  const extras = [];

  if (role === "tool_call") {
    const tool = item.tool ? `tool: ${escapeHtml(item.tool)}` : "";
    const args =
      item.arguments !== undefined && item.arguments !== null
        ? `args: ${escapeHtml(JSON.stringify(item.arguments))}`
        : "";
    const out =
      item.output !== undefined && item.output !== null
        ? `output: ${escapeHtml(JSON.stringify(item.output))}`
        : "";
    const providerInfo =
      item.providerInfo !== undefined && item.providerInfo !== null
        ? `provider_info: ${escapeHtml(JSON.stringify(item.providerInfo))}`
        : "";
    [tool, args, out, providerInfo].filter(Boolean).forEach((line) => extras.push(`<div>${line}</div>`));
  }

  if (item.responseId) {
    extras.push(`<div>response_id: ${escapeHtml(item.responseId)}</div>`);
  }

  return `<div class="message ${safeClass}">
    <div class="meta">${escapeHtml(meta)}</div>
    <pre>${content}</pre>
    ${extras.length ? `<div class="stats">${extras.join("")}</div>` : ""}
    ${statsText ? `<div class="stats">${escapeHtml(statsText)}</div>` : ""}
  </div>`;
}

function renderChat(history = [], { showTyping = false, streamPreview = "" } = {}) {
  state.chatHistory = Array.isArray(history) ? history : [];

  if (!state.chatHistory.length && !showTyping) {
    elements.chatLog.innerHTML = '<p class="empty-chat">No conversation yet.</p>';
    return;
  }

  const messagesHtml = state.chatHistory.map(renderMessage).join("");
  const typingMarkup = showTyping
    ? `<div class="message assistant typing-indicator">
      <div class="meta">assistant</div>
      <pre>${escapeHtml(streamPreview || "")}<span class="cursor-block" aria-hidden="true"></span></pre>
    </div>`
    : "";

  elements.chatLog.innerHTML = `${messagesHtml}${typingMarkup}`;
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function updateAttachmentCount() {
  if (!elements.chatAttachmentCount) {
    return;
  }
  const count = Array.from(elements.chatImages?.files || []).length;
  if (!count) {
    elements.chatAttachmentCount.textContent = "";
    return;
  }
  elements.chatAttachmentCount.textContent = count === 1 ? "1 image attached" : `${count} images attached`;
}

function autoResizeChatMessage() {
  if (!elements.chatMessage || !elements.chatMessage.style) {
    return;
  }
  elements.chatMessage.style.height = "auto";
  const next = Math.min(180, Math.max(44, elements.chatMessage.scrollHeight || 44));
  elements.chatMessage.style.height = `${next}px`;
}

function parseOptionalNumber(value, { integer = false } = {}) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  const num = integer ? Number.parseInt(text, 10) : Number(text);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid numeric value: ${value}`);
  }
  return num;
}

function parseIntegrations(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error("Integrations JSON must be an array.");
    }
    return parsed;
  } catch (error) {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      throw error;
    }
    return lines;
  }
}

function parseMcpPluginIds(raw) {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const unique = new Set();
  for (const id of lines) {
    if (!id.startsWith("mcp/")) {
      throw new Error(`MCP plugin id must start with "mcp/": ${id}`);
    }
    unique.add(id);
  }

  return [...unique];
}

function normalizeAllowedTools(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  let tools = value;
  if (typeof tools === "string") {
    tools = tools
      .split(",")
      .map((tool) => tool.trim())
      .filter(Boolean);
  }

  if (!Array.isArray(tools)) {
    throw new Error("allowed_tools must be an array or comma-separated string.");
  }

  const normalized = tools.map((tool) => String(tool || "").trim()).filter(Boolean);
  return normalized.length ? normalized : null;
}

function parseEphemeralMcpIntegrations(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return [];
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Ephemeral MCP servers must be a valid JSON array.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Ephemeral MCP servers must be a JSON array.");
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Ephemeral MCP entry #${index + 1} must be an object.`);
    }

    const type = String(entry.type || "ephemeral_mcp").trim().toLowerCase();
    if (type !== "ephemeral_mcp") {
      throw new Error(`Ephemeral MCP entry #${index + 1} has unsupported type: ${type}.`);
    }

    const serverLabel = String(entry.server_label || entry.serverLabel || "").trim();
    const serverUrl = String(entry.server_url || entry.serverUrl || "").trim();
    if (!serverLabel || !serverUrl) {
      throw new Error(`Ephemeral MCP entry #${index + 1} requires server_label and server_url.`);
    }

    const normalized = {
      type: "ephemeral_mcp",
      server_label: serverLabel,
      server_url: serverUrl
    };

    if (entry.headers !== undefined) {
      if (!entry.headers || typeof entry.headers !== "object" || Array.isArray(entry.headers)) {
        throw new Error(`Ephemeral MCP entry #${index + 1} headers must be an object.`);
      }
      normalized.headers = entry.headers;
    }

    const allowedTools = normalizeAllowedTools(entry.allowed_tools ?? entry.allowedTools);
    if (allowedTools) {
      normalized.allowed_tools = allowedTools;
    }

    return normalized;
  });
}

function splitIntegrationsForForm(rawIntegrations) {
  const result = {
    mcpPluginIds: [],
    ephemeralMcp: [],
    extraIntegrations: []
  };

  if (!Array.isArray(rawIntegrations)) {
    return result;
  }

  const pluginIds = new Set();
  for (const integration of rawIntegrations) {
    if (typeof integration === "string") {
      if (integration.startsWith("mcp/")) {
        pluginIds.add(integration);
      } else {
        result.extraIntegrations.push(integration);
      }
      continue;
    }

    if (!integration || typeof integration !== "object") {
      continue;
    }

    const type = String(integration.type || "").trim().toLowerCase();
    if (type === "ephemeral_mcp") {
      result.ephemeralMcp.push({
        type: "ephemeral_mcp",
        server_label: integration.server_label || integration.serverLabel || "",
        server_url: integration.server_url || integration.serverUrl || "",
        ...(integration.headers ? { headers: integration.headers } : {}),
        ...(Array.isArray(integration.allowed_tools) && integration.allowed_tools.length
          ? { allowed_tools: integration.allowed_tools }
          : {})
      });
      continue;
    }

    if (
      type === "plugin" &&
      typeof integration.id === "string" &&
      integration.id.startsWith("mcp/") &&
      !Array.isArray(integration.allowed_tools)
    ) {
      pluginIds.add(integration.id);
      continue;
    }

    result.extraIntegrations.push(integration);
  }

  result.mcpPluginIds = [...pluginIds];
  return result;
}

function collectAgentForm() {
  const temperatureRaw = elements.agentTemperature.value.trim();
  const temperature = temperatureRaw ? Number(temperatureRaw) : 0.7;
  if (!Number.isFinite(temperature)) {
    throw new Error("Temperature must be a valid number.");
  }

  const mcpPluginIds = parseMcpPluginIds(elements.agentMcpPlugins.value);
  const ephemeralMcpIntegrations = parseEphemeralMcpIntegrations(elements.agentEphemeralMcp.value);
  const extraIntegrations = parseIntegrations(elements.agentIntegrations.value);
  const integrations = [...mcpPluginIds, ...ephemeralMcpIntegrations, ...extraIntegrations];

  return {
    name: elements.agentName.value.trim(),
    description: elements.agentDescription.value.trim(),
    model: elements.agentModel.value.trim(),
    temperature,
    topP: parseOptionalNumber(elements.agentTopP.value),
    topK: parseOptionalNumber(elements.agentTopK.value, { integer: true }),
    minP: parseOptionalNumber(elements.agentMinP.value),
    repeatPenalty: parseOptionalNumber(elements.agentRepeatPenalty.value),
    maxOutputTokens: parseOptionalNumber(elements.agentMaxOutputTokens.value, { integer: true }),
    contextLength: parseOptionalNumber(elements.agentContextLength.value, { integer: true }),
    reasoning: elements.agentReasoning.value || null,
    systemPrompt: elements.agentSystemPrompt.value.trim(),
    integrations,
    store: elements.agentStore.checked,
    stream: elements.agentStream.checked,
    webSearch: elements.agentWebSearch.checked
  };
}

function summarizeOutputTypes(outputTypes) {
  if (!outputTypes || typeof outputTypes !== "object") {
    return "none";
  }
  const entries = Object.entries(outputTypes).filter(([, count]) => Number(count) > 0);
  if (!entries.length) {
    return "none";
  }
  return entries.map(([type, count]) => `${type}:${count}`).join(", ");
}

async function loadConfig() {
  const payload = await api("/api/config");
  state.baseUrl = payload.baseUrl;
  elements.baseUrlInput.value = payload.baseUrl;
}

async function loadModels() {
  const payload = await api("/api/models");
  state.models = Array.isArray(payload.models) ? payload.models : [];
  const selected = getSelectedAgent();
  renderModelOptions(selected?.model || "");
}

async function loadAgents() {
  const payload = await api("/api/agents");
  state.agents = Array.isArray(payload) ? payload : [];
  if (!state.selectedAgentId && state.agents.length) {
    state.selectedAgentId = state.agents[0].id;
  } else if (!state.agents.some((agent) => agent.id === state.selectedAgentId)) {
    state.selectedAgentId = null;
  }
  renderAgentList();
}

async function loadHistory() {
  if (!state.selectedAgentId) {
    elements.chatTitle.textContent = "Agent Chat";
    renderChat([]);
    return;
  }

  const agent = getSelectedAgent();
  elements.chatTitle.textContent = `Chat: ${agent?.name || "Unknown Agent"}`;
  const payload = await api(`/api/chat/${state.selectedAgentId}/history`);
  renderChat(payload.history || []);
}

async function onAgentSelected(id) {
  state.selectedAgentId = id;
  renderAgentList();
  const agent = getSelectedAgent();
  if (agent) {
    fillAgentForm(agent);
    loadGroupStateForCurrentAgent();
    await loadHistory();
  }
}

function buildUserPreview(text, imageCount) {
  const trimmed = text.trim();
  if (!trimmed && imageCount > 0) {
    return `[Image input: ${imageCount}]`;
  }
  if (trimmed && imageCount > 0) {
    return `${trimmed}\n[Images attached: ${imageCount}]`;
  }
  return trimmed;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Failed to read image: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function buildMessageParts(text, files) {
  const parts = [];
  const trimmed = text.trim();
  if (trimmed) {
    parts.push({ type: "message", content: trimmed });
  }
  for (const file of files) {
    const dataUrl = await fileToDataUrl(file);
    if (dataUrl.startsWith("data:image/")) {
      parts.push({ type: "image", data_url: dataUrl });
    }
  }
  return parts;
}

async function* streamSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const boundaryMatch = buffer.match(/\r?\n\r?\n/);
      if (!boundaryMatch || boundaryMatch.index === undefined) break;
      const boundary = boundaryMatch.index;
      const boundaryLength = boundaryMatch[0].length;
      const block = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + boundaryLength);
      if (!block) continue;

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

      if (!dataLines.length) continue;
      const raw = dataLines.join("\n");
      let data = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }

      yield { event, data };
    }
  }
}

async function sendChatNonStreaming(agentId, message, messageParts, optimisticHistory, previousHistory) {
  try {
    const payload = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId,
        message,
        messageParts
      })
    });
    renderChat(payload.history || optimisticHistory);
    setStatus("Response received.");
  } catch (error) {
    renderChat(previousHistory);
    elements.chatMessage.value = message;
    autoResizeChatMessage();
    setStatus(error.message, true);
  }
}

async function sendChatStreaming(agentId, message, messageParts, optimisticHistory, previousHistory) {
  let assistantPreview = "";
  let finalHistory = null;

  try {
    state.isStreaming = true;
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agentId,
        message,
        messageParts
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Streaming request failed (${response.status}).`);
    }
    if (!response.body) {
      throw new Error("Streaming response body unavailable.");
    }

    for await (const event of streamSse(response.body)) {
      if (event.event === "error") {
        const messageText =
          typeof event.data === "string" ? event.data : event.data?.message || "Streaming failed.";
        throw new Error(messageText);
      }

      if (event.event === "message.delta" && event.data && typeof event.data === "object") {
        assistantPreview += String(event.data.content || "");
        renderChat(optimisticHistory, {
          showTyping: true,
          streamPreview: assistantPreview
        });
      }

      if (event.event === "app.history" && event.data && typeof event.data === "object") {
        finalHistory = Array.isArray(event.data.history) ? event.data.history : null;
      }
    }

    if (finalHistory) {
      renderChat(finalHistory);
    } else {
      await loadHistory();
    }
    setStatus("Stream completed.");
  } catch (error) {
    renderChat(previousHistory);
    elements.chatMessage.value = message;
    autoResizeChatMessage();
    setStatus(error.message, true);
  } finally {
    state.isStreaming = false;
  }
}

async function initialize() {
  elements.deleteAgentBtn.disabled = true;
  initializeResizableLayout();
  bindNodeGroupPersistence();
  bindEvents();
  updateAttachmentCount();
  autoResizeChatMessage();

  try {
    await loadConfig();
  } catch (error) {
    setStatus(error.message, true);
    return;
  }

  let modelLoadError = null;
  try {
    await loadModels();
  } catch (error) {
    modelLoadError = error;
    state.models = [];
    renderModelOptions();
  }

  try {
    await loadAgents();
    const selected = getSelectedAgent();
    if (selected) {
      fillAgentForm(selected);
      loadGroupStateForCurrentAgent();
      await loadHistory();
    } else {
      resetAgentForm();
      loadGroupStateForCurrentAgent();
      renderChat([]);
    }
  } catch (error) {
    setStatus(error.message, true);
    return;
  }

  if (modelLoadError) {
    setStatus(`Agents loaded. Model list unavailable: ${modelLoadError.message}`, true);
  } else {
    setStatus("Loaded.");
  }
}

function bindEvents() {
  elements.chatAttachBtn.addEventListener("click", () => {
    if (elements.chatImages && typeof elements.chatImages.click === "function") {
      elements.chatImages.click();
    }
  });

  elements.chatImages.addEventListener("change", () => {
    updateAttachmentCount();
  });

  elements.chatMessage.addEventListener("input", () => {
    autoResizeChatMessage();
  });

  elements.agentList.addEventListener("click", async (event) => {
    const item = event.target.closest("[data-id]");
    if (!item) return;
    try {
      await onAgentSelected(item.dataset.id);
      setStatus("Agent selected.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  elements.newAgentBtn.addEventListener("click", () => {
    state.selectedAgentId = null;
    renderAgentList();
    resetAgentForm();
    loadGroupStateForCurrentAgent();
    renderChat([]);
    setStatus("Creating new agent.");
  });

  elements.refreshModelsBtn.addEventListener("click", async () => {
    try {
      await loadModels();
      setStatus(`Loaded ${state.models.length} model(s) from LM Studio.`);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  elements.saveBaseUrlBtn.addEventListener("click", async () => {
    try {
      const payload = await api("/api/config", {
        method: "PUT",
        body: JSON.stringify({ baseUrl: elements.baseUrlInput.value })
      });
      state.baseUrl = payload.baseUrl;
      elements.baseUrlInput.value = payload.baseUrl;
      await loadModels();
      setStatus("Base URL saved.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  elements.testConnectionBtn.addEventListener("click", async () => {
    try {
      const payload = await api("/api/models");
      setStatus(`Connection ok. ${payload.models.length} model(s) available.`);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  elements.agentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const agentId = elements.agentId.value.trim();
      const payload = collectAgentForm();
      const endpoint = agentId ? `/api/agents/${agentId}` : "/api/agents";
      const method = agentId ? "PUT" : "POST";
      const savedAgent = await api(endpoint, {
        method,
        body: JSON.stringify(payload)
      });

      await loadAgents();
      state.selectedAgentId = savedAgent.id;
      renderAgentList();
      fillAgentForm(savedAgent);
      loadGroupStateForCurrentAgent();
      await loadHistory();
      setStatus(agentId ? "Agent updated." : "Agent created.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  elements.deleteAgentBtn.addEventListener("click", async () => {
    const id = elements.agentId.value.trim();
    if (!id) return;

    const confirmed = window.confirm("Delete this agent?");
    if (!confirmed) return;

    try {
      await api(`/api/agents/${id}`, { method: "DELETE" });
      state.selectedAgentId = null;
      await loadAgents();

      const selected = getSelectedAgent();
      if (selected) {
        fillAgentForm(selected);
        loadGroupStateForCurrentAgent();
        await loadHistory();
      } else {
        resetAgentForm();
        loadGroupStateForCurrentAgent();
        renderChat([]);
      }
      setStatus("Agent deleted.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  elements.mcpTestBtn.addEventListener("click", async () => {
    const originalText = elements.mcpTestBtn.textContent;
    elements.mcpTestBtn.disabled = true;
    elements.mcpTestBtn.textContent = "Testing...";

    try {
      const payload = collectAgentForm();
      if (!payload.model) {
        throw new Error("Select a model before testing MCP.");
      }
      if (!Array.isArray(payload.integrations) || !payload.integrations.length) {
        throw new Error("Add at least one MCP integration before testing.");
      }

      const result = await api("/api/mcp/test", {
        method: "POST",
        body: JSON.stringify({
          model: payload.model,
          systemPrompt: payload.systemPrompt,
          integrations: payload.integrations
        })
      });

      const toolSignal = result.toolSignalsDetected ? "tool signal detected" : "no tool signal";
      const outputTypes = summarizeOutputTypes(result.outputTypes);
      setStatus(`MCP test passed (${toolSignal}; output: ${outputTypes}).`);
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      elements.mcpTestBtn.disabled = false;
      elements.mcpTestBtn.textContent = originalText;
    }
  });

  elements.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.isStreaming) {
      setStatus("Wait for the current stream to finish.", true);
      return;
    }

    const previousHistory = [...state.chatHistory];
    const message = elements.chatMessage.value.trim();
    const files = Array.from(elements.chatImages.files || []);

    try {
      if (!state.selectedAgentId) {
        throw new Error("Select or create an agent first.");
      }
      if (!message && !files.length) {
        return;
      }

      const messageParts = await buildMessageParts(message, files);
      if (!messageParts.length) {
        throw new Error("Message payload is empty.");
      }

      const optimisticHistory = [...previousHistory, { role: "user", content: buildUserPreview(message, files.length) }];
      renderChat(optimisticHistory, { showTyping: true });
      elements.chatMessage.value = "";
      elements.chatImages.value = "";
      updateAttachmentCount();
      autoResizeChatMessage();

      const selected = getSelectedAgent();
      if (selected?.stream) {
        await sendChatStreaming(state.selectedAgentId, message, messageParts, optimisticHistory, previousHistory);
      } else {
        await sendChatNonStreaming(state.selectedAgentId, message, messageParts, optimisticHistory, previousHistory);
      }
    } catch (error) {
      renderChat(previousHistory);
      elements.chatMessage.value = message;
      autoResizeChatMessage();
      setStatus(error.message, true);
    }
  });

  elements.resetChatBtn.addEventListener("click", async () => {
    try {
      if (!state.selectedAgentId) {
        throw new Error("Select an agent first.");
      }
      const payload = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          agentId: state.selectedAgentId,
          reset: true
        })
      });
      renderChat(payload.history || []);
      setStatus("Conversation reset.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

if (typeof globalThis !== "undefined") {
  globalThis.__appInternals = {
    DEFAULT_GROUP_STATE: { ...DEFAULT_GROUP_STATE },
    getGroupStateStorageKey,
    sanitizeGroupState,
    clampPaneWidthPx
  };
}

initialize();
