# Client

Feature-first frontend structure introduced during refactor.

- `features/*`: domain UI areas (agents, chat, pipelines, runs, diagnostics)
- `components/`: shared presentational building blocks
- `state/`: shared UI keys and state contracts
- `lib/`: API client wrappers

Current runtime UI remains served from `public/` during incremental migration.
