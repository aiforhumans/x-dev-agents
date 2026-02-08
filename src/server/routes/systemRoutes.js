/**
 * System/config/model routes.
 */
function registerSystemRoutes(app, deps) {
  const {
    getConfig,
    getNativeApiBaseUrl,
    getAgents,
    getPipelines,
    getRuns,
    normalizeBaseUrl,
    saveConfig,
    lmStudioJsonRequest
  } = deps;

  app.get("/api/health", (req, res) => {
    const config = getConfig();
    res.json({
      ok: true,
      baseUrl: config.baseUrl,
      nativeApiBaseUrl: getNativeApiBaseUrl(),
      agentCount: getAgents().length,
      pipelineCount: getPipelines().length,
      runCount: getRuns().length
    });
  });

  app.get("/api/config", (req, res) => {
    res.json(getConfig());
  });

  app.put("/api/config", async (req, res, next) => {
    try {
      const config = getConfig();
      config.baseUrl = normalizeBaseUrl(req.body?.baseUrl);
      await saveConfig();
      res.json(config);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/models", async (req, res, next) => {
    try {
      try {
        const payload = await lmStudioJsonRequest({ endpoint: "/models", native: true });
        const models = Array.isArray(payload?.models)
          ? payload.models
              .filter((model) => model && typeof model === "object")
              .filter((model) => model.type === "llm" || !model.type)
              .map((model) => model.key || model.id)
              .filter(Boolean)
          : [];
        if (models.length || Array.isArray(payload?.models)) {
          res.json({ models });
          return;
        }
      } catch {
        // Fallback to OpenAI-compatible models endpoint.
      }

      const payload = await lmStudioJsonRequest({ endpoint: "/models", native: false });
      const models = Array.isArray(payload?.data) ? payload.data.map((item) => item.id).filter(Boolean) : [];
      res.json({ models });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  registerSystemRoutes
};
