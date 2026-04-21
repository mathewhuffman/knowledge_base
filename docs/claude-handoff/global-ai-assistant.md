# Claude Handoff: Global AI Assistant

This note is a companion to:

- [codex-global-ai-assistant-refactor.md](/Users/mathewhuffman/ReactArena/knowledge_base/docs/batches/codex-global-ai-assistant-refactor.md)
- [global-ai-assistant.md](/Users/mathewhuffman/ReactArena/knowledge_base/docs/design-handoff/global-ai-assistant.md)

It focuses on what Codex has already implemented, what Claude should treat as fixed backend behavior, and what UX/design work is now needed.

## What Codex Already Implemented

### 1. Global assistant host now exists

Primary renderer locations:

- [App.tsx](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/renderer/src/App.tsx)
- [AssistantContext.tsx](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/renderer/src/components/assistant/AssistantContext.tsx)
- [GlobalAssistantHost.tsx](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/renderer/src/components/assistant/GlobalAssistantHost.tsx)

Current behavior:

- assistant launcher is mounted at app-shell level
- panel state is global, not page-local
- assistant session changes when route/entity context changes
- route pages register context and apply hooks into the global host

### 2. Unified contracts and persistence exist

Primary backend / contract files:

- [ai-assistant.ts](/Users/mathewhuffman/ReactArena/knowledge_base/packages/shared-types/src/ai-assistant.ts)
- [ai-assistant-service.ts](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/main/services/ai-assistant-service.ts)
- [command-registry.ts](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/main/services/command-registry.ts)
- [migrations.ts](/Users/mathewhuffman/ReactArena/knowledge_base/packages/db/src/migrations.ts)

Implemented DB tables:

- `ai_sessions`
- `ai_messages`
- `ai_artifacts`

Implemented artifact types:

- `informational_response`
- `proposal_candidate`
- `proposal_patch`
- `draft_patch`
- `template_patch`
- `clarification_request`

### 3. Route context registration is wired

Renderer pages already registering assistant context:

- [ArticleExplorer.tsx](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/renderer/src/pages/ArticleExplorer.tsx)
- [Drafts.tsx](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/renderer/src/pages/Drafts.tsx)
- [ProposalReview.tsx](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/renderer/src/pages/ProposalReview.tsx)
- [TemplatesAndPrompts.tsx](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/renderer/src/pages/TemplatesAndPrompts.tsx)

Each route now provides:

- route id / label
- current subject identity
- capability policy
- working state when available
- apply hook for live working-copy updates

### 4. Live update behavior is already functional

Current route outcomes:

- `Drafts`: `draft_patch` replaces local editor working HTML
- `Proposal Review`: `proposal_patch` updates the review working copy and also updates proposal working data in persistence
- `Templates & Prompts`: `template_patch` merges into local form state
- `Article Explorer`: `proposal_candidate` stays pending until user applies it

### 5. Proposal candidate promotion exists

If a pending article-context proposal candidate is applied:

- backend creates a real proposal record
- proposal lands in a reusable assistant proposal batch
- UI receives `show_proposal_created`

## Unified IPC Claude Should Design Against

These are the routes Claude should assume are the long-term surface:

- `ai.assistant.context.get`
- `ai.assistant.session.get`
- `ai.assistant.message.send`
- `ai.assistant.session.reset`
- `ai.assistant.artifact.apply`
- `ai.assistant.artifact.reject`

Claude should not design around the old `article.ai.*` sidebar model anymore.

## Current UX Reality

The current host is intentionally minimal and functional. It is not the final visual language.

What exists now:

- floating launcher
- assistant panel
- transcript list
- prompt composer
- pending artifact card
- apply / reject actions for pending proposal candidates
- direct live route updates for patch results

What is still visually thin:

- context presentation
- route-specific affordances
- transcript hierarchy
- loading polish
- pending / applied / stale visualization
- quick actions / presets
- trust-building change presentation

## Important Behavior Claude Must Preserve

### 1. Scope must stay obvious

The assistant always has a current route context, and usually a current subject.

Claude should make this visually explicit using:

- route label
- object title
- locale badge when relevant
- possibly capability badges or a mode line

### 2. Working-copy edits are provisional

For drafts, proposals, and templates:

- the assistant can update the current working state
- those changes should not read like “already published” or “already finalized”

Claude should visually communicate:

- provisional state
- locally updated state
- whether user action is still required

### 3. Proposal candidates are approval-gated

For article context:

- assistant result is a pending `proposal_candidate`
- user must explicitly apply or reject

Claude should make proposal-candidate state feel more review-oriented than chat-oriented.

### 4. Stale-state warnings are real backend behavior

Artifacts can return stale warnings when version tokens no longer match.

Claude should include a real UX for:

- stale artifact card
- rerun / compare framing
- non-destructive warning language

## Claude’s Main Batch Goals

### 1. Replace the placeholder assistant shell with final UX

Claude should redesign:

- launcher visuals
- panel layout
- context header
- transcript treatment
- artifact cards
- action area
- empty / loading / error states

### 2. Make each route feel intentionally integrated

Needed route-specific UX treatment:

- `Article Explorer`: proposal-candidate framing, not “edit applied”
- `Drafts`: clear indication that AI changed the local working copy
- `Proposal Review`: strongest trust cues, strongest “not final until you decide” messaging
- `Templates & Prompts`: AI-updated fields should still feel editable and save-gated

### 3. Design explicit state language

Claude should settle on consistent user-facing language for:

- current scope
- working copy updated
- pending assistant artifact
- stale result
- proposal created
- save still required
- accept still required

### 4. Improve route-specific actions and shortcuts

Good candidates for Claude to design:

- quick action chips per route
- compact preset actions
- inline “open created proposal” affordance
- route-aware helper copy in the composer

## Suggested Visual States Claude Should Cover

At minimum, Claude should design these states:

1. Launcher only, closed
2. Open panel with no selected entity
3. Open panel on article context
4. Open panel with pending proposal candidate
5. Open panel on draft context after live patch
6. Open panel on proposal review after refinement
7. Open panel on template context after field patch
8. Busy / generating state
9. Stale artifact warning state
10. Error / retry state

## Practical Notes For Claude

### Existing code is safe to restyle

Claude can reshape the visual structure of:

- [GlobalAssistantHost.tsx](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/renderer/src/components/assistant/GlobalAssistantHost.tsx)
- [components.css](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/renderer/src/styles/components.css)

Claude can also add assistant-specific subcomponents under:

- [components/assistant](/Users/mathewhuffman/ReactArena/knowledge_base/apps/desktop/src/renderer/src/components/assistant)

### Backend assumptions Claude should keep fixed

- typed action envelopes are authoritative
- route context comes from page registration, not inference in the panel
- draft/template/proposal patch application is already wired
- proposal candidates require explicit apply/reject
- artifact types should not be renamed casually

### Claude does not need to add backend logic for:

- session persistence
- artifact persistence
- proposal-candidate creation flow
- proposal review working-copy persistence
- IPC contracts

## Known Limitations In The Current Codex Pass

These are good opportunities for Claude polish rather than backend rework:

- the host is functional but visually plain
- transcript cards are generic and not route-specific
- proposal-created follow-up UX is minimal
- stale warning UX is not yet richly surfaced
- quick actions are not yet designed into the global host
- article explorer removed the old in-panel AI tab and now expects the global assistant to carry that experience

## Testing / Verification Note

Codex completed the implementation and desktop typecheck passes, but local command tests were blocked in this environment by a native `better-sqlite3` binary mismatch. Claude should still be able to proceed with renderer/UX work against the existing contracts and source wiring.
