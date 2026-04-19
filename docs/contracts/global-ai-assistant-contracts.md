# Global AI Assistant Contract Proposal

## Core Context Contract

```ts
interface AiViewContext {
  workspaceId: string;
  route: string;
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

## Session Record

```ts
interface AiSessionRecord {
  id: string;
  workspaceId: string;
  scopeType: 'global' | 'page' | 'entity';
  route: string;
  entityType?: string;
  entityId?: string;
  runtimeSessionId?: string;
  status: 'idle' | 'running' | 'has_pending_artifact' | 'error';
  latestArtifactId?: string;
  createdAtUtc: string;
  updatedAtUtc: string;
}
```

## Presentation Contract

```ts
type AiAssistantDockMode = 'embedded' | 'detached';
type AiAssistantSurfaceMode = 'closed' | 'launcher' | 'panel';

interface AiAssistantPresentationState {
  dockMode: AiAssistantDockMode;
  surfaceMode: AiAssistantSurfaceMode;
  state: 'embedded_closed' | 'embedded_open' | 'detached_launcher' | 'detached_panel';
  hasUnread: boolean;
  embeddedLauncherPosition?: { left: number; top: number };
  detachedLauncherBounds?: { x: number; y: number; width: number; height: number };
  detachedPanelBounds?: { x: number; y: number; width: number; height: number };
  detachedDisplayId?: number;
  lastDetachedSurfaceMode?: 'launcher' | 'panel';
  updatedAtUtc: string;
}
```

Behavior rules:

- assistant UI close:
  - `embedded_open -> embedded_closed`
  - `detached_panel -> detached_launcher`
- native detached window close:
  - `detached_launcher -> embedded_closed`
  - `detached_panel -> embedded_closed`
- no duplicate active assistant surfaces:
  - when detached, the main app must not render an active embedded launcher or panel
- route/entity context remains owned by the main window and is published to the detached window

## Message Record

```ts
interface AiMessageRecord {
  id: string;
  sessionId: string;
  role: 'system' | 'user' | 'assistant';
  kind: 'chat' | 'artifact' | 'decision' | 'warning';
  content: string;
  metadata?: Record<string, unknown>;
  createdAtUtc: string;
}
```

## Artifact Record

```ts
interface AiArtifactRecord {
  id: string;
  sessionId: string;
  workspaceId: string;
  artifactType:
    | 'informational_response'
    | 'proposal_candidate'
    | 'proposal_patch'
    | 'draft_patch'
    | 'template_patch'
    | 'navigation_suggestion'
    | 'clarification_request';
  entityType?: string;
  entityId?: string;
  baseVersionToken?: string;
  status: 'pending' | 'applied' | 'rejected' | 'superseded';
  summary: string;
  payload: unknown;
  createdAtUtc: string;
  updatedAtUtc: string;
}
```

## Unified IPC Proposal

### `ai.assistant.context.get`

Request:

- `workspaceId`
- `route`
- optional route-specific subject refs

Response:

- `AiViewContext`

### `ai.assistant.context.current`

Response:

- latest published `AiViewContext`
- publish timestamp
- publishing window role

### `ai.assistant.context.publish`

Request:

- latest `AiViewContext | null`
- publishing window role

Response:

- published context snapshot

### `ai.assistant.presentation.get`

Response:

- `AiAssistantPresentationState`

### `ai.assistant.presentation.transition`

Request:

- typed presentation transition such as:
  - open embedded panel
  - close embedded panel
  - detach launcher
  - detach panel
  - open detached panel
  - collapse detached panel to launcher
  - reattach embedded closed
  - update detached bounds

### `ai.assistant.session.get`

Request:

- `workspaceId`
- `route`
- optional `entityType`
- optional `entityId`

Response:

- `session`
- `messages`
- `artifact`

### `ai.assistant.message.send`

Request:

- `workspaceId`
- `context: AiViewContext`
- `message`

Response:

- `AiAssistantTurnResponse`

### `ai.assistant.session.reset`

Request:

- `workspaceId`
- `sessionId`

Response:

- reset session payload

### `ai.assistant.artifact.apply`

Request:

- `workspaceId`
- `sessionId`
- `artifactId`

Response:

- updated session + updated route-specific result data

### `ai.assistant.artifact.reject`

Request:

- `workspaceId`
- `sessionId`
- `artifactId`

Response:

- updated session + updated route-specific result data

## Route-Specific Apply Semantics

### Live article context

- applying a `proposal_candidate` creates a real proposal record
- may navigate user to proposal review

### Proposal review context

- applying a `proposal_patch` updates proposal working state on-screen
- does not auto-accept proposal

### Draft context

- applying a `draft_patch` updates local draft editor working state
- does not auto-save

### Template context

- applying a `template_patch` updates local form state
- does not auto-save

## Stale-State Behavior

If returned artifact base token no longer matches current view token:

- artifact is returned as pending with stale warning metadata
- renderer must not auto-apply
- user gets explicit rerun/compare choice
