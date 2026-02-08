function extractJsonObjectFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }

  const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // continue
    }
  }

  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch && objectMatch[0]) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // continue
    }
  }

  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch && arrayMatch[0]) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch {
      // continue
    }
  }

  return null;
}

function agentSupportsSearxLikeRetrieval(agent) {
  const integrations = Array.isArray(agent?.integrations) ? agent.integrations : [];
  return integrations.some((entry) => {
    if (typeof entry === "string") {
      return /searx|search|retrieval/i.test(entry);
    }
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const id = String(entry.id || entry.server_label || entry.serverLabel || "").trim();
    const url = String(entry.server_url || entry.serverUrl || "").trim();
    return /searx|search|retrieval/i.test(id) || /searx/i.test(url);
  });
}

module.exports = {
  extractJsonObjectFromText,
  agentSupportsSearxLikeRetrieval
};
