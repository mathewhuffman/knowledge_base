# Claude Handoff: Batch 5

## Summary
Batch 5 backend foundations are now available for PBI batch import, validation, and scoping. Claude should implement the upload + review workflow using the new commands and payloads.

## Features to surface in UI
- Upload workflow that sends `pbiBatch.import` with file path/content and optional user mapping overrides.
- Parse-summary screen using:
  - `batch`
  - `summary`
  - `invalidRows`
  - `duplicateRows`
  - `ignoredRows`
- Duplicate and malformed review tables/rows.
- Scope picker that writes selected rows via `pbiBatch.scope.set`.
- Preflight confirmation screen driven by `pbiBatch.getPreflight`.

## Suggested implementation surface
- New backend methods to call:
  - `pbiBatch.import`
  - `pbiBatch.list`
  - `pbiBatch.get`
  - `pbiBatch.rows.list`
  - `pbiBatch.scope.set`
  - `pbiBatch.getPreflight`
  - `pbiBatch.setStatus`
- Use shared payload records from `@kb-vault/shared-types`.

## Exact states to render
- Candidate count versus ignored/invalid/duplicate counts from summary.
- Candidate row list with:
  - `validationStatus`
  - `validationReason`
  - `sourceRowNumber`
  - `externalId`
  - `title`
  - optional `title1`, `title2`, `title3`
- Scope mode controls and scoped row count feedback from `scopePayload.scopedCount` and `scopedRowNumbers`.

## Open backend gaps to call out in UI copy
- No automatic progress events during import yet.
- No tree/folder file picker for scoping in backend; scoping only by source row/external IDs for now.
- Batch status transitions now include `pbiBatch.setStatus` (`imported -> scoped -> submitted -> analyzed -> review_in_progress -> review_complete -> archived`) with optional `force` override for controlled recovery.
- There is no artifact payload for "source file diff" beyond the persisted path in `batch.sourcePath`.

## UX notes for implementation
- Keep the parse/validation summary in the foreground before scoping controls.
- Make `invalidRows` and `duplicateRows` explicit and non-blocking.
- Warn users that `ignored`/`malformed` rows are surfaced and excluded from default analysis scope.
