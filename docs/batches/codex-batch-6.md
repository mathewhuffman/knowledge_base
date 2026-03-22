# Codex Batch 6 Handoff

## What was built
- Added full Batch 6 contract surface in shared types for ACP sessions, job runs, transcript, health, and MCP tool payloads in `packages/shared-types/src/batch6.ts`.
- Exported new shared types in `packages/shared-types/src/index.ts`.
- Implemented MCP server tool registry in `packages/mcp-server/src/index.ts` with:
  - `McpToolDescriptor` schema and `toolCount`
  - `registerTool`, `listTools`, `callTool`
  - JSON-RPC method handlers for `tools/list` and `tools/call`
- Reworked `packages/agent-runtime/src/index.ts` to add:
  - ACP transport over stdio with child-process spawn
  - per-workspace session registry and state transitions
  - transcript capture (`.meta/agent-transcripts/...`)
  - health probing (`cursorInstalled`, `acpReachable`, `mcpRunning`, `requiredConfigPresent`)
  - retry + timeout wrappers with job cancellation checks
  - `runBatchAnalysis` and `runArticleEdit` session execution paths
  - MCP tool implementations for all required batch-6 tools (search/get/propose/record)
- Extended `WorkspaceRepository` with template/pbi runtime helpers:
  - `getLocaleVariantsForFamily`
  - `listTemplatePacks`
  - `getTemplatePack`
  - `getTemplatePackByLocale`
  - `getPBIRecord`
  - `getPBISubset`
  - `getBatchContext`
- Wired new runtime commands in `apps/desktop/src/main/services/command-registry.ts`:
  - `agent.health.check`
  - `agent.session.create | list | get | close`
  - `agent.transcript.get`
  - `agent.tool.calls`
  - job commands `agent.analysis.run`, `agent.article_edit.run`
- Updated main app dependency graph to include `@kb-vault/agent-runtime` and `@kb-vault/mcp-server`.

## Files changed
- `packages/shared-types/src/batch6.ts`
- `packages/shared-types/src/index.ts`
- `packages/mcp-server/src/index.ts`
- `packages/agent-runtime/src/index.ts`
- `packages/agent-runtime/package.json`
- `apps/desktop/package.json`
- `apps/desktop/src/main/services/workspace-repository.ts`
- `apps/desktop/src/main/services/command-registry.ts`
- `docs/contracts/batch-6-ipc.md`
- `docs/contracts/batch-6-schema.md`
- `docs/contracts/batch-6-payloads.md`
- `docs/batches/codex-batch-6.md`

## DB schema changes
- No DB migration changes this batch.

## IPC additions
- Added commands listed above in `docs/contracts/batch-6-ipc.md`.

## Background jobs added
- `agent.analysis.run`
- `agent.article_edit.run`

## Known limitations
- ACP transport is launched as needed and can still fail if `cursor` is missing, permissions are restricted, or command execution is denied.
- Proposal records are currently persisted with `DEFER` status by default, with downstream acceptance/rejection actions handled by the review flow.
- Transcript retrieval is persisted per session/run, but live stream tailing is not yet implemented.
- MCP-backed context can still error when workspace credentials are missing or invalid.

## Renderer hooks available for Claude
- `window.kbv.invoke('agent.health.check', {})`
- `window.kbv.invoke('agent.session.create', payload)`
- `window.kbv.invoke('agent.session.list', { workspaceId })`
- `window.kbv.invoke('agent.session.get', { workspaceId, sessionId })`
- `window.kbv.invoke('agent.session.close', { workspaceId, sessionId })`
- `window.kbv.invoke('agent.transcript.get', { workspaceId, sessionId, limit? })`
- `window.kbv.invoke('agent.tool.calls', { workspaceId, sessionId })`
- `window.kbv.invoke('agent.article_edit.run', payload)` as payload for `kbv.startJob`
- `window.kbv.startJob('agent.analysis.run', payload)`
- `window.kbv.startJob('agent.article_edit.run', payload)`

## Notes for next batch
- `listCategories` and `listSections` MCP calls now resolve via workspace Zendesk credentials and return live category/section records when available.
- `propose_*` MCP calls now persist durable proposal rows (`proposals` and optional `proposal_pbi_links`) and return the persisted envelope metadata.

## Claude rules
- Consume the contracts and payload docs above.
- Use session create/list/get hooks for status-driven UX.
- Show transcript lines with run-stage context.
