const { DEFAULT_BASE_URL } = require("../config/env");

module.exports = {
  agents: [],
  agentGroups: [],
  pipelines: [],
  runs: [],
  config: { baseUrl: DEFAULT_BASE_URL },
  runStreamSubscribers: new Map(),
  activePipelineRuns: new Map()
};
