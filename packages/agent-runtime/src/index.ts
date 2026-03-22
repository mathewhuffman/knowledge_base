import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, unlink } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ChildProcess, spawn } from 'node:child_process';
import { McpToolServer } from '@kb-vault/mcp-server';
import type {
  AgentArticleEditRunRequest,
  AgentAnalysisRunRequest,
  AgentHealthCheckResponse,
  AgentSessionCreateRequest,
  AgentSessionListRequest,
  AgentSessionGetRequest,
  AgentSessionCloseRequest,
  AgentSessionRecord,
  AgentSessionStatus,
  AgentStreamingPayload,
  AgentTranscriptLine,
  AgentTranscriptRequest,
  AgentTranscriptResponse,
  AgentRuntimeOptionsResponse,
  AgentRunResult,
  MCPGetArticleFamilyInput,
  MCPGetArticleInput,
  MCPGetArticleHistoryInput,
  MCPGetBatchContextInput,
  MCPGetLocaleVariantInput,
  MCPGetPBISubsetInput,
  MCPGetPBIInput,
  MCPListArticleTemplatesInput,
  MCPListCategoriesInput,
  MCPListSectionsInput,
  MCPGetTemplateInput,
  MCPRecordAgentNotesInput,
  MCPFindRelatedArticlesInput,
  ExplorerNode
} from '@kb-vault/shared-types';

interface JsonRpcEnvelope {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: unknown;
}

interface JsonRpcResult {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    message: string;
  };
}

interface JsonRpcResponseMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: unknown;
}

interface PendingRequest {
  method: string;
  watchedSessionId?: string;
  timeoutMs: number;
  resolve: (value: JsonRpcResult) => void;
  reject: (err: Error) => void;
  timer?: NodeJS.Timeout;
}

type TranscriptAppender = (line: Omit<AgentTranscriptLine, 'atUtc'>) => Promise<void>;

interface AcpRuntimeConfig {
  workspaceRoot: string;
  acpCwd: string;
  cursorBinary: string;
  cursorArgs: string[];
  requestTimeoutMs: number;
}

type AgentRuntimeMode = 'mcp_only' | 'app_runtime';

interface AppRuntimeToolCallEnvelope {
  type: 'tool_call';
  tool: string;
  input?: Record<string, unknown>;
}

interface AppRuntimeFinalEnvelope {
  type: 'final';
  content: string;
}

type AppRuntimeEnvelope = AppRuntimeToolCallEnvelope | AppRuntimeFinalEnvelope;

interface RuntimeSessionConfig {
  agentModelId?: string;
  agentReasoning?: string;
  agentThinking?: string;
  appRuntime?: boolean;
}

interface ScopedToolContext {
  workspaceId: string;
  allowedLocaleVariantIds?: string[];
  allowedFamilyIds?: string[];
  batchId?: string;
  sessionId?: string;
}

type MCPToolHandler = (input: unknown, context: ScopedToolContext, log: TranscriptAppender) => Promise<unknown>;

interface MCPToolImplementation {
  description: string;
  handler: MCPToolHandler;
  requiresScope?: true;
}

type RuntimeDebugLogger = (message: string, details?: unknown) => void;
type AcpMcpServerConfig = Record<string, unknown>;

function buildTaskPrompt(
  session: AgentSessionRecord,
  taskPayload: Record<string, unknown>,
  extras?: {
    batchContext?: unknown;
    uploadedPbis?: unknown;
    articleDirectory?: string;
    runtimeMode?: AgentRuntimeMode;
  }
): string {
  const batchId = typeof taskPayload.batchId === 'string' ? taskPayload.batchId : session.batchId ?? '';
  const locale = typeof taskPayload.locale === 'string' ? taskPayload.locale : session.locale ?? 'default';
  const explicitPrompt = typeof taskPayload.prompt === 'string' ? taskPayload.prompt.trim() : '';
  const runtimeMode = extras?.runtimeMode ?? 'mcp_only';
  const mcpGuidance = [
    'KB Vault MCP guidance:',
    '- Use only these exact KB Vault MCP tool names when needed: get_batch_context, get_pbi_subset, get_pbi, get_article, get_article_family, get_locale_variant, get_article_history, find_related_articles, search_kb, list_article_templates, get_template, propose_create_kb, propose_edit_kb, propose_retire_kb, record_agent_notes.',
    '- list_mcp_resources may return empty even when KB Vault MCP tools are available. KB Vault may expose tools without exposing MCP resources.',
    '- Do NOT conclude KB Vault MCP is unavailable just because list_mcp_resources returns no resources.',
    '- Do not use list_mcp_resources as the availability check for KB Vault. Call KB Vault tools directly.',
    '- To inspect the imported batch, call get_batch_context first.',
    '- To read the uploaded PBI rows, call get_pbi_subset for the batch or get_pbi for a single record.',
    '- To read KB article contents, use get_article with a localeVariantId or revisionId from the article directory listing below.',
    '- To understand an article family before reading content, use get_article_family and get_locale_variant.',
    '- If you need KB evidence, prefer direct KB tool calls over reasoning from the preloaded prompt context alone.',
    '- Do not invent alternate tool names. If a tool name is not listed above, assume it is unavailable.'
  ].join('\n');
  const extraSections = [
    extras?.batchContext !== undefined ? `Preloaded batch context summary:\n${summarizeBatchContext(extras.batchContext)}` : '',
    extras?.uploadedPbis !== undefined ? `Preloaded uploaded PBI JSON:\n${JSON.stringify(extras.uploadedPbis, null, 2)}` : '',
    extras?.articleDirectory ? `KB article directory and file-style index:\n${extras.articleDirectory}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');

  if (taskPayload.task === 'analyze_batch') {
    if (runtimeMode === 'app_runtime') {
      return [
        'You are running inside KB Vault App Runtime for one imported PBI batch.',
        `Workspace ID: ${session.workspaceId}`,
        `Batch ID: ${batchId}`,
        `Locale: ${locale}`,
        '',
        'Batch context and uploaded PBI rows are already loaded below.',
        'Do not call get_batch_context unless the user explicitly says the batch changed.',
        'Do not output analysis, planning, or commentary before your JSON response.',
        'Your first response must be exactly one JSON object.',
        'If you need more evidence, request exactly one tool.',
        'If the preloaded evidence is already sufficient, return final immediately.',
        '',
        'Allowed tool names: get_pbi_subset, get_pbi, get_article, get_article_family, get_locale_variant, get_article_history, find_related_articles, search_kb, list_article_templates, get_template, record_agent_notes, propose_create_kb, propose_edit_kb, propose_retire_kb.',
        'Allowed response shapes only:',
        '  {"type":"tool_call","tool":"get_article","input":{"localeVariantId":"..."}}',
        '  {"type":"tool_call","tool":"search_kb","input":{"query":"..."}}',
        '  {"type":"tool_call","tool":"get_pbi_subset","input":{"batchId":"..."}}',
        '  {"type":"final","content":"..."}',
        'Reply with JSON only.',
        'Do not wrap JSON in markdown fences.',
        'Do not explain your choice.',
        '',
        explicitPrompt ? `Additional instructions: ${explicitPrompt}` : '',
        '',
        extraSections,
        '',
        'Session context JSON:',
        JSON.stringify({ session, task: taskPayload })
      ].filter(Boolean).join('\n');
    }

    return [
      'You are running inside KB Vault to analyze one imported PBI batch.',
      `Workspace ID: ${session.workspaceId}`,
      `Batch ID: ${batchId}`,
      `Locale: ${locale}`,
      '',
      'Your job:',
      '1. Load the batch context and relevant PBI records for this batch.',
      '2. Review the existing KB/article context for the affected topics.',
      '3. Produce KB-focused analysis outcomes for the batch.',
      '4. If the batch is already analyzed, summarize the existing analysis state instead of redoing generic exploration.',
      '',
      'Tool rules:',
      '- Use KB Vault tools and structured batch/article data only.',
      '- Do NOT use generic terminal, grep, codebase search, find, or filesystem exploration unless the user explicitly asked for that.',
      '- Do NOT inspect the repository or sqlite schema to infer application behavior.',
      '- Prefer returning a concise analysis/summary over exploratory investigation.',
      '- The preloaded prompt context is for orientation; use KB Vault MCP tools directly when you need to confirm or inspect source records.',
      '',
      mcpGuidance,
      '',
      explicitPrompt ? `Additional instructions: ${explicitPrompt}` : '',
      '',
      extraSections,
      '',
      'Session context JSON:',
      JSON.stringify({ session, task: taskPayload })
    ].filter(Boolean).join('\n');
  }

  if (taskPayload.task === 'edit_article') {
    return [
      'You are running inside KB Vault to edit one article revision.',
      `Workspace ID: ${session.workspaceId}`,
      `Locale: ${locale}`,
      '',
      'Tool rules:',
      '- Use KB Vault tools and structured article/template data only.',
      '- Do NOT use terminal, grep, codebase search, find, or filesystem exploration unless explicitly requested.',
      runtimeMode === 'app_runtime'
        ? '- You are in App Runtime mode. KB Vault has an active harness for approved KB tool requests. When you emit a valid tool_call JSON object, KB Vault will execute it, return the result, and continue the lifecycle with you. If a tool request is unrecognized or fails, KB Vault will return that outcome and re-engage you so you can decide the next step. Do not discuss tool availability or missing MCP tools.'
        : '- The preloaded prompt context is for orientation; use KB Vault MCP tools directly when you need to confirm or inspect source records.',
      '',
      runtimeMode === 'mcp_only'
        ? mcpGuidance
        : 'App Runtime guidance:\n- Reply with JSON only.\n- Use {"type":"tool_call",...} to request KB Vault data or {"type":"final","content":"..."} to finish.\n- The KB Vault harness is active in this session. Valid tool_call requests will be executed and their results will be returned to you.\n- If a tool_call is unrecognized or execution fails, KB Vault will return that outcome and re-engage you so you can choose the next step.\n- Do not mention missing tools or speculate about tool exposure.',
      '',
      explicitPrompt ? `Additional instructions: ${explicitPrompt}` : '',
      '',
      extraSections,
      '',
      'Session context JSON:',
      JSON.stringify({ session, task: taskPayload })
    ].filter(Boolean).join('\n');
  }

  return JSON.stringify({ session, task: taskPayload });
}

export interface AgentRuntimeToolContext {
  searchKb: (input: MCPFindRelatedArticlesInput & { workspaceId: string }) => Promise<unknown>;
  getExplorerTree: (workspaceId: string) => Promise<ExplorerNode[]>;
  getArticle: (input: MCPGetArticleInput) => Promise<unknown>;
  getArticleFamily: (input: MCPGetArticleFamilyInput) => Promise<unknown>;
  getLocaleVariant: (input: MCPGetLocaleVariantInput) => Promise<unknown>;
  findRelatedArticles: (input: MCPFindRelatedArticlesInput) => Promise<unknown>;
  listCategories: (input: MCPListCategoriesInput) => Promise<unknown>;
  listSections: (input: MCPListSectionsInput) => Promise<unknown>;
  listArticleTemplates: (input: MCPListArticleTemplatesInput) => Promise<unknown>;
  getTemplate: (input: MCPListArticleTemplatesInput & { templatePackId: string }) => Promise<unknown>;
  getBatchContext: (input: MCPGetBatchContextInput) => Promise<unknown>;
  getPBI: (input: MCPGetPBIInput) => Promise<unknown>;
  getPBISubset: (input: MCPGetPBISubsetInput) => Promise<unknown>;
  getArticleHistory: (input: MCPGetArticleHistoryInput) => Promise<unknown>;
  recordAgentNotes: (input: MCPRecordAgentNotesInput) => Promise<unknown>;
  proposeCreateKb: (input: MCPRecordAgentNotesInput, toolContext: ScopedToolContext) => Promise<unknown>;
  proposeEditKb: (input: MCPRecordAgentNotesInput, toolContext: ScopedToolContext) => Promise<unknown>;
  proposeRetireKb: (input: MCPRecordAgentNotesInput, toolContext: ScopedToolContext) => Promise<unknown>;
}

const DEFAULT_TRANSCRIPT_DIR = '.meta/agent-transcripts';
const DEFAULT_CURSOR_BINARY = process.env.KBV_CURSOR_BINARY ?? 'agent';
const DEFAULT_CURSOR_ARGS = ['acp'];

function loadConfiguredMcpServers(): AcpMcpServerConfig[] {
  const raw = process.env.KBV_MCP_TOOLS?.trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is AcpMcpServerConfig => Boolean(entry) && typeof entry === 'object');
    }
    if (parsed && typeof parsed === 'object') {
      return [parsed as AcpMcpServerConfig];
    }
  } catch {
    return [];
  }

  return [];
}

function buildBridgeMcpServerConfig(): AcpMcpServerConfig[] {
  const socketPath = process.env.KBV_MCP_BRIDGE_SOCKET_PATH?.trim();
  const bridgeScript = process.env.KBV_MCP_BRIDGE_SCRIPT?.trim();
  const nodeBinary = process.env.KBV_NODE_BINARY?.trim() || 'node';

  if (!socketPath || !bridgeScript) {
    return [];
  }

  return [
    {
      type: 'stdio',
      name: 'kb-vault',
      command: nodeBinary,
      args: [bridgeScript],
      env: [
        {
          name: 'KBV_MCP_BRIDGE_SOCKET_PATH',
          value: socketPath
        }
      ]
    }
  ];
}

class CursorTransport {
  private proc: ChildProcess | null = null;
  private connected = false;
  private initialized = false;
  private nextRequestId = 0;
  private pending = new Map<string, PendingRequest>();
  private buffer = '';

  constructor(
    private readonly binary: string,
    private readonly args: string[],
    private readonly cwd: string,
    private readonly logger: (sessionId: string, line: Omit<AgentTranscriptLine, 'atUtc'>) => void,
    private readonly notificationHandler?: (message: JsonRpcResponseMessage) => void
  ) {}

  async startIfNeeded(): Promise<void> {
    if (this.connected) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(this.binary, this.args, {
        cwd: this.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env
      });
      this.proc = proc;

      proc.stdout?.on('data', (chunk: Buffer | string) => {
        this.buffer += chunk.toString('utf8');
        this.logger('system', { direction: 'from_agent', event: 'stdout', payload: chunk.toString('utf8') });
        this.flushBuffer();
      });
      proc.stderr?.on('data', (chunk: Buffer | string) => {
        this.logger('system', { direction: 'from_agent', event: 'stderr', payload: chunk.toString('utf8') });
      });
      proc.on('error', (error: Error) => {
        this.logger('system', { direction: 'system', event: 'transport_error', payload: String(error?.message ?? error) });
        this.rejectAllPending(new Error(`Cursor process error: ${error}`));
        this.connected = false;
        reject(error);
      });
      proc.on('close', () => {
        this.logger('system', { direction: 'system', event: 'transport_closed', payload: 'cursor process closed' });
        this.connected = false;
        this.initialized = false;
      });

      this.connected = true;
      proc.stdin?.write(`\n`);
      resolve();
    });
  }

  async stop(): Promise<void> {
    if (!this.proc) {
      return;
    }
    this.proc.kill();
    this.proc = null;
    this.connected = false;
    this.initialized = false;
  }

  async request(
    method: string,
    params: unknown,
    timeoutMs: number,
    sessionId?: string
  ): Promise<JsonRpcResult> {
    const logSessionId = sessionId?.trim() || 'system';
    await this.startIfNeeded();
    const id = `${Date.now()}-${this.nextRequestId++}`;
    const envelope: JsonRpcEnvelope = { jsonrpc: '2.0', id, method, params };
    this.logger(logSessionId, { direction: 'to_agent', event: 'request', payload: JSON.stringify(envelope) });
    return new Promise<JsonRpcResult>((resolve: (value: JsonRpcResult) => void, reject: (reason?: Error) => void) => {
      const watchedSessionId =
        method === 'session/prompt' && params && typeof params === 'object' && 'sessionId' in params
          ? String((params as { sessionId?: string }).sessionId ?? '')
          : undefined;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP request timeout (${method})`));
      }, timeoutMs);

      const pendingRequest: PendingRequest = {
        method,
        watchedSessionId,
        timeoutMs,
        resolve: (result: JsonRpcResult) => {
          if (pendingRequest.timer) {
            clearTimeout(pendingRequest.timer);
          }
          this.logger(logSessionId, { direction: 'from_agent', event: 'response', payload: JSON.stringify(result) });
          resolve(result);
        },
        reject: (error) => {
          if (pendingRequest.timer) {
            clearTimeout(pendingRequest.timer);
          }
          reject(error);
        },
        timer
      };

      this.pending.set(id, pendingRequest);

      if (!this.proc?.stdin) {
        reject(new Error('Cursor stdin unavailable'));
        return;
      }
      this.proc.stdin.write(`${JSON.stringify(envelope)}\n`);
    });
  }

  async ensureInitialized(timeoutMs: number): Promise<boolean> {
    if (this.initialized) {
      return true;
    }
    const init = await this.request(
      'initialize',
      {
        protocolVersion: 1,
        clientInfo: {
          name: 'kb-vault',
          version: '0.1.0'
        },
        clientCapabilities: {
          fs: {
            readTextFile: false,
            writeTextFile: false
          },
          terminal: false
        }
      },
      timeoutMs
    );
    if (init.error) {
      return false;
    }
    const auth = await this.request('authenticate', { methodId: 'cursor_login' }, timeoutMs);
    if (auth.error) {
      this.logger('system', {
        direction: 'system',
        event: 'auth_optional_skipped',
        payload: JSON.stringify(auth.error)
      });
    }
    this.initialized = true;
    return true;
  }

  private respond(id: string | number, result: unknown): void {
    if (!this.proc?.stdin) {
      return;
    }
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
    this.logger('system', { direction: 'to_agent', event: 'response', payload: JSON.stringify({ id, result }) });
  }

  private handleNotification(message: JsonRpcResponseMessage): void {
    if (message.method === 'session/request_permission' && message.id !== undefined) {
      this.respond(message.id, { outcome: { outcome: 'selected', optionId: 'allow-once' } });
      return;
    }
    if (message.method === 'session/update' && message.params) {
      this.logger('system', { direction: 'from_agent', event: 'session_update', payload: JSON.stringify(message.params) });
      this.bumpPromptTimeouts(message.params);
    }
    this.notificationHandler?.(message);
  }

  private bumpPromptTimeouts(params: unknown): void {
    const sessionId =
      params && typeof params === 'object' && 'sessionId' in params
        ? String((params as { sessionId?: string }).sessionId ?? '')
        : '';
    if (!sessionId) {
      return;
    }

    for (const [requestId, pending] of this.pending.entries()) {
      if (pending.method !== 'session/prompt' || pending.watchedSessionId !== sessionId) {
        continue;
      }
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.timer = setTimeout(() => {
        this.pending.delete(requestId);
        pending.reject(new Error(`ACP request timeout (${pending.method})`));
      }, pending.timeoutMs);
    }
  }

  private flushBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines.map((entry) => entry.trim()).filter(Boolean)) {
      try {
        const parsed = JSON.parse(line) as JsonRpcResult & JsonRpcResponseMessage;
        if (typeof parsed.method === 'string') {
          this.handleNotification(parsed);
          continue;
        }
        if (parsed.id === undefined) {
          continue;
        }
        const requestId = String(parsed.id);
        const pending = this.pending.get(requestId);
        if (!pending) {
          continue;
        }
        this.pending.delete(requestId);
        if ('error' in parsed && parsed.error) {
          pending.resolve({ ...parsed, error: parsed.error });
        } else {
          pending.resolve(parsed);
        }
      } catch {
        // Ignore malformed lines; Cursor can emit non-json noise.
      }
    }
  }

  private rejectAllPending(error: Error) {
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }
}

export class CursorAcpRuntime {
  private readonly config: AcpRuntimeConfig;
  private readonly sessions = new Map<string, AgentSessionRecord>();
  private readonly transcripts = new Map<string, string>();
  private readonly toolCallAudit: Array<{
    workspaceId: string;
    sessionId: string;
    toolName: string;
    args: unknown;
    calledAtUtc: string;
    allowed: boolean;
    reason?: string;
  }> = [];
  private readonly mcpServer: McpToolServer;
  private readonly transport: CursorTransport;
  private readonly cursorSessionIds = new Map<string, string>();
  private readonly cursorSessionLookup = new Map<string, string>();
  private readonly activeStreamEmitters = new Map<string, (payload: Omit<AgentStreamingPayload, 'sessionId' | 'atUtc'>) => void>();
  private readonly sessionMessageBuffers = new Map<string, string>();
  private readonly appRuntimeSessions = new Set<string>();
  private readonly appRuntimeNativeToolUsage = new Map<string, string[]>();
  private readonly debugLogger: RuntimeDebugLogger;
  private readonly configuredMcpServers: AcpMcpServerConfig[];
  private readonly toolContext: AgentRuntimeToolContext;

  constructor(workspaceRoot: string, toolContext: AgentRuntimeToolContext, debugLogger?: RuntimeDebugLogger) {
    const acpCwd = process.env.KBV_ACP_CWD?.trim() || process.cwd();
    this.config = {
      workspaceRoot,
      acpCwd,
      cursorBinary: DEFAULT_CURSOR_BINARY,
      cursorArgs: DEFAULT_CURSOR_ARGS,
      requestTimeoutMs: 45_000
    };
    this.mcpServer = new McpToolServer();
    this.toolContext = toolContext;
    this.debugLogger = debugLogger ?? (() => undefined);
    this.configuredMcpServers = loadConfiguredMcpServers();
    this.transport = new CursorTransport(
      this.config.cursorBinary,
      this.config.cursorArgs,
      this.config.acpCwd,
      (sessionId, line) => {
        const targetSessionId = sessionId?.trim() || 'system';
        void this.appendTranscriptLine(targetSessionId, line.direction, line.event, line.payload);
      },
      (message) => {
        void this.handleTransportNotification(message);
      }
    );
    this.registerToolImplementations(this.mcpServer, toolContext);
  }

  private log(message: string, details?: unknown): void {
    this.debugLogger(message, details);
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  listSessions(workspaceId: string, includeClosed = false): AgentSessionRecord[] {
    return Array.from(this.sessions.values()).filter((session) => {
      if (session.workspaceId !== workspaceId) {
        return false;
      }
      return includeClosed || session.status !== 'closed';
    });
  }

  createSession(input: AgentSessionCreateRequest): AgentSessionRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    const session: AgentSessionRecord = {
      id,
      workspaceId: input.workspaceId,
      type: input.type,
      status: 'idle',
      batchId: input.batchId,
      locale: input.locale,
      templatePackId: input.templatePackId,
      scope: input.scope,
      createdAtUtc: now,
      updatedAtUtc: now
    };
    this.sessions.set(id, session);
    return session;
  }

  closeSession(input: AgentSessionCloseRequest): AgentSessionRecord | null {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.workspaceId !== input.workspaceId) {
      return null;
    }
    session.status = 'closed';
    session.updatedAtUtc = new Date().toISOString();
    return session;
  }

  async checkHealth(workspaceId: string): Promise<AgentHealthCheckResponse> {
    const issues: string[] = [];
    const cursorInstalled = this.isCursorAvailable();
    let acpReachable = false;
    let mcpRunning = false;
    if (cursorInstalled) {
      acpReachable = await this.canReachCursor();
      if (!acpReachable) {
        issues.push('Cursor ACP command did not initialize');
      }
    } else {
      issues.push('Cursor binary not found');
    }

    mcpRunning = this.mcpServer.toolCount() > 0;
    const requiredConfigPresent = Boolean(process.env.KBV_CURSOR_BINARY || process.env.KBV_MCP_TOOLS);

    return {
      checkedAtUtc: new Date().toISOString(),
      cursorInstalled,
      acpReachable,
      mcpRunning,
      requiredConfigPresent,
      cursorBinaryPath: cursorInstalled ? this.config.cursorBinary : undefined,
      issues
    };
  }

  private async ensureAcpSession(sessionId: string, _sessionConfig?: RuntimeSessionConfig): Promise<string> {
    const existing = this.cursorSessionIds.get(sessionId);
    if (existing) {
      return existing;
    }
    this.log('agent.runtime.session_new_start', { sessionId });
    const response = await this.transport.request(
      'session/new',
      this.buildSessionCreateParams(),
      this.config.requestTimeoutMs,
      sessionId
    );
    if (response.error) {
      throw new Error(response.error.message);
    }
    const result = response.result as { sessionId?: string } | undefined;
    if (!result?.sessionId) {
      throw new Error('Cursor ACP did not return a sessionId');
    }
    this.log('agent.runtime.session_new_success', { sessionId, acpSessionId: result.sessionId });
    this.cursorSessionIds.set(sessionId, result.sessionId);
    this.cursorSessionLookup.set(result.sessionId, sessionId);
    return result.sessionId;
  }

  private buildSessionCreateParams(sessionConfig?: RuntimeSessionConfig): { cwd: string; mcpServers?: AcpMcpServerConfig[]; config: { mode: 'agent' | 'ask' } } {
    const isAppRuntime = sessionConfig?.appRuntime === true;
    const mcpServers = isAppRuntime
      ? []
      : this.configuredMcpServers.length > 0
        ? this.configuredMcpServers
        : buildBridgeMcpServerConfig();
    return {
      cwd: this.config.acpCwd,
      ...(mcpServers.length > 0 ? { mcpServers } : {}),
      config: {
        mode: isAppRuntime ? 'ask' : 'agent'
      }
    };
  }

  async getRuntimeOptions(workspaceId: string): Promise<AgentRuntimeOptionsResponse> {
    const response = await this.transport.request(
      'session/new',
      this.buildSessionCreateParams(),
      this.config.requestTimeoutMs,
      `runtime-options:${workspaceId}`
    );
    if (response.error) {
      throw new Error(response.error.message);
    }

    const result = response.result as {
      sessionId?: string;
      currentModelId?: string;
      availableModels?: string[];
      currentModeId?: string;
      availableModes?: string[];
      configOptions?: unknown;
    };

    if (result?.sessionId) {
      try {
        await this.transport.request(
          'session/close',
          { sessionId: result.sessionId },
          this.config.requestTimeoutMs,
          `runtime-options:${workspaceId}`
        );
      } catch {
        // Ignore best-effort close errors for runtime option probe.
      }
    }

    return {
      workspaceId,
      currentModelId: typeof result?.currentModelId === 'string' ? result.currentModelId : undefined,
      availableModels: Array.isArray(result?.availableModels) ? result.availableModels.filter((value) => typeof value === 'string') : undefined,
      currentModeId: typeof result?.currentModeId === 'string' ? result.currentModeId : undefined,
      availableModes: Array.isArray(result?.availableModes) ? result.availableModes.filter((value) => typeof value === 'string') : undefined,
      configOptions: result?.configOptions
    };
  }

  async handleMcpJsonMessage(raw: string | Record<string, unknown>): Promise<string | null> {
    return this.mcpServer.handleJsonMessage(raw);
  }

  async runBatchAnalysis(
    request: AgentAnalysisRunRequest,
    emit: (payload: AgentStreamingPayload) => Promise<void> | void,
    isCancelled: () => boolean,
    runtimeMode: AgentRuntimeMode = 'mcp_only',
    runtimeConfig?: RuntimeSessionConfig
  ): Promise<AgentRunResult> {
    const session = await this.resolveSession(request);
    const startedAt = new Date().toISOString();
    const runId = randomUUID();
    const transcriptPath = await this.ensureTranscriptPath(session.id, runId);
    const toolCalls: AgentRunResult['toolCalls'] = [];
    const rawOutput: string[] = [];
    this.log('agent.runtime.batch_analysis_begin', {
      workspaceId: request.workspaceId,
      batchId: request.batchId,
      runtimeMode,
      locale: request.locale,
      timeoutMs: request.timeoutMs ?? this.config.requestTimeoutMs
    });

    try {
      if (runtimeMode === 'app_runtime') {
        await this.runAppRuntimeBatchAnalysis(
          session,
          request,
          (event) => {
            rawOutput.push(event.message ?? JSON.stringify(event.data ?? {}));
            emit({ sessionId: session.id, kind: event.kind, data: event.data, message: event.message, atUtc: new Date().toISOString() });
          },
          toolCalls,
          isCancelled,
          request.timeoutMs ?? this.config.requestTimeoutMs,
          runtimeConfig
        );
      } else {
        await this.transit(
          session,
          {
            task: 'analyze_batch',
            batchId: request.batchId,
            prompt: request.prompt,
            locale: request.locale,
            templatePackId: request.templatePackId,
            runtimeMode
          },
          runtimeConfig,
          (event) => {
            rawOutput.push(event.message ?? JSON.stringify(event.data ?? {}));
            emit({ sessionId: session.id, kind: event.kind, data: event.data, message: event.message, atUtc: new Date().toISOString() });
          },
          toolCalls,
          isCancelled,
          request.timeoutMs ?? this.config.requestTimeoutMs
        );
      }
      const endedAt = new Date().toISOString();
      return {
        sessionId: session.id,
        status: isCancelled() ? 'canceled' : 'ok',
        transcriptPath,
        rawOutput,
        toolCalls,
        startedAtUtc: startedAt,
        endedAtUtc: endedAt,
        durationMs: Date.parse(endedAt) - Date.parse(startedAt),
        message: isCancelled() ? 'Run cancelled' : 'Completed'
      };
    } catch (error) {
      this.log('agent.runtime.batch_analysis_failed', {
        workspaceId: request.workspaceId,
        batchId: request.batchId,
        error: error instanceof Error ? error.message : String(error)
      });
      const endedAt = new Date().toISOString();
      return {
        sessionId: session.id,
        status: 'error',
        transcriptPath,
        rawOutput,
        toolCalls,
        startedAtUtc: startedAt,
        endedAtUtc: endedAt,
        durationMs: Date.parse(endedAt) - Date.parse(startedAt),
        message: error instanceof Error ? error.message : String(error)
      };
    } finally {
      session.updatedAtUtc = new Date().toISOString();
      session.status = 'idle';
      this.log('agent.runtime.batch_analysis_complete', {
        workspaceId: request.workspaceId,
        batchId: request.batchId,
        sessionId: session.id
      });
    }
  }

  async runArticleEdit(
    request: AgentArticleEditRunRequest,
    emit: (payload: AgentStreamingPayload) => Promise<void> | void,
    isCancelled: () => boolean,
    runtimeMode: AgentRuntimeMode = 'mcp_only',
    runtimeConfig?: RuntimeSessionConfig
  ): Promise<AgentRunResult> {
    const session = await this.resolveSession(request);
    const startedAt = new Date().toISOString();
    const runId = randomUUID();
    const transcriptPath = await this.ensureTranscriptPath(session.id, runId);
    const toolCalls: AgentRunResult['toolCalls'] = [];
    const rawOutput: string[] = [];
    this.log('agent.runtime.article_edit_begin', {
      workspaceId: request.workspaceId,
      localeVariantId: request.localeVariantId,
      timeoutMs: request.timeoutMs ?? this.config.requestTimeoutMs
    });

    try {
      await this.transit(
        session,
        {
          task: 'edit_article',
          localeVariantId: request.localeVariantId,
          prompt: request.prompt,
          locale: request.locale,
          runtimeMode
        },
        runtimeConfig,
        (event) => {
          rawOutput.push(event.message ?? JSON.stringify(event.data ?? {}));
          emit({ sessionId: session.id, kind: event.kind, data: event.data, message: event.message, atUtc: new Date().toISOString() });
        },
        toolCalls,
        isCancelled,
        request.timeoutMs ?? this.config.requestTimeoutMs
      );
      const endedAt = new Date().toISOString();
      return {
        sessionId: session.id,
        status: isCancelled() ? 'canceled' : 'ok',
        transcriptPath,
        rawOutput,
        toolCalls,
        startedAtUtc: startedAt,
        endedAtUtc: endedAt,
        durationMs: Date.parse(endedAt) - Date.parse(startedAt),
        message: isCancelled() ? 'Run cancelled' : 'Completed'
      };
    } catch (error) {
      this.log('agent.runtime.article_edit_failed', {
        workspaceId: request.workspaceId,
        localeVariantId: request.localeVariantId,
        error: error instanceof Error ? error.message : String(error)
      });
      const endedAt = new Date().toISOString();
      return {
        sessionId: session.id,
        status: 'error',
        transcriptPath,
        rawOutput,
        toolCalls,
        startedAtUtc: startedAt,
        endedAtUtc: endedAt,
        durationMs: Date.parse(endedAt) - Date.parse(startedAt),
        message: error instanceof Error ? error.message : String(error)
      };
    } finally {
      session.status = 'idle';
      session.updatedAtUtc = new Date().toISOString();
      this.log('agent.runtime.article_edit_complete', {
        workspaceId: request.workspaceId,
        localeVariantId: request.localeVariantId,
        sessionId: session.id
      });
    }
  }

  async getTranscripts(input: AgentTranscriptRequest): Promise<AgentTranscriptResponse> {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.workspaceId !== input.workspaceId) {
      return {
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        lines: []
      };
    }

    const transcriptPath = this.transcripts.get(session.id);
    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      return { workspaceId: input.workspaceId, sessionId: input.sessionId, lines: [] };
    }

    const text = await fs.promises.readFile(transcriptPath, 'utf8');
    const parsed = text
      .split('\n')
      .map((line: string) => line.trim())
      .filter(Boolean)
      .map((line: string) => {
        try {
          return JSON.parse(line) as AgentTranscriptLine;
        } catch {
          return {
            atUtc: new Date().toISOString(),
            direction: 'system',
            event: 'line_parse_error',
            payload: line
          } as AgentTranscriptLine;
        }
      });

    if (!input.limit) {
      return {
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        lines: parsed
      };
    }

    return {
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      lines: parsed.slice(-input.limit)
    };
  }

  listToolCallAudit(sessionId: string, workspaceId: string) {
    return this.toolCallAudit.filter((audit) => audit.sessionId === sessionId && audit.workspaceId === workspaceId);
  }

  async stop(): Promise<void> {
    await this.transport.stop();
  }

  private async resolveSession(input: AgentAnalysisRunRequest | AgentArticleEditRunRequest): Promise<AgentSessionRecord> {
    const existing = input.sessionId ? this.getSession(input.sessionId) : null;
    let session = existing;
    if (!session) {
      if (!input.workspaceId) {
        throw new Error('workspaceId is required');
      }
      const createRequest: AgentSessionCreateRequest = {
        workspaceId: input.workspaceId,
        type: 'localeVariantId' in input ? 'article_edit' : 'batch_analysis',
        batchId: 'batchId' in input ? input.batchId : undefined,
        locale: input.locale,
        templatePackId: 'templatePackId' in input ? input.templatePackId : undefined,
        scope:
          'localeVariantScope' in input && input.localeVariantScope ? { localeVariantIds: input.localeVariantScope } : undefined
      };
      session = this.createSession(createRequest);
    }
    if (session.status === 'closed') {
      throw new Error('Cannot run request against closed session');
    }
    session.status = 'running';
    session.updatedAtUtc = new Date().toISOString();
    return session;
  }

  private async transit(
    session: AgentSessionRecord,
    taskPayload: Record<string, unknown>,
    _runtimeConfig: RuntimeSessionConfig | undefined,
    emit: (payload: Omit<AgentStreamingPayload, 'sessionId' | 'atUtc'>) => void,
    toolCalls: AgentRunResult['toolCalls'],
    isCancelled: () => boolean,
    timeoutMs: number
  ): Promise<void> {
    const requestEnvelope = {
      session,
      task: taskPayload
    };

    this.activeStreamEmitters.set(session.id, emit);
    try {
      emit({ kind: 'session_started', data: requestEnvelope, message: 'Session started' });
      const requestEnvelopeString = JSON.stringify(requestEnvelope);
      const promptText = await this.buildPromptText(session, taskPayload);

      const context: ScopedToolContext = {
        workspaceId: session.workspaceId,
        allowedLocaleVariantIds: session.scope?.localeVariantIds,
        allowedFamilyIds: session.scope?.familyIds
      };

      const transcriptPath = this.transcripts.get(session.id) ?? '';
      const response = await this.executeWithRetry(
        async () => {
          this.log('agent.runtime.ensure_initialized_start', {
            workspaceId: session.workspaceId,
            sessionId: session.id
          });
          const initialized = await this.transport.ensureInitialized(timeoutMs);
          if (!initialized) {
            throw new Error('Cursor ACP initialize failed');
          }
          this.log('agent.runtime.ensure_initialized_success', {
            workspaceId: session.workspaceId,
            sessionId: session.id
          });
          const acpSessionId = await this.ensureAcpSession(session.id, _runtimeConfig);
          const requestPayload = {
            sessionId: acpSessionId,
            prompt: [
              {
                type: 'text',
                text: promptText
              }
            ]
          };
          this.log('agent.runtime.prompt_send', {
            workspaceId: session.workspaceId,
            sessionId: session.id,
            acpSessionId,
            task: taskPayload.task,
            promptLength: promptText.length
          });
          const response = await this.transport.request(
            'session/prompt',
            requestPayload,
            timeoutMs,
            session.id
          );
          this.log('agent.runtime.prompt_response', {
            workspaceId: session.workspaceId,
            sessionId: session.id,
            hasError: Boolean(response.error)
          });
          if (response.error) {
            throw new Error(response.error.message);
          }
          return response.result;
        },
        3,
        isCancelled
      );

      emit({ kind: 'result', data: response, message: 'Run complete' });
      await appendFile(
        transcriptPath,
        `${JSON.stringify({ atUtc: new Date().toISOString(), direction: 'to_agent', event: requestEnvelopeString, payload: requestEnvelopeString })}\n`,
        'utf8'
      );
    } finally {
      this.activeStreamEmitters.delete(session.id);
    }
  }

  private async buildPromptText(session: AgentSessionRecord, taskPayload: Record<string, unknown>): Promise<string> {
    if (taskPayload.task !== 'analyze_batch') {
      const runtimeMode = taskPayload.runtimeMode === 'app_runtime' ? 'app_runtime' : 'mcp_only';
      return buildTaskPrompt(session, taskPayload, { runtimeMode });
    }

    const batchId = typeof taskPayload.batchId === 'string' ? taskPayload.batchId : session.batchId ?? '';
    const runtimeMode = taskPayload.runtimeMode === 'app_runtime' ? 'app_runtime' : 'mcp_only';
    if (!batchId) {
      return buildTaskPrompt(session, taskPayload, { runtimeMode });
    }

    let batchContext: unknown;
    let uploadedPbis: unknown;
    let articleDirectory = '';

    try {
      batchContext = await this.toolContext.getBatchContext({
        workspaceId: session.workspaceId,
        batchId
      });
    } catch {
      batchContext = undefined;
    }

    try {
      uploadedPbis = await this.toolContext.getPBISubset({
        workspaceId: session.workspaceId,
        batchId
      });
    } catch {
      uploadedPbis = undefined;
    }

    try {
      const tree = await this.toolContext.getExplorerTree(session.workspaceId);
      articleDirectory = summarizeExplorerTree(tree);
    } catch {
      articleDirectory = '';
    }

    return buildTaskPrompt(session, taskPayload, {
      batchContext,
      uploadedPbis,
      articleDirectory,
      runtimeMode
    });
  }

  private async executeWithRetry(
    fn: () => Promise<unknown>,
    maxAttempts: number,
    isCancelled: () => boolean
  ): Promise<unknown> {
    this.log('agent.runtime.retry_cycle_begin', { maxAttempts });
    let attempt = 0;
    let delay = 500;
    while (attempt < maxAttempts) {
      if (isCancelled()) {
        throw new Error('Run canceled');
      }
      try {
        this.log('agent.runtime.retry_attempt', { attempt: attempt + 1, maxAttempts });
        return await fn();
      } catch (error) {
        attempt += 1;
        this.log('agent.runtime.retry_attempt_failed', {
          attempt,
          maxAttempts,
          error: error instanceof Error ? error.message : String(error)
        });
        if (attempt >= maxAttempts) {
          throw error instanceof Error ? error : new Error(String(error));
        }
        this.log('agent.runtime.retry_wait', { attempt, waitMs: delay });
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
    throw new Error('unreachable');
  }

  private async handleTransportNotification(message: JsonRpcResponseMessage): Promise<void> {
    if (message.method !== 'session/update' || !message.params) {
      return;
    }

    const params = message.params as { sessionId?: string; update?: { sessionUpdate?: string } };
    const localSessionId = typeof params.sessionId === 'string' ? this.cursorSessionLookup.get(params.sessionId) : undefined;
    if (!localSessionId) {
      return;
    }

    const update =
      params && typeof params === 'object' && 'update' in params
        ? (params as { update?: { sessionUpdate?: string; content?: { type?: string; text?: string }; title?: string } }).update
        : undefined;
    const payload = JSON.stringify(message.params);
    const isAppRuntimeSession = this.appRuntimeSessions.has(localSessionId);
    const isNativeToolUpdate = update?.sessionUpdate === 'tool_call' || update?.sessionUpdate === 'tool_call_update';

    if (isAppRuntimeSession && isNativeToolUpdate) {
      const title =
        update && typeof update === 'object' && 'title' in update && typeof (update as { title?: string }).title === 'string'
          ? (update as { title?: string }).title ?? 'unknown'
          : 'unknown';
      const usage = this.appRuntimeNativeToolUsage.get(localSessionId) ?? [];
      usage.push(title);
      this.appRuntimeNativeToolUsage.set(localSessionId, usage);
    } else {
      await this.appendTranscriptLine(localSessionId, 'from_agent', 'session_update', payload);
    }

    if (
      update?.sessionUpdate === 'agent_message_chunk' &&
      update.content?.type === 'text' &&
      typeof update.content.text === 'string'
    ) {
      const current = this.sessionMessageBuffers.get(localSessionId) ?? '';
      const next = normalizeAppRuntimeMessageBuffer(current, update.content.text);
      this.sessionMessageBuffers.set(localSessionId, next);
    }

    const emit = this.activeStreamEmitters.get(localSessionId);
    if (!emit) {
      return;
    }

    emit({
      kind: 'progress',
      data: message.params,
      message: params.update?.sessionUpdate ? `session/update:${params.update.sessionUpdate}` : 'session/update'
    });
  }

  private clearSessionMessageBuffer(sessionId: string): void {
    this.sessionMessageBuffers.set(sessionId, '');
  }

  private consumeSessionMessageBuffer(sessionId: string): string {
    const message = this.sessionMessageBuffers.get(sessionId) ?? '';
    this.sessionMessageBuffers.set(sessionId, '');
    return message.trim();
  }

  private consumeAppRuntimeNativeToolUsage(sessionId: string): string[] {
    const usage = [...(this.appRuntimeNativeToolUsage.get(sessionId) ?? [])];
    this.appRuntimeNativeToolUsage.set(sessionId, []);
    return usage;
  }

  private async ensureTranscriptPath(sessionId: string, runId: string): Promise<string> {
    const transcriptDir = path.resolve(this.config.workspaceRoot, DEFAULT_TRANSCRIPT_DIR, sessionId);
    await mkdir(transcriptDir, { recursive: true });
    const filePath = path.join(transcriptDir, `${runId}.jsonl`);
    this.transcripts.set(sessionId, filePath);
    await appendFile(filePath, `${JSON.stringify({ atUtc: new Date().toISOString(), direction: 'system', event: 'transcript_start', payload: runId })}\n`, 'utf8');
    return filePath;
  }

  private isCursorAvailable(): boolean {
    const checkPaths = [this.config.cursorBinary, 'cursor', 'cursor.exe'];
    return checkPaths.some((binary) => {
      if (!binary) {
        return false;
      }
      if (path.isAbsolute(binary)) {
        return fs.existsSync(binary);
      }
      const searchPath = process.env.PATH ?? '';
      return searchPath.split(path.delimiter).some((dir) => {
        if (!dir) {
          return false;
        }
        const exe = path.join(dir, binary);
        const exeWithExt = path.extname(exe).length > 0 ? exe : `${exe}.exe`;
        return fs.existsSync(exe) || fs.existsSync(exeWithExt);
      });
    });
  }

  private async canReachCursor(): Promise<boolean> {
    try {
      const response = await this.transport.ensureInitialized(1000);
      return response;
    } catch {
      return false;
    }
  }

  private async appendTranscriptLine(
    sessionId: string,
    direction: AgentTranscriptLine['direction'],
    event: string,
    payload: string
  ) {
    const path = this.transcripts.get(sessionId);
    if (!path) {
      return;
    }
    await appendFile(
      path,
      `${JSON.stringify({
        atUtc: new Date().toISOString(),
        direction,
        event,
        payload
      })}\n`,
      'utf8'
    );
  }

  private async runAppRuntimeBatchAnalysis(
    session: AgentSessionRecord,
    request: AgentAnalysisRunRequest,
    emit: (payload: Omit<AgentStreamingPayload, 'sessionId' | 'atUtc'>) => void,
    toolCalls: AgentRunResult['toolCalls'],
    isCancelled: () => boolean,
    timeoutMs: number,
    runtimeConfig?: RuntimeSessionConfig
  ): Promise<void> {
    const acpSessionId = await this.ensureAppRuntimeInitialized(session, timeoutMs, runtimeConfig);
    this.appRuntimeSessions.add(session.id);
    let promptText = await this.buildPromptText(session, {
      task: 'analyze_batch',
      batchId: request.batchId,
      prompt: request.prompt,
      locale: request.locale,
      templatePackId: request.templatePackId,
      runtimeMode: 'app_runtime'
    });

    const maxIterations = 10;
    try {
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        if (isCancelled()) {
          throw new Error('Run canceled');
        }

        this.clearSessionMessageBuffer(session.id);
        this.appRuntimeNativeToolUsage.set(session.id, []);
        const response = await this.transport.request(
          'session/prompt',
          {
            sessionId: acpSessionId,
            prompt: [
              {
                type: 'text',
                text: promptText
              }
            ]
          },
          timeoutMs,
          session.id
        );
        if (response.error) {
          throw new Error(response.error.message);
        }

        const messageText = this.consumeSessionMessageBuffer(session.id);
        const nativeToolUsage = this.consumeAppRuntimeNativeToolUsage(session.id);
        const envelope = parseAppRuntimeEnvelope(messageText);
        if (!envelope) {
          promptText = [
            'KB Vault could not recover a valid JSON envelope from your last response.',
            nativeToolUsage.length
              ? `Native Cursor tools were ignored in App Runtime mode: ${nativeToolUsage.join(', ')}.`
              : '',
            'Do not analyze or explain.',
            'Reply with exactly one JSON object and nothing else.',
            'Emit either {"type":"tool_call",...} to request one tool or {"type":"final","content":"..."} to finish.'
          ]
            .filter(Boolean)
            .join('\n');
          continue;
        }

        if (envelope.type === 'final') {
          emit({
            kind: 'result',
            data: {
              content: envelope.content
            },
            message: envelope.content
          });
          return;
        }

        const toolResult = await this.executeAppRuntimeTool(session, envelope, toolCalls);
        emit({
          kind: 'progress',
          data: {
            mode: 'app_runtime',
            tool: envelope.tool,
            input: envelope.input ?? {},
            result: toolResult
          },
          message: `app_runtime_tool:${envelope.tool}`
        });

        promptText = [
          'Tool result:',
          JSON.stringify(
            {
              tool: envelope.tool,
              input: envelope.input ?? {},
              result: toolResult
            },
            null,
            2
          ),
          '',
          nativeToolUsage.length
            ? `Native Cursor tools were ignored in App Runtime mode: ${nativeToolUsage.join(', ')}. Do not use grep, shell, or other native tools here.`
            : '',
          'Do not analyze or explain.',
          'If you need more evidence, emit exactly one valid tool_call.',
          'If you have enough evidence, emit exactly one final JSON object.',
          'Reply with JSON only using either {"type":"tool_call",...} or {"type":"final","content":"..."}'
        ]
          .filter(Boolean)
          .join('\n');
      }
    } finally {
      this.appRuntimeSessions.delete(session.id);
      this.appRuntimeNativeToolUsage.delete(session.id);
    }

    throw new Error('App runtime exceeded maximum tool iterations');
  }

  private async ensureAppRuntimeInitialized(
    session: AgentSessionRecord,
    timeoutMs: number,
    runtimeConfig?: RuntimeSessionConfig
  ): Promise<string> {
    this.log('agent.runtime.ensure_initialized_start', {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      runtimeMode: 'app_runtime'
    });
    const initialized = await this.transport.ensureInitialized(timeoutMs);
    if (!initialized) {
      throw new Error('Cursor ACP initialize failed');
    }
    this.log('agent.runtime.ensure_initialized_success', {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      runtimeMode: 'app_runtime'
    });
    return this.ensureAcpSession(session.id, {
      ...runtimeConfig,
      agentReasoning: runtimeConfig?.agentReasoning ?? 'low',
      agentThinking: 'off',
      appRuntime: true
    });
  }

  private async executeAppRuntimeTool(
    session: AgentSessionRecord,
    envelope: AppRuntimeToolCallEnvelope,
    toolCalls: AgentRunResult['toolCalls']
  ): Promise<unknown> {
    const input = {
      ...(envelope.input ?? {}),
      workspaceId: session.workspaceId
    } as Record<string, unknown>;
    const calledAtUtc = new Date().toISOString();
    const auditRecord = {
      workspaceId: session.workspaceId,
      sessionId: session.id,
      toolName: envelope.tool,
      args: input,
      calledAtUtc,
      allowed: true
    };

    this.toolCallAudit.push(auditRecord);
    toolCalls.push(auditRecord);
    await this.appendTranscriptLine(session.id, 'system', 'app_runtime_tool_call', JSON.stringify({ tool: envelope.tool, input }));

    switch (envelope.tool) {
      case 'get_batch_context':
        return this.toolContext.getBatchContext(input as unknown as MCPGetBatchContextInput);
      case 'get_pbi_subset':
        return this.toolContext.getPBISubset(input as unknown as MCPGetPBISubsetInput);
      case 'get_pbi':
        return this.toolContext.getPBI(input as unknown as MCPGetPBIInput);
      case 'get_article':
        return this.toolContext.getArticle(input as unknown as MCPGetArticleInput);
      case 'get_article_family':
        return this.toolContext.getArticleFamily(input as unknown as MCPGetArticleFamilyInput);
      case 'get_locale_variant':
        return this.toolContext.getLocaleVariant(input as unknown as MCPGetLocaleVariantInput);
      case 'get_article_history':
        return this.toolContext.getArticleHistory(input as unknown as MCPGetArticleHistoryInput);
      case 'find_related_articles':
        return this.toolContext.findRelatedArticles(input as unknown as MCPFindRelatedArticlesInput);
      case 'search_kb':
        return this.toolContext.searchKb(input as unknown as MCPFindRelatedArticlesInput & { workspaceId: string });
      case 'list_article_templates':
        return this.toolContext.listArticleTemplates(input as unknown as MCPListArticleTemplatesInput);
      case 'get_template':
        return this.toolContext.getTemplate(input as unknown as MCPListArticleTemplatesInput & { templatePackId: string; workspaceId: string });
      case 'record_agent_notes':
        return this.toolContext.recordAgentNotes(input as unknown as MCPRecordAgentNotesInput);
      case 'propose_create_kb':
        return this.toolContext.proposeCreateKb(input as unknown as MCPRecordAgentNotesInput, this.getScopedContextForSession(session.id) ?? this.fallbackScopedContext(session));
      case 'propose_edit_kb':
        return this.toolContext.proposeEditKb(input as unknown as MCPRecordAgentNotesInput, this.getScopedContextForSession(session.id) ?? this.fallbackScopedContext(session));
      case 'propose_retire_kb':
        return this.toolContext.proposeRetireKb(input as unknown as MCPRecordAgentNotesInput, this.getScopedContextForSession(session.id) ?? this.fallbackScopedContext(session));
      default:
        throw new Error(`Unsupported app runtime tool: ${envelope.tool}`);
    }
  }

  private fallbackScopedContext(session: AgentSessionRecord): ScopedToolContext {
    return {
      workspaceId: session.workspaceId,
      allowedLocaleVariantIds: session.scope?.localeVariantIds,
      allowedFamilyIds: session.scope?.familyIds,
      batchId: session.batchId,
      sessionId: session.id
    };
  }

  private registerToolImplementations(server: McpToolServer, toolContext: AgentRuntimeToolContext): void {
    const enforceScope = (
      input: Record<string, unknown>,
      context: ScopedToolContext,
      scope: readonly string[] | undefined
    ) => {
      if (!scope || scope.length === 0) {
        return;
      }
      const familyId = typeof input.familyId === 'string' ? input.familyId : undefined;
      const variantId = typeof input.localeVariantId === 'string' ? input.localeVariantId : undefined;
      if (familyId && context.allowedFamilyIds?.length && !context.allowedFamilyIds.includes(familyId)) {
        throw new Error(`familyId ${familyId} outside scope`);
      }
      if (variantId && context.allowedLocaleVariantIds?.length && !context.allowedLocaleVariantIds.includes(variantId)) {
        throw new Error(`localeVariantId ${variantId} outside scope`);
      }
    };

    const wrappers: Record<string, MCPToolImplementation> = {
      search_kb: {
        description: 'Search local KB cache for likely article candidates.',
        handler: async (input, context, log) => {
          const parsed = input as MCPFindRelatedArticlesInput & { workspaceId: string };
          parsed.workspaceId = context.workspaceId;
          const result = await toolContext.findRelatedArticles(parsed);
          await log({ direction: 'system', event: 'tool_result', payload: 'search_kb returned' });
          return result;
        }
      },
      get_article: {
        description: 'Load a locale variant or revision payload for one article.',
        handler: async (input, context, log) => {
          const payload = input as MCPGetArticleInput & { workspaceId: string };
          payload.workspaceId = context.workspaceId;
          const result = await toolContext.getArticle(payload);
          await log({ direction: 'system', event: 'tool_result', payload: 'get_article' });
          return result;
        }
      },
      get_article_family: {
        description: 'Load article family metadata.',
        handler: async (input, context, log) => {
          const payload = input as MCPGetArticleFamilyInput & { workspaceId: string };
          payload.workspaceId = context.workspaceId;
          const result = await toolContext.getArticleFamily(payload);
          await log({ direction: 'system', event: 'tool_result', payload: 'get_article_family' });
          return result;
        }
      },
      get_locale_variant: {
        description: 'Load a locale variant and metadata.',
        handler: async (input, context, log) => {
          const payload = input as MCPGetLocaleVariantInput & { workspaceId: string };
          payload.workspaceId = context.workspaceId;
          enforceScope(payload as unknown as Record<string, unknown>, context, context.allowedLocaleVariantIds);
          const result = await toolContext.getLocaleVariant(payload);
          await log({ direction: 'system', event: 'tool_result', payload: 'get_locale_variant' });
          return result;
        },
        requiresScope: true
      },
      find_related_articles: {
        description: 'Search for related article candidates from KB content.',
        handler: async (input, context, log) => {
          const payload = input as MCPFindRelatedArticlesInput & { workspaceId: string };
          payload.workspaceId = context.workspaceId;
          const result = await toolContext.findRelatedArticles(payload);
          await log({ direction: 'system', event: 'tool_result', payload: 'find_related_articles' });
          return result;
        }
      },
      list_categories: {
        description: 'Get local article categories for locale.',
        handler: async (input, context, log) => {
          const payload = input as MCPListCategoriesInput & { workspaceId: string };
          payload.workspaceId = context.workspaceId;
          const result = await toolContext.listCategories(payload);
          await log({ direction: 'system', event: 'tool_result', payload: 'list_categories' });
          return result;
        }
      },
      list_sections: {
        description: 'Get local article sections.',
        handler: async (input, context, log) => {
          const payload = input as MCPListSectionsInput & { workspaceId: string };
          payload.workspaceId = context.workspaceId;
          const result = await toolContext.listSections(payload);
          await log({ direction: 'system', event: 'tool_result', payload: 'list_sections' });
          return result;
        }
      },
      list_article_templates: {
        description: 'Read template packs in the workspace.',
        handler: async (input, context, log) => {
          const payload = input as MCPListArticleTemplatesInput & { workspaceId: string };
          payload.workspaceId = context.workspaceId;
          const result = await toolContext.listArticleTemplates(payload);
          await log({ direction: 'system', event: 'tool_result', payload: 'list_article_templates' });
          return result;
        }
      },
      get_template: {
        description: 'Get a single template pack payload.',
        handler: async (input, context, log) => {
          const payload = input as MCPGetTemplateInput & { workspaceId?: string };
          if (!payload.templatePackId || !String(payload.templatePackId).trim()) {
            throw new Error('templatePackId is required');
          }
          payload.workspaceId = context.workspaceId;
          const result = await toolContext.getTemplate(payload);
          await log({ direction: 'system', event: 'tool_result', payload: 'get_template' });
          return result;
        }
      },
      get_batch_context: {
        description: 'Load batch metadata and scoped row summary.',
        handler: async (input, context, log) => {
          const payload = input as MCPGetBatchContextInput & { workspaceId: string };
          payload.workspaceId = context.workspaceId;
          const result = await toolContext.getBatchContext(payload);
          await log({ direction: 'system', event: 'tool_result', payload: 'get_batch_context' });
          return result;
        }
      },
      get_pbi: {
        description: 'Load one PBI record from batch context.',
        handler: async (input, context, log) => {
          const payload = input as MCPGetPBIInput & { workspaceId: string };
          payload.workspaceId = context.workspaceId;
          const result = await toolContext.getPBI(payload);
          await log({ direction: 'system', event: 'tool_result', payload: 'get_pbi' });
          return result;
        }
      },
      get_pbi_subset: {
        description: 'Load PBI subset by row numbers.',
        handler: async (input, context, log) => {
          const payload = input as MCPGetPBISubsetInput & { workspaceId: string };
          payload.workspaceId = context.workspaceId;
          const result = await toolContext.getPBISubset(payload);
          await log({ direction: 'system', event: 'tool_result', payload: 'get_pbi_subset' });
          return result;
        }
      },
      get_article_history: {
        description: 'Read revision history for a locale variant.',
        handler: async (input, context, log) => {
          const payload = input as MCPGetArticleHistoryInput & { workspaceId: string };
          payload.workspaceId = context.workspaceId;
          enforceScope(payload as unknown as Record<string, unknown>, context, context.allowedLocaleVariantIds);
          const result = await toolContext.getArticleHistory(payload);
          await log({ direction: 'system', event: 'tool_result', payload: 'get_article_history' });
          return result;
        },
        requiresScope: true
      },
      propose_create_kb: {
        description: 'Record a create-kb proposal from agent analysis.',
        handler: async (input, context, log) => {
          const payload = input as MCPRecordAgentNotesInput;
          enforceScope(payload as unknown as Record<string, unknown>, context, context.allowedLocaleVariantIds);
          const result = toolContext.proposeCreateKb({ ...payload } as MCPRecordAgentNotesInput, context);
          const resolved = await result;
          await log({ direction: 'system', event: 'tool_result', payload: 'propose_create_kb' });
          return resolved;
        },
        requiresScope: true
      },
      propose_edit_kb: {
        description: 'Record an edit-kb proposal from agent analysis.',
        handler: async (input, context, log) => {
          const payload = input as MCPRecordAgentNotesInput;
          enforceScope(payload as unknown as Record<string, unknown>, context, context.allowedLocaleVariantIds);
          const result = toolContext.proposeEditKb({ ...payload } as MCPRecordAgentNotesInput, context);
          const resolved = await result;
          await log({ direction: 'system', event: 'tool_result', payload: 'propose_edit_kb' });
          return resolved;
        },
        requiresScope: true
      },
      propose_retire_kb: {
        description: 'Record a retire-kb proposal from agent analysis.',
        handler: async (input, context, log) => {
          const payload = input as MCPRecordAgentNotesInput;
          enforceScope(payload as unknown as Record<string, unknown>, context, context.allowedLocaleVariantIds);
          const result = toolContext.proposeRetireKb({ ...payload } as MCPRecordAgentNotesInput, context);
          const resolved = await result;
          await log({ direction: 'system', event: 'tool_result', payload: 'propose_retire_kb' });
          return resolved;
        },
        requiresScope: true
      },
      record_agent_notes: {
        description: 'Persist structured notes for session debugging/auditing.',
        handler: async (input, context, log) => {
          const payload = input as MCPRecordAgentNotesInput;
          payload.workspaceId = context.workspaceId;
          const result = await toolContext.recordAgentNotes(payload);
          await log({ direction: 'system', event: 'tool_result', payload: 'record_agent_notes' });
          return result;
        }
      }
    };

    const audit = async (toolName: string, input: unknown, context: ScopedToolContext, allowed: boolean, reason?: string) => {
      const auditable = {
        workspaceId: context.workspaceId,
        sessionId: this.getActiveSessionForWorkspace(context.workspaceId),
        toolName,
        args: input,
        calledAtUtc: new Date().toISOString(),
        allowed,
        reason
      };
      if (allowed) {
        this.toolCallAudit.push(auditable);
      } else {
        auditable.reason = reason;
        this.toolCallAudit.push(auditable);
      }
      await this.appendTranscriptLine(context.workspaceId, 'system', 'tool_call_audit', JSON.stringify(auditable));
    };

    for (const [name, definition] of Object.entries(wrappers)) {
      server.registerTool(name, definition.description, async (input: unknown) => {
        const inputWorkspaceId = (input as { workspaceId?: string })?.workspaceId;
        const sessionId = this.getActiveSessionForWorkspace(inputWorkspaceId || '');
        const contextData: ScopedToolContext = this.getScopedContextForSession(sessionId) ?? { workspaceId: (input as { workspaceId?: string })?.workspaceId || '' };
        let allowed = true;
        let reason: string | undefined;
        try {
          if (definition.requiresScope) {
            enforceScope(input as Record<string, unknown>, contextData, contextData.allowedLocaleVariantIds);
          }
          await audit(name, input, contextData, true);
          const result = await definition.handler(input, contextData, async (line) => {
            await this.appendTranscriptLine(contextData.workspaceId, line.direction, line.event, line.payload);
          });
          return result;
        } catch (error) {
          allowed = false;
          reason = error instanceof Error ? error.message : String(error);
          await audit(name, input, contextData, false, reason);
          throw error;
        }
      });
    }
  }

  private getActiveSessionForWorkspace(workspaceId: string): string {
    const candidate = Array.from(this.sessions.values())
      .filter((session) => session.workspaceId === workspaceId && session.status !== 'closed')
      .sort((a, b) => b.updatedAtUtc.localeCompare(a.updatedAtUtc))[0];
    return candidate?.id ?? '';
  }

  private getScopedContextForSession(sessionId: string): ScopedToolContext | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    return {
      workspaceId: session.workspaceId,
      allowedLocaleVariantIds: session.scope?.localeVariantIds,
      allowedFamilyIds: session.scope?.familyIds,
      batchId: session.batchId,
      sessionId: session.id
    };
  }
}

export class AgentRuntimeService {
  private readonly runtime: CursorAcpRuntime;
  constructor(workspaceRoot: string, toolContext: AgentRuntimeToolContext) {
    this.runtime = new CursorAcpRuntime(workspaceRoot, toolContext);
  }

  getRuntime() {
    return this.runtime;
  }
}

export const AGENT_RUNTIME_VERSION = '0.1.0';
export { McpToolServer } from '@kb-vault/mcp-server';

function summarizeBatchContext(batchContext: unknown): string {
  if (batchContext === undefined) {
    return 'Unavailable.';
  }

  if (!batchContext || typeof batchContext !== 'object') {
    return JSON.stringify(batchContext);
  }

  const record = batchContext as Record<string, unknown>;
  const preferredKeys = [
    'batchId',
    'workspaceId',
    'title',
    'name',
    'status',
    'locale',
    'templatePackId',
    'createdAtUtc',
    'updatedAtUtc',
    'pbiCount',
    'analysisStatus',
    'notes'
  ];
  const summaryEntries = preferredKeys
    .filter((key) => key in record)
    .map((key) => `${key}: ${JSON.stringify(record[key])}`);

  if (!summaryEntries.length) {
    const keys = Object.keys(record);
    return `Object with keys: ${keys.join(', ') || '(none)'}`;
  }

  return summaryEntries.join('\n');
}

function summarizeExplorerTree(nodes: ExplorerNode[]): string {
  if (!nodes.length) {
    return 'No KB articles found.';
  }

  return nodes
    .map((node, index) => {
      const locales = node.locales
        .map((locale) => {
          const fileLabel = `${slugifyForPrompt(node.title)}.${locale.locale}.md`;
          return [
            `  - file=${fileLabel}`,
            `locale=${locale.locale}`,
            `localeVariantId=${locale.localeVariantId}`,
            `revisionId=${locale.revision.revisionId}`,
            `revisionNumber=${locale.revision.revisionNumber}`,
            `revisionState=${locale.revision.state}`,
            `draftCount=${locale.revision.draftCount}`,
            `updatedAtUtc=${locale.revision.updatedAtUtc}`,
            `hasConflicts=${locale.hasConflicts ? 'true' : 'false'}`
          ].join('; ');
        })
        .join('\n');
      return `${index + 1}. ${node.title} (familyId=${node.familyId}; familyStatus=${node.familyStatus})\n${locales}`;
    })
    .join('\n\n');
}

function slugifyForPrompt(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'article';
}

function appendStreamingText(existing: string, next: string): string {
  if (!next) {
    return existing;
  }
  if (!existing) {
    return next;
  }
  if (existing.endsWith(next)) {
    return existing;
  }
  if (next.startsWith(existing)) {
    return next;
  }

  const maxOverlap = Math.min(existing.length, next.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (existing.slice(-overlap) === next.slice(0, overlap)) {
      return `${existing}${next.slice(overlap)}`;
    }
  }

  return `${existing}${next}`;
}

function normalizeAppRuntimeMessageBuffer(existing: string, next: string): string {
  const trimmedNext = next.trim();
  const nextEnvelope = parseAppRuntimeEnvelope(trimmedNext);
  if (nextEnvelope) {
    return JSON.stringify(nextEnvelope);
  }

  const combined = appendStreamingText(existing, next);
  const combinedEnvelope = parseAppRuntimeEnvelope(combined);
  if (combinedEnvelope) {
    return JSON.stringify(combinedEnvelope);
  }

  if (existing && next) {
    const maxOverlap = Math.min(existing.length, next.length);
    for (let overlap = maxOverlap; overlap >= 24; overlap -= 1) {
      const suffix = existing.slice(-overlap);
      const index = next.indexOf(suffix);
      if (index !== -1) {
        const candidate = `${existing}${next.slice(index + overlap)}`;
        const candidateEnvelope = parseAppRuntimeEnvelope(candidate);
        if (candidateEnvelope) {
          return JSON.stringify(candidateEnvelope);
        }
        return candidate;
      }
    }
  }

  return combined;
}

function parseAppRuntimeEnvelope(messageText: string): AppRuntimeEnvelope | null {
  const trimmed = messageText.trim();
  if (!trimmed) {
    return null;
  }

  const direct = coerceAppRuntimeEnvelope(trimmed);
  if (direct) {
    return direct;
  }

  const candidates = extractJsonObjectCandidates(trimmed);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const envelope = coerceAppRuntimeEnvelope(candidates[index]);
    if (envelope) {
      return envelope;
    }
  }

  return null;
}

function coerceAppRuntimeEnvelope(candidate: string): AppRuntimeEnvelope | null {
  try {
    const parsed = JSON.parse(candidate) as AppRuntimeEnvelope;
    if (parsed && typeof parsed === 'object' && parsed.type === 'tool_call' && typeof parsed.tool === 'string') {
      return {
        type: 'tool_call',
        tool: parsed.tool,
        input: parsed.input && typeof parsed.input === 'object' ? parsed.input : {}
      };
    }
    if (parsed && typeof parsed === 'object' && parsed.type === 'final' && typeof parsed.content === 'string') {
      return {
        type: 'final',
        content: parsed.content
      };
    }
  } catch {
    return null;
  }

  return null;
}

function extractJsonObjectCandidates(input: string): string[] {
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === '}') {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && start !== -1) {
        candidates.push(input.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return candidates;
}
