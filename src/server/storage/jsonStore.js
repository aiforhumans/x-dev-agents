/**
 * Generic JSON file helpers for runtime persistence.
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function stripUtf8Bom(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function readJson(filePath, fallback) {
  try {
    const contents = stripUtf8Bom(await fs.readFile(filePath, "utf-8"));
    return JSON.parse(contents);
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(filePath, data, { pretty = 2, trailingNewline = false } = {}) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });

  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const serialized = JSON.stringify(data, null, pretty) + (trailingNewline ? "\n" : "");
  await fs.writeFile(tempPath, serialized, "utf-8");
  await fs.rename(tempPath, filePath);
}

module.exports = {
  readJson,
  writeJsonAtomic
};
