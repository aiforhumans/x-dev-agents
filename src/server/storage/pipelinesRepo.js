/**
 * Pipeline repository for data/pipelines.json persistence.
 */
const fs = require("node:fs/promises");
const { readJson, writeJsonAtomic } = require("./jsonStore");

async function ensurePipelinesFile({ pipelinesFile }) {
  try {
    await fs.access(pipelinesFile);
  } catch {
    await writeJsonAtomic(pipelinesFile, [], { trailingNewline: true });
  }
}

async function loadPipelines({ pipelinesFile }) {
  try {
    const parsed = await readJson(pipelinesFile, [], { strict: true });
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    await writeJsonAtomic(pipelinesFile, [], { trailingNewline: true });
    return [];
  }
}

async function savePipelines({ pipelinesFile, pipelines }) {
  await writeJsonAtomic(pipelinesFile, pipelines, { trailingNewline: true });
}

module.exports = {
  ensurePipelinesFile,
  loadPipelines,
  savePipelines
};
