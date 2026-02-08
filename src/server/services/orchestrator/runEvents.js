const RUN_EVENT_TYPES = Object.freeze([
  "run_started",
  "stage_started",
  "assistant_delta",
  "tool_call",
  "tool_result",
  "artifact_written",
  "stage_completed",
  "run_completed",
  "run_failed"
]);

module.exports = {
  RUN_EVENT_TYPES
};
