# Batch Analysis Runtime Working Notes

## Goal

Stabilize batch analysis planning and review after recent regressions where:

- planning spiraled on repeated zero-result `search-kb` calls
- planner partial drafts were lost before repair
- review/build telemetry was weak
- persisted tool usage incorrectly showed `0` when planning used many tools but the worker never ran

## Latest Confirmed Problem Run

- Batch: `ce0717a8-8733-47bb-b640-195edcdd2160`
- Date: March 29, 2026
- Workspace session transcript root:
  - `/Users/mathewhuffman/kb-vault-workspaces/.meta/agent-transcripts/101955f8-a964-4520-bcc2-05707eb5dbda`

Observed behavior:

- planner used many CLI tool calls immediately
- repeated `search-kb` calls kept returning zero
- runtime loop breaker only triggered after multiple wasted searches
- planner streamed partial natural-language chunks but did not finish valid planner JSON
- repair prompt received effectively empty prior output context
- UI/accounting could show `0` tool calls because only worker runs were persisted

## Implemented In This Pass

### Planner runtime guardrails

Files:

- `/Users/mathewhuffman/ReactArena/knowledge_base/packages/agent-runtime/src/index.ts`
- `/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/main/services/batch-analysis-orchestrator.ts`
- `/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/main/services/command-registry.ts`

Changes:

- lowered the CLI planner consecutive zero-result loop-breaker threshold from `6` to `4`
- added duplicate zero-result search suppression for repeated identical `search-kb --query ...` planner calls
- when the runtime aborts for duplicate dead-end searches, it now tells the planner to reuse deterministic prefetch / existing zero-result evidence and return the current plan as JSON
- strengthened planner prompt language so deterministic prefetch is the default source of truth, not a suggestion

### Planner retry and repair improvements

Files:

- `/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/main/services/batch-analysis-orchestrator.ts`
- `/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/main/services/command-registry.ts`

Changes:

- added a planner-specific strict JSON restatement retry before the heavier repair prompt
- added `summarizePlannerRecoveryContext(...)` so repair/retry prompts receive structured partial-draft context instead of an empty `Previous invalid planner output`
- planner response telemetry now records:
  - `durationMs`
  - `toolCallCount`
  - retry type where applicable

### Tool-call persistence and inspector visibility

Files:

- `/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/main/services/command-registry.ts`
- `/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/renderer/src/components/batch-analysis/BatchAnalysisInspector.tsx`
- `/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/renderer/src/components/batch-analysis/TimelineView.tsx`

Changes:

- planner/reviewer/amendment/final-review stage runs are now persisted into `ai_runs`, not just worker runs
- stage events now log `toolCallCount` and `durationMs` at result time
- inspector overview now shows derived stage metrics
- timeline stage-event cards now surface:
  - tool count
  - duration
  - attempt number

## Tests Added / Expanded

Files:

- `/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/tests/command-registry-review-recovery.spec.ts`
- `/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/tests/repository-content-model.spec.ts`
- `/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/tests/agent-runtime-cli-plan-mode.spec.ts`

Coverage added:

- planner retry predicate for empty / tiny unsalvageable output
- planner repair context summarization so repair prompts are not empty
- persisted latest run can expose planner tool calls without a worker run
- duplicate zero-result planner searches abort early in CLI plan mode

## Remaining Risks To Check After This Pass

1. Renderer type-checking may need small follow-up adjustments in `BatchAnalysisInspector.tsx` because the new stage metrics UI derives stage/role labels dynamically.
2. Planner retry + repair behavior should be validated on a real live batch to confirm:
   - the JSON-only restatement retry succeeds more often than the old empty repair path
   - duplicate dead-end search suppression does not cut off legitimate materially different queries
3. The inspector now surfaces stage metrics, but the separate runtime tool-history tab still follows the latest persisted run/session model. If the UX should show all stage tool calls in one combined pane, that would be a second pass.

## Latest Root Cause Found After Live Batch `fc0c7905-41e1-4a05-8574-e72c22ba104b`

- Transcript:
  - `/Users/mathewhuffman/kb-vault-workspaces/.meta/agent-transcripts/848927aa-3bb0-4dab-b290-c463bcdc5366/346a062f-dea2-4f13-9d8a-329d6c7a3d7e.jsonl`
- Observed:
  - planner emitted `2879` `agent_message_chunk` updates over about `26.6s`
  - no terminal `session/prompt` response ever arrived for the actual planner turn
  - the planner stream contained a partial/malformed JSON draft rather than a clean final object
- First-principles cause:
  - the prompt-completion watcher was using the same `sessionActivityAt` clock as transcript writes and UI progress emits
  - after the agent stopped sending chunks, the local backlog of `appendTranscriptLine(...)` and progress `emit(...)` completions kept refreshing `sessionActivityAt`
  - that prevented the fallback watcher from ever seeing the prompt as “idle”, so the planner prompt did not finalize and the run stayed stuck in planning while context ballooned
- Systemic fix applied:
  - runtime now tracks `promptTransportActivityAt` separately from generic session activity
  - prompt stream fallback uses transport activity, so chunk-heavy planner runs can finalize once agent output actually goes idle even if transcript/progress bookkeeping is still draining
- Regression added:
  - chunk-flood streaming-only ACP prompt with deliberately slow progress handling still completes successfully

## Latest Runtime Hardening Pass After Session `700ae036-2e1e-485e-9c24-f6a5559a5a79`

- Transcript:
  - `/Users/mathewhuffman/kb-vault-workspaces/.meta/agent-transcripts/700ae036-2e1e-485e-9c24-f6a5559a5a79/1dbecd4c-3b73-470d-846c-cc876cdc8d64.jsonl`
- Root issues identified:
  - CLI batch planner ACP session was still being created in `agent` mode, which allowed longer autonomous behavior and unnecessary tool churn
  - planner stayed alive after it had already started streaming structured JSON, which let malformed output keep consuming tokens
  - `session/close` is not reliably supported by the active ACP transport, so “close the session” could silently do nothing
  - transcript recovery was still vulnerable to overlap-merging corruption because only the merged chunk path was considered
- Structural fixes applied:
  - CLI batch planners now request true ACP `plan` mode
  - runtime tracks a batch-planner structured-result contract and stops the remote prompt once a valid planner JSON stream is captured and the active tool calls have drained
  - runtime aborts planners that keep burning tool calls or stay in malformed JSON drift too long after entering JSON mode
  - stale idle non-chat sessions are proactively closed; assistant chat sessions are explicitly excluded from this cleanup path
  - runtime session reset now aborts the active prompt first instead of relying only on unsupported `session/close`
  - transcript candidate recovery now keeps both raw-concatenated chunk text and merged chunk text so JSON recovery can choose the safer candidate
  - planner prompt wording was adjusted to strongly emphasize that deterministic prefetch usually already contains the needed evidence, without turning that into a hard prohibition on new KB discovery
- Chat safety checks added:
  - assistant chat still requests ACP `ask` mode
  - assistant chat auto-continue and fresh-session continuation regressions still pass

## Suggested Next Checks In A Fresh Session

1. Run:
   - `pnpm --filter @kb-vault/desktop test -- command-registry-review-recovery.spec.ts`
   - `pnpm --filter @kb-vault/desktop test -- repository-content-model.spec.ts`
   - `pnpm --filter @kb-vault/desktop test -- agent-runtime-cli-plan-mode.spec.ts`
   - `pnpm --filter @kb-vault/desktop exec tsc -p tsconfig.main.json`
   - `pnpm --filter @kb-vault/desktop exec tsc -p tsconfig.renderer.json`
2. Retry a live batch and inspect:
   - whether planning exits earlier when zero-result search repetition starts
   - whether `tool calls` count is nonzero even if the run never reaches worker execution
   - whether overview timeline badges show stage durations / tool counts
3. If live behavior is still too slow, next candidate improvement is compacting planner/reviewer prompts further by trimming oversized deterministic relation payloads.

## Key Files For Continued Work

- `/Users/mathewhuffman/ReactArena/knowledge_base/packages/agent-runtime/src/index.ts`
- `/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/main/services/command-registry.ts`
- `/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/main/services/batch-analysis-orchestrator.ts`
- `/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/main/services/workspace-repository.ts`
- `/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/renderer/src/components/batch-analysis/BatchAnalysisInspector.tsx`
- `/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/renderer/src/components/batch-analysis/TimelineView.tsx`
