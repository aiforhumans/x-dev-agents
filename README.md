![LM Studio Agent Builder](image.png)

# LM Studio Agent Builder

Local web app for creating and testing custom agents backed by the LM Studio API.

## Features

- ChatGPT-style UI refresh:
  - wider workspace with a calmer, minimal visual style
  - resizable editor/chat split on desktop (stored locally)
  - keyboard-accessible resizer controls (`ArrowLeft/ArrowRight`, `Home/End`, `Shift` for larger steps)
  - foldable agent node groups with per-agent open/closed state
  - updated form information architecture:
    - `Basics`, `Model`, `Sampling`, `Output`
    - `Streaming / Store`, `Web Search`, `MCP Integrations`, `Diagnostics`
  - compact `+` upload button with image preview thumbnails, size labels, and remove actions
  - hidden chat scrollbar with preserved mouse/touch/trackpad scroll behavior
  - `Jump to latest` control when reading older messages in the thread
- Create, edit, and delete agents with advanced LM Studio chat settings:
  - `temperature`, `top_p`, `top_k`, `min_p`, `repeat_penalty`
  - `max_output_tokens`, `context_length`, `reasoning`
  - `store` and `stream`
  - `integrations` (plugin IDs or full integration objects)
- Pull available local models from LM Studio (`/api/v1/models`, with `/v1/models` fallback).
- Chat through LM Studio native responses API (`/api/v1/chat`).
- Stream responses via SSE and render live output in the UI.
- Send multimodal messages (text + image attachments as data URLs).
- Optional online search context (DuckDuckGo) per agent via `webSearch` toggle.
- Persist agent definitions, chat history, response chain IDs, and stats in `data/`.
- First-class Content Pipelines persisted in `data/pipelines.json`:
  - reusable pipeline templates with ordered stages
  - stage-to-agent role mapping (`agentsByRole`)
  - per-stage tooling policy (`toolsPolicy`)
  - target deliverables (`outputs`)
- Pipeline Runs persisted in `data/runs.json`:
  - run lifecycle status (`queued`, `running`, `completed`, `failed`, `cancelled`)
  - run inputs (`topic`, `seedLinks`, `brandVoice`, `targetPlatforms`)
  - run artifacts, evidence snapshots/citations, logs, and metrics
- Render assistant output types from LM Studio:
  - `message`
  - `reasoning` (collapsible)
  - `tool_call` (collapsible monospace block)
  - `invalid_tool_call` (collapsible monospace block)
- Show response diagnostics when available (`tokens_per_second`, `time_to_first_token_seconds`, token counts, etc.).

## Prerequisites

- Node.js 18+ (tested with Node 25).
- LM Studio running locally with the local server enabled.
  - Default API base URL: `http://localhost:1234/v1`

## MCP Setup

- This app sends MCP integrations using LM Studio's `integrations` field for `/api/v1/chat`.
- For `mcp.json` servers, enable LM Studio setting: **Developer > Use mcp.json servers**.
- LM Studio can read `mcp.json` from:
  - the process working directory, or
  - `~/.lmstudio/mcp.json`
- In the agent form:
  - **MCP Plugins** accepts IDs like `mcp/playwright` (one per line).
  - **Ephemeral MCP Servers** accepts JSON array entries with `server_label` and `server_url`.
  - **Extra Integrations** is for advanced integration objects (including plugin objects with `allowed_tools`).
  - **Test MCP** sends a lightweight `/api/v1/chat` probe with current integrations and reports whether tool-call signals were detected.

## MCP Test API

- Endpoint: `POST /api/mcp/test`
- Request body:
  - `model` (string, required)
  - `systemPrompt` (string, optional)
  - `integrations` (array, required)
- Response:
  - `ok` (boolean)
  - `toolSignalsDetected` (boolean)
  - `outputTypes` (object with output type counts)

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Configuration

- Change LM Studio base URL in the app header, or set `LM_STUDIO_BASE_URL` before launch.
  - Both `http://localhost:1234` and `http://localhost:1234/v1` are supported.
- Data files:
  - `data/config.json`
  - `data/agents.json`
  - `data/pipelines.json`
  - `data/runs.json`

## Content Pipelines API

- Pipelines:
  - `GET /api/pipelines`
  - `GET /api/pipelines/:id`
  - `POST /api/pipelines` (create or update when `id` is supplied)
  - `PUT /api/pipelines/:id`
  - `DELETE /api/pipelines/:id`
  - `POST /api/pipelines/:id/run` (starts async orchestration, returns `{ runId }`)
- Runs:
  - `GET /api/runs` (optional query: `pipelineId`, `status`, `limit`)
  - `GET /api/runs/:runId`
  - `GET /api/runs/:runId/stream` (SSE orchestration events)
  - `POST /api/runs`
  - `PUT /api/runs/:runId`
  - `POST /api/runs/:runId/logs`
  - `DELETE /api/runs/:runId`

### Run Stream Event Types

- `run_started`
- `stage_started`
- `assistant_delta`
- `tool_call`
- `tool_result`
- `artifact_written`
- `stage_completed`
- `run_completed`
- `run_failed`

### Canonical Orchestration Stages

- `discovery` -> writes `evidence.json`, `reading_notes.md`
- `synthesis` -> writes `foundation_report.md`, `claims_table.json`
- `draft` -> writes `draft_longform.md`
- `adapt` -> writes `platform_pack.md`
- `style` -> writes `platform_pack_styled.md`
- `audit` -> writes `fact_audit.md`, `final_pack.md`

## Chat Behavior Notes

- If an agent has `store` enabled, the app sends `previous_response_id` for follow-up turns and persists the latest `response_id`.
- If an agent has `stream` enabled, the app uses `/api/chat/stream` and consumes LM Studio streaming events.
- Reset Conversation clears local history and clears the persisted `lastResponseId` chain pointer for that agent.

## UI Persistence Notes

- Desktop pane width is stored in localStorage key: `ui.layout.leftPaneWidthPx`.
- Agent editor fold-state is stored per agent:
  - `ui.agentForm.groupState.<agentId>`
  - `ui.agentForm.groupState.__new__` for unsaved new agents.
- Additional UI behavior details: `docs/ui.md`

## Tests

```bash
npm test
```

## Backend Structure (Refactor In Progress)

- Runtime behavior remains unchanged while backend internals are being modularized.
- Current extracted modules:
  - `src/server/config/env.js` for env-derived runtime paths/defaults
  - `src/server/config/constants.js` for shared server constants/stage metadata
  - `src/server/state/runtimeState.js` for in-process mutable runtime state
  - `src/shared/types/contracts.js` for shared JSDoc contracts and lightweight runtime guards
- `server.js` remains the bootstrap/route host during incremental extraction.

## GitHub Notes

- `data/config.json` and `data/agents.json` are local runtime files and are not tracked in git.
- After cloning, run `npm install` and start the app; required data files are created automatically.
- CI runs `npm test` on pushes to `main` and pull requests.
