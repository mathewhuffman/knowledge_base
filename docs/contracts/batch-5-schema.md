# Batch 5 Schema (Domain model)

## New fields in migration v4 (`0004_batch5_pbi_import_enhancements`)

`pbi_batches`
- `source_path` (TEXT, NOT NULL, default `''`)
- `source_format` (TEXT, NOT NULL, default `'csv'`)
- `candidate_row_count` (INTEGER, NOT NULL, default `0`)
- `ignored_row_count` (INTEGER, NOT NULL, default `0`)
- `malformed_row_count` (INTEGER, NOT NULL, default `0`)
- `duplicate_row_count` (INTEGER, NOT NULL, default `0`)
- `scoped_row_count` (INTEGER, NOT NULL, default `0`)
- `scope_mode` (TEXT, NOT NULL, default `'all'`)
- `scope_payload` (TEXT, nullable)

`pbi_records`
- `state` (TEXT, nullable)
- `work_item_type` (TEXT, nullable)
- `title1` (TEXT, nullable)
- `title2` (TEXT, nullable)
- `title3` (TEXT, nullable)
- `raw_description` (TEXT, nullable)
- `raw_acceptance_criteria` (TEXT, nullable)
- `description_text` (TEXT, nullable)
- `acceptance_criteria_text` (TEXT, nullable)
- `parent_external_id` (TEXT, nullable)
- `parent_record_id` (TEXT, nullable)
- `validation_status` (TEXT, NOT NULL, default `'candidate'`)
- `validation_reason` (TEXT, nullable)

## Domain behavior introduced in batch 5
- `PBIBatchStatus` machine:
  - `imported` -> `scoped` -> `submitted` -> `analyzed` -> `review_in_progress` -> `review_complete` -> `archived`
  - `create` flow starts at `imported`, `setPBIBatchScope` updates to `scoped`.
- `PBIBatchScopeMode`:
  - `all`
  - `all_except_selected`
  - `selected_only`
- `PBIValidationStatus`:
  - `candidate`
  - `malformed`
  - `duplicate`
  - `ignored`

## Shared payload types in `@kb-vault/shared-types`
- `PBIBatchRecord`
- `PBIRecord`
- `PBIBatchImportRequest`
- `PBIBatchImportSummary`
- `PBIBatchRowsRequest`
- `PBIBatchScopePayload`
- `PBIFieldMapping`
- `PBIBatchScopeMode`
- `PBIValidationStatus`
- `PBIImportFormat`
- `PBIBatchStatusUpdateRequest`
