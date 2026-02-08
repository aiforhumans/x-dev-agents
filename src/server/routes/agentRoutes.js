/**
 * Agent CRUD routes.
 */
function registerAgentRoutes(app, deps) {
  const { getAgents, saveAgents, sanitizeAgent, agentToClient, buildRequestError, randomUUID } = deps;

  app.get("/api/agents", (req, res) => {
    res.json(getAgents().map(agentToClient));
  });

  app.post("/api/agents", async (req, res, next) => {
    try {
      const agents = getAgents();
      const agentInput = sanitizeAgent(req.body);
      const now = new Date().toISOString();
      const agent = {
        id: randomUUID(),
        ...agentInput,
        chatHistory: [],
        lastResponseId: null,
        lastStats: null,
        createdAt: now,
        updatedAt: now
      };
      agents.push(agent);
      await saveAgents();
      res.status(201).json(agentToClient(agent));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/agents/:id", async (req, res, next) => {
    try {
      const agents = getAgents();
      const index = agents.findIndex((agent) => agent.id === req.params.id);
      if (index === -1) {
        throw buildRequestError(404, "Agent not found.");
      }

      const updates = sanitizeAgent(req.body);
      const previous = agents[index];
      const updated = {
        ...previous,
        ...updates,
        lastResponseId: updates.store ? previous.lastResponseId : null,
        updatedAt: new Date().toISOString()
      };
      agents[index] = updated;
      await saveAgents();
      res.json(agentToClient(updated));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/agents/:id", async (req, res, next) => {
    try {
      const agents = getAgents();
      const index = agents.findIndex((agent) => agent.id === req.params.id);
      if (index === -1) {
        throw buildRequestError(404, "Agent not found.");
      }

      agents.splice(index, 1);
      await saveAgents();
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  registerAgentRoutes
};
