"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.__commandRegistryTestables = void 0;
exports.registerCoreCommands = registerCoreCommands;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_crypto_1 = require("node:crypto");
const shared_types_1 = require("@kb-vault/shared-types");
const zendesk_client_1 = require("@kb-vault/zendesk-client");
const agent_runtime_1 = require("@kb-vault/agent-runtime");
const shared_types_2 = require("@kb-vault/shared-types");
const workspace_repository_1 = require("./workspace-repository");
const zendesk_sync_service_1 = require("./zendesk-sync-service");
const pbi_batch_import_service_1 = require("./pbi-batch-import-service");
const logger_1 = require("./logger");
const kb_cli_loopback_service_1 = require("./kb-cli-loopback-service");
const kb_cli_runtime_service_1 = require("./kb-cli-runtime-service");
const ai_assistant_service_1 = require("./ai-assistant-service");
const app_working_state_service_1 = require("./app-working-state-service");
const batch_analysis_orchestrator_1 = require("./batch-analysis-orchestrator");
const kb_access_mode_resolver_1 = require("./kb-access-mode-resolver");
const proposal_working_state_1 = require("./proposal-working-state");
const RUNTIME_MODEL_CATALOG = [
    { provider: 'Anthropic', name: 'Claude 4 Sonnet', aliases: ['claude 4 sonnet', 'claude-sonnet-4', 'claude-4-sonnet'], costs: { inputUsdPerMillion: 3, cacheWriteUsdPerMillion: 3.75, cacheReadUsdPerMillion: 0.3, outputUsdPerMillion: 15 } },
    { provider: 'Anthropic', name: 'Claude 4 Sonnet 1M', aliases: ['claude 4 sonnet 1m', 'claude-sonnet-4-1m', 'claude-4-sonnet-1m'], costs: { inputUsdPerMillion: 6, cacheWriteUsdPerMillion: 7.5, cacheReadUsdPerMillion: 0.6, outputUsdPerMillion: 22.5 } },
    { provider: 'Anthropic', name: 'Claude 4.5 Haiku', aliases: ['claude 4.5 haiku', 'claude-4-5-haiku', 'claude-haiku-4-5'], costs: { inputUsdPerMillion: 1, cacheWriteUsdPerMillion: 1.25, cacheReadUsdPerMillion: 0.1, outputUsdPerMillion: 5 } },
    { provider: 'Anthropic', name: 'Claude 4.5 Opus', aliases: ['claude 4.5 opus', 'claude-4-5-opus', 'claude-opus-4-5'], costs: { inputUsdPerMillion: 5, cacheWriteUsdPerMillion: 6.25, cacheReadUsdPerMillion: 0.5, outputUsdPerMillion: 25 } },
    { provider: 'Anthropic', name: 'Claude 4.5 Sonnet', aliases: ['claude 4.5 sonnet', 'claude-4-5-sonnet', 'claude-sonnet-4-5'], costs: { inputUsdPerMillion: 3, cacheWriteUsdPerMillion: 3.75, cacheReadUsdPerMillion: 0.3, outputUsdPerMillion: 15 } },
    { provider: 'Anthropic', name: 'Claude 4.6 Opus', aliases: ['claude 4.6 opus', 'claude-4-6-opus', 'claude-opus-4-6'], costs: { inputUsdPerMillion: 5, cacheWriteUsdPerMillion: 6.25, cacheReadUsdPerMillion: 0.5, outputUsdPerMillion: 25 } },
    { provider: 'Anthropic', name: 'Claude 4.6 Opus (Fast mode)', aliases: ['claude 4.6 opus fast mode', 'claude-4-6-opus-fast', 'claude-opus-4-6-fast'], costs: { inputUsdPerMillion: 30, cacheWriteUsdPerMillion: 37.5, cacheReadUsdPerMillion: 3, outputUsdPerMillion: 150 } },
    { provider: 'Anthropic', name: 'Claude 4.6 Sonnet', aliases: ['claude 4.6 sonnet', 'claude-4-6-sonnet', 'claude-sonnet-4-6'], costs: { inputUsdPerMillion: 3, cacheWriteUsdPerMillion: 3.75, cacheReadUsdPerMillion: 0.3, outputUsdPerMillion: 15 } },
    { provider: 'Cursor', name: 'Composer 1', aliases: ['composer 1', 'cursor composer 1'], costs: { inputUsdPerMillion: 1.25, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.125, outputUsdPerMillion: 10 } },
    { provider: 'Cursor', name: 'Composer 1.5', aliases: ['composer 1.5', 'composer 15', 'cursor composer 1.5'], costs: { inputUsdPerMillion: 3.5, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.35, outputUsdPerMillion: 17.5 } },
    { provider: 'Cursor', name: 'Composer 2', aliases: ['composer 2', 'cursor composer 2'], costs: { inputUsdPerMillion: 0.5, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.2, outputUsdPerMillion: 2.5 } },
    { provider: 'Google', name: 'Gemini 2.5 Flash', aliases: ['gemini 2.5 flash', 'gemini-2-5-flash'], costs: { inputUsdPerMillion: 0.3, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.03, outputUsdPerMillion: 2.5 } },
    { provider: 'Google', name: 'Gemini 3 Flash', aliases: ['gemini 3 flash', 'gemini-3-flash'], costs: { inputUsdPerMillion: 0.5, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.05, outputUsdPerMillion: 3 } },
    { provider: 'Google', name: 'Gemini 3 Pro', aliases: ['gemini 3 pro', 'gemini-3-pro'], costs: { inputUsdPerMillion: 2, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.2, outputUsdPerMillion: 12 } },
    { provider: 'Google', name: 'Gemini 3 Pro Image Preview', aliases: ['gemini 3 pro image preview', 'gemini-3-pro-image-preview'], costs: { inputUsdPerMillion: 2, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.2, outputUsdPerMillion: 12 } },
    { provider: 'Google', name: 'Gemini 3.1 Pro', aliases: ['gemini 3.1 pro', 'gemini-3-1-pro'], costs: { inputUsdPerMillion: 2, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.2, outputUsdPerMillion: 12 } },
    { provider: 'OpenAI', name: 'GPT-5', aliases: ['gpt-5'], costs: { inputUsdPerMillion: 1.25, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.125, outputUsdPerMillion: 10 } },
    { provider: 'OpenAI', name: 'GPT-5 Fast', aliases: ['gpt-5 fast', 'gpt-5-fast'], costs: { inputUsdPerMillion: 2.5, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.25, outputUsdPerMillion: 20 } },
    { provider: 'OpenAI', name: 'GPT-5 Mini', aliases: ['gpt-5 mini', 'gpt-5-mini'], costs: { inputUsdPerMillion: 0.25, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.025, outputUsdPerMillion: 2 } },
    { provider: 'OpenAI', name: 'GPT-5-Codex', aliases: ['gpt-5-codex', 'gpt 5 codex'], costs: { inputUsdPerMillion: 1.25, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.125, outputUsdPerMillion: 10 } },
    { provider: 'OpenAI', name: 'GPT-5.1 Codex', aliases: ['gpt-5.1 codex', 'gpt-5-1-codex'], costs: { inputUsdPerMillion: 1.25, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.125, outputUsdPerMillion: 10 } },
    { provider: 'OpenAI', name: 'GPT-5.1 Codex Max', aliases: ['gpt-5.1 codex max', 'gpt-5-1-codex-max'], costs: { inputUsdPerMillion: 1.25, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.125, outputUsdPerMillion: 10 } },
    { provider: 'OpenAI', name: 'GPT-5.1 Codex Mini', aliases: ['gpt-5.1 codex mini', 'gpt-5-1-codex-mini'], costs: { inputUsdPerMillion: 0.25, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.025, outputUsdPerMillion: 2 } },
    { provider: 'OpenAI', name: 'GPT-5.2', aliases: ['gpt-5.2', 'gpt-5-2'], costs: { inputUsdPerMillion: 1.75, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.175, outputUsdPerMillion: 14 } },
    { provider: 'OpenAI', name: 'GPT-5.2 Codex', aliases: ['gpt-5.2 codex', 'gpt-5-2-codex'], costs: { inputUsdPerMillion: 1.75, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.175, outputUsdPerMillion: 14 } },
    { provider: 'OpenAI', name: 'GPT-5.3 Codex', aliases: ['gpt-5.3 codex', 'gpt-5-3-codex'], costs: { inputUsdPerMillion: 1.75, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.175, outputUsdPerMillion: 14 } },
    { provider: 'OpenAI', name: 'GPT-5.4', aliases: ['gpt-5.4', 'gpt-5-4'], costs: { inputUsdPerMillion: 2.5, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.25, outputUsdPerMillion: 15 } },
    { provider: 'OpenAI', name: 'GPT-5.4 Mini', aliases: ['gpt-5.4 mini', 'gpt-5-4-mini'], costs: { inputUsdPerMillion: 0.75, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.075, outputUsdPerMillion: 4.5 } },
    { provider: 'OpenAI', name: 'GPT-5.4 Nano', aliases: ['gpt-5.4 nano', 'gpt-5-4-nano'], costs: { inputUsdPerMillion: 0.2, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.02, outputUsdPerMillion: 1.25 } },
    { provider: 'xAI', name: 'Grok 4.20', aliases: ['grok 4.20', 'grok-4-20'], costs: { inputUsdPerMillion: 2, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.2, outputUsdPerMillion: 6 } },
    { provider: 'Moonshot', name: 'Kimi K2.5', aliases: ['kimi k2.5', 'kimi-k2-5'], costs: { inputUsdPerMillion: 0.6, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.1, outputUsdPerMillion: 3 } }
];
const normalizeModelCatalogToken = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const resolveRuntimeModelOption = (modelId) => {
    const normalizedId = normalizeModelCatalogToken(modelId);
    const match = [...RUNTIME_MODEL_CATALOG]
        .sort((a, b) => Math.max(...b.aliases.map((alias) => normalizeModelCatalogToken(alias).length)) - Math.max(...a.aliases.map((alias) => normalizeModelCatalogToken(alias).length)))
        .find((entry) => entry.aliases.some((alias) => {
        const normalizedAlias = normalizeModelCatalogToken(alias);
        return normalizedId === normalizedAlias || normalizedId.includes(normalizedAlias);
    }));
    return {
        id: modelId,
        provider: match?.provider ?? 'Unknown',
        name: match?.name ?? modelId,
        costs: match?.costs ?? {
            inputUsdPerMillion: null,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: null,
            outputUsdPerMillion: null
        }
    };
};
const buildRuntimeModelCatalog = (availableModels, currentModelId) => {
    const orderedModelIds = [];
    for (const modelId of availableModels ?? []) {
        const normalized = modelId?.trim();
        if (normalized) {
            orderedModelIds.push(normalized);
        }
    }
    if (currentModelId?.trim()) {
        orderedModelIds.unshift(currentModelId.trim());
    }
    const deduped = new Map();
    for (const modelId of orderedModelIds) {
        const option = resolveRuntimeModelOption(modelId);
        const key = `${normalizeModelCatalogToken(option.provider)}::${normalizeModelCatalogToken(option.name)}`;
        if (!deduped.has(key)) {
            deduped.set(key, option);
        }
    }
    return Array.from(deduped.values());
};
const extractOptionalString = (value) => typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined;
const extractOptionalKbAccessMode = (value) => value === 'mcp' || value === 'cli'
    ? value
    : undefined;
const asRecord = (value) => value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined;
const ZENDESK_PREVIEW_STYLE_TOKENS = {
    base_font_size: '16px',
    bg_color: '#ffffff',
    bg_color_boxed: '#ffffff',
    bg_color_content_blocks: '#f8f9fa',
    bg_color_cta: '#f8fbff',
    bg_color_custom_blocks: '#f7fafc',
    bg_color_footer: '#f3f5f7',
    bg_color_header: '#ffffff',
    bg_color_hero: '#ffffff',
    bg_color_notification: '#edf2f7',
    bg_color_secondary_hero: '#f5f7fa',
    bg_gradient_hero_gradient: 'none',
    color_border: '#e2e8f0',
    color_footer_link: '#1f73b7',
    color_gray_100: '#f7fafc',
    color_gray_200: '#edf2f7',
    color_gray_600: '#4a5568',
    color_header_link: '#1f73b7',
    color_header_link_fixed: '#1f73b7',
    color_heading: '#1a202c',
    color_heading_cta: '#1a202c',
    color_hero_heading: '#1a202c',
    color_hero_text: '#2d3748',
    color_link: '#1f73b7',
    color_note: '#3182ce',
    color_notification: '#2c5282',
    color_outline: '#cbd5e0',
    color_primary: '#1f73b7',
    color_primary_inverse: '#ffffff',
    color_secondary: '#2d3748',
    color_secondary_inverse: '#ffffff',
    color_tertiary: '#3182ce',
    color_tertiary_inverse: '#ffffff',
    color_text: '#1a202c',
    color_text_cta: '#ffffff',
    color_warning: '#dd6b20',
    community_background_image: 'none',
    header_height: '72px',
    heading_font: "'Inter', 'Segoe UI', Arial, sans-serif",
    homepage_background_image: 'none',
    logo_height: '32px',
    note_title: '#2c5282',
    text_font: "'Inter', 'Segoe UI', Arial, sans-serif",
    warning_title: '#b7791f'
};
const sanitizeZendeskStyles = (cssText) => {
    const withFunctionsStripped = cssText
        .replace(/(?:darken|lighten)\(\s*([^)]+?),\s*[0-9.]+%?\s*\)/g, '$1');
    return withFunctionsStripped.replace(/\$([a-zA-Z0-9_-]+)/g, 'var(--kbv-zendesk-preview-$1)');
};
const buildFallbackZendeskVariableCss = () => {
    const vars = Object.entries(ZENDESK_PREVIEW_STYLE_TOKENS)
        .map(([token, value]) => `  --kbv-zendesk-preview-${token}: ${value};`)
        .join('\n');
    return `:root {\n${vars}\n}\n`;
};
const resolveArticlePreviewStylePath = async (override) => {
    const explicit = override?.trim();
    const envPath = (process.env.KB_VAULT_ARTICLE_PREVIEW_STYLE_PATH ?? process.env.KB_VAULT_ZENDESK_STYLE_PATH ?? '').trim();
    const candidates = [
        explicit,
        envPath,
        node_path_1.default.resolve(process.cwd(), 'style1.css'),
        node_path_1.default.resolve(process.cwd(), '..', 'style1.css')
    ].filter(Boolean);
    for (const candidate of candidates) {
        const absoluteCandidate = node_path_1.default.isAbsolute(candidate) ? candidate : node_path_1.default.resolve(process.cwd(), candidate);
        try {
            await promises_1.default.access(absoluteCandidate);
            return absoluteCandidate;
        }
        catch {
            // try next location
        }
    }
    return null;
};
const readTranscriptLines = async (transcriptPath, limit) => {
    if (!transcriptPath) {
        return [];
    }
    try {
        const text = await promises_1.default.readFile(transcriptPath, 'utf8');
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
        const ordered = parsed
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
        return typeof limit === 'number' && limit > 0 ? ordered.slice(-limit) : ordered;
    }
    catch {
        return [];
    }
};
const normalizePlannerPhrase = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const dedupeStrings = (values) => Array.from(new Set(values.map((value) => value?.trim()).filter((value) => Boolean(value))));
const PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX = 'proposal-';
const FINAL_REVIEW_STAGE_TIMEOUT_MS = 180_000;
const FINAL_REVIEW_STAGE_WATCHDOG_MS = 210_000;
class BatchStageWatchdogError extends Error {
    stage;
    sessionId;
    timeoutMs;
    constructor(stage, sessionId, timeoutMs) {
        super(`${stage} exceeded the stage watchdog after ${timeoutMs}ms.`);
        this.stage = stage;
        this.sessionId = sessionId;
        this.timeoutMs = timeoutMs;
        this.name = 'BatchStageWatchdogError';
    }
}
const stripHtmlForPromptPreview = (value, maxLength = 240) => {
    const normalized = value
        ?.replace(/<style[\s\S]*?<\/style>/gi, ' ')
        ?.replace(/<script[\s\S]*?<\/script>/gi, ' ')
        ?.replace(/<[^>]+>/g, ' ')
        ?.replace(/&nbsp;/gi, ' ')
        ?.replace(/&amp;/gi, '&')
        ?.replace(/&quot;/gi, '"')
        ?.replace(/&#39;/gi, '\'')
        ?.replace(/\s+/g, ' ')
        ?.trim();
    if (!normalized) {
        return undefined;
    }
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}…` : normalized;
};
const summarizeFinalReviewProposalContext = async (workspaceRepository, workspaceId, proposalId) => {
    let detail;
    try {
        detail = await workspaceRepository.getProposalReviewDetail(workspaceId, proposalId);
    }
    catch {
        return null;
    }
    const proposal = detail.proposal;
    const [variant, family] = await Promise.all([
        proposal.localeVariantId
            ? workspaceRepository.getLocaleVariant(workspaceId, proposal.localeVariantId).catch(() => null)
            : Promise.resolve(null),
        proposal.familyId
            ? workspaceRepository.getArticleFamily(workspaceId, proposal.familyId).catch(() => null)
            : Promise.resolve(null)
    ]);
    const familyExternalKey = family?.externalKey?.trim();
    const proposalScoped = familyExternalKey?.toLowerCase().startsWith(PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX) ?? false;
    let targetState = 'unknown';
    let targetStateReason = 'Target could not be deterministically classified from persisted proposal metadata.';
    if (proposalScoped) {
        targetState = proposal.action === shared_types_1.ProposalAction.CREATE ? 'net_new_draft_target' : 'proposal_scoped_draft';
        targetStateReason = `Family external key ${familyExternalKey} marks a generated proposal artifact, so it is not live KB coverage.`;
    }
    else if (proposal.action === shared_types_1.ProposalAction.CREATE && !proposal.localeVariantId) {
        targetState = 'net_new_draft_target';
        targetStateReason = 'Net-new proposal without a live locale variant target yet.';
    }
    else if (variant?.status === shared_types_1.RevisionState.LIVE) {
        targetState = 'live_kb_article';
        targetStateReason = `Locale variant ${variant.id} is a live KB target in family ${variant.familyId}.`;
    }
    else if (variant?.status) {
        targetStateReason = `Locale variant ${variant.id} is currently ${variant.status}, so it should not be treated as live KB without corroborating evidence.`;
    }
    else if (familyExternalKey) {
        targetStateReason = `Family external key ${familyExternalKey} exists, but the locale-variant state could not be verified.`;
    }
    const changeSummary = detail.diff.changeRegions
        .slice(0, 8)
        .map((region) => {
        const beforeText = stripHtmlForPromptPreview(region.beforeText, 100);
        const afterText = stripHtmlForPromptPreview(region.afterText, 100);
        if (beforeText && afterText && beforeText !== afterText) {
            return `${region.label}: ${beforeText} -> ${afterText}`;
        }
        if (afterText) {
            return `${region.label}: ${afterText}`;
        }
        if (beforeText) {
            return `${region.label}: ${beforeText}`;
        }
        return region.label;
    })
        .filter(Boolean);
    return {
        proposalId: proposal.id,
        action: proposal.action,
        targetTitle: proposal.targetTitle ?? 'Untitled proposal target',
        reviewStatus: proposal.reviewStatus,
        familyId: proposal.familyId,
        localeVariantId: proposal.localeVariantId,
        locale: variant?.locale ?? proposal.targetLocale,
        variantStatus: variant?.status,
        familyExternalKey,
        targetState,
        targetStateReason,
        relatedPbiIds: detail.relatedPbis.map((item) => item.id),
        relatedExternalIds: detail.relatedPbis.map((item) => item.externalId).filter(Boolean),
        rationaleSummary: proposal.rationaleSummary,
        aiNotes: proposal.aiNotes,
        changeSummary,
        proposedContentPreview: stripHtmlForPromptPreview(detail.diff.afterHtml, 260)
    };
};
const buildFinalReviewProposalContext = async (workspaceRepository, workspaceId, workerReport) => {
    const proposalIds = Array.from(new Set(workerReport.executedItems
        .flatMap((item) => [
        item.proposalId?.trim(),
        ...(item.artifactIds ?? []).map((artifactId) => artifactId.trim())
    ])
        .filter((value) => Boolean(value))));
    if (proposalIds.length === 0) {
        return [];
    }
    const snapshots = await Promise.all(proposalIds.map((proposalId) => summarizeFinalReviewProposalContext(workspaceRepository, workspaceId, proposalId)));
    return snapshots.filter((item) => Boolean(item));
};
const inferBatchStageFailureStatus = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    return /timeout|timed out|watchdog/i.test(message) ? 'timeout' : 'error';
};
const runBatchAnalysisWithStageWatchdog = async (agentRuntime, request, emit, isCancelled, options) => {
    let timer;
    try {
        return await Promise.race([
            agentRuntime.runBatchAnalysis(request, emit, isCancelled),
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    agentRuntime.closeSession({ workspaceId: request.workspaceId, sessionId: options.sessionId });
                    reject(new BatchStageWatchdogError(options.stage, options.sessionId, options.watchdogMs));
                }, options.watchdogMs);
            })
        ]);
    }
    finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
};
const extractPlannerPbiRows = (uploadedPbis) => {
    const rows = Array.isArray(uploadedPbis)
        ? uploadedPbis
        : uploadedPbis && typeof uploadedPbis === 'object' && Array.isArray(uploadedPbis.rows)
            ? uploadedPbis.rows
            : [];
    return rows
        .map((row) => {
        if (!row || typeof row !== 'object') {
            return null;
        }
        const record = row;
        const title = typeof record.title === 'string' ? record.title.trim() : '';
        const pbiId = typeof record.id === 'string' ? record.id : '';
        const titlePath = [record.title1, record.title2, record.title3]
            .filter((value) => typeof value === 'string' && value.trim().length > 0)
            .map((value) => value.trim());
        if (!pbiId || !title) {
            return null;
        }
        return { pbiId, title, titlePath };
    })
        .filter((row) => Boolean(row));
};
const PLANNER_GENERIC_PATH_SEGMENTS = new Set([
    'food list',
    'food lists',
    'food item',
    'food items',
    'permission',
    'related scenarios',
    'additional actions'
]);
const plannerIncludesWord = (value, word) => normalizePlannerPhrase(value).split(' ').includes(word);
const plannerCombinePathSegments = (...segments) => dedupeStrings(segments).join(' ').trim();
const buildPlannerSpecificPhrase = (row) => {
    const path = dedupeStrings([...row.titlePath, row.title]);
    const leaf = path[path.length - 1] ?? row.title;
    const parent = path.length >= 2 ? path[path.length - 2] : '';
    const normalizedLeaf = normalizePlannerPhrase(leaf);
    if (normalizedLeaf === 'additional actions' && parent) {
        return plannerCombinePathSegments(parent, 'Additional Actions');
    }
    if ((normalizedLeaf === 'related scenarios' || normalizedLeaf === 'permission') && parent) {
        return plannerCombinePathSegments(parent, leaf);
    }
    if (PLANNER_GENERIC_PATH_SEGMENTS.has(normalizedLeaf) && parent) {
        return plannerCombinePathSegments(parent, leaf);
    }
    return leaf;
};
const classifyPlannerSurface = (row) => {
    const path = dedupeStrings([...row.titlePath, row.title]);
    const specificPhrase = buildPlannerSpecificPhrase(row);
    const combined = normalizePlannerPhrase(path.join(' '));
    const leaf = normalizePlannerPhrase(path[path.length - 1] ?? row.title);
    const hasFoodItem = combined.includes('food item');
    const hasFoodList = combined.includes('food list');
    const hasDuplicate = combined.includes('duplicate') || combined.includes('duplicating');
    const hasDelete = combined.includes('delete');
    const hasCreate = combined.includes('create');
    const hasEdit = combined.includes('edit');
    const hasSearch = combined.includes('search');
    const hasFilter = combined.includes('filter');
    const hasSort = combined.includes('sort');
    const hasPagination = combined.includes('pagination');
    const hasNavigate = combined.includes('navigating');
    const hasDetail = combined.includes('detail');
    const hasLocation = combined.includes('location');
    const hasPermission = combined.includes('permission');
    const hasTable = combined.includes('table');
    if (hasDuplicate && hasFoodItem) {
        return {
            clusterKey: 'duplicate-food-item',
            clusterLabel: 'Duplicate a Food Item',
            queryCandidates: [
                'Duplicate Food Item',
                'Duplicating Food Item',
                'Food Item Additional Actions'
            ]
        };
    }
    if (hasDuplicate && hasFoodList) {
        return {
            clusterKey: 'duplicate-food-list',
            clusterLabel: 'Duplicate a Food List',
            queryCandidates: [
                'Duplicate Food List',
                'Duplicating Food List',
                'Food List Additional Actions'
            ]
        };
    }
    if (hasDelete && hasFoodItem) {
        return {
            clusterKey: 'delete-food-item',
            clusterLabel: 'Delete a Food Item',
            queryCandidates: [
                'Delete a Food Item',
                'Food Item Additional Actions'
            ]
        };
    }
    if (hasDelete && hasFoodList) {
        return {
            clusterKey: 'delete-food-list',
            clusterLabel: 'Delete a Food List',
            queryCandidates: [
                'Delete a Food List',
                'Food List Additional Actions'
            ]
        };
    }
    if (hasCreate && hasFoodItem) {
        return {
            clusterKey: 'create-food-item',
            clusterLabel: 'Create a Food Item',
            queryCandidates: [
                'Create a Food Item',
                'Create Food Item'
            ]
        };
    }
    if (hasCreate && hasFoodList) {
        return {
            clusterKey: 'create-food-list',
            clusterLabel: 'Create a Food List',
            queryCandidates: [
                'Create a Food List',
                'Create Food List'
            ]
        };
    }
    if (hasFoodList && (hasSearch || hasFilter || hasSort || hasPagination || hasNavigate)) {
        return {
            clusterKey: 'food-list-index-surface',
            clusterLabel: 'View Food Lists',
            queryCandidates: [
                'View Food Lists',
                'Navigating to Food List',
                'Searching Food List Table',
                'Filters & Sorts',
                'Table Pagination'
            ]
        };
    }
    if (hasFoodList && (hasDetail || hasLocation || hasPermission || hasEdit || hasTable || leaf.includes('details tab'))) {
        return {
            clusterKey: 'food-list-detail-surface',
            clusterLabel: 'View and Edit a Food List',
            queryCandidates: [
                'View and Edit a Food List',
                'Edit Food List Title',
                'Details Tab',
                'Food Items Table',
                'Location Tab Visibility and Navigation',
                'Food List Permissions'
            ]
        };
    }
    return {
        clusterKey: normalizePlannerPhrase(specificPhrase).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `cluster-${(0, node_crypto_1.randomUUID)()}`,
        clusterLabel: specificPhrase,
        queryCandidates: [specificPhrase, ...path]
    };
};
const buildPlannerTopicClusters = (uploadedPbis) => {
    const rows = extractPlannerPbiRows(uploadedPbis);
    const clusters = new Map();
    for (const row of rows) {
        const specificPhrase = buildPlannerSpecificPhrase(row);
        const surface = classifyPlannerSurface(row);
        const queryCandidates = dedupeStrings([
            ...surface.queryCandidates,
            specificPhrase,
            row.title,
            ...row.titlePath.slice(-2)
        ]).slice(0, 6);
        const existing = clusters.get(surface.clusterKey);
        if (existing) {
            if (!existing.pbiIds.includes(row.pbiId)) {
                existing.pbiIds.push(row.pbiId);
            }
            existing.sampleTitles = dedupeStrings([...existing.sampleTitles, row.title, specificPhrase]).slice(0, 6);
            existing.queries = dedupeStrings([...existing.queries, ...queryCandidates]).slice(0, 6);
            continue;
        }
        clusters.set(surface.clusterKey, {
            clusterId: `cluster-${clusters.size + 1}`,
            label: surface.clusterLabel,
            pbiIds: [row.pbiId],
            sampleTitles: dedupeStrings([row.title, specificPhrase]).slice(0, 6),
            queries: queryCandidates
        });
    }
    return Array.from(clusters.values())
        .sort((left, right) => right.pbiIds.length - left.pbiIds.length || left.label.localeCompare(right.label));
};
const summarizeRelationEvidence = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => {
        if (!item || typeof item !== 'object') {
            return '';
        }
        const record = item;
        if (typeof record.snippet === 'string' && record.snippet.trim()) {
            return record.snippet.trim();
        }
        if (typeof record.sourceRef === 'string' && record.sourceRef.trim()) {
            return record.sourceRef.trim();
        }
        return '';
    })
        .filter(Boolean)
        .slice(0, 3);
};
const buildPlannerPrefetch = async (workspaceRepository, workspaceId, batchId, uploadedPbis) => {
    const topicClusters = buildPlannerTopicClusters(uploadedPbis);
    const [inspection, relationResponse, articleMatches] = await Promise.all([
        workspaceRepository.getBatchAnalysisInspection(workspaceId, batchId).catch(() => null),
        workspaceRepository.listArticleRelations(workspaceId, {
            workspaceId,
            batchId,
            limit: 12,
            minScore: 0.15,
            includeEvidence: true
        }).catch(() => ({ relations: [] })),
        Promise.all(topicClusters.slice(0, 12).flatMap((cluster) => cluster.queries.slice(0, 4).map(async (query) => {
            const search = await workspaceRepository.searchArticles(workspaceId, {
                workspaceId,
                query,
                scope: 'all',
                includeArchived: true
            }).catch(() => ({ total: 0, results: [] }));
            const topResults = Array.isArray(search.results)
                ? search.results.slice(0, 3).map((result) => ({
                    title: typeof result.title === 'string' ? result.title : 'Untitled article',
                    familyId: typeof result.familyId === 'string' ? result.familyId : '',
                    localeVariantId: typeof result.localeVariantId === 'string' ? result.localeVariantId : '',
                    score: typeof result.score === 'number' ? result.score : 0,
                    matchContext: typeof result.matchContext === 'string' ? result.matchContext : undefined,
                    snippet: typeof result.snippet === 'string' ? result.snippet.trim() : ''
                }))
                : [];
            const articleMatch = {
                clusterId: cluster.clusterId,
                query,
                total: typeof search.total === 'number' ? search.total : 0,
                topResults
            };
            return articleMatch;
        })))
    ]);
    return {
        priorAnalysis: inspection
            ? {
                latestPlanSummary: inspection.plans[0]?.summary,
                latestApprovedPlanSummary: inspection.snapshot.latestApprovedPlan?.summary,
                latestReviewVerdict: inspection.reviews[0]?.verdict,
                latestFinalVerdict: inspection.finalReviews[0]?.verdict
            }
            : null,
        topicClusters,
        articleMatches,
        relationMatches: Array.isArray(relationResponse.relations)
            ? (relationResponse.relations).slice(0, 12).map((relation) => ({
                title: typeof relation.targetFamily === 'object' && relation.targetFamily && typeof relation.targetFamily.title === 'string'
                    ? relation.targetFamily.title
                    : 'Untitled family',
                familyId: typeof relation.targetFamily === 'object' && relation.targetFamily && typeof relation.targetFamily.id === 'string'
                    ? relation.targetFamily.id
                    : '',
                strengthScore: typeof relation.strengthScore === 'number' ? relation.strengthScore : 0,
                relationType: typeof relation.relationType === 'string' ? relation.relationType : 'related',
                evidence: summarizeRelationEvidence(relation.evidence)
            }))
            : []
    };
};
const dedupeResultTextCandidates = (values) => {
    const candidates = new Set();
    for (const value of values) {
        const normalized = collapseRepeatedTranscriptText(value);
        if (!normalized) {
            continue;
        }
        candidates.add(normalized);
        const normalizedJson = normalizeRecoveredJsonText(normalized);
        if (normalizedJson) {
            candidates.add(normalizedJson);
        }
    }
    return [...candidates];
};
const extractResultTextCandidates = (payload) => {
    if (!payload || typeof payload !== 'object') {
        return [];
    }
    const record = payload;
    return dedupeResultTextCandidates([
        typeof record.finalText === 'string' ? record.finalText : '',
        typeof record.text === 'string' ? record.text : '',
        Array.isArray(record.content)
            ? record.content
                .filter((item) => item?.type === 'text' && typeof item.text === 'string')
                .map((item) => item.text)
                .join('\n')
                .trim()
            : '',
        typeof record.streamedText === 'string' ? record.streamedText : ''
    ]);
};
const BATCH_ANALYSIS_DEV_BUILD_PAIRS = [
    {
        label: 'desktop command registry',
        sourceRelativePath: 'apps/desktop/src/main/services/command-registry.ts',
        buildRelativePath: 'apps/desktop/dist/main/services/command-registry.js'
    },
    {
        label: 'desktop batch orchestrator',
        sourceRelativePath: 'apps/desktop/src/main/services/batch-analysis-orchestrator.ts',
        buildRelativePath: 'apps/desktop/dist/main/services/batch-analysis-orchestrator.js'
    },
    {
        label: 'desktop workspace repository',
        sourceRelativePath: 'apps/desktop/src/main/services/workspace-repository.ts',
        buildRelativePath: 'apps/desktop/dist/main/services/workspace-repository.js'
    },
    {
        label: 'agent runtime',
        sourceRelativePath: 'packages/agent-runtime/src/index.ts',
        buildRelativePath: 'apps/desktop/dist/main/packages/agent-runtime/src/index.js'
    }
];
const DEV_BUILD_STALENESS_TOLERANCE_MS = 50;
const statMtimeMs = async (filePath) => {
    try {
        return (await promises_1.default.stat(filePath)).mtimeMs;
    }
    catch {
        return null;
    }
};
const evaluateBatchAnalysisDevBuildFreshness = async (repoRoot, pairs = BATCH_ANALYSIS_DEV_BUILD_PAIRS) => {
    const stalePairs = [];
    let discoveredSourceCount = 0;
    for (const pair of pairs) {
        const sourcePath = node_path_1.default.join(repoRoot, pair.sourceRelativePath);
        const buildPath = node_path_1.default.join(repoRoot, pair.buildRelativePath);
        const sourceMtimeMs = await statMtimeMs(sourcePath);
        if (sourceMtimeMs === null) {
            continue;
        }
        discoveredSourceCount += 1;
        const buildMtimeMs = await statMtimeMs(buildPath);
        if (buildMtimeMs === null || sourceMtimeMs > buildMtimeMs + DEV_BUILD_STALENESS_TOLERANCE_MS) {
            stalePairs.push({
                label: pair.label,
                sourcePath,
                buildPath
            });
        }
    }
    if (discoveredSourceCount === 0 || stalePairs.length === 0) {
        return { stale: false, stalePairs: [] };
    }
    const examples = stalePairs
        .slice(0, 3)
        .map((pair) => `${pair.label} (${node_path_1.default.relative(repoRoot, pair.sourcePath)} > ${node_path_1.default.relative(repoRoot, pair.buildPath)})`)
        .join('; ');
    return {
        stale: true,
        message: `Batch analyzation is running against a stale desktop main build. Restart the desktop dev process before running it again. Newer source files were detected: ${examples}.`,
        stalePairs
    };
};
const getBatchAnalysisDevBuildFreshnessMessage = async () => {
    const repoRoot = node_path_1.default.resolve(__dirname, '..', '..', '..', '..', '..');
    const freshness = await evaluateBatchAnalysisDevBuildFreshness(repoRoot);
    return freshness.stale ? freshness.message ?? 'Batch analyzation is running against a stale desktop main build.' : null;
};
const matchesExpectedBatchResultShape = (parsed, expectedShape) => {
    if (!expectedShape) {
        return true;
    }
    switch (expectedShape) {
        case 'planner':
            return Array.isArray(parsed.coverage) && Array.isArray(parsed.items);
        case 'plan_review':
            return typeof parsed.verdict === 'string' && parsed.delta !== null && typeof parsed.delta === 'object';
        case 'worker':
            return Array.isArray(parsed.executedItems) || Array.isArray(parsed.discoveredWork);
        case 'final_review':
            return typeof parsed.verdict === 'string' && parsed.delta !== null && typeof parsed.delta === 'object' && 'allPbisMapped' in parsed;
        default:
            return true;
    }
};
const scoreResultTextCandidate = (candidate, expectedShape) => {
    const trimmed = candidate.trim();
    if (!trimmed) {
        return -1;
    }
    const extracted = extractJsonObject(trimmed);
    if (extracted && matchesExpectedBatchResultShape(extracted, expectedShape)) {
        return 10_000 + trimmed.length;
    }
    let score = trimmed.length;
    if (expectedShape && !trimmed.includes('{')) {
        score -= 1_500;
    }
    if (expectedShape
        && !trimmed.includes('{')
        && /^(reviewing|checking|searching|probing|let me|i['’]m)\b/i.test(trimmed)) {
        score -= 3_000;
    }
    if (trimmed.startsWith('{')) {
        score += 500;
    }
    if (trimmed.includes('"summary"')) {
        score += 300;
    }
    if (trimmed.includes('"coverage"')) {
        score += 300;
    }
    if (trimmed.includes('"items"')) {
        score += 300;
    }
    if (trimmed.includes('"verdict"')) {
        score += 300;
    }
    if (expectedShape === 'planner') {
        if (trimmed.includes('"coverage"')) {
            score += 600;
        }
        if (trimmed.includes('"items"')) {
            score += 600;
        }
        if (trimmed.includes('"status"')) {
            score -= 700;
        }
    }
    if (expectedShape === 'plan_review' || expectedShape === 'final_review') {
        if (trimmed.includes('"delta"')) {
            score += 450;
        }
        if (trimmed.includes('"status"')) {
            score -= 700;
        }
    }
    if (expectedShape === 'worker' && trimmed.includes('"executedItems"')) {
        score += 600;
    }
    score += (trimmed.match(/\{/g) ?? []).length * 25;
    return score;
};
const selectBestResultText = (candidates, expectedShape) => {
    if (candidates.length === 0) {
        return '';
    }
    return [...candidates]
        .sort((left, right) => scoreResultTextCandidate(right, expectedShape) - scoreResultTextCandidate(left, expectedShape))[0] ?? '';
};
const selectBestParseableResultText = (candidates, expectedShape) => {
    const parseableCandidates = candidates.filter((candidate) => {
        const extracted = extractJsonObject(candidate);
        return Boolean(extracted && matchesExpectedBatchResultShape(extracted, expectedShape));
    });
    if (parseableCandidates.length === 0) {
        return '';
    }
    const pureJsonCandidates = parseableCandidates.filter((candidate) => candidate.trim().startsWith('{'));
    return selectBestResultText(pureJsonCandidates.length > 0 ? pureJsonCandidates : parseableCandidates, expectedShape);
};
const collapseRepeatedTranscriptText = (value) => {
    let current = value;
    while (current.trim().length >= 64 && current.length % 2 === 0) {
        const midpoint = current.length / 2;
        const left = current.slice(0, midpoint);
        const right = current.slice(midpoint);
        if (!left.trim() || left.trim() !== right.trim()) {
            break;
        }
        current = left;
    }
    return current.trim() ? current : '';
};
const findTranscriptChunkOverlap = (left, right) => {
    const maxOverlap = Math.min(left.length, right.length);
    for (let overlap = maxOverlap; overlap >= 24; overlap -= 1) {
        if (left.slice(-overlap) === right.slice(0, overlap)) {
            return overlap;
        }
    }
    return 0;
};
const STRUCTURED_BATCH_RESULT_POLL_INTERVAL_MS = 750;
const STRUCTURED_BATCH_RESULT_IDLE_MS = 2_000;
const STRUCTURED_BATCH_RESULT_MAX_WAIT_MS = 35_000;
const STRUCTURED_BATCH_PLANNER_RECOVERY_IDLE_MS = 100_000;
const STRUCTURED_BATCH_PLANNER_RECOVERY_MAX_WAIT_MS = 180_000;
const getLastTranscriptSequence = (lines) => {
    const sequenced = lines
        .map((line) => (typeof line.seq === 'number' ? line.seq : Number.NEGATIVE_INFINITY))
        .filter((seq) => Number.isFinite(seq));
    if (sequenced.length === 0) {
        return Number.NEGATIVE_INFINITY;
    }
    return Math.max(...sequenced);
};
const shouldAwaitMoreStructuredBatchResult = (params) => {
    if (!params.expectedShape || params.parseable) {
        return false;
    }
    if (params.recoveryAbortReason) {
        return true;
    }
    const trimmed = params.text.trim();
    if (!trimmed) {
        return params.initialCandidateCount === 0 || params.transcriptCandidateCount === 0;
    }
    if (detectBatchInfrastructureFailureText(trimmed)) {
        return false;
    }
    return (looksLikeStructuredBatchResultText(trimmed, params.expectedShape)
        || /^(reviewing|checking|searching|finding|looking|investigating)\b/i.test(trimmed)
        || /^i['’]m\s+(reviewing|checking|searching|finding|looking|investigating)\b/i.test(trimmed));
};
const isStructuredBatchRecoveryAbortReason = (reason, expectedShape) => {
    const normalized = reason?.trim().toLowerCase() ?? '';
    if (!normalized || !expectedShape) {
        return false;
    }
    if (normalized.includes('json was captured from the stream')) {
        return true;
    }
    if (normalized.includes('recover locally') || normalized.includes('current transcript')) {
        return true;
    }
    if (expectedShape === 'planner' && normalized.includes('return the current plan as json')) {
        return true;
    }
    return false;
};
const extractStructuredBatchRecoveryAbortReason = (lines, expectedShape) => {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (!line || line.event !== 'prompt_abort' || typeof line.payload !== 'string') {
            continue;
        }
        try {
            const payload = JSON.parse(line.payload);
            const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
            if (reason && isStructuredBatchRecoveryAbortReason(reason, expectedShape)) {
                return reason;
            }
        }
        catch {
            continue;
        }
    }
    return undefined;
};
const appendTranscriptChunk = (chunks, chunk) => {
    const normalized = collapseRepeatedTranscriptText(chunk);
    if (!normalized) {
        return;
    }
    const assembled = chunks.join('');
    if (!assembled) {
        chunks.push(normalized);
        return;
    }
    if (assembled.endsWith(normalized)) {
        return;
    }
    const overlap = findTranscriptChunkOverlap(assembled, normalized);
    const suffix = overlap > 0 ? normalized.slice(overlap) : normalized;
    if (suffix) {
        chunks.push(suffix);
    }
};
const looksLikeStructuredBatchResultText = (text, expectedShape) => {
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('```json')) {
        return true;
    }
    switch (expectedShape) {
        case 'planner':
            return trimmed.includes('"coverage"') || trimmed.includes('"items"');
        case 'plan_review':
            return trimmed.includes('"verdict"') || trimmed.includes('"delta"') || trimmed.includes('"requestedChanges"');
        case 'worker':
            return trimmed.includes('"executedItems"') || trimmed.includes('"discoveredWork"');
        case 'final_review':
            return trimmed.includes('"verdict"') || trimmed.includes('"delta"') || trimmed.includes('"allPbisMapped"');
        default:
            return false;
    }
};
const shouldRetryReviewWithFreshSession = (resolution) => {
    if (resolution.parseable) {
        return false;
    }
    const trimmed = resolution.text.trim();
    if (!trimmed) {
        return resolution.initialCandidateCount === 0 && resolution.transcriptCandidateCount === 0;
    }
    if (detectBatchInfrastructureFailureText(trimmed)) {
        return false;
    }
    return looksLikeStructuredBatchResultText(trimmed, 'plan_review')
        || /^(reviewing|checking|searching|finding|looking|investigating)\b/i.test(trimmed)
        || /^i['’]m\s+(reviewing|checking|searching|finding|looking|investigating)\b/i.test(trimmed);
};
class BatchAnalysisTerminalError extends Error {
    terminalStage;
    terminalStatus;
    constructor(message, terminalStage, terminalStatus) {
        super(message);
        this.terminalStage = terminalStage;
        this.terminalStatus = terminalStatus;
        this.name = 'BatchAnalysisTerminalError';
    }
}
const PLAN_HUMAN_REVIEW_GUIDANCE = 'Review the batch plan and plan-review delta in Batch Analysis; no proposal review items were created.';
const buildPlanHumanReviewMessage = (summary) => {
    const trimmed = summary?.trim();
    if (!trimmed) {
        return `Batch plan requires human review before execution. ${PLAN_HUMAN_REVIEW_GUIDANCE}`;
    }
    return /[.!?]$/.test(trimmed)
        ? `${trimmed} ${PLAN_HUMAN_REVIEW_GUIDANCE}`
        : `${trimmed}. ${PLAN_HUMAN_REVIEW_GUIDANCE}`;
};
const detectBatchInfrastructureFailureText = (text) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('```')) {
        return null;
    }
    const normalized = trimmed.toLowerCase();
    const looksLikeExplicitError = /^error\b/i.test(trimmed)
        || /^failed\b/i.test(trimmed)
        || normalized.includes('provider error')
        || normalized.includes('runtime error')
        || normalized.includes('transport error');
    const infrastructureSignals = [
        'resource_exhausted',
        'rate limit',
        'rate_limit',
        'temporarily unavailable',
        'service unavailable',
        'server overloaded',
        'internal server error',
        'network error',
        'connection reset',
        'connection aborted',
        'timeout',
        'timed out'
    ];
    if (!looksLikeExplicitError && !infrastructureSignals.some((signal) => normalized.includes(signal))) {
        return null;
    }
    const codeMatch = trimmed.match(/\[([a-z0-9_:-]+)\]/i);
    return {
        message: trimmed,
        code: codeMatch?.[1]?.trim().toLowerCase() || undefined
    };
};
const detectPlannerInfrastructureFailure = (resultStatus, resolution) => {
    const trimmed = resolution.text.trim();
    if (resolution.parseable || Boolean(salvagePlannerJsonText(trimmed))) {
        return null;
    }
    if (resolution.recoveryAbortReason && trimmed && !detectBatchInfrastructureFailureText(trimmed)) {
        return null;
    }
    if (resultStatus === 'error' || resultStatus === 'timeout') {
        return {
            message: trimmed || `Planner runtime returned status "${resultStatus}".`
        };
    }
    return detectBatchInfrastructureFailureText(resolution.text);
};
const shouldRetryPlannerWithFreshSession = (resolution) => {
    if (resolution.parseable) {
        return false;
    }
    const trimmed = resolution.text.trim();
    if (!trimmed) {
        return true;
    }
    if (detectBatchInfrastructureFailureText(trimmed)) {
        return false;
    }
    return !salvagePlannerJsonText(trimmed) && trimmed.length < 3_000;
};
const plannerOutputLooksStructuredButIncomplete = (text) => {
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }
    return trimmed.startsWith('{')
        || trimmed.startsWith('```json')
        || trimmed.includes('"coverage"')
        || trimmed.includes('"items"');
};
const normalizeRecoveredJsonText = (text) => {
    const extracted = extractJsonObject(text);
    return extracted ? JSON.stringify(extracted) : null;
};
const extractJsonStringField = (text, fieldName) => {
    const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`"${escapedField}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 's').exec(text);
    if (!match) {
        return null;
    }
    try {
        return JSON.parse(`"${match[1]}"`);
    }
    catch {
        return match[1];
    }
};
const extractJsonBooleanField = (text, fieldName) => {
    const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`"${escapedField}"\\s*:\\s*(true|false)`, 's').exec(text);
    if (!match) {
        return null;
    }
    return match[1] === 'true';
};
const findJsonArrayStart = (text, fieldName) => {
    const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`"${escapedField}"\\s*:\\s*\\[`, 's').exec(text);
    return match ? match.index + match[0].length - 1 : -1;
};
const extractCompleteJsonObjectsFromArray = (text, fieldName) => {
    const arrayStart = findJsonArrayStart(text, fieldName);
    if (arrayStart < 0) {
        return [];
    }
    const results = [];
    let inString = false;
    let escaped = false;
    let depth = 0;
    let objectStart = -1;
    for (let index = arrayStart + 1; index < text.length; index += 1) {
        const char = text[index];
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
                objectStart = index;
            }
            depth += 1;
            continue;
        }
        if (char === '}' && depth > 0) {
            depth -= 1;
            if (depth === 0 && objectStart >= 0) {
                try {
                    const parsed = JSON.parse(text.slice(objectStart, index + 1));
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        results.push(parsed);
                    }
                }
                catch {
                    // ignore incomplete object candidates
                }
                objectStart = -1;
            }
            continue;
        }
        if (char === ']' && depth === 0) {
            break;
        }
    }
    return results;
};
const extractCompleteJsonStringsFromArray = (text, fieldName) => {
    const arrayStart = findJsonArrayStart(text, fieldName);
    if (arrayStart < 0) {
        return [];
    }
    const results = [];
    let inString = false;
    let escaped = false;
    let stringStart = -1;
    for (let index = arrayStart + 1; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === '\\') {
                escaped = true;
                continue;
            }
            if (char === '"') {
                try {
                    results.push(JSON.parse(text.slice(stringStart, index + 1)));
                }
                catch {
                    // ignore malformed string fragments
                }
                inString = false;
                stringStart = -1;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
            stringStart = index;
            continue;
        }
        if (char === ']') {
            break;
        }
    }
    return results;
};
const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normalizeRecoveredPlannerTargetId = (value) => {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return UUID_LIKE_PATTERN.test(trimmed) ? trimmed : undefined;
};
const recoveredPlannerItemLooksLikeCreate = (item) => {
    const title = typeof item.targetTitle === 'string' ? item.targetTitle.trim().toLowerCase() : '';
    const reason = typeof item.reason === 'string' ? item.reason.trim().toLowerCase() : '';
    const combined = `${title} ${reason}`.trim();
    return title.startsWith('create')
        || title.startsWith('add')
        || title.startsWith('new')
        || /\bnet new\b/.test(combined)
        || /\bnew article\b/.test(combined)
        || /\bcreate\b/.test(combined)
        || /\bintroduc(?:e|ing|tion)\b/.test(combined);
};
const salvagePlannerJsonText = (text) => {
    const summary = extractJsonStringField(text, 'summary');
    const rawCoverage = extractCompleteJsonObjectsFromArray(text, 'coverage');
    const rawItems = extractCompleteJsonObjectsFromArray(text, 'items');
    const openQuestions = extractCompleteJsonStringsFromArray(text, 'openQuestions');
    const items = rawItems
        .filter((item) => typeof item.planItemId === 'string'
        && Array.isArray(item.pbiIds)
        && typeof item.action === 'string'
        && typeof item.targetType === 'string'
        && typeof item.targetTitle === 'string'
        && typeof item.reason === 'string')
        .map((item) => {
        const rawAction = typeof item.action === 'string' ? item.action : 'no_impact';
        const retainedTargetArticleId = normalizeRecoveredPlannerTargetId(item.targetArticleId);
        const retainedTargetFamilyId = normalizeRecoveredPlannerTargetId(item.targetFamilyId);
        const hasRetainedArticleTarget = Boolean(retainedTargetArticleId || retainedTargetFamilyId);
        const promoteToCreate = rawAction === 'no_impact'
            && !hasRetainedArticleTarget
            && recoveredPlannerItemLooksLikeCreate(item);
        const action = rawAction === 'create' || rawAction === 'edit' || rawAction === 'retire' || rawAction === 'no_impact'
            ? rawAction
            : 'no_impact';
        const normalizedAction = promoteToCreate ? 'create' : action;
        const rawTargetType = typeof item.targetType === 'string' ? item.targetType : 'unknown';
        const targetType = normalizedAction === 'create'
            ? 'new_article'
            : rawTargetType === 'article' && !hasRetainedArticleTarget
                ? 'unknown'
                : rawTargetType === 'article'
                    || rawTargetType === 'article_family'
                    || rawTargetType === 'article_set'
                    || rawTargetType === 'new_article'
                    || rawTargetType === 'unknown'
                    ? rawTargetType
                    : 'unknown';
        return {
            planItemId: item.planItemId,
            pbiIds: item.pbiIds.filter((value) => typeof value === 'string'),
            action: normalizedAction,
            targetType,
            ...(retainedTargetArticleId ? { targetArticleId: retainedTargetArticleId } : {}),
            ...(retainedTargetFamilyId ? { targetFamilyId: retainedTargetFamilyId } : {}),
            targetTitle: item.targetTitle,
            reason: item.reason,
            evidence: Array.isArray(item.evidence)
                ? item.evidence.filter((evidence) => evidence
                    && typeof evidence === 'object'
                    && typeof evidence.kind === 'string'
                    && typeof evidence.ref === 'string'
                    && typeof evidence.summary === 'string')
                : [],
            confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
            dependsOn: Array.isArray(item.dependsOn)
                ? item.dependsOn.filter((value) => typeof value === 'string')
                : [],
            executionStatus: typeof item.executionStatus === 'string' ? item.executionStatus : 'pending'
        };
    });
    if (items.length === 0) {
        return null;
    }
    const itemIds = new Set(items.map((item) => item.planItemId));
    const coverage = rawCoverage
        .filter((entry) => typeof entry.pbiId === 'string' && typeof entry.outcome === 'string')
        .map((entry) => ({
        ...entry,
        planItemIds: Array.isArray(entry.planItemIds)
            ? entry.planItemIds.filter((value) => typeof value === 'string' && itemIds.has(value))
            : []
    }))
        .filter((entry) => entry.planItemIds.length > 0);
    if (coverage.length === 0) {
        return null;
    }
    const normalizedItems = items.map((item) => ({
        ...item,
        dependsOn: item.dependsOn.filter((dependencyId) => itemIds.has(dependencyId) && dependencyId !== item.planItemId)
    }));
    return JSON.stringify({
        summary: summary ?? 'Recovered planner draft from truncated output.',
        coverage,
        items: normalizedItems,
        openQuestions
    });
};
const summarizePlannerRecoveryContext = (text) => {
    const normalized = text.trim();
    const salvaged = salvagePlannerJsonText(normalized);
    if (salvaged) {
        return salvaged;
    }
    const summary = extractJsonStringField(normalized, 'summary');
    const coverage = extractCompleteJsonObjectsFromArray(normalized, 'coverage')
        .filter((entry) => typeof entry.pbiId === 'string')
        .slice(0, 12)
        .map((entry) => ({
        pbiId: entry.pbiId,
        outcome: entry.outcome,
        planItemIds: Array.isArray(entry.planItemIds) ? entry.planItemIds : []
    }));
    const items = extractCompleteJsonObjectsFromArray(normalized, 'items')
        .filter((entry) => typeof entry.planItemId === 'string')
        .slice(0, 12)
        .map((entry) => ({
        planItemId: entry.planItemId,
        pbiIds: Array.isArray(entry.pbiIds) ? entry.pbiIds : [],
        action: entry.action,
        targetTitle: entry.targetTitle,
        targetArticleId: entry.targetArticleId,
        targetFamilyId: entry.targetFamilyId,
        confidence: entry.confidence
    }));
    const openQuestions = extractCompleteJsonStringsFromArray(normalized, 'openQuestions').slice(0, 12);
    if (summary || coverage.length > 0 || items.length > 0 || openQuestions.length > 0) {
        return JSON.stringify({
            summary: summary ?? 'Recovered partial planner draft context.',
            coverage,
            items,
            openQuestions
        }, null, 2);
    }
    return normalized.slice(0, 6_000);
};
const salvagePlanReviewJsonText = (text) => {
    const normalized = normalizeRecoveredJsonText(text);
    if (normalized) {
        const parsed = extractJsonObject(normalized);
        if (parsed && matchesExpectedBatchResultShape(parsed, 'plan_review')) {
            return normalized;
        }
    }
    const summary = extractJsonStringField(text, 'summary');
    const verdict = extractJsonStringField(text, 'verdict');
    const requestedChanges = extractCompleteJsonStringsFromArray(text, 'requestedChanges');
    const missingPbiIds = extractCompleteJsonStringsFromArray(text, 'missingPbiIds');
    const missingCreates = extractCompleteJsonStringsFromArray(text, 'missingCreates');
    const missingEdits = extractCompleteJsonStringsFromArray(text, 'missingEdits');
    const additionalArticleWork = extractCompleteJsonStringsFromArray(text, 'additionalArticleWork');
    const targetCorrections = extractCompleteJsonStringsFromArray(text, 'targetCorrections');
    const overlapConflicts = extractCompleteJsonStringsFromArray(text, 'overlapConflicts');
    const hasAnyStructuredSignal = typeof summary === 'string'
        || typeof verdict === 'string'
        || requestedChanges.length > 0
        || missingPbiIds.length > 0
        || missingCreates.length > 0
        || missingEdits.length > 0
        || additionalArticleWork.length > 0
        || targetCorrections.length > 0
        || overlapConflicts.length > 0;
    if (!hasAnyStructuredSignal) {
        return null;
    }
    return JSON.stringify({
        summary: summary ?? 'Recovered plan review output from truncated response.',
        verdict: verdict === 'approved' || verdict === 'needs_human_review' ? verdict : 'needs_revision',
        didAccountForEveryPbi: extractJsonBooleanField(text, 'didAccountForEveryPbi') ?? false,
        hasMissingCreates: extractJsonBooleanField(text, 'hasMissingCreates') ?? (missingCreates.length > 0),
        hasMissingEdits: extractJsonBooleanField(text, 'hasMissingEdits') ?? (missingEdits.length > 0),
        hasTargetIssues: extractJsonBooleanField(text, 'hasTargetIssues') ?? (targetCorrections.length > 0),
        hasOverlapOrConflict: extractJsonBooleanField(text, 'hasOverlapOrConflict') ?? (overlapConflicts.length > 0),
        foundAdditionalArticleWork: extractJsonBooleanField(text, 'foundAdditionalArticleWork') ?? (additionalArticleWork.length > 0),
        underScopedKbImpact: extractJsonBooleanField(text, 'underScopedKbImpact') ?? (missingCreates.length > 0
            || missingEdits.length > 0
            || additionalArticleWork.length > 0),
        delta: {
            summary: summary ?? 'Recovered plan review output from truncated response.',
            requestedChanges,
            missingPbiIds,
            missingCreates,
            missingEdits,
            additionalArticleWork,
            targetCorrections,
            overlapConflicts
        }
    });
};
const buildMalformedPlanReviewFallback = (summary, verdict = 'needs_human_review') => JSON.stringify({
    summary,
    verdict,
    didAccountForEveryPbi: false,
    hasMissingCreates: false,
    hasMissingEdits: false,
    hasTargetIssues: false,
    hasOverlapOrConflict: false,
    foundAdditionalArticleWork: false,
    underScopedKbImpact: false,
    delta: {
        summary,
        requestedChanges: [],
        missingPbiIds: [],
        missingCreates: [],
        missingEdits: [],
        additionalArticleWork: [],
        targetCorrections: [],
        overlapConflicts: []
    }
});
const buildMalformedFinalReviewFallback = (summary) => JSON.stringify({
    summary,
    verdict: 'needs_human_review',
    allPbisMapped: false,
    planExecutionComplete: false,
    hasMissingArticleChanges: false,
    hasUnresolvedDiscoveredWork: false,
    delta: {
        summary,
        requestedRework: [],
        uncoveredPbiIds: [],
        missingArticleChanges: [],
        duplicateRiskTitles: [],
        unnecessaryChanges: [],
        unresolvedAmbiguities: []
    }
});
const STAGE_EVENT_TEXT_PREVIEW_LIMIT = 1_200;
const buildStageEventTextPreview = (value, limit = STAGE_EVENT_TEXT_PREVIEW_LIMIT) => {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim();
    if (!normalized) {
        return undefined;
    }
    return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
};
const isPromptRequestTranscriptLine = (line) => {
    if (line.direction !== 'to_agent' || line.event !== 'request') {
        return false;
    }
    try {
        const parsed = JSON.parse(line.payload);
        return parsed.method === 'session/prompt';
    }
    catch {
        return false;
    }
};
const extractTranscriptResultTextCandidates = (lines, scope = 'latest_request') => {
    const relevantLines = scope === 'all'
        ? lines
        : (() => {
            const reversedIndex = [...lines].reverse().findIndex((line) => isPromptRequestTranscriptLine(line));
            if (reversedIndex < 0) {
                return lines;
            }
            const lastRequestIndex = lines.length - reversedIndex - 1;
            return lines.slice(lastRequestIndex + 1);
        })();
    const chunkParts = [];
    const rawChunkParts = [];
    const candidates = [];
    for (const line of relevantLines) {
        if (line.direction !== 'from_agent') {
            continue;
        }
        if (line.event === 'response') {
            try {
                const parsed = JSON.parse(line.payload);
                candidates.push(...extractResultTextCandidates(parsed.result));
            }
            catch {
                // ignore malformed transcript response lines
            }
            continue;
        }
        if (line.event === 'session_update') {
            try {
                const parsed = JSON.parse(line.payload);
                if (parsed.update?.sessionUpdate === 'agent_message_chunk' && typeof parsed.update.content?.text === 'string') {
                    rawChunkParts.push(parsed.update.content.text);
                    appendTranscriptChunk(chunkParts, parsed.update.content.text);
                }
            }
            catch {
                // ignore malformed transcript update lines
            }
        }
    }
    if (chunkParts.length > 0) {
        candidates.push(chunkParts.join(''));
    }
    if (rawChunkParts.length > 0) {
        candidates.push(rawChunkParts.join('').trim());
    }
    return dedupeResultTextCandidates(candidates.map((value) => value.trim()).filter(Boolean));
};
const extractResultText = (payload) => selectBestResultText(extractResultTextCandidates(payload));
exports.__commandRegistryTestables = {
    buildPlannerTopicClusters,
    extractTranscriptResultTextCandidates,
    extractStructuredBatchRecoveryAbortReason,
    summarizePlannerRecoveryContext,
    salvagePlannerJsonText,
    salvagePlanReviewJsonText,
    evaluateBatchAnalysisDevBuildFreshness,
    detectPlannerInfrastructureFailure,
    shouldRetryPlannerWithFreshSession,
    selectBestResultText,
    selectBestParseableResultText,
    matchesExpectedBatchResultShape,
    shouldRetryReviewWithFreshSession
};
const ARTICLE_AI_PRESET_PROMPTS = {
    [shared_types_1.ArticleAiPresetAction.REWRITE_TONE]: 'Rewrite the article for clearer tone and readability while preserving factual meaning.',
    [shared_types_1.ArticleAiPresetAction.SHORTEN]: 'Shorten the article by removing repetition and tightening wording without losing key steps.',
    [shared_types_1.ArticleAiPresetAction.EXPAND]: 'Expand the article with missing context, examples, and step detail where it will help users succeed.',
    [shared_types_1.ArticleAiPresetAction.RESTRUCTURE]: 'Restructure the article into a clearer section flow and improve heading hierarchy.',
    [shared_types_1.ArticleAiPresetAction.CONVERT_TO_TROUBLESHOOTING]: 'Convert the article into a troubleshooting format with symptoms, causes, and resolutions.',
    [shared_types_1.ArticleAiPresetAction.ALIGN_TO_TEMPLATE]: 'Align the article to the selected template pack while keeping accurate product content.',
    [shared_types_1.ArticleAiPresetAction.UPDATE_LOCALE]: 'Adapt the article for the requested target locale while keeping terminology and structure consistent.',
    [shared_types_1.ArticleAiPresetAction.INSERT_IMAGE_PLACEHOLDERS]: 'Insert helpful image placeholders where screenshots would improve comprehension.',
    [shared_types_1.ArticleAiPresetAction.FREEFORM]: 'Apply the user request directly.'
};
function extractJsonObject(text) {
    const trimmed = text.trim();
    if (!trimmed) {
        return null;
    }
    const normalizedCandidates = [
        trimmed,
        trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '')
    ];
    const parsedCandidates = [];
    const scoreCandidate = (value) => {
        let score = 0;
        if (typeof value.summary === 'string') {
            score += 3;
        }
        if (Array.isArray(value.coverage)) {
            score += 4;
        }
        if (Array.isArray(value.items)) {
            score += 4;
        }
        if (typeof value.verdict === 'string') {
            score += 3;
        }
        if (value.delta && typeof value.delta === 'object') {
            score += 2;
        }
        if (Array.isArray(value.discoveredWork)) {
            score += 3;
        }
        if (typeof value.updatedHtml === 'string') {
            score += 3;
        }
        return score;
    };
    const balancedCandidates = (value) => {
        const candidates = [];
        let start = -1;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = 0; index < value.length; index += 1) {
            const char = value[index];
            if (inString) {
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (char === '\\') {
                    escaped = true;
                    continue;
                }
                if (char === '"') {
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
                    candidates.push(value.slice(start, index + 1));
                    start = -1;
                    if (candidates.length >= 24) {
                        break;
                    }
                }
            }
        }
        return candidates;
    };
    for (const candidate of normalizedCandidates) {
        for (const jsonCandidate of [candidate, ...balancedCandidates(candidate)]) {
            try {
                const parsed = JSON.parse(jsonCandidate);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    parsedCandidates.push({
                        score: scoreCandidate(parsed),
                        value: parsed
                    });
                }
            }
            catch {
                // try next candidate
            }
        }
    }
    if (parsedCandidates.length === 0) {
        return null;
    }
    parsedCandidates.sort((left, right) => right.score - left.score);
    return parsedCandidates[0]?.value ?? null;
}
const resolveBatchAnalysisResultText = async (agentRuntime, workspaceId, sessionId, payload, expectedShape) => {
    const initialCandidates = extractResultTextCandidates(payload);
    const initialBest = selectBestParseableResultText(initialCandidates, expectedShape)
        || selectBestResultText(initialCandidates, expectedShape);
    const initialParsed = extractJsonObject(initialBest);
    if (initialParsed && matchesExpectedBatchResultShape(initialParsed, expectedShape)) {
        return {
            text: initialBest,
            usedTranscript: false,
            initialCandidateCount: initialCandidates.length,
            transcriptCandidateCount: 0,
            parseable: true
        };
    }
    if (!sessionId) {
        return {
            text: initialBest,
            usedTranscript: false,
            initialCandidateCount: initialCandidates.length,
            transcriptCandidateCount: 0,
            parseable: false
        };
    }
    const transcript = await agentRuntime.getTranscripts({
        workspaceId,
        sessionId,
        limit: 0
    });
    let transcriptLines = transcript.lines;
    let recoveryAbortReason = extractStructuredBatchRecoveryAbortReason(transcriptLines, expectedShape);
    let latestTranscriptCandidates = extractTranscriptResultTextCandidates(transcriptLines, 'latest_request');
    let transcriptCandidates = latestTranscriptCandidates.length > 0
        ? latestTranscriptCandidates
        : extractTranscriptResultTextCandidates(transcriptLines, 'all');
    let combinedCandidates = [...initialCandidates, ...transcriptCandidates];
    let resolved = selectBestParseableResultText(combinedCandidates, expectedShape)
        || selectBestResultText(combinedCandidates, expectedShape);
    let resolvedParsed = extractJsonObject(resolved);
    let parseable = Boolean(resolvedParsed && matchesExpectedBatchResultShape(resolvedParsed, expectedShape));
    if (shouldAwaitMoreStructuredBatchResult({
        text: resolved,
        expectedShape,
        parseable,
        initialCandidateCount: initialCandidates.length,
        transcriptCandidateCount: transcriptCandidates.length,
        recoveryAbortReason
    })) {
        const waitStartedAt = Date.now();
        let lastTranscriptSeq = getLastTranscriptSequence(transcriptLines);
        let lastTranscriptChangeAt = Date.now();
        const recoveryWaitEnabled = expectedShape === 'planner' && Boolean(recoveryAbortReason);
        const maxWaitMs = recoveryWaitEnabled
            ? STRUCTURED_BATCH_PLANNER_RECOVERY_MAX_WAIT_MS
            : STRUCTURED_BATCH_RESULT_MAX_WAIT_MS;
        const idleMs = recoveryWaitEnabled
            ? STRUCTURED_BATCH_PLANNER_RECOVERY_IDLE_MS
            : STRUCTURED_BATCH_RESULT_IDLE_MS;
        while (Date.now() - waitStartedAt < maxWaitMs
            && Date.now() - lastTranscriptChangeAt < idleMs
            && !parseable) {
            await new Promise((resolve) => setTimeout(resolve, STRUCTURED_BATCH_RESULT_POLL_INTERVAL_MS));
            const nextTranscript = await agentRuntime.getTranscripts({
                workspaceId,
                sessionId,
                limit: 0
            });
            const nextTranscriptSeq = getLastTranscriptSequence(nextTranscript.lines);
            if (nextTranscriptSeq === lastTranscriptSeq) {
                continue;
            }
            lastTranscriptSeq = nextTranscriptSeq;
            lastTranscriptChangeAt = Date.now();
            transcriptLines = nextTranscript.lines;
            recoveryAbortReason = extractStructuredBatchRecoveryAbortReason(transcriptLines, expectedShape);
            latestTranscriptCandidates = extractTranscriptResultTextCandidates(transcriptLines, 'latest_request');
            transcriptCandidates =
                latestTranscriptCandidates.length > 0
                    ? latestTranscriptCandidates
                    : extractTranscriptResultTextCandidates(transcriptLines, 'all');
            combinedCandidates = [...initialCandidates, ...transcriptCandidates];
            resolved = selectBestParseableResultText(combinedCandidates, expectedShape)
                || selectBestResultText(combinedCandidates, expectedShape);
            resolvedParsed = extractJsonObject(resolved);
            parseable = Boolean(resolvedParsed && matchesExpectedBatchResultShape(resolvedParsed, expectedShape));
        }
    }
    return {
        text: resolved,
        usedTranscript: transcriptCandidates.length > 0 && transcriptCandidates.includes(resolved),
        initialCandidateCount: initialCandidates.length,
        transcriptCandidateCount: transcriptCandidates.length,
        parseable,
        recoveryAbortReason
    };
};
const summarizeWorkerExecutionFallback = (fallbackSummary, proposalQueue) => {
    if (proposalQueue.length === 0) {
        return fallbackSummary;
    }
    const actionCounts = proposalQueue.reduce((counts, proposal) => {
        counts[proposal.action] = (counts[proposal.action] ?? 0) + 1;
        return counts;
    }, {});
    const actionSummary = ['create', 'edit', 'retire']
        .filter((action) => (actionCounts[action] ?? 0) > 0)
        .map((action) => `${actionCounts[action]} ${action}`)
        .join(', ');
    const previewTitles = proposalQueue
        .slice(0, 3)
        .map((proposal) => proposal.articleLabel.trim())
        .filter(Boolean);
    const titleSummary = previewTitles.length > 0
        ? ` for ${previewTitles.map((title) => `\`${title}\``).join(', ')}`
        : '';
    const remainingCount = proposalQueue.length - previewTitles.length;
    const remainingSummary = remainingCount > 0 ? ` and ${remainingCount} more` : '';
    return `Worker execution completed with ${proposalQueue.length} persisted proposal${proposalQueue.length === 1 ? '' : 's'} (${actionSummary})${titleSummary}${remainingSummary}.`;
};
function parseArticleAiResult(resultPayload) {
    const candidates = [];
    if (typeof resultPayload === 'string') {
        candidates.push(resultPayload);
    }
    else if (resultPayload && typeof resultPayload === 'object') {
        candidates.push(JSON.stringify(resultPayload));
        const payload = resultPayload;
        if (typeof payload.text === 'string') {
            candidates.push(payload.text);
        }
        if (Array.isArray(payload.content)) {
            for (const part of payload.content) {
                if (part && typeof part === 'object' && typeof part.text === 'string') {
                    candidates.push(part.text);
                }
            }
        }
    }
    for (const candidate of candidates) {
        const parsed = extractJsonObject(candidate);
        const updatedHtml = typeof parsed?.updatedHtml === 'string' ? parsed.updatedHtml.trim() : '';
        const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
        if (updatedHtml) {
            return {
                updatedHtml,
                summary: summary || 'AI suggested an article update.',
                rationale: typeof parsed?.rationale === 'string' ? parsed.rationale.trim() : undefined
            };
        }
    }
    return null;
}
function buildArticleAiPrompt(params) {
    const transcript = params.session.messages
        .slice(-8)
        .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
        .join('\n');
    const presetInstruction = ARTICLE_AI_PRESET_PROMPTS[params.request.presetAction ?? shared_types_1.ArticleAiPresetAction.FREEFORM];
    return [
        presetInstruction,
        params.request.targetLocale ? `Target locale: ${params.request.targetLocale}` : '',
        params.templatePrompt ? `Template pack guidance:\n${params.templatePrompt}` : '',
        transcript ? `Recent article chat:\n${transcript}` : '',
        'Current article HTML follows. Produce an improved version as `updatedHtml`.',
        `Current article HTML:\n${params.currentHtml}`,
        `User request: ${params.request.message.trim()}`
    ].filter(Boolean).join('\n\n');
}
function registerCoreCommands(bus, jobs, workspaceRoot, emitAppWorkingStateEvent, emitAiAssistantEvent) {
    const workspaceRepository = new workspace_repository_1.WorkspaceRepository(workspaceRoot);
    const batchAnalysisOrchestrator = new batch_analysis_orchestrator_1.BatchAnalysisOrchestrator(workspaceRepository);
    const zendeskSyncService = new zendesk_sync_service_1.ZendeskSyncService(workspaceRepository);
    const pbiBatchImportService = new pbi_batch_import_service_1.PBIBatchImportService(workspaceRepository);
    const defaultKbAccessMode = 'mcp';
    const validRevisionStates = new Set(Object.values(shared_types_1.RevisionState));
    const validRevisionStatuses = new Set(Object.values(shared_types_1.RevisionStatus));
    const validPBIScopeModes = new Set([shared_types_1.PBIBatchScopeMode.ALL, shared_types_1.PBIBatchScopeMode.SELECTED_ONLY]);
    const validPBIBatchStatuses = new Set(Object.values(shared_types_1.PBIBatchStatus));
    const validPBIValidationStatuses = new Set(Object.values(shared_types_1.PBIValidationStatus));
    const validDraftBranchStatuses = new Set(Object.values(shared_types_1.DraftBranchStatus));
    const runtimeToolContext = {
        searchKb: async (input) => {
            return workspaceRepository.searchArticles(input.workspaceId, {
                workspaceId: input.workspaceId,
                query: input.query,
                localeVariantIds: input.localeVariantIds,
                familyIds: input.familyIds,
                revisionIds: input.revisionIds,
                scope: 'all',
                includeArchived: input.includeArchived ?? true
            });
        },
        getExplorerTree: async (workspaceId) => {
            return workspaceRepository.getExplorerTree(workspaceId);
        },
        getArticle: async (input) => {
            return workspaceRepository.getArticleDetail(input.workspaceId, {
                workspaceId: input.workspaceId,
                revisionId: input.revisionId,
                localeVariantId: input.localeVariantId,
                includePublishLog: true,
                includeLineage: true
            });
        },
        getArticleFamily: async (input) => {
            return workspaceRepository.getArticleFamily(input.workspaceId, input.familyId);
        },
        getLocaleVariant: async (input) => {
            return workspaceRepository.getLocaleVariant(input.workspaceId, input.localeVariantId);
        },
        getAppFormSchema: async (input) => {
            return appWorkingStateService.getFormSchema(input);
        },
        patchAppForm: async (input) => {
            return (0, proposal_working_state_1.applyAppWorkingStatePatch)({
                workspaceRepository,
                appWorkingStateService,
                request: input
            });
        },
        findRelatedArticles: async (input) => {
            if (input.articleId || input.familyId || input.batchId) {
                return workspaceRepository.listArticleRelations(input.workspaceId, {
                    workspaceId: input.workspaceId,
                    localeVariantId: input.articleId,
                    familyId: input.familyId,
                    batchId: input.batchId,
                    limit: input.max,
                    minScore: input.minScore,
                    includeEvidence: input.includeEvidence
                });
            }
            if (input.query?.trim()) {
                const search = await workspaceRepository.searchArticles(input.workspaceId, {
                    workspaceId: input.workspaceId,
                    query: input.query,
                    scope: 'all',
                    includeArchived: true
                });
                const top = search.results[0];
                if (!top) {
                    return {
                        workspaceId: input.workspaceId,
                        seedFamilyIds: [],
                        total: 0,
                        relations: []
                    };
                }
                return workspaceRepository.listArticleRelations(input.workspaceId, {
                    workspaceId: input.workspaceId,
                    familyId: top.familyId,
                    limit: input.max,
                    minScore: input.minScore,
                    includeEvidence: input.includeEvidence
                });
            }
            return {
                workspaceId: input.workspaceId,
                seedFamilyIds: [],
                total: 0,
                relations: []
            };
        },
        listCategories: async (input) => {
            const client = await buildZendeskClient(input.workspaceId);
            const categories = await client.listCategories(input.locale.trim());
            return {
                ok: true,
                workspaceId: input.workspaceId,
                locale: input.locale,
                categories
            };
        },
        listSections: async (input) => {
            const client = await buildZendeskClient(input.workspaceId);
            const sections = await client.listSections(input.categoryId, input.locale.trim());
            return {
                ok: true,
                workspaceId: input.workspaceId,
                locale: input.locale,
                categoryId: input.categoryId,
                sections
            };
        },
        listArticleTemplates: async (input) => {
            const templates = await workspaceRepository.listTemplatePacks(input.workspaceId);
            return { workspaceId: input.workspaceId, templates };
        },
        getTemplate: async (input) => {
            return workspaceRepository.getTemplatePack(input.workspaceId, input.templatePackId);
        },
        getBatchContext: async (input) => {
            const context = await workspaceRepository.getBatchContext(input.workspaceId, input.batchId);
            if (!context) {
                throw new Error('batch not found');
            }
            return context;
        },
        getPBI: async (input) => {
            const pbi = await workspaceRepository.getPBIRecord(input.workspaceId, input.pbiId);
            if (!pbi) {
                throw new Error('pbi not found');
            }
            return pbi;
        },
        getPBISubset: async (input) => {
            return workspaceRepository.getPBISubset(input.workspaceId, input.batchId, input.rowNumbers);
        },
        getArticleHistory: async (input) => {
            return workspaceRepository.getHistory(input.workspaceId, input.localeVariantId);
        },
        recordAgentNotes: async (input) => workspaceRepository.recordAgentNotes(input),
        proposeCreateKb: async (input, context) => {
            if (!context.workspaceId) {
                throw new Error('workspaceId is required');
            }
            const batchId = input.batchId || context.batchId || '';
            const sessionId = input.sessionId || context.sessionId || '';
            if (!batchId) {
                throw new Error('batchId is required for create proposal');
            }
            const reviewStatus = context.batchId ? shared_types_1.ProposalReviewStatus.STAGED_ANALYSIS : shared_types_1.ProposalReviewStatus.PENDING_REVIEW;
            const created = await workspaceRepository.createAgentProposal({
                workspaceId: context.workspaceId,
                batchId,
                action: shared_types_1.ProposalAction.CREATE,
                reviewStatus,
                _sessionId: sessionId,
                originPath: 'batch_analysis',
                localeVariantId: input.localeVariantId,
                note: input.note,
                rationale: input.rationale,
                relatedPbiIds: input.pbiIds,
                metadata: input.metadata
            });
            return { ok: true, ...created };
        },
        proposeEditKb: async (input, context) => {
            if (!context.workspaceId) {
                throw new Error('workspaceId is required');
            }
            const batchId = input.batchId || context.batchId || '';
            const sessionId = input.sessionId || context.sessionId || '';
            if (!batchId) {
                throw new Error('batchId is required for edit proposal');
            }
            const reviewStatus = context.batchId ? shared_types_1.ProposalReviewStatus.STAGED_ANALYSIS : shared_types_1.ProposalReviewStatus.PENDING_REVIEW;
            const created = await workspaceRepository.createAgentProposal({
                workspaceId: context.workspaceId,
                batchId,
                action: shared_types_1.ProposalAction.EDIT,
                reviewStatus,
                _sessionId: sessionId,
                originPath: 'batch_analysis',
                localeVariantId: input.localeVariantId,
                note: input.note,
                rationale: input.rationale,
                relatedPbiIds: input.pbiIds,
                metadata: input.metadata
            });
            return { ok: true, ...created };
        },
        proposeRetireKb: async (input, context) => {
            if (!context.workspaceId) {
                throw new Error('workspaceId is required');
            }
            const batchId = input.batchId || context.batchId || '';
            const sessionId = input.sessionId || context.sessionId || '';
            if (!batchId) {
                throw new Error('batchId is required for retire proposal');
            }
            const reviewStatus = context.batchId ? shared_types_1.ProposalReviewStatus.STAGED_ANALYSIS : shared_types_1.ProposalReviewStatus.PENDING_REVIEW;
            const created = await workspaceRepository.createAgentProposal({
                workspaceId: context.workspaceId,
                batchId,
                action: shared_types_1.ProposalAction.RETIRE,
                reviewStatus,
                _sessionId: sessionId,
                originPath: 'batch_analysis',
                localeVariantId: input.localeVariantId,
                note: input.note,
                rationale: input.rationale,
                relatedPbiIds: input.pbiIds,
                metadata: input.metadata
            });
            return { ok: true, ...created };
        }
    };
    const appWorkingStateService = new app_working_state_service_1.AppWorkingStateService((event) => emitAppWorkingStateEvent?.(event));
    const kbCliLoopback = new kb_cli_loopback_service_1.KbCliLoopbackService(workspaceRepository, appWorkingStateService);
    const kbCliRuntime = new kb_cli_runtime_service_1.KbCliRuntimeService(kbCliLoopback, workspaceRepository);
    const noisyAgentRuntimeLogs = new Set([
        'agent.runtime.ensure_initialized_start',
        'agent.runtime.ensure_initialized_success',
        'agent.runtime.health_check_start',
        'agent.runtime.health_check_result',
        'agent.runtime.session_finalize_wait_begin',
        'agent.runtime.session_finalize_wait_complete',
        'agent.runtime.retry_cycle_begin',
        'agent.runtime.retry_attempt',
        'agent.runtime.retry_wait',
        'agent.runtime.session_new_start',
        'agent.runtime.session_new_success',
        'agent.runtime.session_set_model_success'
    ]);
    const agentRuntime = new agent_runtime_1.CursorAcpRuntime(workspaceRoot, runtimeToolContext, {
        prepareCliEnvironment: async (workspaceId) => kbCliRuntime.ensureReady(),
        getCliHealth: (workspaceId) => kbCliRuntime.checkHealth(workspaceId),
        buildCliPromptSuffix: () => kbCliRuntime.buildPromptSuffix(),
        getWorkspaceAgentModel: async (workspaceId) => {
            const settings = await workspaceRepository.getWorkspaceSettings(workspaceId);
            return settings.acpModelId;
        }
    }, (message, details) => {
        if (noisyAgentRuntimeLogs.has(message)) {
            return;
        }
        if (message.includes('failed')
            || message.includes('unreachable')
            || message.includes('timeout')
            || message.includes('violation')
            || message.includes('abort')) {
            logger_1.logger.warn(`[agent-runtime] ${message}`, details);
            return;
        }
        logger_1.logger.info(`[agent-runtime] ${message}`, details);
    });
    const resolveWorkspaceKbAccessMode = async (workspaceId) => {
        const settings = await workspaceRepository.getWorkspaceSettings(workspaceId);
        return settings.kbAccessMode || defaultKbAccessMode;
    };
    const inspectKbAccessMode = (workspaceId, requestedMode) => (0, kb_access_mode_resolver_1.resolveKbAccessModeSelection)({
        workspaceId,
        requestedMode,
        resolveWorkspaceKbAccessMode,
        agentRuntime
    });
    const requireHealthyKbAccessMode = (workspaceId, requestedMode) => (0, kb_access_mode_resolver_1.requireHealthyKbAccessModeSelection)({
        workspaceId,
        requestedMode,
        resolveWorkspaceKbAccessMode,
        agentRuntime
    });
    const aiAssistantService = new ai_assistant_service_1.AiAssistantService(workspaceRepository, agentRuntime, resolveWorkspaceKbAccessMode, appWorkingStateService, emitAiAssistantEvent);
    const buildZendeskClient = async (workspaceId) => {
        const settings = await workspaceRepository.getWorkspaceSettings(workspaceId);
        const credentials = await workspaceRepository.getZendeskCredentialsForSync(workspaceId);
        if (!credentials) {
            throw new Error('Zendesk credentials are not configured for this workspace');
        }
        return zendesk_client_1.ZendeskClient.fromConfig({ timeoutMs: 30_000 }, {
            subdomain: settings.zendeskSubdomain,
            email: credentials.email,
            apiToken: credentials.apiToken
        });
    };
    bus.register('workspace.getRouteConfig', async () => ({
        ok: true,
        data: {
            routes: shared_types_1.AppRoute
        }
    }));
    bus.register('workspace.getWorkspaceRoot', async () => ({
        ok: true,
        data: {
            workspaceRoot
        }
    }));
    bus.register('jobs.getActiveJobs', async () => ({
        ok: true,
        data: {
            jobs: jobs.list()
        }
    }));
    bus.register('agent.health.check', async (payload, requestId) => {
        const workspaceId = payload?.workspaceId;
        const requestedMode = payload?.kbAccessMode;
        if (!workspaceId) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'agent.health.check requires workspaceId');
        }
        const selection = await inspectKbAccessMode(workspaceId, requestedMode);
        const { workspaceMode, selectedMode, health } = selection;
        logger_1.logger.info('agent.health.check', {
            requestId,
            workspaceId,
            requestedMode,
            workspaceMode,
            selectedMode
        });
        logger_1.logger.info('agent.health.check.result', {
            requestId,
            workspaceId,
            selectedMode,
            availableModes: health.availableModes,
            issues: health.issues,
            providers: {
                mcp: {
                    ok: health.providers.mcp.ok,
                    failureCode: health.providers.mcp.failureCode,
                    message: health.providers.mcp.message,
                    bridgeConfigPresent: health.providers.mcp.bridgeConfigPresent,
                    bridgeReachable: health.providers.mcp.bridgeReachable,
                    toolsetReady: health.providers.mcp.toolsetReady,
                    missingToolNames: health.providers.mcp.missingToolNames
                },
                cli: {
                    ok: health.providers.cli.ok,
                    failureCode: health.providers.cli.failureCode,
                    message: health.providers.cli.message,
                    acpReachable: health.providers.cli.acpReachable
                }
            }
        });
        return { ok: true, data: health };
    });
    bus.register('agent.session.create', async (payload, requestId) => {
        const input = payload;
        try {
            const workspaceId = input?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'agent.session.create requires workspaceId');
            }
            if (!input.type) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'agent.session.create requires type');
            }
            const kbAccessMode = (0, kb_access_mode_resolver_1.selectKbAccessMode)(input.kbAccessMode, await resolveWorkspaceKbAccessMode(workspaceId));
            const session = agentRuntime.createSession({ ...input, kbAccessMode });
            logger_1.logger.info('agent.session.create', { requestId, sessionId: session.id });
            return { ok: true, data: session };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
        }
    });
    bus.register('agent.session.list', async (payload, requestId) => {
        const input = payload;
        try {
            const workspaceId = input?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'agent.session.list requires workspaceId');
            }
            logger_1.logger.info('agent.session.list', { requestId, workspaceId });
            return {
                ok: true,
                data: {
                    workspaceId,
                    sessions: agentRuntime.listSessions(workspaceId, Boolean(input?.includeClosed))
                }
            };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
        }
    });
    bus.register('agent.session.get', async (payload, requestId) => {
        const input = payload;
        try {
            const session = input?.sessionId
                ? agentRuntime.getSession(input.sessionId)
                : null;
            if (!session) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'session not found');
            }
            if (session.workspaceId !== input.workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'session not found');
            }
            logger_1.logger.info('agent.session.get', { requestId, workspaceId: input.workspaceId, sessionId: input.sessionId });
            return { ok: true, data: session };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
        }
    });
    bus.register('agent.session.close', async (payload, requestId) => {
        const input = payload;
        try {
            const workspaceId = input?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'agent.session.close requires workspaceId');
            }
            const existingSession = input?.sessionId ? agentRuntime.getSession(input.sessionId) : null;
            if (existingSession
                && existingSession.workspaceId === workspaceId
                && existingSession.type === 'batch_analysis'
                && (existingSession.status === 'running' || existingSession.status === 'starting')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'Running batch analysis sessions cannot be closed from the generic session panel.');
            }
            const session = agentRuntime.closeSession(input);
            logger_1.logger.info('agent.session.close', { requestId, workspaceId, sessionId: input.sessionId });
            if (!session) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'session not found');
            }
            return { ok: true, data: session };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
        }
    });
    bus.register('agent.transcript.get', async (payload) => {
        const input = payload;
        try {
            if (!input?.workspaceId || !input.sessionId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'agent.transcript.get requires workspaceId and sessionId');
            }
            return { ok: true, data: await agentRuntime.getTranscripts(input) };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
        }
    });
    bus.register('agent.tool.calls', async (payload) => {
        const input = payload;
        try {
            if (!input?.workspaceId || !input.sessionId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'agent.tool.calls requires workspaceId and sessionId');
            }
            const session = agentRuntime.getSession(input.sessionId);
            if (!session || session.workspaceId !== input.workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'session not found');
            }
            return {
                ok: true,
                data: {
                    workspaceId: input.workspaceId,
                    sessionId: input.sessionId,
                    toolCalls: agentRuntime.listToolCallAudit(input.sessionId, input.workspaceId)
                }
            };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
        }
    });
    bus.register('agent.analysis.latest', async (payload) => {
        const input = payload;
        try {
            if (!input?.workspaceId || !input.batchId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'agent.analysis.latest requires workspaceId and batchId');
            }
            const run = await workspaceRepository.getLatestBatchAnalysisRun(input.workspaceId, input.batchId);
            const orchestration = await workspaceRepository.getBatchAnalysisSnapshot(input.workspaceId, input.batchId);
            const lines = await readTranscriptLines(run?.transcriptPath, input.limit);
            const response = {
                workspaceId: input.workspaceId,
                batchId: input.batchId,
                run,
                lines,
                orchestration
            };
            return { ok: true, data: response };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
        }
    });
    bus.register('batch.analysis.snapshot.get', async (payload) => {
        const input = payload;
        try {
            if (!input?.workspaceId || !input.batchId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'batch.analysis.snapshot.get requires workspaceId and batchId');
            }
            return {
                ok: true,
                data: await workspaceRepository.getBatchAnalysisSnapshot(input.workspaceId, input.batchId)
            };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
        }
    });
    bus.register('batch.analysis.inspection.get', async (payload) => {
        const input = payload;
        try {
            if (!input?.workspaceId || !input.batchId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'batch.analysis.inspection.get requires workspaceId and batchId');
            }
            return {
                ok: true,
                data: await workspaceRepository.getBatchAnalysisInspection(input.workspaceId, input.batchId)
            };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
        }
    });
    bus.register('batch.analysis.runtime.get', async (payload) => {
        const input = payload;
        try {
            if (!input?.workspaceId || !input.batchId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'batch.analysis.runtime.get requires workspaceId and batchId');
            }
            return {
                ok: true,
                data: await workspaceRepository.getBatchAnalysisRuntimeStatus(input.workspaceId, input.batchId)
            };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
        }
    });
    bus.register('batch.analysis.events.get', async (payload) => {
        const input = payload;
        try {
            if (!input?.workspaceId || !input.batchId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'batch.analysis.events.get requires workspaceId and batchId');
            }
            return {
                ok: true,
                data: await workspaceRepository.getBatchAnalysisEventStream(input.workspaceId, input.batchId, input.limit)
            };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
        }
    });
    bus.register('workspace.create', async (payload, requestId) => {
        logger_1.logger.info('command workspace.create begin', { requestId });
        try {
            const input = payload;
            const required = ['name', 'zendeskSubdomain', 'defaultLocale'];
            if (!input || required.some((key) => !input[key])) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.create requires name, zendeskSubdomain, defaultLocale');
            }
            const created = await workspaceRepository.createWorkspace({
                name: input.name,
                zendeskSubdomain: input.zendeskSubdomain,
                defaultLocale: input.defaultLocale,
                enabledLocales: input.enabledLocales,
                path: input.path,
                zendeskBrandId: input.zendeskBrandId
            });
            logger_1.logger.info('command workspace.create success', {
                requestId,
                workspaceId: created.id
            });
            return {
                ok: true,
                data: created
            };
        }
        catch (error) {
            console.error('[command-error] workspace.create failed', {
                requestId,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            logger_1.logger.error('command workspace.create failed', {
                requestId,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.list', async (_payload, requestId) => {
        logger_1.logger.info('command workspace.list begin', { requestId });
        try {
            const workspaces = await workspaceRepository.getWorkspaceList();
            logger_1.logger.info('command workspace.list success', { requestId, count: workspaces.length });
            return {
                ok: true,
                data: { workspaces }
            };
        }
        catch (error) {
            console.error('[command-error] workspace.list failed', {
                requestId,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            logger_1.logger.error('command workspace.list failed', {
                requestId,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            if (error instanceof Error && error.message === 'Maximum call stack size exceeded') {
                return {
                    ok: true,
                    data: { workspaces: [] }
                };
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.get requires workspaceId');
            }
            const workspace = await workspaceRepository.getWorkspace(workspaceId);
            return { ok: true, data: workspace };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.settings.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.settings.get requires workspaceId');
            }
            const settings = await workspaceRepository.getWorkspaceSettings(workspaceId);
            return { ok: true, data: settings };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.settings.update', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.settings.update requires workspaceId');
            }
            if (input.zendeskSubdomain === undefined &&
                input.zendeskBrandId === undefined &&
                input.defaultLocale === undefined &&
                input.enabledLocales === undefined &&
                input.kbAccessMode === undefined &&
                input.agentModelId === undefined &&
                input.acpModelId === undefined) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.settings.update requires at least one setting field');
            }
            if (typeof input.defaultLocale === 'string' && !input.defaultLocale.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'defaultLocale cannot be empty');
            }
            if (typeof input.zendeskSubdomain === 'string' && !input.zendeskSubdomain.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendeskSubdomain cannot be empty');
            }
            if (Array.isArray(input.enabledLocales) && input.enabledLocales.length === 0) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'enabledLocales cannot be empty');
            }
            if (Array.isArray(input.enabledLocales) && input.enabledLocales.length && input.enabledLocales.some((locale) => !locale || !String(locale).trim())) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'enabledLocales must only contain non-empty values');
            }
            if (input.kbAccessMode !== undefined && input.kbAccessMode !== 'mcp' && input.kbAccessMode !== 'cli') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'kbAccessMode must be mcp or cli');
            }
            if (typeof input.agentModelId === 'string' && !input.agentModelId.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'agentModelId cannot be empty');
            }
            if (typeof input.acpModelId === 'string' && !input.acpModelId.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'acpModelId cannot be empty');
            }
            const updated = await workspaceRepository.updateWorkspaceSettings(input);
            await agentRuntime.setWorkspaceAgentModel(updated.workspaceId, updated.acpModelId);
            return { ok: true, data: updated };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'defaultLocale must be included in enabledLocales' ||
                error.message === 'No settings provided' ||
                error.message === 'defaultLocale cannot be empty' ||
                error.message === 'enabledLocales cannot be empty' ||
                error.message === 'zendeskSubdomain cannot be empty') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('agent.runtime.options.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'agent.runtime.options.get requires workspaceId');
            }
            await workspaceRepository.getWorkspace(workspaceId);
            const settings = await workspaceRepository.getWorkspaceSettings(workspaceId);
            const options = await agentRuntime.getRuntimeOptions(workspaceId);
            const currentModelId = settings.agentModelId ?? options.currentModelId;
            const availableModels = Array.from(new Set([
                ...(options.availableModels ?? []),
                ...(currentModelId ? [currentModelId] : [])
            ]));
            return {
                ok: true,
                data: {
                    ...options,
                    workspaceId,
                    currentModelId,
                    availableModels,
                    modelCatalog: buildRuntimeModelCatalog(availableModels, currentModelId)
                }
            };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
        }
    });
    bus.register('workspace.open', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.open requires workspaceId');
            }
            const workspace = await workspaceRepository.openWorkspace(workspaceId);
            return { ok: true, data: workspace };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.delete', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.delete requires workspaceId');
            }
            await workspaceRepository.deleteWorkspace(workspaceId);
            return { ok: true, data: { workspaceId, deleted: true } };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.default.set', async (payload) => {
        try {
            const { workspaceId } = payload;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.default.set requires workspaceId');
            }
            await workspaceRepository.setDefaultWorkspace(workspaceId);
            return {
                ok: true,
                data: {
                    workspaceId,
                    isDefault: true
                }
            };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.explorer.getTree', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.explorer.getTree requires workspaceId');
            }
            const nodes = await workspaceRepository.getExplorerTree(workspaceId);
            return {
                ok: true,
                data: {
                    workspaceId,
                    nodes
                }
            };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('article.detail.get', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'article.detail.get requires workspaceId');
            }
            if (!input.revisionId && !input.localeVariantId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'article.detail.get requires revisionId or localeVariantId');
            }
            const response = await workspaceRepository.getArticleDetail(input.workspaceId, input);
            return { ok: true, data: response };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'Revision or locale variant not found' ||
                error.message === 'Article family not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('article.relations.list', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'article.relations.list requires workspaceId');
            }
            if (!input.familyId && !input.localeVariantId && !input.batchId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'article.relations.list requires familyId, localeVariantId, or batchId');
            }
            const response = await workspaceRepository.listArticleRelations(input.workspaceId, input);
            return { ok: true, data: response };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('article.relations.upsert', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.sourceFamilyId || !input.targetFamilyId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'article.relations.upsert requires workspaceId, sourceFamilyId, and targetFamilyId');
            }
            const response = await workspaceRepository.upsertManualArticleRelation(input);
            return { ok: true, data: response };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('article.relations.delete', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'article.relations.delete requires workspaceId');
            }
            const response = await workspaceRepository.deleteArticleRelation(input);
            return { ok: true, data: response };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('article.relations.status', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'article.relations.status requires workspaceId');
            }
            const response = await workspaceRepository.getArticleRelationsStatus(workspaceId);
            return { ok: true, data: response };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('article.preview.styles.get', async (payload) => {
        try {
            const stylePath = await resolveArticlePreviewStylePath(payload?.stylePath);
            const fallbackCss = buildFallbackZendeskVariableCss();
            if (!stylePath) {
                return {
                    ok: true,
                    data: {
                        css: fallbackCss,
                        sourcePath: ''
                    }
                };
            }
            const styleContent = await promises_1.default.readFile(stylePath, 'utf8');
            const safeStyle = `${fallbackCss}\n${sanitizeZendeskStyles(styleContent)}`;
            return {
                ok: true,
                data: {
                    css: safeStyle,
                    sourcePath: stylePath
                }
            };
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    ok: true,
                    data: {
                        css: buildFallbackZendeskVariableCss(),
                        sourcePath: ''
                    }
                };
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('articleFamily.list', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'articleFamily.list requires workspaceId');
            }
            const families = await workspaceRepository.listArticleFamilies(workspaceId);
            return { ok: true, data: { workspaceId, families } };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('articleFamily.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const familyId = payload?.familyId;
            if (!workspaceId || !familyId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'articleFamily.get requires workspaceId and familyId');
            }
            const family = await workspaceRepository.getArticleFamily(workspaceId, familyId);
            return { ok: true, data: family };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'Article family not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Article family not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('articleFamily.create', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.externalKey || !input.title) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'articleFamily.create requires workspaceId, externalKey, title');
            }
            if (typeof input.externalKey === 'string' && !input.externalKey.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'articleFamily.externalKey cannot be empty');
            }
            if (typeof input.title === 'string' && !input.title.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'articleFamily.title cannot be empty');
            }
            const family = await workspaceRepository.createArticleFamily(input);
            return { ok: true, data: family };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'Article family already exists' ||
                error.message === 'Article family title is required' ||
                error.message === 'Article family externalKey is required' ||
                error.message === 'Article family title cannot be empty') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('articleFamily.update', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.familyId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'articleFamily.update requires workspaceId and familyId');
            }
            if (input.title === undefined &&
                input.sectionId === undefined &&
                input.categoryId === undefined &&
                input.retiredAtUtc === undefined) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'articleFamily.update requires at least one field');
            }
            const family = await workspaceRepository.updateArticleFamily(input);
            return { ok: true, data: family };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Article family not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'Article family update requires at least one field' || error.message === 'Article family title cannot be empty') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('articleFamily.delete', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const familyId = payload?.familyId;
            if (!workspaceId || !familyId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'articleFamily.delete requires workspaceId and familyId');
            }
            await workspaceRepository.deleteArticleFamily(workspaceId, familyId);
            return { ok: true, data: { workspaceId, familyId, deleted: true } };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Article family not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('localeVariant.list', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'localeVariant.list requires workspaceId');
            }
            const variants = await workspaceRepository.listLocaleVariants(workspaceId);
            return { ok: true, data: { workspaceId, variants } };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('localeVariant.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const variantId = payload?.variantId;
            if (!workspaceId || !variantId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'localeVariant.get requires workspaceId and variantId');
            }
            const variant = await workspaceRepository.getLocaleVariant(workspaceId, variantId);
            return { ok: true, data: variant };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Locale variant not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('localeVariant.create', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.familyId || !input.locale) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'localeVariant.create requires workspaceId, familyId, locale');
            }
            if (typeof input.locale === 'string' && !input.locale.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'locale is required');
            }
            if (input.status && !validRevisionStates.has(input.status)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'localeVariant.status must be live|draft_branch|obsolete|retired');
            }
            const variant = await workspaceRepository.createLocaleVariant(input);
            return { ok: true, data: variant };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Article family not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'Locale is required' ||
                error.message === 'Locale variant already exists') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('localeVariant.update', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.variantId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'localeVariant.update requires workspaceId and variantId');
            }
            if (input.locale === undefined &&
                input.status === undefined &&
                input.retiredAtUtc === undefined) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'localeVariant.update requires at least one field');
            }
            if (input.status && !validRevisionStates.has(input.status)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'localeVariant.status must be live|draft_branch|obsolete|retired');
            }
            const variant = await workspaceRepository.updateLocaleVariant(input);
            return { ok: true, data: variant };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Locale variant not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'Locale is required' ||
                error.message === 'Locale variant update requires at least one field' ||
                error.message === 'Locale variant already exists') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('localeVariant.delete', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const variantId = payload?.variantId;
            if (!workspaceId || !variantId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'localeVariant.delete requires workspaceId and variantId');
            }
            await workspaceRepository.deleteLocaleVariant(workspaceId, variantId);
            return { ok: true, data: { workspaceId, variantId, deleted: true } };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Locale variant not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('revision.list', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const localeVariantId = payload?.localeVariantId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revision.list requires workspaceId');
            }
            const revisions = await workspaceRepository.listRevisions(workspaceId, localeVariantId);
            return { ok: true, data: { workspaceId, localeVariantId, revisions } };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('revision.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const revisionId = payload?.revisionId;
            if (!workspaceId || !revisionId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revision.get requires workspaceId and revisionId');
            }
            const revision = await workspaceRepository.getRevision(workspaceId, revisionId);
            return { ok: true, data: revision };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Revision not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('revision.create', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.localeVariantId || !input.filePath || !input.revisionType || !input.status || input.revisionNumber === undefined) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revision.create requires workspaceId, localeVariantId, revisionType, status, revisionNumber, filePath');
            }
            if (!validRevisionStates.has(input.revisionType)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revisionType must be live|draft_branch|obsolete|retired');
            }
            if (!validRevisionStatuses.has(input.status)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'status must be open|promoted|failed|deleted');
            }
            if (!Number.isInteger(input.revisionNumber) || input.revisionNumber < 0) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revisionNumber must be a non-negative integer');
            }
            const revision = await workspaceRepository.createRevision(input);
            return { ok: true, data: revision };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Locale variant not found' || error.message === 'Revision not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'filePath is required' || error.message === 'revisionNumber must not regress' || error.message === 'revisionNumber must be non-negative') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            if (error.message === 'revisionNumber must be an integer') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('revision.update', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.revisionId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revision.update requires workspaceId and revisionId');
            }
            if (input.revisionType === undefined &&
                input.branchId === undefined &&
                input.filePath === undefined &&
                input.contentHash === undefined &&
                input.sourceRevisionId === undefined &&
                input.revisionNumber === undefined &&
                input.status === undefined) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revision.update requires at least one field');
            }
            if (input.revisionType && !validRevisionStates.has(input.revisionType)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revisionType must be live|draft_branch|obsolete|retired');
            }
            if (input.status && !validRevisionStatuses.has(input.status)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'status must be open|promoted|failed|deleted');
            }
            if (input.revisionNumber !== undefined && (!Number.isInteger(input.revisionNumber) || input.revisionNumber < 0)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revisionNumber must be a non-negative integer');
            }
            const revision = await workspaceRepository.updateRevision(input);
            return { ok: true, data: revision };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Revision not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'filePath is required' || error.message === 'revisionNumber must not regress') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            if (error.message === 'revisionNumber must be an integer' || error.message === 'revision.update requires at least one field') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('revision.delete', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const revisionId = payload?.revisionId;
            if (!workspaceId || !revisionId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revision.delete requires workspaceId and revisionId');
            }
            await workspaceRepository.deleteRevision(workspaceId, revisionId);
            return { ok: true, data: { workspaceId, revisionId, deleted: true } };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Revision not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.search', async (payload) => {
        try {
            const input = payload;
            const hasQuery = Boolean(input?.query?.trim());
            const hasIdFilters = Boolean(input?.localeVariantIds?.length
                || input?.familyIds?.length
                || input?.revisionIds?.length);
            if (!input?.workspaceId || (!hasQuery && !hasIdFilters)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.search requires workspaceId plus query or article ids');
            }
            const result = await workspaceRepository.searchArticles(input.workspaceId, input);
            return { ok: true, data: result };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.history.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const localeVariantId = payload?.localeVariantId;
            if (!workspaceId || !localeVariantId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.history.get requires workspaceId and localeVariantId');
            }
            const result = await workspaceRepository.getHistory(workspaceId, localeVariantId);
            return { ok: true, data: result };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.repository.info', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.repository.info requires workspaceId');
            }
            const payloadData = await workspaceRepository.getRepositoryStructure(workspaceId);
            return { ok: true, data: payloadData };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.route.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.route.get requires workspaceId');
            }
            const route = await workspaceRepository.workspaceRoutePayload(workspaceId);
            return { ok: true, data: route };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('pbiBatch.import', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'pbiBatch.import requires workspaceId');
            }
            if (!input.sourceFileName?.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'pbiBatch.import requires sourceFileName');
            }
            if (!input.sourcePath && !input.sourceContent) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'pbiBatch.import requires sourcePath or sourceContent');
            }
            if (input.scope?.mode && !validPBIScopeModes.has(input.scope.mode)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'pbiBatch.import scope.mode must be all|selected_only');
            }
            const trimmedInput = {
                ...input,
                sourceFileName: input.sourceFileName.trim(),
                batchName: input.batchName?.trim(),
                scope: input.scope
                    ? {
                        mode: input.scope.mode,
                        selectedRows: input.scope.selectedRows,
                        selectedExternalIds: input.scope.selectedExternalIds
                    }
                    : undefined
            };
            const result = await pbiBatchImportService.importBatch(trimmedInput);
            return { ok: true, data: result };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'No headers found in PBI source' || error.message === 'pbi.import requires sourcePath or sourceContent') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('pbiBatch.list', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'pbiBatch.list requires workspaceId');
            }
            const batches = await workspaceRepository.listPBIBatches(workspaceId);
            return { ok: true, data: { workspaceId, batches } };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('pbiBatch.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const batchId = payload?.batchId;
            if (!workspaceId || !batchId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'pbiBatch.get requires workspaceId and batchId');
            }
            const batch = await workspaceRepository.getPBIBatch(workspaceId, batchId);
            return { ok: true, data: { workspaceId, batch } };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'PBI batch not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('pbiBatch.rows.list', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input?.batchId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'pbiBatch.rows.list requires workspaceId and batchId');
            }
            if (input.validationStatuses?.length && !input.validationStatuses.every((status) => validPBIValidationStatuses.has(status))) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'pbiBatch.rows.list requires validationStatuses to be candidate|malformed|duplicate|ignored');
            }
            const rows = await workspaceRepository.getPBIRecords(input.workspaceId, input.batchId, input.validationStatuses);
            return { ok: true, data: { workspaceId: input.workspaceId, batchId: input.batchId, rows } };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'PBI batch not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('pbiBatch.scope.set', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const batchId = payload?.batchId;
            const mode = payload?.mode;
            const selectedRows = payload?.selectedRows;
            const selectedExternalIds = payload?.selectedExternalIds;
            if (!workspaceId || !batchId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'pbiBatch.scope.set requires workspaceId and batchId');
            }
            if (!mode) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'pbiBatch.scope.set requires mode');
            }
            if (!validPBIScopeModes.has(mode)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'pbiBatch.scope.set mode must be all|selected_only');
            }
            const result = await workspaceRepository.setPBIBatchScope(workspaceId, batchId, mode, selectedRows ?? [], selectedExternalIds ?? []);
            const batch = await workspaceRepository.getPBIBatch(workspaceId, batchId);
            return {
                ok: true,
                data: {
                    batch,
                    scope: {
                        batchId,
                        workspaceId,
                        mode,
                        selectedRows: selectedRows ?? [],
                        selectedExternalIds: selectedExternalIds ?? [],
                        scopedRowNumbers: result.scopedSourceRows,
                        scopedCount: result.scopedRowCount,
                        updatedAtUtc: new Date().toISOString()
                    }
                }
            };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'PBI batch not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('pbiBatch.setStatus', async (payload) => {
        try {
            const input = payload;
            const workspaceId = input?.workspaceId;
            const batchId = input?.batchId;
            const status = input?.status;
            if (!workspaceId || !batchId || !status) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'pbiBatch.setStatus requires workspaceId, batchId, and status');
            }
            if (status === 'proposed') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'pbiBatch.setStatus status must be imported|scoped|submitted|analyzed|review_in_progress|review_complete|archived');
            }
            const batchStatus = status;
            if (!validPBIBatchStatuses.has(batchStatus)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'pbiBatch.setStatus status must be imported|scoped|submitted|analyzed|review_in_progress|review_complete|archived');
            }
            const batch = await workspaceRepository.setPBIBatchStatus(workspaceId, batchId, batchStatus, Boolean(input?.force));
            return { ok: true, data: { batch } };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'PBI batch not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message?.startsWith('Cannot transition batch status')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('pbiBatch.delete', async (payload) => {
        try {
            const input = payload;
            const workspaceId = input?.workspaceId;
            const batchId = input?.batchId;
            if (!workspaceId || !batchId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'pbiBatch.delete requires workspaceId and batchId');
            }
            await workspaceRepository.deletePBIBatch(workspaceId, batchId);
            return { ok: true, data: { workspaceId, batchId } };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'PBI batch not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('pbiBatch.getPreflight', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const batchId = payload?.batchId;
            if (!workspaceId || !batchId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'pbiBatch.getPreflight requires workspaceId and batchId');
            }
            const preflight = await pbiBatchImportService.getBatchPreflight(workspaceId, batchId);
            return { ok: true, data: preflight };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'PBI batch not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('proposal.ingest', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.batchId || !input.action) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'proposal.ingest requires workspaceId, batchId, and action');
            }
            const metadata = asRecord(input.metadata);
            const proposal = await workspaceRepository.createAgentProposal({
                workspaceId: input.workspaceId,
                batchId: input.batchId,
                action: input.action,
                _sessionId: input.sessionId,
                kbAccessMode: extractOptionalKbAccessMode(input.kbAccessMode) ?? extractOptionalKbAccessMode(metadata?.kbAccessMode),
                acpSessionId: extractOptionalString(input.acpSessionId) ?? extractOptionalString(metadata?.acpSessionId),
                originPath: extractOptionalString(input.originPath) ?? extractOptionalString(metadata?.originPath) ?? 'proposal_ingest',
                familyId: input.familyId,
                localeVariantId: input.localeVariantId,
                sourceRevisionId: input.sourceRevisionId,
                targetTitle: input.targetTitle,
                targetLocale: input.targetLocale,
                confidenceScore: input.confidenceScore,
                note: input.aiNotes,
                rationale: input.rationaleSummary,
                rationaleSummary: input.rationaleSummary,
                aiNotes: input.aiNotes,
                suggestedPlacement: input.suggestedPlacement,
                sourceHtml: input.sourceHtml,
                proposedHtml: input.proposedHtml,
                relatedPbiIds: input.relatedPbiIds,
                metadata: input.metadata
            });
            return { ok: true, data: proposal };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'PBI batch not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('proposal.review.list', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.batchId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'proposal.review.list requires workspaceId and batchId');
            }
            return { ok: true, data: await workspaceRepository.listProposalReviewQueue(input.workspaceId, input.batchId) };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'PBI batch not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('proposal.review.batchList', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'proposal.review.batchList requires workspaceId');
            }
            return { ok: true, data: await workspaceRepository.listProposalReviewBatches(input.workspaceId) };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('proposal.review.get', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.proposalId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'proposal.review.get requires workspaceId and proposalId');
            }
            return { ok: true, data: await workspaceRepository.getProposalReviewDetail(input.workspaceId, input.proposalId) };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Proposal not found' || error.message === 'PBI batch not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('proposal.review.decide', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.proposalId || !input.decision) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'proposal.review.decide requires workspaceId, proposalId, and decision');
            }
            if (!Object.values(shared_types_1.ProposalReviewDecision).includes(input.decision)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'proposal.review.decide decision must be accept|deny|defer|apply_to_branch|archive');
            }
            return { ok: true, data: await workspaceRepository.decideProposalReview(input) };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Proposal not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('proposal.review.delete', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.proposalId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'proposal.review.delete requires workspaceId and proposalId');
            }
            return { ok: true, data: await workspaceRepository.deleteProposalReview(input.workspaceId, input.proposalId) };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Proposal not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('proposal.review.saveWorkingCopy', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.proposalId || typeof input.html !== 'string') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'proposal.review.saveWorkingCopy requires workspaceId, proposalId, and html');
            }
            return {
                ok: true,
                data: await workspaceRepository.updateProposalReviewWorkingCopy(input.workspaceId, input.proposalId, { html: input.html })
            };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Proposal not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('ai.assistant.context.get', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.context) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'ai.assistant.context.get requires workspaceId and context');
            }
            return { ok: true, data: await aiAssistantService.getContext(input) };
        }
        catch (error) {
            if (error.message.includes('not found')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('ai.assistant.session.get', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'ai.assistant.session.get requires workspaceId');
            }
            return { ok: true, data: await aiAssistantService.getSession(input) };
        }
        catch (error) {
            if (error.message.includes('not found')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('ai.assistant.session.list', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'ai.assistant.session.list requires workspaceId');
            }
            return { ok: true, data: await aiAssistantService.listSessions(input) };
        }
        catch (error) {
            if (error.message.includes('not found')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('ai.assistant.session.create', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'ai.assistant.session.create requires workspaceId');
            }
            return { ok: true, data: await aiAssistantService.createSession(input) };
        }
        catch (error) {
            if (error.message.includes('not found')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('ai.assistant.session.open', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.sessionId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'ai.assistant.session.open requires workspaceId and sessionId');
            }
            return { ok: true, data: await aiAssistantService.openSession(input) };
        }
        catch (error) {
            if (error.message.includes('not found')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('ai.assistant.session.delete', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.sessionId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'ai.assistant.session.delete requires workspaceId and sessionId');
            }
            return { ok: true, data: await aiAssistantService.deleteSession(input) };
        }
        catch (error) {
            if (error.message.includes('not found')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('ai.assistant.message.send', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.context || !input.message?.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'ai.assistant.message.send requires workspaceId, context, and message');
            }
            return { ok: true, data: await aiAssistantService.sendMessage(input) };
        }
        catch (error) {
            if (error.message.includes('not found')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('ai.assistant.session.reset', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.sessionId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'ai.assistant.session.reset requires workspaceId and sessionId');
            }
            return { ok: true, data: await aiAssistantService.resetSession(input) };
        }
        catch (error) {
            if (error.message.includes('not found')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('ai.assistant.artifact.apply', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.sessionId || !input.artifactId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'ai.assistant.artifact.apply requires workspaceId, sessionId, and artifactId');
            }
            return { ok: true, data: await aiAssistantService.applyArtifact(input) };
        }
        catch (error) {
            if (error.message.includes('not found')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('ai.assistant.artifact.reject', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.sessionId || !input.artifactId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'ai.assistant.artifact.reject requires workspaceId, sessionId, and artifactId');
            }
            return { ok: true, data: await aiAssistantService.rejectArtifact(input) };
        }
        catch (error) {
            if (error.message.includes('not found')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('app.workingState.register', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.route || !input.entityType || !input.entityId || !input.versionToken || !input.currentValues) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'app.workingState.register requires workspaceId, route, entityType, entityId, versionToken, and currentValues');
            }
            appWorkingStateService.register(input);
            return { ok: true, data: { registered: true } };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('app.workingState.unregister', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.route || !input.entityType || !input.entityId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'app.workingState.unregister requires workspaceId, route, entityType, and entityId');
            }
            appWorkingStateService.unregister(input);
            return { ok: true, data: { unregistered: true } };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('app.workingState.getFormSchema', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.route || !input.entityType || !input.entityId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'app.workingState.getFormSchema requires workspaceId, route, entityType, and entityId');
            }
            return { ok: true, data: appWorkingStateService.getFormSchema(input) };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('app.workingState.patchForm', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.route || !input.entityType || !input.entityId || !input.patch) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'app.workingState.patchForm requires workspaceId, route, entityType, entityId, and patch');
            }
            const result = await (0, proposal_working_state_1.applyAppWorkingStatePatch)({
                workspaceRepository,
                appWorkingStateService,
                request: input
            });
            return { ok: true, data: result };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('article.ai.get', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || (!input.branchId && !input.localeVariantId)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'article.ai.get requires workspaceId and branchId or localeVariantId');
            }
            return { ok: true, data: await workspaceRepository.getOrCreateArticleAiSession(input) };
        }
        catch (error) {
            if (error.message.includes('not found')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('article.ai.submit', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || (!input.branchId && !input.localeVariantId) || !input.message?.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'article.ai.submit requires workspaceId, branchId or localeVariantId, and message');
            }
            const session = await workspaceRepository.getOrCreateArticleAiSession({
                workspaceId: input.workspaceId,
                localeVariantId: input.localeVariantId,
                branchId: input.branchId
            });
            const currentHtml = input.branchId
                ? (await workspaceRepository.getDraftBranchEditor(input.workspaceId, input.branchId)).editor.html
                : (await workspaceRepository.getArticleDetail(input.workspaceId, {
                    workspaceId: input.workspaceId,
                    localeVariantId: input.localeVariantId,
                    includeLineage: false,
                    includePublishLog: false
                })).sourceHtml;
            const selectedTemplate = input.templatePackId
                ? await workspaceRepository.getTemplatePackDetail({ workspaceId: input.workspaceId, templatePackId: input.templatePackId })
                : undefined;
            const kbAccessSelection = await requireHealthyKbAccessMode(input.workspaceId);
            const kbAccessMode = kbAccessSelection.selectedMode;
            const run = await agentRuntime.runArticleEdit({
                workspaceId: input.workspaceId,
                localeVariantId: session.session.localeVariantId,
                sessionId: session.session.runtimeSessionId,
                kbAccessMode,
                locale: input.targetLocale ?? session.session.locale,
                prompt: buildArticleAiPrompt({
                    session,
                    request: input,
                    currentHtml,
                    templatePrompt: selectedTemplate
                        ? `${selectedTemplate.promptTemplate}\nTone rules:\n${selectedTemplate.toneRules}\nExamples:\n${selectedTemplate.examples ?? ''}`
                        : undefined
                })
            }, () => undefined, () => false);
            const parsed = parseArticleAiResult(run.resultPayload);
            if (!parsed) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, 'Unable to parse AI article edit result');
            }
            return {
                ok: true,
                data: await workspaceRepository.submitArticleAiMessage(input, {
                    runtimeSessionId: run.sessionId,
                    templatePackId: input.templatePackId,
                    updatedHtml: parsed.updatedHtml,
                    summary: parsed.summary,
                    rationale: parsed.rationale,
                    rawResult: run.resultPayload
                })
            };
        }
        catch (error) {
            if (error.message.includes('not found')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('article.ai.reset', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.sessionId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'article.ai.reset requires workspaceId and sessionId');
            }
            return { ok: true, data: await workspaceRepository.resetArticleAiSession(input) };
        }
        catch (error) {
            if (error.message.includes('not found')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('article.ai.accept', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.sessionId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'article.ai.accept requires workspaceId and sessionId');
            }
            return { ok: true, data: await workspaceRepository.acceptArticleAiEdit(input) };
        }
        catch (error) {
            if (error.message.includes('not found')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('article.ai.reject', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.sessionId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'article.ai.reject requires workspaceId and sessionId');
            }
            return { ok: true, data: await workspaceRepository.rejectArticleAiEdit(input) };
        }
        catch (error) {
            if (error.message.includes('not found')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('template.pack.list', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'template.pack.list requires workspaceId');
            }
            return { ok: true, data: await workspaceRepository.listTemplatePackSummaries(input) };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('template.pack.get', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.templatePackId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'template.pack.get requires workspaceId and templatePackId');
            }
            const detail = await workspaceRepository.getTemplatePackDetail(input);
            if (!detail) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Template pack not found');
            }
            return { ok: true, data: detail };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('template.pack.save', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.name || !input.language || !input.templateType || !input.promptTemplate || !input.toneRules) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'template.pack.save requires workspaceId, name, language, templateType, promptTemplate, and toneRules');
            }
            return { ok: true, data: await workspaceRepository.upsertTemplatePack(input) };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('template.pack.delete', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.templatePackId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'template.pack.delete requires workspaceId and templatePackId');
            }
            return { ok: true, data: await workspaceRepository.deleteTemplatePack(input) };
        }
        catch (error) {
            if (error.message.includes('not found')) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('template.pack.analyze', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.templatePackId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'template.pack.analyze requires workspaceId and templatePackId');
            }
            const detail = await workspaceRepository.analyzeTemplatePack(input);
            if (!detail) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Template pack not found');
            }
            return { ok: true, data: detail };
        }
        catch (error) {
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('draft.branch.list', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'draft.branch.list requires workspaceId');
            }
            return { ok: true, data: await workspaceRepository.listDraftBranches(input.workspaceId, input) };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('draft.branch.get', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.branchId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'draft.branch.get requires workspaceId and branchId');
            }
            return { ok: true, data: await workspaceRepository.getDraftBranchEditor(input.workspaceId, input.branchId) };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Draft branch not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('draft.branch.create', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.localeVariantId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'draft.branch.create requires workspaceId and localeVariantId');
            }
            return { ok: true, data: await workspaceRepository.createDraftBranch(input) };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Locale variant not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('draft.branch.save', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.branchId || typeof input.html !== 'string') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'draft.branch.save requires workspaceId, branchId, and html');
            }
            return { ok: true, data: await workspaceRepository.saveDraftBranch(input) };
        }
        catch (error) {
            if (error.message === 'Workspace not found' ||
                error.message === 'Draft branch not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('draft.branch.status.set', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.branchId || !input.status) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'draft.branch.status.set requires workspaceId, branchId, and status');
            }
            if (!validDraftBranchStatuses.has(input.status)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'draft.branch.status.set status is invalid');
            }
            return { ok: true, data: await workspaceRepository.setDraftBranchStatus(input) };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Draft branch not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('draft.branch.discard', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.branchId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'draft.branch.discard requires workspaceId and branchId');
            }
            return { ok: true, data: await workspaceRepository.discardDraftBranch(input) };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Draft branch not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('draft.branch.undo', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.branchId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'draft.branch.undo requires workspaceId and branchId');
            }
            return { ok: true, data: await workspaceRepository.undoDraftBranch(input) };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Draft branch not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('draft.branch.redo', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.branchId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'draft.branch.redo requires workspaceId and branchId');
            }
            return { ok: true, data: await workspaceRepository.redoDraftBranch(input) };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Draft branch not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    jobs.registerRunner('workspace.bootstrap', async (payload, emit) => {
        emit({
            id: payload.jobId ?? 'bootstrap',
            command: 'workspace.bootstrap',
            state: shared_types_2.JobState.RUNNING,
            progress: 20,
            message: 'Resolving workspace root'
        });
        emit({
            id: payload.jobId ?? 'bootstrap',
            command: 'workspace.bootstrap',
            state: shared_types_2.JobState.RUNNING,
            progress: 80,
            message: `Using root ${workspaceRoot}`
        });
        emit({
            id: payload.jobId ?? 'bootstrap',
            command: 'workspace.bootstrap',
            state: shared_types_2.JobState.RUNNING,
            progress: 100,
            message: `Workspace path: ${node_path_1.default.resolve(workspaceRoot)}`
        });
    });
    jobs.registerRunner('agent.analysis.run', async (payload, emit, isCancelled) => {
        const input = payload.input;
        logger_1.logger.info('[agent.analysis.run] request received', {
            jobId: payload.jobId,
            workspaceId: input?.workspaceId,
            batchId: input?.batchId
        });
        if (!input?.workspaceId || !input.batchId) {
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.FAILED,
                progress: 100,
                message: 'agent.analysis.run requires workspaceId and batchId'
            });
            return;
        }
        if (isCancelled()) {
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.CANCELED,
                progress: 100,
                message: 'analysis canceled'
            });
            return;
        }
        const workspaceSettings = await workspaceRepository.getWorkspaceSettings(input.workspaceId);
        const agentModelId = workspaceSettings.acpModelId;
        await agentRuntime.setWorkspaceAgentModel(input.workspaceId, agentModelId);
        let kbAccessMode;
        try {
            const kbAccessSelection = await requireHealthyKbAccessMode(input.workspaceId, input.kbAccessMode);
            kbAccessMode = kbAccessSelection.selectedMode;
        }
        catch (error) {
            const selectedMode = error instanceof kb_access_mode_resolver_1.KbAccessModePreflightError
                ? error.selection.selectedMode
                : (0, kb_access_mode_resolver_1.selectKbAccessMode)(input.kbAccessMode, await resolveWorkspaceKbAccessMode(input.workspaceId));
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.FAILED,
                progress: 100,
                message: error instanceof Error ? error.message : String(error),
                metadata: {
                    batchId: input.batchId,
                    requestedKbAccessMode: selectedMode,
                    kbAccessMode: selectedMode,
                    agentModelId
                }
            });
            return;
        }
        emit({
            id: payload.jobId,
            command: payload.command,
            state: shared_types_2.JobState.RUNNING,
            progress: 15,
            message: `Starting analysis session for batch ${input.batchId}`,
            metadata: {
                batchId: input.batchId,
                requestedKbAccessMode: kbAccessMode,
                kbAccessMode,
                agentModelId
            }
        });
        logger_1.logger.info('[agent.analysis.run] starting runtime', {
            jobId: payload.jobId,
            batchId: input.batchId,
            workspaceId: input.workspaceId
        });
        const staleDevBuildMessage = await getBatchAnalysisDevBuildFreshnessMessage();
        if (staleDevBuildMessage) {
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.FAILED,
                progress: 100,
                message: staleDevBuildMessage
            });
            logger_1.logger.warn('[agent.analysis.trace] blocked batch analyzation because desktop dev build is stale', {
                jobId: payload.jobId,
                workspaceId: input.workspaceId,
                batchId: input.batchId,
                reason: staleDevBuildMessage
            });
            return;
        }
        const batchContext = await workspaceRepository.getBatchContext(input.workspaceId, input.batchId);
        if (!batchContext) {
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.FAILED,
                progress: 100,
                message: 'Batch context not found'
            });
            return;
        }
        const uploadedPbis = await workspaceRepository.getPBISubset(input.workspaceId, input.batchId).catch(() => ({ rows: [] }));
        const plannerPrefetch = await buildPlannerPrefetch(workspaceRepository, input.workspaceId, input.batchId, uploadedPbis).catch(() => ({
            priorAnalysis: null,
            topicClusters: [],
            articleMatches: [],
            relationMatches: []
        }));
        const streamMetadata = {
            batchId: input.batchId,
            kbAccessMode,
            workspaceId: input.workspaceId,
            agentModelId
        };
        const orchestrationIteration = await batchAnalysisOrchestrator.startIteration({
            workspaceId: input.workspaceId,
            batchId: input.batchId,
            agentModelId,
            startedAtUtc: new Date().toISOString()
        });
        let liveIteration = orchestrationIteration;
        let liveExecutionCounts = orchestrationIteration.executionCounts;
        let liveOutstandingDiscoveredWorkCount = orchestrationIteration.outstandingDiscoveredWorkCount;
        let liveApprovedPlanId = orchestrationIteration.approvedPlanId;
        let liveLastReviewVerdict = orchestrationIteration.lastReviewVerdict;
        let liveSessionId = orchestrationIteration.sessionId;
        let liveStageStartedAtUtc = orchestrationIteration.startedAtUtc;
        const buildStreamMetadata = (overrides) => ({
            ...streamMetadata,
            ...overrides,
            sessionId: overrides?.sessionId ?? liveSessionId ?? streamMetadata.sessionId,
            orchestration: {
                workspaceId: input.workspaceId,
                batchId: input.batchId,
                iterationId: liveIteration.id,
                iteration: liveIteration.iteration,
                iterationStatus: liveIteration.status,
                stage: overrides?.stage ?? streamMetadata.stage ?? liveIteration.stage,
                role: overrides?.role ?? streamMetadata.role ?? liveIteration.role,
                agentModelId: overrides?.agentModelId ?? streamMetadata.agentModelId ?? liveIteration.agentModelId,
                sessionId: overrides?.sessionId ?? liveSessionId ?? streamMetadata.sessionId ?? liveIteration.sessionId,
                approvedPlanId: liveApprovedPlanId,
                lastReviewVerdict: liveLastReviewVerdict,
                outstandingDiscoveredWorkCount: liveOutstandingDiscoveredWorkCount,
                executionCounts: liveExecutionCounts,
                stageStartedAtUtc: liveStageStartedAtUtc,
                stageEndedAtUtc: overrides?.stageEndedAtUtc,
                updatedAtUtc: new Date().toISOString()
            }
        });
        const logAnalysisProgress = async (summary, overrides, details) => {
            const stage = (overrides?.stage ?? streamMetadata.stage ?? liveIteration.stage);
            const role = (overrides?.role ?? streamMetadata.role ?? liveIteration.role);
            const sessionId = overrides?.sessionId ?? liveSessionId ?? streamMetadata.sessionId ?? liveIteration.sessionId;
            const eventDetails = {
                previousStage: liveIteration.stage,
                previousRole: liveIteration.role,
                ...(details ?? {})
            };
            logger_1.logger.info('[agent.analysis.trace] ' + summary, {
                jobId: payload.jobId,
                workspaceId: input.workspaceId,
                batchId: input.batchId,
                iterationId: liveIteration.id,
                iteration: liveIteration.iteration,
                stage,
                role,
                sessionId,
                ...eventDetails
            });
            await workspaceRepository.recordBatchAnalysisStageEvent({
                id: (0, node_crypto_1.randomUUID)(),
                workspaceId: input.workspaceId,
                batchId: input.batchId,
                iterationId: liveIteration.id,
                iteration: liveIteration.iteration,
                stage,
                role,
                eventType: overrides?.eventType ?? 'stage_progress',
                status: liveIteration.status,
                summary,
                sessionId,
                agentModelId,
                approvedPlanId: liveApprovedPlanId,
                lastReviewVerdict: liveLastReviewVerdict,
                outstandingDiscoveredWorkCount: liveOutstandingDiscoveredWorkCount,
                executionCounts: liveExecutionCounts,
                details: eventDetails,
                createdAtUtc: new Date().toISOString()
            });
        };
        const persistBatchStageRun = async (params) => {
            await workspaceRepository.recordBatchAnalysisStageRun({
                workspaceId: input.workspaceId,
                batchId: input.batchId,
                iterationId: liveIteration.id,
                iteration: liveIteration.iteration,
                stage: params.stage,
                role: params.role,
                retryType: params.retryType,
                sessionReusePolicy: params.sessionReusePolicy,
                localSessionId: params.result.sessionId,
                acpSessionId: params.result.acpSessionId,
                kbAccessMode,
                agentModelId,
                status: params.result.status === 'ok' || params.resolution?.parseable
                    ? 'complete'
                    : params.result.status === 'canceled'
                        ? 'canceled'
                        : 'failed',
                startedAtUtc: params.result.startedAtUtc,
                endedAtUtc: params.result.endedAtUtc,
                promptTemplate: params.promptTemplate,
                transcriptPath: params.result.transcriptPath,
                toolCalls: Array.isArray(params.result.toolCalls) ? params.result.toolCalls : [],
                rawOutput: params.result.rawOutput,
                message: `[${params.stage}/${params.role}] ${params.result.message ?? params.result.status}`,
                parseable: params.resolution?.parseable,
                usedTranscriptRecovery: params.resolution?.usedTranscript,
                initialCandidateCount: params.resolution?.initialCandidateCount,
                transcriptCandidateCount: params.resolution?.transcriptCandidateCount,
                textLength: params.resolution?.text.length,
                resultTextPreview: params.resolution ? buildStageEventTextPreview(params.resolution.text) : undefined
            });
            if (params.result.sessionId) {
                await workspaceRepository.annotateProposalProvenanceForSession({
                    workspaceId: input.workspaceId,
                    batchId: input.batchId,
                    sessionId: params.result.sessionId,
                    kbAccessMode,
                    acpSessionId: params.result.acpSessionId,
                    originPath: 'batch_analysis'
                });
            }
        };
        try {
            streamMetadata.iterationId = orchestrationIteration.id;
            streamMetadata.stage = orchestrationIteration.stage;
            streamMetadata.role = orchestrationIteration.role;
            await logAnalysisProgress('Batch analysis iteration started.', { eventType: 'stage_progress' }, {
                kbAccessMode,
                agentModelId,
                uploadedPbiCount: Array.isArray(uploadedPbis?.rows) ? (uploadedPbis.rows?.length ?? 0) : 0,
                prefetchedClusterCount: plannerPrefetch.topicClusters.length,
                prefetchedArticleMatchCount: plannerPrefetch.articleMatches.length,
                prefetchedRelationCount: plannerPrefetch.relationMatches.length
            });
            let approvedPlanId;
            const runPlanningPass = async (attempt, priorPlanJson, reviewDeltaJson) => {
                const planningStage = attempt === 1 ? 'planning' : 'plan_revision';
                await logAnalysisProgress(attempt === 1 ? 'Planner attempt 1 started.' : `Planner revision attempt ${attempt} started.`, { stage: planningStage, role: 'planner' }, {
                    attempt,
                    hasPriorPlan: Boolean(priorPlanJson),
                    hasReviewDelta: Boolean(reviewDeltaJson)
                });
                liveIteration = await batchAnalysisOrchestrator.transitionIteration({
                    workspaceId: input.workspaceId,
                    iterationId: orchestrationIteration.id,
                    stage: planningStage,
                    role: 'planner',
                    summary: attempt === 1 ? 'Generating initial batch plan.' : `Revising plan after review feedback (attempt ${attempt}).`,
                    agentModelId
                });
                streamMetadata.stage = planningStage;
                streamMetadata.role = 'planner';
                liveStageStartedAtUtc = liveIteration.updatedAtUtc;
                emit({
                    id: payload.jobId,
                    command: payload.command,
                    state: shared_types_2.JobState.RUNNING,
                    progress: 20,
                    message: attempt === 1 ? 'Generating structured batch plan...' : `Revising plan (attempt ${attempt})...`,
                    metadata: buildStreamMetadata()
                });
                const plannerPrompt = batchAnalysisOrchestrator.buildPlannerPrompt({
                    batchContext,
                    uploadedPbis,
                    plannerPrefetch,
                    priorPlan: priorPlanJson ? JSON.parse(priorPlanJson) : undefined,
                    reviewDelta: reviewDeltaJson ? JSON.parse(reviewDeltaJson) : undefined
                });
                let plannerResult;
                try {
                    plannerResult = await agentRuntime.runBatchAnalysis({
                        ...input,
                        sessionId: liveSessionId,
                        kbAccessMode,
                        agentRole: 'planner',
                        sessionMode: 'plan',
                        prompt: plannerPrompt
                    }, (stream) => {
                        emit({
                            id: payload.jobId,
                            command: payload.command,
                            state: shared_types_2.JobState.RUNNING,
                            progress: 28,
                            message: JSON.stringify(stream),
                            metadata: buildStreamMetadata({ sessionId: stream.sessionId })
                        });
                    }, isCancelled);
                }
                catch (error) {
                    const plannerError = error instanceof Error ? error.message : String(error);
                    await logAnalysisProgress('Planner attempt failed before producing a usable response.', {
                        stage: planningStage,
                        role: 'planner',
                        sessionId: liveSessionId
                    }, {
                        attempt,
                        plannerError
                    });
                    throw error;
                }
                liveSessionId = plannerResult.sessionId;
                const parseDraftPlan = (resultText, sessionId) => batchAnalysisOrchestrator.parsePlannerResult({
                    workspaceId: input.workspaceId,
                    batchId: input.batchId,
                    iteration: orchestrationIteration,
                    resultText,
                    agentModelId,
                    sessionId,
                    planVersion: attempt,
                    supersedesPlanId: priorPlanJson ? JSON.parse(priorPlanJson).id : undefined
                });
                let plannerResolution = await resolveBatchAnalysisResultText(agentRuntime, input.workspaceId, plannerResult.sessionId, plannerResult.resultPayload, 'planner');
                await persistBatchStageRun({
                    stage: planningStage,
                    role: 'planner',
                    result: plannerResult,
                    promptTemplate: plannerPrompt,
                    resolution: plannerResolution
                });
                let plannerJsonRetried = false;
                let plannerRuntimeRetried = false;
                while (true) {
                    const infrastructureFailure = detectPlannerInfrastructureFailure(plannerResult.status, plannerResolution);
                    if (infrastructureFailure && !plannerRuntimeRetried) {
                        plannerRuntimeRetried = true;
                        await logAnalysisProgress('Planner hit a provider/runtime failure; retrying once in a fresh local session.', {
                            stage: planningStage,
                            role: 'planner',
                            sessionId: plannerResult.sessionId
                        }, {
                            attempt,
                            retryType: 'planner_runtime_retry',
                            transitionReason: 'planner_runtime_failure_retry',
                            triggerBranch: 'detectPlannerInfrastructureFailure returned true',
                            infrastructureError: infrastructureFailure.message,
                            infrastructureCode: infrastructureFailure.code,
                            resultTextPreview: buildStageEventTextPreview(plannerResolution.text, 500)
                        });
                        emit({
                            id: payload.jobId,
                            command: payload.command,
                            state: shared_types_2.JobState.RUNNING,
                            progress: 30,
                            message: 'Planner hit a provider/runtime failure. Retrying in a fresh session...',
                            metadata: buildStreamMetadata({ sessionId: plannerResult.sessionId })
                        });
                        plannerResult = await agentRuntime.runBatchAnalysis({
                            ...input,
                            sessionReusePolicy: 'new_local_session',
                            kbAccessMode,
                            agentRole: 'planner',
                            sessionMode: 'plan',
                            prompt: plannerPrompt
                        }, (stream) => {
                            emit({
                                id: payload.jobId,
                                command: payload.command,
                                state: shared_types_2.JobState.RUNNING,
                                progress: 31,
                                message: JSON.stringify(stream),
                                metadata: buildStreamMetadata({ sessionId: stream.sessionId })
                            });
                        }, isCancelled);
                        liveSessionId = plannerResult.sessionId;
                        plannerResolution = await resolveBatchAnalysisResultText(agentRuntime, input.workspaceId, plannerResult.sessionId, plannerResult.resultPayload, 'planner');
                        await persistBatchStageRun({
                            stage: planningStage,
                            role: 'planner',
                            result: plannerResult,
                            promptTemplate: plannerPrompt,
                            retryType: 'planner_runtime_retry',
                            sessionReusePolicy: 'new_local_session',
                            resolution: plannerResolution
                        });
                        continue;
                    }
                    if (!infrastructureFailure && shouldRetryPlannerWithFreshSession(plannerResolution) && !plannerJsonRetried) {
                        plannerJsonRetried = true;
                        await logAnalysisProgress('Planner result was incomplete; retrying once with a strict JSON-only restatement prompt.', {
                            stage: planningStage,
                            role: 'planner',
                            sessionId: plannerResult.sessionId
                        }, {
                            attempt,
                            retryType: 'planner_json_retry',
                            transitionReason: 'planner_empty_or_partial_output_retry',
                            triggerBranch: 'shouldRetryPlannerWithFreshSession returned true',
                            resultTextPreview: buildStageEventTextPreview(plannerResolution.text, 500)
                        });
                        emit({
                            id: payload.jobId,
                            command: payload.command,
                            state: shared_types_2.JobState.RUNNING,
                            progress: 30,
                            message: 'Planner returned incomplete output. Retrying once with a strict JSON-only restatement...',
                            metadata: buildStreamMetadata({ sessionId: plannerResult.sessionId })
                        });
                        const retryPrompt = plannerOutputLooksStructuredButIncomplete(plannerResolution.text)
                            ? batchAnalysisOrchestrator.buildPlannerRepairPrompt({
                                originalPrompt: plannerPrompt,
                                priorOutput: summarizePlannerRecoveryContext(plannerResolution.text),
                                parseError: 'Planner response was partial JSON and could not be validated safely.'
                            })
                            : batchAnalysisOrchestrator.buildPlannerJsonRetryPrompt({
                                originalPrompt: plannerPrompt,
                                priorOutput: summarizePlannerRecoveryContext(plannerResolution.text),
                                parseError: 'Planner response was empty, partial, or not safely parseable.'
                            });
                        plannerResult = await agentRuntime.runBatchAnalysis({
                            ...input,
                            sessionReusePolicy: 'reset_acp',
                            kbAccessMode,
                            agentRole: 'planner',
                            sessionMode: 'plan',
                            prompt: retryPrompt
                        }, (stream) => {
                            emit({
                                id: payload.jobId,
                                command: payload.command,
                                state: shared_types_2.JobState.RUNNING,
                                progress: 31,
                                message: JSON.stringify(stream),
                                metadata: buildStreamMetadata({ sessionId: stream.sessionId })
                            });
                        }, isCancelled);
                        liveSessionId = plannerResult.sessionId;
                        plannerResolution = await resolveBatchAnalysisResultText(agentRuntime, input.workspaceId, plannerResult.sessionId, plannerResult.resultPayload, 'planner');
                        await persistBatchStageRun({
                            stage: planningStage,
                            role: 'planner',
                            result: plannerResult,
                            promptTemplate: retryPrompt,
                            retryType: 'planner_json_retry',
                            sessionReusePolicy: 'reset_acp',
                            resolution: plannerResolution
                        });
                        continue;
                    }
                    if (infrastructureFailure) {
                        const failureMessage = `Planner failed due to provider/runtime error: ${infrastructureFailure.message}`;
                        emit({
                            id: payload.jobId,
                            command: payload.command,
                            state: shared_types_2.JobState.RUNNING,
                            progress: 32,
                            message: failureMessage,
                            metadata: buildStreamMetadata({ sessionId: plannerResult.sessionId })
                        });
                        await logAnalysisProgress('Planner failed due to a provider/runtime error and could not recover automatically.', {
                            stage: 'failed',
                            role: 'planner',
                            sessionId: plannerResult.sessionId
                        }, {
                            attempt,
                            transitionReason: 'planner_runtime_failure',
                            triggerBranch: 'planner runtime retry budget exhausted',
                            infrastructureError: infrastructureFailure.message,
                            infrastructureCode: infrastructureFailure.code,
                            resultTextPreview: buildStageEventTextPreview(plannerResolution.text, 500)
                        });
                        throw new BatchAnalysisTerminalError(failureMessage, 'failed', 'failed');
                    }
                    break;
                }
                const plannerText = plannerResolution.text;
                await logAnalysisProgress('Planner response received.', { stage: planningStage, role: 'planner', sessionId: plannerResult.sessionId }, {
                    attempt,
                    durationMs: plannerResult.durationMs,
                    toolCallCount: plannerResult.toolCalls.length,
                    rawOutputCount: plannerResult.rawOutput.length,
                    transcriptPath: plannerResult.transcriptPath,
                    textLength: plannerText.length,
                    parseable: plannerResolution.parseable,
                    usedTranscriptRecovery: plannerResolution.usedTranscript,
                    payloadCandidateCount: plannerResolution.initialCandidateCount,
                    transcriptCandidateCount: plannerResolution.transcriptCandidateCount,
                    resultTextPreview: buildStageEventTextPreview(plannerText)
                });
                let draftPlan = null;
                try {
                    draftPlan = parseDraftPlan(plannerText, plannerResult.sessionId);
                }
                catch (error) {
                    const parseError = error instanceof Error ? error.message : 'Planner output could not be parsed';
                    const locallySalvagedPlan = normalizeRecoveredJsonText(plannerText)
                        ?? salvagePlannerJsonText(plannerText);
                    let salvageSucceeded = false;
                    if (locallySalvagedPlan) {
                        try {
                            draftPlan = parseDraftPlan(locallySalvagedPlan, plannerResult.sessionId);
                            await logAnalysisProgress('Planner output was salvaged locally without a repair prompt.', {
                                stage: planningStage,
                                role: 'planner',
                                sessionId: plannerResult.sessionId
                            }, {
                                attempt,
                                parseError
                            });
                            salvageSucceeded = true;
                        }
                        catch {
                            salvageSucceeded = false;
                        }
                    }
                    if (salvageSucceeded) {
                        // Continue through the normal reviewer flow below using the locally salvaged plan.
                    }
                    else {
                        const fallbackMessage = buildPlanHumanReviewMessage('Planner returned incomplete output and could not be salvaged locally.');
                        emit({
                            id: payload.jobId,
                            command: payload.command,
                            state: shared_types_2.JobState.RUNNING,
                            progress: 32,
                            message: fallbackMessage,
                            metadata: buildStreamMetadata({ sessionId: plannerResult.sessionId })
                        });
                        await logAnalysisProgress('Planner output could not be salvaged locally; escalating to human review.', {
                            stage: 'needs_human_review',
                            role: 'planner',
                            sessionId: plannerResult.sessionId
                        }, {
                            attempt,
                            parseError,
                            textLength: plannerText.length,
                            transitionReason: 'planner_local_salvage_failed',
                            triggerBranch: 'local planner salvage returned null or remained invalid',
                            resultTextPreview: buildStageEventTextPreview(plannerText, 500)
                        });
                        throw new Error(fallbackMessage);
                    }
                }
                if (!draftPlan) {
                    throw new Error('Planner did not produce a draft plan');
                }
                const normalizedBatchReferences = batchAnalysisOrchestrator.normalizePlanBatchReferences({
                    plan: draftPlan,
                    uploadedPbis
                });
                draftPlan = normalizedBatchReferences.plan;
                if (normalizedBatchReferences.repairs.length > 0) {
                    await logAnalysisProgress('Deterministic batch-reference normalization repaired planner PBI references before review.', {
                        stage: planningStage,
                        role: 'planner',
                        sessionId: draftPlan.sessionId
                    }, {
                        attempt,
                        referenceRepairs: normalizedBatchReferences.repairs,
                        transitionReason: 'deterministic_batch_reference_repair'
                    });
                }
                if (normalizedBatchReferences.unresolvedReferenceIssues.length > 0) {
                    await logAnalysisProgress('Deterministic batch-reference validation found unresolved planner references.', {
                        stage: planningStage,
                        role: 'planner',
                        sessionId: draftPlan.sessionId
                    }, {
                        attempt,
                        unresolvedReferenceIssues: normalizedBatchReferences.unresolvedReferenceIssues,
                        transitionReason: 'deterministic_batch_reference_validation_failed'
                    });
                }
                const normalizedDraftPlanResult = await batchAnalysisOrchestrator.normalizePlanTargets({
                    workspaceId: input.workspaceId,
                    plan: draftPlan
                });
                draftPlan = normalizedDraftPlanResult.plan;
                if (normalizedDraftPlanResult.repairs.length > 0) {
                    await logAnalysisProgress('Deterministic target normalization repaired planner targets before review.', {
                        stage: planningStage,
                        role: 'planner',
                        sessionId: draftPlan.sessionId
                    }, {
                        attempt,
                        targetRepairs: normalizedDraftPlanResult.repairs,
                        transitionReason: 'deterministic_target_repair'
                    });
                }
                if (normalizedDraftPlanResult.unresolvedTargetIssues.length > 0) {
                    await logAnalysisProgress('Deterministic target validation found unresolved planner targets.', {
                        stage: planningStage,
                        role: 'planner',
                        sessionId: draftPlan.sessionId
                    }, {
                        attempt,
                        unresolvedTargetIssues: normalizedDraftPlanResult.unresolvedTargetIssues,
                        transitionReason: 'deterministic_target_validation_failed'
                    });
                }
                await batchAnalysisOrchestrator.recordPlan(draftPlan);
                await logAnalysisProgress('Planner draft plan recorded.', { stage: planningStage, role: 'planner', sessionId: draftPlan.sessionId }, {
                    attempt,
                    planId: draftPlan.id,
                    planVersion: draftPlan.planVersion,
                    coverageCount: draftPlan.coverage.length,
                    itemCount: draftPlan.items.length,
                    openQuestionCount: draftPlan.openQuestions.length
                });
                liveIteration = await batchAnalysisOrchestrator.transitionIteration({
                    workspaceId: input.workspaceId,
                    iterationId: orchestrationIteration.id,
                    stage: 'plan_reviewing',
                    role: 'plan-reviewer',
                    summary: 'Reviewing planner output for completeness and missed KB impact.',
                    agentModelId
                });
                streamMetadata.stage = 'plan_reviewing';
                streamMetadata.role = 'plan-reviewer';
                liveStageStartedAtUtc = liveIteration.updatedAtUtc;
                emit({
                    id: payload.jobId,
                    command: payload.command,
                    state: shared_types_2.JobState.RUNNING,
                    progress: 36,
                    message: 'Reviewing plan for missed creates, edits, and target issues...',
                    metadata: buildStreamMetadata()
                });
                const reviewPrompt = batchAnalysisOrchestrator.buildPlanReviewerPrompt({
                    batchContext,
                    uploadedPbis,
                    plan: draftPlan,
                    plannerPrefetch
                });
                let reviewResult = await agentRuntime.runBatchAnalysis({
                    ...input,
                    sessionId: liveSessionId,
                    kbAccessMode,
                    agentRole: 'plan-reviewer',
                    sessionMode: 'plan',
                    prompt: reviewPrompt
                }, (stream) => {
                    emit({
                        id: payload.jobId,
                        command: payload.command,
                        state: shared_types_2.JobState.RUNNING,
                        progress: 44,
                        message: JSON.stringify(stream),
                        metadata: buildStreamMetadata({ sessionId: stream.sessionId })
                    });
                }, isCancelled);
                liveSessionId = reviewResult.sessionId;
                let reviewResolution = await resolveBatchAnalysisResultText(agentRuntime, input.workspaceId, reviewResult.sessionId, reviewResult.resultPayload, 'plan_review');
                await persistBatchStageRun({
                    stage: 'plan_reviewing',
                    role: 'plan-reviewer',
                    result: reviewResult,
                    promptTemplate: reviewPrompt,
                    resolution: reviewResolution
                });
                const reviewNeedsResetRetry = shouldRetryReviewWithFreshSession(reviewResolution);
                if (reviewNeedsResetRetry) {
                    await logAnalysisProgress('Plan reviewer returned no parseable output; retrying once in a fresh session.', {
                        stage: 'plan_reviewing',
                        role: 'plan-reviewer',
                        sessionId: reviewResult.sessionId
                    }, {
                        attempt,
                        transitionReason: 'plan_review_empty_output_retry',
                        triggerBranch: 'reviewResolution had zero candidates and empty text'
                    });
                    reviewResult = await agentRuntime.runBatchAnalysis({
                        ...input,
                        sessionReusePolicy: 'reset_acp',
                        kbAccessMode,
                        agentRole: 'plan-reviewer',
                        sessionMode: 'plan',
                        prompt: reviewPrompt
                    }, (stream) => {
                        emit({
                            id: payload.jobId,
                            command: payload.command,
                            state: shared_types_2.JobState.RUNNING,
                            progress: 44,
                            message: JSON.stringify(stream),
                            metadata: buildStreamMetadata({ sessionId: stream.sessionId })
                        });
                    }, isCancelled);
                    liveSessionId = reviewResult.sessionId;
                    reviewResolution = await resolveBatchAnalysisResultText(agentRuntime, input.workspaceId, reviewResult.sessionId, reviewResult.resultPayload, 'plan_review');
                    await persistBatchStageRun({
                        stage: 'plan_reviewing',
                        role: 'plan-reviewer',
                        result: reviewResult,
                        promptTemplate: reviewPrompt,
                        retryType: 'plan_review_empty_output_retry',
                        sessionReusePolicy: 'reset_acp',
                        resolution: reviewResolution
                    });
                }
                const reviewText = reviewResolution.text;
                await logAnalysisProgress('Plan reviewer response received.', {
                    stage: 'plan_reviewing',
                    role: 'plan-reviewer',
                    sessionId: reviewResult.sessionId
                }, {
                    attempt,
                    durationMs: reviewResult.durationMs,
                    toolCallCount: reviewResult.toolCalls.length,
                    rawOutputCount: reviewResult.rawOutput.length,
                    transcriptPath: reviewResult.transcriptPath,
                    textLength: reviewText.length,
                    parseable: reviewResolution.parseable,
                    usedTranscriptRecovery: reviewResolution.usedTranscript,
                    payloadCandidateCount: reviewResolution.initialCandidateCount,
                    transcriptCandidateCount: reviewResolution.transcriptCandidateCount,
                    resultTextPreview: buildStageEventTextPreview(reviewText)
                });
                const normalizedReviewText = normalizeRecoveredJsonText(reviewText);
                const salvagedReviewText = normalizedReviewText ?? salvagePlanReviewJsonText(reviewText);
                let review;
                try {
                    review = batchAnalysisOrchestrator.parsePlanReviewResult({
                        workspaceId: input.workspaceId,
                        batchId: input.batchId,
                        iteration: orchestrationIteration,
                        plan: draftPlan,
                        resultText: salvagedReviewText ?? reviewText,
                        agentModelId,
                        sessionId: reviewResult.sessionId
                    });
                    if (salvagedReviewText && !reviewResolution.parseable) {
                        await logAnalysisProgress('Plan review output salvaged locally.', {
                            stage: 'plan_reviewing',
                            role: 'plan-reviewer',
                            sessionId: reviewResult.sessionId
                        }, {
                            attempt,
                            textLength: reviewText.length
                        });
                    }
                }
                catch (error) {
                    const fallbackSummary = 'Plan review output was malformed and could not be parsed safely.';
                    review = batchAnalysisOrchestrator.parsePlanReviewResult({
                        workspaceId: input.workspaceId,
                        batchId: input.batchId,
                        iteration: orchestrationIteration,
                        plan: draftPlan,
                        resultText: buildMalformedPlanReviewFallback(fallbackSummary),
                        agentModelId,
                        sessionId: reviewResult.sessionId
                    });
                    await logAnalysisProgress('Plan review output was malformed; escalating safely.', {
                        stage: 'plan_reviewing',
                        role: 'plan-reviewer',
                        sessionId: reviewResult.sessionId
                    }, {
                        attempt,
                        error: error instanceof Error ? error.message : String(error),
                        textLength: reviewText.length,
                        transitionReason: 'plan_review_output_malformed',
                        triggerBranch: 'plan review parse failed and malformed fallback was used',
                        resultTextPreview: buildStageEventTextPreview(reviewText)
                    });
                }
                const deterministicReviewGuard = batchAnalysisOrchestrator.applyDeterministicPlanReviewGuard({
                    plan: draftPlan,
                    review,
                    plannerPrefetch,
                    unresolvedTargetIssues: normalizedDraftPlanResult.unresolvedTargetIssues,
                    unresolvedReferenceIssues: normalizedBatchReferences.unresolvedReferenceIssues
                });
                review = deterministicReviewGuard.review;
                if (deterministicReviewGuard.missingEditTargets.length > 0) {
                    await logAnalysisProgress(deterministicReviewGuard.forcedRevision
                        ? 'Deterministic review guard blocked approval because likely edit targets were missing from the plan.'
                        : 'Deterministic review guard added likely missing edit targets to the review delta.', {
                        stage: 'plan_reviewing',
                        role: 'plan-reviewer',
                        sessionId: review.sessionId
                    }, {
                        attempt,
                        forcedRevision: deterministicReviewGuard.forcedRevision,
                        missingEditTargets: deterministicReviewGuard.missingEditTargets,
                        transitionReason: deterministicReviewGuard.forcedRevision
                            ? 'deterministic_prefetch_missing_edits'
                            : 'deterministic_prefetch_review_delta_augmented'
                    });
                }
                if (deterministicReviewGuard.missingCreateTargets.length > 0) {
                    await logAnalysisProgress(deterministicReviewGuard.forcedRevision
                        ? 'Deterministic review guard blocked approval because likely net-new article work was missing from the plan.'
                        : 'Deterministic review guard added likely net-new article work to the review delta.', {
                        stage: 'plan_reviewing',
                        role: 'plan-reviewer',
                        sessionId: review.sessionId
                    }, {
                        attempt,
                        forcedRevision: deterministicReviewGuard.forcedRevision,
                        missingCreateTargets: deterministicReviewGuard.missingCreateTargets,
                        transitionReason: deterministicReviewGuard.forcedRevision
                            ? 'deterministic_prefetch_missing_creates'
                            : 'deterministic_prefetch_review_delta_augmented'
                    });
                }
                if (deterministicReviewGuard.unresolvedTargetIssues.length > 0) {
                    await logAnalysisProgress(deterministicReviewGuard.forcedRevision
                        ? 'Deterministic target validation blocked approval because the plan still referenced unresolved KB targets.'
                        : 'Deterministic target validation added unresolved KB target corrections to the review delta.', {
                        stage: 'plan_reviewing',
                        role: 'plan-reviewer',
                        sessionId: review.sessionId
                    }, {
                        attempt,
                        forcedRevision: deterministicReviewGuard.forcedRevision,
                        unresolvedTargetIssues: deterministicReviewGuard.unresolvedTargetIssues,
                        transitionReason: deterministicReviewGuard.forcedRevision
                            ? 'deterministic_invalid_target_blocked_approval'
                            : 'deterministic_invalid_target_review_delta_augmented'
                    });
                }
                if (deterministicReviewGuard.unresolvedReferenceIssues.length > 0) {
                    await logAnalysisProgress(deterministicReviewGuard.forcedRevision
                        ? 'Deterministic batch-reference validation blocked approval because the plan still referenced unresolved uploaded PBIs.'
                        : 'Deterministic batch-reference validation added unresolved uploaded PBI corrections to the review delta.', {
                        stage: 'plan_reviewing',
                        role: 'plan-reviewer',
                        sessionId: review.sessionId
                    }, {
                        attempt,
                        forcedRevision: deterministicReviewGuard.forcedRevision,
                        unresolvedReferenceIssues: deterministicReviewGuard.unresolvedReferenceIssues,
                        transitionReason: deterministicReviewGuard.forcedRevision
                            ? 'deterministic_invalid_batch_reference_blocked_approval'
                            : 'deterministic_invalid_batch_reference_review_delta_augmented'
                    });
                }
                await batchAnalysisOrchestrator.recordReview(review);
                await logAnalysisProgress('Plan review recorded.', {
                    stage: 'plan_reviewing',
                    role: 'plan-reviewer',
                    sessionId: review.sessionId
                }, {
                    attempt,
                    reviewId: review.id,
                    verdict: review.verdict,
                    didAccountForEveryPbi: review.didAccountForEveryPbi,
                    hasMissingCreates: review.hasMissingCreates,
                    hasMissingEdits: review.hasMissingEdits,
                    hasTargetIssues: review.hasTargetIssues,
                    hasOverlapOrConflict: review.hasOverlapOrConflict,
                    foundAdditionalArticleWork: review.foundAdditionalArticleWork,
                    underScopedKbImpact: review.underScopedKbImpact,
                    triggerSummary: review.summary
                });
                if (review.verdict === 'approved') {
                    const approvedPlan = {
                        ...draftPlan,
                        id: (0, node_crypto_1.randomUUID)(),
                        verdict: 'approved',
                        createdAtUtc: new Date().toISOString(),
                        supersedesPlanId: draftPlan.id
                    };
                    await batchAnalysisOrchestrator.recordPlan(approvedPlan);
                    approvedPlanId = approvedPlan.id;
                    liveIteration = await batchAnalysisOrchestrator.transitionIteration({
                        workspaceId: input.workspaceId,
                        iterationId: orchestrationIteration.id,
                        stage: 'building',
                        role: 'worker',
                        summary: 'Plan approved. Executing worker stage.',
                        agentModelId,
                        approvedPlanId: approvedPlan.id,
                        lastReviewVerdict: review.verdict
                    });
                    liveApprovedPlanId = approvedPlan.id;
                    liveLastReviewVerdict = review.verdict;
                    liveStageStartedAtUtc = liveIteration.updatedAtUtc;
                    streamMetadata.stage = 'building';
                    streamMetadata.role = 'worker';
                    await logAnalysisProgress('Plan approved; advancing to worker stage.', {
                        stage: 'building',
                        role: 'worker'
                    }, {
                        attempt,
                        approvedPlanId: approvedPlan.id,
                        supersededPlanId: draftPlan.id,
                        previousStage: 'plan_reviewing',
                        previousRole: 'plan-reviewer',
                        transitionReason: 'plan_review_approved',
                        triggerBranch: 'review.verdict === approved',
                        triggerArtifactType: 'review',
                        triggerArtifactId: review.id,
                        triggerSessionId: review.sessionId,
                        triggerVerdict: review.verdict,
                        triggerSummary: review.summary
                    });
                    return { approvedPlan, review };
                }
                if (review.verdict === 'needs_human_review') {
                    const humanReviewMessage = buildPlanHumanReviewMessage(review.summary);
                    await logAnalysisProgress('Plan review escalated to human review.', {
                        stage: 'needs_human_review',
                        role: 'plan-reviewer'
                    }, {
                        attempt,
                        reviewId: review.id,
                        summary: review.summary,
                        transitionReason: 'plan_review_needs_human_review',
                        triggerBranch: 'review.verdict === needs_human_review',
                        triggerArtifactType: 'review',
                        triggerArtifactId: review.id,
                        triggerSessionId: review.sessionId,
                        triggerVerdict: review.verdict,
                        triggerSummary: review.summary
                    });
                    await workspaceRepository.updateBatchAnalysisIteration({
                        workspaceId: input.workspaceId,
                        iterationId: orchestrationIteration.id,
                        stage: 'needs_human_review',
                        role: 'plan-reviewer',
                        status: 'needs_human_review',
                        summary: humanReviewMessage,
                        agentModelId,
                        lastReviewVerdict: review.verdict
                    });
                    throw new Error(humanReviewMessage);
                }
                await logAnalysisProgress('Plan review requested another revision.', {
                    stage: 'plan_reviewing',
                    role: 'plan-reviewer',
                    sessionId: review.sessionId
                }, {
                    attempt,
                    reviewId: review.id,
                    summary: review.summary,
                    transitionReason: 'plan_review_needs_revision',
                    triggerBranch: 'review.verdict === needs_revision',
                    triggerArtifactType: 'review',
                    triggerArtifactId: review.id,
                    triggerSessionId: review.sessionId,
                    triggerVerdict: review.verdict,
                    triggerSummary: review.summary
                });
                return { draftPlan, review };
            };
            let planningOutcome = null;
            let priorPlanJson;
            let reviewDeltaJson;
            const maxPlannerAttempts = 3;
            for (let attempt = 1; attempt <= maxPlannerAttempts; attempt += 1) {
                const outcome = await runPlanningPass(attempt, priorPlanJson, reviewDeltaJson);
                if ('approvedPlan' in outcome) {
                    planningOutcome = outcome;
                    break;
                }
                priorPlanJson = JSON.stringify(outcome.draftPlan);
                reviewDeltaJson = outcome.review.delta ? JSON.stringify(outcome.review.delta) : undefined;
            }
            if (!planningOutcome?.approvedPlan || !approvedPlanId) {
                const humanReviewMessage = buildPlanHumanReviewMessage('Planner/reviewer loop did not reach an approved plan within the revision limit.');
                await logAnalysisProgress('Planner/reviewer loop exhausted without an approved plan.', {
                    stage: 'needs_human_review',
                    role: 'plan-reviewer'
                }, {
                    maxPlannerAttempts,
                    transitionReason: 'planner_revision_limit_exhausted',
                    triggerBranch: 'planning loop ended without approvedPlan',
                    triggerVerdict: liveLastReviewVerdict,
                    triggerSummary: 'Planner/reviewer loop did not reach an approved plan within the revision limit.'
                });
                await workspaceRepository.updateBatchAnalysisIteration({
                    workspaceId: input.workspaceId,
                    iterationId: orchestrationIteration.id,
                    stage: 'needs_human_review',
                    role: 'plan-reviewer',
                    status: 'needs_human_review',
                    summary: humanReviewMessage,
                    agentModelId
                });
                emit({
                    id: payload.jobId,
                    command: payload.command,
                    state: shared_types_2.JobState.FAILED,
                    progress: 100,
                    message: humanReviewMessage,
                    metadata: buildStreamMetadata()
                });
                return;
            }
            const runAnalysis = async (plan, extraInstructions) => {
                const promptTemplate = batchAnalysisOrchestrator.buildWorkerPrompt(plan, extraInstructions ?? input.prompt);
                const result = await agentRuntime.runBatchAnalysis({
                    ...input,
                    sessionId: liveSessionId,
                    kbAccessMode,
                    agentRole: 'worker',
                    sessionMode: 'agent',
                    prompt: promptTemplate
                }, (stream) => {
                    emit({
                        id: payload.jobId,
                        command: payload.command,
                        state: shared_types_2.JobState.RUNNING,
                        progress: stream.kind === 'result' ? 100 : 35,
                        message: JSON.stringify(stream),
                        metadata: buildStreamMetadata({ sessionId: stream.sessionId })
                    });
                }, isCancelled);
                return { result, promptTemplate };
            };
            const executeWorkerPass = async (approvedPlan, extraInstructions) => {
                const workerStage = (streamMetadata.stage ?? liveIteration.stage);
                const workerAttempt = await runAnalysis(approvedPlan, extraInstructions);
                let workerResult = workerAttempt.result;
                let workerPromptTemplate = workerAttempt.promptTemplate;
                const workerResolution = await resolveBatchAnalysisResultText(agentRuntime, input.workspaceId, workerResult.sessionId, workerResult.resultPayload, 'worker');
                await persistBatchStageRun({
                    stage: workerStage,
                    role: 'worker',
                    result: workerResult,
                    promptTemplate: workerPromptTemplate,
                    resolution: workerResolution
                });
                await logAnalysisProgress('Worker response received.', {
                    stage: workerStage,
                    role: 'worker',
                    sessionId: workerResult.sessionId
                }, {
                    rawOutputCount: workerResult.rawOutput.length,
                    transcriptPath: workerResult.transcriptPath,
                    textLength: workerResolution.text.length,
                    parseable: workerResolution.parseable,
                    usedTranscriptRecovery: workerResolution.usedTranscript,
                    payloadCandidateCount: workerResolution.initialCandidateCount,
                    transcriptCandidateCount: workerResolution.transcriptCandidateCount,
                    kbAccessMode,
                    status: workerResult.status
                });
                const workerFallbackSummary = workerResult.message ?? 'Worker pass completed.';
                const locallySalvagedWorker = extractJsonObject(workerResolution.text);
                let workerParsed;
                try {
                    workerParsed = batchAnalysisOrchestrator.parseWorkerResult(locallySalvagedWorker ? JSON.stringify(locallySalvagedWorker) : workerResolution.text, workerFallbackSummary, workerResult.sessionId);
                    if (locallySalvagedWorker && !workerResolution.parseable) {
                        await logAnalysisProgress('Worker output salvaged locally.', {
                            stage: workerStage,
                            role: 'worker',
                            sessionId: workerResult.sessionId
                        }, {
                            textLength: workerResolution.text.length,
                            kbAccessMode
                        });
                    }
                }
                catch (error) {
                    const proposalRecords = await workspaceRepository.listBatchProposalRecords(input.workspaceId, input.batchId, {
                        includeStaged: true,
                        openOnly: true
                    });
                    const fallbackProposalQueue = proposalRecords.map((proposal) => ({
                        proposalId: proposal.id,
                        queueOrder: proposal.queueOrder,
                        action: proposal.action,
                        reviewStatus: proposal.reviewStatus,
                        articleKey: proposal.localeVariantId
                            ? `locale:${proposal.localeVariantId}`
                            : proposal.familyId
                                ? `family:${proposal.familyId}`
                                : `title:${proposal.targetTitle ?? proposal.id}`,
                        articleLabel: proposal.targetTitle ?? 'Untitled proposal target',
                        locale: proposal.targetLocale,
                        confidenceScore: proposal.confidenceScore,
                        rationaleSummary: proposal.rationaleSummary,
                        relatedPbiCount: 0
                    }));
                    workerParsed = {
                        summary: summarizeWorkerExecutionFallback(workerFallbackSummary, fallbackProposalQueue),
                        discoveredWork: []
                    };
                    await logAnalysisProgress('Worker output was malformed; using execution fallback summary.', {
                        stage: workerStage,
                        role: 'worker',
                        sessionId: workerResult.sessionId
                    }, {
                        error: error instanceof Error ? error.message : String(error),
                        textLength: workerResolution.text.length,
                        proposalCount: proposalRecords.length,
                        kbAccessMode
                    });
                }
                liveSessionId = workerResult.sessionId;
                return {
                    result: workerResult,
                    workerSummary: workerParsed.summary,
                    discoveredWork: workerParsed.discoveredWork
                };
            };
            let workerPass = await executeWorkerPass(planningOutcome.approvedPlan);
            const maxAmendmentLoops = 2;
            let amendmentLoops = 0;
            let activeApprovedPlan = planningOutcome.approvedPlan;
            while (workerPass.result.status === 'ok' && workerPass.discoveredWork.some((item) => item.requiresPlanAmendment)) {
                amendmentLoops += 1;
                const discoveredForAmendment = workerPass.discoveredWork.filter((item) => item.requiresPlanAmendment);
                await logAnalysisProgress('Worker discovered additional scope requiring plan amendment.', {
                    stage: 'worker_discovery_review',
                    role: 'planner',
                    sessionId: workerPass.result.sessionId
                }, {
                    discoveredCount: discoveredForAmendment.length,
                    totalDiscoveredCount: workerPass.discoveredWork.length,
                    amendmentLoop: amendmentLoops
                });
                const workerPassRecord = await batchAnalysisOrchestrator.recordWorkerPass({
                    iteration: orchestrationIteration,
                    workspaceId: input.workspaceId,
                    batchId: input.batchId,
                    agentModelId,
                    approvedPlan: activeApprovedPlan,
                    result: workerPass.result,
                    summary: workerPass.workerSummary,
                    discoveredWork: workerPass.discoveredWork
                });
                liveExecutionCounts = workerPassRecord.executionCounts;
                liveOutstandingDiscoveredWorkCount = workerPassRecord.workerReport.discoveredWork.length;
                liveIteration = await batchAnalysisOrchestrator.transitionIteration({
                    workspaceId: input.workspaceId,
                    iterationId: orchestrationIteration.id,
                    stage: 'worker_discovery_review',
                    role: 'planner',
                    summary: 'Worker discovered additional scope. Reviewing amendment.',
                    agentModelId
                });
                streamMetadata.stage = 'worker_discovery_review';
                streamMetadata.role = 'planner';
                liveStageStartedAtUtc = liveIteration.updatedAtUtc;
                const amendmentId = (0, node_crypto_1.randomUUID)();
                await batchAnalysisOrchestrator.recordAmendment({
                    id: amendmentId,
                    workspaceId: input.workspaceId,
                    batchId: input.batchId,
                    iterationId: orchestrationIteration.id,
                    approvedPlanId: activeApprovedPlan.id,
                    sourceWorkerReportId: workerPassRecord.workerReport.id,
                    sourceDiscoveryIds: discoveredForAmendment.map((item) => item.discoveryId),
                    status: 'pending',
                    summary: 'Worker discoveries routed into amendment review.',
                    createdAtUtc: new Date().toISOString(),
                    updatedAtUtc: new Date().toISOString()
                });
                emit({
                    id: payload.jobId,
                    command: payload.command,
                    state: shared_types_2.JobState.RUNNING,
                    progress: 68,
                    message: `Reviewing ${discoveredForAmendment.length} discovered work item(s) before continuing execution...`,
                    metadata: buildStreamMetadata()
                });
                const amendmentPlannerResult = await agentRuntime.runBatchAnalysis({
                    ...input,
                    sessionId: liveSessionId,
                    kbAccessMode,
                    agentRole: 'planner',
                    sessionMode: 'plan',
                    prompt: batchAnalysisOrchestrator.buildAmendmentPlannerPrompt({
                        batchContext,
                        uploadedPbis,
                        approvedPlan: activeApprovedPlan,
                        discoveredWork: discoveredForAmendment,
                        plannerPrefetch
                    })
                }, (stream) => {
                    emit({
                        id: payload.jobId,
                        command: payload.command,
                        state: shared_types_2.JobState.RUNNING,
                        progress: 72,
                        message: JSON.stringify(stream),
                        metadata: buildStreamMetadata({ sessionId: stream.sessionId })
                    });
                }, isCancelled);
                liveSessionId = amendmentPlannerResult.sessionId;
                const amendmentPlannerResolution = await resolveBatchAnalysisResultText(agentRuntime, input.workspaceId, amendmentPlannerResult.sessionId, amendmentPlannerResult.resultPayload, 'planner');
                await persistBatchStageRun({
                    stage: 'worker_discovery_review',
                    role: 'planner',
                    result: amendmentPlannerResult,
                    resolution: amendmentPlannerResolution
                });
                await logAnalysisProgress('Amendment planner response received.', {
                    stage: 'worker_discovery_review',
                    role: 'planner',
                    sessionId: amendmentPlannerResult.sessionId
                }, {
                    amendmentLoop: amendmentLoops,
                    durationMs: amendmentPlannerResult.durationMs,
                    toolCallCount: amendmentPlannerResult.toolCalls.length,
                    textLength: amendmentPlannerResolution.text.length,
                    parseable: amendmentPlannerResolution.parseable,
                    usedTranscriptRecovery: amendmentPlannerResolution.usedTranscript,
                    payloadCandidateCount: amendmentPlannerResolution.initialCandidateCount,
                    transcriptCandidateCount: amendmentPlannerResolution.transcriptCandidateCount
                });
                let amendmentDraftPlan = batchAnalysisOrchestrator.parsePlannerResult({
                    workspaceId: input.workspaceId,
                    batchId: input.batchId,
                    iteration: orchestrationIteration,
                    resultText: amendmentPlannerResolution.text,
                    agentModelId,
                    sessionId: amendmentPlannerResult.sessionId,
                    planVersion: activeApprovedPlan.planVersion + 1,
                    supersedesPlanId: activeApprovedPlan.id
                });
                const normalizedAmendmentBatchReferences = batchAnalysisOrchestrator.normalizePlanBatchReferences({
                    plan: amendmentDraftPlan,
                    uploadedPbis
                });
                amendmentDraftPlan = normalizedAmendmentBatchReferences.plan;
                if (normalizedAmendmentBatchReferences.repairs.length > 0) {
                    await logAnalysisProgress('Deterministic batch-reference normalization repaired amendment planner PBI references before review.', {
                        stage: 'worker_discovery_review',
                        role: 'planner',
                        sessionId: amendmentDraftPlan.sessionId
                    }, {
                        amendmentLoop: amendmentLoops,
                        referenceRepairs: normalizedAmendmentBatchReferences.repairs,
                        transitionReason: 'deterministic_batch_reference_repair'
                    });
                }
                if (normalizedAmendmentBatchReferences.unresolvedReferenceIssues.length > 0) {
                    await logAnalysisProgress('Deterministic batch-reference validation found unresolved amendment planner references.', {
                        stage: 'worker_discovery_review',
                        role: 'planner',
                        sessionId: amendmentDraftPlan.sessionId
                    }, {
                        amendmentLoop: amendmentLoops,
                        unresolvedReferenceIssues: normalizedAmendmentBatchReferences.unresolvedReferenceIssues,
                        transitionReason: 'deterministic_batch_reference_validation_failed'
                    });
                }
                const normalizedAmendmentDraftPlanResult = await batchAnalysisOrchestrator.normalizePlanTargets({
                    workspaceId: input.workspaceId,
                    plan: amendmentDraftPlan
                });
                amendmentDraftPlan = normalizedAmendmentDraftPlanResult.plan;
                if (normalizedAmendmentDraftPlanResult.repairs.length > 0) {
                    await logAnalysisProgress('Deterministic target normalization repaired amendment planner targets before review.', {
                        stage: 'worker_discovery_review',
                        role: 'planner',
                        sessionId: amendmentDraftPlan.sessionId
                    }, {
                        amendmentLoop: amendmentLoops,
                        targetRepairs: normalizedAmendmentDraftPlanResult.repairs,
                        transitionReason: 'deterministic_target_repair'
                    });
                }
                if (normalizedAmendmentDraftPlanResult.unresolvedTargetIssues.length > 0) {
                    await logAnalysisProgress('Deterministic target validation found unresolved amendment planner targets.', {
                        stage: 'worker_discovery_review',
                        role: 'planner',
                        sessionId: amendmentDraftPlan.sessionId
                    }, {
                        amendmentLoop: amendmentLoops,
                        unresolvedTargetIssues: normalizedAmendmentDraftPlanResult.unresolvedTargetIssues,
                        transitionReason: 'deterministic_target_validation_failed'
                    });
                }
                await batchAnalysisOrchestrator.recordPlan(amendmentDraftPlan);
                streamMetadata.role = 'plan-reviewer';
                liveSessionId = amendmentPlannerResult.sessionId;
                const amendmentReviewResult = await agentRuntime.runBatchAnalysis({
                    ...input,
                    sessionId: liveSessionId,
                    kbAccessMode,
                    agentRole: 'plan-reviewer',
                    sessionMode: 'plan',
                    prompt: batchAnalysisOrchestrator.buildPlanReviewerPrompt({
                        batchContext,
                        uploadedPbis,
                        plan: amendmentDraftPlan,
                        plannerPrefetch
                    })
                }, (stream) => {
                    emit({
                        id: payload.jobId,
                        command: payload.command,
                        state: shared_types_2.JobState.RUNNING,
                        progress: 76,
                        message: JSON.stringify(stream),
                        metadata: buildStreamMetadata({ role: 'plan-reviewer', sessionId: stream.sessionId })
                    });
                }, isCancelled);
                liveSessionId = amendmentReviewResult.sessionId;
                const amendmentReviewResolution = await resolveBatchAnalysisResultText(agentRuntime, input.workspaceId, amendmentReviewResult.sessionId, amendmentReviewResult.resultPayload, 'plan_review');
                await persistBatchStageRun({
                    stage: 'worker_discovery_review',
                    role: 'plan-reviewer',
                    result: amendmentReviewResult,
                    resolution: amendmentReviewResolution
                });
                await logAnalysisProgress('Amendment reviewer response received.', {
                    stage: 'worker_discovery_review',
                    role: 'plan-reviewer',
                    sessionId: amendmentReviewResult.sessionId
                }, {
                    amendmentLoop: amendmentLoops,
                    durationMs: amendmentReviewResult.durationMs,
                    toolCallCount: amendmentReviewResult.toolCalls.length,
                    textLength: amendmentReviewResolution.text.length,
                    parseable: amendmentReviewResolution.parseable,
                    usedTranscriptRecovery: amendmentReviewResolution.usedTranscript,
                    payloadCandidateCount: amendmentReviewResolution.initialCandidateCount,
                    transcriptCandidateCount: amendmentReviewResolution.transcriptCandidateCount,
                    resultTextPreview: buildStageEventTextPreview(amendmentReviewResolution.text)
                });
                const normalizedAmendmentReviewText = normalizeRecoveredJsonText(amendmentReviewResolution.text);
                const salvagedAmendmentReviewText = normalizedAmendmentReviewText
                    ?? salvagePlanReviewJsonText(amendmentReviewResolution.text);
                let amendmentReview;
                try {
                    amendmentReview = batchAnalysisOrchestrator.parsePlanReviewResult({
                        workspaceId: input.workspaceId,
                        batchId: input.batchId,
                        iteration: orchestrationIteration,
                        plan: amendmentDraftPlan,
                        resultText: salvagedAmendmentReviewText ?? amendmentReviewResolution.text,
                        agentModelId,
                        sessionId: amendmentReviewResult.sessionId
                    });
                    if (salvagedAmendmentReviewText && !amendmentReviewResolution.parseable) {
                        await logAnalysisProgress('Amendment review output salvaged locally.', {
                            stage: 'worker_discovery_review',
                            role: 'plan-reviewer',
                            sessionId: amendmentReviewResult.sessionId
                        }, {
                            amendmentLoop: amendmentLoops,
                            textLength: amendmentReviewResolution.text.length
                        });
                    }
                }
                catch (error) {
                    const fallbackSummary = 'Amendment review output was malformed and could not be parsed safely.';
                    amendmentReview = batchAnalysisOrchestrator.parsePlanReviewResult({
                        workspaceId: input.workspaceId,
                        batchId: input.batchId,
                        iteration: orchestrationIteration,
                        plan: amendmentDraftPlan,
                        resultText: buildMalformedPlanReviewFallback(fallbackSummary),
                        agentModelId,
                        sessionId: amendmentReviewResult.sessionId
                    });
                    await logAnalysisProgress('Amendment review output was malformed; escalating safely.', {
                        stage: 'worker_discovery_review',
                        role: 'plan-reviewer',
                        sessionId: amendmentReviewResult.sessionId
                    }, {
                        amendmentLoop: amendmentLoops,
                        error: error instanceof Error ? error.message : String(error),
                        textLength: amendmentReviewResolution.text.length,
                        transitionReason: 'amendment_review_output_malformed',
                        triggerBranch: 'amendment review parse failed and malformed fallback was used',
                        resultTextPreview: buildStageEventTextPreview(amendmentReviewResolution.text)
                    });
                }
                const deterministicAmendmentReviewGuard = batchAnalysisOrchestrator.applyDeterministicPlanReviewGuard({
                    plan: amendmentDraftPlan,
                    review: amendmentReview,
                    plannerPrefetch,
                    unresolvedTargetIssues: normalizedAmendmentDraftPlanResult.unresolvedTargetIssues,
                    unresolvedReferenceIssues: normalizedAmendmentBatchReferences.unresolvedReferenceIssues
                });
                amendmentReview = deterministicAmendmentReviewGuard.review;
                if (deterministicAmendmentReviewGuard.missingEditTargets.length > 0) {
                    await logAnalysisProgress(deterministicAmendmentReviewGuard.forcedRevision
                        ? 'Deterministic review guard blocked amendment approval because likely edit targets were still missing.'
                        : 'Deterministic review guard added likely missing edit targets to the amendment review delta.', {
                        stage: 'worker_discovery_review',
                        role: 'plan-reviewer',
                        sessionId: amendmentReview.sessionId
                    }, {
                        amendmentLoop: amendmentLoops,
                        forcedRevision: deterministicAmendmentReviewGuard.forcedRevision,
                        missingEditTargets: deterministicAmendmentReviewGuard.missingEditTargets,
                        transitionReason: deterministicAmendmentReviewGuard.forcedRevision
                            ? 'deterministic_prefetch_missing_edits'
                            : 'deterministic_prefetch_review_delta_augmented'
                    });
                }
                if (deterministicAmendmentReviewGuard.missingCreateTargets.length > 0) {
                    await logAnalysisProgress(deterministicAmendmentReviewGuard.forcedRevision
                        ? 'Deterministic review guard blocked amendment approval because likely net-new article work was still missing.'
                        : 'Deterministic review guard added likely net-new article work to the amendment review delta.', {
                        stage: 'worker_discovery_review',
                        role: 'plan-reviewer',
                        sessionId: amendmentReview.sessionId
                    }, {
                        amendmentLoop: amendmentLoops,
                        forcedRevision: deterministicAmendmentReviewGuard.forcedRevision,
                        missingCreateTargets: deterministicAmendmentReviewGuard.missingCreateTargets,
                        transitionReason: deterministicAmendmentReviewGuard.forcedRevision
                            ? 'deterministic_prefetch_missing_creates'
                            : 'deterministic_prefetch_review_delta_augmented'
                    });
                }
                if (deterministicAmendmentReviewGuard.unresolvedTargetIssues.length > 0) {
                    await logAnalysisProgress(deterministicAmendmentReviewGuard.forcedRevision
                        ? 'Deterministic target validation blocked amendment approval because the plan still referenced unresolved KB targets.'
                        : 'Deterministic target validation added unresolved KB target corrections to the amendment review delta.', {
                        stage: 'worker_discovery_review',
                        role: 'plan-reviewer',
                        sessionId: amendmentReview.sessionId
                    }, {
                        amendmentLoop: amendmentLoops,
                        forcedRevision: deterministicAmendmentReviewGuard.forcedRevision,
                        unresolvedTargetIssues: deterministicAmendmentReviewGuard.unresolvedTargetIssues,
                        transitionReason: deterministicAmendmentReviewGuard.forcedRevision
                            ? 'deterministic_invalid_target_blocked_approval'
                            : 'deterministic_invalid_target_review_delta_augmented'
                    });
                }
                if (deterministicAmendmentReviewGuard.unresolvedReferenceIssues.length > 0) {
                    await logAnalysisProgress(deterministicAmendmentReviewGuard.forcedRevision
                        ? 'Deterministic batch-reference validation blocked amendment approval because the plan still referenced unresolved uploaded PBIs.'
                        : 'Deterministic batch-reference validation added unresolved uploaded PBI corrections to the amendment review delta.', {
                        stage: 'worker_discovery_review',
                        role: 'plan-reviewer',
                        sessionId: amendmentReview.sessionId
                    }, {
                        amendmentLoop: amendmentLoops,
                        forcedRevision: deterministicAmendmentReviewGuard.forcedRevision,
                        unresolvedReferenceIssues: deterministicAmendmentReviewGuard.unresolvedReferenceIssues,
                        transitionReason: deterministicAmendmentReviewGuard.forcedRevision
                            ? 'deterministic_invalid_batch_reference_blocked_approval'
                            : 'deterministic_invalid_batch_reference_review_delta_augmented'
                    });
                }
                await batchAnalysisOrchestrator.recordReview(amendmentReview);
                if (amendmentReview.verdict !== 'approved') {
                    const amendmentStatus = amendmentReview.verdict === 'needs_human_review' ? 'needs_human_review' : 'rejected';
                    await batchAnalysisOrchestrator.recordAmendment({
                        id: (0, node_crypto_1.randomUUID)(),
                        workspaceId: input.workspaceId,
                        batchId: input.batchId,
                        iterationId: orchestrationIteration.id,
                        approvedPlanId: activeApprovedPlan.id,
                        sourceWorkerReportId: workerPassRecord.workerReport.id,
                        sourceDiscoveryIds: discoveredForAmendment.map((item) => item.discoveryId),
                        proposedPlanId: amendmentDraftPlan.id,
                        reviewId: amendmentReview.id,
                        status: amendmentStatus,
                        summary: amendmentReview.summary,
                        createdAtUtc: new Date().toISOString(),
                        updatedAtUtc: new Date().toISOString()
                    });
                    if (amendmentStatus === 'rejected') {
                        await workspaceRepository.updateBatchAnalysisDiscoveredWorkStatuses({
                            workspaceId: input.workspaceId,
                            discoveryIds: discoveredForAmendment.map((item) => item.discoveryId),
                            status: 'rejected'
                        });
                        liveOutstandingDiscoveredWorkCount = Math.max(0, liveOutstandingDiscoveredWorkCount - discoveredForAmendment.length);
                    }
                    if (amendmentReview.verdict === 'needs_human_review' || amendmentLoops >= maxAmendmentLoops) {
                        await logAnalysisProgress('Amendment review halted execution and requires human review.', {
                            stage: 'needs_human_review',
                            role: 'plan-reviewer',
                            sessionId: amendmentReview.sessionId
                        }, {
                            amendmentLoop: amendmentLoops,
                            transitionReason: amendmentReview.verdict === 'needs_human_review'
                                ? 'amendment_review_needs_human_review'
                                : 'amendment_revision_limit_exhausted',
                            triggerBranch: amendmentReview.verdict === 'needs_human_review'
                                ? 'amendmentReview.verdict === needs_human_review'
                                : 'amendmentLoops >= maxAmendmentLoops',
                            triggerArtifactType: 'review',
                            triggerArtifactId: amendmentReview.id,
                            triggerSessionId: amendmentReview.sessionId,
                            triggerVerdict: amendmentReview.verdict,
                            triggerSummary: amendmentReview.summary
                        });
                        await workspaceRepository.updateBatchAnalysisIteration({
                            workspaceId: input.workspaceId,
                            iterationId: orchestrationIteration.id,
                            stage: 'needs_human_review',
                            role: 'plan-reviewer',
                            status: 'needs_human_review',
                            summary: amendmentReview.summary,
                            agentModelId
                        });
                        emit({
                            id: payload.jobId,
                            command: payload.command,
                            state: shared_types_2.JobState.FAILED,
                            progress: 100,
                            message: 'Worker discoveries require human review before execution can continue.',
                            metadata: buildStreamMetadata()
                        });
                        return;
                    }
                    break;
                }
                const approvedAmendmentPlan = {
                    ...amendmentDraftPlan,
                    id: (0, node_crypto_1.randomUUID)(),
                    verdict: 'approved',
                    createdAtUtc: new Date().toISOString(),
                    supersedesPlanId: amendmentDraftPlan.id
                };
                await batchAnalysisOrchestrator.recordPlan(approvedAmendmentPlan);
                await batchAnalysisOrchestrator.recordAmendment({
                    id: (0, node_crypto_1.randomUUID)(),
                    workspaceId: input.workspaceId,
                    batchId: input.batchId,
                    iterationId: orchestrationIteration.id,
                    approvedPlanId: activeApprovedPlan.id,
                    sourceWorkerReportId: workerPassRecord.workerReport.id,
                    sourceDiscoveryIds: discoveredForAmendment.map((item) => item.discoveryId),
                    proposedPlanId: approvedAmendmentPlan.id,
                    reviewId: amendmentReview.id,
                    status: 'approved',
                    summary: amendmentReview.summary,
                    createdAtUtc: new Date().toISOString(),
                    updatedAtUtc: new Date().toISOString()
                });
                await workspaceRepository.updateBatchAnalysisDiscoveredWorkStatuses({
                    workspaceId: input.workspaceId,
                    discoveryIds: discoveredForAmendment.map((item) => item.discoveryId),
                    status: 'approved'
                });
                liveOutstandingDiscoveredWorkCount = Math.max(0, liveOutstandingDiscoveredWorkCount - discoveredForAmendment.length);
                activeApprovedPlan = approvedAmendmentPlan;
                approvedPlanId = approvedAmendmentPlan.id;
                liveIteration = await batchAnalysisOrchestrator.transitionIteration({
                    workspaceId: input.workspaceId,
                    iterationId: orchestrationIteration.id,
                    stage: 'building',
                    role: 'worker',
                    summary: 'Plan amendment approved. Resuming worker execution.',
                    agentModelId,
                    approvedPlanId
                });
                streamMetadata.stage = 'building';
                streamMetadata.role = 'worker';
                liveApprovedPlanId = approvedPlanId;
                liveLastReviewVerdict = amendmentReview.verdict;
                liveStageStartedAtUtc = liveIteration.updatedAtUtc;
                await logAnalysisProgress('Amendment approved; resuming worker execution.', {
                    stage: 'building',
                    role: 'worker',
                    sessionId: amendmentReview.sessionId
                }, {
                    amendmentLoop: amendmentLoops,
                    approvedPlanId,
                    previousStage: 'worker_discovery_review',
                    previousRole: 'plan-reviewer',
                    transitionReason: 'amendment_review_approved',
                    triggerBranch: 'amendmentReview.verdict === approved',
                    triggerArtifactType: 'review',
                    triggerArtifactId: amendmentReview.id,
                    triggerSessionId: amendmentReview.sessionId,
                    triggerVerdict: amendmentReview.verdict,
                    triggerSummary: amendmentReview.summary
                });
                workerPass = await executeWorkerPass(activeApprovedPlan, 'Resume execution against the approved amended plan. Only execute work that remains pending or newly added.');
            }
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.RUNNING,
                progress: 92,
                message: 'Finalizing analysis run...',
                metadata: buildStreamMetadata({
                    status: workerPass.result.status,
                    sessionId: workerPass.result.sessionId
                })
            });
            logger_1.logger.info('[agent.analysis.run] runtime finished', {
                jobId: payload.jobId,
                batchId: input.batchId,
                status: workerPass.result.status,
                kbAccessMode,
                toolCalls: workerPass.result.toolCalls.length,
                transcriptPath: workerPass.result.transcriptPath
            });
            await logAnalysisProgress('Primary worker runtime finished.', {
                stage: streamMetadata.stage,
                role: streamMetadata.role,
                sessionId: workerPass.result.sessionId
            }, {
                status: workerPass.result.status,
                kbAccessMode,
                durationMs: workerPass.result.durationMs,
                toolCallCount: workerPass.result.toolCalls.length,
                transcriptPath: workerPass.result.transcriptPath
            });
            const persistedStatus = workerPass.result.status === 'ok'
                ? 'complete'
                : workerPass.result.status === 'canceled'
                    ? 'canceled'
                    : 'failed';
            await workspaceRepository.recordBatchAnalysisRun({
                workspaceId: input.workspaceId,
                batchId: input.batchId,
                sessionId: workerPass.result.sessionId,
                kbAccessMode,
                agentModelId,
                status: persistedStatus,
                startedAtUtc: workerPass.result.startedAtUtc,
                endedAtUtc: workerPass.result.endedAtUtc,
                promptTemplate: input.prompt,
                transcriptPath: workerPass.result.transcriptPath,
                toolCalls: workerPass.result.toolCalls,
                rawOutput: workerPass.result.rawOutput,
                message: workerPass.result.message
            });
            const workerRecordResult = await batchAnalysisOrchestrator.recordWorkerPass({
                iteration: orchestrationIteration,
                workspaceId: input.workspaceId,
                batchId: input.batchId,
                agentModelId,
                approvedPlan: activeApprovedPlan,
                summary: workerPass.workerSummary,
                discoveredWork: workerPass.discoveredWork,
                result: workerPass.result
            });
            let latestWorkerReport = workerRecordResult.workerReport;
            let latestExecutionCounts = workerRecordResult.executionCounts;
            liveExecutionCounts = latestExecutionCounts;
            liveOutstandingDiscoveredWorkCount = latestWorkerReport.discoveredWork.length;
            liveSessionId = workerPass.result.sessionId;
            const runFinalReview = async () => {
                liveIteration = await batchAnalysisOrchestrator.transitionIteration({
                    workspaceId: input.workspaceId,
                    iterationId: orchestrationIteration.id,
                    stage: 'final_reviewing',
                    role: 'final-reviewer',
                    summary: 'Running final review against worker outputs.',
                    agentModelId,
                    approvedPlanId: activeApprovedPlan.id
                });
                streamMetadata.stage = 'final_reviewing';
                streamMetadata.role = 'final-reviewer';
                liveApprovedPlanId = activeApprovedPlan.id;
                liveStageStartedAtUtc = liveIteration.updatedAtUtc;
                const finalReviewSession = agentRuntime.createSession({
                    workspaceId: input.workspaceId,
                    kbAccessMode,
                    type: 'batch_analysis',
                    mode: 'plan',
                    role: 'final-reviewer',
                    batchId: input.batchId,
                    locale: input.locale,
                    templatePackId: input.templatePackId
                });
                liveSessionId = finalReviewSession.id;
                const proposalContext = await buildFinalReviewProposalContext(workspaceRepository, input.workspaceId, latestWorkerReport);
                const finalReviewPrompt = batchAnalysisOrchestrator.buildFinalReviewerPrompt({
                    batchContext,
                    uploadedPbis,
                    approvedPlan: activeApprovedPlan,
                    workerReport: latestWorkerReport,
                    discoveredWork: latestWorkerReport.discoveredWork,
                    proposalContext
                });
                const finalReviewStartedAtUtc = new Date().toISOString();
                let finalReviewResult;
                let finalReviewResolution;
                try {
                    finalReviewResult = await runBatchAnalysisWithStageWatchdog(agentRuntime, {
                        ...input,
                        sessionId: finalReviewSession.id,
                        kbAccessMode,
                        agentRole: 'final-reviewer',
                        sessionMode: 'plan',
                        timeoutMs: FINAL_REVIEW_STAGE_TIMEOUT_MS,
                        prompt: finalReviewPrompt
                    }, (stream) => {
                        emit({
                            id: payload.jobId,
                            command: payload.command,
                            state: shared_types_2.JobState.RUNNING,
                            progress: 95,
                            message: JSON.stringify(stream),
                            metadata: buildStreamMetadata({ sessionId: stream.sessionId })
                        });
                    }, isCancelled, {
                        stage: 'final_reviewing',
                        sessionId: finalReviewSession.id,
                        watchdogMs: FINAL_REVIEW_STAGE_WATCHDOG_MS
                    });
                    liveSessionId = finalReviewResult.sessionId;
                    finalReviewResolution = await resolveBatchAnalysisResultText(agentRuntime, input.workspaceId, finalReviewResult.sessionId, finalReviewResult.resultPayload, 'final_review');
                    await persistBatchStageRun({
                        stage: 'final_reviewing',
                        role: 'final-reviewer',
                        result: finalReviewResult,
                        promptTemplate: finalReviewPrompt,
                        sessionReusePolicy: 'new_local_session',
                        resolution: finalReviewResolution
                    });
                    await logAnalysisProgress('Final reviewer response received.', {
                        stage: 'final_reviewing',
                        role: 'final-reviewer',
                        sessionId: finalReviewResult.sessionId
                    }, {
                        durationMs: finalReviewResult.durationMs,
                        toolCallCount: finalReviewResult.toolCalls.length,
                        textLength: finalReviewResolution.text.length,
                        parseable: finalReviewResolution.parseable,
                        usedTranscriptRecovery: finalReviewResolution.usedTranscript,
                        payloadCandidateCount: finalReviewResolution.initialCandidateCount,
                        transcriptCandidateCount: finalReviewResolution.transcriptCandidateCount,
                        rawOutputCount: finalReviewResult.rawOutput.length,
                        transcriptPath: finalReviewResult.transcriptPath,
                        proposalSnapshotCount: proposalContext.length,
                        resultTextPreview: buildStageEventTextPreview(finalReviewResolution.text)
                    });
                }
                catch (error) {
                    const status = inferBatchStageFailureStatus(error);
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    finalReviewResult = {
                        sessionId: finalReviewSession.id,
                        kbAccessMode,
                        status,
                        startedAtUtc: finalReviewStartedAtUtc,
                        endedAtUtc: new Date().toISOString(),
                        transcriptPath: '',
                        rawOutput: [],
                        toolCalls: [],
                        durationMs: Math.max(0, Date.now() - Date.parse(finalReviewStartedAtUtc)),
                        message: errorMessage
                    };
                    liveSessionId = finalReviewSession.id;
                    finalReviewResolution = await resolveBatchAnalysisResultText(agentRuntime, input.workspaceId, finalReviewSession.id, undefined, 'final_review');
                    await persistBatchStageRun({
                        stage: 'final_reviewing',
                        role: 'final-reviewer',
                        result: finalReviewResult,
                        promptTemplate: finalReviewPrompt,
                        sessionReusePolicy: 'new_local_session',
                        resolution: finalReviewResolution
                    });
                    await logAnalysisProgress('Final reviewer failed to finish cleanly; escalating with transcript recovery when possible.', {
                        stage: 'final_reviewing',
                        role: 'final-reviewer',
                        sessionId: finalReviewSession.id
                    }, {
                        error: errorMessage,
                        transitionReason: status === 'timeout' ? 'final_review_timeout' : 'final_review_runtime_error',
                        triggerBranch: status === 'timeout'
                            ? 'final review stage exceeded the watchdog'
                            : 'final review stage threw before a clean structured result',
                        textLength: finalReviewResolution.text.length,
                        parseable: finalReviewResolution.parseable,
                        usedTranscriptRecovery: finalReviewResolution.usedTranscript,
                        payloadCandidateCount: finalReviewResolution.initialCandidateCount,
                        transcriptCandidateCount: finalReviewResolution.transcriptCandidateCount,
                        proposalSnapshotCount: proposalContext.length,
                        resultTextPreview: buildStageEventTextPreview(finalReviewResolution.text)
                    });
                }
                const normalizedFinalReviewText = normalizeRecoveredJsonText(finalReviewResolution.text);
                let finalReview;
                try {
                    finalReview = batchAnalysisOrchestrator.parseFinalReviewResult({
                        workspaceId: input.workspaceId,
                        batchId: input.batchId,
                        iteration: orchestrationIteration,
                        planId: activeApprovedPlan.id,
                        workerReportId: latestWorkerReport.id,
                        resultText: normalizedFinalReviewText ?? finalReviewResolution.text,
                        agentModelId,
                        sessionId: finalReviewResult.sessionId
                    });
                    if (normalizedFinalReviewText && !finalReviewResolution.parseable) {
                        await logAnalysisProgress('Final review output salvaged locally.', {
                            stage: 'final_reviewing',
                            role: 'final-reviewer',
                            sessionId: finalReviewResult.sessionId
                        }, {
                            textLength: finalReviewResolution.text.length
                        });
                    }
                }
                catch (error) {
                    const fallbackSummary = finalReviewResult.status === 'ok'
                        ? 'Final review output was malformed and could not be parsed safely.'
                        : `Final review did not complete cleanly: ${finalReviewResult.message ?? 'No structured result returned.'}`;
                    finalReview = batchAnalysisOrchestrator.parseFinalReviewResult({
                        workspaceId: input.workspaceId,
                        batchId: input.batchId,
                        iteration: orchestrationIteration,
                        planId: activeApprovedPlan.id,
                        workerReportId: latestWorkerReport.id,
                        resultText: buildMalformedFinalReviewFallback(fallbackSummary),
                        agentModelId,
                        sessionId: finalReviewResult.sessionId
                    });
                    await logAnalysisProgress('Final review output was malformed; escalating safely.', {
                        stage: 'final_reviewing',
                        role: 'final-reviewer',
                        sessionId: finalReviewResult.sessionId
                    }, {
                        error: error instanceof Error ? error.message : String(error),
                        textLength: finalReviewResolution.text.length,
                        transitionReason: 'final_review_output_malformed',
                        triggerBranch: 'final review parse failed and malformed fallback was used',
                        resultTextPreview: buildStageEventTextPreview(finalReviewResolution.text)
                    });
                }
                await batchAnalysisOrchestrator.recordFinalReview(finalReview);
                await logAnalysisProgress('Final review recorded.', {
                    stage: 'final_reviewing',
                    role: 'final-reviewer',
                    sessionId: finalReview.sessionId
                }, {
                    verdict: finalReview.verdict,
                    finalReviewId: finalReview.id,
                    hasMissingArticleChanges: finalReview.hasMissingArticleChanges,
                    hasUnresolvedDiscoveredWork: finalReview.hasUnresolvedDiscoveredWork,
                    planExecutionComplete: finalReview.planExecutionComplete,
                    allPbisMapped: finalReview.allPbisMapped
                });
                return { finalReview, finalReviewResult };
            };
            const maxFinalReworkLoops = 2;
            let finalReviewOutcome = await runFinalReview();
            let reworkLoops = 0;
            while (finalReviewOutcome.finalReview.verdict === 'needs_rework' && reworkLoops < maxFinalReworkLoops) {
                reworkLoops += 1;
                liveIteration = await batchAnalysisOrchestrator.transitionIteration({
                    workspaceId: input.workspaceId,
                    iterationId: orchestrationIteration.id,
                    stage: 'reworking',
                    role: 'worker',
                    summary: 'Final review requested rework. Executing rework pass.',
                    agentModelId,
                    approvedPlanId: activeApprovedPlan.id
                });
                streamMetadata.stage = 'reworking';
                streamMetadata.role = 'worker';
                liveStageStartedAtUtc = liveIteration.updatedAtUtc;
                const reworkInstructions = [
                    'Apply the final-review rework requests below.',
                    JSON.stringify(finalReviewOutcome.finalReview.delta ?? {}, null, 2)
                ].join('\n\n');
                workerPass = await executeWorkerPass(activeApprovedPlan, reworkInstructions);
                const reworkRecord = await batchAnalysisOrchestrator.recordWorkerPass({
                    iteration: orchestrationIteration,
                    workspaceId: input.workspaceId,
                    batchId: input.batchId,
                    agentModelId,
                    approvedPlan: activeApprovedPlan,
                    summary: workerPass.workerSummary,
                    discoveredWork: workerPass.discoveredWork,
                    result: workerPass.result
                });
                latestWorkerReport = reworkRecord.workerReport;
                latestExecutionCounts = reworkRecord.executionCounts;
                liveExecutionCounts = latestExecutionCounts;
                liveOutstandingDiscoveredWorkCount = latestWorkerReport.discoveredWork.length;
                liveSessionId = workerPass.result.sessionId;
                finalReviewOutcome = await runFinalReview();
            }
            let completedIteration;
            const hardGateValidation = batchAnalysisOrchestrator.validateFinalApproval({
                plan: activeApprovedPlan,
                workerReport: latestWorkerReport,
                finalReview: finalReviewOutcome.finalReview
            });
            if (finalReviewOutcome.finalReview.verdict === 'approved' && workerPass.result.status === 'ok' && hardGateValidation.ok) {
                await logAnalysisProgress('Final review approved the batch for completion.', {
                    stage: 'approved',
                    role: 'final-reviewer',
                    sessionId: finalReviewOutcome.finalReview.sessionId
                }, {
                    transitionReason: 'final_review_approved',
                    triggerBranch: 'finalReview.verdict === approved && worker status ok && hard gates passed',
                    triggerArtifactType: 'final_review',
                    triggerArtifactId: finalReviewOutcome.finalReview.id,
                    triggerSessionId: finalReviewOutcome.finalReview.sessionId,
                    triggerVerdict: finalReviewOutcome.finalReview.verdict,
                    triggerSummary: finalReviewOutcome.finalReview.summary
                });
                const proposalIdsToPromote = Array.from(new Set(latestWorkerReport.executedItems
                    .filter((item) => item.status === 'executed')
                    .flatMap((item) => [
                    item.proposalId?.trim(),
                    ...(item.artifactIds ?? []).map((artifactId) => artifactId.trim())
                ])
                    .filter((proposalId) => Boolean(proposalId))));
                const promotionResult = await workspaceRepository.promoteBatchProposalsToPendingReview({
                    workspaceId: input.workspaceId,
                    batchId: input.batchId,
                    proposalIds: proposalIdsToPromote
                });
                await logAnalysisProgress('Final approval promoted the latest proposal set into Proposal Review.', {
                    stage: 'approved',
                    role: 'final-reviewer',
                    sessionId: finalReviewOutcome.finalReview.sessionId
                }, {
                    proposalCount: promotionResult.promotedProposalIds.length,
                    batchStatus: promotionResult.batchStatus,
                    promotedProposalIds: promotionResult.promotedProposalIds
                });
                completedIteration = await batchAnalysisOrchestrator.completeIteration({
                    workspaceId: input.workspaceId,
                    iterationId: orchestrationIteration.id,
                    stage: 'approved',
                    role: 'final-reviewer',
                    status: 'completed',
                    summary: finalReviewOutcome.finalReview.summary,
                    agentModelId,
                    sessionId: finalReviewOutcome.finalReviewResult.sessionId,
                    approvedPlanId: activeApprovedPlan.id,
                    lastReviewVerdict: finalReviewOutcome.finalReview.verdict,
                    outstandingDiscoveredWorkCount: latestWorkerReport.discoveredWork.length,
                    executionCounts: latestExecutionCounts,
                    endedAtUtc: workerPass.result.endedAtUtc
                });
                liveIteration = completedIteration;
                liveLastReviewVerdict = finalReviewOutcome.finalReview.verdict;
            }
            else if (finalReviewOutcome.finalReview.verdict === 'needs_human_review'
                || reworkLoops >= maxFinalReworkLoops
                || (finalReviewOutcome.finalReview.verdict === 'approved' && !hardGateValidation.ok)) {
                const escalationSummary = finalReviewOutcome.finalReview.verdict === 'approved' && !hardGateValidation.ok
                    ? `Hard approval gates failed: ${hardGateValidation.reasons.join(' ')}`
                    : finalReviewOutcome.finalReview.summary;
                await logAnalysisProgress('Final review requires human review before approval.', {
                    stage: 'needs_human_review',
                    role: 'final-reviewer',
                    sessionId: finalReviewOutcome.finalReview.sessionId
                }, {
                    transitionReason: finalReviewOutcome.finalReview.verdict === 'approved' && !hardGateValidation.ok
                        ? 'final_review_hard_gate_failed'
                        : finalReviewOutcome.finalReview.verdict === 'needs_human_review'
                            ? 'final_review_needs_human_review'
                            : 'final_review_rework_limit_exhausted',
                    triggerBranch: finalReviewOutcome.finalReview.verdict === 'approved' && !hardGateValidation.ok
                        ? 'finalReview.verdict === approved && hardGateValidation.ok === false'
                        : finalReviewOutcome.finalReview.verdict === 'needs_human_review'
                            ? 'finalReview.verdict === needs_human_review'
                            : 'reworkLoops >= maxFinalReworkLoops',
                    triggerArtifactType: 'final_review',
                    triggerArtifactId: finalReviewOutcome.finalReview.id,
                    triggerSessionId: finalReviewOutcome.finalReview.sessionId,
                    triggerVerdict: finalReviewOutcome.finalReview.verdict,
                    triggerSummary: escalationSummary,
                    hardGateReasons: hardGateValidation.ok ? [] : hardGateValidation.reasons
                });
                completedIteration = await batchAnalysisOrchestrator.completeIteration({
                    workspaceId: input.workspaceId,
                    iterationId: orchestrationIteration.id,
                    stage: 'needs_human_review',
                    role: 'final-reviewer',
                    status: 'needs_human_review',
                    summary: escalationSummary,
                    agentModelId,
                    sessionId: finalReviewOutcome.finalReviewResult.sessionId,
                    approvedPlanId: activeApprovedPlan.id,
                    lastReviewVerdict: finalReviewOutcome.finalReview.verdict,
                    outstandingDiscoveredWorkCount: latestWorkerReport.discoveredWork.length,
                    executionCounts: latestExecutionCounts,
                    endedAtUtc: workerPass.result.endedAtUtc
                });
                liveIteration = completedIteration;
                liveLastReviewVerdict = finalReviewOutcome.finalReview.verdict;
            }
            else {
                await logAnalysisProgress('Worker run ended without final approval.', {
                    stage: workerPass.result.status === 'canceled' ? 'canceled' : 'failed',
                    role: 'worker',
                    sessionId: workerPass.result.sessionId
                }, {
                    transitionReason: workerPass.result.status === 'canceled'
                        ? 'worker_canceled_before_final_approval'
                        : 'worker_failed_before_final_approval',
                    triggerBranch: 'worker result was not ok or final review did not approve',
                    triggerArtifactType: 'stage_run',
                    triggerSessionId: workerPass.result.sessionId,
                    triggerSummary: workerPass.result.message ?? 'Worker failed before final approval.'
                });
                completedIteration = await batchAnalysisOrchestrator.completeIteration({
                    workspaceId: input.workspaceId,
                    iterationId: orchestrationIteration.id,
                    stage: workerPass.result.status === 'canceled' ? 'canceled' : 'failed',
                    role: 'worker',
                    status: workerPass.result.status === 'canceled' ? 'canceled' : 'failed',
                    summary: workerPass.result.message ?? 'Worker failed before final approval.',
                    agentModelId,
                    sessionId: workerPass.result.sessionId,
                    approvedPlanId: activeApprovedPlan.id,
                    outstandingDiscoveredWorkCount: latestWorkerReport.discoveredWork.length,
                    executionCounts: latestExecutionCounts,
                    endedAtUtc: workerPass.result.endedAtUtc
                });
                liveIteration = completedIteration;
            }
            streamMetadata.iterationId = completedIteration.id;
            streamMetadata.stage = completedIteration.stage;
            streamMetadata.role = completedIteration.role;
            emit({
                id: payload.jobId,
                command: payload.command,
                state: completedIteration.status === 'failed'
                    ? shared_types_2.JobState.FAILED
                    : completedIteration.status === 'canceled'
                        ? shared_types_2.JobState.CANCELED
                        : completedIteration.status === 'needs_human_review'
                            ? shared_types_2.JobState.FAILED
                            : shared_types_2.JobState.SUCCEEDED,
                progress: 100,
                message: completedIteration.status === 'needs_human_review'
                    ? (hardGateValidation.ok ? 'Batch analysis requires human review before approval.' : `Batch approval blocked by hard correctness gates. ${hardGateValidation.reasons.join(' ')}`)
                    : finalReviewOutcome.finalReview.summary ?? workerPass.result.message ?? 'analysis command complete',
                metadata: buildStreamMetadata({
                    stage: completedIteration.stage,
                    role: completedIteration.role,
                    status: workerPass.result.status,
                    sessionId: workerPass.result.sessionId,
                    stageEndedAtUtc: completedIteration.endedAtUtc
                })
            });
        }
        catch (error) {
            const failureMessage = error instanceof Error ? error.message : String(error);
            const explicitTerminalError = error instanceof BatchAnalysisTerminalError ? error : null;
            const terminalStage = explicitTerminalError?.terminalStage
                ?? (liveIteration.stage === 'planning' || liveIteration.stage === 'plan_revision' || liveIteration.stage === 'plan_reviewing'
                    ? 'needs_human_review'
                    : liveIteration.stage === 'approved'
                        ? 'failed'
                        : liveIteration.stage);
            const terminalStatus = explicitTerminalError?.terminalStatus
                ?? (terminalStage === 'needs_human_review' ? 'needs_human_review' : 'failed');
            logger_1.logger.error('[agent.analysis.run] orchestration failed', {
                jobId: payload.jobId,
                workspaceId: input.workspaceId,
                batchId: input.batchId,
                iterationId: liveIteration.id,
                stage: liveIteration.stage,
                role: liveIteration.role,
                sessionId: liveSessionId,
                failureMessage
            });
            await logAnalysisProgress('Batch analysis orchestration failed.', {
                stage: terminalStage,
                role: liveIteration.role,
                sessionId: liveSessionId
            }, {
                transitionReason: 'orchestration_exception',
                triggerBranch: 'top-level orchestration catch block',
                triggerSummary: failureMessage,
                error: failureMessage
            });
            await workspaceRepository.updateBatchAnalysisIteration({
                workspaceId: input.workspaceId,
                iterationId: orchestrationIteration.id,
                stage: terminalStage,
                role: liveIteration.role,
                status: terminalStatus,
                summary: failureMessage,
                agentModelId,
                sessionId: liveSessionId
            });
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.FAILED,
                progress: 100,
                message: failureMessage,
                metadata: buildStreamMetadata({
                    stage: terminalStage,
                    role: liveIteration.role,
                    status: 'error',
                    sessionId: liveSessionId
                })
            });
        }
    });
    jobs.registerRunner('agent.article_edit.run', async (payload, emit, isCancelled) => {
        const input = payload.input;
        if (!input?.workspaceId || !input.localeVariantId) {
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.FAILED,
                progress: 100,
                message: 'agent.article_edit.run requires workspaceId and localeVariantId'
            });
            return;
        }
        if (isCancelled()) {
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.CANCELED,
                progress: 100,
                message: 'article edit canceled'
            });
            return;
        }
        let kbAccessMode;
        try {
            const kbAccessSelection = await requireHealthyKbAccessMode(input.workspaceId, input.kbAccessMode);
            kbAccessMode = kbAccessSelection.selectedMode;
        }
        catch (error) {
            const selectedMode = error instanceof kb_access_mode_resolver_1.KbAccessModePreflightError
                ? error.selection.selectedMode
                : (0, kb_access_mode_resolver_1.selectKbAccessMode)(input.kbAccessMode, await resolveWorkspaceKbAccessMode(input.workspaceId));
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.FAILED,
                progress: 100,
                message: error instanceof Error ? error.message : String(error),
                metadata: {
                    requestedKbAccessMode: selectedMode,
                    kbAccessMode: selectedMode
                }
            });
            return;
        }
        emit({
            id: payload.jobId,
            command: payload.command,
            state: shared_types_2.JobState.RUNNING,
            progress: 20,
            message: `Starting article edit session for variant ${input.localeVariantId}`,
            metadata: {
                requestedKbAccessMode: kbAccessMode,
                kbAccessMode
            }
        });
        const result = await agentRuntime.runArticleEdit({ ...input, kbAccessMode }, (stream) => {
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.RUNNING,
                progress: stream.kind === 'result' ? 100 : 45,
                message: JSON.stringify(stream),
                metadata: {
                    requestedKbAccessMode: kbAccessMode,
                    kbAccessMode
                }
            });
        }, isCancelled);
        emit({
            id: payload.jobId,
            command: payload.command,
            state: result.status === 'error'
                ? shared_types_2.JobState.FAILED
                : result.status === 'canceled'
                    ? shared_types_2.JobState.CANCELED
                    : shared_types_2.JobState.SUCCEEDED,
            progress: 100,
            message: result.message ?? 'article edit command complete',
            metadata: {
                requestedKbAccessMode: kbAccessMode,
                kbAccessMode
            }
        });
    });
    jobs.registerRunner('article.relations.refresh', async (payload, emit, isCancelled) => {
        const input = payload.input;
        if (!input?.workspaceId) {
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.FAILED,
                progress: 100,
                message: 'article.relations.refresh requires workspaceId'
            });
            return;
        }
        if (isCancelled()) {
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.CANCELED,
                progress: 100,
                message: 'relation refresh canceled'
            });
            return;
        }
        emit({
            id: payload.jobId,
            command: payload.command,
            state: shared_types_2.JobState.RUNNING,
            progress: 20,
            message: 'Building article relation graph'
        });
        try {
            const result = await workspaceRepository.refreshArticleRelations(input.workspaceId, {
                limitPerArticle: input.limitPerArticle,
                source: 'manual_refresh',
                triggeredBy: 'user'
            });
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.SUCCEEDED,
                progress: 100,
                message: JSON.stringify(result.summary ?? {}),
                metadata: {
                    runId: result.id,
                    totalArticles: result.summary?.totalArticles ?? 0,
                    candidatePairs: result.summary?.candidatePairs ?? 0,
                    inferredRelations: result.summary?.inferredRelations ?? 0
                }
            });
        }
        catch (error) {
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.FAILED,
                progress: 100,
                message: error instanceof Error ? error.message : String(error)
            });
        }
    });
    bus.register('zendesk.credentials.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.credentials.get requires workspaceId');
            }
            const credentials = await workspaceRepository.getZendeskCredentials(workspaceId);
            return {
                ok: true,
                data: credentials
            };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('zendesk.credentials.save', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.credentials.save requires workspaceId');
            }
            if (!input.email?.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.credentials.save requires email');
            }
            if (!input.apiToken?.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.credentials.save requires apiToken');
            }
            const saved = await workspaceRepository.saveZendeskCredentials(input.workspaceId, input.email, input.apiToken);
            return { ok: true, data: saved };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'Encrypted credential storage is unavailable') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_AUTHORIZED, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('zendesk.connection.test', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.connection.test requires workspaceId');
            }
            const client = await buildZendeskClient(workspaceId);
            const result = await client.testConnection();
            return { ok: true, data: { ...result, workspaceId, checkedAtUtc: new Date().toISOString() } };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'Encrypted credential storage is unavailable') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_AUTHORIZED, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('zendesk.categories.list', async (payload) => {
        try {
            const { workspaceId, locale } = payload;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.categories.list requires workspaceId');
            }
            if (!locale?.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.categories.list requires locale');
            }
            const client = await buildZendeskClient(workspaceId);
            const categories = await client.listCategories(locale.trim());
            return { ok: true, data: categories };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'Zendesk credentials are not configured for this workspace') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'Encrypted credential storage is unavailable') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_AUTHORIZED, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('zendesk.sections.list', async (payload) => {
        try {
            const { workspaceId, locale, categoryId } = payload;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.sections.list requires workspaceId');
            }
            if (!locale?.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.sections.list requires locale');
            }
            if (!Number.isInteger(categoryId) || categoryId < 0) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.sections.list requires categoryId');
            }
            const client = await buildZendeskClient(workspaceId);
            const sections = await client.listSections(categoryId, locale.trim());
            return { ok: true, data: sections };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'Zendesk credentials are not configured for this workspace') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'Encrypted credential storage is unavailable') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_AUTHORIZED, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('zendesk.articles.search', async (payload) => {
        try {
            const { workspaceId, locale, query } = payload;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.articles.search requires workspaceId');
            }
            if (!locale?.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.articles.search requires locale');
            }
            if (!query?.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.articles.search requires query');
            }
            const client = await buildZendeskClient(workspaceId);
            const articles = await client.searchArticles(locale.trim(), query.trim());
            return { ok: true, data: articles };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'Zendesk credentials are not configured for this workspace') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'Encrypted credential storage is unavailable') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_AUTHORIZED, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('zendesk.sync.getLatest', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.sync.getLatest requires workspaceId');
            }
            const latest = await workspaceRepository.getLatestSyncRun(workspaceId);
            return {
                ok: true,
                data: latest ?? null
            };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('zendesk.sync.getLatestSuccessful', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.sync.getLatestSuccessful requires workspaceId');
            }
            const latest = await workspaceRepository.getLatestSuccessfulSyncRun(workspaceId);
            return {
                ok: true,
                data: latest ?? null
            };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    jobs.registerRunner('zendesk.sync.run', async (payload, emit) => {
        const input = payload.input;
        if (!input?.workspaceId || !input.mode) {
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.FAILED,
                progress: 100,
                message: 'zendesk.sync.run requires workspaceId and mode'
            });
            return;
        }
        if (input.mode !== 'full' && input.mode !== 'incremental') {
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.FAILED,
                progress: 100,
                message: 'sync mode must be full or incremental'
            });
            return;
        }
        const syncInput = input;
        await zendeskSyncService.runSync({
            workspaceId: syncInput.workspaceId,
            mode: syncInput.mode,
            locale: syncInput.locale ? String(syncInput.locale).trim() : undefined,
            maxRetries: syncInput.maxRetries,
            retryDelayMs: syncInput.retryDelayMs,
            retryMaxDelayMs: syncInput.retryMaxDelayMs
        }, emit, payload.command, payload.jobId);
    });
    bus.register('system.migrations.health', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const health = await workspaceRepository.getMigrationHealth(workspaceId);
            return {
                ok: true,
                data: health
            };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    return {
        agentRuntime,
        kbCliLoopback,
        kbCliRuntime,
        batchAnalysisOrchestrator
    };
}
