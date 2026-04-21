# Claude Batch 8 — Draft Editing UX

## What Was Built

Polished draft editing experience replacing the functional-but-raw Codex scaffold with a production-quality editor layout.

### Components Created

- **BranchRail** — Left rail with branch list, filter tabs (all/active/ready/conflicted), summary counts, per-branch validation indicators
- **ValidationPanel** — Sidebar section showing validation warnings with severity badges, codes, messages, and line numbers
- **HistoryPanel** — Sidebar section with revision timeline showing commit sources (proposal/manual/autosave/system), relative timestamps, and current revision highlighting
- **ChangeRegionsPanel** — Sidebar section listing diff change regions with color-coded kind indicators (added/removed/changed)
- **Discard confirmation dialog** — Uses existing ConfirmationDialog component with danger variant

### New Icons Added

- `IconCornerUpLeft` (undo)
- `IconCornerUpRight` (redo)
- `IconSave`
- `IconTrash2`
- `IconColumns` (compare view)
- `IconRotateCcw`
- `IconFilter`

### View States Covered

1. **No workspace** — Empty state prompting workspace selection
2. **Loading** — Spinner while branch list loads
3. **Error** — Error state with description
4. **Empty branch list** — Contextual empty state based on active filter
5. **No branch selected** — Centered prompt to select a branch
6. **Branch loading** — Spinner within editor panel
7. **Active branch editing** — Full source/preview/compare editor
8. **Read-only states** — Disabled editor for obsolete/discarded/published branches
9. **Conflicted branch** — Red banner with conflict explanation
10. **Obsolete branch** — Warning banner with reactivate action
11. **Discarded branch** — Warning banner with reactivate action
12. **Unsaved changes** — Pulsing dot indicator in header and toolbar

### Interaction Patterns

- **Tab switcher** — Segmented control (Source / Preview / Compare) with keyboard shortcuts Cmd+1/2/3
- **Branch filter** — Pill-style filter in rail header for quick filtering by status
- **Keyboard shortcuts** — Cmd+S save, Cmd+Z undo, Cmd+Shift+Z redo, Cmd+1/2/3 tab switching
- **Autosave** — 5-second debounce on content changes, visual dot indicator showing save state
- **Compare view** — Side-by-side live vs draft with labeled panes, no sidebar to maximize diff space
- **Discard flow** — Confirmation dialog before discard, branch remains reactivatable
- **Status transitions** — Mark Ready, Back to Active, Reactivate from obsolete/discarded

### Accessibility Considerations

- All buttons have title attributes for keyboard shortcut discoverability
- Keyboard shortcut bar visible at bottom of editor
- Focus management: textarea gets focus on source tab
- Color indicators always paired with text labels (validation severity, branch status)
- Read-only state communicated via disabled buttons and placeholder text

### CSS Added

~350 lines of draft editor styles in `components.css`:
- `.draft-layout` — Full-height two-column grid
- `.draft-rail-*` — Branch list rail with filter, items, selection state
- `.draft-editor-*` — Header, toolbar, body grid
- `.draft-toolbar-*` — Segmented tab control, autosave status
- `.draft-source-editor` — Full-height monospace textarea
- `.draft-preview-pane` — Rendered HTML with article typography
- `.draft-compare-*` — Side-by-side diff container
- `.draft-sidebar-*` — Right sidebar sections
- `.draft-validation-*` — Warning items with severity
- `.draft-history-*` — Revision timeline entries
- `.draft-region-*` — Change region list items
- `.draft-kbd-bar` — Keyboard hints footer
- `.draft-branch-banner` — Warning/danger status banners

## Files Changed

- `apps/desktop/src/renderer/src/pages/Drafts.tsx` — Complete rewrite
- `apps/desktop/src/renderer/src/components/icons.tsx` — 7 new icon components
- `apps/desktop/src/renderer/src/styles/components.css` — ~350 lines of draft editor styles

## Known Backend Gaps

- Monaco integration is ready via `capabilities.preferredEditor: 'monaco'` but current renderer uses textarea. Monaco swap is straightforward — replace the textarea with a Monaco editor instance using the same `draftHtml` / `setDraftHtml` state.
- Compare view shows raw HTML text side-by-side. A richer rendered diff (highlighting inline additions/removals) would require additional diff rendering logic.
- Autosave is client-side debounce; the backend `autosave` metadata is informational but doesn't run a server-side timer.

## Intentionally Deferred

- Monaco editor integration (ready to wire, textarea is functional placeholder)
- Rich rendered diff visualization (beyond side-by-side text compare)
- Branch creation flow from Article Explorer (Batch 8 backend supports it via `draft.branch.create`)
- Revision preview on history item click (data is available, UX not yet wired)
