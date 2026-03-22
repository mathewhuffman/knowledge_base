# Claude Batch 4 — Polished Article Browsing Experience

**Status:** Complete
**Date:** 2026-03-21

## What was built

Full visual polish pass on the article explorer and article detail experience. Replaced all inline styles with semantic CSS classes. Added breadcrumb navigation, proper tab bar, timeline history visualization, visual placeholder blocks, and improved filter rail.

## Files added/changed

### Changed
- `apps/desktop/src/renderer/src/pages/ArticleExplorer.tsx` — Complete rewrite of rendering layer. Extracted 6 sub-components. Replaced all inline `style={}` with CSS classes. Added breadcrumb, tab bar, timeline, placeholder blocks, selected-row highlighting.
- `apps/desktop/src/renderer/src/styles/components.css` — Added ~350 lines of explorer-specific CSS classes (explorer layout, filter rail, article rows, search, sync banner, breadcrumb, detail drawer, tab bar, preview/source, placeholders, timeline, lineage, publish log, PBI cards).
- `apps/desktop/src/renderer/src/components/Drawer.tsx` — Added `variant` prop supporting `'default' | 'wide'`. Wide variant is 560px.
- `apps/desktop/src/renderer/src/components/icons.tsx` — Added 8 new icons: Clock, Globe, Eye, Code, Link, Image, ChevronRight, ArrowUpRight.

### Added
- `docs/design-handoff/batch-4.md`
- `docs/batches/claude-batch-4.md`

## Interaction decisions

1. **Filter rail** uses dedicated CSS classes with active state in primary-subtle blue instead of btn-secondary toggle, giving a more integrated sidebar feel.
2. **Article rows** show a selected state when their detail drawer is open, providing clear visual connection between list and detail.
3. **History button** is hover-revealed to reduce visual noise — appears on row hover only.
4. **Detail tab bar** uses proper `.detail-tab` pattern with bottom-border accent (not button toggles), consistent with the existing `.tab-bar` / `.tab-item` system.
5. **Breadcrumb** provides navigation context and a quick way to close the drawer.
6. **Placeholder blocks** use dashed warning borders with image icons — visually distinct from content, clearly flagged as unresolved.
7. **History timeline** uses a vertical line with color-coded dots (green for live/promoted, blue for draft) instead of flat card list.

## Open backend gaps discovered

None. All existing IPC contracts (tree, search, detail, history, sync) are consumed correctly.

## Test coverage

No new tests added — this batch is UI-only polish. Codex tests for the underlying IPC and data layer remain unchanged.
