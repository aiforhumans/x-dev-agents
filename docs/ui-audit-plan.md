# UI Audit + Plan

## Current IA (as implemented)
- Header: app title + LM Studio base URL controls.
- Main desktop layout: 2-pane grid with resizer (`agents` left, `chat` right).
- Left pane:
  - Agent list + create button.
  - Single long form split into foldable groups: `Identity`, `Model`, `Generation`, `Prompt`, `MCP`, `Runtime`.
  - Sticky Save/Delete row.
- Right pane:
  - Chat title/header.
  - Chat log (hidden visual scrollbar).
  - Composer with `+` upload, textarea, send, reset, and attachment count.
- Persistence:
  - Left pane width: `ui.layout.leftPaneWidthPx`.
  - Group open state per agent: `ui.agentForm.groupState.<agentId>` and `.__new__`.

## Friction points
- Group labels are implementation-centric (`Generation`, `Runtime`) and mix unrelated settings.
- Large left-form expansion can increase perceived visual load and reduce scan speed.
- Attachments show count only; no preview, no per-file remove, no size feedback.
- Chat always forces bottom on render; harder to inspect older messages during stream.
- Reasoning/tool-call outputs are visible but not structurally separated enough for fast parsing.

## Planned IA / interaction model
- Keep split-pane architecture and all behaviors/API contracts.
- Retitle/restructure form groups for product language:
  - `Basics`
  - `Model`
  - `Sampling`
  - `Output`
  - `Streaming / Store`
  - `Web Search`
  - `MCP Integrations`
  - `Diagnostics`
- Keep localStorage persistence on the same key namespace; add backward compatibility mapping from old group keys.
- Chat improvements:
  - Add attachment preview rail (thumbnail + filename + size + remove action).
  - Reject oversized images early and report status.
  - Add floating `Scroll to latest` button when user is away from bottom.
  - Preserve hidden scrollbar behavior.
  - Keep streaming smooth by coalescing repaint frequency.
- Output rendering polish:
  - `message`: standard assistant block.
  - `reasoning`: collapsible block, collapsed by default on small screens.
  - `tool_call` / `invalid_tool_call`: collapsible monospace block with labels.
  - `diagnostics`: compact row/chips for stats/response id.

## Responsive behavior
- Desktop (`>1080px`): fixed-height app shell; split-pane with drag handle.
- Tablet/mobile (`<=1080px`): stacked layout with natural page flow.
- Small screens (`<=760px`): reasoning/tool details default collapsed.

## Accessibility
- Keep semantic `details/summary` for collapsible sections.
- Add keyboard resizing on resizer (`ArrowLeft/ArrowRight/Home/End`) and ARIA value attributes.
- Keep visible focus states on controls and summary rows.
- Ensure scroll-to-latest is keyboard reachable and has clear label.

## Persistence rules + failure modes
- Persist left pane width only on desktop; clamp between min/max each load/resize.
- Persist per-agent group states on group toggle.
- On invalid JSON/missing keys in localStorage: fallback to defaults.
- If old group schema is present: map old keys (`generation`, `prompt`, `runtime`) to new equivalents.
- If attachment preview APIs are unavailable (`DataTransfer`, `URL.createObjectURL`): fallback to count-only behavior.

## Incremental implementation sequence
1. Restructure form groups in markup; keep field IDs unchanged.
2. Update group persistence keys/defaults and compatibility mapping.
3. Add attachment preview state/render/remove + image size guard.
4. Add chat sticky-bottom tracking + scroll-to-latest affordance.
5. Polish output rendering for reasoning/tool/diagnostics.
6. Add light tests for updated group defaults/mapping and run full test suite.
