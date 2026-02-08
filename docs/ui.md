# UI Behavior Notes

## Layout
- Desktop uses a fixed-height split pane (`agents` left, `chat` right).
- The divider supports drag and keyboard resizing:
  - `ArrowLeft` / `ArrowRight` moves pane width
  - `Shift + Arrow` moves in larger increments
  - `Home` snaps to min width
  - `End` snaps to max width
- Left pane width persists in localStorage key: `ui.layout.leftPaneWidthPx`.

## Agent Form Groups
- Foldable groups:
  - `Basics`
  - `Model`
  - `Sampling`
  - `Output`
  - `Streaming / Store`
  - `Web Search`
  - `MCP Integrations`
  - `Diagnostics`
- Open/closed state persists per agent:
  - `ui.agentForm.groupState.<agentId>`
  - `ui.agentForm.groupState.__new__`
- Legacy stored group schema is mapped forward for compatibility.

## Chat Thread
- Scrollbar is visually hidden but native scrolling remains enabled.
- Chat auto-sticks to bottom while reading latest content.
- If the user scrolls up, a `Jump to latest` control appears.
- Streaming preview rendering is frame-coalesced to reduce layout churn.

## Attachments
- Composer `+` supports multiple image attachments.
- Preview rail shows thumbnail, filename, and file size for each image.
- Each attachment can be removed before send.
- Oversized images (> 8 MB each) are skipped with status feedback.
- Messages are still sent as data URLs in `messageParts` to preserve API behavior.

## Output Rendering
- `assistant` / `user`: standard message blocks.
- `reasoning`: collapsible block (collapsed by default on small screens).
- `tool_call` / `invalid_tool_call`: collapsible monospace blocks with structured payload.
- Response diagnostics render as compact chips (`tok/s`, `ttft`, token counts, etc.) and are echoed in the form Diagnostics panel for the selected agent.
