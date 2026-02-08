# LM Studio Agent Builder

Local web app for creating and testing custom agents backed by the LM Studio API.

## Features

- ChatGPT-style UI refresh:
  - wider workspace with a calmer, minimal visual style
  - resizable editor/chat split on desktop (stored locally)
  - foldable agent node groups with per-agent open/closed state
  - compact `+` upload button in the chat composer
  - hidden chat scrollbar with preserved mouse/touch/trackpad scroll behavior
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
- Render assistant output types from LM Studio:
  - `message`
  - `reasoning`
  - `tool_call`
  - `invalid_tool_call`
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

## Chat Behavior Notes

- If an agent has `store` enabled, the app sends `previous_response_id` for follow-up turns and persists the latest `response_id`.
- If an agent has `stream` enabled, the app uses `/api/chat/stream` and consumes LM Studio streaming events.
- Reset Conversation clears local history and clears the persisted `lastResponseId` chain pointer for that agent.

## UI Persistence Notes

- Desktop pane width is stored in localStorage key: `ui.layout.leftPaneWidthPx`.
- Agent editor fold-state is stored per agent:
  - `ui.agentForm.groupState.<agentId>`
  - `ui.agentForm.groupState.__new__` for unsaved new agents.

## Tests

```bash
npm test
```

## GitHub Notes

- `data/config.json` and `data/agents.json` are local runtime files and are not tracked in git.
- After cloning, run `npm install` and start the app; required data files are created automatically.
- CI runs `npm test` on pushes to `main` and pull requests.
