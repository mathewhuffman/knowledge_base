# Claude Batch 4 — Design Handoff

## Screens designed

### Article Explorer (polished)
Full polish pass on the article browsing experience built by Codex in Batch 4.

### Article Detail Drawer (wide variant)
560px wide drawer with tabbed detail view, breadcrumb navigation, timeline history, and visual placeholder blocks.

## Components created

### New CSS class systems
- **Explorer layout** — `.explorer-layout`, `.explorer-filter-rail`, `.explorer-main` for the two-column explorer
- **Filter rail** — `.explorer-filter-btn`, `.explorer-filter-heading`, `.explorer-filter-count` with active state highlighting in primary-subtle
- **Article rows** — `.explorer-article-row` with hover border, selected state (primary highlight when drawer is open for that article), and hover-revealed history button
- **Search** — `.explorer-search-wrapper` with absolutely-positioned search icon, `.explorer-search-row`, `.explorer-search-header`
- **Sync banner** — `.explorer-sync-banner` with `--fresh`/`--stale` variants
- **Breadcrumb** — `.breadcrumb`, `.breadcrumb-item`, `.breadcrumb-separator`, `.breadcrumb-item--link`, `.breadcrumb-item--current`
- **Detail drawer** — `.drawer--wide` (560px variant), `.detail-tab-bar`, `.detail-tab` (proper tab-item pattern with bottom border accent), `.detail-header`, `.detail-header-meta`, `.detail-locale-selector`
- **Preview panel** — `.detail-preview-card` with basic typographic resets for rendered HTML content, `.detail-source-view` with mono font
- **Placeholder blocks** — `.placeholder-section`, `.placeholder-block` (dashed border, warning-colored, image icon)
- **History timeline** — `.timeline` with vertical line, `.timeline-item`, `.timeline-dot` (color-coded: `--live`, `--draft`, `--promoted`)
- **Lineage cards** — `.lineage-list`, `.lineage-card` with link icon and mono IDs
- **Publish log** — `.publish-list`, `.publish-card` with result badges
- **PBI cards** — `.pbi-list`, `.pbi-card` with mono external ID

### New React sub-components (within ArticleExplorer.tsx)
- `Breadcrumb` — renders nav breadcrumb with clickable ancestors
- `HistoryTimeline` — vertical timeline with color-coded dots per revision type
- `LineagePanel` — card list with link icons and predecessor→successor display
- `PublishLogPanel` — card list with Zendesk ID and result badge
- `PBIPanel` — card list with external ID, title, description
- `PlaceholderBlocks` — dashed warning blocks with image icon for unresolved placeholders

### New icons
- `IconClock` — history/time contexts
- `IconGlobe` — locale/language contexts
- `IconEye` — preview tab
- `IconCode` — source tab
- `IconLink` — lineage/relationships
- `IconImage` — placeholders
- `IconChevronRight` — breadcrumb separator
- `IconArrowUpRight` — external link (available for future use)

### Drawer enhancement
- `Drawer` component now accepts `variant?: 'default' | 'wide'` prop
- Wide variant renders at 560px for article detail views

## Interaction patterns introduced

- **Selected row highlight** — when the detail drawer is open for an article, that row gets a blue primary border/bg highlight
- **Hover-revealed history button** — the "History" shortcut on each row is invisible until hover, preventing visual clutter
- **Breadcrumb close** — clicking "Articles" in the breadcrumb closes the drawer and returns focus to the list
- **Tab bar navigation** — proper accessible tab-bar with `role="tablist"` and `aria-selected` for each tab
- **Locale switching** — changing locale in the drawer reloads detail data for the selected locale variant

## Accessibility considerations

- Tab bar uses `role="tablist"` and `role="tab"` with `aria-selected`
- Drawer uses `role="dialog"` and `aria-modal="true"`
- History button has `aria-label` describing the target article
- Breadcrumb uses `<nav>` with `aria-label="Breadcrumb"`
- All interactive elements are focusable with keyboard

## States covered

- No workspace: empty state with folder icon
- Loading tree: spinner
- Error loading tree: error state with retry button
- Empty filter results: empty state with guidance
- Search mode: results count header, result rows
- Search loading: spinner
- Search no results: empty state
- Detail loading: spinner in drawer
- Detail error: error state in drawer
- Detail loaded: all 6 tab panels
- Tab panels with no data: empty state per panel
- Locale variants: dropdown when multiple locales exist

## Known backend gaps

- None discovered — all Batch 4 IPC contracts work as documented

## Any requested contract changes

- None — Drawer component enhanced with backward-compatible `variant` prop

## Intentionally deferred polish

- Keyboard shortcuts (J/K navigation between articles, Escape to close drawer) — deferred to hardening batch
- Category/section breadcrumb hierarchy in detail view — requires category/section names in ExplorerNode or ArticleDetailResponse, currently only IDs available
- Virtual scrolling for large article trees — deferred until performance testing proves it necessary
- Drag-to-resize on the detail drawer — nice-to-have, not critical for v1
