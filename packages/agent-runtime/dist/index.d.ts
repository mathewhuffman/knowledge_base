import type { AgentArticleEditRunRequest, AgentAnalysisRunRequest, AgentHealthCheckResponse, AgentSessionCreateRequest, AgentSessionCloseRequest, AgentSessionRecord, AgentStreamingPayload, AgentTranscriptRequest, AgentTranscriptResponse, AgentRunResult, MCPGetArticleFamilyInput, MCPGetArticleInput, MCPGetArticleHistoryInput, MCPGetBatchContextInput, MCPGetLocaleVariantInput, MCPGetPBISubsetInput, MCPGetPBIInput, MCPListArticleTemplatesInput, MCPListCategoriesInput, MCPListSectionsInput, MCPRecordAgentNotesInput, MCPFindRelatedArticlesInput, ExplorerNode } from '@kb-vault/shared-types';
interface ScopedToolContext {
    workspaceId: string;
    allowedLocaleVariantIds?: string[];
    allowedFamilyIds?: string[];
    batchId?: string;
    sessionId?: string;
}
type RuntimeDebugLogger = (message: string, details?: unknown) => void;
export interface AgentRuntimeToolContext {
    searchKb: (input: MCPFindRelatedArticlesInput & {
        workspaceId: string;
    }) => Promise<unknown>;
    getExplorerTree: (workspaceId: string) => Promise<ExplorerNode[]>;
    getArticle: (input: MCPGetArticleInput) => Promise<unknown>;
    getArticleFamily: (input: MCPGetArticleFamilyInput) => Promise<unknown>;
    getLocaleVariant: (input: MCPGetLocaleVariantInput) => Promise<unknown>;
    findRelatedArticles: (input: MCPFindRelatedArticlesInput) => Promise<unknown>;
    listCategories: (input: MCPListCategoriesInput) => Promise<unknown>;
    listSections: (input: MCPListSectionsInput) => Promise<unknown>;
    listArticleTemplates: (input: MCPListArticleTemplatesInput) => Promise<unknown>;
    getTemplate: (input: MCPListArticleTemplatesInput & {
        templatePackId: string;
    }) => Promise<unknown>;
    getBatchContext: (input: MCPGetBatchContextInput) => Promise<unknown>;
    getPBI: (input: MCPGetPBIInput) => Promise<unknown>;
    getPBISubset: (input: MCPGetPBISubsetInput) => Promise<unknown>;
    getArticleHistory: (input: MCPGetArticleHistoryInput) => Promise<unknown>;
    recordAgentNotes: (input: MCPRecordAgentNotesInput) => Promise<unknown>;
    proposeCreateKb: (input: MCPRecordAgentNotesInput, toolContext: ScopedToolContext) => Promise<unknown>;
    proposeEditKb: (input: MCPRecordAgentNotesInput, toolContext: ScopedToolContext) => Promise<unknown>;
    proposeRetireKb: (input: MCPRecordAgentNotesInput, toolContext: ScopedToolContext) => Promise<unknown>;
}
export declare class CursorAcpRuntime {
    private readonly config;
    private readonly sessions;
    private readonly transcripts;
    private readonly toolCallAudit;
    private readonly mcpServer;
    private readonly transport;
    private readonly cursorSessionIds;
    private readonly cursorSessionLookup;
    private readonly activeStreamEmitters;
    private readonly debugLogger;
    private readonly configuredMcpServers;
    private readonly toolContext;
    constructor(workspaceRoot: string, toolContext: AgentRuntimeToolContext, debugLogger?: RuntimeDebugLogger);
    private log;
    getSession(sessionId: string): AgentSessionRecord | null;
    listSessions(workspaceId: string, includeClosed?: boolean): AgentSessionRecord[];
    createSession(input: AgentSessionCreateRequest): AgentSessionRecord;
    closeSession(input: AgentSessionCloseRequest): AgentSessionRecord | null;
    checkHealth(workspaceId: string): Promise<AgentHealthCheckResponse>;
    private ensureAcpSession;
    private buildSessionCreateParams;
    handleMcpJsonMessage(raw: string | Record<string, unknown>): Promise<string | null>;
    runBatchAnalysis(request: AgentAnalysisRunRequest, emit: (payload: AgentStreamingPayload) => Promise<void> | void, isCancelled: () => boolean): Promise<AgentRunResult>;
    runArticleEdit(request: AgentArticleEditRunRequest, emit: (payload: AgentStreamingPayload) => Promise<void> | void, isCancelled: () => boolean): Promise<AgentRunResult>;
    getTranscripts(input: AgentTranscriptRequest): Promise<AgentTranscriptResponse>;
    listToolCallAudit(sessionId: string, workspaceId: string): {
        workspaceId: string;
        sessionId: string;
        toolName: string;
        args: unknown;
        calledAtUtc: string;
        allowed: boolean;
        reason?: string;
    }[];
    stop(): Promise<void>;
    private resolveSession;
    private transit;
    private buildPromptText;
    private executeWithRetry;
    private handleTransportNotification;
    private ensureTranscriptPath;
    private isCursorAvailable;
    private canReachCursor;
    private appendTranscriptLine;
    private registerToolImplementations;
    private getActiveSessionForWorkspace;
    private getScopedContextForSession;
}
export declare class AgentRuntimeService {
    private readonly runtime;
    constructor(workspaceRoot: string, toolContext: AgentRuntimeToolContext);
    getRuntime(): CursorAcpRuntime;
}
export declare const AGENT_RUNTIME_VERSION = "0.1.0";
export { McpToolServer } from '@kb-vault/mcp-server';
