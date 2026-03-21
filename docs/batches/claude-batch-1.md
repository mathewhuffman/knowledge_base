# Claude Batch 1 — Visual App Shell

**Date:** 2026-03-21
**Status:** Complete

## What was built

### Design System Foundation
- **Design tokens** — Complete CSS custom property system covering colors (neutrals, brand, semantic, status), typography (sizes, weights, leading), spacing scale, border radii, shadows, transitions, and layout constants
- **Reset & base styles** — CSS reset, scrollbar styling, focus-visible ring, user-select rules for Electron, antialiasing
- **Component styles** — Full CSS class library for all UI primitives

### Core Layout
- **App shell** — Dark sidebar + white content area desktop layout
- **Sidebar component** — Logo, workspace selector, sectioned navigation (Workflow + Tools), active state with left accent bar, footer status indicator
- **Page header system** — Title + subtitle + actions pattern used by all routes

### Reusable Components
- `Sidebar` — Full navigation with icons, sections, active states, workspace selector, connection status
- `PageHeader` — Title/subtitle/actions header bar
- `Badge` — Variants: neutral, primary, success, warning, danger
- `StatusChip` — Dot + label for live, draft, conflicted, retired, pending, active
- `EmptyState` — Icon + title + description + optional action CTA
- `LoadingState` — Spinner + message
- `ErrorState` — Alert icon + title + description + action
- `Kbd` — Keyboard shortcut hint with key-cap styling

### Icon Library
18 inline SVG icon components: Home, Folder, FileText, Upload, CheckCircle, GitBranch, Send, Layout, Settings, Layers, Search, ChevronDown, X, AlertCircle, Inbox, Zap, RefreshCw, Plus

### Polished Route Pages (all 9)

1. **Workspace Switcher** — Workspace cards with icon, name, last sync, article count, draft badges, status chip
2. **KB Vault Home** — Stat grid (articles, drafts, pending review, last sync) + recent batches card + recent drafts card
3. **Article Explorer** — Filter sidebar (status + locale) + category/section/article tree with status chips and locale badges
4. **PBI Batches** — Table view with batch name, date, row/candidate/proposal counts, status badges; empty state for no batches
5. **Proposal Review** — 3-column layout: proposal queue (left), preview area with tab bar (center), evidence + confidence + actions with keyboard hints (right)
6. **Drafts** — Table view with article, branch code, base revision, locale, status chip, updated time
7. **Publish Queue** — Validation summary panel + checkbox table with article, branch, type, locale, validation status
8. **Templates & Prompts** — Tab bar (templates / prompts) + template card grid with icon, name, description, type badge, usage count
9. **Settings** — Left section nav + content panels for Zendesk connection (form fields + status), Locales, AI Runtime, Workspace, About

## Files added/changed

### New files
- `src/renderer/src/styles/tokens.css` — Design tokens
- `src/renderer/src/styles/reset.css` — CSS reset and base
- `src/renderer/src/styles/components.css` — All component styles
- `src/renderer/src/components/Sidebar.tsx` — Sidebar navigation
- `src/renderer/src/components/PageHeader.tsx` — Page header
- `src/renderer/src/components/Badge.tsx` — Badge component
- `src/renderer/src/components/StatusChip.tsx` — Status indicator
- `src/renderer/src/components/EmptyState.tsx` — Empty state
- `src/renderer/src/components/LoadingState.tsx` — Loading state
- `src/renderer/src/components/ErrorState.tsx` — Error state
- `src/renderer/src/components/Kbd.tsx` — Keyboard hint
- `src/renderer/src/components/icons.tsx` — SVG icon library

### Modified files
- `src/renderer/src/styles.css` — Now imports token/reset/component stylesheets
- `src/renderer/src/App.tsx` — Uses Sidebar component, starts on Home route
- `src/renderer/src/pages/WorkspaceSwitcher.tsx` — Full layout
- `src/renderer/src/pages/KBVaultHome.tsx` — Full layout
- `src/renderer/src/pages/ArticleExplorer.tsx` — Full layout
- `src/renderer/src/pages/PBIBatches.tsx` — Full layout
- `src/renderer/src/pages/ProposalReview.tsx` — Full layout
- `src/renderer/src/pages/Drafts.tsx` — Full layout
- `src/renderer/src/pages/PublishQueue.tsx` — Full layout
- `src/renderer/src/pages/TemplatesAndPrompts.tsx` — Full layout
- `src/renderer/src/pages/Settings.tsx` — Full layout

## Interaction patterns introduced
- Dark sidebar with light content area (VS Code / Linear style)
- Active route indicator with left accent bar
- Workspace selector dropdown pattern in sidebar
- Page header with title + subtitle + right-aligned actions
- Sectioned sidebar navigation (Workflow vs Tools)
- Filter rail pattern (Article Explorer, Settings)
- Stat grid for overview metrics
- Card-based content lists with hover states
- 3-column review layout (queue / preview / evidence)
- Tab bar for content mode switching
- Table views with status badges for list screens
- Keyboard shortcut hints on review actions

## Accessibility considerations
- `role="navigation"` and `aria-label` on sidebar
- `aria-current="page"` on active nav items
- `:focus-visible` ring on all interactive elements
- Semantic heading hierarchy maintained per page
- Color contrast ratios maintained (WCAG AA)
- Keyboard navigable sidebar and all controls

## States covered
- Active/inactive nav items
- Connected/offline connection status
- Empty states for all list views
- Loading state component
- Error state component
- Hover states on cards, buttons, table rows
- Disabled button states

## Known backend gaps
- All page data is currently hardcoded placeholder — needs real IPC data hooks starting Batch 2
- Workspace selector click navigates to Workspace Switcher page (no dropdown yet)
- No real route persistence or deep linking

## Intentionally deferred polish
- Responsive/collapsible sidebar
- Animated route transitions
- Drag-and-drop interactions
- Toast/notification system
- Command palette (Cmd+K)
- Dark mode theme variant
