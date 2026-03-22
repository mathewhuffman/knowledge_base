# Claude Batch 6 — LLM Runtime UX

## Summary

Built the full AI runtime user experience for KB Vault, making the Cursor ACP + MCP integration layer visible, manageable, and trustworthy in the UI.

## Components Created

### `AgentRuntimePanel.tsx`
New component file containing five exported components:

1. **`HealthStatusPanel`** — Displays agent health check results from `agent.health.check`. Shows status of: Cursor CLI installed, ACP reachable, MCP running, required config present. Issues are surfaced in a warning banner. Includes refresh button with spin animation.

2. **`SessionListPanel`** — Lists all ACP sessions for the active workspace via `agent.session.list`. Supports toggling closed sessions. Each row shows session type (batch analysis / article edit), status chip, session ID, batch reference, creation timestamp. Click navigates to session detail. Close button available for active sessions.

3. **`SessionDetailPanel`** — Full session inspector with two tabs:
   - **Transcript tab** — Terminal-style log showing `to_agent`, `from_agent`, and `system` transcript lines with JSON-formatted payloads, auto-scrolling to latest.
   - **Tool Calls tab** — Shows all MCP tool calls made during the session with tool name, allowed/denied badge, timestamp, reason, and arguments.

4. **`AnalysisJobRunner`** — Inline job runner for `agent.analysis.run`. Start/cancel controls, progress bar with state-aware coloring, streaming event log showing parsed `AgentStreamingPayload` events with kind badges.

5. **`CursorUnavailableBanner`** — Fallback banner shown when Cursor is not detected. Guides user through installation steps.

## View States Covered

- Health check: loading, success (all green), partial failure (issues list), full failure
- Session list: loading, empty, populated, with/without closed sessions
- Session detail: transcript loading/empty/populated, tool calls loading/empty/populated
- Analysis job: idle, queued, running, succeeded, failed, canceled
- Streaming events: session_started, progress, tool_call, tool_response, result, warning, error, timeout, canceled
- Cursor unavailable: degraded mode banner

## Icons Added

Added 8 new SVG icons to `icons.tsx`:
- `IconActivity` (health pulse)
- `IconTerminal` (transcript)
- `IconPlay` (start job)
- `IconSquare` (stop job)
- `IconWifi` / `IconWifiOff` (connectivity)
- `IconXCircle` (failure indicator)
- `IconTool` (tool calls)

## Integration Points

### Settings > AI Runtime
Replaced the placeholder "Not configured" section with:
- Live `HealthStatusPanel` with workspace-aware health check
- `SessionListPanel` / `SessionDetailPanel` for session management
- Session state tracked via `selectedSession` state

### PBI Batches
- Added "Analyze" button on submitted/scoped batch rows
- Added `Drawer` (wide variant) containing `AnalysisJobRunner`
- Job completion triggers batch list refresh
- Drawer close also triggers list refresh

## Interaction Patterns

- **Health check**: Click refresh to re-probe. Results show inline immediately.
- **Session browsing**: Click session row to drill into transcript/tools. Back button returns to list.
- **Analysis**: Click "Analyze" on batch row → drawer opens → click "Run Analysis" → progress bar + event stream → completion badge. Can cancel mid-run. "Run Again" available after completion.
- **Transcript viewing**: Auto-scrolls. Color-coded by direction. JSON payloads are pretty-printed.
- **Tool call inspection**: Shows allowed/denied state prominently. Args are collapsible JSON.

## Accessibility Considerations

- All interactive elements have `role`, `tabIndex`, `aria-label` or `aria-current` attributes
- Keyboard navigation: session rows respond to Enter key
- Health check items use semantic color (green for OK, red for fail) plus text labels
- Transcript uses high-contrast dark background for readability
- Badges always include text alongside color for colorblind accessibility

## CSS Added

~350 lines of new styles in `components.css` under "Agent Runtime — Batch 6 Styles":
- Health check grid and items
- Session list rows with hover states
- Session detail metadata grid
- Terminal-style transcript viewer (dark bg, direction-coded borders)
- Tool call cards with denied state
- Job runner controls, progress bar integration, event log
- Cursor unavailable banner with gradient background
- Spin animation for loading states
- `.btn-xs` variant for compact action buttons

## Known Backend Gaps

- Transcript retrieval is per-request (no live tailing/WebSocket yet) — user must manually navigate to transcript tab
- `listCategories` and `listSections` MCP calls may fail if Zendesk credentials are invalid — should show recoverable notice
- Job event subscription uses `window.kbv.emitJobEvents` which may miss events if the handler registers after emission starts

## Open Items for Future Batches

- Live transcript streaming (batch 7+ could add polling or WebSocket)
- Session creation UI (currently sessions auto-create on analysis run)
- Article-level AI editing session launcher (will be part of batch 9 article chat sidebar)
- Health check auto-run on app boot or workspace switch (could add to AppShell)
