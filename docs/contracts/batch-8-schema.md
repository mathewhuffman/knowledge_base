# Batch 8 Schema (Domain model)

## Migration added

- `0010_batch8_draft_editor_state`

## Draft branch additions

- `head_revision_id TEXT`
- `autosave_enabled INTEGER NOT NULL DEFAULT 1`
- `last_autosaved_at TEXT`
- `last_manual_saved_at TEXT`
- `change_summary TEXT`
- `editor_state_json TEXT`

## New table

### `draft_revision_commits`

- `revision_id TEXT PRIMARY KEY`
- `branch_id TEXT NOT NULL`
- `workspace_id TEXT NOT NULL`
- `commit_kind TEXT NOT NULL`
- `commit_message TEXT`
- `created_at TEXT NOT NULL`

## Domain behavior introduced in batch 8

- Draft branches now have a persisted current head revision.
- Undo/redo moves the branch head across persisted branch revisions.
- Saves append a new draft revision and update branch autosave/manual-save metadata.
- Validation warnings are generated on editor hydration and save.
- Live-vs-draft compare payloads are generated for every editor load/save response.
- Proposal-created draft revisions now also seed draft commit history and lineage metadata.
