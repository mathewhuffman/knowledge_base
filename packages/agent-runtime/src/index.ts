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
  AgentAssistantChatRunRequest,
  AgentHealthCheckResponse,
  AgentRuntimeOptionsResponse,
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
  AgentSessionMode,
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
const DEFAULT_AGENT_BINARY = 'agent';
const DEFAULT_CURSOR_BINARY = 'cursor';
const DEFAULT_CURSOR_ARGS = ['agent', 'acp'];
const DEFAULT_CLI_BINARY = 'kb';
const ACP_HEALTH_INIT_TIMEOUT_MS = 15_000;
const ACP_HEALTH_INIT_ATTEMPTS = 2;
const ACP_SESSION_READY_WAIT_MS = 1_200;
const ACP_SESSION_NOT_FOUND_RETRY_LIMIT = 4;
const ASSISTANT_CHAT_AUTO_CONTINUE_LIMIT = 2;
type AssistantCompletionState = 'completed' | 'researching' | 'needs_user_input' | 'blocked' | 'errored' | 'unknown';
type AgentRunResultWithAcpSession = AgentRunResult & { acpSessionId?: string };
type AgentRunRequestWithReusePolicy =
  (AgentAnalysisRunRequest | AgentArticleEditRunRequest | AgentAssistantChatRunRequest)
  & { sessionReusePolicy?: 'reuse' | 'reset_acp' | 'new_local_session' };

function resolveDefaultCursorBinary(): string {
  if (hasBinaryOnPath(DEFAULT_AGENT_BINARY)) {
    return DEFAULT_AGENT_BINARY;
  }
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

function hasBinaryOnPath(binary: string): boolean {
  const searchPath = process.env.PATH ?? '';
  return searchPath.split(path.delimiter).some((dir) => {
    if (!dir) {
      return false;
    }
    const exe = path.join(dir, binary);
    const exeWithExt = path.extname(exe).length > 0 ? exe : `${exe}.exe`;
    return fs.existsSync(exe) || fs.existsSync(exeWithExt);
  });
}

function resolveCursorArgs(binary: string): string[] {
  const basename = path.basename(binary).toLowerCase().replace(/\.exe$/, '');
  if (basename === 'agent') {
    return ['acp'];
  }
  return DEFAULT_CURSOR_ARGS;
}

function buildCursorAcpArgs(binary: string, _modelId?: string): string[] {
  // Launch ACP without a model override and select the model through
  // `session/set_model` after `session/new`. Cursor's startup `--model` flag
  // accepts a different token format than ACP session model ids.
  return resolveCursorArgs(binary);
}

function extractKbCliCommandName(value: string | undefined): string | undefined {
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

function looksLikeKbCliShellInvocation(value: string | undefined): boolean {
  const normalized = value?.replace(/["']/g, ' ').trim() ?? '';
  if (!normalized) {
    return false;
  }

  return (
    /(?:^|\s)(?:kb|kb\.exe)\s+[a-z0-9_-]+/i.test(normalized)
    || /kb-vault-cli-shim\/kb(?:\s+|["']\s+)[a-z0-9_-]+/i.test(normalized)
    || /\/kb(?:\s+|["']\s+)[a-z0-9_-]+/i.test(normalized)
  );
}

function extractCliToolCommand(rawInput: unknown): string | undefined {
  if (!rawInput || typeof rawInput !== 'object') {
    return undefined;
  }

  const record = rawInput as Record<string, unknown>;
  if (typeof record.command === 'string' && record.command.trim()) {
    return record.command.trim();
  }

  if (Array.isArray(record.args)) {
    const joined = record.args
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .join(' ')
      .trim();
    if (joined) {
      return joined;
    }
  }

  return undefined;
}

function extractSearchKbQueryFromCliCommand(command: string | undefined): string | undefined {
  const normalized = command?.trim();
  if (!normalized || !/\bsearch-kb\b/i.test(normalized)) {
    return undefined;
  }

  const match = normalized.match(/--query\s+("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s]+)/i);
  if (!match?.[1]) {
    return undefined;
  }
  const token = match[1].trim();
  const unwrapped =
    (token.startsWith('"') && token.endsWith('"'))
    || (token.startsWith('\'') && token.endsWith('\''))
      ? token.slice(1, -1)
      : token;
  return unwrapped.trim() || undefined;
}

function normalizePlannerSearchQuery(query: string | undefined): string | undefined {
  const normalized = query?.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized || undefined;
}

function isCliTerminalToolName(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'terminal' || normalized === 'shell';
}

function shouldDeferCliToolPolicyCheck(update: {
  sessionUpdate?: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
} | undefined): boolean {
  if (!update) {
    return false;
  }

  const command = extractCliToolCommand(update.rawInput);
  if (command) {
    return false;
  }

  const normalizedKind = update.kind?.trim().toLowerCase() ?? '';
  const normalizedStatus = update.status?.trim().toLowerCase() ?? '';
  const isPlaceholderTerminal =
    isCliTerminalToolName(update.title)
    || normalizedKind === 'terminal'
    || normalizedKind === 'execute'
    || normalizedKind === 'shell';

  if (!isPlaceholderTerminal) {
    return false;
  }

  return (
    update.sessionUpdate === 'tool_call'
    && (!normalizedStatus || normalizedStatus === 'pending')
  );
}

function normalizeAgentModelId(modelId?: string | null): string | undefined {
  const next = modelId?.trim();
  if (!next) {
    return undefined;
  }
  const withoutAnsi = next.replace(/\u001B\[[0-9;]*m/g, '').trim();
  const withoutMarkers = withoutAnsi.replace(/\s+\((?:current|default)[^)]+\)\s*$/i, '').trim();
  const normalized = withoutMarkers.split(/\s+-\s+/, 1)[0]?.trim() ?? withoutMarkers;
  return normalized || undefined;
}

function resolveProviderSessionMode(mode: KbAccessMode, sessionMode?: AgentSessionMode): AgentSessionMode {
  const normalizedMode = sessionMode ?? 'agent';
  if (mode === 'cli' && normalizedMode === 'plan') {
    return 'agent';
  }
  return normalizedMode;
}

type PromptStructuredResultContract = 'batch_planner';

const NON_CHAT_IDLE_SESSION_TTL_MS = 15 * 60 * 1_000;
const BATCH_PLANNER_MAX_TOOL_CALLS = 8;
const BATCH_PLANNER_JSON_STREAM_GRACE_MS = 1_500;
const BATCH_PLANNER_MALFORMED_JSON_ABORT_MS = 6_000;

function isMissingAcpSessionError(error: { message?: string; data?: unknown } | undefined): boolean {
  if (!error) {
    return false;
  }
  const message = typeof error.message === 'string' ? error.message : '';
  const details =
    error.data && typeof error.data === 'object' && typeof (error.data as { details?: unknown }).details === 'string'
      ? String((error.data as { details: string }).details)
      : '';
  const combined = `${message}\n${details}`.toLowerCase();
  return combined.includes('session') && combined.includes('not found');
}

function isRetriablePromptError(error: { message?: string; data?: unknown } | undefined): boolean {
  if (!error) {
    return false;
  }
  if (isMissingAcpSessionError(error)) {
    return true;
  }
  const message = typeof error.message === 'string' ? error.message.trim().toLowerCase() : '';
  return message === 'internal error';
}

function isCliToolPolicyViolationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().toLowerCase();
  return normalized.includes('cli mode forbids');
}

function looksLikeAssistantProgressText(value: string | undefined): boolean {
  const normalized = value?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '';
  if (!normalized) {
    return false;
  }

  return (
    /^(gathering|checking|looking|researching|reviewing|investigating|loading|searching|finding)\b/.test(normalized)
    || /^i(?:'m| am) (gathering|checking|looking|researching|reviewing|investigating|finding)\b/.test(normalized)
    || normalized.includes('returning only the structured json')
    || normalized.includes('return the final answer')
    || normalized.includes('using the cli and then returning')
    || normalized.includes('do not send a progress update')
    || normalized.includes('pulling the core')
  );
}

function looksLikeBatchProgressText(value: string | undefined): boolean {
  return looksLikeAssistantProgressText(value);
}

function normalizeAssistantCompletionState(value: unknown): AssistantCompletionState | undefined {
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

function looksLikeAssistantEnvelope(value: Record<string, unknown>): boolean {
  return (
    typeof value.response === 'string'
    || typeof value.command === 'string'
    || typeof value.artifactType === 'string'
    || typeof value.completionState === 'string'
    || typeof value.isFinal === 'boolean'
  );
}

function extractLastJsonObjectFromText(value: string | undefined): Record<string, unknown> | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const direct = JSON.parse(trimmed) as unknown;
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
      return direct as Record<string, unknown>;
    }
  } catch {
    // Fall through to substring extraction.
  }

  let best: Record<string, unknown> | null = null;
  for (let start = 0; start < trimmed.length; start += 1) {
    if (trimmed[start] !== '{') {
      continue;
    }
    for (let end = trimmed.lastIndexOf('}'); end > start; end = trimmed.lastIndexOf('}', end - 1)) {
      try {
        const candidate = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
          best = candidate as Record<string, unknown>;
          break;
        }
      } catch {
        // continue searching
      }
    }
  }

  return best;
}

function extractPreferredAssistantEnvelope(value: unknown): Record<string, unknown> | null {
  const directObject =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  if (directObject && looksLikeAssistantEnvelope(directObject)) {
    return directObject;
  }

  const candidates: string[] = [];
  if (directObject) {
    if (typeof directObject.streamedText === 'string') {
      candidates.push(directObject.streamedText);
    }
    const explicitText = extractPromptResultText(directObject);
    if (explicitText) {
      candidates.push(explicitText);
    }
  } else if (typeof value === 'string') {
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

function extractAssistantCompletionContract(
  value: unknown
): { completionState?: AssistantCompletionState; isFinal?: boolean } {
  const candidates: Array<Record<string, unknown>> = [];
  const preferred = extractPreferredAssistantEnvelope(value);
  if (preferred) {
    candidates.push(preferred);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    candidates.push(value as Record<string, unknown>);
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

function getSessionUpdateType(params: unknown): string | null {
  if (!params || typeof params !== 'object') {
    return null;
  }
  const update = (params as { update?: { sessionUpdate?: unknown } }).update;
  return typeof update?.sessionUpdate === 'string' ? update.sessionUpdate : null;
}

function isHiddenAgentThoughtUpdate(params: unknown): boolean {
  return getSessionUpdateType(params) === 'agent_thought_chunk';
}

class NonRetriableRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetriableRuntimeError';
  }
}

interface SessionModelInfo {
  modelId: string | undefined;
  name: string | undefined;
}

interface SessionModelStatePayload {
  currentModelId?: string;
  availableModels?: SessionModelInfo[];
}

function parseSessionModelState(value: unknown): SessionModelStatePayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as {
    currentModelId?: unknown;
    availableModels?: unknown;
  };

  const currentModelId = typeof candidate.currentModelId === 'string'
    ? candidate.currentModelId.trim()
    : undefined;
  const availableModels = Array.isArray(candidate.availableModels)
    ? candidate.availableModels
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }
          const modelIdValue = (entry as { modelId?: unknown }).modelId;
          const nameValue = (entry as { name?: unknown }).name;
          const modelId = typeof modelIdValue === 'string' ? modelIdValue.trim() : undefined;
          const name = typeof nameValue === 'string' ? nameValue.trim() : undefined;
          if (!modelId && !name) {
            return null;
          }
          return { modelId, name };
        })
        .filter((entry): entry is SessionModelInfo => entry !== null)
    : undefined;

  if (!currentModelId && !availableModels?.length) {
    return null;
  }

  return {
    currentModelId,
    availableModels
  };
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

interface CommandCaptureResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface AcpSessionState {
  createdAtMs: number;
  ready: boolean;
  waiters: Set<(ready: boolean) => void>;
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
  getWorkspaceAgentModel?: (workspaceId: string) => Promise<string | undefined>;
  prepareCliEnvironment?: (workspaceId?: string) => Promise<void>;
}

interface KbAccessProvider {
  mode: KbAccessMode;
  provider: 'mcp' | 'cli';
  terminalEnabled: boolean;
  buildSessionCreateParams: (sessionMode?: AgentSessionMode) => {
    cwd: string;
    mcpServers?: AcpMcpServerConfig[];
    config: { mode: AgentSessionMode };
  };
  getPromptTaskBuilder: (
    session: AgentSessionRecord,
    taskPayload: Record<string, unknown>,
    extras?: { batchContext?: unknown; uploadedPbis?: unknown; articleDirectory?: string }
  ) => string;
  getHealth: (workspaceId?: string) => Promise<KbAccessHealth>;
}

function buildBatchAnalysisPhaseGuidance(providerLabel: 'MCP' | 'CLI'): string {
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
      'Your job:',
      '- Answer the user\'s actual request.',
      '- When workspace knowledge is needed, use the minimum KB lookups required to answer accurately.',
      '- For feature, workflow, or terminology questions about the app, default to this sequence: `search-kb` for the topic, `get-article` for the best 1-3 hits, then answer clearly in plain English.',
      '',
      'Tool rules:',
      '- Use KB Vault tools and structured article/template data only when they help answer the user.',
      '- Do NOT use terminal, grep, codebase search, find, or filesystem exploration unless explicitly requested.',
      '- Do NOT use shell or terminal for anything except running `kb` commands.',
      '- Do not use tools just to discover what tools exist or to explore the environment.',
      '- Do not use `batch-context`, `find-related-articles`, proposal commands, or form-editing commands unless the current route or user request clearly requires them.',
      '- Do not use `kb help` unless a needed KB command is genuinely unclear and you cannot proceed with `search-kb` plus `get-article`.',
      '- The preloaded prompt context is for orientation; use KB Vault MCP tools directly when you need to confirm or inspect source records.',
      '- Return only valid JSON in your final answer.',
      '- Do not include preamble, commentary about your reasoning, or markdown fences.',
      '- For informational chat, return only `artifactType` and `response`. Omit `summary`, `html`, `formPatch`, and `payload` unless they are needed.',
      '- Only return `proposal_candidate` when the user explicitly asks you to make or propose changes.',
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
      '- If the runtime exposes direct KB tools such as `search-kb` and `get-article`, prefer those over Shell or Terminal.',
      '- If the runtime only exposes Shell or Terminal, you may use it only for exact `kb` CLI commands. Generic terminal usage will be blocked.',
      '- Default research workflow for app-feature questions: use `search-kb`, then `get-article` for the best 1-3 hits, then answer.',
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
      '- If direct KB tools are available, prefer those. If the runtime only exposes Shell or Terminal, it may be used only for exact `kb` CLI commands.',
      '- Do not use tools just to figure out what you should do next.',
      '- Avoid `batch-context`, `find-related-articles`, proposal commands, and form-editing commands unless the route or user request clearly requires them.',
      '- Do not call `kb help` unless command syntax is genuinely blocking progress.',
      '- Do not include preamble, commentary about your reasoning, or markdown fences.',
      '- Follow the output contract in the additional instructions below exactly.',
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
const CLI_PLANNER_ZERO_RESULT_SEARCH_LIMIT = 4;
const CLI_PLANNER_LOW_DIVERSITY_ZERO_RESULT_QUERY_LIMIT = 2;

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
  private stderrBuffer = '';

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
        const text = chunk.toString('utf8');
        this.stderrBuffer += text;
        this.logger('system', { direction: 'from_agent', event: 'stderr', payload: text });
      });
      proc.on('error', (error: Error) => {
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

  async stop(): Promise<void> {
    if (!this.proc) {
      return;
    }
    this.proc.kill();
    this.proc = null;
    this.connected = false;
    this.initialized = false;
    this.stderrBuffer = '';
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

  resolvePromptSession(sessionId: string, result: Record<string, unknown>): boolean {
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
    try {
      const auth = await this.request('authenticate', { methodId: 'cursor_login' }, timeoutMs);
      if (auth.error) {
        this.logger('system', {
          direction: 'system',
          event: 'auth_optional_skipped',
          payload: JSON.stringify(auth.error)
        });
      }
    } catch (error) {
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
      if (!isHiddenAgentThoughtUpdate(message.params)) {
        this.logger('system', { direction: 'from_agent', event: 'session_update', payload: JSON.stringify(message.params) });
      }
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

async function captureCommandOutput(
  binary: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<CommandCaptureResult> {
  return await new Promise<CommandCaptureResult>((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn: () => void) => {
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

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
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
  private readonly transports = new Map<string, CursorTransport>();
  private readonly acpSessionStates = new Map<string, AcpSessionState>();
  private readonly cursorSessionIds = new Map<string, {
    mode: KbAccessMode;
    sessionMode: AgentSessionMode;
    acpSessionId: string;
    transportKey: string;
  }>();
  private readonly cursorSessionLookup = new Map<string, { localSessionId: string; mode: KbAccessMode }>();
  private readonly activeStreamEmitters = new Map<string, (payload: Omit<AgentStreamingPayload, 'sessionId' | 'atUtc'>) => Promise<void> | void>();
  private readonly promptMessageChunks = new Map<string, PromptMessageBuffer>();
  private readonly promptCompletionTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingPromptFallbacks = new Map<string, { transport: CursorTransport; acpSessionId: string }>();
  private readonly pendingSessionOperations = new Map<string, Set<Promise<unknown>>>();
  private readonly sessionOperationTails = new Map<string, Promise<void>>();
  private readonly sessionActivityAt = new Map<string, number>();
  private readonly promptTransportActivityAt = new Map<string, number>();
  private readonly transcriptLineSequences = new Map<string, number>();
  private readonly auditedCliToolCallIds = new Map<string, Set<string>>();
  private readonly activePromptStates = new Map<string, {
    task: string;
    role?: string;
    workspaceId: string;
    transport: CursorTransport;
    acpSessionId: string;
    contract?: PromptStructuredResultContract;
    activeToolCalls: Set<string>;
    toolCallCount: number;
    chunkCount: number;
    jsonStartedAtMs?: number;
    firstCompleteJsonAtMs?: number;
    remotelyStopped: boolean;
  }>();
  private readonly cliPlannerLoopState = new Map<string, {
    searchKbCalls: number;
    consecutiveZeroResultSearches: number;
    zeroResultQueries: Set<string>;
    duplicateZeroResultQueries: number;
    aborted: boolean;
  }>();
  private readonly workspaceAgentModels = new Map<string, string | undefined>();
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
      cursorArgs: resolveCursorArgs(cursorBinary),
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

  private async ensureWorkspaceAgentModelLoaded(workspaceId: string): Promise<string | undefined> {
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

  private getWorkspaceAgentModel(workspaceId?: string): string | undefined {
    if (!workspaceId) {
      return undefined;
    }
    return normalizeAgentModelId(this.workspaceAgentModels.get(workspaceId));
  }

  async setWorkspaceAgentModel(workspaceId: string, agentModelId?: string): Promise<void> {
    const normalized = normalizeAgentModelId(agentModelId);
    const current = this.getWorkspaceAgentModel(workspaceId);
    this.workspaceAgentModels.set(workspaceId, normalized);
    if (current !== normalized) {
      await this.restartWorkspaceAcpConnections(workspaceId);
    }
  }

  async getRuntimeOptions(workspaceId: string): Promise<AgentRuntimeOptionsResponse> {
    const currentModelId = await this.ensureWorkspaceAgentModelLoaded(workspaceId);
    const binary = this.resolveBinary('mcp');
    const commandSets = path.basename(binary).toLowerCase().replace(/\.exe$/, '') === 'agent'
      ? [['--list-models'], ['models']]
      : [
          [DEFAULT_AGENT_BINARY, '--list-models'],
          [DEFAULT_AGENT_BINARY, 'models'],
          ['agent', '--list-models'],
          ['agent', 'models']
        ];

    let lastError: Error | undefined;
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
      } catch (error) {
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

  private async probeRuntimeOptionsThroughAcp(workspaceId: string): Promise<AgentRuntimeOptionsResponse> {
    await this.ensureWorkspaceAgentModelLoaded(workspaceId);
    const provider = this.getProvider('mcp');
    const transport = this.getTransport('mcp', workspaceId);
    const initialized = await transport.ensureInitialized(this.config.requestTimeoutMs);
    if (!initialized) {
      throw new Error('Cursor ACP initialize failed');
    }

    const response = await transport.request(
      'session/new',
      provider.buildSessionCreateParams(),
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
    } | undefined;

    if (result?.sessionId) {
      try {
        await transport.request(
          'session/close',
          { sessionId: result.sessionId },
          this.config.requestTimeoutMs,
          `runtime-options:${workspaceId}`
        );
      } catch {
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

  private parseAvailableModels(output: string): string[] {
    const trimmed = output.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '').trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean);
      }
      if (parsed && typeof parsed === 'object') {
        const models = (parsed as { models?: unknown }).models;
        if (Array.isArray(models)) {
          return models
            .map((value) => (typeof value === 'string' ? value : (value && typeof value === 'object' && 'id' in value ? String((value as { id?: unknown }).id ?? '') : '')))
            .map((value) => value.trim())
            .filter(Boolean);
        }
      }
    } catch {
      // fall through to plain text parsing
    }

    return Array.from(
      new Set(
        trimmed
          .split('\n')
          .map((line) => line.trim())
          .map((line) => line.replace(/\s+\((?:current|default)[^)]+\)\s*$/i, '').trim())
          .map((line) => line.replace(/^[*\-]\s*/, '').replace(/^\d+\.\s*/, ''))
          .map((line) => line.split(/\s+-\s+/, 1)[0]?.trim() ?? '')
          .filter((line) => line && !/^(available models|loading models…|loading models\.{3}|tip:)/i.test(line))
      )
    );
  }

  private buildTransportKey(mode: KbAccessMode, workspaceId?: string): string {
    return [workspaceId ?? 'global', mode, this.getWorkspaceAgentModel(workspaceId) ?? 'default'].join('::');
  }

  private async restartWorkspaceAcpConnections(workspaceId: string): Promise<void> {
    await Promise.all(
      Array.from(this.sessions.values())
        .filter((session) => session.workspaceId === workspaceId)
        .map((session) => this.resetCursorSession(session.id))
    );

    const prefix = `${workspaceId}::`;
    const matchingEntries = Array.from(this.transports.entries()).filter(([key]) => key.startsWith(prefix));
    await Promise.all(matchingEntries.map(async ([key, transport]) => {
      await transport.stop();
      this.transports.delete(key);
    }));
  }

  private markSessionActivity(sessionId: string): void {
    this.sessionActivityAt.set(sessionId, Date.now());
  }

  private markPromptTransportActivity(sessionId: string): void {
    this.promptTransportActivityAt.set(sessionId, Date.now());
    this.markSessionActivity(sessionId);
  }

  private getPromptStructuredResultContract(session: AgentSessionRecord, taskPayload: Record<string, unknown>): PromptStructuredResultContract | undefined {
    if (taskPayload.task === 'analyze_batch' && session.type === 'batch_analysis' && session.role === 'planner' && session.mode === 'plan') {
      return 'batch_planner';
    }
    return undefined;
  }

  private async pruneIdleNonChatSessions(
    workspaceId: string,
    options: {
      keepSessionId?: string;
      activeBatchId?: string;
    } = {}
  ): Promise<void> {
    const now = Date.now();
    const candidates = Array.from(this.sessions.values()).filter((session) => {
      if (session.workspaceId !== workspaceId || session.id === options.keepSessionId) {
        return false;
      }
      if (session.type === 'assistant_chat' || session.status === 'running' || session.status === 'closed') {
        return false;
      }
      if (
        options.activeBatchId
        && session.type === 'batch_analysis'
        && session.batchId
        && session.batchId !== options.activeBatchId
      ) {
        return true;
      }
      const updatedAtMs = Date.parse(session.updatedAtUtc);
      return Number.isFinite(updatedAtMs) && now - updatedAtMs >= NON_CHAT_IDLE_SESSION_TTL_MS;
    });

    for (const session of candidates) {
      this.closeSession({ workspaceId, sessionId: session.id });
    }
  }

  private async stopActivePrompt(
    localSessionId: string,
    acpSessionId: string,
    transport: CursorTransport,
    reason: string
  ): Promise<void> {
    const state = this.activePromptStates.get(localSessionId);
    if (state?.remotelyStopped) {
      return;
    }
    if (state) {
      state.remotelyStopped = true;
    }
    transport.abortPromptSession(acpSessionId, reason);
    await this.trackSessionOperation(
      localSessionId,
      this.appendTranscriptLine(
        localSessionId,
        'system',
        'prompt_abort',
        JSON.stringify({ reason, acpSessionId })
      )
    );
  }

  private maybeResolveStructuredPromptFromStream(localSessionId: string): void {
    const state = this.activePromptStates.get(localSessionId);
    if (!state || !state.contract) {
      return;
    }
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

    if (
      state.firstCompleteJsonAtMs !== undefined
      && state.activeToolCalls.size === 0
      && now - state.firstCompleteJsonAtMs >= BATCH_PLANNER_JSON_STREAM_GRACE_MS
    ) {
      const resolved = state.transport.resolvePromptSession(state.acpSessionId, {
        text: assembledText,
        content: [{ type: 'text', text: assembledText }]
      });
      if (resolved) {
        void this.stopActivePrompt(
          localSessionId,
          state.acpSessionId,
          state.transport,
          'Structured planner JSON was captured from the stream; stopping the remote prompt to avoid extra token usage.'
        );
        this.clearPromptCompletionTimer(localSessionId);
      }
      return;
    }

    const malformedJsonWindowExceeded =
      state.jsonStartedAtMs !== undefined
      && state.firstCompleteJsonAtMs === undefined
      && state.activeToolCalls.size === 0
      && idleForMs >= BATCH_PLANNER_MALFORMED_JSON_ABORT_MS;
    if (malformedJsonWindowExceeded) {
      void this.stopActivePrompt(
        localSessionId,
        state.acpSessionId,
        state.transport,
        `Planner entered structured JSON output but did not stabilize into a valid JSON plan after ${state.chunkCount} streamed chunks and ${idleForMs}ms of inactivity. Stop and recover locally.`
      );
    }
  }

  private trackSessionOperation<T>(sessionId: string, operation: Promise<T>): Promise<T> {
    const pending = this.pendingSessionOperations.get(sessionId) ?? new Set<Promise<unknown>>();
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

  private queueSessionOperation<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.sessionOperationTails.get(sessionId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(task);
    let tail: Promise<void>;
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

  private async waitForSessionToSettle(sessionId: string, idleMs = 350, maxWaitMs = 5000, minWaitMs = 0): Promise<void> {
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

  closeSession(input: AgentSessionCloseRequest): AgentSessionRecord | null {
    const session = this.sessions.get(input.sessionId);
    if (!session || session.workspaceId !== input.workspaceId) {
      return null;
    }
    session.status = 'closed';
    session.updatedAtUtc = new Date().toISOString();
    void this.resetCursorSession(session.id);
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
    const providerSessionMode = resolveProviderSessionMode(mode, session.mode);
    if (mode === 'cli') {
      await this.runtimeOptions.prepareCliEnvironment?.(session.workspaceId);
    }
    await this.ensureWorkspaceAgentModelLoaded(session.workspaceId);
    const agentModelId = this.getWorkspaceAgentModel(session.workspaceId);
    const transportKey = this.buildTransportKey(mode, session.workspaceId);
    const existing = this.cursorSessionIds.get(session.id);
    if (
      existing?.mode === mode
      && existing.transportKey === transportKey
      && existing.sessionMode === providerSessionMode
    ) {
      return existing.acpSessionId;
    }
    if (
      existing
      && (existing.mode !== mode || existing.transportKey !== transportKey || existing.sessionMode !== providerSessionMode)
    ) {
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
    const response = await transport.request(
      'session/new',
      provider.buildSessionCreateParams(session.mode),
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
    const result = response.result as { sessionId?: string; models?: unknown } | undefined;
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
      const setModelResponse = await transport.request(
        'session/set_model',
        {
          sessionId: result.sessionId,
          modelId: normalizedRequestedModelId
        },
        this.config.requestTimeoutMs,
        session.id
      );
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
          await transport.request(
            'session/close',
            { sessionId: result.sessionId },
            this.config.requestTimeoutMs,
            session.id
          );
        } catch {
          // Best effort close for a session that failed model selection.
        }
        throw new NonRetriableRuntimeError(
          `Cursor ACP rejected selected model "${normalizedRequestedModelId}": ${setModelResponse.error.message}`
        );
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

  private markAcpSessionReady(acpSessionId: string | undefined): void {
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

  private clearAcpSessionState(acpSessionId: string | undefined): void {
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

  private async waitForAcpSessionReady(acpSessionId: string, timeoutMs: number): Promise<boolean> {
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

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ready: boolean) => {
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

  async handleMcpJsonMessage(raw: string | Record<string, unknown>): Promise<string | null> {
    return this.mcpServer.handleJsonMessage(raw);
  }

  async runBatchAnalysis(
    request: AgentAnalysisRunRequest,
    emit: (payload: AgentStreamingPayload) => Promise<void> | void,
    isCancelled: () => boolean
  ): Promise<AgentRunResult> {
    const session = await this.resolveSession(request);
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const runId = randomUUID();
    const transcriptPath = await this.ensureTranscriptPath(session.id, runId);
    const toolCalls: AgentRunResult['toolCalls'] = [];
    const rawOutput: string[] = [];
    const timeoutMs = Math.max(request.timeoutMs ?? this.config.requestTimeoutMs, 120_000);
    this.markSessionActivity(session.id);
    this.log('agent.runtime.batch_analysis_begin', {
      workspaceId: request.workspaceId,
      batchId: request.batchId,
      locale: request.locale,
      timeoutMs
    });

    try {
      const initialResultPayload = await this.transit(
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
        timeoutMs
      );
      const settleWindow = getBatchAnalysisPromptSettleWindow(
        initialResultPayload,
        assemblePromptMessageText(this.promptMessageChunks.get(session.id)).trim()
      );
      const remainingWaitMs = Math.max(0, timeoutMs - (Date.now() - startedAtMs));
      await this.waitForSessionToSettle(
        session.id,
        settleWindow.idleMs,
        Math.min(settleWindow.maxWaitMs, remainingWaitMs),
        Math.min(settleWindow.minWaitMs, remainingWaitMs)
      );
      const resultPayload = this.finalizePromptResult(session.id, initialResultPayload);
      const finalText = extractPromptResultText(resultPayload);
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
      } as AgentRunResultWithAcpSession;
    } catch (error) {
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
      } as AgentRunResultWithAcpSession;
    } finally {
      this.cleanupPromptState(session.id);
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
      const resultPayload = await this.transit(
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
      const acpSessionId = this.cursorSessionIds.get(session.id)?.acpSessionId;
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
        durationMs: Date.parse(endedAt) - Date.parse(startedAt),
        message: isCancelled() ? 'Run cancelled' : 'Completed'
      } as AgentRunResultWithAcpSession;
    } catch (error) {
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
        durationMs: Date.parse(endedAt) - Date.parse(startedAt),
        message: error instanceof Error ? error.message : String(error)
      } as AgentRunResultWithAcpSession;
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

  async runAssistantChat(
    request: AgentAssistantChatRunRequest,
    emit: (payload: AgentStreamingPayload) => Promise<void> | void,
    isCancelled: () => boolean
  ): Promise<AgentRunResult> {
    const session = await this.resolveSession({ ...request, sessionType: 'assistant_chat' });
    const startedAtMs = Date.now();
    const startedAt = new Date().toISOString();
    const runId = randomUUID();
    const transcriptPath = await this.ensureTranscriptPath(session.id, runId);
    const toolCalls: AgentRunResult['toolCalls'] = [];
    const rawOutput: string[] = [];
    const timeoutMs = request.timeoutMs ?? this.config.requestTimeoutMs;
    this.log('agent.runtime.assistant_chat_begin', {
      workspaceId: request.workspaceId,
      localeVariantId: request.localeVariantId,
      timeoutMs
    });

    try {
      let resultPayload: unknown = undefined;
      let completionState: AssistantCompletionState | undefined = undefined;
      let isFinal: boolean | undefined = undefined;
      let attempt = 0;
      let autoContinueCount = 0;
      let nextPrompt = request.prompt;
      const promptSeed = stripAssistantChatContinuation(request.prompt);

      while (true) {
        let initialResultPayload: unknown;
        try {
          initialResultPayload = await this.transit(
            session,
            {
              task: 'assistant_chat',
              localeVariantId: request.localeVariantId,
              prompt: nextPrompt,
              locale: request.locale
            },
            (event) => {
              rawOutput.push(event.message ?? JSON.stringify(event.data ?? {}));
              emit({ sessionId: session.id, kind: event.kind, data: event.data, message: event.message, atUtc: new Date().toISOString() });
            },
            toolCalls,
            isCancelled,
            timeoutMs
          );
        } catch (error) {
          const remainingWaitMs = Math.max(0, timeoutMs - (Date.now() - startedAtMs));
          const canRecoverFromToolPolicy =
            !isCancelled()
            && attempt < ASSISTANT_CHAT_RECOVERY_RETRY_LIMIT
            && remainingWaitMs >= 1_000
            && isCliToolPolicyViolationError(error);
          if (!canRecoverFromToolPolicy) {
            throw error;
          }

          attempt += 1;
          const policyError = error instanceof Error ? error.message : String(error);
          nextPrompt = buildAssistantChatContinuationPrompt(
            promptSeed || nextPrompt,
            buildAssistantChatKbOnlyRecoveryPrompt(policyError)
          );
          rawOutput.push(`[assistant-chat kb-only recovery ${attempt}] ${policyError}`);
          this.log('agent.runtime.assistant_chat_kb_only_retry', {
            workspaceId: request.workspaceId,
            sessionId: session.id,
            attempt,
            reason: policyError
          });
          continue;
        }
        const settleWindow = ASSISTANT_CHAT_PROMPT_SETTLE_WINDOW;
        await this.waitForSessionToSettle(
          session.id,
          settleWindow.idleMs,
          settleWindow.maxWaitMs,
          settleWindow.minWaitMs
        );
        resultPayload = this.finalizePromptResult(session.id, initialResultPayload);
        const completion = extractAssistantCompletionContract(resultPayload);
        completionState = completion.completionState;
        isFinal = completion.isFinal;

        const resultText = extractPromptResultText(resultPayload);
        const remainingWaitMs = Math.max(0, timeoutMs - (Date.now() - startedAtMs));
        const canAutoContinue =
          !isCancelled()
          && autoContinueCount < ASSISTANT_CHAT_AUTO_CONTINUE_LIMIT
          && remainingWaitMs >= 5_000
          && (
            isFinal === false
            || completionState === 'researching'
            || (
              completionState === undefined
              && looksLikeAssistantProgressText(resultText)
            )
          );
        if (canAutoContinue) {
          autoContinueCount += 1;
          nextPrompt = buildAssistantChatContinuationPrompt(
            promptSeed || nextPrompt,
            ASSISTANT_CHAT_CONTINUE_PROMPT
          );
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
      } as AgentRunResultWithAcpSession;
    } catch (error) {
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
      } as AgentRunResultWithAcpSession;
    } finally {
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

  listToolCallAudit(sessionId: string, workspaceId: string) {
    return this.toolCallAudit.filter((audit) => audit.sessionId === sessionId && audit.workspaceId === workspaceId);
  }

  private populateRunToolCalls(
    target: AgentRunResult['toolCalls'],
    sessionId: string,
    workspaceId: string
  ): AgentRunResult['toolCalls'] {
    const recorded = this.listToolCallAudit(sessionId, workspaceId);
    const fallback = recorded.length > 0 ? recorded : this.extractToolCallAuditFromTranscript(sessionId, workspaceId);
    target.splice(0, target.length, ...fallback);
    return target;
  }

  private extractToolCallAuditFromTranscript(
    sessionId: string,
    workspaceId: string
  ): AgentRunResult['toolCalls'] {
    const transcriptPath = this.transcripts.get(sessionId);
    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      return [];
    }

    try {
      const contents = fs.readFileSync(transcriptPath, 'utf8');
      const seenToolCallIds = new Set<string>();
      const recovered: AgentRunResult['toolCalls'] = [];

      const transcriptLines = sortTranscriptLines(
        contents
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
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
          })
      );

      for (const parsedLine of transcriptLines) {
        if (!parsedLine || parsedLine.event !== 'session_update' || parsedLine.direction !== 'from_agent') {
          continue;
        }

        let payload: {
          update?: {
            sessionUpdate?: string;
            toolCallId?: string;
            title?: string;
            kind?: string;
            status?: string;
            rawInput?: unknown;
          };
        } | null = null;
        try {
          payload = JSON.parse(parsedLine.payload) as {
            update?: {
              sessionUpdate?: string;
              toolCallId?: string;
              title?: string;
              kind?: string;
              status?: string;
              rawInput?: unknown;
            };
          };
        } catch {
          payload = null;
        }
        const update = payload?.update;
        if (!update || typeof update.toolCallId !== 'string' || seenToolCallIds.has(update.toolCallId)) {
          continue;
        }

        const cliAuditLabel =
          typeof update.title === 'string' && update.title.trim()
            ? update.title
            : extractCliToolCommand(update.rawInput);
        if (!cliAuditLabel || shouldDeferCliToolPolicyCheck(update)) {
          continue;
        }

        seenToolCallIds.add(update.toolCallId);
        const policy = this.evaluateCliToolPolicy(cliAuditLabel, update.kind, update.rawInput);
        const auditedToolName =
          extractKbCliCommandName(cliAuditLabel)
          ?? extractKbCliCommandName(extractCliToolCommand(update.rawInput))
          ?? cliAuditLabel;
        recovered.push({
          workspaceId,
          sessionId,
          toolName: auditedToolName,
          args: update.rawInput ?? { kind: update.kind },
          calledAtUtc: parsedLine.atUtc,
          allowed: policy.allowed,
          reason: policy.reason
        });
      }

      return recovered;
    } catch {
      return [];
    }
  }

  async stop(): Promise<void> {
    await Promise.all(Array.from(this.transports.values()).map((transport) => transport.stop()));
  }

  private findReusableBatchAnalysisSession(input: AgentAnalysisRunRequest): AgentSessionRecord | null {
    return Array.from(this.sessions.values())
      .filter((session) =>
        session.workspaceId === input.workspaceId
        && session.type === 'batch_analysis'
        && session.batchId === input.batchId
        && session.status !== 'closed'
      )
      .sort((left, right) => right.updatedAtUtc.localeCompare(left.updatedAtUtc))[0] ?? null;
  }

  private async resolveSession(input: AgentRunRequestWithReusePolicy): Promise<AgentSessionRecord> {
    const sessionType = input.sessionType ?? ('localeVariantId' in input ? 'article_edit' : 'batch_analysis');
    const requestedMode = input.sessionMode ?? (input.sessionType === 'assistant_chat' ? 'ask' : 'agent');
    const sessionReusePolicy = input.sessionReusePolicy ?? 'reuse';
    if (input.workspaceId && sessionType !== 'assistant_chat') {
      await this.pruneIdleNonChatSessions(input.workspaceId, {
        keepSessionId: input.sessionId,
        activeBatchId: 'batchId' in input ? input.batchId : undefined
      });
    }
    const existing =
      sessionReusePolicy === 'new_local_session'
        ? null
        : input.sessionId
          ? this.getSession(input.sessionId)
          : ('batchId' in input && sessionType === 'batch_analysis' ? this.findReusableBatchAnalysisSession(input) : null);
    let session = existing;
    if (!session) {
      if (!input.workspaceId) {
        throw new Error('workspaceId is required');
      }
      const createRequest: AgentSessionCreateRequest = {
        workspaceId: input.workspaceId,
        kbAccessMode: input.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE,
        type: sessionType,
        mode: requestedMode,
        role: input.agentRole,
        batchId: 'batchId' in input ? input.batchId : undefined,
        locale: input.locale,
        templatePackId: 'templatePackId' in input ? input.templatePackId : undefined,
        scope:
          'localeVariantScope' in input && input.localeVariantScope ? { localeVariantIds: input.localeVariantScope } : undefined
      };
      session = this.createSession(createRequest);
    } else {
      let needsReset = sessionReusePolicy === 'reset_acp';
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

  private async transit(
    session: AgentSessionRecord,
    taskPayload: Record<string, unknown>,
    emit: (payload: Omit<AgentStreamingPayload, 'sessionId' | 'atUtc'>) => void,
    toolCalls: AgentRunResult['toolCalls'],
    isCancelled: () => boolean,
    timeoutMs: number
  ): Promise<unknown> {
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
      await this.trackSessionOperation(
        session.id,
        this.appendTranscriptLine(
          session.id,
          'system',
          'runtime_mode',
          JSON.stringify({
            kbAccessMode: mode,
            provider: provider.provider,
            requestedSessionMode: session.mode,
            providerSessionMode,
            terminalEnabled: provider.terminalEnabled,
            agentModelId: this.getWorkspaceAgentModel(session.workspaceId) ?? 'default'
          })
        )
      );
      await this.trackSessionOperation(
        session.id,
        Promise.resolve(emit({ kind: 'session_started', data: { ...requestEnvelope, kbAccessMode: mode }, message: 'Session started' }))
      );
      const promptText = await this.buildPromptText(session, taskPayload);

      const context: ScopedToolContext = {
        workspaceId: session.workspaceId,
        allowedLocaleVariantIds: session.scope?.localeVariantIds,
        allowedFamilyIds: session.scope?.familyIds
      };

      const transcriptPath = this.transcripts.get(session.id) ?? '';
      const { transport, acpSessionId } = await this.executeWithRetry(
        async () => {
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
        },
        3,
        isCancelled
      ) as { transport: CursorTransport; acpSessionId: string };
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
        activeToolCalls: new Set<string>(),
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
      let response = await transport.request(
        'session/prompt',
        requestPayload,
        timeoutMs,
        session.id
      );
      while (response.error && retryCount < 2 && isRetriablePromptError(response.error)) {
        const missingSession = isMissingAcpSessionError(response.error);
        if (missingSession && sameSessionRetryCount < ACP_SESSION_NOT_FOUND_RETRY_LIMIT) {
          sameSessionRetryCount += 1;
          const ready = await this.waitForAcpSessionReady(
            currentAcpSessionId,
            Math.min(ACP_SESSION_READY_WAIT_MS, Math.max(250, Math.floor(timeoutMs / 4)))
          );
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
          response = await transport.request(
            'session/prompt',
            requestPayload,
            timeoutMs,
            session.id
          );
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
        response = await transport.request(
          'session/prompt',
          requestPayload,
          timeoutMs,
          session.id
        );
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
        ? { ...(response.result as Record<string, unknown>) }
        : {};

      await this.trackSessionOperation(
        session.id,
        Promise.resolve(emit({ kind: 'result', data: response, message: 'Run complete' }))
      );
      return result;
    } finally {
      this.clearPromptCompletionTimer(session.id);
      this.pendingPromptFallbacks.delete(session.id);
    }
  }

  private async buildPromptText(session: AgentSessionRecord, taskPayload: Record<string, unknown>): Promise<string> {
    const provider = this.getProvider(session.kbAccessMode ?? DEFAULT_AGENT_ACCESS_MODE);
    if (taskPayload.task !== 'analyze_batch') {
      return provider.getPromptTaskBuilder(session, taskPayload);
    }
    return provider.getPromptTaskBuilder(session, taskPayload);
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
    this.markPromptTransportActivity(localSessionId);
    this.markAcpSessionReady(params.sessionId);
    await this.queueSessionOperation(localSessionId, async () => {
      const promptState = this.activePromptStates.get(localSessionId);
      const updateRecord = params.update && typeof params.update === 'object'
        ? params.update as Record<string, unknown>
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
        } else if (
          params.update.sessionUpdate === 'tool_call_update'
          && (normalizedStatus === 'completed' || normalizedStatus === 'failed' || normalizedStatus === 'cancelled')
        ) {
          promptState.activeToolCalls.delete(toolCallId);
        }
        if (
          promptState.contract === 'batch_planner'
          && promptState.toolCallCount > BATCH_PLANNER_MAX_TOOL_CALLS
        ) {
          void this.stopActivePrompt(
            localSessionId,
            promptState.acpSessionId,
            promptState.transport,
            `Planner exceeded the tool-call budget (${promptState.toolCallCount} > ${BATCH_PLANNER_MAX_TOOL_CALLS}). Reuse the evidence already gathered and recover the plan from the current transcript.`
          );
        }
      }
      this.markSessionActivity(localSessionId);

      const payload = JSON.stringify(message.params);
      if (!isHiddenAgentThoughtUpdate(message.params)) {
        await this.appendTranscriptLine(localSessionId, 'from_agent', 'session_update', payload);
      }

      // Audit and enforce CLI-mode tool calls from ACP session updates so they appear in tool call history
      const cliAuditLabel =
        typeof params.update?.title === 'string' && params.update.title.trim()
          ? params.update.title
          : extractCliToolCommand(params.update?.rawInput);
      if (sessionInfo.mode === 'cli' && params.update?.toolCallId && cliAuditLabel) {
        const session = this.sessions.get(localSessionId);
        const acpToolCallKey = `${params.sessionId ?? 'unknown'}:${params.update.toolCallId}`;
        const recordedToolCallIds = this.auditedCliToolCallIds.get(localSessionId) ?? new Set<string>();
        if (session && !shouldDeferCliToolPolicyCheck(params.update) && !recordedToolCallIds.has(acpToolCallKey)) {
          recordedToolCallIds.add(acpToolCallKey);
          this.auditedCliToolCallIds.set(localSessionId, recordedToolCallIds);
          const policy = this.evaluateCliToolPolicy(cliAuditLabel, params.update.kind, params.update.rawInput);
          const auditedToolName =
            extractKbCliCommandName(cliAuditLabel)
            ?? extractKbCliCommandName(extractCliToolCommand(params.update.rawInput))
            ?? cliAuditLabel;
          this.toolCallAudit.push({
            workspaceId: session.workspaceId,
            sessionId: localSessionId,
            toolName: auditedToolName,
            args: params.update.rawInput ?? { kind: params.update.kind },
            calledAtUtc: new Date().toISOString(),
            allowed: policy.allowed,
            reason: policy.reason
          });
          if (!policy.allowed && typeof params.sessionId === 'string') {
            const violationReason = `CLI mode blocked illegal tool call "${auditedToolName}": ${policy.reason}`;
            this.log('agent.runtime.cli_tool_policy_violation', {
              sessionId: localSessionId,
              acpSessionId: params.sessionId,
              toolName: params.update.title,
              kind: params.update.kind,
              reason: violationReason
            });
            await this.appendTranscriptLine(
              localSessionId,
              'system',
              'cli_tool_policy_violation',
              JSON.stringify({
                toolName: cliAuditLabel,
                kind: params.update.kind,
                reason: violationReason
              })
            );
            const workspaceId = this.sessions.get(localSessionId)?.workspaceId;
            this.getTransport('cli', workspaceId).abortPromptSession(params.sessionId, violationReason);
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

  private consumePromptMessageText(sessionId: string): string {
    const chunks = this.promptMessageChunks.get(sessionId);
    this.promptMessageChunks.delete(sessionId);
    return assemblePromptMessageText(chunks);
  }

  private finalizePromptResult(sessionId: string, result: unknown): unknown {
    const finalized =
      result && typeof result === 'object'
        ? { ...(result as Record<string, unknown>) }
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
      if (
        !explicitText
        || looksLikeBatchProgressText(explicitText)
        || (!looksLikeJsonObjectText(explicitText) && looksLikeJsonObjectText(canonicalText))
        || canonicalText.length > explicitText.length
      ) {
        finalized.text = canonicalText;
        finalized.content = [{ type: 'text', text: canonicalText }];
      }
    }
    return finalized;
  }

  private cleanupPromptState(sessionId: string): void {
    this.clearPromptCompletionTimer(sessionId);
    this.pendingPromptFallbacks.delete(sessionId);
    this.activeStreamEmitters.delete(sessionId);
    this.promptMessageChunks.delete(sessionId);
    this.promptTransportActivityAt.delete(sessionId);
    this.auditedCliToolCallIds.delete(sessionId);
    this.activePromptStates.delete(sessionId);
    this.cliPlannerLoopState.delete(sessionId);
  }

  private clearPromptCompletionTimer(sessionId: string): void {
    const timer = this.promptCompletionTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.promptCompletionTimers.delete(sessionId);
    }
  }

  private startPromptCompletionWatcher(localSessionId: string): void {
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

      const lastActivityAt =
        this.promptTransportActivityAt.get(localSessionId)
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

  private schedulePromptCompletionFallback(localSessionId: string, acpSessionId?: string): void {
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

  private async ensureTranscriptPath(sessionId: string, runId: string): Promise<string> {
    const transcriptDir = path.resolve(this.config.workspaceRoot, DEFAULT_TRANSCRIPT_DIR, sessionId);
    await mkdir(transcriptDir, { recursive: true });
    const filePath = path.join(transcriptDir, `${runId}.jsonl`);
    this.transcripts.set(sessionId, filePath);
    this.transcriptLineSequences.set(sessionId, 0);
    await appendFile(filePath, `${JSON.stringify({ atUtc: new Date().toISOString(), seq: 0, direction: 'system', event: 'transcript_start', payload: runId })}\n`, 'utf8');
    this.markSessionActivity(sessionId);
    return filePath;
  }

  private resolveBinary(mode: KbAccessMode): string {
    const cursorBinary = process.env[KBV_CURSOR_BINARY_ENV]?.trim() || resolveDefaultCursorBinary();
    return cursorBinary || (mode === 'cli' ? this.config.cliBinary : this.config.mcpBinary);
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

  private async canReachCursor(mode: KbAccessMode, workspaceId?: string): Promise<boolean> {
    if (mode === 'cli') {
      await this.runtimeOptions.prepareCliEnvironment?.(workspaceId);
    }
    if (workspaceId) {
      await this.ensureWorkspaceAgentModelLoaded(workspaceId);
    }
    let lastError: unknown;
    const transportKey = this.buildTransportKey(mode, workspaceId);

    for (let attempt = 1; attempt <= ACP_HEALTH_INIT_ATTEMPTS; attempt += 1) {
      const transport = this.getTransport(mode, workspaceId);
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
        this.transports.delete(transportKey);
      }
    }

    return false;
  }

  private getTransport(mode: KbAccessMode, workspaceId?: string): CursorTransport {
    const transportKey = this.buildTransportKey(mode, workspaceId);
    const existing = this.transports.get(transportKey);
    if (existing) {
      return existing;
    }
    const provider = this.getProvider(mode);
    const transportBinary = this.resolveBinary(mode);
    const transport = new CursorTransport(
      transportBinary,
      buildCursorAcpArgs(transportBinary, this.getWorkspaceAgentModel(workspaceId)),
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
    this.transports.set(transportKey, transport);
    return transport;
  }

  private evaluateCliToolPolicy(toolName: string, kind?: string, rawInput?: unknown): { allowed: boolean; reason: string } {
    const normalizedToolName = toolName.trim().toLowerCase();
    const normalizedKind = kind?.trim().toLowerCase() ?? 'unknown';
    const command = extractCliToolCommand(rawInput);
    const commandLikeKbInvocation = looksLikeKbCliShellInvocation(toolName) || looksLikeKbCliShellInvocation(command);
    const kbCommandName = extractKbCliCommandName(toolName) ?? extractKbCliCommandName(command);

    if (commandLikeKbInvocation) {
      return {
        allowed: true,
        reason: kbCommandName
          ? `CLI mode allows shell transport for kb command "${kbCommandName}"`
          : 'CLI mode allows shell transport for kb commands'
      };
    }

    if (
      normalizedToolName === 'terminal'
      || normalizedToolName === 'shell'
      || normalizedKind === 'terminal'
      || normalizedKind === 'shell'
    ) {
      return {
        allowed: false,
        reason: 'CLI mode forbids terminal usage outside of running kb commands'
      };
    }

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

  private parseCliLoopbackToolResult(updateRecord: Record<string, unknown>): { command: string; total?: number } | null {
    if (updateRecord.sessionUpdate !== 'tool_call_update' || updateRecord.status !== 'completed') {
      return null;
    }

    const rawOutput = updateRecord.rawOutput;
    if (!rawOutput || typeof rawOutput !== 'object') {
      return null;
    }

    const stdout = typeof (rawOutput as { stdout?: unknown }).stdout === 'string'
      ? ((rawOutput as { stdout: string }).stdout).trim()
      : '';
    if (!stdout) {
      return null;
    }

    try {
      const parsed = JSON.parse(stdout) as {
        command?: unknown;
        data?: { total?: unknown; results?: unknown[] };
      };
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
    } catch {
      return null;
    }
  }

  private async maybeAbortCliPlannerLoop(
    localSessionId: string,
    acpSessionId: string | undefined,
    updateRecord?: Record<string, unknown>
  ): Promise<void> {
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
      zeroResultQueries: new Set<string>(),
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
        } else {
          state.zeroResultQueries.add(query);
        }
      }
    } else {
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
      await this.trackSessionOperation(
        localSessionId,
        this.appendTranscriptLine(
          localSessionId,
          'system',
          'planner_duplicate_zero_result_search',
          JSON.stringify({
            reason,
            query,
            searchKbCalls: state.searchKbCalls,
            duplicateZeroResultQueries: state.duplicateZeroResultQueries
          })
        )
      );
      this.getTransport('cli', session.workspaceId).abortPromptSession(
        acpSessionId,
        `${reason}. Reuse deterministic prefetch or the earlier zero-result evidence and return the current plan as JSON.`
      );
      return;
    }

    if (state.consecutiveZeroResultSearches < CLI_PLANNER_ZERO_RESULT_SEARCH_LIMIT) {
      return;
    }

    const distinctZeroResultQueries = state.zeroResultQueries.size;
    const lowDiversityZeroResultLoop =
      distinctZeroResultQueries === 0
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
    await this.trackSessionOperation(
      localSessionId,
      this.appendTranscriptLine(
        localSessionId,
        'system',
        'planner_loop_breaker',
        JSON.stringify({
          reason,
          searchKbCalls: state.searchKbCalls,
          consecutiveZeroResultSearches: state.consecutiveZeroResultSearches,
          duplicateZeroResultQueries: state.duplicateZeroResultQueries,
          distinctZeroResultQueries
        })
      )
    );
    this.getTransport('cli', session.workspaceId).abortPromptSession(
      acpSessionId,
      `${reason}. Reuse deterministic prefetch or the earlier zero-result evidence and return the current plan as JSON.`
    );
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
        terminalEnabled: false,
        buildSessionCreateParams: (sessionMode?: AgentSessionMode) => ({
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
        getHealth: (workspaceId?: string) => this.getCliHealth(workspaceId)
      };
    }

    return {
      mode: 'mcp',
      provider: 'mcp',
      terminalEnabled: false,
      buildSessionCreateParams: (sessionMode?: AgentSessionMode) => {
        const mcpServers = this.resolveMcpServerConfigs();
        return {
          cwd: this.config.acpCwd,
          ...(mcpServers.length > 0 ? { mcpServers } : {}),
          config: { mode: resolveProviderSessionMode('mcp', sessionMode) }
        };
      },
      getPromptTaskBuilder: (session, taskPayload, extras) => buildMcpTaskPrompt(session, taskPayload, extras),
      getHealth: (workspaceId?: string) => this.getMcpHealth(workspaceId)
    };
  }

  private async getProviderHealth(mode: KbAccessMode, workspaceId?: string): Promise<KbAccessHealth> {
    return this.getProvider(mode).getHealth(workspaceId);
  }

  private async getMcpHealth(workspaceId?: string): Promise<KbAccessHealth> {
    const issues: string[] = [];
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
    const result: KbAccessHealth = {
      mode: 'mcp',
      provider: 'mcp',
      ok,
      acpReachable,
      binaryPath: cursorInstalled ? this.resolveBinary('mcp') : undefined,
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
      const acpReachable = await this.canReachCursor('cli', workspaceId);
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

  private async resetCursorSession(sessionId: string): Promise<void> {
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
      await transport.request(
        'session/close',
        { sessionId: existing.acpSessionId },
        Math.min(this.config.requestTimeoutMs, 10_000),
        sessionId
      );
    } catch {
      // Best effort close for an ACP session that may already be gone.
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
    this.markSessionActivity(sessionId);
    const nextSeq = (this.transcriptLineSequences.get(sessionId) ?? 0) + 1;
    this.transcriptLineSequences.set(sessionId, nextSeq);
    await appendFile(
      path,
      `${JSON.stringify({
        atUtc: new Date().toISOString(),
        seq: nextSeq,
        direction,
        event,
        payload
      })}\n`,
      'utf8'
    );
    this.markSessionActivity(sessionId);
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
          const result = await toolContext.searchKb(parsed);
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
        description: 'Load persisted article relationships for an article or a PBI batch.',
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

function extractAgentMessageChunkText(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const content = value as Record<string, unknown>;
  return typeof content.text === 'string' && content.text.length > 0
    ? content.text
    : undefined;
}

type PromptMessageBuffer = {
  rawChunks: string[];
  mergedText: string;
};

function createPromptMessageBuffer(): PromptMessageBuffer {
  return {
    rawChunks: [],
    mergedText: ''
  };
}

function findSharedPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function findStreamingOverlap(left: string, right: string): number {
  const maxOverlap = Math.min(left.length, right.length);
  for (let overlap = maxOverlap; overlap >= 12; overlap -= 1) {
    if (left.slice(-overlap) === right.slice(0, overlap)) {
      return overlap;
    }
  }
  return 0;
}

function mergeStreamingText(current: string, incoming: string): string {
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
  if (
    sharedPrefix >= 12
    && sharedPrefix >= Math.floor(Math.min(current.length, incoming.length) * 0.6)
  ) {
    return incoming.length >= current.length ? incoming : current;
  }

  const overlap = findStreamingOverlap(current, incoming);
  if (overlap > 0) {
    return `${current}${incoming.slice(overlap)}`;
  }

  return `${current}${incoming}`;
}

function collapseRepeatedChunkText(value: string): string {
  return value;
}

function appendPromptMessageChunk(buffer: PromptMessageBuffer | undefined, text: string): PromptMessageBuffer {
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

function scorePromptMessageCandidate(value: string): number {
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

function assemblePromptMessageText(buffer: PromptMessageBuffer | undefined): string {
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

function streamedTextLikelyStartsJsonObject(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith('{');
}

function extractLargestBalancedJsonObject(value: string): Record<string, unknown> | null {
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
    if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(trimmed.slice(start, index + 1));
      }
    }
  }

  let best: Record<string, unknown> | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        continue;
      }
      const record = parsed as Record<string, unknown>;
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
    } catch {
      // ignore malformed candidates
    }
  }
  return best;
}

function extractLargestBalancedJsonText(value: string): string | undefined {
  const parsed = extractLargestBalancedJsonObject(value);
  return parsed ? JSON.stringify(parsed) : undefined;
}

function scorePromptFinalTextCandidate(value: string): number {
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

function selectCanonicalPromptResultText(candidates: string[]): string | undefined {
  const unique = Array.from(new Set(candidates.map((value) => value.trim()).filter(Boolean)));
  if (unique.length === 0) {
    return undefined;
  }
  return unique.sort((left, right) => scorePromptFinalTextCandidate(right) - scorePromptFinalTextCandidate(left))[0];
}

function promptStreamMatchesContract(value: string, contract: PromptStructuredResultContract): boolean {
  const parsed = extractLargestBalancedJsonObject(value);
  if (!parsed) {
    return false;
  }
  if (contract === 'batch_planner') {
    return typeof parsed.summary === 'string' && Array.isArray(parsed.coverage) && Array.isArray(parsed.items);
  }
  return false;
}

type PromptSettleWindow = {
  idleMs: number;
  minWaitMs: number;
  maxWaitMs: number;
};

const DEFAULT_PROMPT_SETTLE_WINDOW: PromptSettleWindow = {
  idleMs: 350,
  minWaitMs: 0,
  maxWaitMs: 5_000
};

const BATCH_PROGRESS_PROMPT_SETTLE_WINDOW: PromptSettleWindow = {
  idleMs: 1_000,
  minWaitMs: 5_000,
  maxWaitMs: 45_000
};

const NON_JSON_PROMPT_SETTLE_WINDOW: PromptSettleWindow = {
  idleMs: 2_500,
  minWaitMs: 60_000,
  maxWaitMs: 90_000
};

const ASSISTANT_CHAT_PROMPT_SETTLE_WINDOW: PromptSettleWindow = {
  idleMs: 1_000,
  minWaitMs: 2_000,
  maxWaitMs: 15_000
};

const ASSISTANT_CHAT_RECOVERY_RETRY_LIMIT = 2;
const ASSISTANT_CHAT_CONTINUATION_MARKER = 'Continuation instructions:';
const ASSISTANT_CHAT_CONTINUE_PROMPT = [
  'Complete the same user request using the existing session context.',
  'Return the final user-facing answer now.',
  'Do not send a progress update.',
  'Use only kb commands if one final targeted lookup is still truly required.'
].join(' ');
function buildAssistantChatKbOnlyRecoveryPrompt(policyError: string | undefined): string {
  const violationText = policyError?.trim()
    ? `The previous attempt was interrupted because you attempted an illegal operation in CLI mode: ${policyError.trim()}.`
    : 'The previous attempt was interrupted because you attempted an illegal operation in CLI mode.';

  return [
    'Continue the same user request using the existing session context.',
    violationText,
    'Do not try that illegal operation again.',
    'The only forbidden action is the illegal Shell or Terminal style operation that triggered the interruption.',
    'You may still use fresh direct KB tools or exact kb CLI commands in this recovered turn if you do not yet have enough KB context to answer.',
    'If you already gathered KB context in this session, use it and answer now. If you do not yet have enough context, run the minimum direct KB lookup now and then answer.',
    'Do not claim that KB commands are forbidden in this turn unless a direct KB command actually failed.',
    'Use only kb commands for research. Do not use terminal utilities, grep, Read File, codebase search, or filesystem exploration.',
    'Do not use Shell or Terminal again in this turn except for exact kb CLI commands.',
    'Your job is to finish answering the user\'s question, not to explore the environment.',
    'For app-feature and terminology questions, prefer the direct KB tools or this path unless the route clearly requires something else: search-kb, then get-article for the best 1-3 results, then answer.',
    'Use kb get-article-family only when you need family context from a clearly relevant article.',
    'Do not use kb batch-context, kb find-related-articles, form-editing commands, or kb help unless they are clearly necessary for this specific request.',
    'Do the research now and return the final user-facing answer in this same turn.',
    'Do not send a progress update.'
  ].join(' ');
}

function stripAssistantChatContinuation(promptText: string | undefined): string {
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

function buildAssistantChatContinuationPrompt(basePromptText: string | undefined, continuationText: string): string {
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

function extractPromptResultText(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as { finalText?: unknown; text?: unknown; content?: Array<{ type?: string; text?: string }> };
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

function looksLikeJsonObjectText(value: string): boolean {
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
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return true;
      }
    } catch {
      // fall through
    }
  }
  return false;
}

function getPromptSettleWindow(result: unknown, streamedText?: string): PromptSettleWindow {
  const explicitText = extractPromptResultText(result);
  if ((explicitText && looksLikeJsonObjectText(explicitText)) || (streamedText && looksLikeJsonObjectText(streamedText))) {
    return DEFAULT_PROMPT_SETTLE_WINDOW;
  }
  return NON_JSON_PROMPT_SETTLE_WINDOW;
}

function getBatchAnalysisPromptSettleWindow(result: unknown, streamedText?: string): PromptSettleWindow {
  const explicitText = extractPromptResultText(result);
  if ((explicitText && looksLikeJsonObjectText(explicitText)) || (streamedText && looksLikeJsonObjectText(streamedText))) {
    return DEFAULT_PROMPT_SETTLE_WINDOW;
  }
  if (explicitText?.trim() || streamedText?.trim() || looksLikeBatchProgressText(explicitText) || looksLikeBatchProgressText(streamedText)) {
    return BATCH_PROGRESS_PROMPT_SETTLE_WINDOW;
  }
  return DEFAULT_PROMPT_SETTLE_WINDOW;
}

function sortTranscriptLines(lines: AgentTranscriptLine[]): AgentTranscriptLine[] {
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
