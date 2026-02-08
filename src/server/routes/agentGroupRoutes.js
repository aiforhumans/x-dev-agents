/**
 * Agent group CRUD and run kickoff routes.
 */
const { getBodyObject } = require("../utils/boundary");

function registerAgentGroupRoutes(app, deps) {
  const {
    getAgentGroups,
    findAgentGroup,
    findRun,
    findAgent,
    setRuns,
    getRuns,
    runsLimit,
    saveRuns,
    saveAgentGroups,
    sanitizeAgentGroup,
    sanitizeTrimmedString,
    sanitizeRunCreateInput,
    buildInitialStageStateFromAgentGroup,
    resolveProfileSnapshot,
    sanitizeRunControl,
    sanitizeTimelineMeta,
    canonicalStages,
    buildRequestError,
    randomUUID,
    activePipelineRuns,
    orchestration,
    agentGroupToClient,
    mergeAgentGroupRunDefaults
  } = deps;

  app.get("/api/agent-groups", (req, res) => {
    res.json(getAgentGroups().map(agentGroupToClient));
  });

  app.get("/api/agent-groups/:id", (req, res, next) => {
    try {
      const group = findAgentGroup(req.params.id);
      if (!group) {
        throw buildRequestError(404, "Agent group not found.");
      }
      res.json(agentGroupToClient(group));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/agent-groups", async (req, res, next) => {
    try {
      const groups = getAgentGroups();
      const body = getBodyObject(req);
      const input = sanitizeAgentGroup(body, { strict: true });
      const requestedId = sanitizeTrimmedString(body.groupId ?? body.id, { maxLength: 120 });
      const now = new Date().toISOString();

      if (requestedId) {
        const index = groups.findIndex((group) => group.groupId === requestedId);
        if (index === -1) {
          throw buildRequestError(404, "Agent group not found.");
        }
        const previous = groups[index];
        const updated = {
          ...previous,
          ...input,
          updatedAt: now
        };
        groups[index] = updated;
        await saveAgentGroups();
        res.json(agentGroupToClient(updated));
        return;
      }

      const created = {
        groupId: randomUUID(),
        ...input,
        createdAt: now,
        updatedAt: now
      };
      groups.push(created);
      await saveAgentGroups();
      res.status(201).json(agentGroupToClient(created));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/agent-groups/:id", async (req, res, next) => {
    try {
      const groups = getAgentGroups();
      const index = groups.findIndex((group) => group.groupId === req.params.id);
      if (index === -1) {
        throw buildRequestError(404, "Agent group not found.");
      }

      const body = getBodyObject(req);
      const updates = sanitizeAgentGroup(body, { strict: true });
      const previous = groups[index];
      const updated = {
        ...previous,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      groups[index] = updated;
      await saveAgentGroups();
      res.json(agentGroupToClient(updated));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/agent-groups/:id", async (req, res, next) => {
    try {
      const groups = getAgentGroups();
      const index = groups.findIndex((group) => group.groupId === req.params.id);
      if (index === -1) {
        throw buildRequestError(404, "Agent group not found.");
      }
      groups.splice(index, 1);
      await saveAgentGroups();
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/agent-groups/:id/run", async (req, res, next) => {
    try {
      let runs = getRuns();
      const group = findAgentGroup(req.params.id);
      if (!group) {
        throw buildRequestError(404, "Agent group not found.");
      }

      for (const stage of canonicalStages) {
        const role = stage.role;
        const agentId = group.roles?.[role];
        if (!agentId) {
          throw buildRequestError(400, `Agent group missing roles.${role}.`);
        }
        if (!findAgent(agentId)) {
          throw buildRequestError(400, `Agent group role ${role} references unknown agent: ${agentId}`);
        }
      }

      const body = getBodyObject(req);
      const runInput = sanitizeRunCreateInput(mergeAgentGroupRunDefaults(group, body));
      const now = new Date().toISOString();
      const run = {
        runId: randomUUID(),
        pipelineId: null,
        ...runInput,
        status: "queued",
        runType: "group",
        profileId: runInput.profileId || null,
        profileSnapshot: resolveProfileSnapshot({
          runType: "group",
          sourceId: group.groupId,
          profileId: runInput.profileId,
          profileOverrides: runInput.profileOverrides,
          freezeSettings: runInput.freezeSettings
        }),
        control: sanitizeRunControl({ status: "queued" }),
        timelineMeta: sanitizeTimelineMeta(null),
        groupId: group.groupId,
        groupSnapshot: {
          groupId: group.groupId,
          name: group.name,
          description: group.description,
          roles: { ...group.roles },
          execution: { ...group.execution },
          defaults: group.defaults ? { ...group.defaults } : null
        },
        stageState: buildInitialStageStateFromAgentGroup(group),
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
          currentRun.errorMessage = error.message || "Group orchestration failed.";
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
  registerAgentGroupRoutes
};
