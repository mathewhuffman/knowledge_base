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
const DEFAULT_AGENT_BINARY = 'agent';
const DEFAULT_CURSOR_BINARY = 'cursor';
const DEFAULT_CURSOR_ARGS = ['agent', 'acp'];
const DEFAULT_CLI_BINARY = 'kb';
const ACP_HEALTH_INIT_TIMEOUT_MS = 15_000;
const ACP_HEALTH_INIT_ATTEMPTS = 2;
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
    if (mode === 'cli' && normalizedMode === 'plan') {
        // Cursor ACP plan sessions currently stall in CLI runtime mode, so keep the
        // planner/reviewer prompts but bootstrap the ACP session as a normal agent run.
        return 'agent';
    }
    return normalizedMode;
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
function isCliToolPolicyViolationError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.trim().toLowerCase();
    return normalized.includes('cli mode forbids');
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
function buildMcpTaskPrompt(session, taskPayload, extras) {
    const batchId = typeof taskPayload.batchId === 'string' ? taskPayload.batchId : session.batchId ?? '';
    const locale = typeof taskPayload.locale === 'string' ? taskPayload.locale : session.locale ?? 'default';
    const explicitPrompt = typeof taskPayload.prompt === 'string' ? taskPayload.prompt.trim() : '';
    const role = session.role ?? 'worker';
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
            'Tool rules:',
            '- Use KB Vault tools and structured article/template data only when they help answer the user.',
            '- Do NOT use terminal, grep, codebase search, find, or filesystem exploration unless explicitly requested.',
            '- The preloaded prompt context is for orientation; use KB Vault MCP tools directly when you need to confirm or inspect source records.',
            '- Return only valid JSON in your final answer.',
            '- Do not include preamble, commentary about your reasoning, or markdown fences.',
            '- For informational chat, return only `artifactType` and `response`. Omit `summary`, `html`, `formPatch`, and `payload` unless they are needed.',
            '- Only return `proposal_candidate` when the user explicitly asks you to make or propose changes.',
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
        '- Use the terminal only for `kb` commands, except for minimal temporary-file creation needed to pass large proposal metadata via `--metadata-file`.',
        '- Always include `--json` in every `kb` command.',
        '- Use as many `kb` commands as needed to complete the task.',
        '- Do NOT use Read File.',
        '- Do NOT use grep.',
        '- If an exact `kb` command is unavailable, call `kb --help` to confirm current syntax.',
        '- If you need KB evidence, prefer direct `kb` output over local inference.',
        '- If you need batch context, load batch context first with `kb`.',
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
            '- Never use terminal commands like grep, Read File, codebase search, or general filesystem exploration.',
            '- Prefer these commands when relevant: `kb batch-context --workspace-id <workspace-id> --batch-id <batch-id> --json`, `kb find-related-articles --workspace-id <workspace-id> --batch-id <batch-id> --json`, `kb search-kb --workspace-id <workspace-id> --query "<query>" --json`, `kb get-article --workspace-id <workspace-id> --locale-variant-id <locale-variant-id> --json`, `kb get-article-family --workspace-id <workspace-id> --family-id <family-id> --json`, `kb app get-form-schema --workspace-id <workspace-id> --route <route> --entity-type <entity-type> --entity-id <entity-id> --json`, `kb app patch-form --workspace-id <workspace-id> --route <route> --entity-type <entity-type> --entity-id <entity-id> --version-token <version-token> --patch \'<json object>\' --json`, and `kb help --json`.',
            '- Use the KB command output as the source of truth when answering.'
        ].join('\n');
        return [
            'You are running inside KB Vault as a route-aware assistant for conversational help and proposal drafting.',
            `Workspace ID: ${session.workspaceId}`,
            `Locale: ${locale}`,
            '',
            'Assistant chat rules:',
            '- Use kb commands and structured article/template data only when they materially help answer the user or complete an explicit edit/proposal request.',
            '- If the user is asking a normal question or wants an explanation, answer directly instead of doing unnecessary research.',
            '- If the user explicitly asks you to research, investigate, look something up, or answer from workspace data, do that research now and return the final findings in the same turn.',
            '- Never use generic terminal commands. Only use kb commands when tool use is needed.',
            '- Do not include preamble, commentary about your reasoning, or markdown fences.',
            '- Follow the output contract in the additional instructions below exactly.',
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
const CLI_PLANNER_ZERO_RESULT_SEARCH_LIMIT = 6;
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
    cursorSessionIds = new Map();
    cursorSessionLookup = new Map();
    activeStreamEmitters = new Map();
    promptMessageChunks = new Map();
    promptCompletionTimers = new Map();
    pendingPromptFallbacks = new Map();
    pendingSessionOperations = new Map();
    sessionActivityAt = new Map();
    cliPlannerLoopState = new Map();
    workspaceAgentModels = new Map();
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
            mode: input.mode ?? (input.type === 'assistant_chat' ? 'ask' : 'agent'),
            role: input.role,
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
        void this.resetCursorSession(session.id);
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
    async handleMcpJsonMessage(raw) {
        return this.mcpServer.handleJsonMessage(raw);
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
            const initialResultPayload = await this.transit(session, {
                task: 'analyze_batch',
                batchId: request.batchId,
                prompt: request.prompt,
                locale: request.locale,
                templatePackId: request.templatePackId
            }, (event) => {
                rawOutput.push(event.message ?? JSON.stringify(event.data ?? {}));
                emit({ sessionId: session.id, kind: event.kind, data: event.data, message: event.message, atUtc: new Date().toISOString() });
            }, toolCalls, isCancelled, timeoutMs);
            const settleWindow = getPromptSettleWindow(initialResultPayload, assemblePromptMessageText(this.promptMessageChunks.get(session.id) ?? []));
            const remainingWaitMs = Math.max(0, timeoutMs - (Date.now() - startedAtMs));
            await this.waitForSessionToSettle(session.id, settleWindow.idleMs, Math.min(settleWindow.maxWaitMs, remainingWaitMs), Math.min(settleWindow.minWaitMs, remainingWaitMs));
            const resultPayload = this.finalizePromptResult(session.id, initialResultPayload);
            const endedAt = new Date().toISOString();
            session.updatedAtUtc = endedAt;
            session.status = 'idle';
            return {
                sessionId: session.id,
                kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
                status: isCancelled() ? 'canceled' : 'ok',
                transcriptPath,
                rawOutput,
                resultPayload,
                toolCalls,
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
            session.updatedAtUtc = endedAt;
            session.status = 'idle';
            return {
                sessionId: session.id,
                kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
                status: 'error',
                transcriptPath,
                rawOutput,
                resultPayload: undefined,
                toolCalls,
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
            const resultPayload = await this.transit(session, {
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
                resultPayload,
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
                resultPayload: undefined,
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
            let attempt = 0;
            let nextPrompt = request.prompt;
            while (true) {
                let initialResultPayload;
                try {
                    initialResultPayload = await this.transit(session, {
                        task: 'assistant_chat',
                        localeVariantId: request.localeVariantId,
                        prompt: nextPrompt,
                        locale: request.locale
                    }, (event) => {
                        rawOutput.push(event.message ?? JSON.stringify(event.data ?? {}));
                        emit({ sessionId: session.id, kind: event.kind, data: event.data, message: event.message, atUtc: new Date().toISOString() });
                    }, toolCalls, isCancelled, timeoutMs);
                }
                catch (error) {
                    const remainingWaitMs = Math.max(0, timeoutMs - (Date.now() - startedAtMs));
                    const canRecoverFromToolPolicy = !isCancelled()
                        && attempt < ASSISTANT_CHAT_AUTO_CONTINUE_LIMIT
                        && remainingWaitMs >= 5_000
                        && isCliToolPolicyViolationError(error);
                    if (!canRecoverFromToolPolicy) {
                        throw error;
                    }
                    attempt += 1;
                    nextPrompt = ASSISTANT_CHAT_KB_ONLY_RECOVERY_PROMPT;
                    rawOutput.push(`[assistant-chat kb-only recovery ${attempt}] ${error instanceof Error ? error.message : String(error)}`);
                    this.log('agent.runtime.assistant_chat_kb_only_retry', {
                        workspaceId: request.workspaceId,
                        sessionId: session.id,
                        attempt,
                        reason: error instanceof Error ? error.message : String(error)
                    });
                    continue;
                }
                const settleWindow = ASSISTANT_CHAT_PROMPT_SETTLE_WINDOW;
                const remainingWaitMs = Math.max(0, timeoutMs - (Date.now() - startedAtMs));
                await this.waitForSessionToSettle(session.id, settleWindow.idleMs, Math.min(settleWindow.maxWaitMs, remainingWaitMs), Math.min(settleWindow.minWaitMs, remainingWaitMs));
                resultPayload = this.finalizePromptResult(session.id, initialResultPayload);
                const resultText = extractPromptResultText(resultPayload);
                const canAutoContinue = !isCancelled()
                    && attempt < ASSISTANT_CHAT_AUTO_CONTINUE_LIMIT
                    && Math.max(0, timeoutMs - (Date.now() - startedAtMs)) >= 5_000
                    && looksLikeAssistantProgressText(resultText);
                if (!canAutoContinue) {
                    break;
                }
                attempt += 1;
                nextPrompt = ASSISTANT_CHAT_CONTINUE_PROMPT;
                rawOutput.push(`[assistant-chat auto-continue ${attempt}] ${String(resultText ?? '')}`);
                this.log('agent.runtime.assistant_chat_auto_continue', {
                    workspaceId: request.workspaceId,
                    sessionId: session.id,
                    attempt,
                    preview: (resultText ?? '').slice(0, 160)
                });
            }
            const endedAt = new Date().toISOString();
            return {
                sessionId: session.id,
                kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
                status: isCancelled() ? 'canceled' : 'ok',
                transcriptPath,
                rawOutput,
                resultPayload,
                toolCalls,
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
            return {
                sessionId: session.id,
                kbAccessMode: session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
                status: 'error',
                transcriptPath,
                rawOutput,
                resultPayload: undefined,
                toolCalls,
                startedAtUtc: startedAt,
                endedAtUtc: endedAt,
                durationMs: Date.parse(endedAt) - startedAtMs,
                message: error instanceof Error ? error.message : String(error)
            };
        }
        finally {
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
        const requestedMode = input.sessionMode ?? (input.sessionType === 'assistant_chat' ? 'ask' : 'agent');
        const existing = input.sessionId
            ? this.getSession(input.sessionId)
            : ('batchId' in input && sessionType === 'batch_analysis' ? this.findReusableBatchAnalysisSession(input) : null);
        let session = existing;
        if (!session) {
            if (!input.workspaceId) {
                throw new Error('workspaceId is required');
            }
            const createRequest = {
                workspaceId: input.workspaceId,
                kbAccessMode: input.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
                type: sessionType,
                mode: requestedMode,
                role: input.agentRole,
                batchId: 'batchId' in input ? input.batchId : undefined,
                locale: input.locale,
                templatePackId: 'templatePackId' in input ? input.templatePackId : undefined,
                scope: 'localeVariantScope' in input && input.localeVariantScope ? { localeVariantIds: input.localeVariantScope } : undefined
            };
            session = this.createSession(createRequest);
        }
        else {
            let needsReset = false;
            if (input.kbAccessMode && input.kbAccessMode !== session.kbAccessMode) {
                session.kbAccessMode = input.kbAccessMode;
                needsReset = true;
            }
            if (requestedMode !== session.mode) {
                session.mode = requestedMode;
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
        const requestEnvelope = {
            session,
            task: taskPayload
        };
        this.activeStreamEmitters.set(session.id, emit);
        this.promptMessageChunks.set(session.id, []);
        try {
            // Log runtime mode in transcript so CLI-mode runs are identifiable in history
            await this.trackSessionOperation(session.id, this.appendTranscriptLine(session.id, 'system', 'runtime_mode', JSON.stringify({
                kbAccessMode: mode,
                provider: provider.provider,
                terminalEnabled: provider.terminalEnabled,
                agentModelId: this.getWorkspaceAgentModel(session.workspaceId) ?? 'default'
            })));
            await this.trackSessionOperation(session.id, Promise.resolve(emit({ kind: 'session_started', data: { ...requestEnvelope, kbAccessMode: mode }, message: 'Session started' })));
            const requestEnvelopeString = JSON.stringify(requestEnvelope);
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
            let response = await transport.request('session/prompt', requestPayload, timeoutMs, session.id);
            while (response.error && retryCount < 2 && isRetriablePromptError(response.error)) {
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
            const result = response.result && typeof response.result === 'object'
                ? { ...response.result }
                : {};
            await this.trackSessionOperation(session.id, Promise.resolve(emit({ kind: 'result', data: response, message: 'Run complete' })));
            await this.trackSessionOperation(session.id, (0, promises_1.appendFile)(transcriptPath, `${JSON.stringify({ atUtc: new Date().toISOString(), direction: 'to_agent', event: requestEnvelopeString, payload: requestEnvelopeString })}\n`, 'utf8'));
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
        const updateRecord = params.update && typeof params.update === 'object'
            ? params.update
            : undefined;
        if (updateRecord?.sessionUpdate === 'agent_message_chunk') {
            const text = extractAgentMessageChunkText(updateRecord.content);
            if (text) {
                const chunks = appendPromptMessageChunk(this.promptMessageChunks.get(localSessionId) ?? [], text);
                this.promptMessageChunks.set(localSessionId, chunks);
                this.schedulePromptCompletionFallback(localSessionId, params.sessionId);
            }
        }
        this.markSessionActivity(localSessionId);
        const payload = JSON.stringify(message.params);
        if (!isHiddenAgentThoughtUpdate(message.params)) {
            await this.trackSessionOperation(localSessionId, this.appendTranscriptLine(localSessionId, 'from_agent', 'session_update', payload));
        }
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
                    await this.trackSessionOperation(localSessionId, this.appendTranscriptLine(localSessionId, 'system', 'cli_tool_policy_violation', JSON.stringify({
                        toolName: params.update.title,
                        kind: params.update.kind,
                        reason: policy.reason
                    })));
                    const workspaceId = this.sessions.get(localSessionId)?.workspaceId;
                    this.getTransport('cli', workspaceId).abortPromptSession(params.sessionId, policy.reason);
                }
            }
        }
        await this.maybeAbortCliPlannerLoop(localSessionId, params.sessionId, updateRecord);
        const emit = this.activeStreamEmitters.get(localSessionId);
        if (!emit) {
            return;
        }
        await this.trackSessionOperation(localSessionId, Promise.resolve(emit({
            kind: 'progress',
            data: message.params,
            message: params.update?.sessionUpdate ? `session/update:${params.update.sessionUpdate}` : 'session/update'
        })));
    }
    consumePromptMessageText(sessionId) {
        const chunks = this.promptMessageChunks.get(sessionId) ?? [];
        this.promptMessageChunks.delete(sessionId);
        return assemblePromptMessageText(chunks);
    }
    finalizePromptResult(sessionId, result) {
        const finalized = result && typeof result === 'object'
            ? { ...result }
            : {};
        const assembledText = this.consumePromptMessageText(sessionId).trim();
        if (assembledText) {
            const explicitText = extractPromptResultText(finalized)?.trim();
            if (!explicitText || (!looksLikeJsonObjectText(explicitText) && looksLikeJsonObjectText(assembledText))) {
                finalized.text = assembledText;
                finalized.content = [{ type: 'text', text: assembledText }];
            }
            else {
                finalized.streamedText = assembledText;
            }
        }
        return finalized;
    }
    cleanupPromptState(sessionId) {
        this.clearPromptCompletionTimer(sessionId);
        this.pendingPromptFallbacks.delete(sessionId);
        this.activeStreamEmitters.delete(sessionId);
        this.promptMessageChunks.delete(sessionId);
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
            const normalizedAssembledText = assemblePromptMessageText(this.promptMessageChunks.get(localSessionId) ?? []).trim();
            if (!normalizedAssembledText) {
                return;
            }
            const lastActivityAt = this.sessionActivityAt.get(localSessionId) ?? Date.now();
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
        await (0, promises_1.appendFile)(filePath, `${JSON.stringify({ atUtc: new Date().toISOString(), direction: 'system', event: 'transcript_start', payload: runId })}\n`, 'utf8');
        this.markSessionActivity(sessionId);
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
            aborted: false
        };
        state.searchKbCalls += 1;
        if ((parsed.total ?? 0) === 0) {
            state.consecutiveZeroResultSearches += 1;
        }
        else {
            state.consecutiveZeroResultSearches = 0;
        }
        this.cliPlannerLoopState.set(localSessionId, state);
        if (state.aborted || state.consecutiveZeroResultSearches < CLI_PLANNER_ZERO_RESULT_SEARCH_LIMIT) {
            return;
        }
        state.aborted = true;
        const reason = `Planner loop breaker triggered after ${state.searchKbCalls} search-kb calls and ${state.consecutiveZeroResultSearches} consecutive zero-result searches`;
        this.log('agent.runtime.cli_planner_loop_breaker', {
            sessionId: localSessionId,
            acpSessionId,
            searchKbCalls: state.searchKbCalls,
            consecutiveZeroResultSearches: state.consecutiveZeroResultSearches
        });
        await this.trackSessionOperation(localSessionId, this.appendTranscriptLine(localSessionId, 'system', 'planner_loop_breaker', JSON.stringify({
            reason,
            searchKbCalls: state.searchKbCalls,
            consecutiveZeroResultSearches: state.consecutiveZeroResultSearches
        })));
        this.getTransport('cli', session.workspaceId).abortPromptSession(acpSessionId, reason);
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
    async getMcpHealth(workspaceId) {
        const issues = [];
        const cursorInstalled = this.isCursorAvailable('mcp');
        if (!cursorInstalled) {
            issues.push('Cursor binary not found');
        }
        const acpReachable = cursorInstalled ? await this.canReachCursor('mcp', workspaceId) : false;
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
    async resetCursorSession(sessionId) {
        const existing = this.cursorSessionIds.get(sessionId);
        if (!existing) {
            return;
        }
        this.clearPromptCompletionTimer(sessionId);
        this.pendingPromptFallbacks.delete(sessionId);
        this.cursorSessionIds.delete(sessionId);
        this.cursorSessionLookup.delete(existing.acpSessionId);
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }
        const transportKey = this.buildTransportKey(existing.mode, session.workspaceId);
        const transport = this.transports.get(transportKey);
        if (!transport) {
            return;
        }
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
        await (0, promises_1.appendFile)(path, `${JSON.stringify({
            atUtc: new Date().toISOString(),
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
                description: 'Load persisted article relationships for an article or a PBI batch.',
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
function extractAgentMessageChunkText(value) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const content = value;
    return typeof content.text === 'string' && content.text.length > 0
        ? content.text
        : undefined;
}
function collapseRepeatedChunkText(value) {
    let current = value;
    while (current.trim().length >= 64 && current.length % 2 === 0) {
        const midpoint = current.length / 2;
        const left = current.slice(0, midpoint);
        const right = current.slice(midpoint);
        if (!left.trim() || left !== right) {
            break;
        }
        current = left;
    }
    return current.trim();
}
function findChunkOverlap(left, right) {
    const maxOverlap = Math.min(left.length, right.length);
    for (let overlap = maxOverlap; overlap >= 24; overlap -= 1) {
        if (left.slice(-overlap) === right.slice(0, overlap)) {
            return overlap;
        }
    }
    return 0;
}
function appendPromptMessageChunk(chunks, text) {
    if (!text && text !== '') {
        return chunks;
    }
    if (!text.trim() && !/[\r\n]/.test(text)) {
        return chunks;
    }
    const assembled = chunks.join('');
    if (!assembled) {
        chunks.push(text);
        return chunks;
    }
    if (assembled.endsWith(text)) {
        return chunks;
    }
    const overlap = findChunkOverlap(assembled, text);
    const suffix = overlap > 0 ? text.slice(overlap) : text;
    if (suffix) {
        chunks.push(suffix);
    }
    return chunks;
}
function assemblePromptMessageText(chunks) {
    return collapseRepeatedChunkText(chunks.join(''));
}
const DEFAULT_PROMPT_SETTLE_WINDOW = {
    idleMs: 350,
    minWaitMs: 0,
    maxWaitMs: 5_000
};
const NON_JSON_PROMPT_SETTLE_WINDOW = {
    idleMs: 2_500,
    minWaitMs: 60_000,
    maxWaitMs: 90_000
};
const ASSISTANT_CHAT_PROMPT_SETTLE_WINDOW = {
    idleMs: 1_000,
    minWaitMs: 0,
    maxWaitMs: 8_000
};
const ASSISTANT_CHAT_AUTO_CONTINUE_LIMIT = 2;
const ASSISTANT_CHAT_CONTINUE_PROMPT = [
    'Continue the same user request using the existing session context.',
    'If research is needed, do it now and then provide the final user-facing answer in this same turn.',
    'Do not send another progress update, status note, or "I am going to..." message.',
    'Return the final answer only.'
].join(' ');
const ASSISTANT_CHAT_KB_ONLY_RECOVERY_PROMPT = [
    'Continue the same user request using the existing session context.',
    'Use only kb commands for research. Do not use terminal utilities, grep, Read File, codebase search, or filesystem exploration.',
    'Allowed kb commands include: kb batch-context --json, kb find-related-articles --json, kb search-kb --json, kb get-article --json, kb get-article-family --json, kb app get-form-schema --json, kb app patch-form --json, and kb help --json.',
    'Do the research now and return the final user-facing answer in this same turn.',
    'Do not send a progress update.'
].join(' ');
function extractPromptResultText(value) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const record = value;
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
function looksLikeAssistantProgressText(value) {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    if (looksLikeJsonObjectText(normalized)) {
        return false;
    }
    const progressPhrases = [
        "i'm going to",
        'i am going to',
        "i’ll look",
        'i will look',
        'let me look',
        "i'm looking up",
        'i am looking up',
        "i'm opening",
        'i am opening',
        'opening those now',
        'opening that now',
        'so i can answer',
        'so i can explain',
        'instead of guessing',
        'rather than guess',
        'i found the likely source',
        'i found the likely source articles',
        "i'm going to look up",
        'continue the same task',
        'i can try to pull'
    ];
    return progressPhrases.some((phrase) => normalized.includes(phrase));
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
