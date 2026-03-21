# Codex Batch 2 Handoff

## What was built
- Added shared batch-2 domain contracts in `packages/shared-types/src/batch2.ts`.
- Exported batch-2 contracts via shared package index.
- Upgraded batch-2 DB migration specification in `packages/db/src/migrations.ts` with a full schema shape for workspace/domain tables.
- Added sqlite-backed workspace repository layer in `apps/desktop/src/main/services/workspace-repository.ts` with:
  - catalog persistence in `.meta/catalog.sqlite`
  - workspace-local filesystem scaffold
  - domain DB bootstrap per workspace (`.meta/kb-vault.sqlite`)
  - explorer tree projection
  - search and history query helpers
  - local repository path contract output
- Extended command registry in `apps/desktop/src/main/services/command-registry.ts` with CRUD and batch-2 query endpoints.

## Files changed
- `packages/shared-types/src/batch2.ts`
- `packages/shared-types/src/index.ts`
- `packages/db/src/migrations.ts`
- `apps/desktop/src/main/services/workspace-repository.ts`
- `apps/desktop/src/main/services/command-registry.ts`
- `docs/contracts/batch-2-ipc.md`
- `docs/contracts/batch-2-schema.md`
- `docs/contracts/batch-2-payloads.md`

## DB schema changes
- Introduced migration DDL for workspace + article lifecycle tables (`workspaces`, `article_families`, `locale_variants`, `revisions`, `draft_branches`, `pbi_batches`, `pbi_records`, `ai_runs`, `proposals`, `proposal_pbi_links`, `publish_jobs`, `publish_records`).

## IPC additions
- Added workspace methods listed in `docs/contracts/batch-2-ipc.md`.

## Known limitations
- Migration bootstrap and recovery are now integrated and surfaced via `system.migrations.health`.
- Per-workspace DB migration and recovery state is wired into repository operations.
- Per-workspace DB query coverage is still scaffold-level for families/variants/revisions.
- Search is string-match against family title only and is intentionally non-weighted in this batch.

## Renderer hooks available for Claude
- Replace batch-2 placeholders with real data by invoking:
  - `window.kbv.invoke('workspace.list')`
  - `window.kbv.invoke('workspace.create', payload)`
  - `window.kbv.invoke('workspace.open', { workspaceId })`
  - `window.kbv.invoke('workspace.explorer.getTree', { workspaceId })`
  - `window.kbv.invoke('workspace.search', { workspaceId, query, locales })`
  - `window.kbv.invoke('workspace.history.get', { workspaceId, localeVariantId })`
  - `window.kbv.invoke('workspace.repository.info', { workspaceId })`
