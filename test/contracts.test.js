const test = require("node:test");
const assert = require("node:assert/strict");

const {
  coerceLmStudioChatResponse,
  isRunEventType
} = require("../src/shared/types/contracts");
const { getBodyObject, getQueryObject } = require("../src/server/utils/boundary");

test("coerceLmStudioChatResponse returns safe defaults for invalid payload", () => {
  const value = coerceLmStudioChatResponse(null);
  assert.deepEqual(value, {
    output: [],
    response_id: null,
    stats: null
  });
});

test("coerceLmStudioChatResponse preserves unknown fields while normalizing core fields", () => {
  const value = coerceLmStudioChatResponse({
    output: [{ type: "message", content: "ok" }],
    response_id: " resp-1 ",
    stats: { tokens_per_second: 10 },
    integrations: [{ any: "shape" }]
  });
  assert.equal(Array.isArray(value.output), true);
  assert.equal(value.response_id, "resp-1");
  assert.deepEqual(value.stats, { tokens_per_second: 10 });
  assert.deepEqual(value.integrations, [{ any: "shape" }]);
});

test("isRunEventType validates known event names", () => {
  assert.equal(isRunEventType("run_started"), true);
  assert.equal(isRunEventType("assistant_delta"), true);
  assert.equal(isRunEventType("not_a_real_event"), false);
});

test("boundary helpers coerce non-object request payloads", () => {
  assert.deepEqual(getBodyObject({ body: "text" }), {});
  assert.deepEqual(getBodyObject({ body: { ok: true } }), { ok: true });
  assert.deepEqual(getQueryObject({ query: null }), {});
  assert.deepEqual(getQueryObject({ query: { limit: "10" } }), { limit: "10" });
});
