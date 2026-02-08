/**
 * Registers all API route modules.
 */
const { registerSystemRoutes } = require("./systemRoutes");
const { registerAgentRoutes } = require("./agentRoutes");
const { registerAgentGroupRoutes } = require("./agentGroupRoutes");
const { registerRunProfileRoutes } = require("./runProfileRoutes");
const { registerMcpRoutes } = require("./mcpRoutes");
const { registerPipelineRoutes } = require("./pipelineRoutes");
const { registerRunRoutes } = require("./runRoutes");
const { registerChatRoutes } = require("./chatRoutes");

function registerApiRoutes(app, deps) {
  registerSystemRoutes(app, deps.system);
  registerMcpRoutes(app, deps.mcp);
  registerAgentRoutes(app, deps.agents);
  registerAgentGroupRoutes(app, deps.agentGroups);
  registerRunProfileRoutes(app, deps.runProfiles);
  registerPipelineRoutes(app, deps.pipelines);
  registerRunRoutes(app, deps.runs);
  registerChatRoutes(app, deps.chat);
}

module.exports = {
  registerApiRoutes
};
