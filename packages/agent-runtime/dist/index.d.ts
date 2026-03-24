import type { AgentArticleEditRunRequest, AgentAnalysisRunRequest, AgentAssistantChatRunRequest, AgentHealthCheckResponse, AgentSessionCreateRequest, AgentSessionCloseRequest, AgentSessionRecord, AgentStreamingPayload, AgentTranscriptRequest, AgentTranscriptResponse, AgentRunResult, KbAccessMode, MCPGetArticleFamilyInput, MCPGetArticleInput, MCPGetArticleHistoryInput, MCPGetBatchContextInput, MCPGetLocaleVariantInput, MCPGetPBISubsetInput, MCPGetPBIInput, MCPListArticleTemplatesInput, MCPListCategoriesInput, MCPListSectionsInput, MCPRecordAgentNotesInput, MCPFindRelatedArticlesInput, ExplorerNode, KbAccessHealth } from '@kb-vault/shared-types';
interface ScopedToolContext {
    workspaceId: string;
    allowedLocaleVariantIds?: string[];
    allowedFamilyIds?: string[];
    batchId?: string;
    sessionId?: string;
}
type RuntimeDebugLogger = (message: string, details?: unknown) => void;
interface KbRuntimeOptions {
    getCliHealth?: (workspaceId?: string) => Promise<KbAccessHealth>;
    buildCliPromptSuffix?: () => string;
}
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
    private readonly transports;
    private readonly cursorSessionIds;
    private readonly cursorSessionLookup;
    private readonly activeStreamEmitters;
    private readonly promptMessageChunks;
    private readonly debugLogger;
    private readonly configuredMcpServers;
    private runtimeMcpServers;
    private readonly toolContext;
    private readonly runtimeOptions;
    constructor(workspaceRoot: string, toolContext: AgentRuntimeToolContext, runtimeOptions?: KbRuntimeOptions, debugLogger?: RuntimeDebugLogger);
    private log;
    getSession(sessionId: string): AgentSessionRecord | null;
    setMcpServerConfigs(configs: ReadonlyArray<Record<string, unknown>>): void;
    listSessions(workspaceId: string, includeClosed?: boolean): AgentSessionRecord[];
    createSession(input: AgentSessionCreateRequest): AgentSessionRecord;
    closeSession(input: AgentSessionCloseRequest): AgentSessionRecord | null;
    checkHealth(workspaceId: string, selectedMode?: KbAccessMode, workspaceKbAccessMode?: KbAccessMode): Promise<AgentHealthCheckResponse>;
    private ensureAcpSession;
    handleMcpJsonMessage(raw: string | Record<string, unknown>): Promise<string | null>;
    runBatchAnalysis(request: AgentAnalysisRunRequest, emit: (payload: AgentStreamingPayload) => Promise<void> | void, isCancelled: () => boolean): Promise<AgentRunResult>;
    runArticleEdit(request: AgentArticleEditRunRequest, emit: (payload: AgentStreamingPayload) => Promise<void> | void, isCancelled: () => boolean): Promise<AgentRunResult>;
    runAssistantChat(request: AgentAssistantChatRunRequest, emit: (payload: AgentStreamingPayload) => Promise<void> | void, isCancelled: () => boolean): Promise<AgentRunResult>;
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
    private consumePromptMessageText;
    private ensureTranscriptPath;
    private resolveBinary;
    private isCursorAvailable;
    private canReachCursor;
    private getTransport;
    private evaluateCliToolPolicy;
    private resolveMcpServerConfigs;
    private getProvider;
    private getProviderHealth;
    private getMcpHealth;
    private getCliHealth;
    private resetCursorSession;
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
