/**
 * Agent repository for data/agents.json persistence.
 */
const fs = require("node:fs/promises");
const { readJson, writeJsonAtomic } = require("./jsonStore");

async function ensureAgentsFile({ agentsFile }) {
  try {
    await fs.access(agentsFile);
  } catch {
    await writeJsonAtomic(agentsFile, [], { trailingNewline: true });
  }
}

async function loadAgents({ agentsFile }) {
  try {
    const parsed = await readJson(agentsFile, [], { strict: true });
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    await writeJsonAtomic(agentsFile, [], { trailingNewline: true });
    return [];
  }
}

async function saveAgents({ agentsFile, agents }) {
  await writeJsonAtomic(agentsFile, agents, { trailingNewline: true });
}

module.exports = {
  ensureAgentsFile,
  loadAgents,
  saveAgents
};
