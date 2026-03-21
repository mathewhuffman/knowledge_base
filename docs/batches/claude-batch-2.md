# Claude Batch 2 — Workspace Setup & Local Data UX

**Date:** 2026-03-21
**Status:** Complete

## What was built

### Data Layer Hooks
- **`useIpc<T>(method)`** — Generic hook for typed IPC calls with `{ data, loading, error, execute, reset }` state management
- **`useIpcMutation<T>(method)`** — Fire-and-forget mutation variant for write operations
- **`WorkspaceProvider` / `useWorkspace()`** — React context managing workspace lifecycle:
  - Auto-fetches workspace list on mount via `workspace.list`
  - `openWorkspace(id)` calls `workspace.open` and sets active workspace
  - `createWorkspace(payload)` calls `workspace.create`, refreshes list
  - `closeWorkspace()` clears active workspace
  - Exposes `{ workspaces, activeWorkspace, loading, error }` to all consumers

### Components Added
- **`Modal`** — Animated modal with backdrop, header, body, footer slots; `role="dialog"` + `aria-modal`
- **`Drawer`** — Right-anchored slide-in panel with same slot pattern; used for revision history
- **`CreateWorkspaceModal`** — Full form for `WorkspaceCreateRequest`:
  - Workspace name (required)
  - Zendesk subdomain with `.zendesk.com` suffix display
  - Default locale dropdown
  - Enabled locales checklist (default always enabled)
  - Validation, loading, and error states
- **Component barrel export** (`components/index.ts`)

### Pages Updated

#### WorkspaceSwitcher (fully data-driven)
- Consumes `useWorkspace()` for workspace list
- Loading/error/empty states for workspace list
- Each workspace card shows: name, last opened date, article count, draft count, state chip
- Click opens workspace via `openWorkspace(id)`
- "New Workspace" button opens CreateWorkspaceModal
- Workspace state maps to status chip colors

#### KBVaultHome (workspace-aware)
- Consumes `workspace.explorer.getTree` for live stats
- Stat grid: article families (with locale count), active drafts, conflicts, workspace state
- Workspace info card: name, path, created date, enabled locales with badges, DB path
- Recent articles card from tree data (top 5)
- Empty state when no workspace is open

#### ArticleExplorer (fully data-driven)
- Consumes `workspace.explorer.getTree` for tree data
- Dynamic filter counts computed from actual tree (all/live/drafts/conflicted/retired)
- Dynamic locale list from tree data
- Filters work on real `ExplorerNode` data using `RevisionState` enums
- **Search mode**: debounced `workspace.search` call, switches to search results view when query >= 2 chars
- Search results show title, snippet, locale
- **Revision history drawer**: clicking an article opens drawer, calls `workspace.history.get`, shows revision list with number, status, type, date, content hash
- Badges: live, draft count, conflict indicator, locale tags per article
- Loading/error/empty states for tree and search

#### Settings (workspace-aware)
- All sections read from active workspace
- **Zendesk**: shows subdomain from `workspace.settings.get`
- **Locales**: full form with default locale dropdown + enabled locales checklist; save calls `workspace.settings.update` with success/error feedback
- **Workspace**: shows name, path, state from `activeWorkspace`
- **Storage** (new section): shows `workspace.repository.info` — root path, DB path, all storage convention paths
- **About**: shows workspace ID + version
- Empty state when no workspace open

#### App.tsx
- Wraps everything in `WorkspaceProvider`
- Sidebar receives `activeWorkspace?.name` dynamically
- `isConnected` from boot response

## Files added
- `src/renderer/src/hooks/useIpc.ts`
- `src/renderer/src/context/WorkspaceContext.tsx`
- `src/renderer/src/components/Modal.tsx`
- `src/renderer/src/components/Drawer.tsx`
- `src/renderer/src/components/CreateWorkspaceModal.tsx`
- `src/renderer/src/components/index.ts`

## Files modified
- `src/renderer/src/App.tsx` — WorkspaceProvider, dynamic sidebar props
- `src/renderer/src/pages/WorkspaceSwitcher.tsx` — Full rewrite with IPC
- `src/renderer/src/pages/KBVaultHome.tsx` — Full rewrite with IPC
- `src/renderer/src/pages/ArticleExplorer.tsx` — Full rewrite with IPC + search + history drawer
- `src/renderer/src/pages/Settings.tsx` — Full rewrite with IPC + locale settings form + storage view

## IPC methods consumed
| Method | Used in |
|--------|---------|
| `workspace.list` | WorkspaceProvider (auto-load) |
| `workspace.create` | WorkspaceProvider → CreateWorkspaceModal |
| `workspace.open` | WorkspaceProvider → WorkspaceSwitcher |
| `workspace.explorer.getTree` | ArticleExplorer, KBVaultHome |
| `workspace.search` | ArticleExplorer (search mode) |
| `workspace.history.get` | ArticleExplorer (history drawer) |
| `workspace.repository.info` | KBVaultHome, Settings (storage) |
| `workspace.settings.get` | Settings (zendesk, locales) |
| `workspace.settings.update` | Settings (locale save) |

## Interaction patterns added
- Workspace create flow: button → modal → form → submit → auto-open
- Workspace open flow: click card → open → navigate to Home
- Search: type 2+ chars → debounced IPC → results list (replaces tree)
- Revision history: click article → drawer slides in from right → revision timeline
- Locale settings: toggle checkboxes → save with feedback toast
- All pages gracefully handle: no workspace open, loading, error

## Known gaps / deferred
- Workspace delete flow (UI exists in contract but no button yet)
- Zendesk credential save (form exists, save handler not wired — needs Batch 3 zendesk-client)
- Sync button is placeholder (needs Batch 3)
- Search is basic title match only (backend limitation per contract)
- No workspace rename/edit flow yet
- PBIBatches page not updated (deferred to Batch 5 scope)
