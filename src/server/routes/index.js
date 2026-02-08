/**
 * Registers all API route modules.
 */
const { registerSystemRoutes } = require("./systemRoutes");
const { registerAgentRoutes } = require("./agentRoutes");
const { registerMcpRoutes } = require("./mcpRoutes");
const { registerPipelineRoutes } = require("./pipelineRoutes");
const { registerRunRoutes } = require("./runRoutes");
const { registerChatRoutes } = require("./chatRoutes");

function registerApiRoutes(app, deps) {
  registerSystemRoutes(app, deps.system);
  registerMcpRoutes(app, deps.mcp);
  registerAgentRoutes(app, deps.agents);
  registerPipelineRoutes(app, deps.pipelines);
  registerRunRoutes(app, deps.runs);
  registerChatRoutes(app, deps.chat);
}

module.exports = {
  registerApiRoutes
};
