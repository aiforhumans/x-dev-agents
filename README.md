# LM Studio Agent Builder

Local web app for creating and testing custom agents backed by the LM Studio API.

## Features

- Create, edit, and delete agents with advanced LM Studio chat settings:
  - `temperature`, `top_p`, `top_k`, `min_p`, `repeat_penalty`
  - `max_output_tokens`, `context_length`, `reasoning`
  - `store` and `stream`
  - `integrations` (plugin IDs or full integration objects)
- Pull available local models from LM Studio (`/api/v1/models`, with `/v1/models` fallback).
- Chat through LM Studio native responses API (`/api/v1/chat`).
- Stream responses via SSE and render live output in the UI.
- Send multimodal messages (text + image attachments as data URLs).
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

## Tests

```bash
npm test
```

## GitHub Notes

- `data/config.json` and `data/agents.json` are local runtime files and are not tracked in git.
- After cloning, run `npm install` and start the app; required data files are created automatically.
- CI runs `npm test` on pushes to `main` and pull requests.
