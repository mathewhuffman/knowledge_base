# Claude Handoff: Batch 2

## Summary
Batch-2 backend scaffolding for workspace/domain model is now in place. Claude can begin implementing UI for:
- Workspace setup flows (create/open/delete)
- Workspace list and detail states
- Explorer tree shell bound to real contract shape
- Search and history panes

## Components/pages Claude should touch
- `apps/desktop/src/renderer/src/pages/WorkspaceSwitcher.tsx`
- `apps/desktop/src/renderer/src/pages/ArticleExplorer.tsx`
- `apps/desktop/src/renderer/src/pages/KBVaultHome.tsx`
- `apps/desktop/src/renderer/src/pages/PBIBatches.tsx` (for future workspace-aware states)

## View states to cover
- empty state when no workspaces exist
- loading/error states for `workspace.create`, `workspace.list`, `workspace.open`
- article explorer empty/success states based on `workspace.explorer.getTree`
- search result none/results states using `workspace.search`
- revision history list from `workspace.history.get`

## Open backend gaps
- Migration health now surfaces catalog and per-workspace migration versions via `system.migrations.health`.
- Search is basic title match only.

## Recommended implementation baseline
- Use route `KBVaultHome` to display active workspace root and repository path via `workspace.repository.info`.
- Keep all renderer types imported from `@kb-vault/shared-types` batch-2 payload types.
- Avoid creating new commands in renderer beyond batch-2 list above.
