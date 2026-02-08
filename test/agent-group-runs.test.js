const test = require("node:test");
const assert = require("node:assert/strict");

const { __serverInternals } = require("../server");

const CANONICAL_ROLES = __serverInternals.CANONICAL_PIPELINE_STAGES.map((stage) => stage.role);

test("group run input + stage state initialization keeps group linkage", () => {
  const roles = Object.fromEntries(CANONICAL_ROLES.map((role) => [role, `agent-${role}`]));
  const group = {
    groupId: "group-1",
    name: "Launch Team",
    description: "",
    roles,
    execution: {
      mode: "sequential",
      enabledStages: ["discovery", "synthesis", "draft", "adapt", "style", "audit"]
    },
    defaults: {
      brandVoice: "calm, concise"
    }
  };

  const mergedPayload = __serverInternals.mergeAgentGroupRunDefaults(group, {
    topic: "Agent orchestration patterns"
  });
  const runInput = __serverInternals.sanitizeRunCreateInput(mergedPayload);
  const stageState = __serverInternals.buildInitialStageStateFromAgentGroup(group);

  assert.equal(runInput.topic, "Agent orchestration patterns");
  assert.equal(runInput.brandVoice, "calm, concise");
  assert.equal(Object.keys(stageState).length, 6);
  assert.equal(stageState.discovery.agentId, "agent-discovery");
  assert.equal(stageState.audit.agentId, "agent-audit");
});
