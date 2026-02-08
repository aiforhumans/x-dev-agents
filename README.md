![LM Studio Agent Builder](image.png)

# LM Studio Agent Builder

Local web app for creating and testing custom agents backed by the LM Studio API.

> **Refactor Banner**  
> Branch: `refactor/modular-server-client` | Status: `Phase 0-9 complete` | Runtime behavior preserved through refactor phases

## Features

- ChatGPT-style UI refresh:
  - wider workspace with a calmer, minimal visual style
  - 3-pane IA:
    - left navigation (`Agent Groups`, `Agents`, `Pipelines`, `Runs`, `Models`, `Diagnostics`)
    - center output timeline (`run narrative`, `tool events`, `artifacts`, `evidence`, failures)
    - right settings/control (group profile, role mapping, run controls, agent tuning)
  - resizable pane controls on desktop (keyboard + pointer)
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
  - run lifecycle status (`queued`, `running`, `paused`, `cancelling`, `completed`, `failed`, `cancelled`)
  - run inputs (`topic`, `seedLinks`, `brandVoice`, `targetPlatforms`)
  - run artifacts, evidence snapshots/citations, logs, metrics, and timeline metadata
  - additive reproducibility fields: `runType`, `profileId`, `profileSnapshot`, `control`
- Multi-Agent Groups persisted in `data/agent-groups.json`:
  - reusable named teams mapped to canonical roles (`discovery`, `synthesis`, `draft`, `adapt`, `style`, `audit`)
  - sequential execution settings and default run options
  - minimal UI panel for group CRUD and one-click group run kickoff
  - live **Group Run Status** panel with stage/status/event updates from `/api/runs/:runId/stream`
- Run Profiles persisted in `data/run-profiles.json`:
  - versioned reusable profiles for `group` and `pipeline` scope
  - profile modes: `inherit_defaults`, `override_per_role`, `override_per_stage`
  - profile snapshot freezing on run start for reproducibility
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
  - `data/agent-groups.json`
  - `data/pipelines.json`
  - `data/runs.json`
  - `data/run-profiles.json`

## Orchestration API

- Agent Groups:
  - `GET /api/agent-groups`
  - `GET /api/agent-groups/:id`
  - `POST /api/agent-groups` (create or update when `groupId`/`id` is supplied)
  - `PUT /api/agent-groups/:id`
  - `DELETE /api/agent-groups/:id`
  - `POST /api/agent-groups/:id/run` (supports `profileId`/`profileOverrides`/`freezeSettings`; returns `{ runId }`)

- Run Profiles:
  - `GET /api/run-profiles`
  - `GET /api/run-profiles/:id`
  - `POST /api/run-profiles` (create or update when `profileId`/`id` is supplied)
  - `PUT /api/run-profiles/:id`
  - `DELETE /api/run-profiles/:id`

- Pipelines:
  - `GET /api/pipelines`
  - `GET /api/pipelines/:id`
  - `POST /api/pipelines` (create or update when `id` is supplied)
  - `PUT /api/pipelines/:id`
  - `DELETE /api/pipelines/:id`
  - `POST /api/pipelines/:id/run` (supports `profileId`/`profileOverrides`/`freezeSettings`; returns `{ runId }`)
- Runs:
  - `GET /api/runs` (optional query: `pipelineId`, `groupId`, `runType`, `profileId`, `status`, `limit`)
  - `GET /api/runs/:runId`
  - `GET /api/runs/:runId/stream` (SSE orchestration events)
  - `POST /api/runs`
  - `PUT /api/runs/:runId`
  - `POST /api/runs/:runId/logs`
  - `POST /api/runs/:runId/control` (`cancel`, `pause`, `resume`, `retry_stage`)
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
- `run_paused`
- `run_cancel_requested`
- `run_cancelled`
- `run_resumed`
- `stage_retry_started`
- `heartbeat`

### Group Run UI Notes

- Starting a group run (`POST /api/agent-groups/:id/run`) now auto-subscribes the UI to:
  - `GET /api/runs/:runId`
  - `GET /api/runs/:runId/stream`
- The Multi-Agent Groups panel shows:
  - active `runId`
  - current run `status`
  - per-stage status summary
  - recent orchestration events (stage transitions, artifact writes, terminal state)

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
- Additional pane state keys:
  - `ui.layout.navPaneWidthPx`
  - `ui.layout.settingsPaneWidthPx`
  - `ui.layout.settingsOpen`
  - `ui.layout.navSection.<sectionId>`
- Agent editor fold-state is stored per agent:
  - `ui.agentForm.groupState.<agentId>`
  - `ui.agentForm.groupState.__new__` for unsaved new agents.
- Additional UI behavior details: `docs/ui.md`

## Tests

```bash
npm test
```

## Refactor Phases (0-9)

- `Phase 0 - Baseline + Safety Nets`: done
  - baseline tests/dev checks established
  - health endpoint present and validated
- `Phase 1 - Structure Scaffolding`: done
  - created modular `src/server/*`, `src/shared/*`, and `src/client/*` targets
- `Phase 2 - Config + Constants`: done
  - extracted env/constants/paths and logger foundations
- `Phase 3 - Storage Layer`: done
  - moved JSON persistence into repository modules with atomic writes
- `Phase 4 - LM Studio + SSE Abstractions`: done
  - isolated LM Studio client, stream parser, SSE helpers
- `Phase 5 - Orchestration Extraction`: done
  - extracted multi-stage pipeline orchestrator into dedicated service modules
- `Phase 6 - Thin Route Modules`: done
  - extracted routes and shared middleware
  - added route registrar and route inventory (`docs/route-inventory.md`)
- `Phase 7 - Frontend Re-Org (incremental)`: done
  - added feature-first client structure
  - extracted browser client modules with fallback-compatible wiring
- `Phase 8 - Type Hardening + DTO Alignment`: done
  - added shared contracts (`src/shared/types/contracts.js`)
  - added boundary guards and contract tests
- `Phase 9 - Cleanup + Optional Improvements`: done
  - request-id middleware + structured logging
  - `/api/models` short TTL cache (15s)
  - debounced UI localStorage writes

## Backend Structure

- Runtime behavior has been preserved while backend internals were modularized.
- Current extracted modules:
  - `src/server/config/env.js` for env-derived runtime paths/defaults
  - `src/server/config/constants.js` for shared server constants/stage metadata
  - `src/server/state/runtimeState.js` for in-process mutable runtime state
  - `src/shared/types/contracts.js` for shared JSDoc contracts and lightweight runtime guards
- `server.js` remains the bootstrap/route host.
- Phase 9 operational improvements:
  - request context middleware adds/propagates `x-request-id`
  - structured JSON logs include request metadata and duration
  - `/api/models` uses short in-memory caching (default TTL: 15s, reset on base URL change)

## GitHub Notes

- `data/config.json`, `data/agents.json`, `data/agent-groups.json`, `data/pipelines.json`, `data/runs.json`, and `data/run-profiles.json` are local runtime files and are not tracked in git.
- After cloning, run `npm install` and start the app; required data files are created automatically.
- CI runs `npm test` on pushes to `main` and pull requests.
