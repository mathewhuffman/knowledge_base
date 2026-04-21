# Chat + Batch Analysis System Breakdown

## Purpose

This document explains the two AI systems currently living inside KB Vault:

1. The interactive chat assistant system
2. The batch analysis orchestration system

It also explains how they relate to the product goals in [project_breakdown.md](./project_breakdown.md), where they are currently separated, where they still overlap, what is broken or risky, and what improvements should come next.

---

## Product Alignment

Based on [project_breakdown.md](./project_breakdown.md), KB Vault is meant to be a local-first workflow engine that turns bulk PBI change input into reviewed KB actions, while also supporting targeted human-guided refinement work.

That maps cleanly to two distinct AI interaction models:

- Chat assistant: short-lived or ongoing user-directed help, refinement, and page-aware editing
- Batch analysis: a structured multi-stage pipeline that turns one imported batch into reviewable proposal work

These systems should share infrastructure, but they should not share control flow.

That separation is now mostly true:

- Chat is session-centric and page-context-centric
- Batch analysis is iteration-centric and pipeline-centric

The refactor moved the architecture in the right direction, but the batch system still depends heavily on prompt quality and weak deterministic safeguards, which is why it can under-scope edits even when the product intent is clearly broader.

---

## System Inventory

### Primary chat files

- `apps/desktop/src/main/services/ai-assistant-service.ts`
- `apps/desktop/src/main/services/command-registry.ts`
- `packages/shared-types/src/ai-assistant.ts`
- `apps/desktop/src/renderer/src/components/assistant/AssistantContext.tsx`
- `apps/desktop/src/renderer/src/components/assistant/GlobalAssistantHost.tsx`
- `apps/desktop/src/renderer/src/components/assistant/AssistantTranscript.tsx`
- `apps/desktop/src/renderer/src/components/assistant/AssistantComposer.tsx`

### Primary batch files

- `apps/desktop/src/main/services/command-registry.ts`
- `apps/desktop/src/main/services/batch-analysis-orchestrator.ts`
- `apps/desktop/src/main/services/workspace-repository.ts`
- `packages/shared-types/src/batch6.ts`
- `apps/desktop/src/renderer/src/components/AgentRuntimePanel.tsx`
- `apps/desktop/src/renderer/src/components/batch-analysis/*`

---

## High-Level Difference

### Chat system

The chat system is a user-driven conversational runtime.

It exists to:

- answer questions
- research current KB content
- create proposal candidates
- patch proposals
- patch drafts
- patch templates
- reflect live route context and unsaved working state

It is fundamentally:

- session based
- route aware
- artifact based
- optimistic and interactive

### Batch analysis system

The batch system is a structured job pipeline.

It exists to:

- inspect an imported PBI batch
- synthesize an actionable plan
- review the plan
- execute approved work
- discover missed scope
- amend the plan
- run a final review
- persist all artifacts for inspection

It is fundamentally:

- job based
- iteration based
- multi-stage
- artifact audited
- proposal-output oriented

---

## Chat System Breakdown

## 1. Chat architecture

The chat system is split into three layers.

### Renderer layer

`AssistantContext.tsx` is the state coordinator for the entire assistant UI.

It owns:

- whether the panel is open
- current route registration
- active session
- session list/history
- current messages
- current pending artifact
- current in-flight streamed turn
- loading/sending/error state

`GlobalAssistantHost.tsx` renders the floating panel, session history, transcript, artifact card, and composer.

`AssistantTranscript.tsx` renders saved assistant messages plus streamed pending content. It also exposes “Thoughts” blocks from audit metadata, which means the chat UI is now designed around structured assistant output rather than plain text only.

`AssistantComposer.tsx` is intentionally route-aware. It changes placeholders and quick actions by route, which is a good sign that the assistant is now a contextual product capability rather than a generic chat box.

### Main-process service layer

`AiAssistantService` is the actual chat engine.

It owns:

- assistant session CRUD
- assistant message persistence
- assistant artifact persistence
- runtime prompt construction
- runtime continuation logic
- transcript fallback logic
- artifact promotion / application
- working-state side effects

This is the real heart of the chat system.

### IPC / command layer

`command-registry.ts` exposes the assistant over commands like:

- `ai.assistant.session.list`
- `ai.assistant.session.get`
- `ai.assistant.session.create`
- `ai.assistant.message.send`
- `ai.assistant.artifact.apply`
- `ai.assistant.artifact.reject`

That keeps the renderer thin and keeps business logic inside the main process.

## 2. Chat data model

The chat system uses its own persisted model:

- `ai_sessions`
- `ai_messages`
- `ai_artifacts`

Core shared types are in `packages/shared-types/src/ai-assistant.ts`.

Important concepts:

- `AiViewContext`: page/route/subject/working-state/capabilities snapshot
- `AiSessionRecord`: long-lived chat session metadata
- `AiMessageRecord`: persisted user/assistant messages
- `AiArtifactRecord`: structured result of a turn

This is an important architectural choice: the assistant does not assume every turn is “just text.” A turn can produce:

- `informational_response`
- `proposal_candidate`
- `proposal_patch`
- `draft_patch`
- `template_patch`
- `clarification_request`

That makes chat much more aligned with the actual product.

## 3. Chat turn lifecycle

The `sendMessage` flow in `AiAssistantService` works like this:

1. Ensure or create a session.
2. Persist the user message immediately.
3. Mark the session as running.
4. Resolve route context and runtime mode.
5. Build a route-aware JSON-contract prompt.
6. Run `agentRuntime.runAssistantChat(...)`.
7. Stream UI events back to the renderer.
8. Wait for transcript quiescence.
9. Inspect transcript/tool activity.
10. Optionally issue a continuation turn if the model is still researching.
11. Parse the final runtime envelope.
12. Persist an artifact.
13. Auto-apply safe artifact types when allowed.
14. Persist the final assistant message.
15. Update session state and emit `turn_finished`.

This is a solid design. The chat system now treats runtime output as structured application data, not just chat text.

## 4. Chat strengths

- Clear separation between renderer state and main-process execution
- Strong use of structured artifacts instead of brittle freeform parsing alone
- Route-aware capability model
- Working-state integration for proposal/template/draft editing
- Continuation logic for research-heavy turns
- Streaming event model with audit metadata
- Separate assistant session history independent of batch analysis

## 5. Chat weaknesses / risks

- `AiAssistantService` is very large and mixes persistence, prompt design, runtime control, parsing, and application side effects
- Artifact application rules are partly centralized and partly implied by route capability flags
- Route context is powerful but also easy to drift if page registrations are incomplete
- Prompt contract is doing a lot of enforcement that would be safer in narrower validators
- Auto-apply behavior is useful, but it raises the cost of any parser mistake

---

## Batch Analysis System Breakdown

## 1. Batch architecture

The batch system is split across three main layers.

### Command / orchestration runner

`command-registry.ts` owns the actual end-to-end job runner for `agent.analysis.run`.

This is the pipeline conductor. It:

- starts the job
- loads batch context and PBI subset
- builds deterministic prefetch
- starts an iteration
- runs planner
- runs plan reviewer
- loops revisions when needed
- runs worker
- records worker discoveries
- runs amendment planning/review loops
- runs final review
- finalizes iteration state

### Batch orchestration domain helper

`batch-analysis-orchestrator.ts` is the domain utility for:

- creating prompts
- parsing planner/reviewer/worker/final-review JSON
- recording plans/reviews/amendments/final reviews
- matching executed plan items to proposals
- validating approval gates
- completing iterations

This file is the semantic brain of the batch pipeline, but not the runtime conductor.

### Persistence / inspection layer

`workspace-repository.ts` persists and reconstructs all batch artifacts:

- iterations
- plans
- plan items
- reviews
- worker reports
- discovered work
- amendments
- final reviews
- stage events
- persisted runs

It also provides derived inspection views and runtime snapshots used by the renderer.

## 2. Batch artifact model

The batch system is much richer than the old single-run model.

Its important persisted objects are:

- `BatchAnalysisIterationRecord`
- `BatchAnalysisPlan`
- `BatchPlanReview`
- `BatchWorkerExecutionReport`
- `BatchDiscoveredWorkItem`
- `BatchPlanAmendment`
- `BatchFinalReview`
- `BatchAnalysisStageEventRecord`

This is good architecture. It means the batch system is inspectable and debuggable even after the job ends.

## 3. Batch stage model

The current pipeline stages are:

- `planning`
- `plan_reviewing`
- `plan_revision`
- `building`
- `worker_discovery_review`
- `final_reviewing`
- `reworking`
- terminal: `approved`, `needs_human_review`, `failed`, `canceled`

The renderer uses:

- `AgentRuntimePanel.tsx`
- `BatchAnalysisInspector.tsx`
- `StagePipeline.tsx`
- timeline/review/plan/final-review components

The UI is mostly a read model over persisted orchestration state.

## 4. Batch execution flow

Current happy path:

1. Start iteration at `planning`.
2. Build deterministic planner prefetch.
3. Ask planner for a structured plan.
4. Persist draft plan.
5. Ask reviewer to validate completeness and correctness.
6. If approved, persist approved plan and move to `building`.
7. Worker executes approved plan and creates proposal records.
8. If worker finds new scope, persist discovered work and run amendment loop.
9. Run final review.
10. If approved and hard gates pass, complete iteration as `approved`.

This is much closer to the target product than a single monolithic “analyze once” call.

## 5. What the batch system gets right

- It now has explicit stages instead of implicit hidden runtime steps
- It persists intermediate artifacts instead of only final proposals
- It separates planner, reviewer, worker, and final-reviewer roles
- It has amendment loops for discovered scope
- It has hard approval gates after final review
- It supports both live runtime status and persisted inspection history

## 6. What is still weak

The batch system is structurally better than before, but it still relies too much on prompt obedience in places where correctness matters.

The biggest weak points are:

- reviewer quality depends heavily on prompt context
- deterministic evidence is still advisory more than authoritative
- planner/reviewer agreement is mostly LLM-to-LLM, not rule-backed
- execution success is inferred partly from proposal queue matching by action/title
- command-registry owns too much orchestration detail directly

---

## Chat vs Batch: Current Separation

The refactor has mostly “unmarried” chat from batch analysis, but the two still share some infrastructure.

## What is now properly separated

- Chat uses `AiAssistantService`
- Batch uses `agent.analysis.run` orchestration in `command-registry.ts`
- Chat persists to assistant tables
- Batch persists to orchestration tables
- Chat is route-capability based
- Batch is batch/iteration based

## What they still share

- the underlying agent runtime
- workspace repository access
- proposal creation/update mechanics
- transcript and tool-call concepts
- some command-registry registration infrastructure

## Why this matters

This is the correct product shape:

- chat should be conversational and opportunistic
- batch should be deterministic, inspectable, and stage-governed

If they drift back together too much, batch analysis becomes too soft and chat becomes too constrained.

---

## Current Batch Failure Mode

## Observed issue

The batch system produced only one create proposal when it should also have produced several edit proposals.

## Root cause

The planner already had access to deterministic prefetch evidence:

- article search matches
- relation matches
- prior analysis context

But the reviewer prompt did not receive that same prefetch.

That meant:

- the planner could under-scope the batch
- the reviewer could approve that under-scoped plan without seeing the strongest existing-article evidence
- the worker would then faithfully execute an incomplete approved plan

So the pipeline was behaving consistently, but against an incomplete plan.

## Fix implemented in this pass

Two changes were made.

### 1. Reviewer now receives deterministic prefetch

`buildPlanReviewerPrompt(...)` now includes the same deterministic planner prefetch data so the reviewer can explicitly challenge create-only or create-heavy plans when strong existing article matches imply edits.

### 2. Deterministic review guard now blocks obvious under-scoping

A deterministic guard was added in `BatchAnalysisOrchestrator` to force `needs_revision` when:

- the plan is create-only or under-edited
- deterministic prefetch shows strong existing article signals
- those likely edit targets are not already represented by non-create plan items

This gives the batch system a non-LLM backstop for the exact class of bug you described.

## Verification

Added targeted tests in:

- `apps/desktop/tests/batch-analysis-orchestrator.spec.ts`

Covered cases:

- create-only plan with strong existing matches is forced into revision
- plan with matching edit already included is not blocked
- reviewer prompt now includes deterministic prefetch evidence

Main-process typecheck passed. Full package typecheck still fails in an unrelated renderer file:

- `apps/desktop/src/renderer/src/components/article/ArticleSurface.tsx`

---

## Comprehensive Improvements List

Below is the improvement list, grouped by urgency.

## Critical

- Move batch orchestration out of `command-registry.ts` into a dedicated runtime service. The current orchestration block is too large and too stateful for a registry file.
- Add deterministic coverage checks beyond “missing edits when create-only.” The system should validate create vs edit vs retire balance against article matches and relation signals before approval.
- Add stronger plan-to-worker target identity matching. Title normalization alone is fragile for proposal execution reconciliation.
- Persist explicit reviewer inputs used for each review pass, including deterministic prefetch hashes, so approval decisions are reproducible.
- Add integration tests where real workspace articles exist and prefetch/search results are non-empty. Current targeted unit tests prove guard behavior, but not end-to-end real-data coverage.

## High

- Give the reviewer a structured “existing candidate targets” section instead of raw prefetch dumps. Today the prompt still makes the model interpret too much.
- Add a deterministic “suspicious create” signal when a create item overlaps a known article family or title neighborhood.
- Add plan quality scoring in the orchestration model so under-scoped plans are visible even before worker execution.
- Split `AiAssistantService` into smaller modules: session store, prompt builder, runtime controller, artifact applier, parser.
- Add route-level schema validators for assistant artifact payloads instead of relying mostly on prompt contract correctness.
- Add richer batch telemetry around why a plan was approved, revised, or forced by deterministic safeguards.
- Add a stable planner/reviewer fixture suite with realistic multi-PBI edit-heavy batches.

## Medium

- Introduce explicit batch-analysis policy objects so thresholds like “strong article match” are configurable and testable.
- Promote planner prefetch from anonymous `unknown` structures into shared typed models.
- Add cluster-to-plan-item traceability so every prefetch cluster can be shown as covered, no-impact, or unresolved in the UI.
- Make batch review UI highlight “deterministically flagged missing edits” differently from pure LLM review feedback.
- Add a dedicated repair/diagnostics panel for malformed planner/reviewer outputs.
- Reduce repetition between prompt compactors and prefetch parsers by centralizing batch prompt serialization.
- Add more direct transcript links from batch artifacts into the runtime panel.

## Lower priority but worthwhile

- Add assistant session archiving and lightweight summarization for long chat histories.
- Add assistant route analytics so you can see which contexts produce proposal candidates vs informational answers most often.
- Let batch analysis surface reusable article-target candidates back into chat as contextual suggestions.
- Add comparative diff views between draft plan, approved plan, amended plan, and final worker output.

---

## Recommended Next Steps

If the goal is to stabilize batch analysis fast, the next best sequence is:

1. Keep the deterministic review guard that was added here.
2. Add end-to-end tests with real article search matches and expected edit-heavy plan output.
3. Move orchestration logic into a dedicated service class.
4. Type the planner prefetch model end to end.
5. Add more deterministic review gates around suspicious create-vs-edit decisions.

If the goal is to improve chat next, the next best sequence is:

1. Break up `AiAssistantService`.
2. Add stricter artifact validators.
3. Strengthen route registration guarantees around working state and subject identity.

---

## Detailed Implementation Plan For The 5 Major Updates

This section expands the improvement list into a concrete execution plan.

## 1. Move Batch Orchestration Out Of `command-registry.ts`

### Goal

Move the full `agent.analysis.run` orchestration flow out of [command-registry.ts](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/main/services/command-registry.ts) into a dedicated runtime service.

### Why this change matters

Right now the registry file is doing too much:

- command registration
- dependency wiring
- batch runtime control
- recovery behavior
- stage transitions
- loop control
- logging and job emissions

That makes the batch system harder to debug, harder to test, and easier to break during unrelated command work.

### Benefits

- Clearer ownership for batch runtime logic
- Easier debugging when a stage misbehaves
- Better testability for orchestration without involving the full command registry
- Lower regression risk when adding stages or rules
- Cleaner separation between IPC and domain execution

### Proposed target shape

Create a service such as:

- `apps/desktop/src/main/services/batch-analysis-runner-service.ts`

That service should own:

- iteration startup
- planner loop
- reviewer loop
- worker execution
- amendment loop
- final review loop
- iteration completion
- job event emission for batch runs

`command-registry.ts` should become a thin wrapper that:

- validates payload
- resolves dependencies
- calls the runner
- returns or emits job-level results

### Implementation steps

1. Extract batch-only helper functions from `command-registry.ts`.
2. Move orchestration state tracking into the runner service.
3. Inject dependencies explicitly:
   - `WorkspaceRepository`
   - `BatchAnalysisOrchestrator`
   - `agentRuntime`
   - job emitter / logger hooks
4. Keep prompt building and artifact parsing inside [batch-analysis-orchestrator.ts](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/main/services/batch-analysis-orchestrator.ts).
5. Update command registration to call the runner service.
6. Add runner-level tests that cover the stage flow directly.

### Risks

- Easy to accidentally break event metadata shape during extraction
- Live runtime status updates must remain backward-compatible with the renderer
- Session ID and stage tracking need careful preservation

### Dependencies

- Best done after planner prefetch typing is improved
- Best done after the deterministic review layer is a little more stable

---

## 2. Add More Deterministic Plan-Review Gates

### Goal

Expand beyond the current missing-edits safeguard and add a broader deterministic plan-quality layer before a plan can be approved.

### Why this change matters

The current architecture still trusts the reviewer LLM too much in correctness-sensitive situations. If the reviewer misses obvious scope, the worker will faithfully execute the wrong plan.

### Benefits

- More consistent batch correctness across runs and models
- Less dependence on prompt obedience
- Earlier detection of under-scoped or suspicious plans
- More explainable reasons for revision
- Better enterprise trust in the review process

### Proposed deterministic checks

Add rule-based checks for:

- suspicious create items when strong existing article matches exist
- suspicious no-impact items when search/relation evidence implies likely changes
- under-covered topic clusters
- duplicate or overlapping targets
- evidence mismatch where plan targets are weakly grounded
- create/edit imbalance relative to prefetch evidence
- unresolved plan coverage gaps hidden behind “covered” labels

### Proposed service shape

Inside [batch-analysis-orchestrator.ts](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/main/services/batch-analysis-orchestrator.ts), add a deterministic review layer such as:

- `validatePlanAgainstPrefetch(...)`
- `augmentOrBlockReviewWithDeterministicFindings(...)`

These should run:

- after reviewer JSON is parsed
- before a plan is allowed to become approved

### Implementation steps

1. Define a typed deterministic finding model.
2. Add rule evaluators for the checks above.
3. Merge findings into review deltas when appropriate.
4. Force `needs_revision` when findings exceed an approval threshold.
5. Add test fixtures for edit-heavy, create-heavy, and ambiguous cases.
6. Later, surface deterministic findings in the batch UI as separate from model-authored findings.

### Risks

- Rules that are too aggressive may create unnecessary revision loops
- Rules that are too soft may not materially improve outcomes
- Threshold tuning needs real batch examples

### Dependencies

- Strongly depends on typed planner prefetch
- Strongly benefits from end-to-end realistic test fixtures

---

## 3. Strengthen Plan-Item To Proposal Matching

### Goal

Replace the current proposal reconciliation approach that leans too heavily on normalized title matching.

### Why this change matters

Today, worker execution results are reconciled to plan items partly by:

- action type
- normalized target title

That is fragile when:

- article titles are similar
- titles change slightly
- multiple locale variants share names
- plan items are structurally correct but proposal labels differ

### Benefits

- More accurate execution accounting
- Fewer false “blocked” results
- Better auditability from approved plan item to generated proposal
- Better support for duplicate or near-duplicate article names
- Safer final approval gates

### Proposed matching hierarchy

Match proposal output to plan items in this order:

1. explicit deterministic execution key
2. exact family ID / locale variant ID
3. exact target article key
4. fallback normalized title matching only for legacy or incomplete data

### Data model updates

Plan items and proposal metadata should carry more stable identifiers, such as:

- `targetFamilyId`
- `targetLocaleVariantId`
- `targetArticleKey`
- `planItemExecutionKey`

### Implementation steps

1. Extend plan item creation to persist stronger target identity.
2. Ensure proposal creation commands pass those IDs into proposal metadata.
3. Update worker-report reconciliation logic in [batch-analysis-orchestrator.ts](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/main/services/batch-analysis-orchestrator.ts).
4. Update repository hydration where needed so these IDs are visible in inspections.
5. Add tests for:
   - same title, different articles
   - same family, different locale variants
   - slightly mismatched user-facing titles
   - legacy data fallback

### Risks

- Some old plan/proposal records will not have the new identity fields
- Backward-compatible fallback logic is required
- Over-tight matching can hide real executions if legacy data is incomplete

### Dependencies

- Can be started before the orchestration extraction
- Best done after prefetch and deterministic checks are more stable

---

## 4. Type The Planner Prefetch End To End

### Goal

Replace `unknown` planner-prefetch payloads with shared explicit types across the batch system.

### Why this change matters

Planner prefetch is already a real subsystem with real semantics:

- prior analysis summary
- topic clusters
- article matches
- relation matches

But it is still moved around as loosely typed data. That increases drift risk and makes deterministic rule work harder than it needs to be.

### Benefits

- Stronger refactor safety
- Better autocomplete and editor guidance
- Easier testing
- Safer prompt compaction and deterministic checks
- Less hidden shape drift between planner, reviewer, and amendment flows

### Proposed type additions

Add shared types in [batch6.ts](/Users/mathewhuffman/ReactArena/knowledge_base/packages/shared-types/src/batch6.ts) or an adjacent shared batch types file:

- `BatchPlannerPrefetch`
- `BatchPlannerPrefetchCluster`
- `BatchPlannerArticleMatch`
- `BatchPlannerArticleMatchResult`
- `BatchPlannerRelationMatch`

### Implementation steps

1. Define shared prefetch types.
2. Update `buildPlannerPrefetch` in [command-registry.ts](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/main/services/command-registry.ts) to return typed data.
3. Update prompt builders to accept typed prefetch.
4. Update deterministic review guards to consume typed prefetch directly.
5. Remove duplicated local prefetch shape declarations.
6. Add tests for empty, partial, and strong-match prefetch payloads.

### Risks

- Some helper code may currently rely on permissive object handling
- Refactor may expose hidden inconsistencies in prompt compaction helpers

### Dependencies

- This should happen early
- It unlocks safer work for deterministic review gates and runner extraction

---

## 5. Split `ai-assistant-service.ts` Into Smaller Modules

### Goal

Break [ai-assistant-service.ts](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/main/services/ai-assistant-service.ts) into focused units without changing external behavior.

### Why this change matters

That file currently owns:

- assistant session persistence
- session/message/artifact lifecycle
- prompt building
- runtime loop control
- continuation handling
- transcript inspection
- parsing
- artifact promotion
- artifact application side effects
- working-state integration

It works, but it is carrying too much responsibility in one place.

### Benefits

- Easier to work on chat without destabilizing persistence
- Better unit test coverage at the module level
- Cleaner mental model for future contributors
- Safer extension of artifact behavior
- Easier debugging when a chat regression appears

### Proposed module split

Keep `AiAssistantService` as a façade, but extract:

- `ai-assistant-session-store.ts`
  - session/message/artifact persistence helpers
- `ai-assistant-prompt-builder.ts`
  - ask prompt and continuation prompt construction
- `ai-assistant-runtime-controller.ts`
  - run loop, retries, continuation, transcript waiting
- `ai-assistant-result-parser.ts`
  - runtime envelope parsing, payload normalization, artifact resolution
- `ai-assistant-artifact-service.ts`
  - proposal promotion, proposal patch apply, template/draft apply side effects

### Implementation steps

1. Extract pure helper functions first.
2. Extract parser logic next.
3. Extract artifact application logic next.
4. Extract runtime control loop after that.
5. Leave `AiAssistantService` as composition root and public API surface.
6. Add focused tests for parser correctness and artifact application rules.

### Risks

- Easy to accidentally change behavior around auto-apply or route capability handling
- Session status transitions must remain exactly compatible
- Event emission ordering must remain stable for the renderer

### Dependencies

- Largely independent of the batch work
- Can be done in parallel with batch refactors if ownership is kept clean

---

## Recommended Implementation Order

This is the recommended rollout order:

1. Type planner prefetch end to end
2. Add more deterministic plan-review gates
3. Strengthen plan-item-to-proposal matching
4. Move batch orchestration out of `command-registry.ts`
5. Split `ai-assistant-service.ts` into smaller modules

### Why this order is best

- The first three directly improve batch correctness
- The fourth improves maintainability after the rules are clearer
- The fifth is important, but it is less urgent than batch output quality

---

## Rollout Strategy

To reduce risk, these should be shipped in phases.

### Phase 1: Batch correctness stabilization

- type planner prefetch
- expand deterministic review guards
- add realistic under-scoped batch tests

Outcome:

- better plan quality before worker execution

Implementation status:

- Completed
- Shared planner-prefetch types now live in `packages/shared-types/src/batch6.ts`
- Batch prefetch construction and prompt-building now use typed planner-prefetch data instead of `unknown`
- Deterministic review gates now catch:
  - under-scoped create-only plans that ignore strong existing-article signals
  - all-`no_impact` plans when deterministic evidence suggests article edits
  - duplicate/conflicting plan items aimed at the same existing article
- Realistic regression coverage now exercises the full `agent.analysis.run` path with deterministic prefetch and revision enforcement
- A related job-state bug was also fixed so emitted terminal `FAILED` events correctly leave the job in a failed state

Verification:

- `pnpm --filter @kb-vault/desktop test -- batch-analysis-orchestrator.spec.ts`
- `pnpm --filter @kb-vault/desktop test -- job-runner.spec.ts`
- `pnpm --filter @kb-vault/desktop test -- --grep "forces revision when deterministic prefetch shows existing edit targets for an under-scoped create-only plan"`
- `pnpm --filter @kb-vault/desktop exec tsc -p tsconfig.main.json`

Environment note:

- Full Phase 1 verification required running under the repo's expected Node 20 toolchain and rebuilding `better-sqlite3` for that runtime before the DB-backed integration test would pass cleanly

### Phase 2: Batch execution identity hardening

- strengthen plan-item/proposal matching
- add identity-based reconciliation

Outcome:

- better worker accounting and safer approval

### Phase 3: Batch orchestration extraction

- move orchestration into a dedicated runner service
- keep registry thin

Outcome:

- much cleaner architecture and safer future batch changes

### Phase 4: Chat service decomposition

- split `AiAssistantService`
- preserve public behavior

Outcome:

- easier future assistant work with lower regression risk

---

## Testing Expectations Per Update

Each update should ship with targeted tests.

### For orchestration extraction

- stage progression tests
- failure and retry tests
- event metadata compatibility tests

### For deterministic gates

- create-vs-edit under-scope tests
- no-impact misuse tests
- duplicate target tests

### For proposal matching

- same-title different-target tests
- locale-variant matching tests
- legacy fallback tests

### For typed prefetch

- prompt compaction tests
- deterministic guard typing tests
- planner/reviewer fixture tests

### For assistant service split

- parser tests
- artifact auto-apply tests
- proposal promotion tests
- session lifecycle tests

---

## Success Criteria

These updates are successful when:

- batch plans stop under-scoping obvious edit work
- reviewer approval becomes more trustworthy and more explainable
- worker execution accounting becomes identity-based instead of title-guess-based
- batch orchestration becomes simpler to change safely
- chat assistant logic becomes easier to maintain without behavioral regressions

---

## Bottom Line

The chat system is now mostly a clean contextual assistant platform.

The batch system is now structurally strong, but still semantically too dependent on prompt quality at the plan-review boundary.

The under-scoped edit bug came from that exact boundary:

- strong deterministic evidence existed
- the planner saw it
- the reviewer did not
- no hard guard prevented approval

That gap is now narrowed by passing deterministic prefetch into review and by forcing revision when a create-only plan ignores strong existing article signals.
