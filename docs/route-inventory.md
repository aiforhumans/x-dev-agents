# Route Inventory

Current backend HTTP routes and expected response shapes.

## System
- `GET /api/health`
  - `200`: `{ ok, baseUrl, nativeApiBaseUrl, agentCount, agentGroupCount, pipelineCount, runCount, runProfileCount }`
- `GET /api/config`
  - `200`: `{ baseUrl }`
- `PUT /api/config`
  - Body: `{ baseUrl }`
  - `200`: `{ baseUrl }`
- `GET /api/models`
  - `200`: `{ models: string[] }`

## Agents
- `GET /api/agents`
  - `200`: `AgentClient[]`
- `POST /api/agents`
  - Body: agent create payload
  - `201`: `AgentClient`
- `PUT /api/agents/:id`
  - Body: agent update payload
  - `200`: `AgentClient`
- `DELETE /api/agents/:id`
  - `200`: `{ deleted: true }`

## Agent Groups
- `GET /api/agent-groups`
  - `200`: `AgentGroupClient[]`
- `GET /api/agent-groups/:id`
  - `200`: `AgentGroupClient`
- `POST /api/agent-groups`
  - Body: agent group payload
  - `201` create or `200` update-by-id: `AgentGroupClient`
- `PUT /api/agent-groups/:id`
  - Body: agent group payload
  - `200`: `AgentGroupClient`
- `DELETE /api/agent-groups/:id`
  - `200`: `{ deleted: true }`
- `POST /api/agent-groups/:id/run`
  - Body: run create payload (topic/seedLinks/brandVoice/targetPlatforms/toolsPolicy/outputs/profileId/profileOverrides/freezeSettings)
  - `202`: `{ runId }`

## Run Profiles
- `GET /api/run-profiles`
  - Query: `scopeType?`, `scopeId?`
  - `200`: `RunProfileClient[]`
- `GET /api/run-profiles/:id`
  - `200`: `RunProfileClient`
- `POST /api/run-profiles`
  - Body: run profile payload
  - `201` create or `200` update-by-id: `RunProfileClient`
- `PUT /api/run-profiles/:id`
  - Body: run profile payload
  - `200`: `RunProfileClient`
- `DELETE /api/run-profiles/:id`
  - `200`: `{ deleted: true }`

## MCP
- `POST /api/mcp/test`
  - Body: `{ model, systemPrompt?, integrations }`
  - `200`: `{ ok, toolSignalsDetected, outputTypes }`

## Pipelines
- `GET /api/pipelines`
  - `200`: `PipelineClient[]`
- `GET /api/pipelines/:id`
  - `200`: `PipelineClient`
- `POST /api/pipelines`
  - Body: pipeline payload
  - `201` create or `200` update-by-id: `PipelineClient`
- `PUT /api/pipelines/:id`
  - Body: pipeline payload
  - `200`: `PipelineClient`
- `DELETE /api/pipelines/:id`
  - `200`: `{ deleted: true }`
- `POST /api/pipelines/:id/run`
  - Body: run create payload (topic/seedLinks/brandVoice/targetPlatforms/toolsPolicy/outputs/profileId/profileOverrides/freezeSettings)
  - `202`: `{ runId }`

## Runs
- `GET /api/runs`
  - Query: `pipelineId?`, `groupId?`, `runType?`, `profileId?`, `status?`, `limit?`
  - `200`: `RunClient[]`
- `GET /api/runs/:runId`
  - `200`: `RunClient`
- `GET /api/runs/:runId/stream`
  - `200`: SSE stream
  - Events: `run_started`, `stage_started`, `assistant_delta`, `tool_call`, `tool_result`, `artifact_written`, `stage_completed`, `run_completed`, `run_failed`, `run_paused`, `run_cancel_requested`, `run_cancelled`, `run_resumed`, `stage_retry_started`, `heartbeat`
- `POST /api/runs`
  - Body: run create payload
  - `201`: `RunClient`
- `PUT /api/runs/:runId`
  - Body: run update payload
  - `200`: `RunClient`
- `POST /api/runs/:runId/logs`
  - Body: single log item
  - `201`: `RunClient`
- `POST /api/runs/:runId/control`
  - Body: `{ action: "cancel"|"pause"|"resume"|"retry_stage", fromStageId?, stageId? }`
  - `200`: `{ ok, runId, status, acceptedAction }`
- `DELETE /api/runs/:runId`
  - `200`: `{ deleted: true }`

## Chat
- `GET /api/chat/:agentId/history`
  - `200`: `{ history, lastResponseId, lastStats }`
- `POST /api/chat`
  - Body: `{ agentId, reset?, message? | messageParts? }`
  - `200`: `{ history, output, responseId, stats }`
- `POST /api/chat/stream`
  - Body: `{ agentId, reset?, message? | messageParts? }`
  - `200`: SSE stream relaying LM Studio events and final `app.history`

## Static UI
- `GET *`
  - Returns `public/index.html`

## Shared error shape
- Most non-SSE failures return JSON:
  - `{ error: string }`
