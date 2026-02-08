const { randomUUID } = require("node:crypto");

function createRequestIdMiddleware() {
  return (req, res, next) => {
    const incoming = req.headers?.["x-request-id"];
    const requestId = typeof incoming === "string" && incoming.trim() ? incoming.trim() : randomUUID();
    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    next();
  };
}

function createRequestLoggingMiddleware({ logger }) {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      const elapsedNs = process.hrtime.bigint() - startedAt;
      const durationMs = Number(elapsedNs) / 1_000_000;
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      logger[level]("request.completed", {
        req,
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(2))
      });
    });
    next();
  };
}

module.exports = {
  createRequestIdMiddleware,
  createRequestLoggingMiddleware
};
