# Design Handoff: Claude Batch 6

## Screens Designed

### Settings > AI Runtime (updated)
- Health status panel with 4 check items in vertical grid
- Warning banner for issues with yellow background
- Session list with type badges, status chips, metadata row
- Session detail with metadata grid, tab bar (Transcript / Tool Calls)
- Transcript viewer: dark terminal-style, direction-coded left borders
- Tool call list: card-per-call, code-formatted tool names, allowed/denied badges

### PBI Batches > Analysis Drawer (new surface)
- "Analyze" button appears on submitted/scoped batch rows in the table
- Opens a wide drawer with batch name in title
- Contains AnalysisJobRunner: start button → progress bar → streaming event log
- Cancel control available during run
- "Run Again" after completion

### Cursor Unavailable Banner (reusable)
- Full-width gradient banner with icon, title, description, numbered steps
- Intended for any surface where Cursor availability blocks functionality

## Components Created

| Component | File | Purpose |
|-----------|------|---------|
| `HealthStatusPanel` | `AgentRuntimePanel.tsx` | Health check display |
| `SessionListPanel` | `AgentRuntimePanel.tsx` | Session browser |
| `SessionDetailPanel` | `AgentRuntimePanel.tsx` | Transcript + tool calls |
| `AnalysisJobRunner` | `AgentRuntimePanel.tsx` | Job execution UI |
| `CursorUnavailableBanner` | `AgentRuntimePanel.tsx` | Degraded mode fallback |

## Interaction Patterns Introduced

- **Drill-down navigation**: Session list → session detail → back to list (no route change, in-page state)
- **Drawer-based job runner**: Keeps batch list visible behind drawer, drawer close refreshes list
- **Streaming event log**: Append-only scroll area with auto-scroll to bottom, badge-per-event-kind
- **Tab switching in detail**: Transcript vs Tool Calls tabs reuse same data scope

## States Covered

- Loading (spinner + message)
- Empty (icon + title + description)
- Error (alert + retry action)
- Success (green badges, check icons)
- Running (animated spinner on refresh, primary-colored progress bar)
- Failed/Canceled (red/yellow progress bar, error banners)
- Denied tool calls (red-bordered card variant)

## Accessibility Considerations

- All session rows are keyboard-navigable (Enter to select)
- Health check results use icon + text (not color alone)
- Transcript direction badges include text labels
- Drawer uses `role="dialog"` and `aria-modal="true"`
- Button icons always paired with text or `aria-label`

## Open Backend Gaps Discovered

- No live transcript tailing — would benefit from polling or push subscription
- Health check could auto-run on workspace load (currently requires manual navigation to Settings > AI Runtime)
- Session creation is implicit (via analysis run) — no explicit "create session" UI needed for batch 6

## Requested Contract Changes

None. All batch 6 Codex contracts consumed as-is.

## Intentionally Deferred Polish

- Transcript search/filter within the terminal view
- Tool call argument expand/collapse toggle
- Session timeline visualization (chronological status changes)
- Health check notification in sidebar footer (currently only visible in Settings)
- Analysis progress indicator in PBI batch table row (currently only in drawer)
