const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createClassList() {
  const classes = new Set();
  return {
    add(name) {
      classes.add(name);
    },
    remove(name) {
      classes.delete(name);
    },
    toggle(name, force) {
      if (typeof force === "undefined") {
        if (classes.has(name)) {
          classes.delete(name);
          return false;
        }
        classes.add(name);
        return true;
      }
      if (force) {
        classes.add(name);
      } else {
        classes.delete(name);
      }
      return classes.has(name);
    },
    contains(name) {
      return classes.has(name);
    }
  };
}

function createElement({ groupName = "" } = {}) {
  const listeners = new Map();
  const styleStore = new Map();
  return {
    value: "",
    innerHTML: "",
    textContent: "",
    disabled: false,
    checked: false,
    files: [],
    open: false,
    dataset: groupName ? { group: groupName } : {},
    classList: createClassList(),
    style: {
      setProperty(name, value) {
        styleStore.set(name, value);
      },
      getPropertyValue(name) {
        return styleStore.get(name) || "";
      }
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(handler);
    },
    dispatchEvent(event) {
      const handlers = listeners.get(event.type) || [];
      for (const handler of handlers) {
        handler(event);
      }
    },
    getBoundingClientRect() {
      return { left: 0, width: 1400 };
    },
    scrollHeight: 0,
    scrollTop: 0
  };
}

function createJsonResponse(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function createLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    }
  };
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function buildAppContext(storageSeed = {}) {
  const ids = [
    "layout",
    "agentsPanel",
    "chatPanel",
    "layoutResizer",
    "baseUrlInput",
    "saveBaseUrlBtn",
    "testConnectionBtn",
    "agentList",
    "newAgentBtn",
    "agentForm",
    "agentId",
    "agentName",
    "agentDescription",
    "agentModel",
    "refreshModelsBtn",
    "agentTemperature",
    "agentTopP",
    "agentTopK",
    "agentMinP",
    "agentRepeatPenalty",
    "agentMaxOutputTokens",
    "agentContextLength",
    "agentReasoning",
    "agentSystemPrompt",
    "agentMcpPlugins",
    "agentEphemeralMcp",
    "agentIntegrations",
    "mcpTestBtn",
    "agentStore",
    "agentStream",
    "agentWebSearch",
    "deleteAgentBtn",
    "chatTitle",
    "chatLog",
    "chatForm",
    "chatAttachBtn",
    "chatMessage",
    "chatImages",
    "chatAttachmentCount",
    "resetChatBtn",
    "statusBar"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, createElement()]));
  const nodeGroups = [
    createElement({ groupName: "basics" }),
    createElement({ groupName: "model" }),
    createElement({ groupName: "sampling" }),
    createElement({ groupName: "output" }),
    createElement({ groupName: "runtime" }),
    createElement({ groupName: "webSearch" }),
    createElement({ groupName: "mcp" }),
    createElement({ groupName: "diagnostics" })
  ];

  const scriptPath = path.join(process.cwd(), "public", "app.js");
  const appScript = fs.readFileSync(scriptPath, "utf-8");

  const context = {
    console,
    window: {
      confirm: () => true,
      innerWidth: 1400,
      addEventListener() {},
      removeEventListener() {}
    },
    document: {
      getElementById(id) {
        return elements[id];
      },
      querySelectorAll(selector) {
        if (selector === ".node-group[data-group]") {
          return nodeGroups;
        }
        return [];
      }
    },
    localStorage: createLocalStorage(storageSeed),
    fetch: async (url) => {
      if (url === "/api/config") {
        return createJsonResponse({ baseUrl: "http://localhost:1234/v1" });
      }
      if (url === "/api/models") {
        return createJsonResponse({ models: ["test-model"] });
      }
      if (url === "/api/agents") {
        return createJsonResponse([
          {
            id: "agent-1",
            name: "Agent One",
            model: "test-model",
            temperature: 0.7,
            systemPrompt: "You are a helper."
          }
        ]);
      }
      if (url === "/api/chat/agent-1/history") {
        return createJsonResponse({ history: [] });
      }
      return createJsonResponse({});
    },
    setTimeout,
    clearTimeout
  };

  vm.runInNewContext(appScript, context, { filename: "public/app.js" });
  return { context, nodeGroups };
}

test("default node group state is applied when no localStorage value exists", async () => {
  const { nodeGroups } = buildAppContext();
  await flushAsyncWork();

  const states = Object.fromEntries(nodeGroups.map((group) => [group.dataset.group, group.open]));
  assert.deepEqual(states, {
    basics: true,
    model: true,
    sampling: false,
    output: false,
    runtime: false,
    webSearch: false,
    mcp: false,
    diagnostics: false
  });
});

test("invalid stored node group state falls back to defaults", async () => {
  const { nodeGroups } = buildAppContext({
    "ui.agentForm.groupState.agent-1": "{bad json"
  });
  await flushAsyncWork();

  const states = Object.fromEntries(nodeGroups.map((group) => [group.dataset.group, group.open]));
  assert.deepEqual(states, {
    basics: true,
    model: true,
    sampling: false,
    output: false,
    runtime: false,
    webSearch: false,
    mcp: false,
    diagnostics: false
  });
});

test("legacy stored group keys are mapped to the new group schema", async () => {
  const { nodeGroups } = buildAppContext({
    "ui.agentForm.groupState.agent-1": JSON.stringify({
      identity: false,
      model: false,
      generation: true,
      prompt: true,
      runtime: true,
      mcp: true
    })
  });
  await flushAsyncWork();

  const states = Object.fromEntries(nodeGroups.map((group) => [group.dataset.group, group.open]));
  assert.deepEqual(states, {
    basics: true,
    model: false,
    sampling: true,
    output: true,
    runtime: true,
    webSearch: true,
    mcp: true,
    diagnostics: false
  });
});

test("group storage key helper uses __new__ for blank ids", async () => {
  const { context } = buildAppContext();
  await flushAsyncWork();

  assert.equal(context.__appInternals.getGroupStateStorageKey("agent-99"), "ui.agentForm.groupState.agent-99");
  assert.equal(context.__appInternals.getGroupStateStorageKey(""), "ui.agentForm.groupState.__new__");
});
