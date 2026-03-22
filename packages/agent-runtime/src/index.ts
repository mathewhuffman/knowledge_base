import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
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
  AgentRunResult,
  KbAccessMode,
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
  ExplorerNode,
  KbAccessHealth
} from '@kb-vault/shared-types';
import { CliHealthFailure } from '@kb-vault/shared-types';

const DEFAULT_AGENT_ACCESS_MODE: KbAccessMode = 'mcp';
const KB_CLI_BINARY_ENV = 'KBV_KB_CLI_BINARY';
const KBV_CURSOR_BINARY_ENV = 'KBV_CURSOR_BINARY';
const DEFAULT_CURSOR_BINARY = 'cursor';
const DEFAULT_CURSOR_ARGS = ['agent', 'acp'];
const DEFAULT_CLI_BINARY = 'kb';
const ACP_HEALTH_INIT_TIMEOUT_MS = 4_000;
const ACP_HEALTH_INIT_ATTEMPTS = 2;

function resolveDefaultCursorBinary(): string {
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
        '/Applications/Cursor.app/Contents/MacOS/Cursor'
      ]
    : [];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return DEFAULT_CURSOR_BINARY;
}
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
  mcpBinary: string;
  cliBinary: string;
  cursorArgs: string[];
  requestTimeoutMs: number;
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

type KbAccessPromptBuilder = (
  session: AgentSessionRecord,
  taskPayload: Record<string, unknown>,
  extras?: {
    batchContext?: unknown;
    uploadedPbis?: unknown;
    articleDirectory?: string;
  }
) => string;

interface KbRuntimeOptions {
  getCliHealth?: (workspaceId?: string) => Promise<KbAccessHealth>;
  buildCliPromptSuffix?: () => string;
}

interface KbAccessProvider {
  mode: KbAccessMode;
  provider: 'mcp' | 'cli';
  terminalEnabled: boolean;
  buildSessionCreateParams: () => {
    cwd: string;
    mcpServers?: AcpMcpServerConfig[];
    config: { mode: 'agent' };
  };
  getPromptTaskBuilder: (
    session: AgentSessionRecord,
    taskPayload: Record<string, unknown>,
    extras?: { batchContext?: unknown; uploadedPbis?: unknown; articleDirectory?: string }
  ) => string;
  getHealth: (workspaceId?: string) => Promise<KbAccessHealth>;
}

function buildMcpTaskPrompt(
  session: AgentSessionRecord,
  taskPayload: Record<string, unknown>,
  extras?: {
    batchContext?: unknown;
    uploadedPbis?: unknown;
    articleDirectory?: string;
  }
): string {
  const batchId = typeof taskPayload.batchId === 'string' ? taskPayload.batchId : session.batchId ?? '';
  const locale = typeof taskPayload.locale === 'string' ? taskPayload.locale : session.locale ?? 'default';
  const explicitPrompt = typeof taskPayload.prompt === 'string' ? taskPayload.prompt.trim() : '';
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

  return JSON.stringify({ session, task: taskPayload });
}

function buildCliTaskPrompt(
  session: AgentSessionRecord,
  taskPayload: Record<string, unknown>,
  extras?: {
    batchContext?: unknown;
    uploadedPbis?: unknown;
    articleDirectory?: string;
  }
): string {
  const batchId = typeof taskPayload.batchId === 'string' ? taskPayload.batchId : session.batchId ?? '';
  const locale = typeof taskPayload.locale === 'string' ? taskPayload.locale : session.locale ?? 'default';
  const explicitPrompt = typeof taskPayload.prompt === 'string' ? taskPayload.prompt.trim() : '';
  const cliGuidance = [
    'KB Vault CLI guidance:',
    '- Use only the `kb` CLI and data returned by its JSON output.',
    '- Use the terminal only for `kb` commands.',
    '- Always include `--json` in every `kb` command.',
    '- Use as many `kb` commands as needed to complete the task.',
    '- Do NOT use Read File.',
    '- Do NOT use grep.',
    '- If an exact `kb` command is unavailable, call `kb --help` to confirm current syntax.',
    '- If you need KB evidence, prefer direct `kb` output over local inference.',
    '- If you need batch context, load batch context first with `kb`.',
    '- If you need article text, load article variants and related entries with `kb` before proposing edits.',
    '- Preferred commands for this environment:',
    '- `kb batch-context --workspace-id <workspace-id> --batch-id <batch-id> --json`',
    '- `kb find-related-articles --workspace-id <workspace-id> --batch-id <batch-id> --json`',
    '- `kb search-kb --workspace-id <workspace-id> --query "<query>" --json`'
  ].join('\n');
  const extraSections = [
    extras?.batchContext !== undefined ? `Preloaded batch context summary:\n${summarizeBatchContext(extras.batchContext)}` : '',
    extras?.uploadedPbis !== undefined ? `Preloaded uploaded PBI JSON:\n${JSON.stringify(extras.uploadedPbis, null, 2)}` : '',
    extras?.articleDirectory ? `KB article directory and file-style index:\n${extras.articleDirectory}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');

  if (taskPayload.task === 'analyze_batch') {
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
      '- Use kb commands and structured batch/article data only.',
      '- Do NOT use generic terminal, grep, codebase search, find, or filesystem exploration unless the user explicitly asks for that.',
      '- Do NOT inspect the repository or sqlite schema to infer application behavior.',
      '- Prefer returning a concise analysis/summary over exploratory investigation.',
      '- The preloaded prompt context is for orientation; use CLI output directly when you need to confirm or inspect source records.',
      '',
      cliGuidance,
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
      '- Use kb commands and structured article/template data only.',
      '- Do NOT use terminal, grep, codebase search, find, or filesystem exploration unless explicitly requested.',
      '- The preloaded prompt context is for orientation; use CLI output directly when you need to confirm or inspect source records.',
      '',
      cliGuidance,
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
    private readonly terminalEnabled: boolean,
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

  abortPromptSession(sessionId: string, reason: string): void {
    if (!sessionId) {
      return;
    }

    for (const [requestId, pending] of this.pending.entries()) {
      if (pending.method !== 'session/prompt' || pending.watchedSessionId !== sessionId) {
        continue;
      }
      this.pending.delete(requestId);
      pending.reject(new Error(reason));
    }
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
          terminal: this.terminalEnabled
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
  private readonly transports = new Map<KbAccessMode, CursorTransport>();
  private readonly cursorSessionIds = new Map<string, { mode: KbAccessMode; acpSessionId: string }>();
  private readonly cursorSessionLookup = new Map<string, { localSessionId: string; mode: KbAccessMode }>();
  private readonly activeStreamEmitters = new Map<string, (payload: Omit<AgentStreamingPayload, 'sessionId' | 'atUtc'>) => void>();
  private readonly debugLogger: RuntimeDebugLogger;
  private readonly configuredMcpServers: AcpMcpServerConfig[];
  private runtimeMcpServers: AcpMcpServerConfig[] = [];
  private readonly toolContext: AgentRuntimeToolContext;
  private readonly runtimeOptions: KbRuntimeOptions;

  constructor(
    workspaceRoot: string,
    toolContext: AgentRuntimeToolContext,
    runtimeOptions: KbRuntimeOptions = {},
    debugLogger?: RuntimeDebugLogger
  ) {
    const acpCwd = process.env.KBV_ACP_CWD?.trim() || process.cwd();
    const cursorBinary = process.env[KBV_CURSOR_BINARY_ENV]?.trim() || resolveDefaultCursorBinary();
    this.config = {
      workspaceRoot,
      acpCwd,
      mcpBinary: cursorBinary,
      cliBinary: cursorBinary || DEFAULT_CLI_BINARY,
      cursorArgs: DEFAULT_CURSOR_ARGS,
      requestTimeoutMs: 45_000
    };
    this.mcpServer = new McpToolServer();
    this.toolContext = toolContext;
    this.runtimeOptions = runtimeOptions;
    this.debugLogger = debugLogger ?? (() => undefined);
    this.configuredMcpServers = loadConfiguredMcpServers();
    this.registerToolImplementations(this.mcpServer, toolContext);
  }

  private log(message: string, details?: unknown): void {
    this.debugLogger(message, details);
  }

  getSession(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  setMcpServerConfigs(configs: ReadonlyArray<Record<string, unknown>>): void {
    this.runtimeMcpServers = configs.filter((entry): entry is AcpMcpServerConfig => Boolean(entry) && typeof entry === 'object');
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
      kbAccessMode: input.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
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

  async checkHealth(workspaceId: string, selectedMode: KbAccessMode = DEFAULT_AGENT_ACCESS_MODE, workspaceKbAccessMode?: KbAccessMode): Promise<AgentHealthCheckResponse> {
    this.log('agent.runtime.health_check_start', {
      workspaceId,
      selectedMode,
      workspaceKbAccessMode: workspaceKbAccessMode ?? selectedMode
    });
    const [mcp, cli] = await Promise.all([
      this.getProviderHealth('mcp'),
      this.getProviderHealth('cli', workspaceId)
    ]);
    const aggregatedIssues = Array.from(
      new Set([
        ...(mcp.issues ?? []),
        ...(cli.issues ?? []),
        ...(!mcp.ok && mcp.message && !(mcp.issues ?? []).includes(mcp.message) ? [mcp.message] : []),
        ...(!cli.ok && cli.message && !(cli.issues ?? []).includes(cli.message) ? [cli.message] : [])
      ].filter(Boolean))
    );

    const availableModes = [mcp, cli].filter((provider) => provider.ok).map((provider) => provider.mode);

    // If the selected mode is unavailable but the workspace preference is, flag an issue
    if (!availableModes.includes(selectedMode) && availableModes.length > 0) {
      aggregatedIssues.push(`Selected mode "${selectedMode}" is unavailable; available: ${availableModes.join(', ')}`);
    }

    const result: AgentHealthCheckResponse = {
      checkedAtUtc: new Date().toISOString(),
      workspaceId,
      workspaceKbAccessMode: workspaceKbAccessMode ?? selectedMode,
      selectedMode,
      providers: {
        mcp,
        cli
      },
      issues: aggregatedIssues,
      availableModes
    };
    this.log('agent.runtime.health_check_result', {
      workspaceId,
      selectedMode,
      workspaceKbAccessMode: workspaceKbAccessMode ?? selectedMode,
      availableModes,
      issues: aggregatedIssues,
      providers: {
        mcp: {
          ok: mcp.ok,
          failureCode: mcp.failureCode,
          message: mcp.message,
          acpReachable: mcp.acpReachable
        },
        cli: {
          ok: cli.ok,
          failureCode: cli.failureCode,
          message: cli.message,
          acpReachable: cli.acpReachable
        }
      }
    });
    return result;
  }

  private async ensureAcpSession(session: AgentSessionRecord): Promise<string> {
    const mode = session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE;
    const existing = this.cursorSessionIds.get(session.id);
    if (existing?.mode === mode) {
      return existing.acpSessionId;
    }
    if (existing && existing.mode !== mode) {
      this.resetCursorSession(session.id);
    }
    const provider = this.getProvider(mode);
    const transport = this.getTransport(mode);
    this.log('agent.runtime.session_new_start', { sessionId: session.id, mode });
    const response = await transport.request(
      'session/new',
      provider.buildSessionCreateParams(),
      this.config.requestTimeoutMs,
      session.id
    );
    if (response.error) {
      this.log('agent.runtime.session_new_failed', {
        sessionId: session.id,
        mode,
        error: response.error
      });
      throw new Error(response.error.message);
    }
    const result = response.result as { sessionId?: string } | undefined;
    if (!result?.sessionId) {
      throw new Error('Cursor ACP did not return a sessionId');
    }
    this.log('agent.runtime.session_new_success', { sessionId: session.id, acpSessionId: result.sessionId, mode });
    this.cursorSessionIds.set(session.id, { mode, acpSessionId: result.sessionId });
    this.cursorSessionLookup.set(result.sessionId, { localSessionId: session.id, mode });
    return result.sessionId;
  }

  async handleMcpJsonMessage(raw: string | Record<string, unknown>): Promise<string | null> {
    return this.mcpServer.handleJsonMessage(raw);
  }

  async runBatchAnalysis(
    request: AgentAnalysisRunRequest,
    emit: (payload: AgentStreamingPayload) => Promise<void> | void,
    isCancelled: () => boolean
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
      locale: request.locale,
      timeoutMs: request.timeoutMs ?? this.config.requestTimeoutMs
    });

    try {
      await this.transit(
        session,
        {
          task: 'analyze_batch',
          batchId: request.batchId,
          prompt: request.prompt,
          locale: request.locale,
          templatePackId: request.templatePackId
        },
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
        kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
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
        kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
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
    isCancelled: () => boolean
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
          locale: request.locale
        },
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
        kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
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
        kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
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
    await Promise.all(Array.from(this.transports.values()).map((transport) => transport.stop()));
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
        kbAccessMode: input.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
        type: 'localeVariantId' in input ? 'article_edit' : 'batch_analysis',
        batchId: 'batchId' in input ? input.batchId : undefined,
        locale: input.locale,
        templatePackId: 'templatePackId' in input ? input.templatePackId : undefined,
        scope:
          'localeVariantScope' in input && input.localeVariantScope ? { localeVariantIds: input.localeVariantScope } : undefined
      };
      session = this.createSession(createRequest);
    } else if (input.kbAccessMode && input.kbAccessMode !== session.kbAccessMode) {
      this.resetCursorSession(session.id);
      session.kbAccessMode = input.kbAccessMode;
    }
    if (session.status === 'closed') {
      throw new Error('Cannot run request against closed session');
    }
    if (!session.kbAccessMode) {
      session.kbAccessMode = input.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE;
    }
    session.status = 'running';
    session.updatedAtUtc = new Date().toISOString();
    return session;
  }

  private async transit(
    session: AgentSessionRecord,
    taskPayload: Record<string, unknown>,
    emit: (payload: Omit<AgentStreamingPayload, 'sessionId' | 'atUtc'>) => void,
    toolCalls: AgentRunResult['toolCalls'],
    isCancelled: () => boolean,
    timeoutMs: number
  ): Promise<void> {
    const mode = session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE;
    const provider = this.getProvider(mode);
    const requestEnvelope = {
      session,
      task: taskPayload
    };

    this.activeStreamEmitters.set(session.id, emit);
    try {
      // Log runtime mode in transcript so CLI-mode runs are identifiable in history
      await this.appendTranscriptLine(
        session.id,
        'system',
        'runtime_mode',
        JSON.stringify({ kbAccessMode: mode, provider: provider.provider, terminalEnabled: provider.terminalEnabled })
      );
      emit({ kind: 'session_started', data: { ...requestEnvelope, kbAccessMode: mode }, message: 'Session started' });
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
          const transport = this.getTransport(provider.mode);
          this.log('agent.runtime.ensure_initialized_start', {
            workspaceId: session.workspaceId,
            sessionId: session.id,
            kbAccessMode: provider.mode
          });
          const initialized = await transport.ensureInitialized(timeoutMs);
          if (!initialized) {
            throw new Error('Cursor ACP initialize failed');
          }
          this.log('agent.runtime.ensure_initialized_success', {
            workspaceId: session.workspaceId,
            sessionId: session.id,
            kbAccessMode: provider.mode
          });
          const acpSessionId = await this.ensureAcpSession(session);
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
            kbAccessMode: provider.mode,
            promptLength: promptText.length
          });
          const response = await transport.request(
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
    const provider = this.getProvider(session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE);
    if (taskPayload.task !== 'analyze_batch') {
      return provider.getPromptTaskBuilder(session, taskPayload);
    }

    const batchId = typeof taskPayload.batchId === 'string' ? taskPayload.batchId : session.batchId ?? '';
    if (!batchId) {
      return provider.getPromptTaskBuilder(session, taskPayload);
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

    return provider.getPromptTaskBuilder(session, taskPayload, {
      batchContext,
      uploadedPbis,
      articleDirectory
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

    const params = message.params as {
      sessionId?: string;
      update?: {
        sessionUpdate?: string;
        toolCallId?: string;
        title?: string;
        kind?: string;
        status?: string;
        rawInput?: unknown;
      };
    };
    const sessionInfo = typeof params.sessionId === 'string' ? this.cursorSessionLookup.get(params.sessionId) : undefined;
    if (!sessionInfo) {
      return;
    }
    const localSessionId = sessionInfo.localSessionId;

    const payload = JSON.stringify(message.params);
    await this.appendTranscriptLine(localSessionId, 'from_agent', 'session_update', payload);

    // Audit and enforce CLI-mode tool calls from ACP session updates so they appear in tool call history
    if (sessionInfo.mode === 'cli' && params.update?.toolCallId && params.update.title) {
      const session = this.sessions.get(localSessionId);
      if (session) {
        const policy = this.evaluateCliToolPolicy(params.update.title, params.update.kind);
        this.toolCallAudit.push({
          workspaceId: session.workspaceId,
          sessionId: localSessionId,
          toolName: params.update.title,
          args: params.update.rawInput ?? { kind: params.update.kind },
          calledAtUtc: new Date().toISOString(),
          allowed: policy.allowed,
          reason: policy.reason
        });
        if (!policy.allowed && typeof params.sessionId === 'string') {
          this.log('agent.runtime.cli_tool_policy_violation', {
            sessionId: localSessionId,
            acpSessionId: params.sessionId,
            toolName: params.update.title,
            kind: params.update.kind,
            reason: policy.reason
          });
          await this.appendTranscriptLine(
            localSessionId,
            'system',
            'cli_tool_policy_violation',
            JSON.stringify({
              toolName: params.update.title,
              kind: params.update.kind,
              reason: policy.reason
            })
          );
          this.getTransport('cli').abortPromptSession(params.sessionId, policy.reason);
        }
      }
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

  private async ensureTranscriptPath(sessionId: string, runId: string): Promise<string> {
    const transcriptDir = path.resolve(this.config.workspaceRoot, DEFAULT_TRANSCRIPT_DIR, sessionId);
    await mkdir(transcriptDir, { recursive: true });
    const filePath = path.join(transcriptDir, `${runId}.jsonl`);
    this.transcripts.set(sessionId, filePath);
    await appendFile(filePath, `${JSON.stringify({ atUtc: new Date().toISOString(), direction: 'system', event: 'transcript_start', payload: runId })}\n`, 'utf8');
    return filePath;
  }

  private resolveBinary(mode: KbAccessMode): string {
    return mode === 'cli' ? this.config.cliBinary : this.config.mcpBinary;
  }

  private isCursorAvailable(mode: KbAccessMode): boolean {
    const checkPaths = [this.resolveBinary(mode), 'cursor', 'cursor.exe'];
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

  private async canReachCursor(mode: KbAccessMode): Promise<boolean> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= ACP_HEALTH_INIT_ATTEMPTS; attempt += 1) {
      const transport = this.getTransport(mode);
      try {
        const response = await transport.ensureInitialized(ACP_HEALTH_INIT_TIMEOUT_MS);
        if (response) {
          return true;
        }
        lastError = new Error('Cursor ACP initialize returned false');
      } catch (error) {
        lastError = error;
      }

      this.log('agent.runtime.acp_transport_unreachable', {
        mode,
        attempt,
        maxAttempts: ACP_HEALTH_INIT_ATTEMPTS,
        message: lastError instanceof Error ? lastError.message : String(lastError)
      });

      if (attempt < ACP_HEALTH_INIT_ATTEMPTS) {
        await transport.stop();
        this.transports.delete(mode);
      }
    }

    return false;
  }

  private getTransport(mode: KbAccessMode): CursorTransport {
    const existing = this.transports.get(mode);
    if (existing) {
      return existing;
    }
    const provider = this.getProvider(mode);
    const transportBinary = this.resolveBinary(mode);
    const transport = new CursorTransport(
      transportBinary,
      this.config.cursorArgs,
      this.config.acpCwd,
      provider.terminalEnabled,
      (sessionId, line) => {
        const targetSessionId = sessionId?.trim() || 'system';
        void this.appendTranscriptLine(targetSessionId, line.direction, line.event, line.payload);
      },
      (message) => {
        void this.handleTransportNotification(message);
      }
    );
    this.transports.set(mode, transport);
    return transport;
  }

  private evaluateCliToolPolicy(toolName: string, kind?: string): { allowed: boolean; reason: string } {
    const normalizedToolName = toolName.trim().toLowerCase();
    const normalizedKind = kind?.trim().toLowerCase() ?? 'unknown';

    if (normalizedToolName === 'read file') {
      return {
        allowed: false,
        reason: 'CLI mode forbids Read File; use kb CLI output instead'
      };
    }

    if (normalizedToolName === 'grep') {
      return {
        allowed: false,
        reason: 'CLI mode forbids grep; use kb CLI output instead'
      };
    }

    return {
      allowed: true,
      reason: `CLI mode ACP tool call allowed: ${toolName} (${normalizedKind})`
    };
  }

  private resolveMcpServerConfigs(): AcpMcpServerConfig[] {
    if (this.runtimeMcpServers.length > 0) {
      return this.runtimeMcpServers;
    }
    if (this.configuredMcpServers.length > 0) {
      return this.configuredMcpServers;
    }
    return buildBridgeMcpServerConfig();
  }

  private getProvider(mode: KbAccessMode): KbAccessProvider {
    if (mode === 'cli') {
      return {
        mode: 'cli',
        provider: 'cli',
        terminalEnabled: true,
        buildSessionCreateParams: () => ({
          cwd: this.config.acpCwd,
          mcpServers: [],
          config: { mode: 'agent' }
        }),
        getPromptTaskBuilder: (session, taskPayload, extras) => {
          const prompt = buildCliTaskPrompt(session, taskPayload, extras);
          const suffix = this.runtimeOptions.buildCliPromptSuffix?.();
          const trimmedSuffix = suffix?.trim();
          return trimmedSuffix ? `${prompt}\n\n${trimmedSuffix}` : prompt;
        },
        getHealth: (workspaceId?: string) => this.getCliHealth(workspaceId)
      };
    }

    return {
      mode: 'mcp',
      provider: 'mcp',
      terminalEnabled: false,
      buildSessionCreateParams: () => {
        const mcpServers = this.resolveMcpServerConfigs();
        return {
          cwd: this.config.acpCwd,
          ...(mcpServers.length > 0 ? { mcpServers } : {}),
          config: { mode: 'agent' }
        };
      },
      getPromptTaskBuilder: (session, taskPayload, extras) => buildMcpTaskPrompt(session, taskPayload, extras),
      getHealth: (_workspaceId?: string) => this.getMcpHealth()
    };
  }

  private async getProviderHealth(mode: KbAccessMode, workspaceId?: string): Promise<KbAccessHealth> {
    return this.getProvider(mode).getHealth(workspaceId);
  }

  private async getMcpHealth(): Promise<KbAccessHealth> {
    const issues: string[] = [];
    const cursorInstalled = this.isCursorAvailable('mcp');
    if (!cursorInstalled) {
      issues.push('Cursor binary not found');
    }
    const acpReachable = cursorInstalled ? await this.canReachCursor('mcp') : false;
    if (cursorInstalled && !acpReachable) {
      issues.push('Cursor ACP command did not initialize');
    }
    const mcpServers = this.resolveMcpServerConfigs();
    if (mcpServers.length === 0) {
      issues.push('MCP server configuration is unavailable');
    }
    if (this.mcpServer.toolCount() === 0) {
      issues.push('KB Vault MCP tool server has no registered tools');
    }

    const ok = cursorInstalled && acpReachable && mcpServers.length > 0 && this.mcpServer.toolCount() > 0;
    const result: KbAccessHealth = {
      mode: 'mcp',
      provider: 'mcp',
      ok,
      acpReachable,
      binaryPath: cursorInstalled ? this.config.mcpBinary : undefined,
      message: ok ? 'MCP access ready' : issues[0] ?? 'MCP access unavailable',
      issues
    };
    this.log('agent.runtime.mcp_health_result', {
      ok: result.ok,
      acpReachable: result.acpReachable,
      binaryPath: result.binaryPath,
      message: result.message,
      issues: result.issues
    });
    return result;
  }

  private async getCliHealth(workspaceId?: string): Promise<KbAccessHealth> {
    if (!this.runtimeOptions.getCliHealth) {
      return {
        mode: 'cli',
        provider: 'cli',
        ok: false,
        acpReachable: false,
        message: 'CLI runtime service unavailable',
        issues: ['CLI runtime service is not configured']
      };
    }

    try {
      const health = await this.runtimeOptions.getCliHealth(workspaceId);
      const issues = [...(health.issues ?? [])];
      const acpReachable = await this.canReachCursor('cli');
      if (!acpReachable) {
        issues.push('Cursor ACP transport is not reachable');
      }
      const ok = Boolean(health.ok && acpReachable);
      const healthReady = health.ok && !acpReachable ? 'Cursor ACP transport is not reachable' : undefined;
      const message = ok
        ? (health.message ?? 'CLI access ready')
        : (healthReady ?? health.message ?? issues[0] ?? 'CLI access unavailable');
      const result: KbAccessHealth = {
        ...health,
        mode: 'cli',
        provider: 'cli',
        acpReachable,
        ok,
        issues,
        message,
        binaryPath: health.binaryPath || this.resolveBinary('cli'),
        failureCode: ok ? undefined : (health.ok ? CliHealthFailure.HEALTH_PROBE_REJECTED : health.failureCode)
      };
      this.log('agent.runtime.cli_health_result', {
        workspaceId,
        ok: result.ok,
        baseHealthOk: health.ok,
        acpReachable: result.acpReachable,
        binaryPath: result.binaryPath,
        failureCode: result.failureCode,
        message: result.message,
        issues: result.issues
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result: KbAccessHealth = {
        mode: 'cli',
        provider: 'cli',
        ok: false,
        acpReachable: false,
        message,
        issues: [message]
      };
      this.log('agent.runtime.cli_health_failed', {
        workspaceId,
        message,
        stack: error instanceof Error ? error.stack : undefined
      });
      return result;
    }
  }

  private resetCursorSession(sessionId: string): void {
    const existing = this.cursorSessionIds.get(sessionId);
    if (!existing) {
      return;
    }
    this.cursorSessionIds.delete(sessionId);
    this.cursorSessionLookup.delete(existing.acpSessionId);
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
