/**
 * System/config/model routes.
 */
const { getBodyObject } = require("../utils/boundary");

function registerSystemRoutes(app, deps) {
  const {
    getConfig,
    getNativeApiBaseUrl,
    getAgents,
    getPipelines,
    getRuns,
    normalizeBaseUrl,
    saveConfig,
    lmStudioJsonRequest,
    modelCacheTtlMs = 15_000
  } = deps;
  let modelCache = {
    expiresAt: 0,
    models: null
  };

  function readCachedModels() {
    if (!Array.isArray(modelCache.models)) {
      return null;
    }
    if (Date.now() > modelCache.expiresAt) {
      return null;
    }
    return modelCache.models;
  }

  function writeCachedModels(models) {
    modelCache = {
      expiresAt: Date.now() + modelCacheTtlMs,
      models: Array.isArray(models) ? [...models] : []
    };
  }

  function resetModelCache() {
    modelCache = {
      expiresAt: 0,
      models: null
    };
  }

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
      const body = getBodyObject(req);
      const config = getConfig();
      config.baseUrl = normalizeBaseUrl(body.baseUrl);
      await saveConfig();
      resetModelCache();
      res.json(config);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/models", async (req, res, next) => {
    try {
      const cached = readCachedModels();
      if (cached) {
        res.json({ models: cached });
        return;
      }

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
          writeCachedModels(models);
          res.json({ models });
          return;
        }
      } catch {
        // Fallback to OpenAI-compatible models endpoint.
      }

      const payload = await lmStudioJsonRequest({ endpoint: "/models", native: false });
      const models = Array.isArray(payload?.data) ? payload.data.map((item) => item.id).filter(Boolean) : [];
      writeCachedModels(models);
      res.json({ models });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  registerSystemRoutes
};
