# Codex Batch 5 Handoff

## What was built
- Added stable batch-5 shared-domain enums and batch payload shapes in `packages/shared-types/src/batch2.ts`:
  - `PBIBatchStatus`
  - `PBIBatchScopeMode`
  - `PBIImportFormat`
  - `PBIValidationStatus`
  - `PBIBatchImportRequest`, `PBIBatchImportSummary`, `PBIBatchRowsRequest`
  - `PBIBatchScopePayload`
- Extended DB enhancement migration in `packages/db/src/migrations.ts` (`0004_batch5_pbi_import_enhancements`) for:
  - imported source metadata (`source_path`, `source_format`)
  - status counters (`candidate`, `malformed`, `duplicate`, `ignored`, `scoped`)
  - scope metadata (`scope_mode`, `scope_payload`)
  - normalized row fields for PBI records (`state`, `work_item_type`, `raw_*`, parsed text, parent links, validation status/reason)
- Expanded PBI repository persistence in `apps/desktop/src/main/services/workspace-repository.ts`:
  - `createPBIBatch(...)`
  - `insertPBIRecords(...)`
  - `listPBIBatches(...)`
  - `getPBIBatch(...)`
  - `getPBIRecords(...)`
  - `setPBIBatchScope(...)`
  - `linkPBIRecordParents(...)`
- Added `PBIBatchImportService` in `apps/desktop/src/main/services/pbi-batch-import-service.ts`:
  - CSV and optional HTML table parsing
  - raw file persistence under workspace `imports/`
  - field auto-mapping with alias buckets
  - validation + dedupe classification
  - scoping resolution (`all`, `all_except_selected`, `selected_only`)
  - preflight payload building
- Wired new batch commands in `apps/desktop/src/main/services/command-registry.ts`:
  - `pbiBatch.import`
  - `pbiBatch.list`
  - `pbiBatch.get`
  - `pbiBatch.rows.list`
  - `pbiBatch.scope.set`
  - `pbiBatch.getPreflight`
  - `pbiBatch.setStatus`

## Files changed
- `packages/shared-types/src/batch2.ts`
- `packages/shared-types/src/index.ts`
- `packages/db/src/migrations.ts`
- `apps/desktop/src/main/services/workspace-repository.ts`
- `apps/desktop/src/main/services/pbi-batch-import-service.ts`
- `apps/desktop/src/main/services/command-registry.ts`
- `docs/contracts/batch-5-ipc.md`
- `docs/contracts/batch-5-schema.md`
- `docs/contracts/batch-5-payloads.md`
- `docs/batches/codex-batch-5.md`
- `docs/claude-handoff/batch-5.md`

## DB schema changes
- Added migration `0004_batch5_pbi_import_enhancements` in `packages/db/src/migrations.ts` with:
  - source metadata and counters on `pbi_batches`
  - validation/enrichment columns on `pbi_records`

## IPC additions
- Added commands and payload shape in `docs/contracts/batch-5-ipc.md`:
  - `pbiBatch.import`
  - `pbiBatch.list`
  - `pbiBatch.get`
  - `pbiBatch.rows.list`
  - `pbiBatch.scope.set`
  - `pbiBatch.getPreflight`
  - `pbiBatch.setStatus`

## Known limitations
- `pbiBatch.import` currently requires parser source provided as path or inline content; no background progress reporting yet.
- Duplicate handling currently runs by `externalId` only.
- Scoping payload stores row number/external id arrays but no hierarchical tree/file-list payload in workspace DB (UI can derive from titles/rows).
- `imported` -> `scoped` -> `submitted` -> `analyzed` -> `review_in_progress` -> `review_complete` -> `archived` transitions are now implemented with optional force overrides.

## Renderer hooks available for Claude
Claude should consume these methods for Batch 5 UI work:
- `window.kbv.invoke('pbiBatch.import', payload)`
- `window.kbv.invoke('pbiBatch.list', { workspaceId })`
- `window.kbv.invoke('pbiBatch.get', { workspaceId, batchId })`
- `window.kbv.invoke('pbiBatch.rows.list', { workspaceId, batchId, validationStatuses })`
- `window.kbv.invoke('pbiBatch.scope.set', { workspaceId, batchId, mode, selectedRows, selectedExternalIds })`
- `window.kbv.invoke('pbiBatch.getPreflight', { workspaceId, batchId })`
- `window.kbv.invoke('pbiBatch.setStatus', { workspaceId, batchId, status, force })`
