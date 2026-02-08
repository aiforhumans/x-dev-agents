const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createClassList() {
  const classes = new Set();
  return {
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

function createElement() {
  return {
    value: "",
    innerHTML: "",
    textContent: "",
    disabled: false,
    checked: false,
    files: [],
    classList: createClassList(),
    addEventListener() {},
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

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("initialization still loads agents when models endpoint fails", async () => {
  const ids = [
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
    "agentIntegrations",
    "agentStore",
    "agentStream",
    "deleteAgentBtn",
    "chatTitle",
    "chatLog",
    "chatForm",
    "chatMessage",
    "chatImages",
    "resetChatBtn",
    "statusBar"
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, createElement()]));
  const fetchCalls = [];

  const scriptPath = path.join(process.cwd(), "public", "app.js");
  const appScript = fs.readFileSync(scriptPath, "utf-8");

  const context = {
    console,
    window: { confirm: () => true },
    document: {
      getElementById(id) {
        return elements[id];
      }
    },
    fetch: async (url) => {
      fetchCalls.push(url);

      if (url === "/api/config") {
        return createJsonResponse({ baseUrl: "http://localhost:1234/v1" });
      }
      if (url === "/api/models") {
        return createJsonResponse({ error: "LM Studio unavailable." }, false, 500);
      }
      if (url === "/api/agents") {
        return createJsonResponse([
          {
            id: "agent-1",
            name: "Fallback Agent",
            description: "",
            model: "offline-model",
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
  await flushAsyncWork();

  assert.ok(fetchCalls.includes("/api/models"));
  assert.ok(fetchCalls.includes("/api/agents"));
  assert.match(elements.agentList.innerHTML, /Fallback Agent/);
  assert.match(elements.statusBar.textContent, /Agents loaded\. Model list unavailable:/);
  assert.equal(elements.statusBar.classList.contains("error"), true);
});
