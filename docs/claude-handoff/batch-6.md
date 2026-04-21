# Claude Handoff: Batch 6

## Summary
Batch 6 backend runtime is available for Agent + MCP plumbing. Claude should implement the full LLM review UX and processing state around this contract.

## What to show in UI
- Health indicators from `agent.health.check`:
  - Cursor binary installed
  - ACP reachable
  - MCP running
  - required configuration status and issues
- Session management:
  - session list (active + optional closed)
  - per-session status timeline
  - ability to open/close/recreate sessions
- Runtime job flow for:
  - run analysis
  - run article edit
  - show progress from job `message` and terminal-like transcript lines
- Tool calls visibility from `agent.tool.calls`
- Transcript drawer from `agent.transcript.get`

## API surface to consume
- `agent.health.check`
- `agent.session.create`
- `agent.session.list`
- `agent.session.get`
- `agent.session.close`
- `agent.transcript.get`
- `agent.tool.calls`
- `agent.analysis.run` via `window.kbv.startJob`
- `agent.article_edit.run` via `window.kbv.startJob`

## Exact states to render
- `agent.analysis.run`:
  - queued/running (including fallback transport state)
  - completed/success
  - failed/canceled
- Session status:
  - starting / running / idle / closed / error
- Transcript stream state:
  - to_agent
  - from_agent
  - system
  - parseable/non-parseable lines

## Open backend gaps (for future UI copy)
- `listCategories` and `listSections` depend on workspace Zendesk credentials being present and valid at runtime; failures should be surfaced as recoverable notices in UI.
- MCP proposals are now persisted as durable records; the review flow can assume they map to `proposals` entries and should present proposal IDs/links from the returned payloads.

## KB-5 hardening notes
- Backend contract hardening now guarantees:
  - CLI mode prompts contain no MCP guidance/tool names.
  - MCP mode still includes MCP tool guidance and tool names.
  - Migration health checks report repair state for workspace DBs.
  - CLI binary and loopback/health probe failures are captured in `agent.health.check` provider payloads.
