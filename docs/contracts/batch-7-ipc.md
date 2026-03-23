# Batch 7 IPC Contract (Codex)

## New IPC methods added in Codex batch 7

### `proposal.ingest`

Stores a structured proposal in the Batch 7 review model.

Request:

- `workspaceId: string`
- `batchId: string`
- `action: "create" | "edit" | "retire" | "no_impact"`
- Optional rich fields:
  - `sessionId`
  - `localeVariantId`
  - `familyId`
  - `sourceRevisionId`
  - `targetTitle`
  - `targetLocale`
  - `confidenceScore`
  - `rationaleSummary`
  - `aiNotes`
  - `suggestedPlacement`
  - `sourceHtml`
  - `proposedHtml`
  - `relatedPbiIds`
  - `metadata`

Response:

- `ProposalReviewRecord`

### `proposal.review.list`

Returns the grouped queue for one batch.

Request:

- `workspaceId: string`
- `batchId: string`

Response:

- `ProposalReviewListResponse`

### `proposal.review.get`

Returns the full review payload for one proposal.

Request:

- `workspaceId: string`
- `proposalId: string`

Response:

- `ProposalReviewDetailResponse`

### `proposal.review.decide`

Persists a review action and returns updated summary state.

Request:

- `workspaceId: string`
- `proposalId: string`
- `decision: "accept" | "deny" | "defer" | "apply_to_branch" | "archive"`
- Optional:
  - `branchId`
  - `note`
  - `placementOverride`

Response:

- `ProposalReviewDecisionResponse`
  - always includes:
    - `workspaceId`
    - `batchId`
    - `proposalId`
    - `reviewStatus`
    - `batchStatus`
    - `summary`
  - may also include decision side-effect fields:
    - `branchId`
    - `revisionId`
    - `familyId`
    - `localeVariantId`
    - `retiredAtUtc`

## Error behavior

- Missing required identifiers => `INVALID_REQUEST`
- Unknown workspace / batch / proposal => `NOT_FOUND`
- Repository or persistence failures => `INTERNAL_ERROR`
