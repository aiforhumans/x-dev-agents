/**
 * Run CRUD and SSE stream routes.
 */
const { getBodyObject, getQueryObject } = require("../utils/boundary");

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
    sanitizeRunLogs,
    activePipelineRuns
  } = deps;

  app.get("/api/runs", (req, res, next) => {
    try {
      const runs = getRuns();
      const query = getQueryObject(req);
      const pipelineId = sanitizeTrimmedString(query.pipelineId, { maxLength: 120 });
      const groupId = sanitizeTrimmedString(query.groupId, { maxLength: 120 });
      const runType = sanitizeTrimmedString(query.runType, { maxLength: 40 })?.toLowerCase();
      const profileId = sanitizeTrimmedString(query.profileId, { maxLength: 120 });
      const statusQuery = sanitizeTrimmedString(query.status, { maxLength: 240 });
      const limit = clamp(toInteger(query.limit, 100), 1, 500);

      let list = [...runs];
      if (pipelineId) {
        list = list.filter((run) => run.pipelineId === pipelineId);
      }
      if (groupId) {
        list = list.filter((run) => run.groupId === groupId);
      }
      if (runType) {
        list = list.filter((run) => (run.runType || (run.groupId ? "group" : "pipeline")) === runType);
      }
      if (profileId) {
        list = list.filter((run) => run.profileId === profileId);
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
        const terminalEvent =
          run.status === "completed" ? "run_completed" : run.status === "cancelled" ? "run_cancelled" : "run_failed";
        writeSse(res, terminalEvent, {
          runId: run.runId,
          pipelineId: run.pipelineId,
          groupId: run.groupId || null,
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
        groupId: run.groupId || null,
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
      const body = getBodyObject(req);
      const input = sanitizeRunCreate(body);
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
      const body = getBodyObject(req);
      const updates = sanitizeRunUpdate(body, previous);
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

      const body = getBodyObject(req);
      const logs = sanitizeRunLogs([body]);
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

  app.post("/api/runs/:runId/control", async (req, res, next) => {
    try {
      const run = findRun(req.params.runId);
      if (!run) {
        throw buildRequestError(404, "Run not found.");
      }

      const body = getBodyObject(req);
      const action = sanitizeTrimmedString(body.action, { maxLength: 40 })?.toLowerCase();
      if (!action) {
        throw buildRequestError(400, "Run control action is required.");
      }

      if (!run.control || typeof run.control !== "object") {
        run.control = {
          status: run.status || "queued",
          resumeFromStageId: null,
          cancelRequestedAt: null
        };
      }

      if (action === "cancel") {
        run.control.status = "cancelling";
        run.control.cancelRequestedAt = new Date().toISOString();
        run.status = "cancelling";
        run.updatedAt = run.control.cancelRequestedAt;
        await saveRuns();
        orchestration.streamRunEvent(run, "run_cancel_requested", { status: run.status });
        res.json({ ok: true, runId: run.runId, status: run.status, acceptedAction: action });
        return;
      }

      if (action === "pause") {
        if (run.status !== "running") {
          throw buildRequestError(400, "Run must be running to pause.");
        }
        run.control.status = "paused";
        run.status = "paused";
        run.updatedAt = new Date().toISOString();
        await saveRuns();
        orchestration.streamRunEvent(run, "run_paused", { status: run.status });
        res.json({ ok: true, runId: run.runId, status: run.status, acceptedAction: action });
        return;
      }

      if (action === "resume") {
        const fromStageId = sanitizeTrimmedString(body.fromStageId, { maxLength: 80, allowEmpty: true }) || null;
        run.control.status = "running";
        run.control.resumeFromStageId = fromStageId;
        run.status = "running";
        run.updatedAt = new Date().toISOString();
        if (!activePipelineRuns.has(run.runId)) {
          const execution = orchestration.runPipelineOrchestration(run.runId).catch(() => {
            // orchestration handles error state.
          });
          activePipelineRuns.set(run.runId, execution);
        }
        await saveRuns();
        orchestration.streamRunEvent(run, "run_resumed", { status: run.status, fromStageId });
        res.json({ ok: true, runId: run.runId, status: run.status, acceptedAction: action });
        return;
      }

      if (action === "retry_stage") {
        const stageId = sanitizeTrimmedString(body.stageId, { maxLength: 80 })?.toLowerCase();
        if (!stageId || !run.stageState?.[stageId]) {
          throw buildRequestError(400, "A valid stageId is required for retry_stage.");
        }
        for (const entry of Object.values(run.stageState || {})) {
          if (!entry || typeof entry !== "object") {
            continue;
          }
          if (entry.stageId === stageId || entry.status === "failed") {
            entry.status = "pending";
            entry.startedAt = null;
            entry.completedAt = null;
            entry.error = null;
          }
        }
        run.failedStage = null;
        run.errorMessage = null;
        run.errorAt = null;
        run.control.status = "running";
        run.control.resumeFromStageId = stageId;
        run.status = "running";
        run.updatedAt = new Date().toISOString();
        await saveRuns();
        orchestration.streamRunEvent(run, "stage_retry_started", { stageId, status: run.status });
        if (!activePipelineRuns.has(run.runId)) {
          const execution = orchestration.runPipelineOrchestration(run.runId).catch(() => {
            // orchestration handles error state.
          });
          activePipelineRuns.set(run.runId, execution);
        }
        res.json({ ok: true, runId: run.runId, status: run.status, acceptedAction: action });
        return;
      }

      throw buildRequestError(400, `Unsupported run control action: ${action}`);
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
