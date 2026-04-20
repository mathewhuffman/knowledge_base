import type { AppRoute } from './routes';

export type AiSubjectType =
  | 'workspace'
  | 'article'
  | 'draft_branch'
  | 'proposal'
  | 'pbi'
  | 'template_pack'
  | 'pbi_batch';

export type AiWorkingStateKind = 'article_html' | 'proposal_html' | 'template_pack' | 'none';

export type AiArtifactType =
  | 'informational_response'
  | 'proposal_candidate'
  | 'proposal_patch'
  | 'draft_patch'
  | 'template_patch'
  | 'navigation_suggestion'
  | 'clarification_request';

export type AiScopeType = 'global' | 'page' | 'entity';

export type AiSessionStatus = 'idle' | 'running' | 'has_pending_artifact' | 'error';

export type AiSessionLifecycleStatus = 'active' | 'closed' | 'archived';

export type AiArtifactStatus = 'pending' | 'applied' | 'rejected' | 'superseded';

export type AiMessageRole = 'system' | 'user' | 'assistant';

export type AiMessageKind = 'chat' | 'artifact' | 'decision' | 'warning';

export type AiAssistantTurnCompletionState =
  | 'completed'
  | 'researching'
  | 'needs_user_input'
  | 'blocked'
  | 'errored'
  | 'unknown';

export interface AiViewContextSubject {
  type: AiSubjectType;
  id: string;
  title?: string;
  locale?: string;
}

export interface AiViewWorkingState {
  kind: AiWorkingStateKind;
  versionToken?: string;
  payload: unknown;
}

export interface AiViewCapabilities {
  canChat: boolean;
  canCreateProposal: boolean;
  canPatchProposal: boolean;
  canPatchDraft: boolean;
  canPatchTemplate: boolean;
  canUseUnsavedWorkingState: boolean;
}

export interface AiViewContext {
  workspaceId: string;
  route: AppRoute;
  routeLabel: string;
  subject?: AiViewContextSubject;
  workingState?: AiViewWorkingState;
  capabilities: AiViewCapabilities;
  backingData: unknown;
}

export interface AiSessionRecord {
  id: string;
  workspaceId: string;
  scopeType: AiScopeType;
  title: string;
  route: AppRoute;
  entityType?: AiSubjectType;
  entityId?: string;
  entityTitle?: string;
  lifecycleStatus: AiSessionLifecycleStatus;
  status: AiSessionStatus;
  runtimeSessionId?: string;
  latestArtifactId?: string;
  lastMessageAtUtc?: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  closedAtUtc?: string;
  archivedAtUtc?: string;
}

export interface AiMessageRecord {
  id: string;
  sessionId: string;
  workspaceId: string;
  role: AiMessageRole;
  messageKind: AiMessageKind;
  content: string;
  metadata?: Record<string, unknown>;
  createdAtUtc: string;
}

export interface AiAssistantToolAuditRecord {
  toolCallId?: string;
  toolName?: string;
  toolStatus?: string;
  resourceLabel?: string;
}

export interface AiAssistantMessageAuditMetadata {
  artifactId?: string;
  artifactType?: string;
  thoughtText?: string;
  toolEvents?: AiAssistantToolAuditRecord[];
  completionState?: AiAssistantTurnCompletionState;
  isFinal?: boolean;
}

export interface TemplatePatchPayload {
  name?: string;
  language?: string;
  templateType?: string;
  promptTemplate?: string;
  toneRules?: string;
  description?: string;
  examples?: string;
  active?: boolean;
}

export interface ProposalCandidatePayload {
  action: 'create' | 'edit' | 'retire' | 'no_impact';
  targetTitle?: string;
  targetLocale?: string;
  confidenceScore?: number;
  rationale?: string;
  rationaleSummary?: string;
  aiNotes?: string;
  sourceHtml?: string;
  proposedHtml?: string;
  metadata?: Record<string, unknown>;
}

export type ProposalPatchScope = 'current' | 'article' | 'batch';

export type ProposalHtmlMutationOccurrence = 'first' | 'last' | 'all';

export type ProposalHtmlMutationOperation =
  | {
      type: 'append_html';
      html: string;
    }
  | {
      type: 'prepend_html';
      html: string;
    }
  | {
      type: 'replace_text';
      target: string;
      replacement: string;
      occurrence?: ProposalHtmlMutationOccurrence;
      expectedCount?: number;
    }
  | {
      type: 'insert_before_text';
      target: string;
      html: string;
      occurrence?: ProposalHtmlMutationOccurrence;
      expectedCount?: number;
    }
  | {
      type: 'insert_after_text';
      target: string;
      html: string;
      occurrence?: ProposalHtmlMutationOccurrence;
      expectedCount?: number;
    }
  | {
      type: 'remove_text';
      target: string;
      occurrence?: ProposalHtmlMutationOccurrence;
      expectedCount?: number;
    };

export type ProposalLineEditOperation =
  | {
      type: 'replace_lines';
      startLine: number;
      endLine: number;
      lines: string[];
      expectedText?: string;
    }
  | {
      type: 'insert_after';
      line: number;
      lines: string[];
      expectedText?: string;
    }
  | {
      type: 'delete_lines';
      startLine: number;
      endLine: number;
      expectedText?: string;
    };

export interface ProposalPatchPayload {
  scope?: ProposalPatchScope;
  targetArticleKey?: string;
  title?: string;
  rationale?: string;
  rationaleSummary?: string;
  aiNotes?: string;
  html?: string;
  htmlMutations?: ProposalHtmlMutationOperation[];
  lineEdits?: ProposalLineEditOperation[];
}

export interface DraftPatchPayload {
  html: string;
}

export type AiAssistantRendererWindowRole = 'main' | 'assistant_detached';

export type AiAssistantDockMode = 'embedded' | 'detached';

export type AiAssistantSurfaceMode = 'closed' | 'launcher' | 'panel';

export type AiAssistantDetachedSurfaceMode = 'launcher' | 'panel';

export type AiAssistantPresentationStateValue =
  | 'embedded_closed'
  | 'embedded_open'
  | 'detached_launcher'
  | 'detached_panel';

export interface AiAssistantEmbeddedLauncherPosition {
  left: number;
  top: number;
}

export interface AiAssistantWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const AI_ASSISTANT_LAUNCHER_BUTTON_SIZE = 48;
export const AI_ASSISTANT_DETACHED_WINDOW_PADDING = 12;
export const AI_ASSISTANT_DETACHED_PANEL_LAUNCHER_GAP = 12;
export const AI_ASSISTANT_DETACHED_PANEL_CONTENT_SIZE = {
  width: 420,
  height: 740
} as const;
export const AI_ASSISTANT_DETACHED_PANEL_MIN_CONTENT_SIZE = {
  width: 380,
  height: 560
} as const;
export const AI_ASSISTANT_DETACHED_LAUNCHER_WINDOW_SIZE = {
  width: AI_ASSISTANT_LAUNCHER_BUTTON_SIZE + AI_ASSISTANT_DETACHED_WINDOW_PADDING * 2,
  height: AI_ASSISTANT_LAUNCHER_BUTTON_SIZE + AI_ASSISTANT_DETACHED_WINDOW_PADDING * 2
} as const;
export const AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE = {
  width: AI_ASSISTANT_DETACHED_PANEL_CONTENT_SIZE.width + AI_ASSISTANT_DETACHED_WINDOW_PADDING * 2,
  height:
    AI_ASSISTANT_DETACHED_PANEL_CONTENT_SIZE.height
    + AI_ASSISTANT_DETACHED_PANEL_LAUNCHER_GAP
    + AI_ASSISTANT_LAUNCHER_BUTTON_SIZE
    + AI_ASSISTANT_DETACHED_WINDOW_PADDING * 2
} as const;
export const AI_ASSISTANT_DETACHED_PANEL_MIN_WINDOW_SIZE = {
  width: AI_ASSISTANT_DETACHED_PANEL_MIN_CONTENT_SIZE.width + AI_ASSISTANT_DETACHED_WINDOW_PADDING * 2,
  height:
    AI_ASSISTANT_DETACHED_PANEL_MIN_CONTENT_SIZE.height
    + AI_ASSISTANT_DETACHED_PANEL_LAUNCHER_GAP
    + AI_ASSISTANT_LAUNCHER_BUTTON_SIZE
    + AI_ASSISTANT_DETACHED_WINDOW_PADDING * 2
} as const;

export interface AiAssistantPresentationPreferences {
  embeddedLauncherPosition?: AiAssistantEmbeddedLauncherPosition;
  detachedLauncherBounds?: AiAssistantWindowBounds;
  detachedPanelBounds?: AiAssistantWindowBounds;
  detachedDisplayId?: number;
  lastDetachedSurfaceMode?: AiAssistantDetachedSurfaceMode;
}

export interface AiAssistantPresentationState extends AiAssistantPresentationPreferences {
  dockMode: AiAssistantDockMode;
  surfaceMode: AiAssistantSurfaceMode;
  state: AiAssistantPresentationStateValue;
  hasUnread: boolean;
  updatedAtUtc: string;
}

export interface AiAssistantScreenPoint {
  x: number;
  y: number;
}

export type AiAssistantPresentationTransition =
  | { type: 'open_embedded_panel' }
  | { type: 'close_embedded_panel' }
  | { type: 'reattach_embedded_open'; reason?: 'drag_reenter' | 'user_request' }
  | {
      type: 'set_embedded_launcher_position';
      position: AiAssistantEmbeddedLauncherPosition;
    }
  | {
      type: 'detach_launcher';
      anchorPoint?: AiAssistantScreenPoint;
    }
  | {
      type: 'detach_panel';
      anchorPoint?: AiAssistantScreenPoint;
    }
  | { type: 'open_detached_panel' }
  | { type: 'collapse_detached_to_launcher' }
  | {
      type: 'reattach_embedded_closed';
      reason?: 'native_window_close' | 'user_request';
    }
  | {
      type: 'update_detached_bounds';
      surfaceMode: AiAssistantDetachedSurfaceMode;
      bounds: AiAssistantWindowBounds;
      displayId?: number;
    }
  | { type: 'mark_read' };

export interface AiAssistantPresentationGetResponse {
  state: AiAssistantPresentationState;
}

export interface AiAssistantPresentationTransitionRequest {
  transition: AiAssistantPresentationTransition;
}

export interface AiAssistantPresentationChangedEvent {
  state: AiAssistantPresentationState;
}

export interface AiAssistantDetachedWindowMoveRequest {
  x: number;
  y: number;
}

export interface AiAssistantDetachedWindowResizeRequest {
  width: number;
  height?: number;
  anchor?: 'bottom_right';
}

export interface AiAssistantContextPublishRequest {
  context?: AiViewContext | null;
  sourceWindowRole: AiAssistantRendererWindowRole;
}

export interface AiAssistantContextGetResponse {
  context?: AiViewContext;
  publishedAtUtc?: string;
  sourceWindowRole?: AiAssistantRendererWindowRole;
}

export interface AiAssistantContextChangedEvent extends AiAssistantContextGetResponse {}

export interface AiArtifactRecord {
  id: string;
  sessionId: string;
  workspaceId: string;
  artifactType: AiArtifactType;
  entityType?: AiSubjectType;
  entityId?: string;
  baseVersionToken?: string;
  status: AiArtifactStatus;
  summary: string;
  payload: unknown;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export type AiAssistantUiAction =
  | { type: 'replace_working_html'; target: 'draft' | 'proposal'; html: string }
  | { type: 'replace_template_form'; payload: TemplatePatchPayload }
  | { type: 'show_proposal_created'; proposalId: string }
  | { type: 'show_stale_warning'; baseVersionToken?: string }
  | { type: 'none' };

export interface AiAssistantContextGetRequest {
  workspaceId: string;
  context: AiViewContext;
}

export interface AiAssistantSessionGetRequest {
  workspaceId: string;
  sessionId?: string;
}

export interface AiAssistantSessionGetResponse {
  workspaceId: string;
  session?: AiSessionRecord;
  messages: AiMessageRecord[];
  artifact?: AiArtifactRecord;
}

export interface AiAssistantSessionListRequest {
  workspaceId: string;
  includeArchived?: boolean;
}

export interface AiAssistantSessionListResponse {
  workspaceId: string;
  activeSessionId?: string;
  sessions: AiSessionRecord[];
}

export type AppNavigationAction =
  | {
      type: 'open_proposal_review';
      proposalId: string;
    }
  | {
      type: 'open_route';
      route: AppRoute;
    }
  | {
      type: 'open_article_explorer';
      familyId: string;
      localeVariantId?: string;
      tab?: 'preview' | 'relations';
    };

export interface AppNavigationDispatchRequest {
  action: AppNavigationAction;
}

export interface AppNavigationEvent {
  action: AppNavigationAction;
  atUtc: string;
}

export interface AiAssistantMessageSendRequest {
  workspaceId: string;
  sessionId?: string;
  context: AiViewContext;
  message: string;
}

export interface AiAssistantTurnResponse {
  workspaceId: string;
  session: AiSessionRecord;
  messages: AiMessageRecord[];
  context: AiViewContext;
  artifact?: AiArtifactRecord;
  uiActions: AiAssistantUiAction[];
}

export type AiAssistantStreamEventKind =
  | 'turn_started'
  | 'response_chunk'
  | 'thought_chunk'
  | 'tool_call'
  | 'tool_update'
  | 'turn_finished'
  | 'turn_error';

export interface AiAssistantStreamEvent {
  workspaceId: string;
  sessionId: string;
  turnId: string;
  kind: AiAssistantStreamEventKind;
  atUtc: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  toolStatus?: string;
  resourceLabel?: string;
  message?: string;
  error?: string;
  messageId?: string;
  artifactId?: string;
}

export interface AiAssistantSessionResetRequest {
  workspaceId: string;
  sessionId: string;
}

export interface AiAssistantSessionCreateRequest {
  workspaceId: string;
  title?: string;
}

export interface AiAssistantSessionOpenRequest {
  workspaceId: string;
  sessionId: string;
}

export interface AiAssistantSessionDeleteRequest {
  workspaceId: string;
  sessionId: string;
}

export interface AiAssistantArtifactDecisionRequest {
  workspaceId: string;
  sessionId: string;
  artifactId: string;
}

export interface AiAssistantArtifactDecisionResponse extends AiAssistantSessionGetResponse {
  uiActions: AiAssistantUiAction[];
  createdProposalId?: string;
}
