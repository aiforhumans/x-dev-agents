# Frontend Phase 7 Handoff

This phase introduces a feature-first frontend target structure without changing runtime behavior.

## Added structure
- `src/client/features/agents`
- `src/client/features/chat`
- `src/client/features/pipelines`
- `src/client/features/runs`
- `src/client/features/diagnostics`
- `src/client/components`
- `src/client/state/uiKeys.js`
- `src/client/lib/api.js`

## Compatibility guarantees
- Current runtime UI remains `public/index.html` + `public/app.js`.
- Existing persistence keys remain unchanged:
  - `ui.layout.leftPaneWidthPx`
  - `ui.agentForm.groupState.*`

## Next incremental migration
1. Start consuming `src/client/state/uiKeys.js` in frontend build/runtime entry.
2. Migrate API calls from `public/app.js` to `src/client/lib/api.js`.
3. Move chat and agent form rendering logic into feature modules one slice at a time.
