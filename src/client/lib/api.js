/**
 * Lightweight typed API client wrappers for the browser UI.
 * Runtime migration from `public/app.js` can progressively adopt this module.
 */

/**
 * @typedef {Object} ApiRequestOptions
 * @property {string} [method]
 * @property {any} [body]
 * @property {Record<string, string>} [headers]
 */

/**
 * @typedef {Object} Agent
 * @property {string} id
 * @property {string} name
 * @property {string} model
 */

/**
 * @typedef {Object} Pipeline
 * @property {string} id
 * @property {string} name
 */

/**
 * @typedef {Object} Run
 * @property {string} runId
 * @property {string} pipelineId
 * @property {string} status
 */

/**
 * @param {string} path
 * @param {ApiRequestOptions} [options]
 */
async function request(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  } else {
    payload = {};
  }

  if (!response.ok) {
    const message =
      payload?.error?.message || payload?.error || payload?.message || `Request failed (${response.status}).`;
    const error = new Error(String(message));
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function getConfig() {
  return request("/api/config");
}

async function getModels() {
  return request("/api/models");
}

/**
 * @returns {Promise<Agent[]>}
 */
async function getAgents() {
  return request("/api/agents");
}

/**
 * @returns {Promise<Pipeline[]>}
 */
async function getPipelines() {
  return request("/api/pipelines");
}

/**
 * @returns {Promise<Run[]>}
 */
async function getRuns() {
  return request("/api/runs");
}

module.exports = {
  request,
  getConfig,
  getModels,
  getAgents,
  getPipelines,
  getRuns
};
