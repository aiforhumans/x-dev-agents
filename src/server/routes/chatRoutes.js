/**
 * Chat routes (history, sync chat, streaming chat).
 */
function registerChatRoutes(app, deps) {
  const {
    findAgent,
    buildRequestError,
    resetConversation,
    saveAgents,
    normalizeMessageParts,
    summarizeUserInput,
    enrichMessageWithSearch,
    buildChatRequest,
    lmStudioJsonRequest,
    applyChatResult,
    lmStudioStreamRequest,
    parseJsonResponse,
    writeSse,
    closeSse,
    openSse,
    parseSseBlock,
    toBoolean
  } = deps;

  app.get("/api/chat/:agentId/history", (req, res, next) => {
    try {
      const agent = findAgent(req.params.agentId);
      if (!agent) {
        throw buildRequestError(404, "Agent not found.");
      }
      res.json({
        history: agent.chatHistory || [],
        lastResponseId: agent.lastResponseId || null,
        lastStats: agent.lastStats || null
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/chat", async (req, res, next) => {
    try {
      const agentId = String(req.body?.agentId || "").trim();
      const reset = toBoolean(req.body?.reset, false);
      if (!agentId) {
        throw buildRequestError(400, "agentId is required.");
      }

      const agent = findAgent(agentId);
      if (!agent) {
        throw buildRequestError(404, "Agent not found.");
      }

      if (reset) {
        resetConversation(agent);
        await saveAgents();
      }

      const messageParts = normalizeMessageParts(req.body?.message, req.body?.messageParts);
      if (!messageParts.length) {
        res.json({ history: agent.chatHistory || [], lastResponseId: agent.lastResponseId || null });
        return;
      }

      const userHistoryItem = {
        role: "user",
        content: summarizeUserInput(messageParts)
      };
      const enrichedMessageParts = await enrichMessageWithSearch(agent, messageParts);
      const payload = buildChatRequest(agent, enrichedMessageParts, {
        stream: false,
        reset
      });
      const result = await lmStudioJsonRequest({
        endpoint: "/chat",
        method: "POST",
        body: payload,
        native: true
      });

      applyChatResult(agent, userHistoryItem, result);
      await saveAgents();

      res.json({
        history: agent.chatHistory,
        output: Array.isArray(result?.output) ? result.output : [],
        responseId: agent.lastResponseId || null,
        stats: agent.lastStats
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/chat/stream", async (req, res) => {
    let headersSent = false;

    try {
      const agentId = String(req.body?.agentId || "").trim();
      const reset = toBoolean(req.body?.reset, false);
      if (!agentId) {
        throw buildRequestError(400, "agentId is required.");
      }

      const agent = findAgent(agentId);
      if (!agent) {
        throw buildRequestError(404, "Agent not found.");
      }

      if (reset) {
        resetConversation(agent);
        await saveAgents();
      }

      const messageParts = normalizeMessageParts(req.body?.message, req.body?.messageParts);
      if (!messageParts.length) {
        throw buildRequestError(400, "A message or messageParts payload is required.");
      }

      const userHistoryItem = {
        role: "user",
        content: summarizeUserInput(messageParts)
      };

      const enrichedMessageParts = await enrichMessageWithSearch(agent, messageParts);
      const payload = buildChatRequest(agent, enrichedMessageParts, {
        stream: true,
        reset
      });
      payload.stream = true;

      openSse(res);
      headersSent = true;

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
        writeSse(res, "error", { message });
        closeSse(res);
        return;
      }

      if (!upstream.body) {
        writeSse(res, "error", { message: "No stream body returned by LM Studio." });
        closeSse(res);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult = null;
      let streamedAssistant = "";
      let streamedReasoning = "";

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
            streamedAssistant += String(data.content || "");
          } else if (event === "reasoning.delta" && data && typeof data === "object") {
            streamedReasoning += String(data.content || "");
          }

          writeSse(res, event, data);
        }
      }

      if (!finalResult) {
        finalResult = {
          output: [
            ...(streamedReasoning ? [{ type: "reasoning", content: streamedReasoning }] : []),
            ...(streamedAssistant ? [{ type: "message", content: streamedAssistant }] : [])
          ],
          response_id: null,
          stats: null
        };
      }

      applyChatResult(agent, userHistoryItem, finalResult);
      await saveAgents();
      writeSse(res, "app.history", {
        history: agent.chatHistory,
        responseId: agent.lastResponseId || null,
        stats: agent.lastStats
      });
      closeSse(res);
    } catch (error) {
      if (!headersSent) {
        res.status(Number(error.status) || 500).json({ error: error.message || "Internal server error." });
        return;
      }

      writeSse(res, "error", {
        message: error.message || "Internal server error."
      });
      closeSse(res);
    }
  });
}

module.exports = {
  registerChatRoutes
};
