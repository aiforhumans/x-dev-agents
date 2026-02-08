/**
 * Config repository for data/config.json persistence.
 */
const fs = require("node:fs/promises");
const { readJson, writeJsonAtomic } = require("./jsonStore");

async function ensureConfigFile({ configFile, defaultBaseUrl }) {
  try {
    await fs.access(configFile);
  } catch {
    await writeJsonAtomic(configFile, { baseUrl: defaultBaseUrl });
  }
}

async function loadConfig({ configFile, defaultBaseUrl, normalizeBaseUrl }) {
  const fallback = { baseUrl: defaultBaseUrl };
  const parsed = await readJson(configFile, fallback);
  const candidate = parsed && typeof parsed === "object" ? parsed : fallback;

  try {
    return { baseUrl: normalizeBaseUrl(candidate.baseUrl || defaultBaseUrl) };
  } catch {
    const normalized = { baseUrl: normalizeBaseUrl(defaultBaseUrl) };
    await writeJsonAtomic(configFile, normalized);
    return normalized;
  }
}

async function saveConfig({ configFile, config }) {
  await writeJsonAtomic(configFile, config);
}

module.exports = {
  ensureConfigFile,
  loadConfig,
  saveConfig
};
