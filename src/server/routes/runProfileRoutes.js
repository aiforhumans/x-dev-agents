/**
 * Run profile CRUD routes.
 */
const { getBodyObject, getQueryObject } = require("../utils/boundary");

function registerRunProfileRoutes(app, deps) {
  const {
    getRunProfiles,
    findRunProfile,
    sanitizeRunProfile,
    sanitizeTrimmedString,
    buildRequestError,
    saveRunProfiles,
    runProfileToClient,
    randomUUID
  } = deps;

  app.get("/api/run-profiles", (req, res) => {
    const query = getQueryObject(req);
    const scopeType = sanitizeTrimmedString(query.scopeType, { maxLength: 20 })?.toLowerCase();
    const scopeId = sanitizeTrimmedString(query.scopeId, { maxLength: 120 });
    let list = getRunProfiles();
    if (scopeType) {
      list = list.filter((profile) => profile.scopeType === scopeType);
    }
    if (scopeId) {
      list = list.filter((profile) => profile.scopeId === scopeId);
    }
    res.json(list.map(runProfileToClient));
  });

  app.get("/api/run-profiles/:id", (req, res, next) => {
    try {
      const profile = findRunProfile(req.params.id);
      if (!profile) {
        throw buildRequestError(404, "Run profile not found.");
      }
      res.json(runProfileToClient(profile));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/run-profiles", async (req, res, next) => {
    try {
      const profiles = getRunProfiles();
      const body = getBodyObject(req);
      const input = sanitizeRunProfile(body, { strict: true });
      const requestedId = sanitizeTrimmedString(body.profileId ?? body.id, { maxLength: 120 });
      const now = new Date().toISOString();
      if (requestedId) {
        const index = profiles.findIndex((profile) => profile.profileId === requestedId);
        if (index === -1) {
          throw buildRequestError(404, "Run profile not found.");
        }
        const updated = {
          ...profiles[index],
          ...input,
          updatedAt: now
        };
        profiles[index] = updated;
        await saveRunProfiles();
        res.json(runProfileToClient(updated));
        return;
      }

      const created = {
        profileId: randomUUID(),
        ...input,
        createdAt: now,
        updatedAt: now
      };
      profiles.push(created);
      await saveRunProfiles();
      res.status(201).json(runProfileToClient(created));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/run-profiles/:id", async (req, res, next) => {
    try {
      const profiles = getRunProfiles();
      const index = profiles.findIndex((profile) => profile.profileId === req.params.id);
      if (index === -1) {
        throw buildRequestError(404, "Run profile not found.");
      }
      const body = getBodyObject(req);
      const input = sanitizeRunProfile(body, { strict: true });
      const updated = {
        ...profiles[index],
        ...input,
        updatedAt: new Date().toISOString()
      };
      profiles[index] = updated;
      await saveRunProfiles();
      res.json(runProfileToClient(updated));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/run-profiles/:id", async (req, res, next) => {
    try {
      const profiles = getRunProfiles();
      const index = profiles.findIndex((profile) => profile.profileId === req.params.id);
      if (index === -1) {
        throw buildRequestError(404, "Run profile not found.");
      }
      profiles.splice(index, 1);
      await saveRunProfiles();
      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  registerRunProfileRoutes
};
