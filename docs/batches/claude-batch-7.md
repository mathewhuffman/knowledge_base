# Claude Batch 7 — Proposal Review Experience

## What Was Built

The main proposal review surface — the strongest screen in the app. This is a full three-column review layout with:

### Left Rail: Grouped Queue
- Proposals grouped by article with collapsible group headers
- Queue items show action type badge, article label, confidence %, PBI count, locale
- Decided proposals are visually dimmed
- Active proposal is highlighted
- Summary bar at top shows counts: total, pending, accepted, denied, deferred

### Center Panel: Content Viewer with Carousel Navigation
- Header with proposal title, action badge, review status, and prev/next stepper
- Tab bar with four views:
  - **Preview** — rendered HTML for creates, rendered block diff for edits
  - **Diff** — source-level line diff with gutter line numbers and add/remove coloring
  - **Source** — raw HTML source view
  - **Changes** — change regions ledger showing added/removed/changed blocks with labels
- Carousel-style keyboard navigation (J/K or Up/Down arrows)
- Tab switching via number keys (1-4)

### Right Rail: Evidence & Actions
- Confidence bar with color-coded percentage (green > 80%, yellow 50-80%, red < 50%)
- AI summary card showing rationale and notes
- PBI evidence card listing triggering PBIs with external IDs and titles
- Suggested placement card (category, section, title, notes)
- Optional review note textarea
- Decision buttons:
  - **Accept** (primary) — for all proposal types
  - **Deny** (danger) + **Defer** (secondary) — side by side
  - **Apply to Branch** (ghost) — shown only for edit proposals
  - **Archive** (ghost) — shown only for no-impact proposals
- Keyboard shortcut hints: A=accept, D=deny, S=defer, J=next, K=prev
- Already-decided proposals show decision badge + timestamp instead of action buttons

### States Covered
- Loading queue (spinner)
- Error loading queue (error state + retry)
- Empty queue (no proposals)
- Loading individual proposal detail
- Error loading proposal detail
- All proposals reviewed (celebration card with summary counts)
- Deciding in progress (button loading states)
- Already-decided proposal (read-only display)

## Files Added/Changed

### Added
- (none — all changes are modifications to existing files)

### Changed
- `apps/desktop/src/renderer/src/pages/ProposalReview.tsx` — complete rewrite from placeholder to full IPC-integrated review experience
- `apps/desktop/src/renderer/src/components/icons.tsx` — added IconChevronLeft, IconMinus, IconArchive, IconMapPin, IconMessageSquare
- `apps/desktop/src/renderer/src/styles/components.css` — added ~350 lines of review-specific styles

## IPC Endpoints Consumed

| Endpoint | Usage |
|---|---|
| `pbi.batch.list` | Find the most recent reviewable batch |
| `proposal.review.list` | Load grouped queue + summary counts |
| `proposal.review.get` | Load proposal detail, diff, PBIs, navigation |
| `proposal.review.decide` | Submit accept/deny/defer/apply/archive decisions |

## Interaction Patterns Introduced

- **Carousel/stepper navigation**: prev/next buttons + keyboard (J/K) for moving through proposals without losing context
- **Keyboard-first review flow**: A/D/S for decisions, J/K for navigation, 1-4 for tab switching
- **Auto-advance after decision**: accepts automatically move to the next pending proposal
- **Grouped-by-article queue**: proposals organized by target article for context continuity
- **Tabbed content views**: unified tab bar for switching between preview, diff, source, and change region views

## Accessibility Considerations

- All buttons have visible keyboard hints
- Tab bar items are keyboard accessible
- Navigation buttons have title attributes for tooltip descriptions
- Disabled states have reduced opacity
- Color is not the only indicator — badges use text labels alongside color
- Focus management: keyboard events only fire outside text inputs

## Known Backend Gaps

- No batch picker UI — currently auto-selects the first analyzed/review_in_progress batch. Will need a batch selector dropdown or routing param once multiple batches exist simultaneously.
- Placement override not yet wired — the UI displays suggested placement read-only. Backend contract supports `placementOverride` in the decide request but no edit UI is built yet.
- Branch picker for "Apply to Branch" — button fires `apply_to_branch` decision but doesn't yet present a branch selection UI. Backend contract accepts `branchId` but renderer needs the branch list.

## Intentionally Deferred Polish

- Animated transitions between proposals (carousel slide effect)
- Drag-to-reorder in the queue
- Inline editing within preview
- Collapsible groups in the left rail (groups are always expanded)
- Search/filter within the queue
- Batch selector dropdown
- Side-by-side before/after preview for edits (currently uses inline rendered diff blocks)
