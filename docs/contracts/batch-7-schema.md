# Batch 7 Schema (Domain model)

## Migration added

- `0008_batch7_proposal_review_model`

## Proposals table additions

- `review_status TEXT NOT NULL DEFAULT 'pending_review'`
- `queue_order INTEGER NOT NULL DEFAULT 0`
- `family_id TEXT`
- `source_revision_id TEXT`
- `target_title TEXT`
- `target_locale TEXT`
- `confidence_score REAL`
- `rationale_summary TEXT`
- `ai_notes TEXT`
- `suggested_placement_json TEXT`
- `source_html_path TEXT`
- `proposed_html_path TEXT`
- `metadata_json TEXT`
- `decision_payload_json TEXT`
- `decided_at TEXT`
- `agent_session_id TEXT`

## Filesystem additions

Per-proposal artifacts now live under:

- `proposals/<proposalId>/source.html`
- `proposals/<proposalId>/proposed.html`
- `proposals/<proposalId>/metadata.json`

Paths stored in DB are workspace-relative.

## Domain behavior introduced in batch 7

- Proposal queue ordering is stable per batch via `queue_order`.
- Batch review status is derived from proposal review state:
  - no proposals => keep `analyzed`
  - at least one `pending_review` => `review_in_progress`
  - no remaining `pending_review` => `review_complete`
- Review decisions can now mutate workspace state inline:
  - `accept` on `create` / `edit` creates a new draft branch and draft revision
  - `apply_to_branch` appends a draft revision to an existing branch
  - `accept` on `retire` marks the target retired and obsoletes related draft branches
  - `accept` on `no_impact` archives the proposal
- Legacy proposal `status` is still written for compatibility, but `review_status` is now the canonical review-state field.
