const test = require("node:test");
const assert = require("node:assert/strict");

const { __serverInternals } = require("../server");

const CANONICAL_ROLES = __serverInternals.CANONICAL_PIPELINE_STAGES.map((stage) => stage.role);

function buildAgentMap() {
  const agents = [];
  for (const role of CANONICAL_ROLES) {
    agents.push({
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
    });
  }
  return agents;
}

test("sanitizePipeline enforces canonical role mappings", () => {
  __serverInternals.setTestState({
    agents: buildAgentMap()
  });

  assert.throws(
    () =>
      __serverInternals.sanitizePipeline(
        {
          name: "Pipeline Missing Roles",
          agentsByRole: {
            discovery: "agent-discovery"
          }
        },
        { strict: true }
      ),
    /agentsByRole\.synthesis is required/
  );

  const completeAgentsByRole = Object.fromEntries(CANONICAL_ROLES.map((role) => [role, `agent-${role}`]));
  const pipeline = __serverInternals.sanitizePipeline(
    {
      name: "Canonical Pipeline",
      stages: [{ stageId: "discovery", name: "Research Stage" }],
      agentsByRole: completeAgentsByRole
    },
    { strict: true }
  );

  assert.equal(pipeline.stages.length, 6);
  assert.deepEqual(
    pipeline.stages.map((stage) => stage.stageId),
    __serverInternals.CANONICAL_PIPELINE_STAGES.map((stage) => stage.stageId)
  );
  assert.equal(pipeline.stages[0].name, "Research Stage");
});

test("sanitizeRunCreate initializes orchestration run shape with stageState", () => {
  const completeAgentsByRole = Object.fromEntries(CANONICAL_ROLES.map((role) => [role, `agent-${role}`]));
  const pipeline = {
    id: "pipeline-1",
    name: "Pipeline",
    description: "",
    stages: __serverInternals.CANONICAL_PIPELINE_STAGES.map((stage, index) => ({
      stageId: stage.stageId,
      role: stage.role,
      name: stage.name,
      order: index + 1,
      enabled: true
    })),
    agentsByRole: completeAgentsByRole,
    toolsPolicy: { default: { allowWebSearch: true }, byStage: {} },
    outputs: [{ outputId: "o1", type: "blog", enabled: true }]
  };

  __serverInternals.setTestState({
    agents: buildAgentMap(),
    pipelines: [pipeline]
  });

  const run = __serverInternals.sanitizeRunCreate({
    pipelineId: "pipeline-1",
    topic: "Edge AI chips in 2026"
  });

  assert.equal(run.topic, "Edge AI chips in 2026");
  assert.equal(run.status, "queued");
  assert.equal(typeof run.stageState, "object");
  assert.equal(Object.keys(run.stageState).length, 6);
  assert.equal(run.stageState.discovery.status, "pending");
  assert.equal(run.stageState.audit.status, "pending");
});

test("ensurePipelineReadyForRun rejects unknown stage agent references", () => {
  __serverInternals.setTestState({
    agents: buildAgentMap()
  });

  const brokenPipeline = {
    id: "pipeline-2",
    agentsByRole: {
      discovery: "agent-discovery",
      synthesis: "agent-synthesis",
      draft: "agent-draft",
      adapt: "agent-adapt",
      style: "agent-style",
      audit: "missing-agent"
    }
  };

  assert.throws(() => __serverInternals.ensurePipelineReadyForRun(brokenPipeline), /unknown agent/);
});
