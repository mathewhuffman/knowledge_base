# Codex Batch 8 Handoff

## What Was Built

- Added a dedicated Batch 8 draft-editing contract layer in `packages/shared-types/src/batch8.ts`.
- Extended workspace draft persistence with migration `0010_batch8_draft_editor_state` for:
  - branch head revision tracking,
  - autosave/manual-save metadata,
  - persisted editor state,
  - change summaries,
  - revision commit history.
- Upgraded `WorkspaceRepository` with working draft-branch lifecycle APIs for:
  - branch listing,
  - editor hydration,
  - manual branch creation,
  - draft saves/autosaves,
  - validation warnings,
  - live-vs-draft compare payloads,
  - status transitions,
  - discard,
  - undo/redo by head-revision movement.
- Extended proposal acceptance/apply hooks so draft branches now persist:
  - `head_revision_id`,
  - change summary,
  - commit history rows,
  - lineage edges for proposal-driven draft revisions.
- Replaced the Drafts route placeholder with a real Batch 8 editor surface backed by live IPC.

## Files Added/Changed

- Added: `packages/shared-types/src/batch8.ts`
- Added: `docs/batches/codex-batch-8.md`
- Added: `docs/claude-handoff/batch-8.md`
- Added: `docs/contracts/batch-8-ipc.md`
- Added: `docs/contracts/batch-8-schema.md`
- Added: `docs/contracts/batch-8-payloads.md`
- Changed: `packages/shared-types/src/index.ts`
- Changed: `packages/db/src/migrations.ts`
- Changed: `apps/desktop/src/main/services/workspace-repository.ts`
- Changed: `apps/desktop/src/main/services/command-registry.ts`
- Changed: `apps/desktop/src/renderer/src/pages/Drafts.tsx`
- Changed: `apps/desktop/tests/repository-content-model.spec.ts`
- Changed: `apps/desktop/tests/command-registry-content-model.spec.ts`

## DB Schema / Migration Changes

- Added migration `0010_batch8_draft_editor_state`.
- New `draft_branches` columns:
  - `head_revision_id`
  - `autosave_enabled`
  - `last_autosaved_at`
  - `last_manual_saved_at`
  - `change_summary`
  - `editor_state_json`
- New table:
  - `draft_revision_commits`
    - `revision_id`
    - `branch_id`
    - `workspace_id`
    - `commit_kind`
    - `commit_message`
    - `created_at`
- Existing branches are backfilled so `head_revision_id` points at the latest known branch revision.

## IPC Endpoints Added

- `draft.branch.list`
- `draft.branch.get`
- `draft.branch.create`
- `draft.branch.save`
- `draft.branch.status.set`
- `draft.branch.discard`
- `draft.branch.undo`
- `draft.branch.redo`

## Background Jobs Added

- None.
- Draft editing remains synchronous in Batch 8.
- Autosave is represented as a mutation mode and persisted metadata, not a background timer/job yet.

## Sample Payloads

- See `docs/contracts/batch-8-payloads.md`

## Renderer Hooks Available For Claude

- `draft.branch.list`
  - Use for branch selector rails, counts, branch chips, and obsolete/conflict prompts.
- `draft.branch.get`
  - Use for the editor shell, compare header, validation rail, autosave state, and revision history.
- `draft.branch.save`
  - Use for manual save and autosave actions.
- `draft.branch.status.set`
  - Use for ready-to-publish, conflict acknowledgement, and future published-state UX.
- `draft.branch.discard`
  - Use for discard confirmation flows.
- `draft.branch.undo`
- `draft.branch.redo`

## Exact Places Claude Should Plug UI Into

- Replace or refine the current functional editor in `apps/desktop/src/renderer/src/pages/Drafts.tsx`.
- Keep using the new payload areas directly:
  - `summary`
  - `branch`
  - `editor.compare`
  - `editor.validationWarnings`
  - `editor.autosave`
  - `editor.history`
  - `editor.capabilities`

## Known Limitations

- Monaco package integration is represented by contract/capability plumbing and editor-ready payloads; the current shipped renderer still uses a textarea-based editing host.
- HTML validation is heuristic in Batch 8. It catches common structural issues and unsupported tags, but it is not a full parser-grade validator yet.
- Conflict status is derived from base-live divergence and explicit branch state, not from a full three-way publish conflict engine. That deeper workflow still belongs in Batch 10.
- Undo/redo moves the branch head across persisted revisions; it does not implement ephemeral in-memory editing history.

## Verification

- Passed:
  - `apps/desktop/node_modules/.bin/tsc -p packages/shared-types/tsconfig.json --noEmit`
  - `apps/desktop/node_modules/.bin/tsc -p packages/shared-types/tsconfig.json`
  - `apps/desktop/node_modules/.bin/tsc -p apps/desktop/tsconfig.main.json --noEmit`
  - `apps/desktop/node_modules/.bin/tsc -p apps/desktop/tsconfig.renderer.json --noEmit`
- Focused Playwright verification is still blocked in this environment because `better-sqlite3` is compiled for a different Node ABI than the active runtime (`NODE_MODULE_VERSION 123` vs `137`).
