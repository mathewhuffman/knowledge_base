import type { KbAccessMode } from './batch2';
export type AgentSessionType = 'batch_analysis' | 'article_edit';
export type AgentSessionStatus = 'starting' | 'running' | 'idle' | 'closed' | 'error';
export declare enum AgentCommand {
    ANALYSIS_RUN = "agent.analysis.run",
    ARTICLE_EDIT_RUN = "agent.article_edit.run"
}
export interface AgentSessionRecord {
    id: string;
    workspaceId: string;
    kbAccessMode: KbAccessMode;
    type: AgentSessionType;
    status: AgentSessionStatus;
    batchId?: string;
    locale?: string;
    templatePackId?: string;
    scope?: {
        localeVariantIds?: string[];
        familyIds?: string[];
    };
    createdAtUtc: string;
    updatedAtUtc: string;
}
export interface AgentSessionCreateRequest {
    workspaceId: string;
    kbAccessMode?: KbAccessMode;
    type: AgentSessionType;
    batchId?: string;
    locale?: string;
    templatePackId?: string;
    scope?: {
        localeVariantIds?: string[];
        familyIds?: string[];
    };
}
export interface AgentSessionCloseRequest {
    workspaceId: string;
    sessionId: string;
}
export interface AgentSessionListRequest {
    workspaceId: string;
    includeClosed?: boolean;
}
export interface AgentSessionListResponse {
    workspaceId: string;
    sessions: AgentSessionRecord[];
}
export interface AgentSessionGetRequest {
    workspaceId: string;
    sessionId: string;
}
export interface AgentAnalysisRunRequest {
    workspaceId: string;
    batchId: string;
    kbAccessMode?: KbAccessMode;
    locale?: string;
    sessionId?: string;
    sessionType?: AgentSessionType;
    prompt?: string;
    systemPrompt?: string;
    templatePackId?: string;
    localeVariantScope?: string[];
    timeoutMs?: number;
}
export interface AgentArticleEditRunRequest {
    workspaceId: string;
    localeVariantId: string;
    kbAccessMode?: KbAccessMode;
    locale?: string;
    sessionId?: string;
    sessionType?: AgentSessionType;
    prompt?: string;
    timeoutMs?: number;
}
export declare enum CliHealthFailure {
    BINARY_NOT_FOUND = "binary_not_found",
    BINARY_NOT_EXECUTABLE = "binary_not_executable",
    LOOPBACK_NOT_RUNNING = "loopback_not_running",
    LOOPBACK_UNREACHABLE = "loopback_unreachable",
    LOOPBACK_UNHEALTHY = "loopback_unhealthy",
    AUTH_TOKEN_MISSING = "auth_token_missing",
    HEALTH_PROBE_TIMEOUT = "health_probe_timeout",
    HEALTH_PROBE_FAILED = "health_probe_failed",
    HEALTH_PROBE_REJECTED = "health_probe_rejected"
}
export interface KbAccessHealth {
    mode: KbAccessMode;
    provider: KbAccessMode;
    ok: boolean;
    message?: string;
    binaryPath?: string;
    baseUrl?: string;
    acpReachable?: boolean;
    issues?: string[];
    failureCode?: CliHealthFailure;
}
export interface KbAccessProviderDescriptor {
    mode: KbAccessMode;
    label: string;
    description: string;
    available: boolean;
    health: KbAccessHealth;
}
export interface AgentHealthCheckResponse {
    checkedAtUtc: string;
    workspaceId?: string;
    workspaceKbAccessMode?: KbAccessMode;
    selectedMode: KbAccessMode;
    providers: {
        mcp: KbAccessHealth;
        cli: KbAccessHealth;
    };
    issues: string[];
    availableModes: KbAccessMode[];
}
export interface AgentTranscriptRequest {
    workspaceId: string;
    sessionId: string;
    limit?: number;
}
export interface AgentTranscriptLine {
    atUtc: string;
    direction: 'to_agent' | 'from_agent' | 'system';
    event: string;
    payload: string;
}
export interface AgentTranscriptResponse {
    workspaceId: string;
    sessionId: string;
    lines: AgentTranscriptLine[];
}
export interface AgentToolCallAudit {
    workspaceId: string;
    sessionId: string;
    toolName: string;
    args: unknown;
    calledAtUtc: string;
    allowed: boolean;
    reason?: string;
}
export interface AgentRunResult {
    sessionId: string;
    kbAccessMode: KbAccessMode;
    status: 'ok' | 'error' | 'timeout' | 'canceled';
    transcriptPath: string;
    rawOutput: string[];
    resultPayload?: unknown;
    toolCalls: AgentToolCallAudit[];
    startedAtUtc: string;
    endedAtUtc: string;
    durationMs: number;
    message?: string;
}
export interface PersistedAgentAnalysisRun {
    id: string;
    workspaceId: string;
    batchId: string;
    sessionId?: string;
    kbAccessMode?: KbAccessMode;
    status: 'running' | 'complete' | 'failed' | 'canceled';
    startedAtUtc: string;
    endedAtUtc?: string;
    promptTemplate?: string;
    transcriptPath?: string;
    toolCalls: AgentToolCallAudit[];
    rawOutput?: string[];
    resultPayload?: unknown;
    message?: string;
}
export interface PersistedAgentAnalysisRunResponse {
    workspaceId: string;
    batchId: string;
    run: PersistedAgentAnalysisRun | null;
    lines: AgentTranscriptLine[];
}
export interface AgentStreamingPayload {
    sessionId: string;
    kind: 'session_started' | 'progress' | 'tool_call' | 'tool_response' | 'result' | 'warning' | 'error' | 'timeout' | 'canceled';
    data?: unknown;
    message?: string;
    atUtc: string;
}
export interface AgentPromptContextRequest {
    workspaceId: string;
    locale?: string;
    templatePackId?: string;
    prompt?: string;
    batchId?: string;
}
export interface MCPToolInput {
    workspaceId: string;
}
export interface MCPGetArticleInput extends MCPToolInput {
    revisionId?: string;
    localeVariantId?: string;
}
export interface MCPGetArticleFamilyInput extends MCPToolInput {
    familyId: string;
}
export interface MCPGetLocaleVariantInput extends MCPToolInput {
    familyId: string;
}
export interface MCPFindRelatedArticlesInput extends MCPToolInput {
    query?: string;
    articleId?: string;
    familyId?: string;
    batchId?: string;
    locale?: string;
    max?: number;
    minScore?: number;
    includeEvidence?: boolean;
}
export interface MCPListCategoriesInput extends MCPToolInput {
    locale: string;
}
export interface MCPListSectionsInput extends MCPToolInput {
    locale: string;
    categoryId: number;
}
export interface MCPListArticleTemplatesInput extends MCPToolInput {
    locale?: string;
    includeInactive?: boolean;
}
export interface MCPGetTemplateInput extends MCPToolInput {
    templatePackId: string;
}
export interface MCPGetBatchContextInput extends MCPToolInput {
    batchId: string;
}
export interface MCPGetPBIInput extends MCPToolInput {
    pbiId: string;
}
export interface MCPGetPBISubsetInput extends MCPToolInput {
    batchId: string;
    rowNumbers?: number[];
}
export interface MCPGetArticleHistoryInput extends MCPToolInput {
    localeVariantId: string;
}
export interface MCPRecordAgentNotesInput extends MCPToolInput {
    sessionId?: string;
    note: string;
    metadata?: unknown;
    batchId?: string;
    localeVariantId?: string;
    familyId?: string;
    pbiIds?: string[];
    rationale?: string;
}
