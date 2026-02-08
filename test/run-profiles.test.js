const test = require("node:test");
const assert = require("node:assert/strict");

const { __serverInternals } = require("../server");

test("sanitizeRunProfile validates minimal profile payload", () => {
  const profile = __serverInternals.sanitizeRunProfile(
    {
      name: "Tech Deep Dive",
      scopeType: "group",
      scopeId: "group-1",
      mode: "override_per_role"
    },
    { strict: true }
  );

  assert.equal(profile.name, "Tech Deep Dive");
  assert.equal(profile.scopeType, "group");
  assert.equal(profile.scopeId, "group-1");
  assert.equal(profile.mode, "override_per_role");
  assert.equal(Array.isArray(profile.stages), true);
});

test("resolveProfileSnapshot merges overrides over selected profile", () => {
  __serverInternals.setTestState({
    runProfiles: [
      {
        profileId: "profile-1",
        name: "Base",
        version: 2,
        scopeType: "pipeline",
        scopeId: "pipeline-1",
        mode: "inherit_defaults",
        roles: { discovery: { agentId: "agent-a" } },
        stages: [],
        outputPolicy: { format: "markdown" },
        runSafety: { freezeOnStart: true }
      }
    ]
  });

  const snapshot = __serverInternals.resolveProfileSnapshot({
    runType: "pipeline",
    sourceId: "pipeline-1",
    profileId: "profile-1",
    profileOverrides: {
      outputPolicy: { format: "json" }
    },
    freezeSettings: true
  });

  assert.equal(snapshot.profileId, "profile-1");
  assert.equal(snapshot.outputPolicy.format, "json");
  assert.equal(snapshot.scopeType, "pipeline");
  assert.equal(snapshot.scopeId, "pipeline-1");
});
