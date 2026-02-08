(function bootstrapApiClient(global) {
  async function request(path, options = {}) {
    const response = await fetch(path, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      ...options
    });

    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }

    if (!response.ok) {
      throw new Error(payload.error || payload.message || `Request failed (${response.status}).`);
    }

    return payload;
  }

  const root = global.AppClient || (global.AppClient = {});
  root.api = {
    request
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
