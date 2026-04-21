# Design Handoff: Batch 8

## Screens Designed

### Drafts Editor
Full-height two-panel layout:
- **Left rail (280px):** Branch list with status filter tabs, per-branch validation summary, revision number, and selection state with left border accent
- **Right panel:** Three-mode editor (source/preview/compare) with header, segmented toolbar, content area, and right sidebar

### Editor Modes
1. **Source** — Full-height monospace textarea + right sidebar (validation, changes, history)
2. **Preview** — Rendered HTML with article typography + right sidebar
3. **Compare** — Side-by-side live vs draft, full width (sidebar hidden to maximize space)

## Components Created

| Component | Purpose |
|-----------|---------|
| BranchRail | Branch selector with filter, counts, validation indicators |
| ValidationPanel | Validation warnings with severity icons and line numbers |
| HistoryPanel | Revision timeline with source badges and relative times |
| ChangeRegionsPanel | Diff region list with color-coded kind dots |

## Interaction Patterns

- **Segmented tab control** — Source/Preview/Compare with active state highlight and shadow
- **Branch filter pills** — All/Active/Ready/Conflict quick filters in rail header
- **Keyboard shortcuts** — Save, undo, redo, tab switching with persistent hint bar
- **Autosave** — 5s debounce with pulsing dot indicator
- **Discard flow** — Confirmation dialog with reactivation option
- **Status banners** — Contextual warning/danger banners for conflicted, obsolete, discarded states
- **Unsaved indicator** — Orange dot next to title when content diverges from last save

## States Covered

- No workspace, loading, error, empty list, no selection, branch loading
- Active editing, read-only (obsolete/discarded/published)
- Conflicted/obsolete/discarded branch banners with actions
- Unsaved changes tracking
- Validation: clean vs warnings vs errors

## Accessibility Considerations

- Keyboard shortcuts discoverable via persistent bottom bar
- All color indicators paired with text
- Title attributes on action buttons
- Disabled state communicated via opacity and cursor changes
- Filter state announced via button aria

## Open Backend Gaps

- Monaco editor swap: Textarea is functional, Monaco plumbing ready but not wired
- Rich inline diff rendering for compare mode
- Branch creation from Article Explorer not yet surfaced

## Requested Contract Changes

None — all Batch 8 contracts consumed as-is.
