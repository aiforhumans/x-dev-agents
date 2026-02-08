/**
 * Agent group repository for data/agent-groups.json persistence.
 */
const fs = require("node:fs/promises");
const { readJson, writeJsonAtomic } = require("./jsonStore");

async function ensureAgentGroupsFile({ agentGroupsFile }) {
  try {
    await fs.access(agentGroupsFile);
  } catch {
    await writeJsonAtomic(agentGroupsFile, [], { trailingNewline: true });
  }
}

async function loadAgentGroups({ agentGroupsFile }) {
  try {
    const parsed = await readJson(agentGroupsFile, [], { strict: true });
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    await writeJsonAtomic(agentGroupsFile, [], { trailingNewline: true });
    return [];
  }
}

async function saveAgentGroups({ agentGroupsFile, agentGroups }) {
  await writeJsonAtomic(agentGroupsFile, agentGroups, { trailingNewline: true });
}

module.exports = {
  ensureAgentGroupsFile,
  loadAgentGroups,
  saveAgentGroups
};
