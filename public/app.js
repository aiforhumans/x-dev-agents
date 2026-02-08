const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";
const APP_CLIENT = typeof globalThis !== "undefined" ? globalThis.AppClient || {} : {};
const CREATE_AGENT_GROUP_STATE_FEATURE = APP_CLIENT.features?.createAgentGroupStateFeature;
const CREATE_CHAT_UI_FEATURE = APP_CLIENT.features?.createChatUiFeature;
const STREAM_SSE_FEATURE = APP_CLIENT.features?.streamSse;
const GROUP_STATE_PREFIX = APP_CLIENT.uiKeys?.agentFormGroupStatePrefix || "ui.agentForm.groupState.";
const LEFT_PANE_WIDTH_STORAGE_KEY = APP_CLIENT.uiKeys?.leftPaneWidthPx || "ui.layout.leftPaneWidthPx";
const NEW_AGENT_GROUP_KEY = APP_CLIENT.uiKeys?.newAgentGroupStateId || "__new__";
const MIN_LEFT_PANE_WIDTH = 360;
const MIN_RIGHT_PANE_WIDTH = 560;
const DESKTOP_BREAKPOINT = 1080;
const SMALL_SCREEN_BREAKPOINT = 760;
const RESIZER_WIDTH = 12;
const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const STORAGE_WRITE_DEBOUNCE_MS = 120;
const NODE_GROUP_KEYS = ["basics", "model", "sampling", "output", "runtime", "webSearch", "mcp", "diagnostics"];
const GROUP_ROLE_KEYS = ["discovery", "synthesis", "draft", "adapt", "style", "audit"];
const DEFAULT_GROUP_STATE = {
  basics: true,
  model: true,
  sampling: false,
  output: false,
  runtime: false,
  webSearch: false,
  mcp: false,
  diagnostics: false
};

const state = {
  baseUrl: "",
  models: [],
  agents: [],
  agentGroups: [],
  selectedAgentId: null,
  selectedAgentGroupId: null,
  chatHistory: [],
  isStreaming: false,
  leftPaneWidthPx: null,
  pendingImages: [],
  attachmentPreviewUrls: [],
  shouldStickToBottom: true
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
  agentGroupList: document.getElementById("agentGroupList"),
  agentGroupForm: document.getElementById("agentGroupForm"),
  agentGroupId: document.getElementById("agentGroupId"),
  agentGroupName: document.getElementById("agentGroupName"),
  agentGroupDescription: document.getElementById("agentGroupDescription"),
  groupRoleDiscovery: document.getElementById("groupRoleDiscovery"),
  groupRoleSynthesis: document.getElementById("groupRoleSynthesis"),
  groupRoleDraft: document.getElementById("groupRoleDraft"),
  groupRoleAdapt: document.getElementById("groupRoleAdapt"),
  groupRoleStyle: document.getElementById("groupRoleStyle"),
  groupRoleAudit: document.getElementById("groupRoleAudit"),
  groupRunTopic: document.getElementById("groupRunTopic"),
  newAgentGroupBtn: document.getElementById("newAgentGroupBtn"),
  saveAgentGroupBtn: document.getElementById("saveAgentGroupBtn"),
  runAgentGroupBtn: document.getElementById("runAgentGroupBtn"),
  deleteAgentGroupBtn: document.getElementById("deleteAgentGroupBtn"),
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
  chatAttachmentPreview: document.getElementById("chatAttachmentPreview"),
  chatAttachmentCount: document.getElementById("chatAttachmentCount"),
  scrollToBottomBtn: document.getElementById("scrollToBottomBtn"),
  resetChatBtn: document.getElementById("resetChatBtn"),
  agentLastStats: document.getElementById("agentLastStats"),
  statusBar: document.getElementById("statusBar"),
  nodeGroups: queryAll(".node-group[data-group]")
};

const agentGroupStateFeature =
  typeof CREATE_AGENT_GROUP_STATE_FEATURE === "function"
    ? CREATE_AGENT_GROUP_STATE_FEATURE({
        state,
        elements,
        groupStatePrefix: GROUP_STATE_PREFIX,
        newAgentGroupKey: NEW_AGENT_GROUP_KEY,
        defaultGroupState: DEFAULT_GROUP_STATE,
        nodeGroupKeys: NODE_GROUP_KEYS,
        getFromLocalStorage,
        setToLocalStorage,
        scheduleLocalStorageWrite
      })
    : null;

const chatUiFeature =
  typeof CREATE_CHAT_UI_FEATURE === "function"
    ? CREATE_CHAT_UI_FEATURE({
        state,
        elements,
        setStatus,
        escapeHtml,
        maxImageAttachmentBytes: MAX_IMAGE_ATTACHMENT_BYTES
      })
    : null;

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

const pendingStorageWrites = new Map();

function scheduleLocalStorageWrite(key, value, delayMs = STORAGE_WRITE_DEBOUNCE_MS) {
  const existing = pendingStorageWrites.get(key);
  if (existing) {
    clearTimeout(existing);
  }
  const handle = setTimeout(() => {
    pendingStorageWrites.delete(key);
    setToLocalStorage(key, value);
  }, delayMs);
  pendingStorageWrites.set(key, handle);
}

function isDesktopLayout() {
  if (typeof window === "undefined" || typeof window.innerWidth !== "number") {
    return true;
  }
  return window.innerWidth > DESKTOP_BREAKPOINT;
}

function getGroupStateStorageKey(agentId) {
  if (agentGroupStateFeature && typeof agentGroupStateFeature.getGroupStateStorageKey === "function") {
    return agentGroupStateFeature.getGroupStateStorageKey(agentId);
  }
  const normalizedAgentId = String(agentId || "").trim();
  return `${GROUP_STATE_PREFIX}${normalizedAgentId || NEW_AGENT_GROUP_KEY}`;
}

function getCurrentGroupStorageKey() {
  return getGroupStateStorageKey(state.selectedAgentId);
}

function sanitizeGroupState(rawState) {
  if (agentGroupStateFeature && typeof agentGroupStateFeature.sanitizeGroupState === "function") {
    return agentGroupStateFeature.sanitizeGroupState(rawState);
  }
  const sanitized = { ...DEFAULT_GROUP_STATE };
  if (!rawState || typeof rawState !== "object") {
    return sanitized;
  }

  // Backward compatibility for older persisted group keys.
  if (rawState.identity !== undefined) {
    sanitized.basics = Boolean(rawState.identity);
  }
  if (rawState.generation !== undefined) {
    const generationOpen = Boolean(rawState.generation);
    sanitized.sampling = generationOpen;
    sanitized.output = generationOpen;
  }
  if (rawState.prompt !== undefined) {
    sanitized.basics = Boolean(rawState.prompt);
  }
  if (rawState.runtime !== undefined) {
    const runtimeOpen = Boolean(rawState.runtime);
    sanitized.runtime = runtimeOpen;
    sanitized.webSearch = runtimeOpen;
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
  if (agentGroupStateFeature && typeof agentGroupStateFeature.loadGroupStateForCurrentAgent === "function") {
    agentGroupStateFeature.loadGroupStateForCurrentAgent();
    return;
  }
  applyGroupStateToUi(readStoredGroupState(getCurrentGroupStorageKey()));
}

function saveGroupStateForCurrentAgent() {
  if (agentGroupStateFeature && typeof agentGroupStateFeature.saveGroupStateForCurrentAgent === "function") {
    agentGroupStateFeature.saveGroupStateForCurrentAgent();
    return;
  }
  const key = getCurrentGroupStorageKey();
  const stateFromUi = getCurrentGroupStateFromUi();
  scheduleLocalStorageWrite(key, JSON.stringify(stateFromUi));
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

function updateResizerAria(layoutWidth) {
  if (!elements.layoutResizer || typeof elements.layoutResizer.setAttribute !== "function") {
    return;
  }
  const maxWidth = Math.max(MIN_LEFT_PANE_WIDTH, layoutWidth - MIN_RIGHT_PANE_WIDTH - RESIZER_WIDTH);
  elements.layoutResizer.setAttribute("aria-valuemin", String(MIN_LEFT_PANE_WIDTH));
  elements.layoutResizer.setAttribute("aria-valuemax", String(Math.round(maxWidth)));
  if (Number.isFinite(state.leftPaneWidthPx)) {
    elements.layoutResizer.setAttribute("aria-valuenow", String(Math.round(state.leftPaneWidthPx)));
  }
}

function applyLeftPaneWidth(widthPx) {
  if (!elements.layout || !elements.layout.style || typeof elements.layout.style.setProperty !== "function") {
    return;
  }
  elements.layout.style.setProperty("--left-pane-width", `${Math.round(widthPx)}px`);
  state.leftPaneWidthPx = Math.round(widthPx);
  const layoutWidth = getLayoutWidth();
  if (layoutWidth) {
    updateResizerAria(layoutWidth);
  }
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
  scheduleLocalStorageWrite(LEFT_PANE_WIDTH_STORAGE_KEY, String(Math.round(state.leftPaneWidthPx)));
}

function initializeResizableLayout() {
  if (!elements.layout || !elements.layoutResizer || typeof elements.layoutResizer.addEventListener !== "function") {
    return;
  }

  loadLeftPaneWidth();
  const initialLayoutWidth = getLayoutWidth();
  if (initialLayoutWidth) {
    updateResizerAria(initialLayoutWidth);
  }

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

  elements.layoutResizer.addEventListener("keydown", (event) => {
    if (!isDesktopLayout()) {
      return;
    }
    const layoutWidth = getLayoutWidth();
    if (!layoutWidth) {
      return;
    }

    const currentWidth = Number.isFinite(state.leftPaneWidthPx)
      ? state.leftPaneWidthPx
      : clampPaneWidthPx(Math.round(layoutWidth * 0.35), layoutWidth);
    const fineStep = 24;
    const coarseStep = 96;
    let nextWidth = currentWidth;

    if (event.key === "ArrowLeft") {
      nextWidth = currentWidth - (event.shiftKey ? coarseStep : fineStep);
    } else if (event.key === "ArrowRight") {
      nextWidth = currentWidth + (event.shiftKey ? coarseStep : fineStep);
    } else if (event.key === "Home") {
      nextWidth = MIN_LEFT_PANE_WIDTH;
    } else if (event.key === "End") {
      nextWidth = layoutWidth - MIN_RIGHT_PANE_WIDTH - RESIZER_WIDTH;
    } else {
      return;
    }

    if (typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    applyLeftPaneWidth(clampPaneWidthPx(nextWidth, layoutWidth));
    saveLeftPaneWidth();
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
      updateResizerAria(layoutWidth);
    });
  }
}

function bindNodeGroupPersistence() {
  if (agentGroupStateFeature && typeof agentGroupStateFeature.bindNodeGroupPersistence === "function") {
    agentGroupStateFeature.bindNodeGroupPersistence();
    return;
  }
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
  if (APP_CLIENT.api && typeof APP_CLIENT.api.request === "function") {
    return APP_CLIENT.api.request(path, options);
  }

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

function getRoleSelectElement(role) {
  return (
    {
      discovery: elements.groupRoleDiscovery,
      synthesis: elements.groupRoleSynthesis,
      draft: elements.groupRoleDraft,
      adapt: elements.groupRoleAdapt,
      style: elements.groupRoleStyle,
      audit: elements.groupRoleAudit
    }[role] || null
  );
}

function getSelectedAgentGroup() {
  return state.agentGroups.find((group) => group.groupId === state.selectedAgentGroupId) || null;
}

function renderGroupAgentOptions() {
  const options = [
    '<option value="">Select agent</option>',
    ...state.agents.map((agent) => `<option value="${escapeHtml(agent.id)}">${escapeHtml(agent.name)}</option>`)
  ].join("");

  for (const role of GROUP_ROLE_KEYS) {
    const select = getRoleSelectElement(role);
    if (!select) {
      continue;
    }
    const current = String(select.value || "");
    select.innerHTML = options;
    if (state.agents.some((agent) => agent.id === current)) {
      select.value = current;
    }
  }
}

function renderAgentGroupList() {
  if (!elements.agentGroupList) {
    return;
  }
  if (!state.agentGroups.length) {
    elements.agentGroupList.innerHTML = '<li class="agent-group-item empty">No groups yet.</li>';
    return;
  }

  elements.agentGroupList.innerHTML = state.agentGroups
    .map((group) => {
      const selected = group.groupId === state.selectedAgentGroupId ? "selected" : "";
      return `<li class="agent-group-item ${selected}" data-group-id="${escapeHtml(group.groupId)}">
        <strong>${escapeHtml(group.name)}</strong>
        <small>${escapeHtml(group.description || "sequential team")}</small>
      </li>`;
    })
    .join("");
}

function resetAgentGroupForm() {
  if (!elements.agentGroupForm) {
    return;
  }
  state.selectedAgentGroupId = null;
  if (elements.agentGroupId) {
    elements.agentGroupId.value = "";
  }
  if (elements.agentGroupName) {
    elements.agentGroupName.value = "";
  }
  if (elements.agentGroupDescription) {
    elements.agentGroupDescription.value = "";
  }
  if (elements.groupRunTopic) {
    elements.groupRunTopic.value = "";
  }
  for (const role of GROUP_ROLE_KEYS) {
    const select = getRoleSelectElement(role);
    if (select) {
      select.value = "";
    }
  }
  if (elements.deleteAgentGroupBtn) {
    elements.deleteAgentGroupBtn.disabled = true;
  }
  renderAgentGroupList();
}

function fillAgentGroupForm(group) {
  if (!group || !elements.agentGroupForm) {
    return;
  }
  state.selectedAgentGroupId = group.groupId;
  if (elements.agentGroupId) {
    elements.agentGroupId.value = group.groupId || "";
  }
  if (elements.agentGroupName) {
    elements.agentGroupName.value = group.name || "";
  }
  if (elements.agentGroupDescription) {
    elements.agentGroupDescription.value = group.description || "";
  }
  for (const role of GROUP_ROLE_KEYS) {
    const select = getRoleSelectElement(role);
    if (select) {
      select.value = String(group.roles?.[role] || "");
    }
  }
  if (elements.deleteAgentGroupBtn) {
    elements.deleteAgentGroupBtn.disabled = false;
  }
  renderAgentGroupList();
}

function collectAgentGroupForm() {
  const roles = {};
  for (const role of GROUP_ROLE_KEYS) {
    const select = getRoleSelectElement(role);
    const agentId = String(select?.value || "").trim();
    if (!agentId) {
      throw new Error(`Select an agent for ${role}.`);
    }
    roles[role] = agentId;
  }

  const payload = {
    name: String(elements.agentGroupName?.value || "").trim(),
    description: String(elements.agentGroupDescription?.value || "").trim(),
    roles,
    execution: {
      mode: "sequential"
    }
  };
  if (!payload.name) {
    throw new Error("Agent group name is required.");
  }

  const groupId = String(elements.agentGroupId?.value || "").trim();
  if (groupId) {
    payload.groupId = groupId;
  }
  return payload;
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
  renderAgentDiagnostics(null, null);
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
  renderAgentDiagnostics(agent.lastStats || null, agent.lastResponseId || null);
}

function getStatsEntries(stats) {
  if (!stats || typeof stats !== "object") {
    return [];
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

  return labels
    .map(([key, label]) => ({ key, label, value: stats[key] }))
    .filter((entry) => entry.value !== null && entry.value !== undefined && entry.value !== "");
}

function formatStats(stats) {
  const entries = getStatsEntries(stats);
  if (!entries.length) {
    return "";
  }
  return entries.map((entry) => `${entry.label}: ${entry.value}`).join(" | ");
}

function renderAgentDiagnostics(stats, responseId = null) {
  if (!elements.agentLastStats) {
    return;
  }
  const sections = [];
  if (responseId) {
    sections.push(`response_id: ${responseId}`);
  }
  const statsText = formatStats(stats);
  if (statsText) {
    sections.push(statsText);
  }
  elements.agentLastStats.textContent = sections.length ? sections.join("\n") : "No diagnostics yet.";
}

function stringifyDisplayValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function shouldCollapseDetailsOnSmallScreen() {
  if (typeof window === "undefined" || typeof window.innerWidth !== "number") {
    return false;
  }
  return window.innerWidth <= SMALL_SCREEN_BREAKPOINT;
}

function renderDiagnosticsRow(item) {
  const entries = [];

  if (item.responseId) {
    entries.push({ label: "response", value: item.responseId });
  }

  const statsEntries = getStatsEntries(item.stats);
  entries.push(...statsEntries.map((entry) => ({ label: entry.label, value: entry.value })));

  if (!entries.length) {
    return "";
  }

  const chips = entries
    .map(
      (entry) =>
        `<span class="diag-chip"><span class="diag-key">${escapeHtml(entry.label)}</span><span class="diag-value">${escapeHtml(
          String(entry.value)
        )}</span></span>`
    )
    .join("");

  return `<div class="diagnostics">${chips}</div>`;
}

function renderMessage(item) {
  const role = String(item.role || "assistant").toLowerCase();
  const safeClass = role.replace(/[^a-z0-9_-]/g, "");
  const content = escapeHtml(item.content || "");
  const diagnostics = renderDiagnosticsRow(item);

  if (role === "reasoning") {
    const open = shouldCollapseDetailsOnSmallScreen() ? "" : " open";
    return `<details class="message reasoning message-collapsible"${open}>
      <summary><span class="meta">reasoning</span></summary>
      <pre>${content}</pre>
      ${diagnostics}
    </details>`;
  }

  if (role === "tool_call" || role === "invalid_tool_call") {
    const lines = [];
    if (item.content) {
      lines.push(`summary: ${stringifyDisplayValue(item.content)}`);
    }
    if (item.tool !== undefined && item.tool !== null) {
      lines.push(`tool: ${stringifyDisplayValue(item.tool)}`);
    }
    if (item.arguments !== undefined && item.arguments !== null) {
      lines.push(`arguments: ${stringifyDisplayValue(item.arguments)}`);
    }
    if (item.output !== undefined && item.output !== null) {
      lines.push(`output: ${stringifyDisplayValue(item.output)}`);
    }
    if (item.providerInfo !== undefined && item.providerInfo !== null) {
      lines.push(`provider_info: ${stringifyDisplayValue(item.providerInfo)}`);
    }
    if (item.metadata !== undefined && item.metadata !== null) {
      lines.push(`metadata: ${stringifyDisplayValue(item.metadata)}`);
    }

    const metaLabel = role === "tool_call" ? "tool call" : "invalid tool call";
    const open = shouldCollapseDetailsOnSmallScreen() ? "" : " open";
    return `<details class="message ${safeClass} message-collapsible message-code"${open}>
      <summary><span class="meta">${escapeHtml(metaLabel)}</span></summary>
      <pre>${escapeHtml(lines.join("\n"))}</pre>
      ${diagnostics}
    </details>`;
  }

  return `<div class="message ${safeClass}">
    <div class="meta">${escapeHtml(role)}</div>
    <pre>${content}</pre>
    ${diagnostics}
  </div>`;
}

function isNearBottom(element, threshold = 72) {
  if (chatUiFeature && typeof chatUiFeature.isNearBottom === "function") {
    return chatUiFeature.isNearBottom(element, threshold);
  }
  if (!element) {
    return true;
  }
  const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
  if (!Number.isFinite(remaining)) {
    return true;
  }
  return remaining <= threshold;
}

function setScrollButtonVisible(visible) {
  if (chatUiFeature && typeof chatUiFeature.setScrollButtonVisible === "function") {
    chatUiFeature.setScrollButtonVisible(visible);
    return;
  }
  if (!elements.scrollToBottomBtn) {
    return;
  }
  elements.scrollToBottomBtn.hidden = !visible;
}

function scrollChatToBottom({ smooth = false } = {}) {
  if (chatUiFeature && typeof chatUiFeature.scrollChatToBottom === "function") {
    chatUiFeature.scrollChatToBottom({ smooth });
    return;
  }
  if (!elements.chatLog) {
    return;
  }
  if (smooth && typeof elements.chatLog.scrollTo === "function") {
    elements.chatLog.scrollTo({ top: elements.chatLog.scrollHeight, behavior: "smooth" });
  } else {
    elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
  }
  state.shouldStickToBottom = true;
  setScrollButtonVisible(false);
}

function syncChatScrollState() {
  if (chatUiFeature && typeof chatUiFeature.syncChatScrollState === "function") {
    chatUiFeature.syncChatScrollState();
    return;
  }
  if (!elements.chatLog) {
    return;
  }
  state.shouldStickToBottom = isNearBottom(elements.chatLog);
  setScrollButtonVisible(!state.shouldStickToBottom);
}

function renderChat(history = [], { showTyping = false, streamPreview = "", forceScroll = false } = {}) {
  state.chatHistory = Array.isArray(history) ? history : [];
  const wasNearBottom = isNearBottom(elements.chatLog);

  if (!state.chatHistory.length && !showTyping) {
    elements.chatLog.innerHTML = '<p class="empty-chat">No conversation yet.</p>';
    if (forceScroll || state.shouldStickToBottom || wasNearBottom) {
      scrollChatToBottom();
    } else {
      syncChatScrollState();
    }
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

  if (forceScroll || state.shouldStickToBottom || wasNearBottom) {
    scrollChatToBottom();
  } else {
    syncChatScrollState();
  }
}

function updateAttachmentCount() {
  if (chatUiFeature && typeof chatUiFeature.updateAttachmentCount === "function") {
    chatUiFeature.updateAttachmentCount();
    return;
  }
  if (!elements.chatAttachmentCount) {
    return;
  }
  const count = state.pendingImages.length;
  if (!count) {
    elements.chatAttachmentCount.textContent = "";
    return;
  }
  elements.chatAttachmentCount.textContent = count === 1 ? "1 image attached" : `${count} images attached`;
}

function formatBytes(bytes) {
  if (chatUiFeature && typeof chatUiFeature.formatBytes === "function") {
    return chatUiFeature.formatBytes(bytes);
  }
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function revokeAttachmentPreviewUrls() {
  if (chatUiFeature && typeof chatUiFeature.revokeAttachmentPreviewUrls === "function") {
    chatUiFeature.revokeAttachmentPreviewUrls();
    return;
  }
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") {
    state.attachmentPreviewUrls = [];
    return;
  }
  for (const url of state.attachmentPreviewUrls) {
    URL.revokeObjectURL(url);
  }
  state.attachmentPreviewUrls = [];
}

function syncPendingImagesToInput() {
  if (chatUiFeature && typeof chatUiFeature.syncPendingImagesToInput === "function") {
    chatUiFeature.syncPendingImagesToInput();
    return;
  }
  if (!elements.chatImages || typeof DataTransfer !== "function") {
    return;
  }

  try {
    const transfer = new DataTransfer();
    for (const file of state.pendingImages) {
      transfer.items.add(file);
    }
    elements.chatImages.files = transfer.files;
  } catch {
    // Ignore environments where programmatic FileList assignment is blocked.
  }
}

function renderAttachmentPreview() {
  if (chatUiFeature && typeof chatUiFeature.renderAttachmentPreview === "function") {
    chatUiFeature.renderAttachmentPreview();
    return;
  }
  if (!elements.chatAttachmentPreview) {
    return;
  }

  revokeAttachmentPreviewUrls();

  if (!state.pendingImages.length) {
    elements.chatAttachmentPreview.innerHTML = "";
    return;
  }

  const cards = state.pendingImages
    .map((file, index) => {
      const safeName = escapeHtml(file.name || `image-${index + 1}`);
      const sizeText = escapeHtml(formatBytes(file.size));
      let thumbMarkup = '<span class="attachment-thumb-fallback" aria-hidden="true">IMG</span>';

      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        const objectUrl = URL.createObjectURL(file);
        state.attachmentPreviewUrls.push(objectUrl);
        thumbMarkup = `<img src="${escapeHtml(objectUrl)}" alt="" loading="lazy" />`;
      }

      return `<div class="attachment-card">
        <div class="attachment-thumb">${thumbMarkup}</div>
        <div class="attachment-meta">
          <div class="attachment-name" title="${safeName}">${safeName}</div>
          <div class="attachment-size">${sizeText}</div>
        </div>
        <button class="attachment-remove-btn" type="button" data-index="${index}" aria-label="Remove ${safeName}">Remove</button>
      </div>`;
    })
    .join("");

  elements.chatAttachmentPreview.innerHTML = cards;
}

function mergePendingImages(files) {
  if (chatUiFeature && typeof chatUiFeature.mergePendingImages === "function") {
    chatUiFeature.mergePendingImages(files);
    return;
  }
  const unique = new Map(
    state.pendingImages.map((file) => [`${file.name}:${file.size}:${file.lastModified}:${file.type}`, file])
  );
  let oversized = 0;

  for (const file of files) {
    if (!file || typeof file !== "object") {
      continue;
    }
    const type = String(file.type || "").toLowerCase();
    if (!type.startsWith("image/")) {
      continue;
    }
    if (Number(file.size) > MAX_IMAGE_ATTACHMENT_BYTES) {
      oversized += 1;
      continue;
    }
    const key = `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
    unique.set(key, file);
  }

  state.pendingImages = [...unique.values()];
  syncPendingImagesToInput();
  updateAttachmentCount();
  renderAttachmentPreview();

  if (oversized > 0) {
    const limitText = formatBytes(MAX_IMAGE_ATTACHMENT_BYTES);
    setStatus(
      oversized === 1
        ? `Skipped 1 image larger than ${limitText}.`
        : `Skipped ${oversized} images larger than ${limitText}.`,
      true
    );
  }
}

function removePendingImage(index) {
  if (chatUiFeature && typeof chatUiFeature.removePendingImage === "function") {
    chatUiFeature.removePendingImage(index);
    return;
  }
  if (!Number.isInteger(index) || index < 0 || index >= state.pendingImages.length) {
    return;
  }
  state.pendingImages.splice(index, 1);
  syncPendingImagesToInput();
  updateAttachmentCount();
  renderAttachmentPreview();
}

function clearPendingImages() {
  if (chatUiFeature && typeof chatUiFeature.clearPendingImages === "function") {
    chatUiFeature.clearPendingImages();
    return;
  }
  state.pendingImages = [];
  if (elements.chatImages) {
    elements.chatImages.value = "";
  }
  syncPendingImagesToInput();
  updateAttachmentCount();
  renderAttachmentPreview();
}

function autoResizeChatMessage() {
  if (chatUiFeature && typeof chatUiFeature.autoResizeChatMessage === "function") {
    chatUiFeature.autoResizeChatMessage();
    return;
  }
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
  renderGroupAgentOptions();
}

async function loadAgentGroups() {
  const payload = await api("/api/agent-groups");
  state.agentGroups = Array.isArray(payload) ? payload : [];
  if (!state.selectedAgentGroupId && state.agentGroups.length) {
    state.selectedAgentGroupId = state.agentGroups[0].groupId;
  } else if (!state.agentGroups.some((group) => group.groupId === state.selectedAgentGroupId)) {
    state.selectedAgentGroupId = null;
  }
  renderAgentGroupList();
}

async function loadHistory() {
  if (!state.selectedAgentId) {
    elements.chatTitle.textContent = "Agent Chat";
    renderChat([], { forceScroll: true });
    renderAgentDiagnostics(null, null);
    return;
  }

  const agent = getSelectedAgent();
  elements.chatTitle.textContent = `Chat: ${agent?.name || "Unknown Agent"}`;
  const payload = await api(`/api/chat/${state.selectedAgentId}/history`);
  if (agent) {
    agent.lastStats = payload.lastStats || null;
    agent.lastResponseId = payload.lastResponseId || null;
  }
  renderAgentDiagnostics(payload.lastStats || null, payload.lastResponseId || null);
  renderChat(payload.history || [], { forceScroll: true });
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
  if (typeof STREAM_SSE_FEATURE === "function") {
    yield* STREAM_SSE_FEATURE(body);
    return;
  }
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

async function sendChatNonStreaming(agentId, message, messageParts, optimisticHistory, previousHistory, previousPendingImages) {
  try {
    const payload = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        agentId,
        message,
        messageParts
      })
    });
    renderChat(payload.history || optimisticHistory, { forceScroll: true });
    renderAgentDiagnostics(payload.stats || null, payload.responseId || null);
    setStatus("Response received.");
  } catch (error) {
    renderChat(previousHistory, { forceScroll: true });
    elements.chatMessage.value = message;
    state.pendingImages = [...previousPendingImages];
    syncPendingImagesToInput();
    updateAttachmentCount();
    renderAttachmentPreview();
    autoResizeChatMessage();
    setStatus(error.message, true);
  }
}

async function sendChatStreaming(agentId, message, messageParts, optimisticHistory, previousHistory, previousPendingImages) {
  let assistantPreview = "";
  let finalHistory = null;
  let finalStats = null;
  let finalResponseId = null;
  let frameHandle = null;
  const schedulePreviewRender = () => {
    if (frameHandle !== null) {
      return;
    }
    const render = () => {
      frameHandle = null;
      renderChat(optimisticHistory, {
        showTyping: true,
        streamPreview: assistantPreview
      });
    };

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      frameHandle = window.requestAnimationFrame(render);
    } else {
      frameHandle = setTimeout(render, 16);
    }
  };
  const flushPreviewRender = () => {
    if (frameHandle === null) {
      return;
    }
    if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(frameHandle);
    } else {
      clearTimeout(frameHandle);
    }
    frameHandle = null;
    renderChat(optimisticHistory, {
      showTyping: true,
      streamPreview: assistantPreview
    });
  };

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
        schedulePreviewRender();
      }

      if (event.event === "app.history" && event.data && typeof event.data === "object") {
        finalHistory = Array.isArray(event.data.history) ? event.data.history : null;
        finalStats = event.data.stats || null;
        finalResponseId = event.data.responseId || null;
      }
    }

    flushPreviewRender();

    if (finalHistory) {
      renderChat(finalHistory, { forceScroll: true });
      renderAgentDiagnostics(finalStats, finalResponseId);
    } else {
      await loadHistory();
    }
    setStatus("Stream completed.");
  } catch (error) {
    renderChat(previousHistory, { forceScroll: true });
    elements.chatMessage.value = message;
    state.pendingImages = [...previousPendingImages];
    syncPendingImagesToInput();
    updateAttachmentCount();
    renderAttachmentPreview();
    autoResizeChatMessage();
    setStatus(error.message, true);
  } finally {
    if (frameHandle !== null) {
      if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frameHandle);
      } else {
        clearTimeout(frameHandle);
      }
    }
    state.isStreaming = false;
  }
}

async function initialize() {
  elements.deleteAgentBtn.disabled = true;
  if (elements.deleteAgentGroupBtn) {
    elements.deleteAgentGroupBtn.disabled = true;
  }
  initializeResizableLayout();
  bindNodeGroupPersistence();
  bindEvents();
  updateAttachmentCount();
  renderAttachmentPreview();
  setScrollButtonVisible(false);
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
    await loadAgentGroups();
    const selected = getSelectedAgent();
    const selectedGroup = getSelectedAgentGroup();
    if (selected) {
      fillAgentForm(selected);
      loadGroupStateForCurrentAgent();
      await loadHistory();
    } else {
      resetAgentForm();
      loadGroupStateForCurrentAgent();
      renderChat([], { forceScroll: true });
    }
    if (selectedGroup) {
      fillAgentGroupForm(selectedGroup);
    } else {
      resetAgentGroupForm();
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
    mergePendingImages(Array.from(elements.chatImages.files || []));
    elements.chatImages.value = "";
  });

  if (elements.chatAttachmentPreview) {
    elements.chatAttachmentPreview.addEventListener("click", (event) => {
      if (!event.target || typeof event.target.closest !== "function") {
        return;
      }
      const target = event.target.closest(".attachment-remove-btn");
      if (!target) {
        return;
      }
      const index = Number.parseInt(target.dataset.index || "", 10);
      removePendingImage(index);
    });
  }

  if (elements.chatLog) {
    elements.chatLog.addEventListener("scroll", () => {
      syncChatScrollState();
    });
  }

  if (elements.scrollToBottomBtn) {
    elements.scrollToBottomBtn.addEventListener("click", () => {
      scrollChatToBottom({ smooth: true });
    });
  }

  elements.chatMessage.addEventListener("input", () => {
    autoResizeChatMessage();
  });

  elements.agentList.addEventListener("click", async (event) => {
    if (!event.target || typeof event.target.closest !== "function") {
      return;
    }
    const item = event.target.closest("[data-id]");
    if (!item) return;
    try {
      await onAgentSelected(item.dataset.id);
      setStatus("Agent selected.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  if (elements.agentGroupList) {
    elements.agentGroupList.addEventListener("click", (event) => {
      if (!event.target || typeof event.target.closest !== "function") {
        return;
      }
      const item = event.target.closest("[data-group-id]");
      if (!item) {
        return;
      }
      const group = state.agentGroups.find((entry) => entry.groupId === item.dataset.groupId);
      if (!group) {
        return;
      }
      fillAgentGroupForm(group);
      setStatus("Agent group selected.");
    });
  }

  elements.newAgentBtn.addEventListener("click", () => {
    state.selectedAgentId = null;
    renderAgentList();
    resetAgentForm();
    loadGroupStateForCurrentAgent();
    renderChat([], { forceScroll: true });
    setStatus("Creating new agent.");
  });

  if (elements.newAgentGroupBtn) {
    elements.newAgentGroupBtn.addEventListener("click", () => {
      resetAgentGroupForm();
      setStatus("Creating new group.");
    });
  }

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

  if (elements.agentGroupForm) {
    elements.agentGroupForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const payload = collectAgentGroupForm();
        const saved = await api("/api/agent-groups", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        await loadAgentGroups();
        fillAgentGroupForm(saved);
        setStatus(payload.groupId ? "Group updated." : "Group created.");
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  }

  if (elements.deleteAgentGroupBtn) {
    elements.deleteAgentGroupBtn.addEventListener("click", async () => {
      const id = String(elements.agentGroupId?.value || "").trim();
      if (!id) {
        return;
      }
      const confirmed = window.confirm("Delete this group?");
      if (!confirmed) {
        return;
      }
      try {
        await api(`/api/agent-groups/${id}`, { method: "DELETE" });
        await loadAgentGroups();
        const selectedGroup = getSelectedAgentGroup();
        if (selectedGroup) {
          fillAgentGroupForm(selectedGroup);
        } else {
          resetAgentGroupForm();
        }
        setStatus("Group deleted.");
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  }

  if (elements.runAgentGroupBtn) {
    elements.runAgentGroupBtn.addEventListener("click", async () => {
      const group = getSelectedAgentGroup();
      if (!group) {
        setStatus("Select a group first.", true);
        return;
      }
      const topic = String(elements.groupRunTopic?.value || "").trim();
      if (!topic) {
        setStatus("Group run topic is required.", true);
        return;
      }
      const original = elements.runAgentGroupBtn.textContent;
      elements.runAgentGroupBtn.disabled = true;
      elements.runAgentGroupBtn.textContent = "Running...";
      try {
        const payload = await api(`/api/agent-groups/${group.groupId}/run`, {
          method: "POST",
          body: JSON.stringify({ topic })
        });
        setStatus(`Group run started: ${payload.runId}`);
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        elements.runAgentGroupBtn.disabled = false;
        elements.runAgentGroupBtn.textContent = original;
      }
    });
  }

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
        renderChat([], { forceScroll: true });
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
    const files = [...state.pendingImages];
    const previousPendingImages = [...state.pendingImages];

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
      state.shouldStickToBottom = true;
      renderChat(optimisticHistory, { showTyping: true, forceScroll: true });
      elements.chatMessage.value = "";
      clearPendingImages();
      autoResizeChatMessage();

      const selected = getSelectedAgent();
      if (selected?.stream) {
        await sendChatStreaming(
          state.selectedAgentId,
          message,
          messageParts,
          optimisticHistory,
          previousHistory,
          previousPendingImages
        );
      } else {
        await sendChatNonStreaming(
          state.selectedAgentId,
          message,
          messageParts,
          optimisticHistory,
          previousHistory,
          previousPendingImages
        );
      }
    } catch (error) {
      renderChat(previousHistory, { forceScroll: true });
      elements.chatMessage.value = message;
      state.pendingImages = previousPendingImages;
      syncPendingImagesToInput();
      updateAttachmentCount();
      renderAttachmentPreview();
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
      renderChat(payload.history || [], { forceScroll: true });
      renderAgentDiagnostics(null, null);
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
