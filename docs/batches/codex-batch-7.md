# Codex Batch 7 Handoff

## What Was Built

- Added a full Batch 7 proposal review contract layer in `packages/shared-types/src/batch7.ts`.
- Added a reusable HTML diff engine in `packages/diff-engine/src/index.ts` for source-line diffs, rendered block diffs, change regions, and gutter metadata.
- Extended proposal persistence with Batch 7 review fields and artifact paths via migration `0008_batch7_proposal_review_model`.
- Upgraded `WorkspaceRepository` to:
  - persist richer proposal metadata from agent/tool ingestion,
  - store proposal HTML artifacts under `proposals/<proposalId>/`,
  - return grouped batch review queues,
  - return full proposal review detail payloads,
  - persist review decisions and keep batch review status in sync.
- Added IPC commands for:
  - `proposal.ingest`
  - `proposal.review.list`
  - `proposal.review.get`
  - `proposal.review.decide`

## Files Added/Changed

- Added: `packages/shared-types/src/batch7.ts`
- Added: `packages/diff-engine/src/index.ts`
- Added: `docs/batches/codex-batch-7.md`
- Added: `docs/claude-handoff/batch-7.md`
- Added: `docs/contracts/batch-7-ipc.md`
- Added: `docs/contracts/batch-7-schema.md`
- Added: `docs/contracts/batch-7-payloads.md`
- Changed: `packages/shared-types/src/index.ts`
- Changed: `packages/db/src/migrations.ts`
- Changed: `packages/diff-engine/package.json`
- Changed: `apps/desktop/package.json`
- Changed: `apps/desktop/src/main/services/workspace-repository.ts`
- Changed: `apps/desktop/src/main/services/command-registry.ts`
- Changed: `apps/desktop/tests/repository-content-model.spec.ts`
- Changed: `apps/desktop/tests/command-registry-content-model.spec.ts`

## DB Schema / Migration Changes

- Added migration `0008_batch7_proposal_review_model`.
- New `proposals` columns:
  - `review_status`
  - `queue_order`
  - `family_id`
  - `source_revision_id`
  - `target_title`
  - `target_locale`
  - `confidence_score`
  - `rationale_summary`
  - `ai_notes`
  - `suggested_placement_json`
  - `source_html_path`
  - `proposed_html_path`
  - `metadata_json`
  - `decision_payload_json`
  - `decided_at`
  - `agent_session_id`
- Existing legacy `status` values are backfilled into the new `review_status` field where possible.

## IPC Endpoints Added/Changed

- Added `proposal.ingest`
- Added `proposal.review.list`
- Added `proposal.review.get`
- Added `proposal.review.decide`
- Existing MCP/CLI proposal ingestion paths now populate the richer review model through the same repository layer.

## Background Jobs Added

- None.
- Batch review status is updated synchronously when proposals are created or reviewed.

## Sample Payloads

- See `docs/contracts/batch-7-payloads.md`

## Renderer Hooks Available For Claude

- `proposal.review.list`
  - Use for the review queue rail and grouped-by-article navigation.
- `proposal.review.get`
  - Use for the main review surface, evidence panel, diff tabs, and stepper/carousel state.
- `proposal.review.decide`
  - Use for accept, deny, defer, apply-to-branch, and archive actions.
- `proposal.ingest`
  - Mostly backend/testing oriented, but useful for fixtures or manual backend validation.

## Exact Places Claude Should Plug UI Into

- Replace the placeholder data in `apps/desktop/src/renderer/src/pages/ProposalReview.tsx`.
- Keep the page shell, but source all queue/detail state from:
  - `proposal.review.list`
  - `proposal.review.get`
  - `proposal.review.decide`
- Render these payload areas explicitly:
  - `queue`
  - `groups`
  - `proposal`
  - `relatedPbis`
  - `diff.sourceDiff.lines`
  - `diff.renderedDiff.blocks`
  - `diff.changeRegions`
  - `diff.gutter`
  - `navigation`

## Known Limitations

- The diff engine is intentionally lightweight for Batch 7. It is good enough for queue/review scaffolding, but not yet a polished semantic HTML diff.
- Proposal ingestion is only as rich as the metadata passed by the agent/tool call. The system supports richer fields now, but current prompts/tools may need follow-up tuning to populate every field consistently.
- Full app `typecheck` still fails because of unrelated pre-existing renderer issues outside the Batch 7 backend slice.

## Verification

- Main-process compile check passed:
  - `pnpm -C apps/desktop exec tsc --pretty false --noEmit --moduleResolution Node --module CommonJS --target ES2022 --strict --esModuleInterop --resolveJsonModule --skipLibCheck src/main/services/command-registry.ts src/main/services/workspace-repository.ts src/main/services/pbi-batch-import-service.ts`
- Focused tests passed:
  - `pnpm -C apps/desktop exec playwright test tests/repository-content-model.spec.ts -g "builds proposal review queue, detail payload, and persists decisions"`
  - `pnpm -C apps/desktop exec playwright test tests/command-registry-content-model.spec.ts -g "supports batch 7 proposal review commands end to end"`
- Environment repair performed to enable tests:
  - `npm rebuild better-sqlite3 --update-binary`
