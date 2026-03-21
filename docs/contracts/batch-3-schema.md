# Batch 3 Schema (Domain model)

## New tables in migration v2
- `zendesk_credentials`
- `zendesk_sync_checkpoints`
- `zendesk_sync_runs`

## `zendesk_credentials`
- Primary purpose: store workspace-scoped Zendesk auth metadata with encrypted API token payload.
- Columns:
  - `workspace_id` (PK, workspace FK)
  - `email` (credential identity string)
  - `encrypted_api_token` (encrypted token blob string)
  - `updated_at`

## `zendesk_sync_checkpoints`
- Primary purpose: resumable incremental sync tracking per workspace and locale.
- Composite key: `(workspace_id, locale)`
- Columns:
  - `workspace_id` (FK to workspace)
  - `locale`
  - `last_synced_at`
  - `cursor`
  - `synced_articles`
  - `updated_at`

## `zendesk_sync_runs`
- Primary purpose: run-level sync telemetry and audit trail.
- Columns:
  - `id` (PK)
  - `workspace_id` (FK to workspace)
  - `mode` (`full` | `incremental`)
  - `state` (`RUNNING` | `SUCCEEDED` | `FAILED` etc.)
  - `started_at`
  - `ended_at`
  - `synced_articles`
  - `skipped_articles`
  - `created_families`
  - `created_variants`
  - `created_revisions`
  - `remote_error`
  - `cursor_summary`
  - `updated_at`

## Domain records affected by batch 3 writes
- `article_families`: upserted from Zendesk article metadata using `external_key`.
- `locale_variants`: created per family/locale when a synced article appears in a new locale.
- `revisions`: created as `LIVE` revisions during successful article sync.
- `draft_branches`: marked obsolete when article live revision changes.

## Shared payload types in `@kb-vault/shared-types`
- `ZendeskCredentialRecord`
- `ZendeskCredentialsInput`
- `ZendeskConnectionTestRequest`
- `ZendeskSyncMode`
- `ZendeskSyncRunRequest`
- `ZendeskSyncSummary`
- `ZendeskSyncRunRecord`
- `ZendeskSyncCheckpoint`
- `ZendeskSyncProgressPayload`
