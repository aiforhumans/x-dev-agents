/**
 * Shared runtime contracts and lightweight guards.
 */

/**
 * @typedef {Object} Agent
 * @property {string} id
 * @property {string} name
 * @property {string} model
 * @property {string} [description]
 * @property {string} [systemPrompt]
 * @property {boolean} [store]
 * @property {boolean} [stream]
 * @property {boolean} [webSearch]
 * @property {unknown[]} [integrations]
 */

/**
 * @typedef {Object} Pipeline
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {Object.<string, string>} agentsByRole
 * @property {unknown} [toolsPolicy]
 * @property {unknown[]} [outputs]
 */

/**
 * @typedef {Object} Run
 * @property {string} runId
 * @property {string} pipelineId
 * @property {string} status
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {unknown[]} [artifacts]
 * @property {unknown[]} [evidence]
 * @property {unknown[]} [logs]
 * @property {Object} [metrics]
 */

/**
 * @typedef {"run_started"|"stage_started"|"assistant_delta"|"tool_call"|"tool_result"|"artifact_written"|"stage_completed"|"run_completed"|"run_failed"|"heartbeat"} RunEventType
 */

/**
 * @typedef {Object} RunEvent
 * @property {RunEventType} type
 * @property {Object} data
 */

/**
 * @typedef {Object} LMStudioChatPayload
 * @property {string} model
 * @property {string|Object|Object[]} input
 * @property {boolean} [stream]
 * @property {boolean} [store]
 * @property {string} [system_prompt]
 * @property {number} [temperature]
 * @property {number} [top_p]
 * @property {number} [top_k]
 * @property {number} [min_p]
 * @property {number} [repeat_penalty]
 * @property {number} [max_output_tokens]
 * @property {number} [context_length]
 * @property {string} [reasoning]
 * @property {unknown[]} [integrations]
 * @property {string} [previous_response_id]
 */

/**
 * @typedef {Object} LMStudioOutputItem
 * @property {string} [type]
 * @property {string} [content]
 * @property {string} [tool]
 * @property {unknown} [arguments]
 * @property {unknown} [output]
 * @property {unknown} [provider_info]
 * @property {unknown} [providerInfo]
 */

/**
 * @typedef {Object} LMStudioChatResponse
 * @property {LMStudioOutputItem[]} output
 * @property {string|null} [response_id]
 * @property {Object|null} [stats]
 */

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRunEventType(value) {
  const valid = new Set([
    "run_started",
    "stage_started",
    "assistant_delta",
    "tool_call",
    "tool_result",
    "artifact_written",
    "stage_completed",
    "run_completed",
    "run_failed",
    "heartbeat"
  ]);
  return valid.has(String(value || ""));
}

/**
 * Normalize LM Studio chat results while preserving unknown fields.
 * Keeps integrations/tools payloads permissive by default.
 *
 * @param {unknown} raw
 * @returns {LMStudioChatResponse}
 */
function coerceLmStudioChatResponse(raw) {
  if (!isPlainObject(raw)) {
    return { output: [], response_id: null, stats: null };
  }

  const output = Array.isArray(raw.output) ? raw.output : [];
  const responseId =
    typeof raw.response_id === "string" && raw.response_id.trim() ? String(raw.response_id).trim() : null;
  const stats = isPlainObject(raw.stats) ? raw.stats : null;

  return {
    ...raw,
    output,
    response_id: responseId,
    stats
  };
}

module.exports = {
  isPlainObject,
  isRunEventType,
  coerceLmStudioChatResponse
};
