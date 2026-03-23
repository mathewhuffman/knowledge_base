# Global AI Assistant Refactor Plan

## Objective

Replace the current page-specific Batch 9 article AI feature with a single app-wide AI assistant that:

- is accessible from every route,
- knows which page the user is on,
- receives the current page subject and unsaved working state,
- can create or update proposals from article contexts,
- can refine proposals live inside Proposal Review,
- can update draft working copies live inside Drafts,
- can update template working copies live inside Templates & Prompts,
- remains safe by requiring explicit user save/accept for persisted changes.

This plan assumes:

- ChatGPT/Codex owns all architecture, backend, contracts, data model, orchestration, parsing, tests, and non-visual renderer logic.
- Claude owns all user-visible design and UX work users will see.

## Product Rules

1. The assistant is global, but context is route-aware and entity-aware.
2. The assistant must always receive the current route name and current subject when available.
3. Unsaved working state must override persisted state when building AI context.
4. AI must never silently publish or silently finalize important content changes.
5. AI outputs must be typed actions, not inferred from freeform prose in the renderer.
6. The result of an AI turn must land in one of these controlled modes:
   - informational response
   - live working-copy update
   - proposal candidate creation
   - proposal working-copy patch
7. The allowed mode depends on route + entity type + capability policy.

## Current Problems To Fix

- AI is currently anchored to `Drafts` rather than the app shell.
- The current Batch 9 persistence model is article/draft oriented, not generic enough for proposal review and template editing.
- Current AI output handling is too narrow and does not distinguish chat transcript from editable artifact state.
- There is no single route-level context contract.
- There is no unified capability model for what AI may do on each screen.

## Target Architecture

### 1. App-Shell Assistant Host

Add a single root-level assistant host mounted from the app shell.

Responsibilities:

- floating launcher button
- open/close state
- current route context subscription
- current session loading
- current artifact loading
- message submission
- optimistic working-copy patch application hooks

Primary renderer locations:

- `apps/desktop/src/renderer/src/App.tsx`
- new shared assistant components under `apps/desktop/src/renderer/src/components/assistant/`

### 2. Route Context Registration

Each route provides a typed AI context builder.

Recommended interface:

```ts
interface AiViewContext {
  workspaceId: string;
  route: AppRoute;
  routeLabel: string;
  subject?: {
    type: 'workspace' | 'article' | 'draft_branch' | 'proposal' | 'template_pack' | 'pbi_batch';
    id: string;
    title?: string;
    locale?: string;
  };
  workingState?: {
    kind: 'article_html' | 'proposal_html' | 'template_pack' | 'none';
    versionToken?: string;
    payload: unknown;
  };
  capabilities: {
    canChat: boolean;
    canCreateProposal: boolean;
    canPatchProposal: boolean;
    canPatchDraft: boolean;
    canPatchTemplate: boolean;
    canUseUnsavedWorkingState: boolean;
  };
  backingData: unknown;
}
```

Each route should provide a local hook or adapter to produce this context.

### 3. Generic Main-Process AI Orchestrator

Introduce a new service, for example:

- `apps/desktop/src/main/services/ai-assistant-service.ts`

Responsibilities:

- receive `AiViewContext` + user message
- normalize and validate context
- select the correct entity adapter
- build ACP prompt
- run ACP turn
- parse structured result
- persist transcript
- persist latest artifact
- return typed action envelope

This service replaces route-specific AI branching logic in command handlers.

### 4. Entity Adapters

Use adapters so the assistant does not become a giant route switch statement.

Recommended adapters:

- `article-adapter`
- `draft-branch-adapter`
- `proposal-adapter`
- `template-pack-adapter`
- `workspace-adapter`

Each adapter owns:

- context serialization
- allowed action kinds
- base-state extraction
- artifact application logic
- stale-state checks

### 5. Transcript vs Artifact Separation

Persist conversation separately from generated working output.

Why:

- users may have many messages for one entity,
- the latest generated patch must remain stable and inspectable,
- new turns must build on the latest accepted working state, not arbitrarily on transcript prose.

## Recommended Data Model Refactor

Replace or supersede the Batch 9 article-only tables with a generic model.

### Proposed tables

#### `ai_sessions`

- `id`
- `workspace_id`
- `scope_type` (`global` | `page` | `entity`)
- `route`
- `entity_type`
- `entity_id`
- `status`
- `runtime_session_id`
- `latest_artifact_id`
- `created_at`
- `updated_at`

#### `ai_messages`

- `id`
- `session_id`
- `workspace_id`
- `role`
- `message_kind`
- `content`
- `metadata_json`
- `created_at`

#### `ai_artifacts`

- `id`
- `session_id`
- `workspace_id`
- `artifact_type`
- `entity_type`
- `entity_id`
- `base_version_token`
- `status` (`pending` | `applied` | `rejected` | `superseded`)
- `payload_json`
- `summary`
- `created_at`
- `updated_at`
- `applied_at`
- `rejected_at`

Optional later:

#### `ai_artifact_versions`

For preserving iteration history if you want full artifact evolution.

## Recommended Artifact Types

- `informational_response`
- `proposal_candidate`
- `proposal_patch`
- `draft_patch`
- `template_patch`
- `navigation_suggestion`
- `clarification_request`

## Route Behavior Matrix

### Global pages

Examples:

- Workspace Switcher
- KB Vault Home
- Settings

Allowed:

- informational chat
- workflow guidance
- navigation suggestions

Not allowed:

- content mutation

### Article Explorer

Allowed:

- article explanation
- article improvement suggestions
- create proposal candidate from live article

Default mutation result:

- `proposal_candidate`

### Drafts

Allowed:

- draft working-copy patch
- article explanation
- structure/tone/template help

Default mutation result:

- `draft_patch`

Persistence rule:

- patch updates editor working state live
- explicit user save persists revision

### Proposal Review

Allowed:

- proposal refinement
- rationale/title/html improvement
- live review-side iteration

Default mutation result:

- `proposal_patch`

Persistence rule:

- proposal review screen updates live
- explicit accept/deny/apply remains the final decision

### Templates & Prompts

Allowed:

- template creation help
- template form patch
- tone rule rewriting
- locale adaptation

Default mutation result:

- `template_patch`

Persistence rule:

- form state updates live
- explicit save persists template

## Recommended IPC Surface

Introduce a new unified IPC family.

### Context / session

- `ai.assistant.context.get`
- `ai.assistant.session.get`
- `ai.assistant.session.reset`

### Messaging

- `ai.assistant.message.send`

### Artifact decisions

- `ai.assistant.artifact.apply`
- `ai.assistant.artifact.reject`

### Optional targeted helpers

- `ai.assistant.artifact.promoteToProposal`
- `ai.assistant.artifact.saveToDraft`
- `ai.assistant.artifact.saveToTemplate`

The renderer should not need route-specific AI IPC endpoints anymore.

## Proposed Runtime Result Envelope

Every assistant response should come back as a typed object.

```ts
interface AiAssistantTurnResponse {
  workspaceId: string;
  session: AiSessionRecord;
  messages: AiMessageRecord[];
  context: AiViewContext;
  artifact?: AiArtifactRecord;
  uiActions: Array<
    | { type: 'replace_working_html'; target: 'draft' | 'proposal'; html: string }
    | { type: 'replace_template_form'; payload: TemplatePatchPayload }
    | { type: 'show_proposal_created'; proposalId: string }
    | { type: 'show_stale_warning'; baseVersionToken: string }
    | { type: 'none' }
  >;
}
```

## Prompt Assembly Rules

Each turn should include:

- page name / route
- workspace identifier
- subject identifier + title + locale
- current persisted state
- unsaved working state if available
- allowed action list
- recent messages
- required response schema

Critical rule:

- if a working copy exists, it must be treated as source of truth for that turn.

## Stale-State / Concurrency Rules

Every mutable context should provide a `versionToken`.

Examples:

- draft: `headRevisionId`
- proposal review: proposal id + current working version counter
- template: template pack id + local form dirty version counter

When AI returns:

- if base token still matches, apply patch normally
- if base token changed, return a stale warning artifact instead of silently applying

## Proposal Logic Rules

### From live article context

User asks for changes to a live article:

- AI should produce `proposal_candidate`
- backend creates a proposal record with:
  - proper title
  - rationale
  - linked source article context
  - proposed HTML

### From proposal review context

User asks for refinements:

- AI should produce `proposal_patch`
- review screen updates live
- proposal is not finalized until user acts

### From draft context

AI produces `draft_patch`

- renderer updates working HTML
- save remains explicit

### From template context

AI produces `template_patch`

- renderer updates form state
- save remains explicit

## Renderer Refactor Steps

### Phase A: Global host

1. Add root assistant launcher and panel container to app shell.
2. Add shared assistant store/context for:
   - open state
   - active route context
   - active session
   - latest artifact
3. Add route-facing registration hook.

### Phase B: Route adapters

1. `ArticleExplorer` exposes current article context.
2. `Drafts` exposes current draft + unsaved HTML.
3. `ProposalReview` exposes current proposal + current review working copy.
4. `TemplatesAndPrompts` exposes selected template + current form values.

### Phase C: Artifact application plumbing

1. Draft route applies `draft_patch` into local editor state.
2. Proposal review route applies `proposal_patch` into local review state.
3. Template route applies `template_patch` into local form state.
4. Article explorer route handles `proposal_candidate` creation result and navigation.

## Main-Process Refactor Steps

### Phase A: New contracts

1. Add shared types for:
   - contexts
   - sessions
   - messages
   - artifacts
   - action envelopes

### Phase B: DB migration

1. Add generic AI tables.
2. Add migration path from current `article_ai_sessions` / `article_ai_messages` if needed.

### Phase C: Orchestrator

1. Build `AiAssistantService`.
2. Add adapter registry.
3. Add structured response parser.
4. Add stale-state validation.

### Phase D: IPC

1. Register unified assistant endpoints.
2. Keep old `article.ai.*` endpoints temporarily as compatibility shims if desired.

## Testing Plan

### Unit

- context builder tests
- capability matrix tests
- artifact parsing tests
- stale-state detection tests
- adapter action routing tests

### Repository

- generic session persistence
- generic artifact persistence
- apply/reject transitions
- proposal creation from article context

### Command / IPC

- route-context to AI orchestration path
- artifact application paths
- template patch save flow
- proposal patch update flow

### Renderer

- assistant opens globally
- context changes with route selection
- draft patch applies live
- proposal patch applies live
- template patch applies live

## Claude Ownership Boundary

Claude owns all user-visible design and UX work users will see, including:

- floating assistant button design
- assistant drawer/panel layout
- chat transcript visual treatment
- context badges and headers
- loading, streaming, and empty states
- proposal live-update presentation
- draft live-update presentation
- template live-update presentation
- diff previews and apply/reject affordances
- route-level visual integration and polish

Claude must not change backend contracts or the capability rules without coordination.

## ChatGPT / Codex Ownership Boundary

ChatGPT/Codex owns:

- data model
- migrations
- IPC
- AI orchestrator
- ACP integration changes
- context adapters
- artifact parsing
- persistence
- stale-state logic
- apply/reject logic
- tests
- non-visual route wiring

## Implementation Order Recommendation

1. Shared contracts
2. Generic DB migration
3. AI orchestrator service
4. Unified IPC
5. Root assistant host scaffold
6. Draft adapter
7. Template adapter
8. Proposal review adapter
9. Article explorer proposal-creation adapter
10. Claude visual polish pass

## Success Criteria

- User can open AI from any page via bottom-right launcher.
- Assistant always knows current route.
- Assistant receives current entity context when available.
- Live article requests generate proposals.
- Proposal review requests update the visible proposal live.
- Draft requests update draft working state live.
- Template requests update template working state live.
- Save/accept remains explicit and safe.
- Stale updates are detected and surfaced instead of silently applied.
