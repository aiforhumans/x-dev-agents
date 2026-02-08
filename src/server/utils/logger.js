/**
 * Minimal logging helper with optional request-id support.
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

function format(message, context) {
  const requestId = extractRequestId(context);
  const body = String(message || "");
  return requestId ? `[requestId:${requestId}] ${body}` : body;
}

function info(message, context) {
  console.log(format(message, context));
}

function debug(message, context) {
  console.debug(format(message, context));
}

function warn(message, context) {
  console.warn(format(message, context));
}

function error(message, context) {
  console.error(format(message, context));
}

module.exports = {
  info,
  debug,
  warn,
  error
};
