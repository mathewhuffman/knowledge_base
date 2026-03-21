# Claude Handoff: Batch 3

## Summary
Batch-3 backend read-side Zendesk integration now includes credentials, connection test, full/incremental sync, cursor summary telemetry, and read taxonomy/search endpoints.

## Components/pages Claude should touch
- `apps/desktop/src/renderer/src/pages/Settings.tsx`
  - polish Zendesk tab states, error surfaces, and completion messaging
  - expose full sync summary values including `cursorSummary`
  - add small reusable helper surfaces for Zendesk category/section/article lookups using new IPC endpoints

## View states to cover
- no credentials for workspace
- credentials saved/unsaved
- connection test pending/failing/succeeded
- sync job queued/running/succeeded/failed
- incremental/full sync distinction in UI
- empty prior sync history and prior failed run with remoteError
- remote article search/loading and no-result states

## Recommended implementation baseline
- Use IPC in `docs/contracts/batch-3-ipc.md`.
- Use `window.kbv.startJob('zendesk.sync.run', { workspaceId, mode, locale })` for manual sync control.
- Render running progress from `window.kbv.emitJobEvents` for `zendesk.sync.run`.
- Refresh `zendesk.sync.getLatest` after run completion/failure.
- Add optional quick lookups:
  - `zendesk.categories.list`
  - `zendesk.sections.list`
  - `zendesk.articles.search`
- Keep API token input value out of persistent renderer state.

## Open backend gaps to reflect in UI
- Cursor contract is persisted as opaque per-locale summary, not yet a robust API cursor model.
- Deletion/rename handling is implemented as retire/metadata-refresh, not explicit lineage deletion history.
- Cancellation controls are available via `window.kbv.cancelJob(jobId)`.
- Retry/backoff policy supports optional client-provided overrides (`maxRetries`, `retryDelayMs`, `retryMaxDelayMs`).

## Back-end contracts to preserve
- `ZendeskCredentialRecord`
- `ZendeskSyncRunRecord`
- `ZendeskCategoriesListRequest`
- `ZendeskSectionsListRequest`
- `ZendeskSearchArticlesRequest`
- `ZendeskSyncMode`
