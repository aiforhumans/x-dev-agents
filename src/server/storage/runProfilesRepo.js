/**
 * Run profile repository for data/run-profiles.json persistence.
 */
const fs = require("node:fs/promises");
const { readJson, writeJsonAtomic } = require("./jsonStore");

async function ensureRunProfilesFile({ runProfilesFile }) {
  try {
    await fs.access(runProfilesFile);
  } catch {
    await writeJsonAtomic(runProfilesFile, [], { trailingNewline: true });
  }
}

async function loadRunProfiles({ runProfilesFile }) {
  try {
    const parsed = await readJson(runProfilesFile, [], { strict: true });
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    await writeJsonAtomic(runProfilesFile, [], { trailingNewline: true });
    return [];
  }
}

async function saveRunProfiles({ runProfilesFile, runProfiles }) {
  await writeJsonAtomic(runProfilesFile, runProfiles, { trailingNewline: true });
}

module.exports = {
  ensureRunProfilesFile,
  loadRunProfiles,
  saveRunProfiles
};
