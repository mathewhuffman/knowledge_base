# Design Handoff: Claude Batch 3

## Screens designed

### Settings > Zendesk Connection
Four-card vertical layout within the existing Settings page left-nav section:

1. **Credentials card** — header with StatusChip showing configured/not-configured state, email input, password-masked API token input with adaptive placeholder, save button with inline success/error feedback, OS keychain hint text

2. **Connection Test card** — header with Badge showing connected/failed, test button with inline spinner, success panel (green bg + check icon + HTTP status + timestamp) or failure panel (red bg + alert icon + error message)

3. **Sync card** — header with latest sync state Badge, inline controls (mode select + run button + cancel button), animated progress bar with state-colored fill, stat-grid summary panel (6 stats in 3-column grid), relative timestamps, cursor summary, remote error banner

4. **Content Browser card** — header with locale dropdown, tab bar (Browse / Search), browse tab has two-column category→section drill-down, search tab has debounced input with result list

### Article Explorer — Sync freshness
- Top banner showing workspace sync freshness with color coding
- Per-article freshness badge on each row

## Components created
- `ZendeskCredentialSection` — self-contained credential management
- `ZendeskConnectionTestSection` — connection test with visual state machine
- `ZendeskSyncSection` — sync controls + progress + summary
- `ZendeskTaxonomyBrowser` — category/section browser + article search
- `SyncStat` — tiny stat display helper

## Interaction decisions
- Credentials and connection test are separate cards because they have distinct lifecycles
- Sync controls are grouped with sync results in one card for context
- Taxonomy browser uses tabs (Browse / Search) rather than a modal to keep the user in context
- Freshness is shown as relative time ("3h ago") rather than absolute timestamps for glanceability
- Progress bar color changes on terminal states (green for success, red for failure)

## States covered
| Component | States |
|---|---|
| Credentials | no-credentials, has-credentials, saving, save-success, save-error |
| Connection test | idle, testing, success, failed |
| Sync | idle, queued, running, succeeded, failed, canceled |
| Taxonomy categories | loading, empty, error, populated |
| Taxonomy sections | not-selected, loading, empty, error, populated |
| Article search | empty-input, loading, no-results, results |
| Explorer sync banner | fresh, stale, failed |
| Article freshness badge | fresh, stale, unknown |

## Accessibility considerations
- All interactive elements are standard buttons/inputs with proper disabled states
- StatusChip uses both color dot and text label for color-blind accessibility
- Error states use both red color and icon for redundant signaling
- Form labels are associated with their inputs via DOM structure
- Cancel button only appears when sync is active (no dead controls)

## Open backend gaps
- ExplorerNode revision may not include `updatedAtUtc` — verify with Codex
- Taxonomy browser queries Zendesk live, not local DB — may be slow/offline-incompatible

## Requested contract changes
None — all existing batch-3 IPC contracts are consumed as documented.

## Intentionally deferred polish
- Sync history timeline (multi-run view)
- Locale-specific sync trigger from UI
- Keyboard shortcuts for quick test/sync
- Token visibility toggle on API token field
- Retry button on failed sync inline
