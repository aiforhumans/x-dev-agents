/**
 * Run CRUD and SSE stream routes.
 */
function registerRunRoutes(app, deps) {
  const {
    getRuns,
    setRuns,
    findRun,
    findPipeline,
    runToClient,
    sanitizeTrimmedString,
    clamp,
    toInteger,
    runStatusValues,
    buildRequestError,
    openSse,
    writeSse,
    closeSse,
    orchestration,
    runStreamHeartbeatMs,
    runStreamSubscribers,
    sanitizeRunCreate,
    runsLimit,
    randomUUID,
    saveRuns,
    sanitizeRunUpdate,
    sanitizeRunLogs
  } = deps;

  app.get("/api/runs", (req, res, next) => {
    try {
      const runs = getRuns();
      const pipelineId = sanitizeTrimmedString(req.query?.pipelineId, { maxLength: 120 });
      const statusQuery = sanitizeTrimmedString(req.query?.status, { maxLength: 240 });
      const limit = clamp(toInteger(req.query?.limit, 100), 1, 500);

      let list = [...runs];
      if (pipelineId) {
        list = list.filter((run) => run.pipelineId === pipelineId);
      }

      if (statusQuery) {
        const statuses = statusQuery
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean);

        for (const status of statuses) {
          if (!runStatusValues.has(status)) {
            throw buildRequestError(400, `Unsupported run status filter: ${status}`);
          }
        }
        list = list.filter((run) => statuses.includes(run.status));
      }

      list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      res.json(list.slice(0, limit).map(runToClient));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/runs/:runId", (req, res, next) => {
    try {
      const run = findRun(req.params.runId);
      if (!run) {
        throw buildRequestError(404, "Run not found.");
      }
      res.json(runToClient(run));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/runs/:runId/stream", (req, res, next) => {
    try {
      const run = findRun(req.params.runId);
      if (!run) {
        throw buildRequestError(404, "Run not found.");
      }

      openSse(res);

      const isTerminal = run.status === "completed" || run.status === "failed" || run.status === "cancelled";
      if (isTerminal) {
        const terminalEvent = run.status === "completed" ? "run_completed" : "run_failed";
        writeSse(res, terminalEvent, {
          runId: run.runId,
          pipelineId: run.pipelineId,
          status: run.status,
          stageState: run.stageState,
          failedStage: run.failedStage,
          error: run.errorMessage
        });
        closeSse(res);
        return;
      }

      const subscribers = orchestration.getRunSubscribers(run.runId);
      subscribers.add(res);

      writeSse(res, "run_started", {
        runId: run.runId,
        pipelineId: run.pipelineId,
        status: run.status,
        stageState: run.stageState
      });

      const heartbeat = setInterval(() => {
        try {
          writeSse(res, "heartbeat", { runId: run.runId, at: new Date().toISOString() });
        } catch {
          // ignore write errors
        }
      }, runStreamHeartbeatMs);

      req.on("close", () => {
        clearInterval(heartbeat);
        subscribers.delete(res);
        if (!subscribers.size) {
          runStreamSubscribers.delete(run.runId);
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/runs", async (req, res, next) => {
    try {
      let runs = getRuns();
      const input = sanitizeRunCreate(req.body);
      const pipeline = findPipeline(input.pipelineId);
      const now = new Date().toISOString();
      const run = {
        runId: randomUUID(),
        ...input,
        outputs: input.outputs.length ? input.outputs : pipeline?.outputs || [],
        createdAt: now,
        updatedAt: now
      };

      runs.unshift(run);
      if (runs.length > runsLimit) {
        runs = runs.slice(0, runsLimit);
        setRuns(runs);
      }
      await saveRuns();
      res.status(201).json(runToClient(run));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/runs/:runId", async (req, res, next) => {
    try {
      const runs = getRuns();
      const index = runs.findIndex((run) => run.runId === req.params.runId);
      if (index === -1) {
        throw buildRequestError(404, "Run not found.");
      }

      const previous = runs[index];
      const updates = sanitizeRunUpdate(req.body, previous);
      const updated = {
        ...previous,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      runs[index] = updated;
      await saveRuns();
      res.json(runToClient(updated));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/runs/:runId/logs", async (req, res, next) => {
    try {
      const run = findRun(req.params.runId);
      if (!run) {
        throw buildRequestError(404, "Run not found.");
      }

      const logs = sanitizeRunLogs([req.body]);
      if (!logs.length) {
        throw buildRequestError(400, "A non-empty log message is required.");
      }

      run.logs = [...run.logs, ...logs].slice(-5000);
      run.updatedAt = new Date().toISOString();
      await saveRuns();
      res.status(201).json(runToClient(run));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/runs/:runId", async (req, res, next) => {
    try {
      const runs = getRuns();
      const index = runs.findIndex((run) => run.runId === req.params.runId);
      if (index === -1) {
        throw buildRequestError(404, "Run not found.");
      }

      runs.splice(index, 1);
      await saveRuns();
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  registerRunRoutes
};
