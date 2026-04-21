# Codex Batch 3 Handoff

## What was built
- Added Zendesk credential storage and retrieval flow:
  - `zendesk.credentials.get`
  - `zendesk.credentials.save`
  - OS keychain-backed API token storage via safe storage (Electron `safeStorage`)
- Added Zendesk connection test command:
  - `zendesk.connection.test` with client-side Zendesk ping and status output
- Added Zendesk read sync:
  - `zendesk.sync.run` background job for full and incremental modes
  - local progress events emitted on the job bus
  - last run summary query via `zendesk.sync.getLatest`
- Added sync state persistence in workspace DB:
  - checkpoints for incremental runs in `zendesk_sync_checkpoints`
  - run records in `zendesk_sync_runs`
  - logging start/end with counts, cursor summary, and remote error text
- Implemented sync-to-local article mapping in `apps/desktop/src/main/services/zendesk-sync-service.ts`:
  - article listing via Zendesk client
  - create/update `article_families`, `locale_variants`, and `revisions`
  - write revision HTML content under `revisions/<localeVariantId>/<revisionId>.html`
  - mark draft branches as obsolete when live revision changes
  - refresh family metadata and retire absent locale variants
- Added Zendesk discovery and search command endpoints:
  - `zendesk.categories.list`
  - `zendesk.sections.list`
  - `zendesk.articles.search`
- Wired Zendesk UX integration points in `apps/desktop/src/renderer/src/pages/Settings.tsx`:
  - credentials state
  - test/save credential actions
  - sync controls and progress view
  - latest sync summary panel

## Files changed
- `apps/desktop/src/main/services/command-registry.ts`
- `apps/desktop/src/main/services/zendesk-sync-service.ts`
- `apps/desktop/src/main/services/workspace-repository.ts`
- `apps/desktop/src/renderer/src/pages/Settings.tsx`
- `packages/shared-types/src/batch3.ts`
- `docs/contracts/batch-3-ipc.md`
- `docs/contracts/batch-3-schema.md`
- `docs/contracts/batch-3-payloads.md`
- `docs/batches/codex-batch-3.md`
- `docs/claude-handoff/batch-3.md`

## DB schema changes
- Added migration `0002_zendesk_sync_state` (`packages/db/src/migrations.ts`):
  - `zendesk_credentials`
  - `zendesk_sync_checkpoints`
  - `zendesk_sync_runs`

## IPC additions
- Added commands and job runner listed in `docs/contracts/batch-3-ipc.md`:
  - `zendesk.credentials.get`
  - `zendesk.credentials.save`
  - `zendesk.connection.test`
  - `zendesk.categories.list`
  - `zendesk.sections.list`
  - `zendesk.articles.search`
  - `zendesk.sync.getLatest`
  - `zendesk.sync.run` runner

## Known limitations
- Category and section metadata is currently queried from Zendesk on demand; taxonomy persistence is not yet modeled locally.
- Incremental sync currently uses per-locale last sync timestamps; cursor handling is stored but not used as a stable API cursor contract.
- Retry/backoff policy is configurable per sync request and cancellation is exposed via job cancel API.
- Deletion/rename handling is implemented via variant retirement and metadata refresh, not full remote-delete lineage preservation.

## Renderer hooks available for Claude
Claude should use/update these methods in batch-3 UI tasks:
- `window.kbv.invoke('zendesk.credentials.get', { workspaceId })`
- `window.kbv.invoke('zendesk.credentials.save', { workspaceId, email, apiToken })`
- `window.kbv.invoke('zendesk.connection.test', { workspaceId })`
- `window.kbv.invoke('zendesk.categories.list', { workspaceId, locale })`
- `window.kbv.invoke('zendesk.sections.list', { workspaceId, locale, categoryId })`
- `window.kbv.invoke('zendesk.articles.search', { workspaceId, locale, query })`
- `window.kbv.startJob('zendesk.sync.run', { workspaceId, mode, locale })`
- `window.kbv.invoke('zendesk.sync.getLatest', { workspaceId })`
- Job event subscription to `zendesk.sync.run` via `window.kbv.emitJobEvents(...)`

## Known limitations for UI (current branch)
- Settings screen currently accepts manual sync mode and optional single-locale overrides but no schedule/auto-run.
- Job lifecycle errors and remote error payloads are surfaced as text but no dedicated retry state actions yet.
