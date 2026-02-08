/**
 * Structured logging helper with optional request-id support.
 */
function extractRequestId(context) {
  if (!context) {
    return null;
  }

  if (typeof context === "object") {
    if (context.requestId) {
      return String(context.requestId);
    }
    if (context.req) {
      const fromReq = context.req.requestId || context.req.id || context.req.headers?.["x-request-id"];
      if (fromReq) {
        return String(fromReq);
      }
    }
    if (context.headers?.["x-request-id"]) {
      return String(context.headers["x-request-id"]);
    }
  }

  return null;
}

function buildEntry(level, message, context) {
  const requestId = extractRequestId(context);
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: String(message || "")
  };

  if (requestId) {
    entry.requestId = requestId;
  }

  if (context && typeof context === "object") {
    if (context.req) {
      entry.method = context.req.method;
      entry.path = context.req.originalUrl || context.req.url;
    }
    if (context.statusCode !== undefined) {
      entry.statusCode = context.statusCode;
    }
    if (context.durationMs !== undefined) {
      entry.durationMs = context.durationMs;
    }
  }

  return entry;
}

function write(level, message, context) {
  const entry = buildEntry(level, message, context);
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  if (level === "debug") {
    console.debug(line);
    return;
  }
  console.log(line);
}

function info(message, context) {
  write("info", message, context);
}

function debug(message, context) {
  write("debug", message, context);
}

function warn(message, context) {
  write("warn", message, context);
}

function error(message, context) {
  write("error", message, context);
}

module.exports = {
  info,
  debug,
  warn,
  error
};
