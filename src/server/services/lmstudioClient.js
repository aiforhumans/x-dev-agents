/**
 * LM Studio HTTP client helpers.
 */
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

    return payload;
  }

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
