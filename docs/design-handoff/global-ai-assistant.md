# Design Handoff: Global AI Assistant

Claude owns all user-visible design and UX work for this refactor.

## Product Intent

The assistant should feel like a native operator panel for KB Vault, not a bolted-on chatbot.

It must:

- be available from every route,
- clearly communicate what page/object it is currently helping with,
- make AI edits feel safe and reviewable,
- show live changes without confusing them for already-saved changes.

## Screens / Surfaces Claude Should Design

### 1. Global Floating Launcher

Location:

- bottom-right of the application shell on every route when the assistant is embedded

Needs:

- resting state
- hover/focus state
- unread/pending state if useful
- busy/running state
- explicit pop-out action that intentionally detaches the assistant into a desktop assistant window

### 2. Assistant Panel / Drawer

Needs:

- header with current context badge
- transcript area
- prompt composer
- quick actions/presets
- action footer / apply-reject CTAs when an artifact exists
- compact state when context is missing
- clear pop-out control in the header so the embedded panel can be detached into a desktop panel without moving the launcher button

### 3. Detached Desktop Launcher

Needs:

- small standalone assistant launcher window
- same unread/busy communication as the embedded launcher
- click to expand into the detached desktop panel
- native close should reattach the assistant back into the main app in embedded closed state

### 4. Detached Desktop Panel

Needs:

- full assistant panel content in a real Electron window
- same transcript/composer/artifact behavior as the embedded panel
- assistant UI close collapses to detached launcher
- native close reattaches the assistant back into the main app in embedded closed state

### 5. Context Header Variants

Contexts to visually distinguish:

- global app help
- article context
- draft context
- proposal review context
- template context

The user should always know what the assistant is acting on.

### 6. Proposal Review Live-Update UX

When user chats while reviewing a proposal:

- proposal updates should appear live on the current review screen
- changed vs original state must remain obvious
- user should understand that changes are not final until they choose an action

### 7. Draft Live-Update UX

When user chats on a draft:

- AI changes should appear in the current draft working copy
- distinction between unsaved manual changes and AI-applied working changes must remain understandable

### 8. Template Live-Update UX

When user chats while editing a template:

- prompt/tone/example fields should update live
- save affordance should remain explicit
- AI-generated vs manual edits should feel trackable

### 9. Empty / Error / Stale States

Required states:

- no context available
- assistant unavailable
- AI still running
- stale result returned
- forbidden action for this page
- invalid AI result

## Interaction Principles

1. The assistant should always reveal current scope.
2. Generated changes should feel provisional until saved or accepted.
3. Proposal review should remain the highest-trust environment.
4. The assistant should reduce context switching, not add more.
5. Detaching must never create two competing active assistant surfaces.

## Specific UX Questions Claude Should Solve

- How does the assistant panel indicate current route + selected object?
- How does the user understand whether AI is:
  - answering only,
  - editing working state,
  - creating a proposal?
- How should live-updated proposal content be visually distinguished from the original proposal?
- How should stale-state warnings appear when the page changed mid-generation?
- What is the best compact mobile-width / narrow-layout behavior?

## Components Claude Should Own

- floating assistant launcher
- assistant shell / drawer
- transcript message components
- context badge system
- quick action chips
- artifact summary cards
- apply / reject / save surfaces
- inline diff or change summary surfaces
- stale warning banner / interstitial

## Backend Contracts Claude Should Consume

Claude should design against the unified assistant system proposed in:

- [codex-global-ai-assistant-refactor.md](/Users/mathewhuffman/ReactArena/knowledge_base/docs/batches/codex-global-ai-assistant-refactor.md)
- [global-ai-assistant-contracts.md](/Users/mathewhuffman/ReactArena/knowledge_base/docs/contracts/global-ai-assistant-contracts.md)

Claude should not reinvent the backend model or action taxonomy.

## Required View States

- launcher closed
- launcher open, no entity context
- launcher open, article context
- launcher open, proposal context with pending patch
- launcher open, draft context with working-copy patch
- launcher open, template context with working-copy patch
- detached launcher
- detached panel
- detached panel collapsed back to detached launcher
- detached native close reattached into embedded launcher
- run in progress
- stale result warning
- error / retry

## Accessibility Expectations

- launcher is keyboard reachable
- context is text, not color-only
- artifact actions are clear and not icon-only
- transcript remains readable at long lengths
- screen-reader-friendly labels for current scope and artifact state
