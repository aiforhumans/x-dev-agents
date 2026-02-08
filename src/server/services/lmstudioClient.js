/**
 * LM Studio HTTP client helpers.
 */
const { coerceLmStudioChatResponse } = require("../../shared/types/contracts");

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function createLmStudioClient({
  getNativeApiBaseUrl,
  getOpenAIBaseUrl,
  buildRequestError,
  fetchImpl = fetch
}) {
  /**
   * @param {{ endpoint: string, method?: string, body?: any, native?: boolean }} params
   */
  async function jsonRequest({ endpoint, method = "GET", body = null, native = true }) {
    const baseUrl = native ? getNativeApiBaseUrl() : getOpenAIBaseUrl();
    const response = await fetchImpl(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      const message =
        payload?.error?.message ||
        payload?.error ||
        payload?.message ||
        `LM Studio request failed (${response.status}).`;
      throw buildRequestError(response.status, String(message));
    }

    if (endpoint === "/chat" && String(method).toUpperCase() === "POST") {
      return coerceLmStudioChatResponse(payload);
    }

    return payload;
  }

  /**
   * @param {{ endpoint: string, body: any }} params
   */
  async function streamRequest({ endpoint, body }) {
    const baseUrl = getNativeApiBaseUrl();
    return fetchImpl(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  }

  return {
    jsonRequest,
    streamRequest
  };
}

module.exports = {
  createLmStudioClient,
  parseJsonResponse
};
