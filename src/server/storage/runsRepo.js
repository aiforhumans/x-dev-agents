/**
 * Run repository for data/runs.json persistence.
 */
const fs = require("node:fs/promises");
const { readJson, writeJsonAtomic } = require("./jsonStore");

async function ensureRunsFile({ runsFile }) {
  try {
    await fs.access(runsFile);
  } catch {
    await writeJsonAtomic(runsFile, [], { trailingNewline: true });
  }
}

async function loadRuns({ runsFile }) {
  try {
    const parsed = await readJson(runsFile, [], { strict: true });
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    await writeJsonAtomic(runsFile, [], { trailingNewline: true });
    return [];
  }
}

async function saveRuns({ runsFile, runs }) {
  await writeJsonAtomic(runsFile, runs, { trailingNewline: true });
}

function appendRunLog(run, logEntry) {
  run.logs = [...(Array.isArray(run.logs) ? run.logs : []), logEntry].slice(-5000);
  return run;
}

module.exports = {
  ensureRunsFile,
  loadRuns,
  saveRuns,
  appendRunLog
};
