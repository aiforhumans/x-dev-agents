const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(process.cwd(), "data");
const AGENTS_FILE = path.join(DATA_DIR, "agents.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const PIPELINES_FILE = path.join(DATA_DIR, "pipelines.json");
const RUNS_FILE = path.join(DATA_DIR, "runs.json");
const DEFAULT_BASE_URL = process.env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1";

module.exports = {
  PORT,
  DATA_DIR,
  AGENTS_FILE,
  CONFIG_FILE,
  PIPELINES_FILE,
  RUNS_FILE,
  DEFAULT_BASE_URL
};
