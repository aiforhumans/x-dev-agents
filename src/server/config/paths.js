const path = require("node:path");

const DATA_DIR = path.join(process.cwd(), "data");
const PUBLIC_DIR = path.join(process.cwd(), "public");

const AGENTS_FILE = path.join(DATA_DIR, "agents.json");
const AGENT_GROUPS_FILE = path.join(DATA_DIR, "agent-groups.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const PIPELINES_FILE = path.join(DATA_DIR, "pipelines.json");
const RUNS_FILE = path.join(DATA_DIR, "runs.json");

module.exports = {
  DATA_DIR,
  PUBLIC_DIR,
  AGENTS_FILE,
  AGENT_GROUPS_FILE,
  CONFIG_FILE,
  PIPELINES_FILE,
  RUNS_FILE
};
