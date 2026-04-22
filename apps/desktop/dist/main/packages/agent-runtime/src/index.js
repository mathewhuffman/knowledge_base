"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpToolServer = exports.AGENT_RUNTIME_VERSION = exports.AgentRuntimeService = exports.CursorAcpRuntime = void 0;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_fs_1 = __importDefault(require("node:fs"));
const node_net_1 = __importDefault(require("node:net"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_process_1 = __importDefault(require("node:process"));
const node_child_process_1 = require("node:child_process");
const mcp_server_1 = require("@kb-vault/mcp-server");
const shared_types_1 = require("@kb-vault/shared-types");
const shared_types_2 = require("@kb-vault/shared-types");
const DEFAULT_AGENT_ACCESS_MODE = 'direct';
const KB_CLI_BINARY_ENV = 'KBV_KB_CLI_BINARY';
const KBV_CURSOR_BINARY_ENV = 'KBV_CURSOR_BINARY';
const DEFAULT_AGENT_BINARY = 'agent';
const DEFAULT_CURSOR_BINARY = 'cursor';
const DEFAULT_CURSOR_ARGS = ['agent', 'acp'];
const DEFAULT_CLI_BINARY = 'kb';
const ACP_HEALTH_INIT_TIMEOUT_MS = 15_000;
const ACP_HEALTH_INIT_ATTEMPTS = 2;
const MCP_BRIDGE_HEALTH_TIMEOUT_MS = 2_000;
const ACP_SESSION_READY_WAIT_MS = 1_200;
const ACP_SESSION_NOT_FOUND_RETRY_LIMIT = 4;
const ASSISTANT_CHAT_AUTO_CONTINUE_LIMIT = 2;
const DIRECT_ACTION_LOOP_MAX_TURNS = 8;
const DIRECT_ACTION_REPEAT_LIMIT = 2;
const DIRECT_PROTOCOL_RECOVERY_LIMIT = 2;
const DIRECT_CONTINUATION_FULL_PROMPT_TURNS = 1;
const DIRECT_ACTION_RESULT_MAX_PROMPT_CHARS = 24_000;
const DIRECT_ACTION_RESULT_MAX_STRING_CHARS = 4_000;
const DIRECT_ACTION_RESULT_MAX_ARRAY_ITEMS = 12;
const DIRECT_ACTION_RESULT_MAX_OBJECT_KEYS = 24;
const DIRECT_ACTION_RESULT_MAX_DEPTH = 5;
const DIRECT_CONTINUATION_MARKER = 'Direct continuation instructions:';
const DIRECT_RECOVERY_MARKER = 'Direct recovery instructions:';
const KB_VAULT_MCP_SERVER_NAME = 'kb-vault';
function resolveDefaultCursorBinary() {
    if (hasBinaryOnPath(DEFAULT_AGENT_BINARY)) {
        return DEFAULT_AGENT_BINARY;
    }
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
function resolveAcpWorkingDirectory(configuredCwd) {
    const candidates = [configuredCwd?.trim(), node_process_1.default.cwd()].filter((value) => Boolean(value));
    for (const candidate of candidates) {
        try {
            const resolved = node_path_1.default.resolve(candidate);
            const stats = node_fs_1.default.statSync(resolved);
            if (stats.isDirectory()) {
                return resolved;
            }
            if (stats.isFile()) {
                return node_path_1.default.dirname(resolved);
            }
        }
        catch {
            continue;
        }
    }
    return node_process_1.default.cwd();
}
function hasBinaryOnPath(binary) {
    const searchPath = node_process_1.default.env.PATH ?? '';
    return searchPath.split(node_path_1.default.delimiter).some((dir) => {
        if (!dir) {
            return false;
        }
        const exe = node_path_1.default.join(dir, binary);
        const exeWithExt = node_path_1.default.extname(exe).length > 0 ? exe : `${exe}.exe`;
        return node_fs_1.default.existsSync(exe) || node_fs_1.default.existsSync(exeWithExt);
    });
}
function resolveCursorArgs(binary) {
    const basename = node_path_1.default.basename(binary).toLowerCase().replace(/\.exe$/, '');
    if (basename === 'agent') {
        return ['acp'];
    }
    return DEFAULT_CURSOR_ARGS;
}
function buildCursorAcpArgs(binary, _modelId) {
    // Launch ACP without a model override and select the model through
    // `session/set_model` after `session/new`. Cursor's startup `--model` flag
    // accepts a different token format than ACP session model ids.
    return resolveCursorArgs(binary);
}
function extractKbCliCommandName(value) {
    const normalized = value?.replace(/["']/g, ' ').trim() ?? '';
    if (!normalized) {
        return undefined;
    }
    const kbMatch = normalized.match(/(?:^|\s)(?:kb|kb\.exe)\s+([a-z0-9_]+(?:-[a-z0-9_]+)*(?:\s+[a-z0-9_]+(?:-[a-z0-9_]+)*)?)/i);
    if (kbMatch?.[1]) {
        return kbMatch[1].trim().toLowerCase();
    }
    const shimMatch = normalized.match(/kb-vault-cli-shim\/kb(?:\s+|["']\s+)([a-z0-9_]+(?:-[a-z0-9_]+)*(?:\s+[a-z0-9_]+(?:-[a-z0-9_]+)*)?)/i);
    if (shimMatch?.[1]) {
        return shimMatch[1].trim().toLowerCase();
    }
    return undefined;
}
function looksLikeKbCliShellInvocation(value) {
    const normalized = value?.replace(/["']/g, ' ').trim() ?? '';
    if (!normalized) {
        return false;
    }
    return (/(?:^|\s)(?:kb|kb\.exe)\s+[a-z0-9_-]+/i.test(normalized)
        || /kb-vault-cli-shim\/kb(?:\s+|["']\s+)[a-z0-9_-]+/i.test(normalized)
        || /\/kb(?:\s+|["']\s+)[a-z0-9_-]+/i.test(normalized));
}
function extractCliToolCommand(rawInput) {
    if (!rawInput || typeof rawInput !== 'object') {
        return undefined;
    }
    const record = rawInput;
    if (typeof record.command === 'string' && record.command.trim()) {
        return record.command.trim();
    }
    if (Array.isArray(record.args)) {
        const joined = record.args
            .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
            .join(' ')
            .trim();
        if (joined) {
            return joined;
        }
    }
    return undefined;
}
function extractCliToolCommandFromRawOutput(rawOutput) {
    if (!rawOutput || typeof rawOutput !== 'object') {
        return undefined;
    }
    const record = rawOutput;
    if (typeof record.command === 'string' && record.command.trim()) {
        return record.command.trim();
    }
    const stdout = typeof record.stdout === 'string' ? record.stdout.trim() : '';
    if (!stdout) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(stdout);
        if (typeof parsed.command === 'string' && parsed.command.trim()) {
            return parsed.command.trim();
        }
    }
    catch {
        const inferred = extractKbCliCommandName(stdout);
        if (inferred) {
            return inferred;
        }
    }
    return undefined;
}
function selectCliToolAuditArgs(rawInput, rawOutput, kind) {
    if (rawInput && typeof rawInput === 'object') {
        return Object.keys(rawInput).length > 0
            ? rawInput
            : (rawOutput && typeof rawOutput === 'object' ? rawOutput : { kind });
    }
    if (rawInput !== undefined) {
        return rawInput;
    }
    if (rawOutput && typeof rawOutput === 'object') {
        return rawOutput;
    }
    return { kind };
}
function extractSearchKbQueryFromCliCommand(command) {
    const normalized = command?.trim();
    if (!normalized || !/\bsearch-kb\b/i.test(normalized)) {
        return undefined;
    }
    const match = normalized.match(/--query\s+("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+)/i);
    if (!match?.[1]) {
        return undefined;
    }
    const token = match[1].trim();
    const unwrapped = (token.startsWith('"') && token.endsWith('"'))
        || (token.startsWith('\'') && token.endsWith('\''))
        ? token.slice(1, -1)
        : token;
    return unwrapped.trim() || undefined;
}
function normalizePlannerSearchQuery(query) {
    const normalized = query?.trim().toLowerCase().replace(/\s+/g, ' ');
    return normalized || undefined;
}
function isCliTerminalToolName(value) {
    const normalized = value?.trim().toLowerCase();
    return normalized === 'terminal' || normalized === 'shell';
}
const ALLOWED_MCP_TOOL_NAMES = new Set([
    'get_batch_context',
    'get_pbi_subset',
    'get_pbi',
    'get_article',
    'get_article_family',
    'get_locale_variant',
    'get_article_history',
    'find_related_articles',
    'search_kb',
    'list_categories',
    'list_sections',
    'list_article_templates',
    'get_template',
    'app_get_form_schema',
    'app_patch_form',
    'propose_create_kb',
    'propose_edit_kb',
    'propose_retire_kb',
    'record_agent_notes'
]);
const BLOCKED_MCP_RESOURCE_TOOL_NAMES = new Set([
    'list_mcp_resources',
    'fetch_mcp_resource'
]);
const BLOCKED_GENERIC_TOOL_NAMES = new Set([
    'read_file',
    'grep',
    'glob',
    'find',
    'fetch',
    'task',
    'codebase_search',
    'semantic_search',
    'semanticsearch',
    'web_search',
    'websearch'
]);
function extractAssistantNamedTool(rawValue) {
    if (!rawValue || typeof rawValue !== 'object') {
        return undefined;
    }
    const record = rawValue;
    const explicitKeys = ['toolName', 'tool', 'commandName', 'name', 'title'];
    for (const key of explicitKeys) {
        const candidate = typeof record[key] === 'string' ? record[key].trim() : '';
        if (candidate) {
            return candidate;
        }
    }
    return undefined;
}
function normalizeAssistantToolPolicyName(value) {
    const trimmed = value?.trim();
    if (!trimmed) {
        return undefined;
    }
    return trimmed
        .toLowerCase()
        .replace(/[`"']/g, '')
        .replace(/^kb[-_]?vault[.:/]/, '')
        .replace(/^mcp[.:/]/, '')
        .replace(/\s+/g, ' ')
        .replace(/^list mcp resources$/, 'list_mcp_resources')
        .replace(/^fetch mcp resource$/, 'fetch_mcp_resource')
        .replace(/^read file$/, 'read_file')
        .replace(/^codebase search$/, 'codebase_search')
        .replace(/^semantic search$/, 'semantic_search')
        .replace(/^web search$/, 'web_search')
        .replace(/^unknown tool$/, 'unknown_tool')
        .replace(/[ -]+/g, '_');
}
function selectAssistantToolPolicyLabel(update) {
    return update?.title?.trim()
        || extractAssistantNamedTool(update?.rawInput)
        || extractAssistantNamedTool(update?.rawOutput)
        || extractCliToolCommand(update?.rawInput)
        || extractCliToolCommandFromRawOutput(update?.rawOutput)
        || update?.kind?.trim()
        || undefined;
}
function shouldDeferCliToolPolicyCheck(update) {
    if (!update) {
        return false;
    }
    const command = extractCliToolCommand(update.rawInput) ?? extractCliToolCommandFromRawOutput(update.rawOutput);
    if (command) {
        return false;
    }
    const normalizedKind = update.kind?.trim().toLowerCase() ?? '';
    const normalizedStatus = update.status?.trim().toLowerCase() ?? '';
    const isPlaceholderTerminal = isCliTerminalToolName(update.title)
        || normalizedKind === 'terminal'
        || normalizedKind === 'execute'
        || normalizedKind === 'shell';
    if (!isPlaceholderTerminal) {
        return false;
    }
    return (update.sessionUpdate === 'tool_call'
        && (!normalizedStatus || normalizedStatus === 'pending'));
}
function shouldDeferMcpToolPolicyCheck(update) {
    if (!update) {
        return false;
    }
    const normalizedStatus = update.status?.trim().toLowerCase() ?? '';
    const label = selectAssistantToolPolicyLabel(update);
    const normalizedLabel = normalizeAssistantToolPolicyName(label);
    if (normalizedLabel && normalizedLabel !== 'unknown_tool') {
        return false;
    }
    return (update.sessionUpdate === 'tool_call'
        && (!normalizedStatus || normalizedStatus === 'pending'));
}
function normalizeAgentModelId(modelId) {
    const next = modelId?.trim();
    if (!next) {
        return undefined;
    }
    const withoutAnsi = next.replace(/\u001B\[[0-9;]*m/g, '').trim();
    const withoutMarkers = withoutAnsi.replace(/\s+\((?:current|default)[^)]+\)\s*$/i, '').trim();
    const normalized = withoutMarkers.split(/\s+-\s+/, 1)[0]?.trim() ?? withoutMarkers;
    return normalized || undefined;
}
function resolveProviderSessionMode(mode, sessionMode) {
    const normalizedMode = sessionMode ?? 'agent';
    return normalizedMode;
}
const NON_CHAT_IDLE_SESSION_TTL_MS = 15 * 60 * 1_000;
const BATCH_PLANNER_MAX_TOOL_CALLS = 16;
const BATCH_PLANNER_JSON_STREAM_GRACE_MS = 1_500;
const BATCH_PLANNER_MALFORMED_JSON_ABORT_MS = 6_000;
const BATCH_ANALYSIS_AUTO_CONTINUE_LIMIT = 1;
const BATCH_ANALYSIS_CONTINUATION_MARKER = 'Batch continuation instructions:';
function stableStringify(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}
function isMissingAcpSessionError(error) {
    if (!error) {
        return false;
    }
    const message = typeof error.message === 'string' ? error.message : '';
    const details = error.data && typeof error.data === 'object' && typeof error.data.details === 'string'
        ? String(error.data.details)
        : '';
    const combined = `${message}\n${details}`.toLowerCase();
    return combined.includes('session') && combined.includes('not found');
}
function isRetriablePromptError(error) {
    if (!error) {
        return false;
    }
    if (isMissingAcpSessionError(error)) {
        return true;
    }
    const message = typeof error.message === 'string' ? error.message.trim().toLowerCase() : '';
    return message === 'internal error';
}
function detectAssistantToolPolicyViolationMode(error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.trim().toLowerCase();
    if (normalized.includes('cli mode blocked illegal tool call') || normalized.includes('cli mode forbids')) {
        return 'cli';
    }
    if (normalized.includes('mcp mode blocked illegal tool call')
        || normalized.includes('mcp mode forbids')
        || normalized.includes('mcp mode only allows')) {
        return 'mcp';
    }
    if (normalized.includes('direct mode blocked illegal tool call') || normalized.includes('direct mode forbids')) {
        return 'direct';
    }
    return null;
}
function isAssistantToolPolicyViolationError(error) {
    return detectAssistantToolPolicyViolationMode(error) !== null;
}
function looksLikeAssistantProgressText(value) {
    const normalized = value?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '';
    if (!normalized) {
        return false;
    }
    return (/^(gathering|checking|looking|researching|reviewing|investigating|loading|searching|finding)\b/.test(normalized)
        || /^i(?:'m| am) (gathering|checking|looking|researching|reviewing|investigating|finding)\b/.test(normalized)
        || /^i need to (fetch|get|load|look up|retrieve|read|inspect|pull|call)\b/.test(normalized)
        || /^need to (fetch|get|load|look up|retrieve|read|inspect|pull|call)\b/.test(normalized)
        || /^first[, ]+i need to\b/.test(normalized)
        || normalized.includes('before i can draft the proposal')
        || normalized.includes('before drafting the proposal')
        || normalized.includes('before i can answer')
        || normalized.includes('returning only the structured json')
        || normalized.includes('return the final answer')
        || normalized.includes('using the cli and then returning')
        || normalized.includes('do not send a progress update')
        || normalized.includes('pulling the core'));
}
function looksLikeBatchProgressText(value) {
    return looksLikeAssistantProgressText(value);
}
function normalizeAssistantCompletionState(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    switch (value.trim().toLowerCase()) {
        case 'completed':
            return 'completed';
        case 'researching':
            return 'researching';
        case 'needs_user_input':
        case 'needs-user-input':
            return 'needs_user_input';
        case 'blocked':
            return 'blocked';
        case 'errored':
        case 'error':
            return 'errored';
        case 'unknown':
            return 'unknown';
        default:
            return undefined;
    }
}
function looksLikeAssistantEnvelope(value) {
    return (typeof value.response === 'string'
        || typeof value.command === 'string'
        || typeof value.artifactType === 'string'
        || typeof value.completionState === 'string'
        || typeof value.isFinal === 'boolean');
}
function extractLastJsonObjectFromText(value) {
    const trimmed = value?.trim();
    if (!trimmed) {
        return null;
    }
    try {
        const direct = JSON.parse(trimmed);
        if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
            return direct;
        }
    }
    catch {
        // Fall through to substring extraction.
    }
    let best = null;
    for (let start = 0; start < trimmed.length; start += 1) {
        if (trimmed[start] !== '{') {
            continue;
        }
        for (let end = trimmed.lastIndexOf('}'); end > start; end = trimmed.lastIndexOf('}', end - 1)) {
            try {
                const candidate = JSON.parse(trimmed.slice(start, end + 1));
                if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
                    best = candidate;
                    break;
                }
            }
            catch {
                // continue searching
            }
        }
    }
    return best;
}
function extractPreferredAssistantEnvelope(value) {
    const directObject = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
    if (directObject && looksLikeAssistantEnvelope(directObject)) {
        return directObject;
    }
    const candidates = [];
    if (directObject) {
        if (typeof directObject.streamedText === 'string') {
            candidates.push(directObject.streamedText);
        }
        const explicitText = extractPromptResultText(directObject);
        if (explicitText) {
            candidates.push(explicitText);
        }
    }
    else if (typeof value === 'string') {
        candidates.push(value);
    }
    for (const candidate of candidates) {
        const parsed = extractLastJsonObjectFromText(candidate);
        if (parsed) {
            return parsed;
        }
    }
    return null;
}
function extractAssistantCompletionContract(value) {
    const candidates = [];
    const preferred = extractPreferredAssistantEnvelope(value);
    if (preferred) {
        candidates.push(preferred);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        candidates.push(value);
    }
    for (const candidate of candidates) {
        const completionState = normalizeAssistantCompletionState(candidate.completionState);
        const isFinal = typeof candidate.isFinal === 'boolean' ? candidate.isFinal : undefined;
        if (completionState || isFinal !== undefined) {
            return { completionState, isFinal };
        }
    }
    return {};
}
function getSessionUpdateType(params) {
    if (!params || typeof params !== 'object') {
        return null;
    }
    const update = params.update;
    return typeof update?.sessionUpdate === 'string' ? update.sessionUpdate : null;
}
function isHiddenAgentThoughtUpdate(params) {
    return getSessionUpdateType(params) === 'agent_thought_chunk';
}
class NonRetriableRuntimeError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NonRetriableRuntimeError';
    }
}
function parseSessionModelState(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const candidate = value;
    const currentModelId = typeof candidate.currentModelId === 'string'
        ? candidate.currentModelId.trim()
        : undefined;
    const availableModels = Array.isArray(candidate.availableModels)
        ? candidate.availableModels
            .map((entry) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }
            const modelIdValue = entry.modelId;
            const nameValue = entry.name;
            const modelId = typeof modelIdValue === 'string' ? modelIdValue.trim() : undefined;
            const name = typeof nameValue === 'string' ? nameValue.trim() : undefined;
            if (!modelId && !name) {
                return null;
            }
            return { modelId, name };
        })
            .filter((entry) => entry !== null)
        : undefined;
    if (!currentModelId && !availableModels?.length) {
        return null;
    }
    return {
        currentModelId,
        availableModels
    };
}
function buildBatchAnalysisPhaseGuidance(providerLabel) {
    return [
        'Required execution phases for batch analysis:',
        '1. Research phase.',
        'Review the user prompt, batch context, uploaded PBIs, and article directory first.',
        `Use ${providerLabel} tools to inspect only the article records that are plausible candidates for change or creation.`,
        'Do not spend long unstructured time exploring unrelated articles.',
        '2. Plan phase.',
        'Produce a short internal plan that names the existing articles to edit, the new articles to create, any retire/no-impact decisions, and the evidence supporting each.',
        'Stop researching once the plan is specific enough to act.',
        '3. Execute phase.',
        'Create the proposal records for the planned create/edit/retire actions.',
        'For create/edit proposals, include the full final article HTML in proposal metadata as `proposedHtml` whenever you are proposing article content.',
        'For every persisted proposal, include a numeric confidence score in proposal metadata as `confidenceScore` using a 0 to 1 range.',
        'Do not delay proposal creation once the evidence is sufficient.',
        '4. Finish phase.',
        'Return a concise summary of proposals created, no-impact areas, and blockers or uncertainties.',
        'Output discipline:',
        '- Do not narrate your internal reasoning, shell strategy, escaping strategy, or alternate approaches.',
        '- Do not emit stream-of-consciousness progress updates.',
        '- If you send an external progress update, keep it to one or two short sentences about completed work only.',
        '- Never talk about HEREDOCs, quoting, JSON escaping, Python helpers, or command construction unless the user explicitly asks.',
        'Efficiency rules:',
        '- Prefer a small number of targeted article lookups over broad repeated searches.',
        '- If two or three focused retrieval steps confirm an action, move on to planning/execution.',
        '- If evidence stays ambiguous, make the best-supported decision, note the uncertainty, and continue.'
    ].join('\n');
}
function buildAssistantChatContinuePrompt(mode) {
    const lookupInstruction = mode === 'mcp'
        ? 'Use only direct KB Vault MCP tools if one final targeted lookup is still truly required.'
        : mode === 'cli'
            ? 'Use only exact kb CLI commands if one final targeted lookup is still truly required.'
            : 'If one final KB lookup or confirmed app mutation is still required, return exactly one `needs_action` direct-action JSON envelope. Do not describe transport internals or ad-hoc environment exploration in this follow-up.';
    return [
        'Complete the same user request using the existing session context.',
        'Return the final user-facing answer now.',
        'Do not send a progress update.',
        lookupInstruction
    ].join(' ');
}
function getDirectBatchStageActionTypes(session) {
    if (session.type !== 'batch_analysis') {
        return null;
    }
    if (session.mode === 'plan' && (session.role === 'planner' || session.role === 'plan-reviewer' || session.role === 'final-reviewer')) {
        return shared_types_2.DIRECT_BATCH_READ_ONLY_ACTION_TYPES;
    }
    if (session.mode === 'agent' && session.role === 'worker') {
        return shared_types_2.DIRECT_BATCH_WORKER_ACTION_TYPES;
    }
    return null;
}
function getDirectActionTypesForSession(session) {
    if (session.type === 'batch_analysis') {
        return getDirectBatchStageActionTypes(session);
    }
    if (session.type === 'article_edit') {
        return shared_types_2.DIRECT_ARTICLE_EDIT_ACTION_TYPES;
    }
    if (session.type === 'assistant_chat') {
        return session.directContext?.allowPatchForm
            ? shared_types_2.DIRECT_ASSISTANT_TEMPLATE_ACTION_TYPES
            : shared_types_2.DIRECT_ASSISTANT_READ_ACTION_TYPES;
    }
    return null;
}
function buildDirectActionCatalog(actionTypes) {
    if (!actionTypes?.length) {
        return '- No direct actions are available in this session.';
    }
    return actionTypes
        .map((actionType) => {
        const definition = shared_types_2.DIRECT_ACTION_DEFINITIONS[actionType];
        if (!definition) {
            return `- \`${actionType}\``;
        }
        const usage = definition.usageHint ? ` Guidance: ${definition.usageHint}` : '';
        return `- \`${actionType}\`: ${definition.description} Args: ${definition.argsHint}${usage}`;
    })
        .join('\n');
}
function buildDirectTaskPrompt(session, taskPayload, extras) {
    const batchId = typeof taskPayload.batchId === 'string' ? taskPayload.batchId : session.batchId ?? '';
    const locale = typeof taskPayload.locale === 'string' ? taskPayload.locale : session.locale ?? 'default';
    const explicitPrompt = typeof taskPayload.prompt === 'string' ? taskPayload.prompt.trim() : '';
    const extraSections = [
        extras?.batchContext !== undefined ? `Preloaded batch context summary:\n${summarizeBatchContext(extras.batchContext)}` : '',
        extras?.uploadedPbis !== undefined ? `Preloaded uploaded PBI JSON:\n${JSON.stringify(extras.uploadedPbis, null, 2)}` : '',
        extras?.articleDirectory ? `KB article directory and file-style index:\n${extras.articleDirectory}` : ''
    ]
        .filter(Boolean)
        .join('\n\n');
    const allowedActionTypes = getDirectActionTypesForSession(session);
    const allowedActions = allowedActionTypes?.join(', ') ?? 'none';
    const supportsProposalMutation = Array.isArray(allowedActionTypes) && allowedActionTypes.includes('create_proposals');
    const directProtocolBase = [
        'KB Vault direct-mode protocol:',
        '- The app is the sole authority for KB reads and writes. You do not execute tools or commands yourself.',
        '- Stay inside the direct-action contract described here. Do not discuss transport internals or ad-hoc environment exploration.',
        '- If prompt context is insufficient, request exactly one direct action by returning a JSON object with `completionState="needs_action"` and `isFinal=false`.',
        `- Allowed direct action types in this stage: ${allowedActions}.`,
        'Direct action catalog:',
        buildDirectActionCatalog(allowedActionTypes),
        '- Use direct actions only for concrete unresolved ambiguities. Reuse prior action results instead of repeating the same request.',
        '- Each direct action turn may request only one action object.',
        '- The app derives workspace ownership, route ownership, batch ownership, session ownership, and idempotency. Do not invent those fields yourself.',
        'Needs-action example:',
        JSON.stringify({
            completionState: 'needs_action',
            isFinal: false,
            action: {
                id: 'action-1',
                type: batchId ? 'get_batch_context' : 'get_article',
                args: batchId
                    ? { batchId: batchId || '<batch-id>' }
                    : { localeVariantId: 'locale-variant-id' }
            }
        }, null, 2),
        'Action-result continuation example:',
        JSON.stringify({
            type: 'action_result',
            actionId: 'action-1',
            ok: true,
            data: batchId
                ? { batch: { id: batchId || '<batch-id>' } }
                : { article: { localeVariantId: 'locale-variant-id' } }
        }, null, 2)
    ];
    if (taskPayload.task === 'analyze_batch' && Array.isArray(allowedActionTypes)) {
        const directProtocol = [
            ...directProtocolBase,
            ...(supportsProposalMutation
                ? [
                    '- Mutation actions may include multiple proposal items when they are part of the same approved worker pass.',
                    '- For batch-worker proposal persistence, use `create_proposals` with proposal items whose `action` is `create`, `edit`, or `retire`. Do not call `create_proposals` for no-impact decisions.',
                    '- Approved plan target ids and titles already present in the prompt are authoritative execution inputs. Do not spend extra turns rediscovering them unless a read or write failure creates a concrete ambiguity.',
                    '- For approved `edit` or `retire` items, `create_proposals` may use `localeVariantId`, `familyId`, or `targetTitle`. Use the most authoritative target already supplied in the prompt.',
                    '- For approved `create` items, use `targetTitle` directly. Do not look up a localeVariantId for net-new work before creating the proposal.',
                    '- Batch proposal writes as soon as the approved plan gives enough targeting and drafting context for one or more items.'
                ]
                : []),
            '- When you have enough information, return only the final stage JSON object described in the task instructions below. Do not wrap that final stage JSON in another envelope.',
            '- If the task truly cannot continue, return a terminal JSON envelope with `completionState="blocked"` or `completionState="needs_user_input"` and `isFinal=true`.',
            ...(supportsProposalMutation
                ? [
                    'Mutation example:',
                    JSON.stringify({
                        completionState: 'needs_action',
                        isFinal: false,
                        action: {
                            id: 'action-2',
                            type: 'create_proposals',
                            args: {
                                proposals: [
                                    {
                                        itemId: 'plan-item-1',
                                        action: 'edit',
                                        familyId: 'family-1',
                                        targetTitle: 'Example KB Article',
                                        note: 'Update the article to reflect the approved workflow change.',
                                        proposedHtml: '<h1>Example KB Article</h1><p>Updated content.</p>',
                                        confidenceScore: 0.84,
                                        relatedPbiIds: ['pbi-123']
                                    }
                                ]
                            }
                        }
                    }, null, 2)
                ]
                : [])
        ].join('\n');
        return [
            `You are running inside KB Vault as the ${session.role} in Direct mode.`,
            `Workspace ID: ${session.workspaceId}`,
            batchId ? `Batch ID: ${batchId}` : '',
            `Locale: ${locale}`,
            '',
            directProtocol,
            '',
            explicitPrompt ? `Task instructions:\n${explicitPrompt}` : '',
            '',
            extraSections
        ].filter(Boolean).join('\n');
    }
    if (taskPayload.task === 'edit_article' && Array.isArray(allowedActionTypes)) {
        const directProtocol = [
            ...directProtocolBase,
            '- Return only the final article-edit JSON object with `updatedHtml` and `summary` when you have enough information.',
            '- If you need more KB context, request it through a direct action instead of describing a tool plan.',
            '- Do not wrap the final JSON in markdown fences.',
            'Article-fetch example:',
            JSON.stringify({
                completionState: 'needs_action',
                isFinal: false,
                action: {
                    id: 'action-article-1',
                    type: 'get_article',
                    args: { localeVariantId: typeof taskPayload.localeVariantId === 'string' ? taskPayload.localeVariantId : 'locale-variant-id' }
                }
            }, null, 2)
        ].join('\n');
        return [
            'You are running inside KB Vault to edit one article revision in Direct mode.',
            `Workspace ID: ${session.workspaceId}`,
            `Locale: ${locale}`,
            '',
            directProtocol,
            '',
            explicitPrompt ? `Task instructions:\n${explicitPrompt}` : '',
            '',
            extraSections
        ].filter(Boolean).join('\n');
    }
    if (taskPayload.task === 'assistant_chat' && Array.isArray(allowedActionTypes)) {
        const directProtocol = [
            ...directProtocolBase,
            '- When you have enough information, return the normal final assistant JSON object requested in the task instructions below.',
            '- If you need a read lookup, request it through one direct action instead of using tools.',
            '- If the route allows confirmed live form edits, use `patch_form`, wait for the successful action result, then return an informational assistant response describing the confirmed change.',
            '- Do not claim a working-state mutation succeeded unless the latest `action_result` reported `ok: true`.',
            '- Do not wrap the final assistant JSON in markdown fences.',
            session.directContext?.allowPatchForm
                ? 'Patch-form example:\n'
                    + JSON.stringify({
                        completionState: 'needs_action',
                        isFinal: false,
                        action: {
                            id: 'action-template-1',
                            type: 'patch_form',
                            args: {
                                patch: {
                                    toneRules: 'Lead with the direct answer, then add supporting detail.'
                                }
                            }
                        }
                    }, null, 2)
                : ''
        ].filter(Boolean).join('\n');
        return [
            'You are running inside KB Vault as a route-aware assistant in Direct mode.',
            `Workspace ID: ${session.workspaceId}`,
            `Locale: ${locale}`,
            '',
            directProtocol,
            '',
            explicitPrompt ? `Task instructions:\n${explicitPrompt}` : '',
            '',
            extraSections
        ].filter(Boolean).join('\n');
    }
    return [
        'You are running inside KB Vault in Direct mode.',
        `Workspace ID: ${session.workspaceId}`,
        batchId ? `Batch ID: ${batchId}` : '',
        `Locale: ${locale}`,
        '',
        'Important constraints:',
        '- Stay inside the direct-action contract for this session.',
        '- Return a blocked JSON envelope explaining that this direct-mode route is not enabled for the current session.',
        '',
        explicitPrompt ? `Task instructions:\n${explicitPrompt}` : '',
        '',
        extraSections
    ].filter(Boolean).join('\n');
}
function buildMcpTaskPrompt(session, taskPayload, extras) {
    const batchId = typeof taskPayload.batchId === 'string' ? taskPayload.batchId : session.batchId ?? '';
    const locale = typeof taskPayload.locale === 'string' ? taskPayload.locale : session.locale ?? 'default';
    const explicitPrompt = typeof taskPayload.prompt === 'string' ? taskPayload.prompt.trim() : '';
    const role = session.role ?? 'worker';
    const mcpGuidance = [
        'KB Vault MCP guidance:',
        '- Use only these exact KB Vault MCP tool names when needed: get_batch_context, get_pbi_subset, get_pbi, get_article, get_article_family, get_locale_variant, get_article_history, find_related_articles, search_kb, list_article_templates, get_template, app_get_form_schema, app_patch_form, propose_create_kb, propose_edit_kb, propose_retire_kb, record_agent_notes.',
        '- Do not use list_mcp_resources or fetch_mcp_resource for KB Vault work in MCP mode.',
        '- Do not claim KB Vault MCP tools are unavailable because they are not shown in a generic tool picker or tool list. If they are named here, call them directly.',
        '- To inspect the imported batch, call get_batch_context first.',
        '- To read the uploaded PBI rows, call get_pbi_subset for the batch or get_pbi for a single record.',
        '- To read KB article contents, use get_article with a localeVariantId or revisionId from the article directory listing below.',
        '- If the prompt already gives you a localeVariantId or revisionId for the current article, call get_article directly with that identifier instead of treating the article HTML as unavailable.',
        '- To understand an article family before reading content, use get_article_family and get_locale_variant.',
        '- If the batch implies KB changes, you must persist structured proposals with propose_create_kb, propose_edit_kb, and/or propose_retire_kb instead of only describing them in prose.',
        '- Use propose_create_kb for net-new KB coverage, propose_edit_kb for updates to existing KB content, and propose_retire_kb for content that should be retired or replaced.',
        '- Always include a human-readable article title for the proposal. Put it in proposal metadata as `targetTitle` when possible, and make the note/rationale lead with that title.',
        '- When proposing article content, include the full final article HTML in proposal metadata as `proposedHtml`.',
        '- Every persisted proposal must include `metadata.confidenceScore` as a numeric value from 0 to 1.',
        '- Include the relevant pbiIds, rationale, and clear notes in each proposal so Proposal Review has actionable context.',
        '- Your final response should summarize what proposals you created, note any no-impact areas, and call out blockers only if proposal creation was not possible.',
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
        if (role === 'planner') {
            return [
                'You are running inside KB Vault as the batch planner.',
                `Workspace ID: ${session.workspaceId}`,
                `Batch ID: ${batchId}`,
                `Locale: ${locale}`,
                '',
                'Your job:',
                '1. Account for every candidate PBI in a structured plan.',
                '2. Propose KB create, edit, retire, or no-impact outcomes.',
                '3. Identify likely existing article targets when possible.',
                '4. Return only JSON and do not execute proposal creation in this stage.',
                '',
                mcpGuidance,
                '',
                explicitPrompt ? `Planner instructions:\n${explicitPrompt}` : '',
                '',
                extraSections
            ].filter(Boolean).join('\n');
        }
        if (role === 'plan-reviewer' || role === 'final-reviewer') {
            return [
                `You are running inside KB Vault as the ${role}.`,
                `Workspace ID: ${session.workspaceId}`,
                `Batch ID: ${batchId}`,
                `Locale: ${locale}`,
                '',
                'Your job:',
                '1. Review the supplied batch plan or outputs for completeness and correctness.',
                '2. Actively look for missing article work beyond the submitted artifact.',
                '3. Return only JSON and do not execute proposal creation in this stage.',
                '',
                mcpGuidance,
                '',
                explicitPrompt ? `Reviewer instructions:\n${explicitPrompt}` : '',
                '',
                extraSections
            ].filter(Boolean).join('\n');
        }
        return [
            'You are running inside KB Vault to analyze one imported PBI batch.',
            `Workspace ID: ${session.workspaceId}`,
            `Batch ID: ${batchId}`,
            `Locale: ${locale}`,
            '',
            buildBatchAnalysisPhaseGuidance('MCP'),
            '',
            'Your job:',
            '1. Load the batch context and relevant PBI records for this batch.',
            '2. Review the existing KB/article context for the affected topics.',
            '3. Decide which outcomes are no-impact versus KB create, edit, or retire work.',
            '4. Persist structured proposal records for every KB create/edit/retire recommendation.',
            '5. Return a concise execution summary that lists the proposals you created and any blockers or confirmed no-impact areas.',
            '6. If the batch is already analyzed, summarize the existing analysis/proposal state instead of redoing generic exploration.',
            '',
            'Tool rules:',
            '- Use KB Vault tools and structured batch/article data only.',
            '- Do NOT use generic terminal, grep, codebase search, find, or filesystem exploration unless the user explicitly asked for that.',
            '- Do NOT inspect the repository or sqlite schema to infer application behavior.',
            '- Proposal creation is the primary output for batch analysis. Do not stop after exploratory investigation or prose summary when a KB action is warranted.',
            '- If you conclude there is no KB impact, say that explicitly in the final response and explain why no proposal was created.',
            '- Prefer concise execution summaries over long exploratory writeups.',
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
            '- Return only valid JSON in your final answer.',
            '- The JSON must include `updatedHtml` (string), `summary` (string), and may include `rationale` (string).',
            '- Do not wrap the JSON in markdown fences.',
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
    if (taskPayload.task === 'assistant_chat') {
        return [
            'You are running inside KB Vault as a route-aware assistant for conversational help and proposal drafting.',
            `Workspace ID: ${session.workspaceId}`,
            `Locale: ${locale}`,
            '',
            'Your job:',
            '- Answer the user\'s actual request.',
            '- When workspace knowledge is needed, use the minimum KB Vault MCP tool lookups required to answer accurately.',
            '- For feature, workflow, or terminology questions about the app, default to this sequence: `search_kb` for the topic, `get_article` for the best 1-3 hits, then answer clearly in plain English.',
            '',
            'Tool rules:',
            '- Use KB Vault tools and structured article/template data only when they help answer the user.',
            '- Do NOT use terminal, shell, grep, codebase search, find, filesystem exploration, list_mcp_resources, or fetch_mcp_resource.',
            '- Do not use tools just to discover what tools exist or to explore the environment.',
            '- Do not use kb CLI commands in MCP mode.',
            '- Do not use `get_batch_context`, `find_related_articles`, proposal tools, or app mutation tools unless the current route or user request clearly requires them.',
            '- The preloaded prompt context is for orientation; use KB Vault MCP tools directly when you need to confirm or inspect source records.',
            '- Return only valid JSON in your final answer.',
            '- Do not include preamble, commentary about your reasoning, or markdown fences.',
            '- For informational chat, return only `artifactType` and `response`. Omit `summary`, `html`, `formPatch`, and `payload` unless they are needed.',
            '- In Proposal Review, prefer returning `command="patch_proposal"` with `artifactType="proposal_patch"` so the current proposal can be updated directly.',
            '- For narrow Proposal Review changes, prefer targeted `payload.htmlMutations` anchored to exact existing HTML fragments.',
            '- Use `payload.lineEdits` only when you truly have stable line numbers for the current working copy.',
            '- For Templates & Prompts and other live form edits, use `app_get_form_schema` first when needed, then use `app_patch_form`.',
            '- Only return `proposal_candidate` when the user explicitly asks you to make or propose changes outside Proposal Review.',
            '- When the user asks for an article proposal or article edit outside Proposal Review, fetch the current article with `get_article` before drafting the proposal if the full HTML is not already present.',
            '- For narrow article proposal changes, prefer targeted `payload.htmlMutations` anchored to exact existing HTML fragments.',
            '- If you use `payload.htmlMutations`, the app will materialize the final article HTML locally.',
            '- For broad rewrites, return the full final article HTML in `html` or `payload.proposedHtml`.',
            '- Do not use line edits for `proposal_candidate`. Line edits are only for `proposal_patch` in Proposal Review.',
            '- Do not stop on a progress update. If you started researching, finish the lookup and answer the user in the same turn whenever possible.',
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
    const role = session.role ?? 'worker';
    const cliGuidance = [
        'KB Vault CLI guidance:',
        '- Use only the `kb` CLI and data returned by its JSON output.',
        '- Use the terminal only for exact `kb` commands, except for minimal temporary-file creation needed to pass large proposal metadata via `--metadata-file`.',
        '- Always include `--json` in every `kb` command.',
        '- Use as many `kb` commands as needed to complete the task.',
        '- Do NOT use Read File.',
        '- Do NOT use grep.',
        '- Do NOT use KB Vault MCP tools, list_mcp_resources, or fetch_mcp_resource in CLI mode.',
        '- If an exact `kb` command is unavailable, call `kb --help` to confirm current syntax.',
        '- If you need KB evidence, prefer direct `kb` output over local inference.',
        '- The prompt already includes a preloaded batch context summary. Only call `kb batch-context` if that preloaded context is insufficient or you must re-check the imported rows.',
        '- If `kb batch-context` fails but the prompt already includes the batch summary you need, continue using the preloaded batch context instead of retrying the same command repeatedly.',
        '- If you need article text, load article variants and related entries with `kb` before proposing edits.',
        '- Batch analysis is not complete until you have created proposal records for every warranted KB create/edit/retire action, or explicitly concluded the batch is no-impact.',
        '- Use `kb --help` and subcommand help to discover the CLI proposal commands for create/edit/retire if they are not already obvious.',
        '- Always name the article in the proposal output. Include the title in `--metadata` as `targetTitle` when you can, and make the note/rationale start with that title.',
        '- For create/edit proposals, include the full final article HTML in metadata as `proposedHtml`.',
        '- Every persisted proposal must include `confidenceScore` in metadata as a numeric value from 0 to 1.',
        '- If proposal commands are available, call them through `kb` and create the proposal records instead of only describing recommended actions in prose.',
        '- If the metadata payload is large, prefer `--metadata-file <path>` over inline JSON arguments.',
        '- Do not spend time describing shell quoting, escaping, temporary-file strategy, or alternate command shapes in your visible updates.',
        '- If this CLI build truly does not expose proposal commands, state that clearly as a blocker in the final response instead of pretending the batch is complete.',
        '- Your final response should summarize proposals created, confirmed no-impact areas, and blockers.',
        '- Preferred commands for this environment:',
        '- `kb batch-context --workspace-id <workspace-id> --batch-id <batch-id> --json`',
        '- `kb find-related-articles --workspace-id <workspace-id> --batch-id <batch-id> --json`',
        '- `kb search-kb --workspace-id <workspace-id> --query "<query>" --json`',
        '- `kb app get-form-schema --workspace-id <workspace-id> --route <route> --entity-type <entity-type> --entity-id <entity-id> --json`',
        '- `kb app patch-form --workspace-id <workspace-id> --route <route> --entity-type <entity-type> --entity-id <entity-id> --version-token <version-token> --patch \'<json object>\' --json`',
        '- `kb --help` (and relevant subcommand help) to locate proposal-creation commands when needed'
    ].join('\n');
    const extraSections = [
        extras?.batchContext !== undefined ? `Preloaded batch context summary:\n${summarizeBatchContext(extras.batchContext)}` : '',
        extras?.uploadedPbis !== undefined ? `Preloaded uploaded PBI JSON:\n${JSON.stringify(extras.uploadedPbis, null, 2)}` : '',
        extras?.articleDirectory ? `KB article directory and file-style index:\n${extras.articleDirectory}` : ''
    ]
        .filter(Boolean)
        .join('\n\n');
    if (taskPayload.task === 'analyze_batch') {
        if (role === 'planner') {
            return [
                'You are running inside KB Vault as the batch planner.',
                `Workspace ID: ${session.workspaceId}`,
                `Batch ID: ${batchId}`,
                `Locale: ${locale}`,
                '',
                'Your job:',
                '1. Account for every candidate PBI in a structured plan.',
                '2. Propose KB create, edit, retire, or no-impact outcomes.',
                '3. Identify likely existing article targets when possible.',
                '4. Return only JSON and do not execute proposal creation in this stage.',
                '',
                cliGuidance,
                '',
                explicitPrompt ? `Planner instructions:\n${explicitPrompt}` : '',
                '',
                extraSections
            ].filter(Boolean).join('\n');
        }
        if (role === 'plan-reviewer' || role === 'final-reviewer') {
            return [
                `You are running inside KB Vault as the ${role}.`,
                `Workspace ID: ${session.workspaceId}`,
                `Batch ID: ${batchId}`,
                `Locale: ${locale}`,
                '',
                'Your job:',
                '1. Review the supplied batch plan or outputs for completeness and correctness.',
                '2. Actively look for missing article work beyond the submitted artifact.',
                '3. Return only JSON and do not execute proposal creation in this stage.',
                '',
                cliGuidance,
                '',
                explicitPrompt ? `Reviewer instructions:\n${explicitPrompt}` : '',
                '',
                extraSections
            ].filter(Boolean).join('\n');
        }
        return [
            'You are running inside KB Vault to analyze one imported PBI batch.',
            `Workspace ID: ${session.workspaceId}`,
            `Batch ID: ${batchId}`,
            `Locale: ${locale}`,
            '',
            buildBatchAnalysisPhaseGuidance('CLI'),
            '',
            'Your job:',
            '1. Load the batch context and relevant PBI records for this batch.',
            '2. Review the existing KB/article context for the affected topics.',
            '3. Decide which outcomes are no-impact versus KB create, edit, or retire work.',
            '4. Create proposal records through the `kb` CLI for every KB create/edit/retire recommendation.',
            '5. Return a concise execution summary that lists the proposals you created and any blockers or confirmed no-impact areas.',
            '6. If the batch is already analyzed, summarize the existing analysis/proposal state instead of redoing generic exploration.',
            '',
            'Tool rules:',
            '- Use kb commands and structured batch/article data only.',
            '- Do NOT use generic terminal, grep, codebase search, find, or filesystem exploration unless the user explicitly asks for that.',
            '- Do NOT inspect the repository or sqlite schema to infer application behavior.',
            '- Proposal creation is the primary output for batch analysis. Do not stop after exploratory investigation or prose summary when a KB action is warranted.',
            '- If you conclude there is no KB impact, say that explicitly in the final response and explain why no proposal was created.',
            '- Prefer concise execution summaries over long exploratory writeups.',
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
            '- Return only valid JSON in your final answer.',
            '- The JSON must include `updatedHtml` (string), `summary` (string), and may include `rationale` (string).',
            '- Do not wrap the JSON in markdown fences.',
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
    if (taskPayload.task === 'assistant_chat') {
        const chatCliGuidance = [
            'KB command rules for chat:',
            '- When research or data lookup is needed, use only `kb` commands.',
            '- Never use terminal commands like grep, Read File, codebase search, general filesystem exploration, list_mcp_resources, or fetch_mcp_resource.',
            '- Do not call direct MCP tool names such as `search_kb` or `get_article` in CLI mode. Use only exact `kb` CLI commands.',
            '- If the runtime exposes Shell or Terminal, you may use it only for exact `kb` CLI commands. Generic terminal usage will be blocked.',
            '- Default research workflow for app-feature questions: use `kb search-kb`, then `kb get-article` for the best 1-3 hits, then answer.',
            '- Use `kb get-article-family` only when one article is clearly relevant but you need related variants or family context.',
            '- Use `kb batch-context`, `kb find-related-articles`, `kb app get-form-schema`, and `kb app patch-form` only when the route or the user\'s request clearly calls for batch review, proposal review, or live form editing.',
            '- Use `kb help --json` only if a needed KB command is genuinely unclear. Do not spend the turn exploring command syntax when `search-kb` plus `get-article` will answer the question.',
            '- Use the KB command output as the source of truth when answering.'
        ].join('\n');
        return [
            'You are running inside KB Vault as a route-aware assistant for conversational help and proposal drafting.',
            `Workspace ID: ${session.workspaceId}`,
            `Locale: ${locale}`,
            '',
            'Assistant chat rules:',
            '- Your primary job is to answer the user\'s request, not to explore the environment or narrate your plan.',
            '- If the user is asking a normal question or wants an explanation, answer directly unless workspace KB data is needed for accuracy.',
            '- If the user is asking about a feature, workflow, term, or concept in the app, use the smallest KB lookup path that will let you answer correctly.',
            '- The default lookup path for app questions is: search the topic, open the best 1-3 matching articles, synthesize the answer, stop.',
            '- If the user explicitly asks you to research, investigate, look something up, or answer from workspace data, do that research now and return the final findings in the same turn.',
            '- Never use generic terminal commands. When tool use is needed, use only exact `kb` commands.',
            '- Do not call direct MCP tool names in CLI mode. Use only exact `kb` CLI commands when tool use is required.',
            '- Do not use tools just to figure out what you should do next.',
            '- Avoid `batch-context`, `find-related-articles`, proposal commands, and form-editing commands unless the route or user request clearly requires them.',
            '- Do not call `kb help` unless command syntax is genuinely blocking progress.',
            '- Do not include preamble, commentary about your reasoning, or markdown fences.',
            '- Follow the output contract in the additional instructions below exactly.',
            '- In Proposal Review, prefer returning `command="patch_proposal"` with `artifactType="proposal_patch"` so the current proposal can be updated directly.',
            '- For narrow Proposal Review changes, prefer targeted `payload.htmlMutations` anchored to exact existing HTML fragments.',
            '- Use `payload.lineEdits` only when you truly have stable line numbers for the current working copy.',
            '- For article proposal requests outside Proposal Review, prefer targeted `payload.htmlMutations` for narrow changes and full `html` or `payload.proposedHtml` only for broad rewrites.',
            '- If you use `payload.htmlMutations`, the app will materialize the final article HTML locally.',
            '- For Templates & Prompts and other live form edits, use `kb app get-form-schema` first when needed, then use `kb app patch-form`.',
            '- Do not stop on a progress update. If you begin researching, finish and answer unless you are truly blocked or need user input.',
            '',
            chatCliGuidance,
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
const CLI_PLANNER_ZERO_RESULT_SEARCH_LIMIT = 4;
const CLI_PLANNER_LOW_DIVERSITY_ZERO_RESULT_QUERY_LIMIT = 2;
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
function extractMcpServerEnvValue(config, name) {
    if (!config) {
        return undefined;
    }
    const env = config.env;
    if (Array.isArray(env)) {
        const entry = env.find((candidate) => candidate
            && typeof candidate === 'object'
            && typeof candidate.name === 'string'
            && candidate.name === name);
        return typeof entry?.value === 'string' && entry.value.trim() ? entry.value.trim() : undefined;
    }
    if (env && typeof env === 'object') {
        const value = env[name];
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    }
    return undefined;
}
function resolveMcpBridgeConfig(mcpServers) {
    const namedServer = mcpServers.find((entry) => {
        const name = typeof entry.name === 'string' ? entry.name.trim() : '';
        return name === KB_VAULT_MCP_SERVER_NAME;
    });
    const fallbackServer = mcpServers.find((entry) => Boolean(extractMcpServerEnvValue(entry, 'KBV_MCP_BRIDGE_SOCKET_PATH')));
    const server = namedServer ?? fallbackServer;
    const command = typeof server?.command === 'string' && server.command.trim() ? server.command.trim() : undefined;
    const args = Array.isArray(server?.args)
        ? server.args.filter((value) => typeof value === 'string' && value.trim().length > 0)
        : [];
    const scriptPath = args[0] ?? node_process_1.default.env.KBV_MCP_BRIDGE_SCRIPT?.trim();
    const socketPath = extractMcpServerEnvValue(server, 'KBV_MCP_BRIDGE_SOCKET_PATH')
        ?? node_process_1.default.env.KBV_MCP_BRIDGE_SOCKET_PATH?.trim();
    const serverName = typeof server?.name === 'string' && server.name.trim() ? server.name.trim() : undefined;
    return {
        configured: Boolean(server && command && scriptPath && socketPath),
        serverName,
        command,
        scriptPath,
        socketPath
    };
}
async function probeMcpBridgeToolList(socketPath, timeoutMs = MCP_BRIDGE_HEALTH_TIMEOUT_MS) {
    return new Promise((resolve) => {
        let settled = false;
        let buffer = '';
        const socket = node_net_1.default.createConnection(socketPath);
        const finish = (result) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            resolve(result);
        };
        const timer = setTimeout(() => {
            finish({
                reachable: false,
                toolNames: [],
                error: `Timed out waiting for MCP bridge response after ${timeoutMs}ms`
            });
        }, timeoutMs);
        socket.once('connect', () => {
            socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'mcp-health', method: 'tools/list' })}\n`);
        });
        socket.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines.map((entry) => entry.trim()).filter(Boolean)) {
                try {
                    const response = JSON.parse(line);
                    if (response.error) {
                        finish({
                            reachable: false,
                            toolNames: [],
                            error: typeof response.error.message === 'string' ? response.error.message : 'MCP bridge returned an error'
                        });
                        return;
                    }
                    const tools = Array.isArray(response.result?.tools)
                        ? response.result.tools
                            .map((tool) => (typeof tool?.name === 'string' ? tool.name.trim() : ''))
                            .filter(Boolean)
                        : [];
                    finish({ reachable: true, toolNames: tools });
                    return;
                }
                catch (error) {
                    finish({
                        reachable: false,
                        toolNames: [],
                        error: error instanceof Error ? error.message : String(error)
                    });
                    return;
                }
            }
        });
        socket.once('error', (error) => {
            finish({
                reachable: false,
                toolNames: [],
                error: error.message
            });
        });
        socket.once('close', () => {
            if (!settled) {
                finish({
                    reachable: false,
                    toolNames: [],
                    error: 'MCP bridge connection closed before returning health data'
                });
            }
        });
    });
}
function buildTempMcpProbeSocketPath() {
    if (node_process_1.default.platform === 'win32') {
        return `\\\\.\\pipe\\kb-vault-mcp-health-${node_process_1.default.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
    return node_path_1.default.join(node_os_1.default.tmpdir(), `kb-vault-mcp-health-${node_process_1.default.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sock`);
}
async function probeAcpMcpAttachment(input) {
    const timeoutMs = Math.max(2_000, input.timeoutMs ?? 6_000);
    const socketPath = buildTempMcpProbeSocketPath();
    const touchedMethods = [];
    const mcpServer = new mcp_server_1.McpToolServer();
    mcpServer.registerTool('kbv_health_check', 'Health check tool for verifying ACP MCP attachment.', async () => ({ ok: true, connected: true }), {
        type: 'object',
        properties: {},
        additionalProperties: false
    });
    const server = node_net_1.default.createServer((socket) => {
        let buffer = '';
        socket.on('data', async (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines.map((entry) => entry.trim()).filter(Boolean)) {
                try {
                    const message = JSON.parse(line);
                    if (typeof message.method === 'string' && message.method.trim()) {
                        touchedMethods.push(message.method.trim());
                    }
                    const response = await mcpServer.handleJsonMessage(message);
                    if (response) {
                        socket.write(`${response}\n`);
                    }
                }
                catch {
                    socket.write(`${JSON.stringify({
                        jsonrpc: '2.0',
                        id: null,
                        error: {
                            code: -32700,
                            message: 'Parse error'
                        }
                    })}\n`);
                }
            }
        });
    });
    const cleanupSocket = async () => {
        if (node_process_1.default.platform !== 'win32' && node_fs_1.default.existsSync(socketPath)) {
            try {
                node_fs_1.default.unlinkSync(socketPath);
            }
            catch {
                // Best effort cleanup for probe sockets.
            }
        }
    };
    const closeServer = async () => {
        if (!server.listening) {
            await cleanupSocket();
            return;
        }
        await new Promise((resolve) => server.close(() => resolve()));
        await cleanupSocket();
    };
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, () => {
            server.off('error', reject);
            resolve();
        });
    });
    const transport = new CursorTransport(input.binary, input.args, input.cwd, false, () => undefined);
    try {
        const initialized = await transport.ensureInitialized(timeoutMs);
        if (!initialized) {
            return {
                attached: false,
                touchedMethods: [],
                error: 'Cursor ACP initialize failed during MCP attachment probe'
            };
        }
        const response = await transport.request('session/new', {
            cwd: input.cwd,
            mcpServers: [
                {
                    type: 'stdio',
                    name: 'kb-vault-health-probe',
                    command: input.bridgeCommand,
                    args: [input.bridgeScriptPath],
                    env: [
                        {
                            name: 'KBV_MCP_BRIDGE_SOCKET_PATH',
                            value: socketPath
                        }
                    ]
                }
            ],
            config: { mode: 'plan' }
        }, timeoutMs, `mcp-health:${Date.now()}`);
        if (response.error) {
            return {
                attached: false,
                touchedMethods: [],
                error: response.error.message
            };
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(1_500, timeoutMs)));
        const uniqueMethods = Array.from(new Set(touchedMethods));
        return {
            attached: uniqueMethods.length > 0,
            touchedMethods: uniqueMethods,
            error: uniqueMethods.length > 0 ? undefined : 'Cursor ACP session never contacted the attached MCP server'
        };
    }
    catch (error) {
        return {
            attached: false,
            touchedMethods: [],
            error: error instanceof Error ? error.message : String(error)
        };
    }
    finally {
        await transport.stop().catch(() => undefined);
        await closeServer().catch(() => undefined);
    }
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
    stderrBuffer = '';
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
                const text = chunk.toString('utf8');
                this.stderrBuffer += text;
                this.logger('system', { direction: 'from_agent', event: 'stderr', payload: text });
            });
            proc.on('error', (error) => {
                this.logger('system', { direction: 'system', event: 'transport_error', payload: String(error?.message ?? error) });
                this.rejectAllPending(new Error(`Cursor process error: ${error}`));
                this.connected = false;
                reject(error);
            });
            proc.on('close', (code, signal) => {
                this.logger('system', { direction: 'system', event: 'transport_closed', payload: 'cursor process closed' });
                const stderr = this.stderrBuffer.trim();
                const closeMessage = stderr
                    ? `Cursor process closed (code ${code ?? 'unknown'}${signal ? `, signal ${signal}` : ''}): ${stderr}`
                    : `Cursor process closed (code ${code ?? 'unknown'}${signal ? `, signal ${signal}` : ''})`;
                this.rejectAllPending(new Error(closeMessage));
                this.connected = false;
                this.initialized = false;
                this.proc = null;
                this.stderrBuffer = '';
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
        this.stderrBuffer = '';
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
    resolvePromptSession(sessionId, result) {
        if (!sessionId) {
            return false;
        }
        for (const [requestId, pending] of this.pending.entries()) {
            if (pending.method !== 'session/prompt' || pending.watchedSessionId !== sessionId) {
                continue;
            }
            this.pending.delete(requestId);
            pending.resolve({
                jsonrpc: '2.0',
                id: requestId,
                result
            });
            return true;
        }
        return false;
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
        try {
            const auth = await this.request('authenticate', { methodId: 'cursor_login' }, timeoutMs);
            if (auth.error) {
                this.logger('system', {
                    direction: 'system',
                    event: 'auth_optional_skipped',
                    payload: JSON.stringify(auth.error)
                });
            }
        }
        catch (error) {
            this.logger('system', {
                direction: 'system',
                event: 'auth_optional_skipped',
                payload: JSON.stringify({
                    message: error instanceof Error ? error.message : String(error)
                })
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
            if (!isHiddenAgentThoughtUpdate(message.params)) {
                this.logger('system', { direction: 'from_agent', event: 'session_update', payload: JSON.stringify(message.params) });
            }
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
async function captureCommandOutput(binary, args, cwd, timeoutMs) {
    return await new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)(binary, args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: node_process_1.default.env
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (fn) => {
            if (settled) {
                return;
            }
            settled = true;
            if (timer) {
                clearTimeout(timer);
            }
            fn();
        };
        const timer = setTimeout(() => {
            child.kill();
            finish(() => reject(new Error(`Command timed out: ${binary} ${args.join(' ')}`)));
        }, timeoutMs);
        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (error) => {
            finish(() => reject(error));
        });
        child.on('close', (code) => {
            finish(() => {
                resolve({
                    stdout,
                    stderr,
                    exitCode: code ?? 0
                });
            });
        });
    });
}
class CursorAcpRuntime {
    config;
    sessions = new Map();
    transcripts = new Map();
    toolCallAudit = [];
    mcpServer;
    transports = new Map();
    acpSessionStates = new Map();
    cursorSessionIds = new Map();
    cursorSessionLookup = new Map();
    activeStreamEmitters = new Map();
    promptMessageChunks = new Map();
    promptCompletionTimers = new Map();
    pendingPromptFallbacks = new Map();
    pendingSessionOperations = new Map();
    sessionOperationTails = new Map();
    sessionActivityAt = new Map();
    promptTransportActivityAt = new Map();
    transcriptLineSequences = new Map();
    auditedAssistantToolCallIds = new Map();
    activePromptStates = new Map();
    cliPlannerLoopState = new Map();
    workspaceAgentModels = new Map();
    debugLogger;
    configuredMcpServers;
    runtimeMcpServers = [];
    toolContext;
    runtimeOptions;
    constructor(workspaceRoot, toolContext, runtimeOptions = {}, debugLogger) {
        const acpCwd = resolveAcpWorkingDirectory(node_process_1.default.env.KBV_ACP_CWD);
        const cursorBinary = node_process_1.default.env[KBV_CURSOR_BINARY_ENV]?.trim() || resolveDefaultCursorBinary();
        this.config = {
            workspaceRoot,
            acpCwd,
            mcpBinary: cursorBinary,
            cliBinary: cursorBinary || DEFAULT_CLI_BINARY,
            cursorArgs: resolveCursorArgs(cursorBinary),
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
    async ensureWorkspaceAgentModelLoaded(workspaceId) {
        if (!workspaceId) {
            return undefined;
        }
        if (this.workspaceAgentModels.has(workspaceId)) {
            return this.workspaceAgentModels.get(workspaceId);
        }
        const modelId = normalizeAgentModelId(await this.runtimeOptions.getWorkspaceAgentModel?.(workspaceId));
        this.workspaceAgentModels.set(workspaceId, modelId);
        return modelId;
    }
    getWorkspaceAgentModel(workspaceId) {
        if (!workspaceId) {
            return undefined;
        }
        return normalizeAgentModelId(this.workspaceAgentModels.get(workspaceId));
    }
    async setWorkspaceAgentModel(workspaceId, agentModelId) {
        const normalized = normalizeAgentModelId(agentModelId);
        const current = this.getWorkspaceAgentModel(workspaceId);
        this.workspaceAgentModels.set(workspaceId, normalized);
        if (current !== normalized) {
            await this.restartWorkspaceAcpConnections(workspaceId);
        }
    }
    async getRuntimeOptions(workspaceId) {
        const currentModelId = await this.ensureWorkspaceAgentModelLoaded(workspaceId);
        const binary = this.resolveBinary('mcp');
        const commandSets = node_path_1.default.basename(binary).toLowerCase().replace(/\.exe$/, '') === 'agent'
            ? [['--list-models'], ['models']]
            : [
                [DEFAULT_AGENT_BINARY, '--list-models'],
                [DEFAULT_AGENT_BINARY, 'models'],
                ['agent', '--list-models'],
                ['agent', 'models']
            ];
        let lastError;
        for (const args of commandSets) {
            try {
                const commandBinary = args[0] === DEFAULT_AGENT_BINARY || args[0] === 'agent' ? args[0] : binary;
                const commandArgs = commandBinary === binary ? args : args.slice(1);
                const result = await captureCommandOutput(commandBinary, commandArgs, this.config.acpCwd, 15_000);
                if (result.exitCode !== 0) {
                    throw new Error(result.stderr.trim() || `Command exited with code ${result.exitCode}`);
                }
                const availableModels = this.parseAvailableModels(result.stdout);
                if (availableModels.length > 0 || currentModelId) {
                    return {
                        workspaceId,
                        currentModelId,
                        availableModels
                    };
                }
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
            }
        }
        const acpFallback = await this.probeRuntimeOptionsThroughAcp(workspaceId).catch((error) => {
            lastError = error instanceof Error ? error : new Error(String(error));
            return null;
        });
        if (acpFallback && ((acpFallback.availableModels?.length ?? 0) > 0 || acpFallback.currentModelId)) {
            return acpFallback;
        }
        throw lastError ?? new Error('Unable to load available agent models');
    }
    async probeRuntimeOptionsThroughAcp(workspaceId) {
        await this.ensureWorkspaceAgentModelLoaded(workspaceId);
        const provider = this.getProvider('mcp');
        const transport = this.getTransport('mcp', workspaceId);
        const initialized = await transport.ensureInitialized(this.config.requestTimeoutMs);
        if (!initialized) {
            throw new Error('Cursor ACP initialize failed');
        }
        const response = await transport.request('session/new', provider.buildSessionCreateParams(), this.config.requestTimeoutMs, `runtime-options:${workspaceId}`);
        if (response.error) {
            throw new Error(response.error.message);
        }
        const result = response.result;
        if (result?.sessionId) {
            try {
                await transport.request('session/close', { sessionId: result.sessionId }, this.config.requestTimeoutMs, `runtime-options:${workspaceId}`);
            }
            catch {
                // best effort
            }
        }
        return {
            workspaceId,
            currentModelId: normalizeAgentModelId(result?.currentModelId),
            availableModels: Array.isArray(result?.availableModels)
                ? result.availableModels.map((value) => value.trim()).filter(Boolean)
                : undefined
        };
    }
    parseAvailableModels(output) {
        const trimmed = output.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '').trim();
        if (!trimmed) {
            return [];
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean);
            }
            if (parsed && typeof parsed === 'object') {
                const models = parsed.models;
                if (Array.isArray(models)) {
                    return models
                        .map((value) => (typeof value === 'string' ? value : (value && typeof value === 'object' && 'id' in value ? String(value.id ?? '') : '')))
                        .map((value) => value.trim())
                        .filter(Boolean);
                }
            }
        }
        catch {
            // fall through to plain text parsing
        }
        return Array.from(new Set(trimmed
            .split('\n')
            .map((line) => line.trim())
            .map((line) => line.replace(/\s+\((?:current|default)[^)]+\)\s*$/i, '').trim())
            .map((line) => line.replace(/^[*\-]\s*/, '').replace(/^\d+\.\s*/, ''))
            .map((line) => line.split(/\s+-\s+/, 1)[0]?.trim() ?? '')
            .filter((line) => line && !/^(available models|loading models…|loading models\.{3}|tip:)/i.test(line))));
    }
    buildTransportKey(mode, workspaceId) {
        return [workspaceId ?? 'global', mode, this.getWorkspaceAgentModel(workspaceId) ?? 'default'].join('::');
    }
    async restartWorkspaceAcpConnections(workspaceId) {
        await Promise.all(Array.from(this.sessions.values())
            .filter((session) => session.workspaceId === workspaceId)
            .map((session) => this.resetCursorSession(session.id)));
        const prefix = `${workspaceId}::`;
        const matchingEntries = Array.from(this.transports.entries()).filter(([key]) => key.startsWith(prefix));
        await Promise.all(matchingEntries.map(async ([key, transport]) => {
            await transport.stop();
            this.transports.delete(key);
        }));
    }
    markSessionActivity(sessionId) {
        this.sessionActivityAt.set(sessionId, Date.now());
    }
    markPromptTransportActivity(sessionId) {
        this.promptTransportActivityAt.set(sessionId, Date.now());
        this.markSessionActivity(sessionId);
    }
    getPromptStructuredResultContract(session, taskPayload) {
        if (taskPayload.task !== 'analyze_batch' || session.type !== 'batch_analysis') {
            return undefined;
        }
        if (session.role === 'planner' && session.mode === 'plan') {
            return 'batch_planner';
        }
        if (session.role === 'plan-reviewer' && session.mode === 'plan') {
            return 'batch_plan_review';
        }
        if (session.role === 'worker' && session.mode === 'agent') {
            return 'batch_worker';
        }
        if (session.role === 'final-reviewer' && session.mode === 'plan') {
            return 'batch_final_review';
        }
        return undefined;
    }
    async pruneIdleNonChatSessions(workspaceId, options = {}) {
        const now = Date.now();
        const candidates = Array.from(this.sessions.values()).filter((session) => {
            if (session.workspaceId !== workspaceId || session.id === options.keepSessionId) {
                return false;
            }
            if (session.type === 'assistant_chat' || session.status === 'running' || session.status === 'closed') {
                return false;
            }
            if (options.activeBatchId
                && session.type === 'batch_analysis'
                && session.batchId
                && session.batchId !== options.activeBatchId) {
                return true;
            }
            const updatedAtMs = Date.parse(session.updatedAtUtc);
            return Number.isFinite(updatedAtMs) && now - updatedAtMs >= NON_CHAT_IDLE_SESSION_TTL_MS;
        });
        for (const session of candidates) {
            this.closeSession({ workspaceId, sessionId: session.id });
        }
    }
    async stopActivePrompt(localSessionId, acpSessionId, transport, reason) {
        const state = this.activePromptStates.get(localSessionId);
        if (state?.remotelyStopped) {
            return;
        }
        if (state) {
            state.remotelyStopped = true;
        }
        transport.abortPromptSession(acpSessionId, reason);
        await this.trackSessionOperation(localSessionId, this.appendTranscriptLine(localSessionId, 'system', 'prompt_abort', JSON.stringify({ reason, acpSessionId })));
    }
    maybeResolveStructuredPromptFromStream(localSessionId) {
        const state = this.activePromptStates.get(localSessionId);
        if (!state || !state.contract) {
            return;
        }
        const roleLabel = state.role?.trim() || 'structured batch stage';
        const assembledText = assemblePromptMessageText(this.promptMessageChunks.get(localSessionId)).trim();
        if (!assembledText) {
            return;
        }
        const now = Date.now();
        const lastTransportActivityAt = this.promptTransportActivityAt.get(localSessionId) ?? now;
        const idleForMs = now - lastTransportActivityAt;
        if (state.firstCompleteJsonAtMs === undefined && promptStreamMatchesContract(assembledText, state.contract)) {
            state.firstCompleteJsonAtMs = now;
        }
        if (state.jsonStartedAtMs === undefined && streamedTextLikelyStartsJsonObject(assembledText)) {
            state.jsonStartedAtMs = now;
        }
        if (state.firstCompleteJsonAtMs !== undefined
            && state.activeToolCalls.size === 0
            && now - state.firstCompleteJsonAtMs >= BATCH_PLANNER_JSON_STREAM_GRACE_MS) {
            const resolved = state.transport.resolvePromptSession(state.acpSessionId, {
                text: assembledText,
                content: [{ type: 'text', text: assembledText }]
            });
            if (resolved) {
                void this.stopActivePrompt(localSessionId, state.acpSessionId, state.transport, `Structured ${roleLabel} JSON was captured from the stream; stopping the remote prompt to avoid extra token usage.`);
                this.clearPromptCompletionTimer(localSessionId);
            }
            return;
        }
        const malformedJsonWindowExceeded = state.jsonStartedAtMs !== undefined
            && state.firstCompleteJsonAtMs === undefined
            && state.activeToolCalls.size === 0
            && idleForMs >= BATCH_PLANNER_MALFORMED_JSON_ABORT_MS;
        if (malformedJsonWindowExceeded) {
            void this.stopActivePrompt(localSessionId, state.acpSessionId, state.transport, `${roleLabel} entered structured JSON output but did not stabilize into a valid JSON result after ${state.chunkCount} streamed chunks and ${idleForMs}ms of inactivity. Stop and recover locally.`);
        }
    }
    trackSessionOperation(sessionId, operation) {
        const pending = this.pendingSessionOperations.get(sessionId) ?? new Set();
        pending.add(operation);
        this.pendingSessionOperations.set(sessionId, pending);
        this.markSessionActivity(sessionId);
        operation.finally(() => {
            const active = this.pendingSessionOperations.get(sessionId);
            if (!active) {
                return;
            }
            active.delete(operation);
            if (active.size === 0) {
                this.pendingSessionOperations.delete(sessionId);
            }
            this.markSessionActivity(sessionId);
        });
        return operation;
    }
    queueSessionOperation(sessionId, task) {
        const previous = this.sessionOperationTails.get(sessionId) ?? Promise.resolve();
        const operation = previous
            .catch(() => undefined)
            .then(task);
        let tail;
        tail = operation
            .then(() => undefined, () => undefined)
            .finally(() => {
            if (this.sessionOperationTails.get(sessionId) === tail) {
                this.sessionOperationTails.delete(sessionId);
            }
        });
        this.sessionOperationTails.set(sessionId, tail);
        return this.trackSessionOperation(sessionId, operation);
    }
    async waitForSessionToSettle(sessionId, idleMs = 350, maxWaitMs = 5000, minWaitMs = 0) {
        const startedAt = Date.now();
        this.markSessionActivity(sessionId);
        this.log('agent.runtime.session_finalize_wait_begin', { sessionId, idleMs, maxWaitMs, minWaitMs });
        while (Date.now() - startedAt < maxWaitMs) {
            const pending = this.pendingSessionOperations.get(sessionId);
            if (pending && pending.size > 0) {
                await Promise.allSettled(Array.from(pending));
                continue;
            }
            const lastActivityAt = this.sessionActivityAt.get(sessionId) ?? startedAt;
            const idleForMs = Date.now() - lastActivityAt;
            const waitedForMs = Date.now() - startedAt;
            if (idleForMs >= idleMs && waitedForMs >= minWaitMs) {
                this.log('agent.runtime.session_finalize_wait_complete', { sessionId, idleForMs, waitedForMs });
                return;
            }
            const minWaitRemainingMs = Math.max(0, minWaitMs - waitedForMs);
            const nextDelayMs = Math.max(10, Math.min(100, idleMs - idleForMs, minWaitRemainingMs || 100));
            await new Promise((resolve) => setTimeout(resolve, nextDelayMs));
        }
        this.log('agent.runtime.session_finalize_wait_timeout', { sessionId, maxWaitMs, minWaitMs });
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
            mode: input.mode ?? 'agent',
            role: input.role,
            status: 'idle',
            batchId: input.batchId,
            locale: input.locale,
            templatePackId: input.templatePackId,
            scope: input.scope,
            directContext: input.directContext,
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
        void this.resetCursorSession(session.id);
        return session;
    }
    async checkHealth(workspaceId, selectedMode = DEFAULT_AGENT_ACCESS_MODE, workspaceKbAccessMode) {
        this.log('agent.runtime.health_check_start', {
            workspaceId,
            selectedMode,
            workspaceKbAccessMode: workspaceKbAccessMode ?? selectedMode
        });
        const [direct, mcp, cli] = await Promise.all([
            this.getProviderHealth('direct', workspaceId),
            this.getProviderHealth('mcp'),
            this.getProviderHealth('cli', workspaceId)
        ]);
        const aggregatedIssues = Array.from(new Set([
            ...(direct.issues ?? []),
            ...(mcp.issues ?? []),
            ...(cli.issues ?? []),
            ...(!direct.ok && direct.message && !(direct.issues ?? []).includes(direct.message) ? [direct.message] : []),
            ...(!mcp.ok && mcp.message && !(mcp.issues ?? []).includes(mcp.message) ? [mcp.message] : []),
            ...(!cli.ok && cli.message && !(cli.issues ?? []).includes(cli.message) ? [cli.message] : [])
        ].filter(Boolean)));
        const availableModes = shared_types_2.KB_ACCESS_MODES
            .map((mode) => ({ mode, health: mode === 'direct' ? direct : mode === 'mcp' ? mcp : cli }))
            .filter(({ health }) => health.ok)
            .map(({ mode }) => mode);
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
                direct,
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
                direct: {
                    ok: direct.ok,
                    failureCode: direct.failureCode,
                    message: direct.message,
                    acpReachable: direct.acpReachable
                },
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
        const providerSessionMode = resolveProviderSessionMode(mode, session.mode);
        if (mode === 'cli') {
            await this.runtimeOptions.prepareCliEnvironment?.(session.workspaceId);
        }
        await this.ensureWorkspaceAgentModelLoaded(session.workspaceId);
        const agentModelId = this.getWorkspaceAgentModel(session.workspaceId);
        const transportKey = this.buildTransportKey(mode, session.workspaceId);
        const existing = this.cursorSessionIds.get(session.id);
        if (existing?.mode === mode
            && existing.transportKey === transportKey
            && existing.sessionMode === providerSessionMode) {
            return existing.acpSessionId;
        }
        if (existing
            && (existing.mode !== mode || existing.transportKey !== transportKey || existing.sessionMode !== providerSessionMode)) {
            await this.resetCursorSession(session.id);
        }
        const provider = this.getProvider(mode);
        const transport = this.getTransport(mode, session.workspaceId);
        this.log('agent.runtime.session_new_start', {
            sessionId: session.id,
            mode,
            requestedSessionMode: session.mode,
            providerSessionMode,
            agentModelId: agentModelId ?? 'default'
        });
        const response = await transport.request('session/new', provider.buildSessionCreateParams(session.mode), this.config.requestTimeoutMs, session.id);
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
        this.acpSessionStates.set(result.sessionId, {
            createdAtMs: Date.now(),
            ready: false,
            waiters: new Set()
        });
        const reportedModelState = parseSessionModelState(result.models);
        const normalizedRequestedModelId = normalizeAgentModelId(agentModelId);
        const normalizedCurrentModelId = normalizeAgentModelId(reportedModelState?.currentModelId);
        if (normalizedRequestedModelId && reportedModelState && normalizedRequestedModelId !== normalizedCurrentModelId) {
            const setModelResponse = await transport.request('session/set_model', {
                sessionId: result.sessionId,
                modelId: normalizedRequestedModelId
            }, this.config.requestTimeoutMs, session.id);
            if (setModelResponse.error) {
                this.log('agent.runtime.session_set_model_failed', {
                    sessionId: session.id,
                    acpSessionId: result.sessionId,
                    requestedModelId: normalizedRequestedModelId,
                    currentModelId: normalizedCurrentModelId ?? 'default',
                    availableModels: reportedModelState.availableModels?.map((model) => model.modelId).filter(Boolean) ?? [],
                    error: setModelResponse.error
                });
                try {
                    await transport.request('session/close', { sessionId: result.sessionId }, this.config.requestTimeoutMs, session.id);
                }
                catch {
                    // Best effort close for a session that failed model selection.
                }
                throw new NonRetriableRuntimeError(`Cursor ACP rejected selected model "${normalizedRequestedModelId}": ${setModelResponse.error.message}`);
            }
            this.log('agent.runtime.session_set_model_success', {
                sessionId: session.id,
                acpSessionId: result.sessionId,
                requestedModelId: normalizedRequestedModelId,
                previousModelId: normalizedCurrentModelId ?? 'default'
            });
        }
        this.log('agent.runtime.session_new_success', {
            sessionId: session.id,
            acpSessionId: result.sessionId,
            mode,
            requestedSessionMode: session.mode,
            providerSessionMode,
            agentModelId: agentModelId ?? 'default'
        });
        this.cursorSessionIds.set(session.id, {
            mode,
            sessionMode: providerSessionMode,
            acpSessionId: result.sessionId,
            transportKey
        });
        this.cursorSessionLookup.set(result.sessionId, { localSessionId: session.id, mode });
        return result.sessionId;
    }
    markAcpSessionReady(acpSessionId) {
        if (!acpSessionId) {
            return;
        }
        const state = this.acpSessionStates.get(acpSessionId);
        if (!state || state.ready) {
            return;
        }
        state.ready = true;
        for (const waiter of state.waiters) {
            waiter(true);
        }
        state.waiters.clear();
    }
    clearAcpSessionState(acpSessionId) {
        if (!acpSessionId) {
            return;
        }
        const state = this.acpSessionStates.get(acpSessionId);
        if (!state) {
            return;
        }
        for (const waiter of state.waiters) {
            waiter(false);
        }
        state.waiters.clear();
        this.acpSessionStates.delete(acpSessionId);
    }
    async waitForAcpSessionReady(acpSessionId, timeoutMs) {
        const state = this.acpSessionStates.get(acpSessionId);
        if (!state) {
            return false;
        }
        if (state.ready) {
            return true;
        }
        if (timeoutMs <= 0) {
            return false;
        }
        return await new Promise((resolve) => {
            let settled = false;
            const finish = (ready) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                state.waiters.delete(finish);
                resolve(ready);
            };
            const timer = setTimeout(() => finish(false), timeoutMs);
            state.waiters.add(finish);
        });
    }
    async handleMcpJsonMessage(raw) {
        return this.mcpServer.handleJsonMessage(raw);
    }
    shouldUseDirectBatchActionLoop(session) {
        return (session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE) === 'direct'
            && Boolean(getDirectBatchStageActionTypes(session));
    }
    shouldUseDirectActionLoop(session) {
        return (session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE) === 'direct'
            && Boolean(getDirectActionTypesForSession(session));
    }
    async runDirectActionLoop(session, taskPayload, emit, toolCalls, rawOutput, isCancelled, timeoutMs, startedAtMs) {
        const executeDirectAction = this.runtimeOptions.executeDirectAction;
        const originalPrompt = typeof taskPayload.prompt === 'string' ? taskPayload.prompt : '';
        let nextPrompt = originalPrompt;
        let turnCount = 0;
        let recoveryCount = 0;
        const repeatedActionDigests = new Map();
        while (true) {
            const initialResultPayload = await this.transit(session, {
                ...taskPayload,
                prompt: nextPrompt
            }, emit, toolCalls, isCancelled, timeoutMs);
            const settleWindow = session.type === 'batch_analysis'
                ? getBatchAnalysisPromptSettleWindow(initialResultPayload, assemblePromptMessageText(this.promptMessageChunks.get(session.id)).trim())
                : ASSISTANT_CHAT_PROMPT_SETTLE_WINDOW;
            const remainingWaitMs = Math.max(0, timeoutMs - (Date.now() - startedAtMs));
            await this.waitForSessionToSettle(session.id, settleWindow.idleMs, Math.min(settleWindow.maxWaitMs, remainingWaitMs), Math.min(settleWindow.minWaitMs, remainingWaitMs));
            const resultPayload = this.finalizePromptResult(session.id, initialResultPayload);
            const finalText = extractPromptResultText(resultPayload);
            const actionEnvelope = parseDirectActionEnvelope(resultPayload);
            if (!actionEnvelope) {
                const terminalEnvelope = parseDirectTerminalEnvelope(resultPayload);
                const canRecover = !terminalEnvelope
                    && recoveryCount < DIRECT_PROTOCOL_RECOVERY_LIMIT
                    && remainingWaitMs >= 5_000
                    && looksLikeRecoverableDirectProtocolText(finalText);
                if (canRecover) {
                    recoveryCount += 1;
                    rawOutput.push(`[direct protocol recovery ${recoveryCount}] ${String(finalText ?? '')}`);
                    this.log('agent.runtime.direct_protocol_recovery', {
                        workspaceId: session.workspaceId,
                        sessionId: session.id,
                        role: session.role,
                        recoveryCount,
                        finalText
                    });
                    nextPrompt = buildDirectRecoveryPrompt(session, nextPrompt, finalText, recoveryCount);
                    continue;
                }
                return {
                    resultPayload,
                    finalText,
                    terminalEnvelope: terminalEnvelope ?? undefined
                };
            }
            recoveryCount = 0;
            if (!executeDirectAction) {
                const blocked = buildDirectBlockedResultEnvelope('Direct executor path is unavailable for this runtime session.');
                return {
                    resultPayload: buildSyntheticPromptResult(blocked),
                    finalText: JSON.stringify(blocked),
                    terminalEnvelope: blocked
                };
            }
            turnCount += 1;
            if (turnCount > DIRECT_ACTION_LOOP_MAX_TURNS) {
                const blocked = buildDirectBlockedResultEnvelope(`Direct action loop exceeded ${DIRECT_ACTION_LOOP_MAX_TURNS} turns.`);
                return {
                    resultPayload: buildSyntheticPromptResult(blocked),
                    finalText: JSON.stringify(blocked),
                    terminalEnvelope: blocked
                };
            }
            const actionDigest = `${actionEnvelope.action.type}:${stableStringify(actionEnvelope.action.args)}`;
            const repeatCount = (repeatedActionDigests.get(actionDigest) ?? 0) + 1;
            repeatedActionDigests.set(actionDigest, repeatCount);
            if (repeatCount > DIRECT_ACTION_REPEAT_LIMIT) {
                const blocked = buildDirectBlockedResultEnvelope(`Direct action loop repeated the same ${actionEnvelope.action.type} request too many times.`, {
                    actionType: actionEnvelope.action.type,
                    repeatCount
                });
                return {
                    resultPayload: buildSyntheticPromptResult(blocked),
                    finalText: JSON.stringify(blocked),
                    terminalEnvelope: blocked
                };
            }
            const requestedAtUtc = new Date().toISOString();
            rawOutput.push(`[direct action request ${turnCount}] ${JSON.stringify(actionEnvelope.action)}`);
            await this.appendTranscriptLine(session.id, 'system', 'direct_action_request', JSON.stringify(actionEnvelope.action));
            await Promise.resolve(emit({
                kind: 'tool_call',
                data: {
                    provider: 'direct',
                    action: actionEnvelope.action
                },
                message: `direct_action:${actionEnvelope.action.type}`
            }));
            const validationError = (0, shared_types_2.validateDirectActionArgs)(actionEnvelope.action.type, actionEnvelope.action.args);
            let resultEnvelope;
            if (validationError) {
                resultEnvelope = {
                    type: 'action_result',
                    actionId: actionEnvelope.action.id,
                    ok: false,
                    error: {
                        code: 'INVALID_DIRECT_ACTION_INPUT',
                        message: validationError
                    }
                };
            }
            else {
                const execution = await executeDirectAction({
                    context: {
                        workspaceId: session.workspaceId,
                        batchId: session.batchId,
                        sessionId: session.id,
                        sessionType: session.type,
                        sessionMode: session.mode,
                        agentRole: session.role,
                        locale: session.locale,
                        scope: session.scope,
                        directContext: session.directContext
                    },
                    action: actionEnvelope.action
                });
                resultEnvelope = {
                    type: 'action_result',
                    actionId: execution.actionId,
                    ok: execution.ok,
                    ...(execution.ok ? { data: execution.data } : { error: execution.error ?? { message: 'Direct action failed' } })
                };
            }
            const actionReason = resultEnvelope.ok ? undefined : resultEnvelope.error?.message;
            const auditEntry = {
                workspaceId: session.workspaceId,
                sessionId: session.id,
                toolName: `direct.${actionEnvelope.action.type}`,
                args: actionEnvelope.action.args,
                calledAtUtc: requestedAtUtc,
                allowed: resultEnvelope.ok,
                reason: actionReason
            };
            this.toolCallAudit.push(auditEntry);
            toolCalls.push(auditEntry);
            rawOutput.push(`[direct action result ${turnCount}] ${JSON.stringify(resultEnvelope)}`);
            await this.appendTranscriptLine(session.id, 'system', 'direct_action_result', JSON.stringify(resultEnvelope));
            await Promise.resolve(emit({
                kind: 'tool_response',
                data: {
                    provider: 'direct',
                    action: actionEnvelope.action,
                    result: resultEnvelope
                },
                message: `direct_result:${actionEnvelope.action.type}`
            }));
            this.markSessionActivity(session.id);
            if (resultEnvelope.ok
                && actionEnvelope.action.type === 'patch_form'
                && session.directContext
                && resultEnvelope.data
                && typeof resultEnvelope.data === 'object'
                && typeof resultEnvelope.data.nextVersionToken === 'string') {
                session.directContext = {
                    ...session.directContext,
                    workingStateVersionToken: String(resultEnvelope.data.nextVersionToken)
                };
            }
            if (isCancelled()) {
                const canceledMessage = session.type === 'batch_analysis'
                    ? 'Direct batch analysis was canceled.'
                    : session.type === 'assistant_chat'
                        ? 'Direct assistant turn was canceled.'
                        : 'Direct article edit was canceled.';
                const blocked = buildDirectBlockedResultEnvelope(canceledMessage);
                return {
                    resultPayload: buildSyntheticPromptResult(blocked),
                    finalText: JSON.stringify(blocked),
                    terminalEnvelope: blocked
                };
            }
            nextPrompt = buildDirectContinuationPrompt(session, originalPrompt, resultEnvelope, turnCount);
        }
    }
    async runBatchAnalysis(request, emit, isCancelled) {
        const session = await this.resolveSession(request);
        const startedAtMs = Date.now();
        const startedAt = new Date(startedAtMs).toISOString();
        const runId = (0, node_crypto_1.randomUUID)();
        const transcriptPath = await this.ensureTranscriptPath(session.id, runId);
        const toolCalls = [];
        const rawOutput = [];
        const timeoutMs = Math.max(request.timeoutMs ?? this.config.requestTimeoutMs, 120_000);
        this.markSessionActivity(session.id);
        this.log('agent.runtime.batch_analysis_begin', {
            workspaceId: request.workspaceId,
            batchId: request.batchId,
            locale: request.locale,
            timeoutMs
        });
        try {
            const baseTaskPayload = {
                task: 'analyze_batch',
                batchId: request.batchId,
                locale: request.locale,
                templatePackId: request.templatePackId
            };
            const streamEmit = (event) => {
                rawOutput.push(event.message ?? JSON.stringify(event.data ?? {}));
                emit({ sessionId: session.id, kind: event.kind, data: event.data, message: event.message, atUtc: new Date().toISOString() });
            };
            if (this.shouldUseDirectBatchActionLoop(session)) {
                const directLoopResult = await this.runDirectActionLoop(session, {
                    ...baseTaskPayload,
                    prompt: request.prompt
                }, streamEmit, toolCalls, rawOutput, isCancelled, timeoutMs, startedAtMs);
                const endedAt = new Date().toISOString();
                const acpSessionId = this.cursorSessionIds.get(session.id)?.acpSessionId;
                session.updatedAtUtc = endedAt;
                session.status = 'idle';
                if (directLoopResult.terminalEnvelope) {
                    return {
                        sessionId: session.id,
                        acpSessionId,
                        kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
                        status: 'error',
                        transcriptPath,
                        rawOutput,
                        resultPayload: directLoopResult.resultPayload,
                        toolCalls: this.populateRunToolCalls(toolCalls, session.id, request.workspaceId),
                        startedAtUtc: startedAt,
                        endedAtUtc: endedAt,
                        durationMs: Date.parse(endedAt) - startedAtMs,
                        message: directLoopResult.terminalEnvelope.message
                    };
                }
                return {
                    sessionId: session.id,
                    acpSessionId,
                    kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
                    status: isCancelled() ? 'canceled' : 'ok',
                    transcriptPath,
                    rawOutput,
                    resultPayload: directLoopResult.resultPayload,
                    finalText: directLoopResult.finalText,
                    toolCalls: this.populateRunToolCalls(toolCalls, session.id, request.workspaceId),
                    startedAtUtc: startedAt,
                    endedAtUtc: endedAt,
                    durationMs: Date.parse(endedAt) - startedAtMs,
                    message: isCancelled() ? 'Run cancelled' : 'Completed'
                };
            }
            const structuredResultContract = this.getPromptStructuredResultContract(session, {
                ...baseTaskPayload,
                prompt: request.prompt
            });
            const promptSeed = stripBatchAnalysisContinuation(request.prompt);
            let autoContinueCount = 0;
            let nextPrompt = request.prompt;
            let resultPayload = undefined;
            let finalText = undefined;
            while (true) {
                const initialResultPayload = await this.transit(session, {
                    ...baseTaskPayload,
                    prompt: nextPrompt
                }, streamEmit, toolCalls, isCancelled, timeoutMs);
                const settleWindow = getBatchAnalysisPromptSettleWindow(initialResultPayload, assemblePromptMessageText(this.promptMessageChunks.get(session.id)).trim());
                const remainingWaitMs = Math.max(0, timeoutMs - (Date.now() - startedAtMs));
                await this.waitForSessionToSettle(session.id, settleWindow.idleMs, Math.min(settleWindow.maxWaitMs, remainingWaitMs), Math.min(settleWindow.minWaitMs, remainingWaitMs));
                resultPayload = this.finalizePromptResult(session.id, initialResultPayload);
                finalText = extractPromptResultText(resultPayload);
                const canAutoContinue = !isCancelled()
                    && autoContinueCount < BATCH_ANALYSIS_AUTO_CONTINUE_LIMIT
                    && remainingWaitMs >= 5_000
                    && shouldAutoContinueBatchAnalysisTurn({
                        contract: structuredResultContract,
                        resultText: finalText,
                        toolCallCount: toolCalls.length
                    });
                if (canAutoContinue) {
                    autoContinueCount += 1;
                    rawOutput.push(`[batch-analysis auto-continue ${autoContinueCount}] ${String(finalText ?? '')}`);
                    this.log('agent.runtime.batch_analysis_auto_continue', {
                        workspaceId: request.workspaceId,
                        batchId: request.batchId,
                        sessionId: session.id,
                        role: session.role,
                        autoContinueCount,
                        resultText: finalText
                    });
                    const continuationSeed = promptSeed.trim().length > 0 ? promptSeed : (nextPrompt ?? '');
                    nextPrompt = buildBatchAnalysisContinuationPrompt(continuationSeed, session.role, finalText);
                    continue;
                }
                break;
            }
            const endedAt = new Date().toISOString();
            const acpSessionId = this.cursorSessionIds.get(session.id)?.acpSessionId;
            session.updatedAtUtc = endedAt;
            session.status = 'idle';
            return {
                sessionId: session.id,
                acpSessionId,
                kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
                status: isCancelled() ? 'canceled' : 'ok',
                transcriptPath,
                rawOutput,
                resultPayload,
                finalText,
                toolCalls: this.populateRunToolCalls(toolCalls, session.id, request.workspaceId),
                startedAtUtc: startedAt,
                endedAtUtc: endedAt,
                durationMs: Date.parse(endedAt) - startedAtMs,
                message: isCancelled() ? 'Run cancelled' : 'Completed'
            };
        }
        catch (error) {
            this.log('agent.runtime.batch_analysis_failed', {
                workspaceId: request.workspaceId,
                batchId: request.batchId,
                error: error instanceof Error ? error.message : String(error)
            });
            await this.waitForSessionToSettle(session.id, 350, timeoutMs);
            const endedAt = new Date().toISOString();
            const acpSessionId = this.cursorSessionIds.get(session.id)?.acpSessionId;
            session.updatedAtUtc = endedAt;
            session.status = 'idle';
            return {
                sessionId: session.id,
                acpSessionId,
                kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
                status: 'error',
                transcriptPath,
                rawOutput,
                resultPayload: undefined,
                finalText: undefined,
                toolCalls: this.populateRunToolCalls(toolCalls, session.id, request.workspaceId),
                startedAtUtc: startedAt,
                endedAtUtc: endedAt,
                durationMs: Date.parse(endedAt) - Date.parse(startedAt),
                message: error instanceof Error ? error.message : String(error)
            };
        }
        finally {
            this.cleanupPromptState(session.id);
            this.log('agent.runtime.batch_analysis_complete', {
                workspaceId: request.workspaceId,
                batchId: request.batchId,
                sessionId: session.id
            });
        }
    }
    async runArticleEdit(request, emit, isCancelled) {
        const session = await this.resolveSession(request);
        const startedAtMs = Date.now();
        const startedAt = new Date(startedAtMs).toISOString();
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
            const streamEmit = (event) => {
                rawOutput.push(event.message ?? JSON.stringify(event.data ?? {}));
                emit({ sessionId: session.id, kind: event.kind, data: event.data, message: event.message, atUtc: new Date().toISOString() });
            };
            const taskPayload = {
                task: 'edit_article',
                localeVariantId: request.localeVariantId,
                prompt: request.prompt,
                locale: request.locale
            };
            const directLoopResult = this.shouldUseDirectActionLoop(session)
                ? await this.runDirectActionLoop(session, taskPayload, streamEmit, toolCalls, rawOutput, isCancelled, request.timeoutMs ?? this.config.requestTimeoutMs, startedAtMs)
                : null;
            const resultPayload = directLoopResult
                ? directLoopResult.resultPayload
                : await this.transit(session, taskPayload, streamEmit, toolCalls, isCancelled, request.timeoutMs ?? this.config.requestTimeoutMs);
            const endedAt = new Date().toISOString();
            const acpSessionId = this.cursorSessionIds.get(session.id)?.acpSessionId;
            if (directLoopResult?.terminalEnvelope) {
                return {
                    sessionId: session.id,
                    acpSessionId,
                    kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
                    status: 'error',
                    transcriptPath,
                    rawOutput,
                    resultPayload,
                    toolCalls: this.populateRunToolCalls(toolCalls, session.id, request.workspaceId),
                    startedAtUtc: startedAt,
                    endedAtUtc: endedAt,
                    durationMs: Date.parse(endedAt) - startedAtMs,
                    message: directLoopResult.terminalEnvelope.message
                };
            }
            return {
                sessionId: session.id,
                acpSessionId,
                kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
                status: isCancelled() ? 'canceled' : 'ok',
                transcriptPath,
                rawOutput,
                resultPayload,
                toolCalls: this.populateRunToolCalls(toolCalls, session.id, request.workspaceId),
                startedAtUtc: startedAt,
                endedAtUtc: endedAt,
                durationMs: Date.parse(endedAt) - startedAtMs,
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
            const acpSessionId = this.cursorSessionIds.get(session.id)?.acpSessionId;
            return {
                sessionId: session.id,
                acpSessionId,
                kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
                status: 'error',
                transcriptPath,
                rawOutput,
                resultPayload: undefined,
                toolCalls: this.populateRunToolCalls(toolCalls, session.id, request.workspaceId),
                startedAtUtc: startedAt,
                endedAtUtc: endedAt,
                durationMs: Date.parse(endedAt) - startedAtMs,
                message: error instanceof Error ? error.message : String(error)
            };
        }
        finally {
            this.cleanupPromptState(session.id);
            session.status = 'idle';
            session.updatedAtUtc = new Date().toISOString();
            this.log('agent.runtime.article_edit_complete', {
                workspaceId: request.workspaceId,
                localeVariantId: request.localeVariantId,
                sessionId: session.id
            });
        }
    }
    async runAssistantChat(request, emit, isCancelled) {
        const session = await this.resolveSession({ ...request, sessionType: 'assistant_chat' });
        const startedAtMs = Date.now();
        const startedAt = new Date().toISOString();
        const runId = (0, node_crypto_1.randomUUID)();
        const transcriptPath = await this.ensureTranscriptPath(session.id, runId);
        const toolCalls = [];
        const rawOutput = [];
        const timeoutMs = request.timeoutMs ?? this.config.requestTimeoutMs;
        this.log('agent.runtime.assistant_chat_begin', {
            workspaceId: request.workspaceId,
            localeVariantId: request.localeVariantId,
            timeoutMs
        });
        try {
            let resultPayload = undefined;
            let completionState = undefined;
            let isFinal = undefined;
            let attempt = 0;
            let autoContinueCount = 0;
            let nextPrompt = request.prompt;
            const promptSeed = stripAssistantChatContinuation(request.prompt);
            const useDirectActionLoop = this.shouldUseDirectActionLoop(session);
            const streamEmit = (event) => {
                rawOutput.push(event.message ?? JSON.stringify(event.data ?? {}));
                emit({ sessionId: session.id, kind: event.kind, data: event.data, message: event.message, atUtc: new Date().toISOString() });
            };
            while (true) {
                let directLoopResult = null;
                let transitResultPayload = undefined;
                try {
                    const taskPayload = {
                        task: 'assistant_chat',
                        localeVariantId: request.localeVariantId,
                        prompt: nextPrompt,
                        locale: request.locale
                    };
                    if (useDirectActionLoop) {
                        directLoopResult = await this.runDirectActionLoop(session, taskPayload, streamEmit, toolCalls, rawOutput, isCancelled, timeoutMs, startedAtMs);
                    }
                    else {
                        transitResultPayload = await this.transit(session, taskPayload, streamEmit, toolCalls, isCancelled, timeoutMs);
                    }
                }
                catch (error) {
                    const remainingWaitMs = Math.max(0, timeoutMs - (Date.now() - startedAtMs));
                    const violationMode = detectAssistantToolPolicyViolationMode(error);
                    const canRecoverFromToolPolicy = !isCancelled()
                        && attempt < ASSISTANT_CHAT_RECOVERY_RETRY_LIMIT
                        && remainingWaitMs >= 1_000
                        && violationMode !== null;
                    if (!canRecoverFromToolPolicy) {
                        throw error;
                    }
                    attempt += 1;
                    const policyError = error instanceof Error ? error.message : String(error);
                    nextPrompt = buildAssistantChatContinuationPrompt(promptSeed || nextPrompt, buildAssistantChatToolRecoveryPrompt(violationMode ?? (session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE), policyError));
                    rawOutput.push(`[assistant-chat tool-policy recovery ${attempt}] ${policyError}`);
                    this.log('agent.runtime.assistant_chat_tool_policy_retry', {
                        workspaceId: request.workspaceId,
                        sessionId: session.id,
                        attempt,
                        kbAccessMode: violationMode ?? (session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE),
                        reason: policyError
                    });
                    continue;
                }
                if (useDirectActionLoop && !directLoopResult) {
                    throw new Error('Assistant chat direct loop did not produce a result');
                }
                if (!useDirectActionLoop) {
                    const settleWindow = ASSISTANT_CHAT_PROMPT_SETTLE_WINDOW;
                    await this.waitForSessionToSettle(session.id, settleWindow.idleMs, settleWindow.maxWaitMs, settleWindow.minWaitMs);
                    resultPayload = this.finalizePromptResult(session.id, transitResultPayload);
                }
                else {
                    resultPayload = directLoopResult.resultPayload;
                }
                const completion = extractAssistantCompletionContract(resultPayload);
                completionState = completion.completionState;
                isFinal = completion.isFinal;
                const resultText = directLoopResult?.finalText ?? extractPromptResultText(resultPayload);
                const remainingWaitMs = Math.max(0, timeoutMs - (Date.now() - startedAtMs));
                const canAutoContinue = !isCancelled()
                    && autoContinueCount < ASSISTANT_CHAT_AUTO_CONTINUE_LIMIT
                    && remainingWaitMs >= 5_000
                    && (isFinal === false
                        || completionState === 'researching'
                        || (completionState === undefined
                            && looksLikeAssistantProgressText(resultText)));
                if (canAutoContinue) {
                    autoContinueCount += 1;
                    nextPrompt = buildAssistantChatContinuationPrompt(promptSeed || nextPrompt, buildAssistantChatContinuePrompt(session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE));
                    rawOutput.push(`[assistant-chat auto-continue ${autoContinueCount}] ${String(resultText ?? '')}`);
                    this.log('agent.runtime.assistant_chat_auto_continue', {
                        workspaceId: request.workspaceId,
                        sessionId: session.id,
                        autoContinueCount,
                        resultText
                    });
                    continue;
                }
                break;
            }
            const endedAt = new Date().toISOString();
            const acpSessionId = this.cursorSessionIds.get(session.id)?.acpSessionId;
            return {
                sessionId: session.id,
                acpSessionId,
                kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
                status: isCancelled() ? 'canceled' : 'ok',
                completionState: completionState ?? 'completed',
                isFinal: isFinal ?? true,
                transcriptPath,
                rawOutput,
                resultPayload,
                toolCalls: this.populateRunToolCalls(toolCalls, session.id, request.workspaceId),
                startedAtUtc: startedAt,
                endedAtUtc: endedAt,
                durationMs: Date.parse(endedAt) - startedAtMs,
                message: isCancelled() ? 'Run cancelled' : 'Completed'
            };
        }
        catch (error) {
            this.log('agent.runtime.assistant_chat_failed', {
                workspaceId: request.workspaceId,
                localeVariantId: request.localeVariantId,
                error: error instanceof Error ? error.message : String(error)
            });
            await this.waitForSessionToSettle(session.id, 350, timeoutMs);
            const endedAt = new Date().toISOString();
            const acpSessionId = this.cursorSessionIds.get(session.id)?.acpSessionId;
            return {
                sessionId: session.id,
                acpSessionId,
                kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
                status: 'error',
                completionState: 'errored',
                isFinal: true,
                transcriptPath,
                rawOutput,
                resultPayload: undefined,
                toolCalls: this.populateRunToolCalls(toolCalls, session.id, request.workspaceId),
                startedAtUtc: startedAt,
                endedAtUtc: endedAt,
                durationMs: Date.parse(endedAt) - startedAtMs,
                message: error instanceof Error ? error.message : String(error)
            };
        }
        finally {
            this.cleanupPromptState(session.id);
            session.status = 'idle';
            session.updatedAtUtc = new Date().toISOString();
            this.log('agent.runtime.assistant_chat_complete', {
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
        const ordered = sortTranscriptLines(parsed);
        if (!input.limit) {
            return {
                workspaceId: input.workspaceId,
                sessionId: input.sessionId,
                lines: ordered
            };
        }
        return {
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            lines: ordered.slice(-input.limit)
        };
    }
    listToolCallAudit(sessionId, workspaceId) {
        return this.toolCallAudit.filter((audit) => audit.sessionId === sessionId && audit.workspaceId === workspaceId);
    }
    populateRunToolCalls(target, sessionId, workspaceId) {
        const recorded = this.listToolCallAudit(sessionId, workspaceId);
        const fallback = recorded.length > 0 ? recorded : this.extractToolCallAuditFromTranscript(sessionId, workspaceId);
        target.splice(0, target.length, ...fallback);
        return target;
    }
    extractToolCallAuditFromTranscript(sessionId, workspaceId) {
        const transcriptPath = this.transcripts.get(sessionId);
        if (!transcriptPath || !node_fs_1.default.existsSync(transcriptPath)) {
            return [];
        }
        try {
            const contents = node_fs_1.default.readFileSync(transcriptPath, 'utf8');
            const seenToolCallIds = new Set();
            const recovered = [];
            const transcriptLines = sortTranscriptLines(contents
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
            }));
            for (const parsedLine of transcriptLines) {
                if (!parsedLine || parsedLine.event !== 'session_update' || parsedLine.direction !== 'from_agent') {
                    continue;
                }
                let payload = null;
                try {
                    payload = JSON.parse(parsedLine.payload);
                }
                catch {
                    payload = null;
                }
                const update = payload?.update;
                if (!update || typeof update.toolCallId !== 'string' || seenToolCallIds.has(update.toolCallId)) {
                    continue;
                }
                const cliAuditLabel = typeof update.title === 'string' && update.title.trim()
                    ? update.title
                    : extractCliToolCommand(update.rawInput) ?? extractCliToolCommandFromRawOutput(update.rawOutput);
                if (!cliAuditLabel || shouldDeferCliToolPolicyCheck(update)) {
                    continue;
                }
                seenToolCallIds.add(update.toolCallId);
                const policy = this.evaluateCliToolPolicy(cliAuditLabel, update.kind, update.rawInput, update.rawOutput);
                recovered.push({
                    workspaceId,
                    sessionId,
                    toolName: policy.auditedToolName,
                    args: selectCliToolAuditArgs(update.rawInput, update.rawOutput, update.kind),
                    calledAtUtc: parsedLine.atUtc,
                    allowed: policy.allowed,
                    reason: policy.reason
                });
            }
            return recovered;
        }
        catch {
            return [];
        }
    }
    async stop() {
        await Promise.all(Array.from(this.transports.values()).map((transport) => transport.stop()));
    }
    findReusableBatchAnalysisSession(input) {
        return Array.from(this.sessions.values())
            .filter((session) => session.workspaceId === input.workspaceId
            && session.type === 'batch_analysis'
            && session.batchId === input.batchId
            && session.status !== 'closed')
            .sort((left, right) => right.updatedAtUtc.localeCompare(left.updatedAtUtc))[0] ?? null;
    }
    async resolveSession(input) {
        const sessionType = input.sessionType ?? ('localeVariantId' in input ? 'article_edit' : 'batch_analysis');
        const requestedMode = input.sessionMode ?? 'agent';
        const sessionReusePolicy = input.sessionReusePolicy ?? 'reuse';
        if (input.workspaceId && sessionType !== 'assistant_chat') {
            await this.pruneIdleNonChatSessions(input.workspaceId, {
                keepSessionId: input.sessionId,
                activeBatchId: 'batchId' in input ? input.batchId : undefined
            });
        }
        const existing = sessionReusePolicy === 'new_local_session'
            ? null
            : input.sessionId
                ? this.getSession(input.sessionId)
                : ('batchId' in input && sessionType === 'batch_analysis' ? this.findReusableBatchAnalysisSession(input) : null);
        let session = existing;
        if (!session) {
            if (!input.workspaceId) {
                throw new Error('workspaceId is required');
            }
            const directContext = 'directContext' in input ? input.directContext : undefined;
            const createRequest = {
                workspaceId: input.workspaceId,
                kbAccessMode: input.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
                type: sessionType,
                mode: requestedMode,
                role: input.agentRole,
                batchId: 'batchId' in input ? input.batchId : undefined,
                locale: input.locale,
                templatePackId: 'templatePackId' in input ? input.templatePackId : undefined,
                scope: 'localeVariantScope' in input && input.localeVariantScope
                    ? { localeVariantIds: input.localeVariantScope }
                    : directContext?.localeVariantIds?.length || directContext?.familyIds?.length
                        ? {
                            ...(directContext.localeVariantIds?.length ? { localeVariantIds: directContext.localeVariantIds } : {}),
                            ...(directContext.familyIds?.length ? { familyIds: directContext.familyIds } : {})
                        }
                        : undefined,
                directContext
            };
            session = this.createSession(createRequest);
        }
        else {
            let needsReset = sessionReusePolicy === 'reset_acp';
            const previousKbAccessMode = session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE;
            const previousSessionMode = session.mode;
            const directContext = 'directContext' in input ? input.directContext : undefined;
            if (input.kbAccessMode && input.kbAccessMode !== session.kbAccessMode) {
                session.kbAccessMode = input.kbAccessMode;
            }
            if (requestedMode !== session.mode) {
                session.mode = requestedMode;
            }
            const nextKbAccessMode = session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE;
            const previousProviderSessionMode = resolveProviderSessionMode(previousKbAccessMode, previousSessionMode);
            const nextProviderSessionMode = resolveProviderSessionMode(nextKbAccessMode, session.mode);
            if (previousKbAccessMode !== nextKbAccessMode || previousProviderSessionMode !== nextProviderSessionMode) {
                needsReset = true;
            }
            session.role = input.agentRole;
            if ('batchId' in input) {
                session.batchId = input.batchId;
            }
            if (input.locale) {
                session.locale = input.locale;
            }
            if ('templatePackId' in input && input.templatePackId) {
                session.templatePackId = input.templatePackId;
            }
            if ('localeVariantScope' in input && input.localeVariantScope?.length) {
                session.scope = { ...(session.scope ?? {}), localeVariantIds: input.localeVariantScope };
            }
            if (directContext) {
                session.directContext = directContext;
                if (directContext.localeVariantIds?.length || directContext.familyIds?.length) {
                    session.scope = {
                        ...(session.scope ?? {}),
                        ...(directContext.localeVariantIds?.length ? { localeVariantIds: directContext.localeVariantIds } : {}),
                        ...(directContext.familyIds?.length ? { familyIds: directContext.familyIds } : {})
                    };
                }
            }
            if (needsReset) {
                await this.resetCursorSession(session.id);
            }
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
        const providerSessionMode = resolveProviderSessionMode(mode, session.mode);
        const requestEnvelope = {
            session,
            task: taskPayload
        };
        this.activeStreamEmitters.set(session.id, emit);
        this.promptMessageChunks.set(session.id, createPromptMessageBuffer());
        this.markPromptTransportActivity(session.id);
        try {
            // Log runtime mode in transcript so CLI-mode runs are identifiable in history
            await this.trackSessionOperation(session.id, this.appendTranscriptLine(session.id, 'system', 'runtime_mode', JSON.stringify({
                kbAccessMode: mode,
                provider: provider.provider,
                requestedSessionMode: session.mode,
                providerSessionMode,
                terminalEnabled: provider.terminalEnabled,
                agentModelId: this.getWorkspaceAgentModel(session.workspaceId) ?? 'default'
            })));
            await this.trackSessionOperation(session.id, Promise.resolve(emit({ kind: 'session_started', data: { ...requestEnvelope, kbAccessMode: mode }, message: 'Session started' })));
            const promptText = await this.buildPromptText(session, taskPayload);
            const context = {
                workspaceId: session.workspaceId,
                allowedLocaleVariantIds: session.scope?.localeVariantIds,
                allowedFamilyIds: session.scope?.familyIds
            };
            const transcriptPath = this.transcripts.get(session.id) ?? '';
            const { transport, acpSessionId } = await this.executeWithRetry(async () => {
                const transport = this.getTransport(provider.mode, session.workspaceId);
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
                return { transport, acpSessionId };
            }, 3, isCancelled);
            const requestPayload = {
                sessionId: acpSessionId,
                prompt: [
                    {
                        type: 'text',
                        text: promptText
                    }
                ]
            };
            this.pendingPromptFallbacks.set(session.id, { transport, acpSessionId });
            this.activePromptStates.set(session.id, {
                task: String(taskPayload.task ?? ''),
                role: session.role,
                workspaceId: session.workspaceId,
                transport,
                acpSessionId,
                contract: this.getPromptStructuredResultContract(session, taskPayload),
                activeToolCalls: new Set(),
                toolCallCount: 0,
                chunkCount: 0,
                remotelyStopped: false
            });
            this.startPromptCompletionWatcher(session.id);
            this.log('agent.runtime.prompt_send', {
                workspaceId: session.workspaceId,
                sessionId: session.id,
                acpSessionId,
                task: taskPayload.task,
                kbAccessMode: provider.mode,
                agentModelId: this.getWorkspaceAgentModel(session.workspaceId) ?? 'default',
                promptLength: promptText.length
            });
            let currentAcpSessionId = acpSessionId;
            let retryCount = 0;
            let sameSessionRetryCount = 0;
            let response = await transport.request('session/prompt', requestPayload, timeoutMs, session.id);
            while (response.error && retryCount < 2 && isRetriablePromptError(response.error)) {
                const missingSession = isMissingAcpSessionError(response.error);
                if (missingSession && sameSessionRetryCount < ACP_SESSION_NOT_FOUND_RETRY_LIMIT) {
                    sameSessionRetryCount += 1;
                    const ready = await this.waitForAcpSessionReady(currentAcpSessionId, Math.min(ACP_SESSION_READY_WAIT_MS, Math.max(250, Math.floor(timeoutMs / 4))));
                    const retryDelayMs = ready
                        ? Math.min(200 * sameSessionRetryCount, 750)
                        : Math.min(300 * sameSessionRetryCount, ACP_SESSION_READY_WAIT_MS);
                    if (retryDelayMs > 0) {
                        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
                    }
                    this.log('agent.runtime.prompt_send_same_session_retry', {
                        workspaceId: session.workspaceId,
                        sessionId: session.id,
                        acpSessionId: currentAcpSessionId,
                        task: taskPayload.task,
                        kbAccessMode: provider.mode,
                        agentModelId: this.getWorkspaceAgentModel(session.workspaceId) ?? 'default',
                        promptLength: promptText.length,
                        retryCount: sameSessionRetryCount,
                        reason: response.error.message,
                        becameReady: ready,
                        retryDelayMs
                    });
                    this.pendingPromptFallbacks.set(session.id, { transport, acpSessionId: currentAcpSessionId });
                    this.startPromptCompletionWatcher(session.id);
                    response = await transport.request('session/prompt', requestPayload, timeoutMs, session.id);
                    continue;
                }
                retryCount += 1;
                this.log('agent.runtime.prompt_send_retry', {
                    workspaceId: session.workspaceId,
                    sessionId: session.id,
                    acpSessionId: currentAcpSessionId,
                    task: taskPayload.task,
                    kbAccessMode: provider.mode,
                    agentModelId: this.getWorkspaceAgentModel(session.workspaceId) ?? 'default',
                    promptLength: promptText.length,
                    retryCount,
                    reason: response.error.message
                });
                await this.resetCursorSession(session.id);
                currentAcpSessionId = await this.ensureAcpSession(session);
                requestPayload.sessionId = currentAcpSessionId;
                this.pendingPromptFallbacks.set(session.id, { transport, acpSessionId: currentAcpSessionId });
                this.startPromptCompletionWatcher(session.id);
                response = await transport.request('session/prompt', requestPayload, timeoutMs, session.id);
            }
            this.log('agent.runtime.prompt_response', {
                workspaceId: session.workspaceId,
                sessionId: session.id,
                hasError: Boolean(response.error)
            });
            if (response.error) {
                throw new Error(response.error.message);
            }
            this.markAcpSessionReady(currentAcpSessionId);
            const result = response.result && typeof response.result === 'object'
                ? { ...response.result }
                : {};
            await this.trackSessionOperation(session.id, Promise.resolve(emit({ kind: 'result', data: response, message: 'Run complete' })));
            return result;
        }
        finally {
            this.clearPromptCompletionTimer(session.id);
            this.pendingPromptFallbacks.delete(session.id);
        }
    }
    async buildPromptText(session, taskPayload) {
        const provider = this.getProvider(session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE);
        if (taskPayload.task !== 'analyze_batch') {
            return provider.getPromptTaskBuilder(session, taskPayload);
        }
        return provider.getPromptTaskBuilder(session, taskPayload);
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
                if (error instanceof NonRetriableRuntimeError) {
                    this.log('agent.runtime.retry_abort_non_retriable', {
                        attempt: attempt + 1,
                        maxAttempts,
                        error: error.message
                    });
                    throw error;
                }
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
        this.markPromptTransportActivity(localSessionId);
        this.markAcpSessionReady(params.sessionId);
        await this.queueSessionOperation(localSessionId, async () => {
            const promptState = this.activePromptStates.get(localSessionId);
            const updateRecord = params.update && typeof params.update === 'object'
                ? params.update
                : undefined;
            if (updateRecord?.sessionUpdate === 'agent_message_chunk') {
                const text = extractAgentMessageChunkText(updateRecord.content);
                if (text) {
                    const chunks = appendPromptMessageChunk(this.promptMessageChunks.get(localSessionId), text);
                    this.promptMessageChunks.set(localSessionId, chunks);
                    if (promptState?.contract) {
                        promptState.chunkCount += 1;
                        this.maybeResolveStructuredPromptFromStream(localSessionId);
                    }
                    this.schedulePromptCompletionFallback(localSessionId, params.sessionId);
                }
            }
            if (promptState && typeof params.update?.toolCallId === 'string') {
                const toolCallId = params.update.toolCallId;
                const normalizedStatus = typeof params.update.status === 'string' ? params.update.status.toLowerCase() : '';
                if (params.update.sessionUpdate === 'tool_call') {
                    promptState.activeToolCalls.add(toolCallId);
                    promptState.toolCallCount += 1;
                }
                else if (params.update.sessionUpdate === 'tool_call_update'
                    && (normalizedStatus === 'completed' || normalizedStatus === 'failed' || normalizedStatus === 'cancelled')) {
                    promptState.activeToolCalls.delete(toolCallId);
                }
                if (promptState.contract === 'batch_planner'
                    && promptState.toolCallCount > BATCH_PLANNER_MAX_TOOL_CALLS) {
                    void this.stopActivePrompt(localSessionId, promptState.acpSessionId, promptState.transport, `Planner exceeded the tool-call budget (${promptState.toolCallCount} > ${BATCH_PLANNER_MAX_TOOL_CALLS}). Reuse the evidence already gathered and recover the plan from the current transcript.`);
                }
            }
            this.markSessionActivity(localSessionId);
            const payload = JSON.stringify(message.params);
            if (!isHiddenAgentThoughtUpdate(message.params)) {
                await this.appendTranscriptLine(localSessionId, 'from_agent', 'session_update', payload);
            }
            const assistantAuditLabel = selectAssistantToolPolicyLabel(params.update);
            if (params.update?.toolCallId && assistantAuditLabel) {
                const session = this.sessions.get(localSessionId);
                const acpToolCallKey = `${params.sessionId ?? 'unknown'}:${params.update.toolCallId}`;
                const recordedToolCallIds = this.auditedAssistantToolCallIds.get(localSessionId) ?? new Set();
                const shouldDeferPolicyCheck = sessionInfo.mode === 'cli'
                    ? shouldDeferCliToolPolicyCheck(params.update)
                    : shouldDeferMcpToolPolicyCheck(params.update);
                if (session && !shouldDeferPolicyCheck && !recordedToolCallIds.has(acpToolCallKey)) {
                    recordedToolCallIds.add(acpToolCallKey);
                    this.auditedAssistantToolCallIds.set(localSessionId, recordedToolCallIds);
                    const policy = sessionInfo.mode === 'cli'
                        ? this.evaluateCliToolPolicy(assistantAuditLabel, params.update.kind, params.update.rawInput, params.update.rawOutput)
                        : sessionInfo.mode === 'direct'
                            ? this.evaluateDirectToolPolicy(assistantAuditLabel, params.update.kind, params.update.rawInput, params.update.rawOutput)
                            : this.evaluateMcpToolPolicy(assistantAuditLabel, params.update.kind, params.update.rawInput, params.update.rawOutput);
                    this.toolCallAudit.push({
                        workspaceId: session.workspaceId,
                        sessionId: localSessionId,
                        toolName: policy.auditedToolName,
                        args: selectCliToolAuditArgs(params.update.rawInput, params.update.rawOutput, params.update.kind),
                        calledAtUtc: new Date().toISOString(),
                        allowed: policy.allowed,
                        reason: policy.reason
                    });
                    if (!policy.allowed && typeof params.sessionId === 'string') {
                        const modeLabel = sessionInfo.mode === 'cli'
                            ? 'CLI mode'
                            : sessionInfo.mode === 'direct'
                                ? 'Direct mode'
                                : 'MCP mode';
                        const violationReason = `${modeLabel} blocked illegal tool call "${policy.auditedToolName}": ${policy.reason}`;
                        this.log(`agent.runtime.${sessionInfo.mode}_tool_policy_violation`, {
                            sessionId: localSessionId,
                            acpSessionId: params.sessionId,
                            toolName: policy.auditedToolName,
                            kind: params.update.kind,
                            reason: violationReason
                        });
                        await this.appendTranscriptLine(localSessionId, 'system', `${sessionInfo.mode}_tool_policy_violation`, JSON.stringify({
                            toolName: policy.auditedToolName,
                            kind: params.update.kind,
                            reason: violationReason
                        }));
                        this.getTransport(sessionInfo.mode, session.workspaceId).abortPromptSession(params.sessionId, violationReason);
                    }
                }
            }
            await this.maybeAbortCliPlannerLoop(localSessionId, params.sessionId, updateRecord);
            const emit = this.activeStreamEmitters.get(localSessionId);
            if (!emit) {
                return;
            }
            await Promise.resolve(emit({
                kind: 'progress',
                data: message.params,
                message: params.update?.sessionUpdate ? `session/update:${params.update.sessionUpdate}` : 'session/update'
            }));
        });
    }
    consumePromptMessageText(sessionId) {
        const chunks = this.promptMessageChunks.get(sessionId);
        this.promptMessageChunks.delete(sessionId);
        return assemblePromptMessageText(chunks);
    }
    finalizePromptResult(sessionId, result) {
        const finalized = result && typeof result === 'object'
            ? { ...result }
            : {};
        const assembledText = this.consumePromptMessageText(sessionId).trim();
        const explicitText = extractPromptResultText(finalized)?.trim();
        const canonicalText = selectCanonicalPromptResultText([
            explicitText ?? '',
            assembledText,
            explicitText ? extractLargestBalancedJsonText(explicitText) ?? '' : '',
            assembledText ? extractLargestBalancedJsonText(assembledText) ?? '' : ''
        ]);
        if (assembledText) {
            finalized.streamedText = assembledText;
        }
        if (canonicalText) {
            finalized.finalText = canonicalText;
            if (!explicitText
                || looksLikeBatchProgressText(explicitText)
                || (!looksLikeJsonObjectText(explicitText) && looksLikeJsonObjectText(canonicalText))
                || canonicalText.length > explicitText.length) {
                finalized.text = canonicalText;
                finalized.content = [{ type: 'text', text: canonicalText }];
            }
        }
        return finalized;
    }
    cleanupPromptState(sessionId) {
        this.clearPromptCompletionTimer(sessionId);
        this.pendingPromptFallbacks.delete(sessionId);
        this.activeStreamEmitters.delete(sessionId);
        this.promptMessageChunks.delete(sessionId);
        this.promptTransportActivityAt.delete(sessionId);
        this.auditedAssistantToolCallIds.delete(sessionId);
        this.activePromptStates.delete(sessionId);
        this.cliPlannerLoopState.delete(sessionId);
    }
    clearPromptCompletionTimer(sessionId) {
        const timer = this.promptCompletionTimers.get(sessionId);
        if (timer) {
            clearTimeout(timer);
            this.promptCompletionTimers.delete(sessionId);
        }
    }
    startPromptCompletionWatcher(localSessionId) {
        this.clearPromptCompletionTimer(localSessionId);
        const timer = setInterval(() => {
            const pending = this.pendingPromptFallbacks.get(localSessionId);
            if (!pending) {
                this.clearPromptCompletionTimer(localSessionId);
                return;
            }
            const normalizedAssembledText = assemblePromptMessageText(this.promptMessageChunks.get(localSessionId)).trim();
            if (!normalizedAssembledText) {
                return;
            }
            const promptState = this.activePromptStates.get(localSessionId);
            if (promptState?.contract) {
                this.maybeResolveStructuredPromptFromStream(localSessionId);
                return;
            }
            const lastActivityAt = this.promptTransportActivityAt.get(localSessionId)
                ?? this.sessionActivityAt.get(localSessionId)
                ?? Date.now();
            if (Date.now() - lastActivityAt < 900) {
                return;
            }
            const resolved = pending.transport.resolvePromptSession(pending.acpSessionId, {
                text: normalizedAssembledText,
                content: [{ type: 'text', text: normalizedAssembledText }]
            });
            if (resolved) {
                this.log('agent.runtime.prompt_stream_fallback_resolved', {
                    sessionId: localSessionId,
                    acpSessionId: pending.acpSessionId
                });
                this.clearPromptCompletionTimer(localSessionId);
            }
        }, 200);
        this.promptCompletionTimers.set(localSessionId, timer);
    }
    schedulePromptCompletionFallback(localSessionId, acpSessionId) {
        const pending = this.pendingPromptFallbacks.get(localSessionId);
        if (!pending) {
            return;
        }
        if (acpSessionId && pending.acpSessionId !== acpSessionId) {
            return;
        }
        if (!this.promptCompletionTimers.has(localSessionId)) {
            this.startPromptCompletionWatcher(localSessionId);
        }
    }
    async ensureTranscriptPath(sessionId, runId) {
        const transcriptDir = node_path_1.default.resolve(this.config.workspaceRoot, DEFAULT_TRANSCRIPT_DIR, sessionId);
        await (0, promises_1.mkdir)(transcriptDir, { recursive: true });
        const filePath = node_path_1.default.join(transcriptDir, `${runId}.jsonl`);
        this.transcripts.set(sessionId, filePath);
        this.transcriptLineSequences.set(sessionId, 0);
        await (0, promises_1.appendFile)(filePath, `${JSON.stringify({ atUtc: new Date().toISOString(), seq: 0, direction: 'system', event: 'transcript_start', payload: runId })}\n`, 'utf8');
        this.markSessionActivity(sessionId);
        return filePath;
    }
    resolveBinary(mode) {
        const cursorBinary = node_process_1.default.env[KBV_CURSOR_BINARY_ENV]?.trim() || resolveDefaultCursorBinary();
        return cursorBinary || (mode === 'cli' ? this.config.cliBinary : this.config.mcpBinary);
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
    async canReachCursor(mode, workspaceId) {
        if (mode === 'cli') {
            await this.runtimeOptions.prepareCliEnvironment?.(workspaceId);
        }
        if (workspaceId) {
            await this.ensureWorkspaceAgentModelLoaded(workspaceId);
        }
        let lastError;
        const transportKey = this.buildTransportKey(mode, workspaceId);
        for (let attempt = 1; attempt <= ACP_HEALTH_INIT_ATTEMPTS; attempt += 1) {
            const transport = this.getTransport(mode, workspaceId);
            try {
                const response = await transport.ensureInitialized(ACP_HEALTH_INIT_TIMEOUT_MS);
                if (response) {
                    return true;
                }
                lastError = new Error('Cursor ACP initialize returned false');
            }
            catch (error) {
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
                this.transports.delete(transportKey);
            }
        }
        return false;
    }
    getTransport(mode, workspaceId) {
        const transportKey = this.buildTransportKey(mode, workspaceId);
        const existing = this.transports.get(transportKey);
        if (existing) {
            return existing;
        }
        const provider = this.getProvider(mode);
        const transportBinary = this.resolveBinary(mode);
        const transport = new CursorTransport(transportBinary, buildCursorAcpArgs(transportBinary, this.getWorkspaceAgentModel(workspaceId)), this.config.acpCwd, provider.terminalEnabled, (sessionId, line) => {
            const targetSessionId = sessionId?.trim() || 'system';
            void this.appendTranscriptLine(targetSessionId, line.direction, line.event, line.payload);
        }, (message) => {
            void this.handleTransportNotification(message);
        });
        this.transports.set(transportKey, transport);
        return transport;
    }
    evaluateCliToolPolicy(toolName, kind, rawInput, rawOutput) {
        const normalizedToolName = toolName.trim().toLowerCase();
        const normalizedKind = kind?.trim().toLowerCase() ?? 'unknown';
        const command = extractCliToolCommand(rawInput) ?? extractCliToolCommandFromRawOutput(rawOutput);
        const commandLikeKbInvocation = looksLikeKbCliShellInvocation(toolName) || looksLikeKbCliShellInvocation(command);
        const kbCommandName = extractKbCliCommandName(toolName) ?? extractKbCliCommandName(command);
        const normalizedPolicyName = normalizeAssistantToolPolicyName(toolName) ?? normalizeAssistantToolPolicyName(kind);
        const auditedToolName = kbCommandName ?? toolName;
        if (commandLikeKbInvocation) {
            return {
                auditedToolName,
                allowed: true,
                reason: kbCommandName
                    ? `CLI mode allows shell transport for kb command "${kbCommandName}"`
                    : 'CLI mode allows shell transport for kb commands'
            };
        }
        if (normalizedToolName === 'terminal'
            || normalizedToolName === 'shell'
            || normalizedKind === 'terminal'
            || normalizedKind === 'shell') {
            return {
                auditedToolName,
                allowed: false,
                reason: 'CLI mode forbids terminal usage outside of running kb commands'
            };
        }
        if (normalizedToolName === 'read file') {
            return {
                auditedToolName,
                allowed: false,
                reason: 'CLI mode forbids Read File; use kb CLI output instead'
            };
        }
        if (normalizedToolName === 'grep') {
            return {
                auditedToolName,
                allowed: false,
                reason: 'CLI mode forbids grep; use kb CLI output instead'
            };
        }
        if ((normalizedPolicyName && BLOCKED_MCP_RESOURCE_TOOL_NAMES.has(normalizedPolicyName))
            || BLOCKED_MCP_RESOURCE_TOOL_NAMES.has(normalizedKind)) {
            return {
                auditedToolName,
                allowed: false,
                reason: 'CLI mode forbids MCP resource discovery; use exact kb CLI commands instead'
            };
        }
        if ((normalizedPolicyName && BLOCKED_GENERIC_TOOL_NAMES.has(normalizedPolicyName))
            || BLOCKED_GENERIC_TOOL_NAMES.has(normalizedKind)) {
            return {
                auditedToolName,
                allowed: false,
                reason: 'CLI mode forbids generic ACP tools; use exact kb CLI commands instead'
            };
        }
        if ((normalizedPolicyName && ALLOWED_MCP_TOOL_NAMES.has(normalizedPolicyName))
            || ALLOWED_MCP_TOOL_NAMES.has(normalizedKind)) {
            return {
                auditedToolName,
                allowed: false,
                reason: 'CLI mode forbids direct KB Vault MCP tools; run exact kb CLI commands instead'
            };
        }
        if (kbCommandName) {
            return {
                auditedToolName,
                allowed: false,
                reason: 'CLI mode requires exact kb CLI commands instead of direct tool shortcuts'
            };
        }
        return {
            auditedToolName,
            allowed: false,
            reason: 'CLI mode only allows exact kb CLI commands'
        };
    }
    evaluateMcpToolPolicy(toolName, kind, rawInput, rawOutput) {
        const normalizedToolName = normalizeAssistantToolPolicyName(toolName);
        const normalizedKind = normalizeAssistantToolPolicyName(kind) ?? 'unknown';
        const command = extractCliToolCommand(rawInput) ?? extractCliToolCommandFromRawOutput(rawOutput);
        const commandLikeKbInvocation = looksLikeKbCliShellInvocation(toolName) || looksLikeKbCliShellInvocation(command);
        const kbCommandName = extractKbCliCommandName(toolName) ?? extractKbCliCommandName(command);
        const allowedToolName = (normalizedToolName && ALLOWED_MCP_TOOL_NAMES.has(normalizedToolName) ? normalizedToolName : undefined)
            ?? (ALLOWED_MCP_TOOL_NAMES.has(normalizedKind) ? normalizedKind : undefined);
        const auditedToolName = allowedToolName ?? (kbCommandName ? `kb ${kbCommandName}` : toolName);
        if (allowedToolName) {
            return {
                auditedToolName,
                allowed: true,
                reason: `MCP mode allows KB Vault MCP tool "${allowedToolName}"`
            };
        }
        if (commandLikeKbInvocation || kbCommandName) {
            return {
                auditedToolName,
                allowed: false,
                reason: 'MCP mode forbids kb CLI commands; use direct KB Vault MCP tools only'
            };
        }
        if (isCliTerminalToolName(normalizedToolName)
            || isCliTerminalToolName(normalizedKind)
            || normalizedKind === 'execute') {
            return {
                auditedToolName,
                allowed: false,
                reason: 'MCP mode forbids terminal and shell tools; use direct KB Vault MCP tools only'
            };
        }
        if ((normalizedToolName && BLOCKED_MCP_RESOURCE_TOOL_NAMES.has(normalizedToolName))
            || BLOCKED_MCP_RESOURCE_TOOL_NAMES.has(normalizedKind)) {
            return {
                auditedToolName,
                allowed: false,
                reason: 'MCP mode forbids MCP resource discovery; call KB Vault MCP tools directly'
            };
        }
        if ((normalizedToolName && BLOCKED_GENERIC_TOOL_NAMES.has(normalizedToolName))
            || BLOCKED_GENERIC_TOOL_NAMES.has(normalizedKind)) {
            return {
                auditedToolName,
                allowed: false,
                reason: 'MCP mode forbids generic ACP tools; use direct KB Vault MCP tools only'
            };
        }
        return {
            auditedToolName,
            allowed: false,
            reason: 'MCP mode only allows direct KB Vault MCP tools'
        };
    }
    evaluateDirectToolPolicy(toolName, kind, rawInput, rawOutput) {
        const normalizedToolName = normalizeAssistantToolPolicyName(toolName);
        const normalizedKind = normalizeAssistantToolPolicyName(kind) ?? 'unknown';
        const command = extractCliToolCommand(rawInput) ?? extractCliToolCommandFromRawOutput(rawOutput);
        const kbCommandName = extractKbCliCommandName(toolName) ?? extractKbCliCommandName(command);
        const allowedToolName = (normalizedToolName && ALLOWED_MCP_TOOL_NAMES.has(normalizedToolName) ? normalizedToolName : undefined)
            ?? (ALLOWED_MCP_TOOL_NAMES.has(normalizedKind) ? normalizedKind : undefined);
        const auditedToolName = allowedToolName ?? (kbCommandName ? `kb ${kbCommandName}` : toolName);
        if (allowedToolName) {
            return {
                auditedToolName,
                allowed: false,
                reason: 'Direct mode forbids ACP tool usage; return a needs_action envelope instead of calling KB tools'
            };
        }
        if (kbCommandName || looksLikeKbCliShellInvocation(toolName) || looksLikeKbCliShellInvocation(command)) {
            return {
                auditedToolName,
                allowed: false,
                reason: 'Direct mode forbids kb CLI commands; return a needs_action envelope instead'
            };
        }
        if (isCliTerminalToolName(normalizedToolName)
            || isCliTerminalToolName(normalizedKind)
            || normalizedKind === 'execute') {
            return {
                auditedToolName,
                allowed: false,
                reason: 'Direct mode forbids terminal and shell tools'
            };
        }
        if ((normalizedToolName && BLOCKED_MCP_RESOURCE_TOOL_NAMES.has(normalizedToolName))
            || BLOCKED_MCP_RESOURCE_TOOL_NAMES.has(normalizedKind)) {
            return {
                auditedToolName,
                allowed: false,
                reason: 'Direct mode forbids MCP resource discovery'
            };
        }
        if ((normalizedToolName && BLOCKED_GENERIC_TOOL_NAMES.has(normalizedToolName))
            || BLOCKED_GENERIC_TOOL_NAMES.has(normalizedKind)) {
            return {
                auditedToolName,
                allowed: false,
                reason: 'Direct mode forbids generic ACP tools'
            };
        }
        return {
            auditedToolName,
            allowed: false,
            reason: 'Direct mode does not allow ACP tool calls; use needs_action envelopes only'
        };
    }
    parseCliLoopbackToolResult(updateRecord) {
        if (updateRecord.sessionUpdate !== 'tool_call_update' || updateRecord.status !== 'completed') {
            return null;
        }
        const rawOutput = updateRecord.rawOutput;
        if (!rawOutput || typeof rawOutput !== 'object') {
            return null;
        }
        const stdout = typeof rawOutput.stdout === 'string'
            ? (rawOutput.stdout).trim()
            : '';
        if (!stdout) {
            return null;
        }
        try {
            const parsed = JSON.parse(stdout);
            const command = typeof parsed.command === 'string' ? parsed.command : '';
            if (!command) {
                return null;
            }
            const total = typeof parsed.data?.total === 'number'
                ? parsed.data.total
                : Array.isArray(parsed.data?.results)
                    ? parsed.data.results.length
                    : undefined;
            return { command, total };
        }
        catch {
            return null;
        }
    }
    async maybeAbortCliPlannerLoop(localSessionId, acpSessionId, updateRecord) {
        if (!acpSessionId || !updateRecord) {
            return;
        }
        const session = this.sessions.get(localSessionId);
        if (!session || session.kbAccessMode !== 'cli' || session.role !== 'planner' || session.mode !== 'plan') {
            return;
        }
        const parsed = this.parseCliLoopbackToolResult(updateRecord);
        if (!parsed || parsed.command !== 'search-kb') {
            return;
        }
        const state = this.cliPlannerLoopState.get(localSessionId) ?? {
            searchKbCalls: 0,
            consecutiveZeroResultSearches: 0,
            zeroResultQueries: new Set(),
            duplicateZeroResultQueries: 0,
            aborted: false
        };
        state.searchKbCalls += 1;
        const query = normalizePlannerSearchQuery(extractSearchKbQueryFromCliCommand(extractCliToolCommand(updateRecord.rawInput)));
        if ((parsed.total ?? 0) === 0) {
            state.consecutiveZeroResultSearches += 1;
            if (query) {
                if (state.zeroResultQueries.has(query)) {
                    state.duplicateZeroResultQueries += 1;
                }
                else {
                    state.zeroResultQueries.add(query);
                }
            }
        }
        else {
            state.consecutiveZeroResultSearches = 0;
        }
        this.cliPlannerLoopState.set(localSessionId, state);
        if (state.aborted) {
            return;
        }
        if (query && state.duplicateZeroResultQueries > 0) {
            state.aborted = true;
            const reason = `Planner duplicate zero-result search suppressed for query "${query}" after ${state.searchKbCalls} search-kb calls`;
            this.log('agent.runtime.cli_planner_duplicate_zero_result_search', {
                sessionId: localSessionId,
                acpSessionId,
                query,
                searchKbCalls: state.searchKbCalls,
                duplicateZeroResultQueries: state.duplicateZeroResultQueries
            });
            await this.trackSessionOperation(localSessionId, this.appendTranscriptLine(localSessionId, 'system', 'planner_duplicate_zero_result_search', JSON.stringify({
                reason,
                query,
                searchKbCalls: state.searchKbCalls,
                duplicateZeroResultQueries: state.duplicateZeroResultQueries
            })));
            this.getTransport('cli', session.workspaceId).abortPromptSession(acpSessionId, `${reason}. Reuse deterministic prefetch or the earlier zero-result evidence and return the current plan as JSON.`);
            return;
        }
        if (state.consecutiveZeroResultSearches < CLI_PLANNER_ZERO_RESULT_SEARCH_LIMIT) {
            return;
        }
        const distinctZeroResultQueries = state.zeroResultQueries.size;
        const lowDiversityZeroResultLoop = distinctZeroResultQueries === 0
            || distinctZeroResultQueries <= CLI_PLANNER_LOW_DIVERSITY_ZERO_RESULT_QUERY_LIMIT;
        if (!lowDiversityZeroResultLoop) {
            return;
        }
        state.aborted = true;
        const reason = `Planner loop breaker triggered after ${state.searchKbCalls} search-kb calls and ${state.consecutiveZeroResultSearches} consecutive zero-result searches`;
        this.log('agent.runtime.cli_planner_loop_breaker', {
            sessionId: localSessionId,
            acpSessionId,
            searchKbCalls: state.searchKbCalls,
            consecutiveZeroResultSearches: state.consecutiveZeroResultSearches,
            duplicateZeroResultQueries: state.duplicateZeroResultQueries
        });
        await this.trackSessionOperation(localSessionId, this.appendTranscriptLine(localSessionId, 'system', 'planner_loop_breaker', JSON.stringify({
            reason,
            searchKbCalls: state.searchKbCalls,
            consecutiveZeroResultSearches: state.consecutiveZeroResultSearches,
            duplicateZeroResultQueries: state.duplicateZeroResultQueries,
            distinctZeroResultQueries
        })));
        this.getTransport('cli', session.workspaceId).abortPromptSession(acpSessionId, `${reason}. Reuse deterministic prefetch or the earlier zero-result evidence and return the current plan as JSON.`);
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
        if (mode === 'direct') {
            return {
                mode: 'direct',
                provider: 'direct',
                terminalEnabled: false,
                buildSessionCreateParams: (sessionMode) => ({
                    cwd: this.config.acpCwd,
                    mcpServers: [],
                    config: { mode: resolveProviderSessionMode('direct', sessionMode) }
                }),
                getPromptTaskBuilder: (session, taskPayload, extras) => buildDirectTaskPrompt(session, taskPayload, extras),
                getHealth: (workspaceId) => this.getDirectHealth(workspaceId)
            };
        }
        if (mode === 'cli') {
            return {
                mode: 'cli',
                provider: 'cli',
                terminalEnabled: false,
                buildSessionCreateParams: (sessionMode) => ({
                    cwd: this.config.acpCwd,
                    mcpServers: [],
                    config: { mode: resolveProviderSessionMode('cli', sessionMode) }
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
            buildSessionCreateParams: (sessionMode) => {
                const mcpServers = this.resolveMcpServerConfigs();
                return {
                    cwd: this.config.acpCwd,
                    ...(mcpServers.length > 0 ? { mcpServers } : {}),
                    config: { mode: resolveProviderSessionMode('mcp', sessionMode) }
                };
            },
            getPromptTaskBuilder: (session, taskPayload, extras) => buildMcpTaskPrompt(session, taskPayload, extras),
            getHealth: (workspaceId) => this.getMcpHealth(workspaceId)
        };
    }
    async getProviderHealth(mode, workspaceId) {
        return this.getProvider(mode).getHealth(workspaceId);
    }
    async getDirectHealth(workspaceId) {
        const executorHealth = await this.runtimeOptions.getDirectHealth?.(workspaceId).catch((error) => ({
            mode: 'direct',
            provider: 'direct',
            ok: false,
            message: error instanceof Error ? error.message : String(error),
            issues: [error instanceof Error ? error.message : String(error)]
        })) ?? {
            mode: 'direct',
            provider: 'direct',
            ok: false,
            message: 'Direct executor path is unavailable',
            issues: ['Direct executor path is unavailable']
        };
        const issues = new Set(executorHealth.issues ?? []);
        const cursorInstalled = this.isCursorAvailable('direct');
        if (!cursorInstalled) {
            issues.add('Cursor binary not found');
        }
        const acpReachable = cursorInstalled ? await this.canReachCursor('direct', workspaceId) : false;
        if (cursorInstalled && !acpReachable) {
            issues.add('Cursor ACP command did not initialize');
        }
        const ok = Boolean(executorHealth.ok) && cursorInstalled && acpReachable;
        const result = {
            mode: 'direct',
            provider: 'direct',
            ok,
            acpReachable,
            binaryPath: cursorInstalled ? this.resolveBinary('direct') : undefined,
            message: ok
                ? executorHealth.message ?? 'Direct access ready'
                : executorHealth.message && !(executorHealth.issues ?? []).includes(executorHealth.message)
                    ? executorHealth.message
                    : Array.from(issues)[0] ?? 'Direct access unavailable',
            issues: Array.from(issues)
        };
        this.log('agent.runtime.direct_health_result', {
            workspaceId,
            ok: result.ok,
            acpReachable: result.acpReachable,
            binaryPath: result.binaryPath,
            message: result.message,
            issues: result.issues
        });
        return result;
    }
    async getMcpHealth(workspaceId) {
        const issues = new Set();
        const cursorInstalled = this.isCursorAvailable('mcp');
        if (!cursorInstalled) {
            issues.add('Cursor binary not found');
        }
        const acpReachable = cursorInstalled ? await this.canReachCursor('mcp', workspaceId) : false;
        if (cursorInstalled && !acpReachable) {
            issues.add('Cursor ACP command did not initialize');
        }
        const mcpServers = this.resolveMcpServerConfigs();
        const bridgeConfig = resolveMcpBridgeConfig(mcpServers);
        const bridgeConfigPresent = mcpServers.length > 0 && bridgeConfig.configured;
        if (mcpServers.length === 0) {
            issues.add('KB Vault MCP server configuration is unavailable');
        }
        else if (!bridgeConfig.configured) {
            issues.add('KB Vault MCP bridge configuration is incomplete');
        }
        const expectedToolNames = Array.from(ALLOWED_MCP_TOOL_NAMES).sort();
        const internalToolNames = this.mcpServer.listTools()
            .map((tool) => tool.name.trim())
            .filter(Boolean)
            .sort();
        const internalMissingToolNames = expectedToolNames.filter((toolName) => !internalToolNames.includes(toolName));
        if (internalMissingToolNames.length > 0) {
            issues.add(`KB Vault MCP tool server is missing expected tools: ${internalMissingToolNames.join(', ')}`);
        }
        let bridgeReachable = false;
        let bridgeToolNames = [];
        let bridgeProbeError;
        if (bridgeConfigPresent && bridgeConfig.socketPath) {
            const bridgeProbe = await probeMcpBridgeToolList(bridgeConfig.socketPath);
            bridgeReachable = bridgeProbe.reachable;
            bridgeToolNames = [...bridgeProbe.toolNames].sort();
            bridgeProbeError = bridgeProbe.error;
            if (!bridgeProbe.reachable) {
                issues.add(`KB Vault MCP bridge is not reachable: ${bridgeProbe.error ?? 'health probe failed'}`);
            }
        }
        const bridgeMissingToolNames = bridgeReachable
            ? expectedToolNames.filter((toolName) => !bridgeToolNames.includes(toolName))
            : [];
        if (bridgeMissingToolNames.length > 0) {
            issues.add(`KB Vault MCP bridge is missing expected tools: ${bridgeMissingToolNames.join(', ')}`);
        }
        let acpMcpAttached = false;
        let acpMcpTouchedMethods = [];
        let acpMcpProbeError;
        if (cursorInstalled && acpReachable && bridgeConfigPresent && bridgeConfig.command && bridgeConfig.scriptPath) {
            const acpProbe = await probeAcpMcpAttachment({
                binary: this.resolveBinary('mcp'),
                args: this.config.cursorArgs,
                cwd: this.config.acpCwd,
                bridgeCommand: bridgeConfig.command,
                bridgeScriptPath: bridgeConfig.scriptPath
            });
            acpMcpAttached = acpProbe.attached;
            acpMcpTouchedMethods = acpProbe.touchedMethods;
            acpMcpProbeError = acpProbe.error;
            if (!acpProbe.attached) {
                issues.add(`Cursor ACP session did not attach the configured MCP server: ${acpProbe.error ?? 'probe saw no MCP traffic'}`);
            }
        }
        const toolsetReady = bridgeReachable
            ? internalMissingToolNames.length === 0 && bridgeMissingToolNames.length === 0
            : false;
        const ok = cursorInstalled && acpReachable && bridgeConfigPresent && bridgeReachable && toolsetReady && acpMcpAttached;
        const result = {
            mode: 'mcp',
            provider: 'mcp',
            ok,
            acpReachable,
            bridgeConfigPresent,
            bridgeSocketPath: bridgeConfig.socketPath,
            bridgeReachable,
            toolsetReady,
            expectedToolNames,
            registeredToolNames: bridgeReachable ? bridgeToolNames : internalToolNames,
            missingToolNames: bridgeReachable ? bridgeMissingToolNames : internalMissingToolNames,
            binaryPath: cursorInstalled ? this.resolveBinary('mcp') : undefined,
            message: ok ? 'MCP access ready' : Array.from(issues)[0] ?? 'MCP access unavailable',
            issues: Array.from(issues)
        };
        this.log('agent.runtime.mcp_health_result', {
            ok: result.ok,
            acpReachable: result.acpReachable,
            bridgeConfigPresent: result.bridgeConfigPresent,
            bridgeSocketPath: result.bridgeSocketPath,
            bridgeReachable: result.bridgeReachable,
            bridgeProbeError,
            acpMcpAttached,
            acpMcpTouchedMethods,
            acpMcpProbeError,
            toolsetReady: result.toolsetReady,
            missingToolNames: result.missingToolNames,
            registeredToolCount: result.registeredToolNames?.length ?? 0,
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
            const acpReachable = await this.canReachCursor('cli', workspaceId);
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
                failureCode: ok ? undefined : (health.ok ? shared_types_2.CliHealthFailure.HEALTH_PROBE_REJECTED : health.failureCode)
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
    async resetCursorSession(sessionId) {
        const existing = this.cursorSessionIds.get(sessionId);
        if (!existing) {
            return;
        }
        this.clearPromptCompletionTimer(sessionId);
        this.pendingPromptFallbacks.delete(sessionId);
        this.cursorSessionIds.delete(sessionId);
        this.cursorSessionLookup.delete(existing.acpSessionId);
        this.clearAcpSessionState(existing.acpSessionId);
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }
        const transportKey = this.buildTransportKey(existing.mode, session.workspaceId);
        const transport = this.transports.get(transportKey);
        if (!transport) {
            return;
        }
        transport.abortPromptSession(existing.acpSessionId, 'Local KB Vault runtime reset this ACP session because it is no longer the active session.');
        try {
            await transport.request('session/close', { sessionId: existing.acpSessionId }, Math.min(this.config.requestTimeoutMs, 10_000), sessionId);
        }
        catch {
            // Best effort close for an ACP session that may already be gone.
        }
    }
    async appendTranscriptLine(sessionId, direction, event, payload) {
        const path = this.transcripts.get(sessionId);
        if (!path) {
            return;
        }
        this.markSessionActivity(sessionId);
        const nextSeq = (this.transcriptLineSequences.get(sessionId) ?? 0) + 1;
        this.transcriptLineSequences.set(sessionId, nextSeq);
        await (0, promises_1.appendFile)(path, `${JSON.stringify({
            atUtc: new Date().toISOString(),
            seq: nextSeq,
            direction,
            event,
            payload
        })}\n`, 'utf8');
        this.markSessionActivity(sessionId);
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
                    const result = await toolContext.searchKb(parsed);
                    await log({ direction: 'system', event: 'tool_result', payload: 'search_kb returned' });
                    return result;
                },
                inputSchema: shared_types_1.MCP_SEARCH_KB_INPUT_SCHEMA
            },
            get_article: {
                description: 'Load a locale variant or revision payload for one article.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.getArticle(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'get_article' });
                    return result;
                },
                inputSchema: shared_types_1.MCP_GET_ARTICLE_INPUT_SCHEMA
            },
            get_article_family: {
                description: 'Load article family metadata.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.getArticleFamily(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'get_article_family' });
                    return result;
                },
                inputSchema: shared_types_1.MCP_GET_ARTICLE_FAMILY_INPUT_SCHEMA
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
                inputSchema: shared_types_1.MCP_GET_LOCALE_VARIANT_INPUT_SCHEMA,
                requiresScope: true
            },
            app_get_form_schema: {
                description: 'Read a mutable app working-state form schema and current values.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.getAppFormSchema(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'app_get_form_schema' });
                    return result;
                },
                inputSchema: shared_types_1.MCP_APP_GET_FORM_SCHEMA_INPUT_SCHEMA
            },
            app_patch_form: {
                description: 'Apply a validated patch to a mutable app working-state form.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.patchAppForm(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'app_patch_form' });
                    return result;
                },
                inputSchema: shared_types_1.MCP_APP_PATCH_FORM_INPUT_SCHEMA
            },
            find_related_articles: {
                description: 'Load persisted article relationships for an article or a PBI batch.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.findRelatedArticles(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'find_related_articles' });
                    return result;
                },
                inputSchema: shared_types_1.MCP_FIND_RELATED_ARTICLES_INPUT_SCHEMA
            },
            list_categories: {
                description: 'Get local article categories for locale.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.listCategories(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'list_categories' });
                    return result;
                },
                inputSchema: shared_types_1.MCP_LIST_CATEGORIES_INPUT_SCHEMA
            },
            list_sections: {
                description: 'Get local article sections.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.listSections(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'list_sections' });
                    return result;
                },
                inputSchema: shared_types_1.MCP_LIST_SECTIONS_INPUT_SCHEMA
            },
            list_article_templates: {
                description: 'Read template packs in the workspace.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.listArticleTemplates(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'list_article_templates' });
                    return result;
                },
                inputSchema: shared_types_1.MCP_LIST_ARTICLE_TEMPLATES_INPUT_SCHEMA
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
                },
                inputSchema: shared_types_1.MCP_GET_TEMPLATE_INPUT_SCHEMA
            },
            get_batch_context: {
                description: 'Load batch metadata and scoped row summary.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.getBatchContext(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'get_batch_context' });
                    return result;
                },
                inputSchema: shared_types_1.MCP_GET_BATCH_CONTEXT_INPUT_SCHEMA
            },
            get_pbi: {
                description: 'Load one PBI record from batch context.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.getPBI(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'get_pbi' });
                    return result;
                },
                inputSchema: shared_types_1.MCP_GET_PBI_INPUT_SCHEMA
            },
            get_pbi_subset: {
                description: 'Load PBI subset by row numbers.',
                handler: async (input, context, log) => {
                    const payload = input;
                    payload.workspaceId = context.workspaceId;
                    const result = await toolContext.getPBISubset(payload);
                    await log({ direction: 'system', event: 'tool_result', payload: 'get_pbi_subset' });
                    return result;
                },
                inputSchema: shared_types_1.MCP_GET_PBI_SUBSET_INPUT_SCHEMA
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
                inputSchema: shared_types_1.MCP_GET_ARTICLE_HISTORY_INPUT_SCHEMA,
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
                inputSchema: shared_types_1.MCP_RECORD_AGENT_NOTES_INPUT_SCHEMA,
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
                inputSchema: shared_types_1.MCP_RECORD_AGENT_NOTES_INPUT_SCHEMA,
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
                inputSchema: shared_types_1.MCP_RECORD_AGENT_NOTES_INPUT_SCHEMA,
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
                },
                inputSchema: shared_types_1.MCP_RECORD_AGENT_NOTES_INPUT_SCHEMA
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
            }, definition.inputSchema);
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
function extractAgentMessageChunkText(value) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const content = value;
    return typeof content.text === 'string' && content.text.length > 0
        ? content.text
        : undefined;
}
function createPromptMessageBuffer() {
    return {
        rawChunks: [],
        mergedText: ''
    };
}
function findSharedPrefixLength(left, right) {
    const max = Math.min(left.length, right.length);
    let index = 0;
    while (index < max && left[index] === right[index]) {
        index += 1;
    }
    return index;
}
function findStreamingOverlap(left, right) {
    const maxOverlap = Math.min(left.length, right.length);
    for (let overlap = maxOverlap; overlap >= 12; overlap -= 1) {
        if (left.slice(-overlap) === right.slice(0, overlap)) {
            return overlap;
        }
    }
    return 0;
}
function mergeStreamingText(current, incoming) {
    if (!incoming && incoming !== '') {
        return current;
    }
    if (!current) {
        return incoming;
    }
    if (current === incoming || current.endsWith(incoming)) {
        return current;
    }
    if (incoming.endsWith(current) || incoming.startsWith(current)) {
        return incoming;
    }
    const sharedPrefix = findSharedPrefixLength(current, incoming);
    if (sharedPrefix >= 12
        && sharedPrefix >= Math.floor(Math.min(current.length, incoming.length) * 0.6)) {
        return incoming.length >= current.length ? incoming : current;
    }
    const overlap = findStreamingOverlap(current, incoming);
    if (overlap > 0) {
        return `${current}${incoming.slice(overlap)}`;
    }
    return `${current}${incoming}`;
}
function collapseRepeatedChunkText(value) {
    return value;
}
function appendPromptMessageChunk(buffer, text) {
    const next = buffer ?? createPromptMessageBuffer();
    if (!text && text !== '') {
        return next;
    }
    if (!text.trim() && !/[\r\n]/.test(text)) {
        return next;
    }
    next.rawChunks.push(text);
    next.mergedText = mergeStreamingText(next.mergedText, text);
    return next;
}
function scorePromptMessageCandidate(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        return Number.NEGATIVE_INFINITY;
    }
    let score = trimmed.length;
    if (looksLikeJsonObjectText(trimmed)) {
        score += 10_000;
    }
    return score;
}
function assemblePromptMessageText(buffer) {
    if (!buffer) {
        return '';
    }
    const rawText = collapseRepeatedChunkText(buffer.rawChunks.join(''));
    const mergedText = collapseRepeatedChunkText(buffer.mergedText);
    const candidates = Array.from(new Set([rawText, mergedText].map((value) => value.trim()).filter(Boolean)));
    if (candidates.length === 0) {
        return '';
    }
    return candidates.sort((left, right) => scorePromptMessageCandidate(right) - scorePromptMessageCandidate(left))[0] ?? '';
}
function streamedTextLikelyStartsJsonObject(value) {
    const trimmed = value.trimStart();
    return trimmed.startsWith('{');
}
function extractLargestBalancedJsonObject(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const candidates = [trimmed];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < trimmed.length; index += 1) {
        const char = trimmed[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            }
            else if (char === '\\') {
                escaped = true;
            }
            else if (char === '"') {
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
        if (char === '}' && depth > 0) {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                candidates.push(trimmed.slice(start, index + 1));
            }
        }
    }
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                continue;
            }
            const record = parsed;
            let score = candidate.length;
            if (typeof record.summary === 'string') {
                score += 200;
            }
            if (Array.isArray(record.coverage)) {
                score += 300;
            }
            if (Array.isArray(record.items)) {
                score += 300;
            }
            if (score > bestScore) {
                best = record;
                bestScore = score;
            }
        }
        catch {
            // ignore malformed candidates
        }
    }
    return best;
}
function extractLargestBalancedJsonText(value) {
    const parsed = extractLargestBalancedJsonObject(value);
    return parsed ? JSON.stringify(parsed) : undefined;
}
function parsedBatchStructuredResultMatchesContract(parsed, contract) {
    switch (contract) {
        case 'batch_planner':
            return typeof parsed.summary === 'string' && Array.isArray(parsed.coverage) && Array.isArray(parsed.items);
        case 'batch_plan_review':
            return typeof parsed.summary === 'string' && typeof parsed.verdict === 'string' && parsed.delta !== null && typeof parsed.delta === 'object';
        case 'batch_worker':
            return typeof parsed.summary === 'string' && (Array.isArray(parsed.discoveredWork) || Array.isArray(parsed.executedItems));
        case 'batch_final_review':
            return (typeof parsed.summary === 'string'
                && typeof parsed.verdict === 'string'
                && parsed.delta !== null
                && typeof parsed.delta === 'object'
                && 'allPbisMapped' in parsed);
        default:
            return false;
    }
}
function looksLikePromptStructuredResultContractText(value, contract) {
    const trimmed = value.trim();
    if (!trimmed) {
        return false;
    }
    if (promptStreamMatchesContract(trimmed, contract)) {
        return true;
    }
    switch (contract) {
        case 'batch_planner':
            return trimmed.includes('"coverage"') || trimmed.includes('"items"') || trimmed.includes('"questions"') || trimmed.includes('"openQuestions"');
        case 'batch_plan_review':
            return trimmed.includes('"verdict"') || trimmed.includes('"delta"') || trimmed.includes('"requestedChanges"');
        case 'batch_worker':
            return trimmed.includes('"discoveredWork"') || trimmed.includes('"executedItems"');
        case 'batch_final_review':
            return trimmed.includes('"verdict"') || trimmed.includes('"delta"') || trimmed.includes('"allPbisMapped"');
        default:
            return false;
    }
}
function summarizeBatchContinuationOutput(value, limit = 1_200) {
    const trimmed = value?.trim();
    if (!trimmed) {
        return undefined;
    }
    return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed;
}
function stripBatchAnalysisContinuation(prompt) {
    const normalized = prompt?.trim() ?? '';
    if (!normalized) {
        return '';
    }
    const markerIndex = normalized.indexOf(BATCH_ANALYSIS_CONTINUATION_MARKER);
    return markerIndex >= 0 ? normalized.slice(0, markerIndex).trim() : normalized;
}
function buildBatchAnalysisContinuationPrompt(prompt, role, priorOutput) {
    const basePrompt = stripBatchAnalysisContinuation(prompt);
    const roleLabel = role?.trim() ? role.trim() : 'current';
    const sections = [
        basePrompt,
        [
            BATCH_ANALYSIS_CONTINUATION_MARKER,
            `You are still in the same ${roleLabel} batch-analysis stage.`,
            'Continue in the same ACP session.',
            'Do not restart broad research or repeat the same tool calls unless a failed call must be retried.',
            'Reuse the evidence and context already gathered.',
            'Return only the complete final JSON object for this stage.',
            'Do not send progress prose, partial JSON, or explanatory narration.'
        ].join('\n')
    ];
    const summarizedPriorOutput = summarizeBatchContinuationOutput(priorOutput);
    if (summarizedPriorOutput) {
        sections.push(`Incomplete prior output:\n${summarizedPriorOutput}`);
    }
    return sections.filter(Boolean).join('\n\n');
}
function shouldAutoContinueBatchAnalysisTurn(params) {
    if (!params.contract) {
        return false;
    }
    const trimmed = params.resultText?.trim() ?? '';
    if (!trimmed) {
        return params.toolCallCount > 0;
    }
    if (promptStreamMatchesContract(trimmed, params.contract)) {
        return false;
    }
    if (looksLikeBatchProgressText(trimmed)) {
        return true;
    }
    if (streamedTextLikelyStartsJsonObject(trimmed)) {
        return true;
    }
    if (looksLikePromptStructuredResultContractText(trimmed, params.contract)) {
        return params.toolCallCount > 0 || trimmed.length < 1_500;
    }
    return false;
}
function extractDirectProtocolObject(result) {
    const streamedText = result && typeof result === 'object' && typeof result.streamedText === 'string'
        ? String(result.streamedText)
        : '';
    const explicitText = extractPromptResultText(result) ?? '';
    const candidates = [explicitText, streamedText].map((value) => value.trim()).filter(Boolean);
    for (const candidate of candidates) {
        const parsed = extractLargestBalancedJsonObject(candidate);
        if (parsed) {
            return parsed;
        }
    }
    return null;
}
function parseDirectActionEnvelope(result) {
    const parsed = extractDirectProtocolObject(result);
    if (!parsed || parsed.completionState !== 'needs_action' || parsed.isFinal !== false) {
        return null;
    }
    const action = parsed.action;
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
        return null;
    }
    const request = action;
    if (typeof request.id !== 'string'
        || typeof request.type !== 'string'
        || !shared_types_2.DIRECT_ACTION_TYPES.includes(request.type)
        || !request.args
        || typeof request.args !== 'object'
        || Array.isArray(request.args)) {
        return null;
    }
    return {
        completionState: 'needs_action',
        isFinal: false,
        action: {
            id: request.id,
            type: request.type,
            args: request.args
        }
    };
}
function parseDirectTerminalEnvelope(result) {
    const parsed = extractDirectProtocolObject(result);
    if (!parsed || parsed.isFinal !== true) {
        return null;
    }
    if (parsed.completionState !== 'blocked'
        && parsed.completionState !== 'needs_user_input'
        && parsed.completionState !== 'errored') {
        return null;
    }
    if (typeof parsed.message !== 'string' || !parsed.message.trim()) {
        return null;
    }
    return {
        completionState: parsed.completionState,
        isFinal: true,
        message: parsed.message.trim(),
        details: parsed.details
    };
}
function compactDirectActionPromptValue(value, depth = 0) {
    if (value == null || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        if (value.length <= DIRECT_ACTION_RESULT_MAX_STRING_CHARS) {
            return value;
        }
        return `${value.slice(0, DIRECT_ACTION_RESULT_MAX_STRING_CHARS)}… [truncated ${value.length - DIRECT_ACTION_RESULT_MAX_STRING_CHARS} chars]`;
    }
    if (depth >= DIRECT_ACTION_RESULT_MAX_DEPTH) {
        if (Array.isArray(value)) {
            return `[array truncated at depth ${DIRECT_ACTION_RESULT_MAX_DEPTH}; ${value.length} items]`;
        }
        return '[object truncated for prompt budget]';
    }
    if (Array.isArray(value)) {
        const limited = value
            .slice(0, DIRECT_ACTION_RESULT_MAX_ARRAY_ITEMS)
            .map((entry) => compactDirectActionPromptValue(entry, depth + 1));
        if (value.length > DIRECT_ACTION_RESULT_MAX_ARRAY_ITEMS) {
            limited.push({
                _truncatedItems: value.length - DIRECT_ACTION_RESULT_MAX_ARRAY_ITEMS
            });
        }
        return limited;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value);
        const limitedEntries = entries.slice(0, DIRECT_ACTION_RESULT_MAX_OBJECT_KEYS);
        const compacted = Object.fromEntries(limitedEntries.map(([key, entry]) => [key, compactDirectActionPromptValue(entry, depth + 1)]));
        if (entries.length > DIRECT_ACTION_RESULT_MAX_OBJECT_KEYS) {
            compacted._truncatedKeys = entries.length - DIRECT_ACTION_RESULT_MAX_OBJECT_KEYS;
        }
        return compacted;
    }
    return String(value);
}
function serializeDirectActionResultForPrompt(actionResult) {
    const serialized = JSON.stringify(actionResult);
    if (serialized.length <= DIRECT_ACTION_RESULT_MAX_PROMPT_CHARS) {
        return serialized;
    }
    const compacted = compactDirectActionPromptValue(actionResult);
    if (compacted && typeof compacted === 'object') {
        compacted._promptCompacted = true;
        compacted._promptCompactionReason = `Action result exceeded ${DIRECT_ACTION_RESULT_MAX_PROMPT_CHARS} characters`;
    }
    return JSON.stringify(compacted);
}
function stripDirectContinuation(prompt) {
    const normalized = prompt?.trim() ?? '';
    if (!normalized) {
        return '';
    }
    const markerIndex = normalized.indexOf(DIRECT_CONTINUATION_MARKER);
    return markerIndex >= 0 ? normalized.slice(0, markerIndex).trim() : normalized;
}
function buildDirectContinuationPrompt(session, prompt, actionResult, turnCount) {
    const includeBasePrompt = turnCount <= DIRECT_CONTINUATION_FULL_PROMPT_TURNS;
    const basePrompt = includeBasePrompt
        ? session.type === 'batch_analysis'
            ? stripBatchAnalysisContinuation(prompt)
            : stripDirectContinuation(prompt)
        : '';
    const sessionLabel = session.type === 'batch_analysis'
        ? `the same ${(session.role?.trim() ? session.role.trim() : 'current')} batch-analysis stage`
        : session.type === 'assistant_chat'
            ? 'the same KB Vault assistant turn'
            : 'the same article-edit turn';
    const finalContractLine = session.type === 'assistant_chat'
        ? 'Return either one new `needs_action` JSON envelope or the complete final assistant JSON object now.'
        : session.type === 'article_edit'
            ? 'Return either one new `needs_action` JSON envelope or the complete final article-edit JSON object with `updatedHtml` and `summary` now.'
            : 'Return either one new `needs_action` JSON envelope or the complete final stage JSON object now.';
    const workerExecutionReminder = session.type === 'batch_analysis' && session.role === 'worker'
        ? [
            'Approved plan targets already present in the prompt remain authoritative unless a read or write failure proves otherwise.',
            'For approved edit/retire items, `create_proposals` may use `localeVariantId`, `familyId`, or `targetTitle`; for creates, use `targetTitle` directly.',
            'If you already have a usable target, stop researching and issue `create_proposals` now. Batch multiple approved items together when possible.'
        ]
        : [];
    return [
        basePrompt,
        [
            DIRECT_CONTINUATION_MARKER,
            `You are still in ${sessionLabel} in Direct mode.`,
            `The app executed direct action turn ${turnCount}.`,
            'Continue in the same ACP session.',
            includeBasePrompt
                ? 'Reuse all prior context and action results already gathered.'
                : 'Reuse the original task instructions and prior action results already present earlier in this ACP session.',
            'Do not repeat an identical direct action unless the earlier result was an explicit transient failure and retrying is necessary.',
            ...workerExecutionReminder,
            finalContractLine,
            'Do not add narration, markdown fences, or progress prose.',
            'Latest action result JSON:',
            serializeDirectActionResultForPrompt(actionResult)
        ].join('\n')
    ].filter(Boolean).join('\n\n');
}
function buildDirectRecoveryPrompt(session, prompt, partialText, recoveryAttempt) {
    const includeBasePrompt = recoveryAttempt <= 1;
    const basePrompt = includeBasePrompt
        ? session.type === 'batch_analysis'
            ? stripBatchAnalysisContinuation(prompt)
            : stripDirectContinuation(prompt)
        : '';
    const sessionLabel = session.type === 'batch_analysis'
        ? `the same ${(session.role?.trim() ? session.role.trim() : 'current')} batch-analysis stage`
        : session.type === 'assistant_chat'
            ? 'the same KB Vault assistant turn'
            : 'the same article-edit turn';
    const finalContractLine = session.type === 'assistant_chat'
        ? 'Return either one complete `needs_action` JSON envelope or the complete final assistant JSON object now.'
        : session.type === 'article_edit'
            ? 'Return either one complete `needs_action` JSON envelope or the complete final article-edit JSON object with `updatedHtml` and `summary` now.'
            : 'Return either one complete `needs_action` JSON envelope or the complete final stage JSON object now.';
    const partialSnippet = (partialText?.trim() ?? '').slice(0, 6_000);
    const workerExecutionReminder = session.type === 'batch_analysis' && session.role === 'worker'
        ? [
            'Approved plan targets already present in the prompt remain authoritative unless a read or write failure proves otherwise.',
            'For approved edit/retire items, `create_proposals` may use `localeVariantId`, `familyId`, or `targetTitle`; for creates, use `targetTitle` directly.',
            'If you already have a usable target, resend or issue `create_proposals` now instead of spending more turns on lookup.'
        ]
        : [];
    return [
        basePrompt,
        [
            DIRECT_RECOVERY_MARKER,
            `You are still in ${sessionLabel} in Direct mode.`,
            'Your previous reply was incomplete or malformed JSON, so the app could not parse or execute it.',
            'Continue in the same ACP session.',
            includeBasePrompt
                ? 'Reuse the task instructions and any prior session context already gathered.'
                : 'Reuse the earlier task instructions and prior session context already present earlier in this ACP session.',
            ...workerExecutionReminder,
            finalContractLine,
            'Return exactly one complete JSON object.',
            'Do not add narration, markdown fences, or progress prose.',
            session.type === 'batch_analysis'
                ? 'If you were issuing `create_proposals`, resend the full complete `needs_action` envelope with the complete proposal payload.'
                : '',
            partialSnippet ? `Previous partial output:\n${partialSnippet}` : 'Previous partial output was empty.'
        ].filter(Boolean).join('\n')
    ].filter(Boolean).join('\n\n');
}
function looksLikeRecoverableDirectProtocolText(value) {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) {
        return false;
    }
    if (extractLargestBalancedJsonObject(trimmed)) {
        return false;
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('```json')) {
        return true;
    }
    const normalized = trimmed.toLowerCase();
    return (normalized.includes('"completionstate"')
        || normalized.includes('"isfinal"')
        || normalized.includes('"action"')
        || normalized.includes('"summary"')
        || normalized.includes('"updatedhtml"')
        || normalized.includes('"response"'));
}
function buildDirectBlockedResultEnvelope(message, details) {
    return {
        completionState: 'blocked',
        isFinal: true,
        message,
        ...(details !== undefined ? { details } : {})
    };
}
function buildSyntheticPromptResult(payload) {
    const text = JSON.stringify(payload);
    return {
        finalText: text,
        text,
        content: [{ type: 'text', text }]
    };
}
function scorePromptFinalTextCandidate(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        return Number.NEGATIVE_INFINITY;
    }
    let score = scorePromptMessageCandidate(trimmed);
    if (looksLikeAssistantProgressText(trimmed) && !looksLikeJsonObjectText(trimmed)) {
        score -= 5_000;
    }
    if (extractLargestBalancedJsonText(trimmed)) {
        score += 2_000;
    }
    return score;
}
function selectCanonicalPromptResultText(candidates) {
    const unique = Array.from(new Set(candidates.map((value) => value.trim()).filter(Boolean)));
    if (unique.length === 0) {
        return undefined;
    }
    return unique.sort((left, right) => scorePromptFinalTextCandidate(right) - scorePromptFinalTextCandidate(left))[0];
}
function promptStreamMatchesContract(value, contract) {
    const parsed = extractLargestBalancedJsonObject(value);
    if (!parsed) {
        return false;
    }
    return parsedBatchStructuredResultMatchesContract(parsed, contract);
}
const DEFAULT_PROMPT_SETTLE_WINDOW = {
    idleMs: 350,
    minWaitMs: 0,
    maxWaitMs: 5_000
};
const BATCH_PROGRESS_PROMPT_SETTLE_WINDOW = {
    idleMs: 1_000,
    minWaitMs: 5_000,
    maxWaitMs: 45_000
};
const NON_JSON_PROMPT_SETTLE_WINDOW = {
    idleMs: 2_500,
    minWaitMs: 60_000,
    maxWaitMs: 90_000
};
const ASSISTANT_CHAT_PROMPT_SETTLE_WINDOW = {
    idleMs: 1_000,
    minWaitMs: 2_000,
    maxWaitMs: 15_000
};
const ASSISTANT_CHAT_RECOVERY_RETRY_LIMIT = 2;
const ASSISTANT_CHAT_CONTINUATION_MARKER = 'Continuation instructions:';
function buildAssistantChatToolRecoveryPrompt(mode, policyError) {
    const providerLabel = mode === 'mcp' ? 'MCP mode' : mode === 'cli' ? 'CLI mode' : 'Direct mode';
    const violationText = mode === 'direct'
        ? 'The previous attempt was interrupted because you issued an operation outside the direct-action contract for this session.'
        : policyError?.trim()
            ? `The previous attempt was interrupted because you attempted an illegal operation in ${providerLabel}: ${policyError.trim()}.`
            : `The previous attempt was interrupted because you attempted an illegal operation in ${providerLabel}.`;
    if (mode === 'mcp') {
        return [
            'Continue the same user request using the existing session context.',
            violationText,
            'Do not try that illegal operation again.',
            'Use only direct KB Vault MCP tools in this recovered turn.',
            'Do not use Terminal, Shell, kb CLI commands, list_mcp_resources, fetch_mcp_resource, Read File, grep, codebase search, or filesystem exploration.',
            'If you already gathered enough KB context in this session, answer now.',
            'If you still need one targeted lookup, call the minimum direct KB Vault MCP tool now and then answer.',
            'If the current article already has a localeVariantId or revisionId in the prompt context, call get_article directly with that identifier.',
            'Do not claim that KB Vault MCP tools are unavailable just because they were not shown in a generic tool list.',
            'Your job is to finish answering the user\'s question, not to explore the environment.',
            'Do the research now and return the final user-facing answer in this same turn.',
            'Do not send a progress update.'
        ].join(' ');
    }
    if (mode === 'direct') {
        return [
            'Continue the same user request using the existing session context.',
            violationText,
            'Do not try that illegal operation again.',
            'Stay inside the direct-action contract from the original prompt.',
            'If you already gathered enough context in this session, answer now.',
            'If you still need KB or app context, return exactly one `needs_action` direct-action JSON envelope using only the allowed direct actions from the original prompt.',
            'Do not describe transport internals or ad-hoc environment exploration.',
            'Do not send a progress update.'
        ].join(' ');
    }
    return [
        'Continue the same user request using the existing session context.',
        violationText,
        'Do not try that illegal operation again.',
        'Use only exact kb CLI commands in this recovered turn.',
        'Do not use direct MCP tool names, list_mcp_resources, fetch_mcp_resource, terminal utilities, grep, Read File, codebase search, or filesystem exploration.',
        'If you already gathered KB context in this session, use it and answer now.',
        'If you do not yet have enough context, run the minimum exact kb command now and then answer.',
        'Do not claim that KB commands are forbidden in this turn unless a direct kb command actually failed.',
        'Do not use Shell or Terminal again in this turn except for exact kb CLI commands.',
        'Your job is to finish answering the user\'s question, not to explore the environment.',
        'For app-feature and terminology questions, prefer this path unless the route clearly requires something else: kb search-kb, then kb get-article for the best 1-3 results, then answer.',
        'Use kb get-article-family only when you need family context from a clearly relevant article.',
        'Do not use kb batch-context, kb find-related-articles, form-editing commands, or kb help unless they are clearly necessary for this specific request.',
        'Do the research now and return the final user-facing answer in this same turn.',
        'Do not send a progress update.'
    ].join(' ');
}
function stripAssistantChatContinuation(promptText) {
    const trimmed = promptText?.trim() ?? '';
    if (!trimmed) {
        return '';
    }
    const markerIndex = trimmed.indexOf(ASSISTANT_CHAT_CONTINUATION_MARKER);
    if (markerIndex < 0) {
        return trimmed;
    }
    return trimmed.slice(0, markerIndex).trim();
}
function buildAssistantChatContinuationPrompt(basePromptText, continuationText) {
    const basePrompt = stripAssistantChatContinuation(basePromptText);
    if (!basePrompt) {
        return continuationText;
    }
    return [
        basePrompt,
        ASSISTANT_CHAT_CONTINUATION_MARKER,
        continuationText
    ].join('\n\n');
}
function extractPromptResultText(value) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const record = value;
    if (typeof record.finalText === 'string' && record.finalText.trim()) {
        return record.finalText;
    }
    if (typeof record.text === 'string' && record.text.trim()) {
        return record.text;
    }
    if (Array.isArray(record.content)) {
        const joined = record.content
            .filter((item) => item?.type === 'text' && typeof item.text === 'string')
            .map((item) => item.text)
            .join('\n')
            .trim();
        if (joined) {
            return joined;
        }
    }
    return undefined;
}
function looksLikeJsonObjectText(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        return false;
    }
    const candidates = [
        trimmed,
        trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '')
    ];
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return true;
            }
        }
        catch {
            // fall through
        }
    }
    return false;
}
function getPromptSettleWindow(result, streamedText) {
    const explicitText = extractPromptResultText(result);
    if ((explicitText && looksLikeJsonObjectText(explicitText)) || (streamedText && looksLikeJsonObjectText(streamedText))) {
        return DEFAULT_PROMPT_SETTLE_WINDOW;
    }
    return NON_JSON_PROMPT_SETTLE_WINDOW;
}
function getBatchAnalysisPromptSettleWindow(result, streamedText) {
    const explicitText = extractPromptResultText(result);
    if ((explicitText && looksLikeJsonObjectText(explicitText)) || (streamedText && looksLikeJsonObjectText(streamedText))) {
        return DEFAULT_PROMPT_SETTLE_WINDOW;
    }
    if (explicitText?.trim() || streamedText?.trim() || looksLikeBatchProgressText(explicitText) || looksLikeBatchProgressText(streamedText)) {
        return BATCH_PROGRESS_PROMPT_SETTLE_WINDOW;
    }
    return DEFAULT_PROMPT_SETTLE_WINDOW;
}
function sortTranscriptLines(lines) {
    return lines
        .map((line, index) => ({ line, index }))
        .sort((left, right) => {
        const leftSeq = typeof left.line.seq === 'number' ? left.line.seq : Number.POSITIVE_INFINITY;
        const rightSeq = typeof right.line.seq === 'number' ? right.line.seq : Number.POSITIVE_INFINITY;
        if (leftSeq !== rightSeq) {
            return leftSeq - rightSeq;
        }
        if (left.line.atUtc !== right.line.atUtc) {
            return left.line.atUtc.localeCompare(right.line.atUtc);
        }
        return left.index - right.index;
    })
        .map((entry) => entry.line);
}
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
