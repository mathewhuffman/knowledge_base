export type AgentSessionType = 'batch_analysis' | 'article_edit';
export type AgentSessionStatus = 'starting' | 'running' | 'idle' | 'closed' | 'error';
export declare enum AgentCommand {
    ANALYSIS_RUN = "agent.analysis.run",
    ARTICLE_EDIT_RUN = "agent.article_edit.run"
}
export interface AgentSessionRecord {
    id: string;
    workspaceId: string;
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
export interface AgentRuntimeOptionsRequest {
    workspaceId: string;
}
export interface AgentRuntimeModelCost {
    inputUsdPerMillion: number;
    cacheWriteUsdPerMillion: number | null;
    cacheReadUsdPerMillion: number | null;
    outputUsdPerMillion: number;
}
export interface AgentRuntimeModelOption {
    id: string;
    provider: string;
    name: string;
    costs: AgentRuntimeModelCost;
}
export interface AgentRuntimeOptionsResponse {
    workspaceId: string;
    currentModelId?: string;
    availableModels?: string[];
    currentModeId?: string;
    availableModes?: string[];
    modelCatalog?: AgentRuntimeModelOption[];
    configOptions?: unknown;
}
export interface AgentAnalysisRunRequest {
    workspaceId: string;
    batchId: string;
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
    locale?: string;
    sessionId?: string;
    sessionType?: AgentSessionType;
    prompt?: string;
    timeoutMs?: number;
}
export interface AgentHealthCheckResponse {
    checkedAtUtc: string;
    cursorInstalled: boolean;
    acpReachable: boolean;
    mcpRunning: boolean;
    requiredConfigPresent: boolean;
    cursorBinaryPath?: string;
    issues: string[];
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
    status: 'ok' | 'error' | 'timeout' | 'canceled';
    transcriptPath: string;
    rawOutput: string[];
    toolCalls: AgentToolCallAudit[];
    startedAtUtc: string;
    endedAtUtc: string;
    durationMs: number;
    message?: string;
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
    query: string;
    locale?: string;
    max?: number;
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
