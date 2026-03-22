# Claude Batch 5 — Design Handoff

## Screens designed

### PBI Batches — Batch List
Live batch list wired to `pbiBatch.list`. Shows batch name, source file, import date, row/candidate/scoped counts, and status badge. Replaces the old hardcoded mock data.

### PBI Batches — Import Wizard (4-step modal)
Full-screen modal overlay with step indicator and progressive disclosure.

## Components created

### Wizard system
- **Wizard overlay** — `.wizard-overlay`, `.wizard-panel` (720px max-width modal with slide-up animation)
- **Step indicator** — `.wizard-step-indicator` with `.wizard-step-dot` (active=blue, completed=green)
- **Wizard header/body/footer** — standard header with close button, scrollable body, footer with Back/Cancel/Continue actions

### Upload step
- **Upload drop zone** — `.upload-zone` with dashed border, hover state (primary blue), drag-over state
- Accepts CSV and HTML files via drag-and-drop or file picker
- Error banner if import fails

### Parse summary step (Review)
- **Parse summary grid** — `.parse-summary-grid` (6-card grid) with color-coded values:
  - Total rows (neutral)
  - Candidates (green)
  - Scoped (green)
  - Duplicates (warning when > 0)
  - Malformed (danger when > 0)
  - Ignored (warning when > 0)
- **Row review tables** — `.row-review-section` with heading badge, table showing Row #, External ID (mono), Title, Reason (italic)
- Tables for: Duplicate Rows, Malformed Rows, Ignored Rows — only shown when count > 0

### Scope step
- **Scope mode picker** — `.scope-mode-group` with radio-style cards (`.scope-mode-option`) for:
  - All candidates
  - All except selected
  - Selected only
- Active state with blue border + filled radio dot
- **Row selector** — scrollable checkbox list of candidate rows (visible when mode is not "all")
- **Scope feedback** — `.scope-feedback` blue info banner showing scoped count
- Two-step flow: "Apply Scope" saves to backend, then "Continue to Preflight" unlocks

### Preflight step (Confirm)
- **Warning banner** — `.preflight-warning-banner` (orange dashed) showing excluded row counts
- **Preflight checklist** — `.preflight-checklist` with green/orange check/alert icons:
  - Batch name + source file confirmed
  - Candidate count confirmed
  - Scoped count confirmed (warning if 0)
- **Scoped items preview** — first 10 candidate titles with "and N more..." overflow
- **Submit for Analysis** — primary button, disabled if scoped count is 0

### Batch status badges
- `.batch-status--*` variants for all 7 statuses: imported, scoped, submitted, analyzed, review_in_progress, review_complete, archived

## IPC methods consumed
- `pbiBatch.list` — batch list on page mount
- `pbiBatch.import` — file upload with inline content
- `pbiBatch.scope.set` — scope mode + selected rows
- `pbiBatch.getPreflight` — preflight data before confirmation
- `pbiBatch.setStatus` — transition to `submitted` on final confirm

## Interaction patterns

1. **Progressive wizard** — user must complete each step before advancing; Back button allows revisiting
2. **Scope-then-confirm** — scope must be applied (saved) before preflight can load; prevents accidental submission
3. **Non-blocking warnings** — duplicate/malformed/ignored rows are surfaced but don't block the flow
4. **Drop zone** — file can be dropped or clicked to browse; accepts .csv, .html, .htm
5. **Auto-refresh** — batch list refreshes after wizard closes (import or cancel)
6. **Wizard close on submit** — successful submission closes wizard and refreshes list

## States covered

- No workspace: empty state
- Loading batches: spinner
- Error loading batches: error state with retry
- Empty batch list: empty state with import CTA
- Populated batch list: table with all columns
- Wizard upload: drop zone + error banner
- Wizard importing: spinner
- Wizard summary: parse grid + row review tables
- Wizard scope: mode picker + row checkboxes + scope feedback
- Wizard scope saving: disabled Apply button
- Wizard preflight loading: spinner
- Wizard preflight error: error state
- Wizard preflight ready: checklist + preview + submit button
- Wizard submitting: disabled submit button

## Accessibility

- Upload zone is keyboard-accessible (Enter/Space to trigger file picker)
- Scope mode options use `role="radio"` with `aria-checked`
- Step dots use color differentiation (not just color — active/completed text label also changes)
- Modal closes on backdrop click or close button

## Known backend gaps surfaced in UI copy

- No automatic progress events during import (handled with simple spinner)
- No tree/folder scoping — scoping is by source row numbers only
- No field mapping step in wizard (auto-mapping is handled by backend; deferred to future batch if user needs override)

## Intentionally deferred

- Field mapping override step — backend handles auto-mapping with alias buckets; UI override deferred
- Batch detail view (click on row in list to see full detail) — deferred to batch 6+
- Batch archive/delete actions — deferred
- Row-level detail drawer within wizard — deferred
