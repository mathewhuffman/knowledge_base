import type { AppRoute } from './routes';
export type AiSubjectType = 'workspace' | 'article' | 'draft_branch' | 'proposal' | 'template_pack' | 'pbi_batch';
export type AiWorkingStateKind = 'article_html' | 'proposal_html' | 'template_pack' | 'none';
export type AiArtifactType = 'informational_response' | 'proposal_candidate' | 'proposal_patch' | 'draft_patch' | 'template_patch' | 'navigation_suggestion' | 'clarification_request';
export type AiScopeType = 'global' | 'page' | 'entity';
export type AiSessionStatus = 'idle' | 'running' | 'has_pending_artifact' | 'error';
export type AiArtifactStatus = 'pending' | 'applied' | 'rejected' | 'superseded';
export type AiMessageRole = 'system' | 'user' | 'assistant';
export type AiMessageKind = 'chat' | 'artifact' | 'decision' | 'warning';
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
    route: AppRoute;
    entityType?: AiSubjectType;
    entityId?: string;
    status: AiSessionStatus;
    runtimeSessionId?: string;
    latestArtifactId?: string;
    createdAtUtc: string;
    updatedAtUtc: string;
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
    rationale?: string;
    rationaleSummary?: string;
    aiNotes?: string;
    sourceHtml?: string;
    proposedHtml?: string;
    metadata?: Record<string, unknown>;
}
export interface ProposalPatchPayload {
    title?: string;
    rationale?: string;
    rationaleSummary?: string;
    aiNotes?: string;
    html: string;
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
export type AiAssistantUiAction = {
    type: 'replace_working_html';
    target: 'draft' | 'proposal';
    html: string;
} | {
    type: 'replace_template_form';
    payload: TemplatePatchPayload;
} | {
    type: 'show_proposal_created';
    proposalId: string;
} | {
    type: 'show_stale_warning';
    baseVersionToken?: string;
} | {
    type: 'none';
};
export interface AiAssistantContextGetRequest {
    workspaceId: string;
    context: AiViewContext;
}
export interface AiAssistantSessionGetRequest {
    workspaceId: string;
    route: AppRoute;
    entityType?: AiSubjectType;
    entityId?: string;
}
export interface AiAssistantSessionGetResponse {
    workspaceId: string;
    session?: AiSessionRecord;
    messages: AiMessageRecord[];
    artifact?: AiArtifactRecord;
}
export interface AiAssistantMessageSendRequest {
    workspaceId: string;
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
export interface AiAssistantSessionResetRequest {
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
