/**
 * Pipeline template and run kickoff routes.
 */
function registerPipelineRoutes(app, deps) {
  const {
    getPipelines,
    findPipeline,
    pipelineToClient,
    sanitizePipeline,
    sanitizeTrimmedString,
    buildRequestError,
    savePipelines,
    randomUUID,
    orchestration,
    sanitizeRunCreate,
    getRuns,
    setRuns,
    runsLimit,
    saveRuns,
    activePipelineRuns,
    findRun
  } = deps;

  app.get("/api/pipelines", (req, res) => {
    res.json(getPipelines().map(pipelineToClient));
  });

  app.get("/api/pipelines/:id", (req, res, next) => {
    try {
      const pipeline = findPipeline(req.params.id);
      if (!pipeline) {
        throw buildRequestError(404, "Pipeline not found.");
      }
      res.json(pipelineToClient(pipeline));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/pipelines", async (req, res, next) => {
    try {
      const pipelines = getPipelines();
      const input = sanitizePipeline(req.body, { strict: true });
      const requestedId = sanitizeTrimmedString(req.body?.id, { maxLength: 120 });
      const now = new Date().toISOString();

      if (requestedId) {
        const index = pipelines.findIndex((pipeline) => pipeline.id === requestedId);
        if (index === -1) {
          throw buildRequestError(404, "Pipeline not found.");
        }
        const previous = pipelines[index];
        const updated = {
          ...previous,
          ...input,
          updatedAt: now
        };
        pipelines[index] = updated;
        await savePipelines();
        res.json(pipelineToClient(updated));
        return;
      }

      const created = {
        id: randomUUID(),
        ...input,
        createdAt: now,
        updatedAt: now
      };

      pipelines.push(created);
      await savePipelines();
      res.status(201).json(pipelineToClient(created));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/pipelines/:id", async (req, res, next) => {
    try {
      const pipelines = getPipelines();
      const index = pipelines.findIndex((pipeline) => pipeline.id === req.params.id);
      if (index === -1) {
        throw buildRequestError(404, "Pipeline not found.");
      }

      const updates = sanitizePipeline(req.body, { strict: true });
      const previous = pipelines[index];
      const updated = {
        ...previous,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      pipelines[index] = updated;
      await savePipelines();
      res.json(pipelineToClient(updated));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/pipelines/:id", async (req, res, next) => {
    try {
      const pipelines = getPipelines();
      const index = pipelines.findIndex((pipeline) => pipeline.id === req.params.id);
      if (index === -1) {
        throw buildRequestError(404, "Pipeline not found.");
      }

      pipelines.splice(index, 1);
      await savePipelines();
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/pipelines/:id/run", async (req, res, next) => {
    try {
      let runs = getRuns();
      const pipeline = findPipeline(req.params.id);
      orchestration.ensurePipelineReadyForRun(pipeline);

      const runInput = sanitizeRunCreate({
        ...req.body,
        pipelineId: pipeline.id
      });

      const now = new Date().toISOString();
      const run = {
        runId: randomUUID(),
        ...runInput,
        status: "queued",
        createdAt: now,
        updatedAt: now
      };

      runs.unshift(run);
      if (runs.length > runsLimit) {
        runs = runs.slice(0, runsLimit);
        setRuns(runs);
      }
      await saveRuns();

      if (!activePipelineRuns.has(run.runId)) {
        const execution = orchestration.runPipelineOrchestration(run.runId).catch((error) => {
          const currentRun = findRun(run.runId);
          if (!currentRun) {
            return;
          }
          currentRun.status = "failed";
          currentRun.failedStage = currentRun.failedStage || "unknown";
          currentRun.errorMessage = error.message || "Pipeline orchestration failed.";
          currentRun.errorAt = new Date().toISOString();
          currentRun.updatedAt = currentRun.errorAt;
          orchestration.appendRunLog(currentRun, "error", currentRun.errorMessage);
          orchestration
            .saveRunsAndBroadcast(currentRun, "run_failed", {
              stageId: currentRun.failedStage,
              error: currentRun.errorMessage
            })
            .finally(() => orchestration.closeRunStream(currentRun.runId));
        });
        activePipelineRuns.set(run.runId, execution);
      }

      res.status(202).json({ runId: run.runId });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  registerPipelineRoutes
};
