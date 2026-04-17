import type { AppRoute } from './routes';

export type AiSubjectType =
  | 'workspace'
  | 'article'
  | 'draft_branch'
  | 'proposal'
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
