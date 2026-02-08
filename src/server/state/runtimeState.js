const { DEFAULT_BASE_URL } = require("../config/env");

module.exports = {
  agents: [],
  pipelines: [],
  runs: [],
  config: { baseUrl: DEFAULT_BASE_URL },
  runStreamSubscribers: new Map(),
  activePipelineRuns: new Map()
};
