const state = {
  baseUrl: "",
  models: [],
  agents: [],
  selectedAgentId: null,
  chatHistory: [],
  isStreaming: false
};

const elements = {
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
  agentIntegrations: document.getElementById("agentIntegrations"),
  agentStore: document.getElementById("agentStore"),
  agentStream: document.getElementById("agentStream"),
  deleteAgentBtn: document.getElementById("deleteAgentBtn"),
  chatTitle: document.getElementById("chatTitle"),
  chatLog: document.getElementById("chatLog"),
  chatForm: document.getElementById("chatForm"),
  chatMessage: document.getElementById("chatMessage"),
  chatImages: document.getElementById("chatImages"),
  resetChatBtn: document.getElementById("resetChatBtn"),
  statusBar: document.getElementById("statusBar")
};

function setStatus(message, isError = false) {
  elements.statusBar.textContent = message;
  elements.statusBar.classList.toggle("error", isError);
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
  elements.agentIntegrations.value = "";
  elements.agentStore.checked = true;
  elements.agentStream.checked = true;
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
  elements.agentIntegrations.value = Array.isArray(agent.integrations)
    ? JSON.stringify(agent.integrations, null, 2)
    : "";
  elements.agentStore.checked = agent.store !== false;
  elements.agentStream.checked = agent.stream !== false;
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
    [tool, args, out].filter(Boolean).forEach((line) => extras.push(`<div>${line}</div>`));
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

function collectAgentForm() {
  const temperatureRaw = elements.agentTemperature.value.trim();
  const temperature = temperatureRaw ? Number(temperatureRaw) : 0.7;
  if (!Number.isFinite(temperature)) {
    throw new Error("Temperature must be a valid number.");
  }

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
    integrations: parseIntegrations(elements.agentIntegrations.value),
    store: elements.agentStore.checked,
    stream: elements.agentStream.checked
  };
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
    setStatus(error.message, true);
  } finally {
    state.isStreaming = false;
  }
}

async function initialize() {
  elements.deleteAgentBtn.disabled = true;
  bindEvents();

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
      await loadHistory();
    } else {
      resetAgentForm();
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
        await loadHistory();
      } else {
        resetAgentForm();
        renderChat([]);
      }
      setStatus("Agent deleted.");
    } catch (error) {
      setStatus(error.message, true);
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

      const selected = getSelectedAgent();
      if (selected?.stream) {
        await sendChatStreaming(state.selectedAgentId, message, messageParts, optimisticHistory, previousHistory);
      } else {
        await sendChatNonStreaming(state.selectedAgentId, message, messageParts, optimisticHistory, previousHistory);
      }
    } catch (error) {
      renderChat(previousHistory);
      elements.chatMessage.value = message;
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

const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";
initialize();
