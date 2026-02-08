/**
 * Lightweight request boundary helpers.
 */

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Safely returns an object-like body payload.
 * Keeps behavior permissive by falling back to an empty object.
 *
 * @param {import("express").Request} req
 * @returns {Record<string, any>}
 */
function getBodyObject(req) {
  return isRecord(req?.body) ? req.body : {};
}

/**
 * Safely returns an object-like query payload.
 *
 * @param {import("express").Request} req
 * @returns {Record<string, any>}
 */
function getQueryObject(req) {
  return isRecord(req?.query) ? req.query : {};
}

module.exports = {
  isRecord,
  getBodyObject,
  getQueryObject
};
