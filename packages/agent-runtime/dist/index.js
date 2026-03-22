"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpToolServer = exports.AGENT_RUNTIME_VERSION = exports.AgentRuntimeService = exports.CursorAcpRuntime = void 0;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_process_1 = __importDefault(require("node:process"));
const node_child_process_1 = require("node:child_process");
const mcp_server_1 = require("@kb-vault/mcp-server");
const shared_types_1 = require("@kb-vault/shared-types");
const DEFAULT_AGENT_ACCESS_MODE = 'mcp';
const KB_CLI_BINARY_ENV = 'KBV_KB_CLI_BINARY';
const KBV_CURSOR_BINARY_ENV = 'KBV_CURSOR_BINARY';
const DEFAULT_CURSOR_BINARY = 'cursor';
const DEFAULT_CURSOR_ARGS = ['agent', 'acp'];
const DEFAULT_CLI_BINARY = 'kb';
function resolveDefaultCursorBinary() {
    const candidates = node_process_1.default.platform === 'darwin'
        ? [
            '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
            '/Applications/Cursor.app/Contents/MacOS/Cursor'
        ]
        : [];
    for (const candidate of candidates) {
        if (node_fs_1.default.existsSync(candidate)) {
            return candidate;
        }
    }
    return DEFAULT_CURSOR_BINARY;
}
function buildMcpTaskPrompt(session, taskPayload, extras) {
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
function buildCliTaskPrompt(session, taskPayload, extras) {
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
const DEFAULT_TRANSCRIPT_DIR = '.meta/agent-transcripts';
function loadConfiguredMcpServers() {
    const raw = node_process_1.default.env.KBV_MCP_TOOLS?.trim();
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.filter((entry) => Boolean(entry) && typeof entry === 'object');
        }
        if (parsed && typeof parsed === 'object') {
            return [parsed];
        }
    }
    catch {
        return [];
    }
    return [];
}
function buildBridgeMcpServerConfig() {
    const socketPath = node_process_1.default.env.KBV_MCP_BRIDGE_SOCKET_PATH?.trim();
    const bridgeScript = node_process_1.default.env.KBV_MCP_BRIDGE_SCRIPT?.trim();
    const nodeBinary = node_process_1.default.env.KBV_NODE_BINARY?.trim() || 'node';
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
    binary;
    args;
    cwd;
    terminalEnabled;
    logger;
    notificationHandler;
    proc = null;
    connected = false;
    initialized = false;
    nextRequestId = 0;
    pending = new Map();
    buffer = '';
    constructor(binary, args, cwd, terminalEnabled, logger, notificationHandler) {
        this.binary = binary;
        this.args = args;
        this.cwd = cwd;
        this.terminalEnabled = terminalEnabled;
        this.logger = logger;
        this.notificationHandler = notificationHandler;
    }
    async startIfNeeded() {
        if (this.connected) {
            return;
        }
        await new Promise((resolve, reject) => {
            const proc = (0, node_child_process_1.spawn)(this.binary, this.args, {
                cwd: this.cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: node_process_1.default.env
            });
            this.proc = proc;
            proc.stdout?.on('data', (chunk) => {
                this.buffer += chunk.toString('utf8');
                this.logger('system', { direction: 'from_agent', event: 'stdout', payload: chunk.toString('utf8') });
                this.flushBuffer();
            });
            proc.stderr?.on('data', (chunk) => {
                this.logger('system', { direction: 'from_agent', event: 'stderr', payload: chunk.toString('utf8') });
            });
            proc.on('error', (error) => {
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
    async stop() {
        if (!this.proc) {
            return;
        }
        this.proc.kill();
        this.proc = null;
        this.connected = false;
        this.initialized = false;
    }
    async request(method, params, timeoutMs, sessionId) {
        const logSessionId = sessionId?.trim() || 'system';
        await this.startIfNeeded();
        const id = `${Date.now()}-${this.nextRequestId++}`;
        const envelope = { jsonrpc: '2.0', id, method, params };
        this.logger(logSessionId, { direction: 'to_agent', event: 'request', payload: JSON.stringify(envelope) });
        return new Promise((resolve, reject) => {
            const watchedSessionId = method === 'session/prompt' && params && typeof params === 'object' && 'sessionId' in params
                ? String(params.sessionId ?? '')
                : undefined;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`ACP request timeout (${method})`));
            }, timeoutMs);
            const pendingRequest = {
                method,
                watchedSessionId,
                timeoutMs,
                resolve: (result) => {
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
    abortPromptSession(sessionId, reason) {
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
    async ensureInitialized(timeoutMs) {
        if (this.initialized) {
            return true;
        }
        const init = await this.request('initialize', {
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
        }, timeoutMs);
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
    respond(id, result) {
        if (!this.proc?.stdin) {
            return;
        }
        this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
        this.logger('system', { direction: 'to_agent', event: 'response', payload: JSON.stringify({ id, result }) });
    }
    handleNotification(message) {
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
    bumpPromptTimeouts(params) {
        const sessionId = params && typeof params === 'object' && 'sessionId' in params
            ? String(params.sessionId ?? '')
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
    flushBuffer() {
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';
        for (const line of lines.map((entry) => entry.trim()).filter(Boolean)) {
            try {
                const parsed = JSON.parse(line);
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
                }
                else {
                    pending.resolve(parsed);
                }
            }
            catch {
                // Ignore malformed lines; Cursor can emit non-json noise.
            }
        }
    }
    rejectAllPending(error) {
        for (const request of this.pending.values()) {
            request.reject(error);
        }
        this.pending.clear();
    }
}
class CursorAcpRuntime {
    config;
    sessions = new Map();
    transcripts = new Map();
    toolCallAudit = [];
    mcpServer;
    transports = new Map();
    cursorSessionIds = new Map();
    cursorSessionLookup = new Map();
    activeStreamEmitters = new Map();
    debugLogger;
    configuredMcpServers;
    runtimeMcpServers = [];
    toolContext;
    runtimeOptions;
    constructor(workspaceRoot, toolContext, runtimeOptions = {}, debugLogger) {
        const acpCwd = node_process_1.default.env.KBV_ACP_CWD?.trim() || node_process_1.default.cwd();
        const cursorBinary = node_process_1.default.env[KBV_CURSOR_BINARY_ENV]?.trim() || resolveDefaultCursorBinary();
        this.config = {
            workspaceRoot,
            acpCwd,
            mcpBinary: cursorBinary,
            cliBinary: cursorBinary || DEFAULT_CLI_BINARY,
            cursorArgs: DEFAULT_CURSOR_ARGS,
            requestTimeoutMs: 45_000
        };
        this.mcpServer = new mcp_server_1.McpToolServer();
        this.toolContext = toolContext;
        this.runtimeOptions = runtimeOptions;
        this.debugLogger = debugLogger ?? (() => undefined);
        this.configuredMcpServers = loadConfiguredMcpServers();
        this.registerToolImplementations(this.mcpServer, toolContext);
    }
    log(message, details) {
        this.debugLogger(message, details);
    }
    getSession(sessionId) {
        return this.sessions.get(sessionId) ?? null;
    }
    setMcpServerConfigs(configs) {
        this.runtimeMcpServers = configs.filter((entry) => Boolean(entry) && typeof entry === 'object');
    }
    listSessions(workspaceId, includeClosed = false) {
        return Array.from(this.sessions.values()).filter((session) => {
            if (session.workspaceId !== workspaceId) {
                return false;
            }
            return includeClosed || session.status !== 'closed';
        });
    }
    createSession(input) {
        const id = (0, node_crypto_1.randomUUID)();
        const now = new Date().toISOString();
        const session = {
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
    closeSession(input) {
        const session = this.sessions.get(input.sessionId);
        if (!session || session.workspaceId !== input.workspaceId) {
            return null;
        }
        session.status = 'closed';
        session.updatedAtUtc = new Date().toISOString();
        return session;
    }
    async checkHealth(workspaceId, selectedMode = DEFAULT_AGENT_ACCESS_MODE, workspaceKbAccessMode) {
        this.log('agent.runtime.health_check_start', {
            workspaceId,
            selectedMode,
            workspaceKbAccessMode: workspaceKbAccessMode ?? selectedMode
        });
        const [mcp, cli] = await Promise.all([
            this.getProviderHealth('mcp'),
            this.getProviderHealth('cli', workspaceId)
        ]);
        const aggregatedIssues = Array.from(new Set([
            ...(mcp.issues ?? []),
            ...(cli.issues ?? []),
            ...(!mcp.ok && mcp.message && !(mcp.issues ?? []).includes(mcp.message) ? [mcp.message] : []),
            ...(!cli.ok && cli.message && !(cli.issues ?? []).includes(cli.message) ? [cli.message] : [])
        ].filter(Boolean)));
        const availableModes = [mcp, cli].filter((provider) => provider.ok).map((provider) => provider.mode);
        // If the selected mode is unavailable but the workspace preference is, flag an issue
        if (!availableModes.includes(selectedMode) && availableModes.length > 0) {
            aggregatedIssues.push(`Selected mode "${selectedMode}" is unavailable; available: ${availableModes.join(', ')}`);
        }
        const result = {
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
    async ensureAcpSession(session) {
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
        const response = await transport.request('session/new', provider.buildSessionCreateParams(), this.config.requestTimeoutMs, session.id);
        if (response.error) {
            this.log('agent.runtime.session_new_failed', {
                sessionId: session.id,
                mode,
                error: response.error
            });
            throw new Error(response.error.message);
        }
        const result = response.result;
        if (!result?.sessionId) {
            throw new Error('Cursor ACP did not return a sessionId');
        }
        this.log('agent.runtime.session_new_success', { sessionId: session.id, acpSessionId: result.sessionId, mode });
        this.cursorSessionIds.set(session.id, { mode, acpSessionId: result.sessionId });
        this.cursorSessionLookup.set(result.sessionId, { localSessionId: session.id, mode });
        return result.sessionId;
    }
    async handleMcpJsonMessage(raw) {
        return this.mcpServer.handleJsonMessage(raw);
    }
    async runBatchAnalysis(request, emit, isCancelled) {
        const session = await this.resolveSession(request);
        const startedAt = new Date().toISOString();
        const runId = (0, node_crypto_1.randomUUID)();
        const transcriptPath = await this.ensureTranscriptPath(session.id, runId);
        const toolCalls = [];
        const rawOutput = [];
        this.log('agent.runtime.batch_analysis_begin', {
            workspaceId: request.workspaceId,
            batchId: request.batchId,
            locale: request.locale,
            timeoutMs: request.timeoutMs ?? this.config.requestTimeoutMs
        });
        try {
            await this.transit(session, {
                task: 'analyze_batch',
                batchId: request.batchId,
                prompt: request.prompt,
                locale: request.locale,
                templatePackId: request.templatePackId
            }, (event) => {
                rawOutput.push(event.message ?? JSON.stringify(event.data ?? {}));
                emit({ sessionId: session.id, kind: event.kind, data: event.data, message: event.message, atUtc: new Date().toISOString() });
            }, toolCalls, isCancelled, request.timeoutMs ?? this.config.requestTimeoutMs);
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
        }
        catch (error) {
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
        }
        finally {
            session.updatedAtUtc = new Date().toISOString();
            session.status = 'idle';
            this.log('agent.runtime.batch_analysis_complete', {
                workspaceId: request.workspaceId,
                batchId: request.batchId,
                sessionId: session.id
            });
        }
    }
    async runArticleEdit(request, emit, isCancelled) {
        const session = await this.resolveSession(request);
        const startedAt = new Date().toISOString();
        const runId = (0, node_crypto_1.randomUUID)();
        const transcriptPath = await this.ensureTranscriptPath(session.id, runId);
        const toolCalls = [];
        const rawOutput = [];
        this.log('agent.runtime.article_edit_begin', {
            workspaceId: request.workspaceId,
            localeVariantId: request.localeVariantId,
            timeoutMs: request.timeoutMs ?? this.config.requestTimeoutMs
        });
        try {
            await this.transit(session, {
                task: 'edit_article',
                localeVariantId: request.localeVariantId,
                prompt: request.prompt,
                locale: request.locale
            }, (event) => {
                rawOutput.push(event.message ?? JSON.stringify(event.data ?? {}));
                emit({ sessionId: session.id, kind: event.kind, data: event.data, message: event.message, atUtc: new Date().toISOString() });
            }, toolCalls, isCancelled, request.timeoutMs ?? this.config.requestTimeoutMs);
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
        }
        catch (error) {
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
        }
        finally {
            session.status = 'idle';
            session.updatedAtUtc = new Date().toISOString();
            this.log('agent.runtime.article_edit_complete', {
                workspaceId: request.workspaceId,
                localeVariantId: request.localeVariantId,
                sessionId: session.id
            });
        }
    }
    async getTranscripts(input) {
        const session = this.sessions.get(input.sessionId);
        if (!session || session.workspaceId !== input.workspaceId) {
            return {
                workspaceId: input.workspaceId,
                sessionId: input.sessionId,
                lines: []
            };
        }
        const transcriptPath = this.transcripts.get(session.id);
        if (!transcriptPath || !node_fs_1.default.existsSync(transcriptPath)) {
            return { workspaceId: input.workspaceId, sessionId: input.sessionId, lines: [] };
        }
        const text = await node_fs_1.default.promises.readFile(transcriptPath, 'utf8');
        const parsed = text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
            try {
                return JSON.parse(line);
            }
            catch {
                return {
                    atUtc: new Date().toISOString(),
                    direction: 'system',
                    event: 'line_parse_error',
                    payload: line
                };
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
    listToolCallAudit(sessionId, workspaceId) {
        return this.toolCallAudit.filter((audit) => audit.sessionId === sessionId && audit.workspaceId === workspaceId);
    }
    async stop() {
        await Promise.all(Array.from(this.transports.values()).map((transport) => transport.stop()));
    }
    async resolveSession(input) {
        const existing = input.sessionId ? this.getSession(input.sessionId) : null;
        let session = existing;
        if (!session) {
            if (!input.workspaceId) {
                throw new Error('workspaceId is required');
            }
            const createRequest = {
                workspaceId: input.workspaceId,
                kbAccessMode: input.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
                type: 'localeVariantId' in input ? 'article_edit' : 'batch_analysis',
                batchId: 'batchId' in input ? input.batchId : undefined,
                locale: input.locale,
                templatePackId: 'templatePackId' in input ? input.templatePackId : undefined,
                scope: 'localeVariantScope' in input && input.localeVariantScope ? { localeVariantIds: input.localeVariantScope } : undefined
            };
            session = this.createSession(createRequest);
        }
        else if (input.kbAccessMode && input.kbAccessMode !== session.kbAccessMode) {
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
    async transit(session, taskPayload, emit, toolCalls, isCancelled, timeoutMs) {
        const mode = session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE;
        const provider = this.getProvider(mode);
        const requestEnvelope = {
            session,
            task: taskPayload
        };
        this.activeStreamEmitters.set(session.id, emit);
        try {
            // Log runtime mode in transcript so CLI-mode runs are identifiable in history
            await this.appendTranscriptLine(session.id, 'system', 'runtime_mode', JSON.stringify({ kbAccessMode: mode, provider: provider.provider, terminalEnabled: provider.terminalEnabled }));
            emit({ kind: 'session_started', data: { ...requestEnvelope, kbAccessMode: mode }, message: 'Session started' });
            const requestEnvelopeString = JSON.stringify(requestEnvelope);
            const promptText = await this.buildPromptText(session, taskPayload);
            const context = {
                workspaceId: session.workspaceId,
                allowedLocaleVariantIds: session.scope?.localeVariantIds,
                allowedFamilyIds: session.scope?.familyIds
            };
            const transcriptPath = this.transcripts.get(session.id) ?? '';
            const response = await this.executeWithRetry(async () => {
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
                const response = await transport.request('session/prompt', requestPayload, timeoutMs, session.id);
                this.log('agent.runtime.prompt_response', {
                    workspaceId: session.workspaceId,
                    sessionId: session.id,
                    hasError: Boolean(response.error)
                });
                if (response.error) {
                    throw new Error(response.error.message);
                }
                return response.result;
            }, 3, isCancelled);
            emit({ kind: 'result', data: response, message: 'Run complete' });
            await (0, promises_1.appendFile)(transcriptPath, `${JSON.stringify({ atUtc: new Date().toISOString(), direction: 'to_agent', event: requestEnvelopeString, payload: requestEnvelopeString })}\n`, 'utf8');
        }
        finally {
            this.activeStreamEmitters.delete(session.id);
        }
    }
    async buildPromptText(session, taskPayload) {
        const provider = this.getProvider(session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE);
        if (taskPayload.task !== 'analyze_batch') {
            return provider.getPromptTaskBuilder(session, taskPayload);
        }
        const batchId = typeof taskPayload.batchId === 'string' ? taskPayload.batchId : session.batchId ?? '';
        if (!batchId) {
            return provider.getPromptTaskBuilder(session, taskPayload);
        }
        let batchContext;
        let uploadedPbis;
        let articleDirectory = '';
        try {
            batchContext = await this.toolContext.getBatchContext({
                workspaceId: session.workspaceId,
                batchId
            });
        }
        catch {
            batchContext = undefined;
        }
        try {
            uploadedPbis = await this.toolContext.getPBISubset({
                workspaceId: session.workspaceId,
                batchId
            });
        }
        catch {
            uploadedPbis = undefined;
        }
        try {
            const tree = await this.toolContext.getExplorerTree(session.workspaceId);
            articleDirectory = summarizeExplorerTree(tree);
        }
        catch {
            articleDirectory = '';
        }
        return provider.getPromptTaskBuilder(session, taskPayload, {
            batchContext,
            uploadedPbis,
            articleDirectory
        });
    }
    async executeWithRetry(fn, maxAttempts, isCancelled) {
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
            }
            catch (error) {
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
    async handleTransportNotification(message) {
        if (message.method !== 'session/update' || !message.params) {
            return;
        }
        const params = message.params;
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
                    await this.appendTranscriptLine(localSessionId, 'system', 'cli_tool_policy_violation', JSON.stringify({
                        toolName: params.update.title,
                        kind: params.update.kind,
                        reason: policy.reason
                    }));
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
    async ensureTranscriptPath(sessionId, runId) {
        const transcriptDir = node_path_1.default.resolve(this.config.workspaceRoot, DEFAULT_TRANSCRIPT_DIR, sessionId);
        await (0, promises_1.mkdir)(transcriptDir, { recursive: true });
        const filePath = node_path_1.default.join(transcriptDir, `${runId}.jsonl`);
        this.transcripts.set(sessionId, filePath);
        await (0, promises_1.appendFile)(filePath, `${JSON.stringify({ atUtc: new Date().toISOString(), direction: 'system', event: 'transcript_start', payload: runId })}\n`, 'utf8');
        return filePath;
    }
    resolveBinary(mode) {
        return mode === 'cli' ? this.config.cliBinary : this.config.mcpBinary;
    }
    isCursorAvailable(mode) {
        const checkPaths = [this.resolveBinary(mode), 'cursor', 'cursor.exe'];
        return checkPaths.some((binary) => {
            if (!binary) {
                return false;
            }
            if (node_path_1.default.isAbsolute(binary)) {
                return node_fs_1.default.existsSync(binary);
            }
            const searchPath = node_process_1.default.env.PATH ?? '';
            return searchPath.split(node_path_1.default.delimiter).some((dir) => {
                if (!dir) {
                    return false;
                }
                const exe = node_path_1.default.join(dir, binary);
                const exeWithExt = node_path_1.default.extname(exe).length > 0 ? exe : `${exe}.exe`;
                return node_fs_1.default.existsSync(exe) || node_fs_1.default.existsSync(exeWithExt);
            });
        });
    }
    async canReachCursor(mode) {
        try {
            const response = await this.getTransport(mode).ensureInitialized(1000);
            return response;
        }
        catch (error) {
            this.log('agent.runtime.acp_transport_unreachable', {
                mode,
                message: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }
    getTransport(mode) {
        const existing = this.transports.get(mode);
        if (existing) {
            return existing;
        }
        const provider = this.getProvider(mode);
        const transportBinary = this.resolveBinary(mode);
        const transport = new CursorTransport(transportBinary, this.config.cursorArgs, this.config.acpCwd, provider.terminalEnabled, (sessionId, line) => {
            const targetSessionId = sessionId?.trim() || 'system';
            void this.appendTranscriptLine(targetSessionId, line.direction, line.event, line.payload);
        }, (message) => {
            void this.handleTransportNotification(message);
        });
        this.transports.set(mode, transport);
        return transport;
    }
    evaluateCliToolPolicy(toolName, kind) {
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
    resolveMcpServerConfigs() {
        if (this.runtimeMcpServers.length > 0) {
            return this.runtimeMcpServers;
        }
        if (this.configuredMcpServers.length > 0) {
            return this.configuredMcpServers;
        }
        return buildBridgeMcpServerConfig();
    }
    getProvider(mode) {
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
                getHealth: (workspaceId) => this.getCliHealth(workspaceId)
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
            getHealth: (_workspaceId) => this.getMcpHealth()
        };
    }
    async getProviderHealth(mode, workspaceId) {
        return this.getProvider(mode).getHealth(workspaceId);
    }
    async getMcpHealth() {
        const issues = [];
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
        const result = {
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
    async getCliHealth(workspaceId) {
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
            const result = {
                ...health,
                mode: 'cli',
                provider: 'cli',
                acpReachable,
                ok,
                issues,
                message,
                binaryPath: health.binaryPath || this.resolveBinary('cli'),
                failureCode: ok ? undefined : (health.ok ? shared_types_1.CliHealthFailure.HEALTH_PROBE_REJECTED : health.failureCode)
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
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const result = {
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
    resetCursorSession(sessionId) {
        const existing = this.cursorSessionIds.get(sessionId);
        if (!existing) {
            return;
        }
        this.cursorSessionIds.delete(sessionId);
        this.cursorSessionLookup.delete(existing.acpSessionId);
    }
    async appendTranscriptLine(sessionId, direction, event, payload) {
        const path = this.transcripts.get(sessionId);
        if (!path) {
            return;
        }
        await (0, promises_1.appendFile)(path, `${JSON.stringify({
            atUtc: new Date().toISOString(),
            direction,
            event,
            payload
        })}\n`, 'utf8');
    }
    registerToolImplementations(server, toolContext) {
        const enforceScope = (input, context, scope) => {
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
        const wrappers = {
            search_kb: {
                description: 'Search local KB cache for likely article candidates.',
                handler: async (input, context, log) => {
                    const parsed = input;
                    parsed.workspaceId = context.workspaceId;
                    const result = await toolContext.findRelatedArticles(parsed);
                    await log({ direction: 'system', event: 'tool_result', payload: 'search_kb returned' });
                    return result;
                }
            },
            get_article: {
                description: 'Load a locale variant or revision payload for one article.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.getArticle(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'get_article' });
                    return result;
                }
            },
            get_article_family: {
                description: 'Load article family metadata.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.getArticleFamily(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'get_article_family' });
                    return result;
                }
            },
            get_locale_variant: {
                description: 'Load a locale variant and metadata.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    enforceScope(payload, context, context.allowedLocaleVariantIds);
                    const result = await toolContext.getLocaleVariant(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'get_locale_variant' });
                    return result;
                },
                requiresScope: true
            },
            find_related_articles: {
                description: 'Search for related article candidates from KB content.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.findRelatedArticles(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'find_related_articles' });
                    return result;
                }
            },
            list_categories: {
                description: 'Get local article categories for locale.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.listCategories(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'list_categories' });
                    return result;
                }
            },
            list_sections: {
                description: 'Get local article sections.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.listSections(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'list_sections' });
                    return result;
                }
            },
            list_article_templates: {
                description: 'Read template packs in the workspace.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.listArticleTemplates(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'list_article_templates' });
                    return result;
                }
            },
            get_template: {
                description: 'Get a single template pack payload.',
                handler: async (input, context, log) => {
                    const payload = input;
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
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.getBatchContext(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'get_batch_context' });
                    return result;
                }
            },
            get_pbi: {
                description: 'Load one PBI record from batch context.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.getPBI(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'get_pbi' });
                    return result;
                }
            },
            get_pbi_subset: {
                description: 'Load PBI subset by row numbers.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.getPBISubset(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'get_pbi_subset' });
                    return result;
                }
            },
            get_article_history: {
                description: 'Read revision history for a locale variant.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    enforceScope(payload, context, context.allowedLocaleVariantIds);
                    const result = await toolContext.getArticleHistory(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'get_article_history' });
                    return result;
                },
                requiresScope: true
            },
            propose_create_kb: {
                description: 'Record a create-kb proposal from agent analysis.',
                handler: async (input, context, log) => {
                    const payload = input;
                    enforceScope(payload, context, context.allowedLocaleVariantIds);
                    const result = toolContext.proposeCreateKb({ ...payload }, context);
                    const resolved = await result;
                    await log({ direction: 'system', event: 'tool_result', payload: 'propose_create_kb' });
                    return resolved;
                },
                requiresScope: true
            },
            propose_edit_kb: {
                description: 'Record an edit-kb proposal from agent analysis.',
                handler: async (input, context, log) => {
                    const payload = input;
                    enforceScope(payload, context, context.allowedLocaleVariantIds);
                    const result = toolContext.proposeEditKb({ ...payload }, context);
                    const resolved = await result;
                    await log({ direction: 'system', event: 'tool_result', payload: 'propose_edit_kb' });
                    return resolved;
                },
                requiresScope: true
            },
            propose_retire_kb: {
                description: 'Record a retire-kb proposal from agent analysis.',
                handler: async (input, context, log) => {
                    const payload = input;
                    enforceScope(payload, context, context.allowedLocaleVariantIds);
                    const result = toolContext.proposeRetireKb({ ...payload }, context);
                    const resolved = await result;
                    await log({ direction: 'system', event: 'tool_result', payload: 'propose_retire_kb' });
                    return resolved;
                },
                requiresScope: true
            },
            record_agent_notes: {
                description: 'Persist structured notes for session debugging/auditing.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.recordAgentNotes(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'record_agent_notes' });
                    return result;
                }
            }
        };
        const audit = async (toolName, input, context, allowed, reason) => {
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
            }
            else {
                auditable.reason = reason;
                this.toolCallAudit.push(auditable);
            }
            await this.appendTranscriptLine(context.workspaceId, 'system', 'tool_call_audit', JSON.stringify(auditable));
        };
        for (const [name, definition] of Object.entries(wrappers)) {
            server.registerTool(name, definition.description, async (input) => {
                const inputWorkspaceId = input?.workspaceId;
                const sessionId = this.getActiveSessionForWorkspace(inputWorkspaceId || '');
                const contextData = this.getScopedContextForSession(sessionId) ?? { workspaceId: input?.workspaceId || '' };
                let allowed = true;
                let reason;
                try {
                    if (definition.requiresScope) {
                        enforceScope(input, contextData, contextData.allowedLocaleVariantIds);
                    }
                    await audit(name, input, contextData, true);
                    const result = await definition.handler(input, contextData, async (line) => {
                        await this.appendTranscriptLine(contextData.workspaceId, line.direction, line.event, line.payload);
                    });
                    return result;
                }
                catch (error) {
                    allowed = false;
                    reason = error instanceof Error ? error.message : String(error);
                    await audit(name, input, contextData, false, reason);
                    throw error;
                }
            });
        }
    }
    getActiveSessionForWorkspace(workspaceId) {
        const candidate = Array.from(this.sessions.values())
            .filter((session) => session.workspaceId === workspaceId && session.status !== 'closed')
            .sort((a, b) => b.updatedAtUtc.localeCompare(a.updatedAtUtc))[0];
        return candidate?.id ?? '';
    }
    getScopedContextForSession(sessionId) {
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
exports.CursorAcpRuntime = CursorAcpRuntime;
class AgentRuntimeService {
    runtime;
    constructor(workspaceRoot, toolContext) {
        this.runtime = new CursorAcpRuntime(workspaceRoot, toolContext);
    }
    getRuntime() {
        return this.runtime;
    }
}
exports.AgentRuntimeService = AgentRuntimeService;
exports.AGENT_RUNTIME_VERSION = '0.1.0';
var mcp_server_2 = require("@kb-vault/mcp-server");
Object.defineProperty(exports, "McpToolServer", { enumerable: true, get: function () { return mcp_server_2.McpToolServer; } });
function summarizeBatchContext(batchContext) {
    if (batchContext === undefined) {
        return 'Unavailable.';
    }
    if (!batchContext || typeof batchContext !== 'object') {
        return JSON.stringify(batchContext);
    }
    const record = batchContext;
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
function summarizeExplorerTree(nodes) {
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
function slugifyForPrompt(input) {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'article';
}
