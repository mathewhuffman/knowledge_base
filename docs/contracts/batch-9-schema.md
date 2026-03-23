# Batch 9 Schema (Domain model)

## Migration Added

- `0011_batch9_article_ai_and_templates`

## New Tables

### `article_ai_sessions`

- `id TEXT PRIMARY KEY`
- `workspace_id TEXT NOT NULL`
- `locale_variant_id TEXT NOT NULL`
- `branch_id TEXT`
- `target_type TEXT NOT NULL`
- `current_revision_id TEXT NOT NULL`
- `current_html TEXT NOT NULL`
- `pending_html TEXT`
- `pending_summary TEXT`
- `pending_rationale TEXT`
- `pending_metadata_json TEXT`
- `template_pack_id TEXT`
- `runtime_session_id TEXT`
- `status TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

### `article_ai_messages`

- `id TEXT PRIMARY KEY`
- `session_id TEXT NOT NULL`
- `workspace_id TEXT NOT NULL`
- `role TEXT NOT NULL`
- `message_kind TEXT NOT NULL`
- `preset_action TEXT`
- `content TEXT NOT NULL`
- `metadata_json TEXT`
- `created_at TEXT NOT NULL`

## `template_packs` Additions

- `template_type TEXT`
- `description TEXT`
- `analysis_json TEXT`

## Domain Behavior Introduced

- Article AI chat history persists until reset.
- AI-generated edits are stored as pending article updates before acceptance.
- Accepting a pending AI edit writes a real draft revision and clears pending state.
- Rejecting a pending AI edit clears only the pending state while preserving transcript history.
- Resetting an article AI session clears transcript and pending edit state.
- Template packs now carry type, description, and cached analysis metadata.
