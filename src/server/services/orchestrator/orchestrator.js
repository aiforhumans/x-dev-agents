/**
 * Pipeline orchestration engine for multi-stage runs and run SSE events.
 */
const { buildStagePrompt } = require("./stages");
const { extractJsonObjectFromText, agentSupportsSearxLikeRetrieval } = require("./evidence");
const { buildArtifact, pushRunArtifact } = require("./artifacts");

function createOrchestrator({
  canonicalStages,
  runStreamSubscribers,
  activePipelineRuns,
  saveRuns,
  findRun,
  findPipeline,
  findAgent,
  parseSseBlock,
  parseJsonResponse,
  lmStudioStreamRequest,
  buildRequestError,
  sanitizeStats,
  sanitizeRunEvidence,
  sanitizeStringArray,
  isPlainObject,
  toBoolean,
  buildChatRequest,
  enrichMessageWithSearch,
  randomUUID,
  writeSse,
  searchOnline
}) {
  function stageById(stageId) {
    return canonicalStages.find((stage) => stage.stageId === stageId) || null;
  }

  function setRunStageStatus(run, stageId, status, patch = {}) {
    if (!run?.stageState || !run.stageState[stageId]) {
      return;
    }
    const entry = run.stageState[stageId];
    entry.status = status;
    if (status === "running") {
      entry.startedAt = entry.startedAt || new Date().toISOString();
    }
    if (status === "completed" || status === "failed") {
      entry.completedAt = new Date().toISOString();
    }
    if (patch.agentId !== undefined) {
      entry.agentId = patch.agentId;
    }
    if (patch.error !== undefined) {
      entry.error = patch.error;
    }
    if (patch.stats !== undefined) {
      entry.stats = patch.stats;
    }
    if (Array.isArray(patch.artifacts)) {
      entry.artifacts = patch.artifacts;
    }
  }

  function normalizeToolEventPayload(event, data) {
    if (!data || typeof data !== "object") {
      return null;
    }

    const payload = {
      event,
      type: String(data.type || event || "").toLowerCase()
    };

    if (data.tool) {
      payload.tool = data.tool;
    }
    if (data.arguments !== undefined) {
      payload.arguments = data.arguments;
    }
    if (data.output !== undefined) {
      payload.output = data.output;
    }
    if (data.provider_info !== undefined) {
      payload.providerInfo = data.provider_info;
    } else if (data.providerInfo !== undefined) {
      payload.providerInfo = data.providerInfo;
    }

    return payload;
  }

  function appendRunLog(run, level, message, { stageId = null } = {}) {
    run.logs.push({
      at: new Date().toISOString(),
      level,
      message: String(message || ""),
      ...(stageId ? { stageId } : {})
    });
    run.logs = run.logs.slice(-5000);
  }

  function getRunSubscribers(runId) {
    if (!runStreamSubscribers.has(runId)) {
      runStreamSubscribers.set(runId, new Set());
    }
    return runStreamSubscribers.get(runId);
  }

  function streamRunEvent(run, event, payload = {}) {
    const subscribers = runStreamSubscribers.get(run.runId);
    if (!subscribers || !subscribers.size) {
      return;
    }

    const data = {
      runId: run.runId,
      pipelineId: run.pipelineId,
      at: new Date().toISOString(),
      ...payload
    };

    for (const res of subscribers) {
      try {
        writeSse(res, event, data);
      } catch {
        // Ignore write failures; connection cleanup handles stale clients.
      }
    }
  }

  function closeRunStream(runId) {
    const subscribers = runStreamSubscribers.get(runId);
    if (!subscribers) {
      return;
    }
    for (const res of subscribers) {
      try {
        res.end();
      } catch {
        // Ignore.
      }
    }
    runStreamSubscribers.delete(runId);
  }

  async function saveRunsAndBroadcast(run, event = null, payload = null) {
    await saveRuns();
    if (event) {
      streamRunEvent(run, event, payload || {});
    }
  }

  function resolveStageToolsPolicy(run, pipeline, stageId) {
    const runPolicy = isPlainObject(run?.toolsPolicy) ? run.toolsPolicy : null;
    const pipelinePolicy = isPlainObject(pipeline?.toolsPolicy) ? pipeline.toolsPolicy : null;
    const rootPolicy = runPolicy || pipelinePolicy || {};
    const defaultPolicy = isPlainObject(rootPolicy.default) ? rootPolicy.default : {};
    const stagePolicyRaw = isPlainObject(rootPolicy.byStage?.[stageId]) ? rootPolicy.byStage[stageId] : {};

    return {
      allowWebSearch:
        stagePolicyRaw.allowWebSearch !== undefined
          ? toBoolean(stagePolicyRaw.allowWebSearch, false)
          : toBoolean(defaultPolicy.allowWebSearch, false),
      allowedTools: sanitizeStringArray(stagePolicyRaw.allowedTools ?? defaultPolicy.allowedTools, {
        maxItems: 200,
        maxLength: 200
      }),
      allowedIntegrations: sanitizeStringArray(stagePolicyRaw.allowedIntegrations ?? defaultPolicy.allowedIntegrations, {
        maxItems: 200,
        maxLength: 320
      })
    };
  }

  function applyIntegrationPolicy(agent, stagePolicy) {
    if (!stagePolicy.allowedIntegrations.length) {
      return agent;
    }

    const allowed = new Set(stagePolicy.allowedIntegrations.map((item) => String(item || "").trim()).filter(Boolean));
    const integrations = (Array.isArray(agent.integrations) ? agent.integrations : []).filter((integration) => {
      if (typeof integration === "string") {
        return allowed.has(integration);
      }
      if (!integration || typeof integration !== "object") {
        return false;
      }
      const key = String(integration.id || integration.server_label || integration.serverLabel || "").trim();
      return key ? allowed.has(key) : false;
    });

    return {
      ...agent,
      integrations
    };
  }

  function composeStagePayload(agent, stagePrompt, { reset = true } = {}) {
    const parts = [{ type: "message", content: stagePrompt }];
    return buildChatRequest(agent, parts, { stream: true, reset });
  }

  async function executeLmStudioStage({
    run,
    pipeline,
    stageId,
    agent,
    promptText,
    allowSearchFallback = false
  }) {
    const stagePolicy = resolveStageToolsPolicy(run, pipeline, stageId);
    const agentWithPolicy = applyIntegrationPolicy(agent, stagePolicy);
    const payload = composeStagePayload(agentWithPolicy, promptText, { reset: true });
    let enrichedInputParts = [{ type: "message", content: promptText }];
    if (
      allowSearchFallback &&
      stagePolicy.allowWebSearch &&
      !agentSupportsSearxLikeRetrieval(agentWithPolicy) &&
      toBoolean(agentWithPolicy.webSearch, true)
    ) {
      enrichedInputParts = await enrichMessageWithSearch({ webSearch: true }, enrichedInputParts);
      payload.input = enrichedInputParts.length === 1 ? enrichedInputParts[0].content : enrichedInputParts;
    }
    payload.stream = true;

    const upstream = await lmStudioStreamRequest({
      endpoint: "/chat",
      body: payload
    });

    if (!upstream.ok) {
      const payloadError = await parseJsonResponse(upstream);
      const message =
        payloadError?.error?.message ||
        payloadError?.error ||
        payloadError?.message ||
        `LM Studio streaming request failed (${upstream.status}).`;
      throw buildRequestError(upstream.status, String(message));
    }
    if (!upstream.body) {
      throw buildRequestError(502, "No stream body returned by LM Studio.");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult = null;
    let assistantText = "";
    const toolEvents = [];

    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true });

      while (true) {
        const boundaryMatch = buffer.match(/\r?\n\r?\n/);
        if (!boundaryMatch || boundaryMatch.index === undefined) {
          break;
        }
        const boundaryIndex = boundaryMatch.index;
        const boundaryLength = boundaryMatch[0].length;
        const block = buffer.slice(0, boundaryIndex).trim();
        buffer = buffer.slice(boundaryIndex + boundaryLength);
        if (!block) {
          continue;
        }

        const parsed = parseSseBlock(block);
        if (!parsed) {
          continue;
        }

        const { event, data } = parsed;
        if (event === "chat.end" && data && typeof data === "object" && data.result) {
          finalResult = data.result;
        } else if (event === "message.delta" && data && typeof data === "object") {
          const delta = String(data.content || "");
          if (delta) {
            assistantText += delta;
            streamRunEvent(run, "assistant_delta", { stageId, delta });
          }
        } else if (/tool_call|tool\.call|tool_call\.delta/i.test(event)) {
          const payloadEvent = normalizeToolEventPayload("tool_call", data);
          if (payloadEvent) {
            toolEvents.push(payloadEvent);
            streamRunEvent(run, "tool_call", { stageId, ...payloadEvent });
          }
        } else if (/tool_result|tool\.result|tool_output/i.test(event)) {
          const payloadEvent = normalizeToolEventPayload("tool_result", data);
          if (payloadEvent) {
            toolEvents.push(payloadEvent);
            streamRunEvent(run, "tool_result", { stageId, ...payloadEvent });
          }
        }
      }
    }

    if (!finalResult) {
      finalResult = {
        output: [{ type: "message", content: assistantText }],
        response_id: null,
        stats: null
      };
    }

    if (!assistantText) {
      const outputItems = Array.isArray(finalResult.output) ? finalResult.output : [];
      assistantText = outputItems
        .filter((item) => String(item?.type || "").toLowerCase() === "message")
        .map((item) => String(item?.content || ""))
        .join("");
    }

    const outputItems = Array.isArray(finalResult.output) ? finalResult.output : [];
    for (const item of outputItems) {
      const type = String(item?.type || "").trim().toLowerCase();
      if (type === "tool_call") {
        const payloadEvent = normalizeToolEventPayload("tool_call", item);
        if (payloadEvent) {
          toolEvents.push(payloadEvent);
          streamRunEvent(run, "tool_call", { stageId, ...payloadEvent });
        }
      }
      if (type === "tool_result") {
        const payloadEvent = normalizeToolEventPayload("tool_result", item);
        if (payloadEvent) {
          toolEvents.push(payloadEvent);
          streamRunEvent(run, "tool_result", { stageId, ...payloadEvent });
        }
      }
    }

    return {
      prompt: promptText,
      responseText: assistantText,
      result: finalResult,
      toolEvents,
      input: enrichedInputParts
    };
  }

  async function persistStageArtifacts(run, stageId, stageResult) {
    const stage = stageById(stageId);
    const artifactNames = stage?.defaultArtifactNames || [];
    const artifactsCreated = [];
    const text = String(stageResult?.responseText || "");
    const now = new Date().toISOString();

    if (stageId === "discovery") {
      let evidenceJson = extractJsonObjectFromText(text);
      const ddgFallback = [];
      if (!evidenceJson) {
        try {
          const query = run.topic;
          const results = await searchOnline(query);
          for (const item of results) {
            ddgFallback.push({
              sourceId: randomUUID(),
              title: item.title || "",
              url: item.url || "",
              snippet: item.snippet || "",
              snapshot: item.snippet || "",
              retrievedAt: now
            });
          }
        } catch {
          // ignore
        }
        evidenceJson = ddgFallback;
      }
      if (!Array.isArray(evidenceJson)) {
        evidenceJson = [evidenceJson].filter(Boolean);
      }

      run.evidence = sanitizeRunEvidence(evidenceJson);
      const evidenceArtifact = buildArtifact(run, {
        stageId,
        name: artifactNames[0] || "evidence.json",
        content: JSON.stringify(run.evidence, null, 2),
        type: "application/json",
        randomUUID
      });
      const notesArtifact = buildArtifact(run, {
        stageId,
        name: artifactNames[1] || "reading_notes.md",
        content: text || "No reading notes generated.",
        randomUUID
      });
      artifactsCreated.push(evidenceArtifact, notesArtifact);
    } else if (stageId === "synthesis") {
      const claimsTable = extractJsonObjectFromText(text) || [];
      artifactsCreated.push(
        buildArtifact(run, {
          stageId,
          name: artifactNames[0] || "foundation_report.md",
          content: text || "No foundation report generated.",
          randomUUID
        }),
        buildArtifact(run, {
          stageId,
          name: artifactNames[1] || "claims_table.json",
          content: JSON.stringify(Array.isArray(claimsTable) ? claimsTable : [claimsTable], null, 2),
          type: "application/json",
          randomUUID
        })
      );
    } else if (stageId === "draft") {
      artifactsCreated.push(
        buildArtifact(run, {
          stageId,
          name: artifactNames[0] || "draft_longform.md",
          content: text || "No draft generated.",
          randomUUID
        })
      );
    } else if (stageId === "adapt") {
      artifactsCreated.push(
        buildArtifact(run, {
          stageId,
          name: artifactNames[0] || "platform_pack.md",
          content: text || "No platform pack generated.",
          randomUUID
        })
      );
    } else if (stageId === "style") {
      artifactsCreated.push(
        buildArtifact(run, {
          stageId,
          name: artifactNames[0] || "platform_pack_styled.md",
          content: text || "No styled pack generated.",
          randomUUID
        })
      );
    } else if (stageId === "audit") {
      artifactsCreated.push(
        buildArtifact(run, {
          stageId,
          name: artifactNames[0] || "fact_audit.md",
          content: text || "No fact audit generated.",
          randomUUID
        }),
        buildArtifact(run, {
          stageId,
          name: artifactNames[1] || "final_pack.md",
          content: text || "No final pack generated.",
          randomUUID
        })
      );
    }

    const stageEntry = run.stageState[stageId];
    stageEntry.artifacts = artifactsCreated.map((artifact) => artifact.title);
    for (const artifact of artifactsCreated) {
      pushRunArtifact(run, artifact);
      streamRunEvent(run, "artifact_written", {
        stageId,
        artifact: {
          artifactId: artifact.artifactId,
          title: artifact.title,
          uri: artifact.uri,
          type: artifact.type
        }
      });
    }
  }

  async function runPipelineOrchestration(runId) {
    const run = findRun(runId);
    if (!run) {
      return;
    }
    const pipeline = findPipeline(run.pipelineId);
    if (!pipeline) {
      run.status = "failed";
      run.failedStage = "unknown";
      run.errorMessage = "Pipeline not found.";
      run.errorAt = new Date().toISOString();
      run.updatedAt = run.errorAt;
      await saveRunsAndBroadcast(run, "run_failed", {
        stageId: run.failedStage,
        error: run.errorMessage
      });
      closeRunStream(run.runId);
      return;
    }

    run.status = "running";
    run.updatedAt = new Date().toISOString();
    appendRunLog(run, "info", "Pipeline run started.");
    await saveRunsAndBroadcast(run, "run_started", {
      status: run.status,
      stageState: run.stageState
    });

    const stageList = pipeline.stages
      .filter((stage) => stage.enabled !== false)
      .sort((a, b) => a.order - b.order);

    try {
      for (const stage of stageList) {
        const stageId = stage.stageId;
        const agentId = pipeline.agentsByRole?.[stage.role];
        const agent = findAgent(agentId);
        if (!agent) {
          throw buildRequestError(400, `Stage ${stageId} references unknown agent: ${agentId || "none"}`);
        }

        setRunStageStatus(run, stageId, "running", { agentId });
        run.updatedAt = new Date().toISOString();
        appendRunLog(run, "info", `Stage started: ${stageId}`, { stageId });
        await saveRunsAndBroadcast(run, "stage_started", {
          stageId,
          agentId,
          stage: run.stageState[stageId]
        });

        const priorStageArtifacts = run.artifacts;
        const promptText = buildStagePrompt({
          stageId,
          topic: run.topic,
          brandVoice: run.brandVoice,
          targetPlatforms: run.targetPlatforms,
          priorArtifacts: priorStageArtifacts
        });

        const stageResult = await executeLmStudioStage({
          run,
          pipeline,
          stageId,
          agent,
          promptText,
          allowSearchFallback: stageId === "discovery"
        });

        run.metrics = run.metrics || {};
        run.metrics.perStage = run.metrics.perStage || {};
        run.metrics.perStage[stageId] = sanitizeStats(stageResult.result?.stats) || null;
        setRunStageStatus(run, stageId, "completed", {
          stats: run.metrics.perStage[stageId],
          error: null
        });

        await persistStageArtifacts(run, stageId, stageResult);
        run.updatedAt = new Date().toISOString();
        appendRunLog(run, "info", `Stage completed: ${stageId}`, { stageId });
        await saveRunsAndBroadcast(run, "stage_completed", {
          stageId,
          stage: run.stageState[stageId]
        });
      }

      run.status = "completed";
      run.updatedAt = new Date().toISOString();
      run.failedStage = null;
      run.errorMessage = null;
      run.errorAt = null;
      appendRunLog(run, "info", "Pipeline run completed.");
      await saveRunsAndBroadcast(run, "run_completed", {
        status: run.status
      });
      closeRunStream(run.runId);
    } catch (error) {
      const activeStage =
        Object.values(run.stageState || {}).find((stageEntry) => stageEntry.status === "running")?.stageId || "unknown";
      setRunStageStatus(run, activeStage, "failed", {
        error: error.message || "Stage execution failed."
      });
      run.status = "failed";
      run.failedStage = activeStage;
      run.errorMessage = error.message || "Pipeline run failed.";
      run.errorAt = new Date().toISOString();
      run.updatedAt = run.errorAt;
      appendRunLog(run, "error", run.errorMessage, { stageId: activeStage });
      await saveRunsAndBroadcast(run, "run_failed", {
        stageId: activeStage,
        error: run.errorMessage
      });
      closeRunStream(run.runId);
    } finally {
      activePipelineRuns.delete(runId);
    }
  }

  function ensurePipelineReadyForRun(pipeline) {
    if (!pipeline) {
      throw buildRequestError(404, "Pipeline not found.");
    }

    for (const stage of canonicalStages) {
      const mappedAgentId = pipeline.agentsByRole?.[stage.role];
      if (!mappedAgentId) {
        throw buildRequestError(400, `Pipeline missing agentsByRole.${stage.role}.`);
      }
      if (!findAgent(mappedAgentId)) {
        throw buildRequestError(400, `Pipeline stage ${stage.stageId} references unknown agent: ${mappedAgentId}`);
      }
    }
  }

  return {
    getRunSubscribers,
    streamRunEvent,
    closeRunStream,
    saveRunsAndBroadcast,
    runPipelineOrchestration,
    ensurePipelineReadyForRun,
    appendRunLog
  };
}

module.exports = {
  createOrchestrator
};
