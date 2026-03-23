import type { EntityId, TemplatePackRecord } from './batch2';
import type { ProposalDiffPayload } from './batch7';
export declare enum ArticleAiMessageRole {
    SYSTEM = "system",
    USER = "user",
    ASSISTANT = "assistant"
}
export declare enum ArticleAiMessageKind {
    CHAT = "chat",
    EDIT_RESULT = "edit_result",
    DECISION = "decision"
}
export declare enum ArticleAiPresetAction {
    REWRITE_TONE = "rewrite_tone",
    SHORTEN = "shorten",
    EXPAND = "expand",
    RESTRUCTURE = "restructure",
    CONVERT_TO_TROUBLESHOOTING = "convert_to_troubleshooting",
    ALIGN_TO_TEMPLATE = "align_to_template",
    UPDATE_LOCALE = "update_locale",
    INSERT_IMAGE_PLACEHOLDERS = "insert_image_placeholders",
    FREEFORM = "freeform"
}
export declare enum ArticleAiSessionStatus {
    IDLE = "idle",
    RUNNING = "running",
    HAS_PENDING_EDIT = "has_pending_edit"
}
export type ArticleAiTargetType = 'live_article' | 'draft_branch';
export interface ArticleAiPresetDescriptor {
    action: ArticleAiPresetAction;
    label: string;
    description: string;
}
export interface ArticleAiChatMessage {
    id: EntityId;
    sessionId: EntityId;
    role: ArticleAiMessageRole;
    kind: ArticleAiMessageKind;
    content: string;
    presetAction?: ArticleAiPresetAction;
    metadata?: Record<string, unknown>;
    createdAtUtc: string;
}
export interface ArticleAiPendingEdit {
    basedOnRevisionId: EntityId;
    currentHtml: string;
    proposedHtml: string;
    previewHtml: string;
    summary: string;
    rationale?: string;
    diff: ProposalDiffPayload;
    updatedAtUtc: string;
}
export interface ArticleAiSessionRecord {
    id: EntityId;
    workspaceId: EntityId;
    localeVariantId: EntityId;
    branchId?: EntityId;
    targetType: ArticleAiTargetType;
    familyId: EntityId;
    familyTitle: string;
    locale: string;
    currentRevisionId: EntityId;
    currentRevisionNumber: number;
    templatePackId?: EntityId;
    runtimeSessionId?: string;
    status: ArticleAiSessionStatus;
    createdAtUtc: string;
    updatedAtUtc: string;
}
export interface ArticleAiSessionGetRequest {
    workspaceId: EntityId;
    localeVariantId?: EntityId;
    branchId?: EntityId;
}
export interface ArticleAiSessionResponse {
    workspaceId: EntityId;
    session: ArticleAiSessionRecord;
    messages: ArticleAiChatMessage[];
    pendingEdit?: ArticleAiPendingEdit;
    presets: ArticleAiPresetDescriptor[];
    templatePacks: TemplatePackSummary[];
}
export interface ArticleAiSubmitRequest {
    workspaceId: EntityId;
    localeVariantId?: EntityId;
    branchId?: EntityId;
    message: string;
    presetAction?: ArticleAiPresetAction;
    templatePackId?: EntityId;
    targetLocale?: string;
}
export interface ArticleAiSubmitResponse extends ArticleAiSessionResponse {
    acceptedRuntimeSessionId?: string;
}
export interface ArticleAiResetRequest {
    workspaceId: EntityId;
    sessionId: EntityId;
}
export interface ArticleAiDecisionRequest {
    workspaceId: EntityId;
    sessionId: EntityId;
}
export interface ArticleAiDecisionResponse extends ArticleAiSessionResponse {
    acceptedBranchId?: EntityId;
    acceptedRevisionId?: EntityId;
}
export declare enum TemplatePackType {
    STANDARD_HOW_TO = "standard_how_to",
    FAQ = "faq",
    TROUBLESHOOTING = "troubleshooting",
    POLICY_NOTICE = "policy_notice",
    FEATURE_OVERVIEW = "feature_overview"
}
export interface TemplatePackSummary extends TemplatePackRecord {
    templateType: TemplatePackType;
    description?: string;
    analysisSummary?: string;
}
export interface TemplatePackDetail extends TemplatePackSummary {
    analysis?: TemplatePackAnalysis;
}
export interface TemplatePackListRequest {
    workspaceId: EntityId;
    includeInactive?: boolean;
}
export interface TemplatePackListResponse {
    workspaceId: EntityId;
    templates: TemplatePackDetail[];
}
export interface TemplatePackGetRequest {
    workspaceId: EntityId;
    templatePackId: EntityId;
}
export interface TemplatePackUpsertRequest {
    workspaceId: EntityId;
    templatePackId?: EntityId;
    name: string;
    language: string;
    templateType: TemplatePackType;
    promptTemplate: string;
    toneRules: string;
    description?: string;
    examples?: string;
    active?: boolean;
}
export interface TemplatePackDeleteRequest {
    workspaceId: EntityId;
    templatePackId: EntityId;
}
export interface TemplatePackAnalysisSuggestion {
    title: string;
    detail: string;
    priority: 'low' | 'medium' | 'high';
}
export interface TemplatePackAnalysis {
    score: number;
    summary: string;
    strengths: string[];
    gaps: string[];
    suggestions: TemplatePackAnalysisSuggestion[];
    analyzedAtUtc: string;
}
export interface TemplatePackAnalysisRequest {
    workspaceId: EntityId;
    templatePackId: EntityId;
}
