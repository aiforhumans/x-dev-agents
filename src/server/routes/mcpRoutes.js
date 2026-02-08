/**
 * MCP integration routes.
 */
const { getBodyObject } = require("../utils/boundary");

function registerMcpRoutes(app, deps) {
  const { sanitizeIntegrations, buildRequestError, lmStudioJsonRequest, summarizeOutputTypes } = deps;

  app.post("/api/mcp/test", async (req, res, next) => {
    try {
      const body = getBodyObject(req);
      const model = String(body.model || "").trim();
      const systemPrompt = String(body.systemPrompt || "").trim();
      const integrations = sanitizeIntegrations(body.integrations);

      if (!model) {
        throw buildRequestError(400, "Model is required.");
      }
      if (!integrations.length) {
        throw buildRequestError(400, "At least one integration is required.");
      }

      const payload = {
        model,
        input:
          "MCP integration test. If MCP tools are available, briefly confirm and include any discovered tool names.",
        stream: false,
        store: false,
        temperature: 0,
        max_output_tokens: 160,
        integrations
      };
      if (systemPrompt) {
        payload.system_prompt = systemPrompt;
      }

      const result = await lmStudioJsonRequest({
        endpoint: "/chat",
        method: "POST",
        body: payload,
        native: true
      });

      const output = Array.isArray(result?.output) ? result.output : [];
      const toolSignalsDetected = output.some((item) => {
        const type = String(item?.type || "").trim().toLowerCase();
        return type === "tool_call" || type === "invalid_tool_call";
      });

      res.json({
        ok: true,
        toolSignalsDetected,
        outputTypes: summarizeOutputTypes(result)
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  registerMcpRoutes
};
