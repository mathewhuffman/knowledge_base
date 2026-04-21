# Design Handoff — Batch 7

## Screens Designed

### Proposal Review (3-column layout)
The primary review experience, built as the strongest surface in the app per spec.

**Layout:** 260px left rail | flex center | 300px right rail

## Components Created

| Component | Location | Purpose |
|---|---|---|
| `SummaryBar` | ProposalReview.tsx (internal) | Queue header showing total/pending/accepted/denied/deferred counts |
| `QueueItem` | ProposalReview.tsx (internal) | Individual proposal in left rail with type badge, status, meta |
| `PreviewPanel` | ProposalReview.tsx (internal) | Renders sanitized HTML for new article proposals |
| `SourceDiffPanel` | ProposalReview.tsx (internal) | Source-level line diff with gutter and add/remove coloring |
| `RenderedDiffPanel` | ProposalReview.tsx (internal) | Rendered block diff with border-left indicators |
| `SourcePanel` | ProposalReview.tsx (internal) | Raw HTML source display |
| `ChangeRegionsPanel` | ProposalReview.tsx (internal) | Change ledger showing labeled add/remove/changed regions |
| `ConfidenceCard` | ProposalReview.tsx (internal) | Progress bar + color-coded percentage |
| `AISummaryCard` | ProposalReview.tsx (internal) | Rationale summary + AI notes |
| `PBIEvidenceCard` | ProposalReview.tsx (internal) | List of triggering PBIs with IDs and titles |
| `PlacementCard` | ProposalReview.tsx (internal) | Suggested article placement metadata |

### Icons Added
- `IconChevronLeft` — carousel navigation
- `IconMinus` — available for future inline diff markers
- `IconArchive` — archive action button
- `IconMapPin` — placement section header
- `IconMessageSquare` — review note section header

## Interaction Patterns Introduced

1. **Carousel review flow** — stepper/slider feel for moving through proposals one at a time
2. **Keyboard-driven decisions** — A/D/S keys for accept/deny/defer without mouse
3. **Grouped queue** — proposals grouped by article for context continuity
4. **Tab-switched content** — preview/diff/source/regions via tab bar or number keys
5. **Auto-advance** — after making a decision, focus moves to the next pending proposal

## Accessibility Considerations

- Keyboard shortcuts shown inline as `<kbd>` elements
- Button disabled states with opacity reduction
- Title attributes on nav buttons
- Text labels always accompany color badges
- Keyboard handler ignores events when focus is on text inputs
- Semantic heading structure in right rail cards

## States Covered

| State | Treatment |
|---|---|
| Queue loading | Centered spinner |
| Queue error | ErrorState with retry button |
| Empty queue | EmptyState with guidance message |
| Proposal loading | Spinner in center panel |
| Proposal error | ErrorState in center panel |
| No proposal selected | EmptyState prompt to select |
| Pending review | Full action buttons + keyboard hints |
| Already decided | Read-only badge + timestamp |
| All reviewed | Celebration card with summary breakdown |
| Decision in progress | Button loading text |

## Known Backend Gaps

- Batch selection: auto-selects first reviewable batch, needs batch picker
- Branch picker for apply_to_branch action
- Placement override editing UI

## Requested Contract Changes

None — all Codex Batch 7 contracts consumed as-is.

## Intentionally Deferred Polish

- Carousel slide animations
- Collapsible article groups in queue
- Queue search/filter
- Side-by-side before/after preview for edit proposals
- Inline content editing
- Drag reorder for review priority
