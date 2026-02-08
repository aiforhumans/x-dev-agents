const test = require("node:test");
const assert = require("node:assert/strict");

const { __serverInternals } = require("../server");

const CANONICAL_ROLES = __serverInternals.CANONICAL_PIPELINE_STAGES.map((stage) => stage.role);

function buildAgentMap() {
  return CANONICAL_ROLES.map((role) => ({
    id: `agent-${role}`,
    name: `Agent ${role}`,
    model: "test-model",
    systemPrompt: "You are helpful.",
    temperature: 0.7,
    topP: null,
    topK: null,
    minP: null,
    repeatPenalty: null,
    maxOutputTokens: null,
    contextLength: null,
    reasoning: null,
    store: false,
    stream: true,
    webSearch: false,
    integrations: []
  }));
}

test("sanitizeAgentGroup rejects missing canonical role mappings", () => {
  __serverInternals.setTestState({ agents: buildAgentMap() });

  assert.throws(
    () =>
      __serverInternals.sanitizeAgentGroup(
        {
          name: "Incomplete Group",
          roles: { discovery: "agent-discovery" }
        },
        { strict: true }
      ),
    /roles\.synthesis is required|agentsByRole\.synthesis is required/
  );
});

test("sanitizeAgentGroup accepts complete role map and sequential execution", () => {
  __serverInternals.setTestState({ agents: buildAgentMap() });
  const roles = Object.fromEntries(CANONICAL_ROLES.map((role) => [role, `agent-${role}`]));
  const group = __serverInternals.sanitizeAgentGroup(
    {
      name: "Research Team",
      description: "End-to-end writer team",
      roles,
      execution: { mode: "sequential", enabledStages: ["discovery", "draft", "audit"] }
    },
    { strict: true }
  );

  assert.equal(group.name, "Research Team");
  assert.equal(group.execution.mode, "sequential");
  assert.deepEqual({ ...group.roles }, roles);
  assert.deepEqual(group.execution.enabledStages, ["discovery", "draft", "audit"]);
});
