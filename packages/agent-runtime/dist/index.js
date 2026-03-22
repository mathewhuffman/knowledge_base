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
function buildTaskPrompt(session, taskPayload, extras) {
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
const DEFAULT_TRANSCRIPT_DIR = '.meta/agent-transcripts';
const DEFAULT_CURSOR_BINARY = node_process_1.default.env.KBV_CURSOR_BINARY ?? 'agent';
const DEFAULT_CURSOR_ARGS = ['acp'];
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
    logger;
    notificationHandler;
    proc = null;
    connected = false;
    initialized = false;
    nextRequestId = 0;
    pending = new Map();
    buffer = '';
    constructor(binary, args, cwd, logger, notificationHandler) {
        this.binary = binary;
        this.args = args;
        this.cwd = cwd;
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
                terminal: false
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
    transport;
    cursorSessionIds = new Map();
    cursorSessionLookup = new Map();
    activeStreamEmitters = new Map();
    debugLogger;
    configuredMcpServers;
    toolContext;
    constructor(workspaceRoot, toolContext, debugLogger) {
        const acpCwd = node_process_1.default.env.KBV_ACP_CWD?.trim() || node_process_1.default.cwd();
        this.config = {
            workspaceRoot,
            acpCwd,
            cursorBinary: DEFAULT_CURSOR_BINARY,
            cursorArgs: DEFAULT_CURSOR_ARGS,
            requestTimeoutMs: 45_000
        };
        this.mcpServer = new mcp_server_1.McpToolServer();
        this.toolContext = toolContext;
        this.debugLogger = debugLogger ?? (() => undefined);
        this.configuredMcpServers = loadConfiguredMcpServers();
        this.transport = new CursorTransport(this.config.cursorBinary, this.config.cursorArgs, this.config.acpCwd, (sessionId, line) => {
            const targetSessionId = sessionId?.trim() || 'system';
            void this.appendTranscriptLine(targetSessionId, line.direction, line.event, line.payload);
        }, (message) => {
            void this.handleTransportNotification(message);
        });
        this.registerToolImplementations(this.mcpServer, toolContext);
    }
    log(message, details) {
        this.debugLogger(message, details);
    }
    getSession(sessionId) {
        return this.sessions.get(sessionId) ?? null;
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
    async checkHealth(workspaceId) {
        const issues = [];
        const cursorInstalled = this.isCursorAvailable();
        let acpReachable = false;
        let mcpRunning = false;
        if (cursorInstalled) {
            acpReachable = await this.canReachCursor();
            if (!acpReachable) {
                issues.push('Cursor ACP command did not initialize');
            }
        }
        else {
            issues.push('Cursor binary not found');
        }
        mcpRunning = this.mcpServer.toolCount() > 0;
        const requiredConfigPresent = Boolean(node_process_1.default.env.KBV_CURSOR_BINARY || node_process_1.default.env.KBV_MCP_TOOLS);
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
    async ensureAcpSession(sessionId) {
        const existing = this.cursorSessionIds.get(sessionId);
        if (existing) {
            return existing;
        }
        this.log('agent.runtime.session_new_start', { sessionId });
        const response = await this.transport.request('session/new', this.buildSessionCreateParams(), this.config.requestTimeoutMs, sessionId);
        if (response.error) {
            throw new Error(response.error.message);
        }
        const result = response.result;
        if (!result?.sessionId) {
            throw new Error('Cursor ACP did not return a sessionId');
        }
        this.log('agent.runtime.session_new_success', { sessionId, acpSessionId: result.sessionId });
        this.cursorSessionIds.set(sessionId, result.sessionId);
        this.cursorSessionLookup.set(result.sessionId, sessionId);
        return result.sessionId;
    }
    buildSessionCreateParams() {
        const mcpServers = this.configuredMcpServers.length > 0 ? this.configuredMcpServers : buildBridgeMcpServerConfig();
        return {
            cwd: this.config.acpCwd,
            ...(mcpServers.length > 0 ? { mcpServers } : {}),
            config: {
                mode: 'agent'
            }
        };
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
        await this.transport.stop();
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
                type: 'localeVariantId' in input ? 'article_edit' : 'batch_analysis',
                batchId: 'batchId' in input ? input.batchId : undefined,
                locale: input.locale,
                templatePackId: 'templatePackId' in input ? input.templatePackId : undefined,
                scope: 'localeVariantScope' in input && input.localeVariantScope ? { localeVariantIds: input.localeVariantScope } : undefined
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
    async transit(session, taskPayload, emit, toolCalls, isCancelled, timeoutMs) {
        const requestEnvelope = {
            session,
            task: taskPayload
        };
        this.activeStreamEmitters.set(session.id, emit);
        try {
            emit({ kind: 'session_started', data: requestEnvelope, message: 'Session started' });
            const requestEnvelopeString = JSON.stringify(requestEnvelope);
            const promptText = await this.buildPromptText(session, taskPayload);
            const context = {
                workspaceId: session.workspaceId,
                allowedLocaleVariantIds: session.scope?.localeVariantIds,
                allowedFamilyIds: session.scope?.familyIds
            };
            const transcriptPath = this.transcripts.get(session.id) ?? '';
            const response = await this.executeWithRetry(async () => {
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
                const acpSessionId = await this.ensureAcpSession(session.id);
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
                const response = await this.transport.request('session/prompt', requestPayload, timeoutMs, session.id);
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
        if (taskPayload.task !== 'analyze_batch') {
            return buildTaskPrompt(session, taskPayload);
        }
        const batchId = typeof taskPayload.batchId === 'string' ? taskPayload.batchId : session.batchId ?? '';
        if (!batchId) {
            return buildTaskPrompt(session, taskPayload);
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
        return buildTaskPrompt(session, taskPayload, {
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
        const localSessionId = typeof params.sessionId === 'string' ? this.cursorSessionLookup.get(params.sessionId) : undefined;
        if (!localSessionId) {
            return;
        }
        const payload = JSON.stringify(message.params);
        await this.appendTranscriptLine(localSessionId, 'from_agent', 'session_update', payload);
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
    isCursorAvailable() {
        const checkPaths = [this.config.cursorBinary, 'cursor', 'cursor.exe'];
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
    async canReachCursor() {
        try {
            const response = await this.transport.ensureInitialized(1000);
            return response;
        }
        catch {
            return false;
        }
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
