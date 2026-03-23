# Claude Handoff: Batch 7

Batch 7 backend review contracts are ready. Claude should now replace the placeholder Proposal Review page with the real one-at-a-time review flow.

## What Backend Is Ready

- Grouped review queue per batch
- Proposal detail payload with:
  - proposal metadata
  - related PBIs
  - navigation info
  - source diff
  - rendered diff
  - change regions
  - gutter markers
- Persistent review decisions
- Batch review status auto-sync between:
  - `analyzed`
  - `review_in_progress`
  - `review_complete`

## IPC To Use

- `proposal.review.list`
- `proposal.review.get`
- `proposal.review.decide`

## Expected Renderer Mapping

- Left rail:
  - `queue`
  - `groups`
- Main review panel:
  - `proposal.targetTitle`
  - `proposal.action`
  - `proposal.confidenceScore`
  - `proposal.rationaleSummary`
  - `proposal.aiNotes`
  - `proposal.suggestedPlacement`
  - `diff`
- Evidence panel:
  - `relatedPbis`
- Navigation / stepper:
  - `navigation.currentIndex`
  - `navigation.total`
  - `navigation.previousProposalId`
  - `navigation.nextProposalId`

## Action Contracts

- Accept: `decision = "accept"`
- Deny: `decision = "deny"`
- Defer: `decision = "defer"`
- Apply existing draft branch: `decision = "apply_to_branch"` with `branchId`
- Archive/no longer actionable: `decision = "archive"`

## Known Gaps / Limitations

- Diff payloads are structurally complete but visually unstyled.
- Placement is JSON-backed and may be partially populated depending on agent metadata quality.
- No frontend branch picker contract was added in Batch 7; use the decision contract now and wire richer branch selection in Batch 8 when draft systems mature.
