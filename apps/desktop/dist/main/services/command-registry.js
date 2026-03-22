"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCoreCommands = registerCoreCommands;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const shared_types_1 = require("@kb-vault/shared-types");
const zendesk_client_1 = require("@kb-vault/zendesk-client");
const agent_runtime_1 = require("@kb-vault/agent-runtime");
const shared_types_2 = require("@kb-vault/shared-types");
const workspace_repository_1 = require("./workspace-repository");
const zendesk_sync_service_1 = require("./zendesk-sync-service");
const pbi_batch_import_service_1 = require("./pbi-batch-import-service");
const logger_1 = require("./logger");
const RUNTIME_MODEL_CATALOG = [
    {
        id: 'Anthropic - Claude 4 Sonnet',
        provider: 'Anthropic',
        name: 'Claude 4 Sonnet',
        costs: {
            inputUsdPerMillion: 3,
            cacheWriteUsdPerMillion: 3.75,
            cacheReadUsdPerMillion: 0.3,
            outputUsdPerMillion: 15
        }
    },
    {
        id: 'Anthropic - Claude 4 Sonnet 1M',
        provider: 'Anthropic',
        name: 'Claude 4 Sonnet 1M',
        costs: {
            inputUsdPerMillion: 6,
            cacheWriteUsdPerMillion: 7.5,
            cacheReadUsdPerMillion: 0.6,
            outputUsdPerMillion: 22.5
        }
    },
    {
        id: 'Anthropic - Claude 4.5 Haiku',
        provider: 'Anthropic',
        name: 'Claude 4.5 Haiku',
        costs: {
            inputUsdPerMillion: 1,
            cacheWriteUsdPerMillion: 1.25,
            cacheReadUsdPerMillion: 0.1,
            outputUsdPerMillion: 5
        }
    },
    {
        id: 'Anthropic - Claude 4.5 Opus',
        provider: 'Anthropic',
        name: 'Claude 4.5 Opus',
        costs: {
            inputUsdPerMillion: 5,
            cacheWriteUsdPerMillion: 6.25,
            cacheReadUsdPerMillion: 0.5,
            outputUsdPerMillion: 25
        }
    },
    {
        id: 'Anthropic - Claude 4.5 Sonnet',
        provider: 'Anthropic',
        name: 'Claude 4.5 Sonnet',
        costs: {
            inputUsdPerMillion: 3,
            cacheWriteUsdPerMillion: 3.75,
            cacheReadUsdPerMillion: 0.3,
            outputUsdPerMillion: 15
        }
    },
    {
        id: 'Anthropic - Claude 4.6 Opus',
        provider: 'Anthropic',
        name: 'Claude 4.6 Opus',
        costs: {
            inputUsdPerMillion: 5,
            cacheWriteUsdPerMillion: 6.25,
            cacheReadUsdPerMillion: 0.5,
            outputUsdPerMillion: 25
        }
    },
    {
        id: 'Anthropic - Claude 4.6 Opus (Fast mode)',
        provider: 'Anthropic',
        name: 'Claude 4.6 Opus (Fast mode)',
        costs: {
            inputUsdPerMillion: 30,
            cacheWriteUsdPerMillion: 37.5,
            cacheReadUsdPerMillion: 3,
            outputUsdPerMillion: 150
        }
    },
    {
        id: 'Anthropic - Claude 4.6 Sonnet',
        provider: 'Anthropic',
        name: 'Claude 4.6 Sonnet',
        costs: {
            inputUsdPerMillion: 3,
            cacheWriteUsdPerMillion: 3.75,
            cacheReadUsdPerMillion: 0.3,
            outputUsdPerMillion: 15
        }
    },
    {
        id: 'Cursor - Composer 1',
        provider: 'Cursor',
        name: 'Composer 1',
        costs: {
            inputUsdPerMillion: 1.25,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.125,
            outputUsdPerMillion: 10
        }
    },
    {
        id: 'Cursor - Composer 1.5',
        provider: 'Cursor',
        name: 'Composer 1.5',
        costs: {
            inputUsdPerMillion: 3.5,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.35,
            outputUsdPerMillion: 17.5
        }
    },
    {
        id: 'Cursor - Composer 2',
        provider: 'Cursor',
        name: 'Composer 2',
        costs: {
            inputUsdPerMillion: 0.5,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.2,
            outputUsdPerMillion: 2.5
        }
    },
    {
        id: 'Google - Gemini 2.5 Flash',
        provider: 'Google',
        name: 'Gemini 2.5 Flash',
        costs: {
            inputUsdPerMillion: 0.3,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.03,
            outputUsdPerMillion: 2.5
        }
    },
    {
        id: 'Google - Gemini 3 Flash',
        provider: 'Google',
        name: 'Gemini 3 Flash',
        costs: {
            inputUsdPerMillion: 0.5,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.05,
            outputUsdPerMillion: 3
        }
    },
    {
        id: 'Google - Gemini 3 Pro',
        provider: 'Google',
        name: 'Gemini 3 Pro',
        costs: {
            inputUsdPerMillion: 2,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.2,
            outputUsdPerMillion: 12
        }
    },
    {
        id: 'Google - Gemini 3 Pro Image Preview',
        provider: 'Google',
        name: 'Gemini 3 Pro Image Preview',
        costs: {
            inputUsdPerMillion: 2,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.2,
            outputUsdPerMillion: 12
        }
    },
    {
        id: 'Google - Gemini 3.1 Pro',
        provider: 'Google',
        name: 'Gemini 3.1 Pro',
        costs: {
            inputUsdPerMillion: 2,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.2,
            outputUsdPerMillion: 12
        }
    },
    {
        id: 'OpenAI - GPT-5',
        provider: 'OpenAI',
        name: 'GPT-5',
        costs: {
            inputUsdPerMillion: 1.25,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.125,
            outputUsdPerMillion: 10
        }
    },
    {
        id: 'OpenAI - GPT-5 Fast',
        provider: 'OpenAI',
        name: 'GPT-5 Fast',
        costs: {
            inputUsdPerMillion: 2.5,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.25,
            outputUsdPerMillion: 20
        }
    },
    {
        id: 'OpenAI - GPT-5 Mini',
        provider: 'OpenAI',
        name: 'GPT-5 Mini',
        costs: {
            inputUsdPerMillion: 0.25,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.025,
            outputUsdPerMillion: 2
        }
    },
    {
        id: 'OpenAI - GPT-5-Codex',
        provider: 'OpenAI',
        name: 'GPT-5-Codex',
        costs: {
            inputUsdPerMillion: 1.25,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.125,
            outputUsdPerMillion: 10
        }
    },
    {
        id: 'OpenAI - GPT-5.1 Codex',
        provider: 'OpenAI',
        name: 'GPT-5.1 Codex',
        costs: {
            inputUsdPerMillion: 1.25,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.125,
            outputUsdPerMillion: 10
        }
    },
    {
        id: 'OpenAI - GPT-5.1 Codex Max',
        provider: 'OpenAI',
        name: 'GPT-5.1 Codex Max',
        costs: {
            inputUsdPerMillion: 1.25,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.125,
            outputUsdPerMillion: 10
        }
    },
    {
        id: 'OpenAI - GPT-5.1 Codex Mini',
        provider: 'OpenAI',
        name: 'GPT-5.1 Codex Mini',
        costs: {
            inputUsdPerMillion: 0.25,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.025,
            outputUsdPerMillion: 2
        }
    },
    {
        id: 'OpenAI - GPT-5.2',
        provider: 'OpenAI',
        name: 'GPT-5.2',
        costs: {
            inputUsdPerMillion: 1.75,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.175,
            outputUsdPerMillion: 14
        }
    },
    {
        id: 'OpenAI - GPT-5.2 Codex',
        provider: 'OpenAI',
        name: 'GPT-5.2 Codex',
        costs: {
            inputUsdPerMillion: 1.75,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.175,
            outputUsdPerMillion: 14
        }
    },
    {
        id: 'OpenAI - GPT-5.3 Codex',
        provider: 'OpenAI',
        name: 'GPT-5.3 Codex',
        costs: {
            inputUsdPerMillion: 1.75,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.175,
            outputUsdPerMillion: 14
        }
    },
    {
        id: 'OpenAI - GPT-5.4',
        provider: 'OpenAI',
        name: 'GPT-5.4',
        costs: {
            inputUsdPerMillion: 2.5,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.25,
            outputUsdPerMillion: 15
        }
    },
    {
        id: 'OpenAI - GPT-5.4 Mini',
        provider: 'OpenAI',
        name: 'GPT-5.4 Mini',
        costs: {
            inputUsdPerMillion: 0.75,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.075,
            outputUsdPerMillion: 4.5
        }
    },
    {
        id: 'OpenAI - GPT-5.4 Nano',
        provider: 'OpenAI',
        name: 'GPT-5.4 Nano',
        costs: {
            inputUsdPerMillion: 0.2,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.02,
            outputUsdPerMillion: 1.25
        }
    },
    {
        id: 'xAI - Grok 4.20',
        provider: 'xAI',
        name: 'Grok 4.20',
        costs: {
            inputUsdPerMillion: 2,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.2,
            outputUsdPerMillion: 6
        }
    },
    {
        id: 'Moonshot - Kimi K2.5',
        provider: 'Moonshot',
        name: 'Kimi K2.5',
        costs: {
            inputUsdPerMillion: 0.6,
            cacheWriteUsdPerMillion: null,
            cacheReadUsdPerMillion: 0.1,
            outputUsdPerMillion: 3
        }
    }
];
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
function registerCoreCommands(bus, jobs, workspaceRoot) {
    const workspaceRepository = new workspace_repository_1.WorkspaceRepository(workspaceRoot);
    const zendeskSyncService = new zendesk_sync_service_1.ZendeskSyncService(workspaceRepository);
    const pbiBatchImportService = new pbi_batch_import_service_1.PBIBatchImportService(workspaceRepository);
    const validRevisionStates = new Set(Object.values(shared_types_1.RevisionState));
    const validRevisionStatuses = new Set(Object.values(shared_types_1.RevisionStatus));
    const validPBIScopeModes = new Set([shared_types_1.PBIBatchScopeMode.ALL, shared_types_1.PBIBatchScopeMode.SELECTED_ONLY]);
    const validPBIBatchStatuses = new Set(Object.values(shared_types_1.PBIBatchStatus));
    const validPBIValidationStatuses = new Set(Object.values(shared_types_1.PBIValidationStatus));
    const runtimeToolContext = {
        searchKb: async (input) => {
            return workspaceRepository.searchArticles(input.workspaceId, {
                workspaceId: input.workspaceId,
                query: input.query,
                scope: 'all',
                includeArchived: true
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
            return workspaceRepository.getLocaleVariant(input.workspaceId, input.familyId);
        },
        findRelatedArticles: async (input) => {
            const result = await workspaceRepository.searchArticles(input.workspaceId, {
                workspaceId: input.workspaceId,
                query: input.query,
                scope: 'all',
                includeArchived: true,
                changedWithinHours: input.max ?? undefined
            });
            return result;
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
        recordAgentNotes: async (input) => ({
            ok: true,
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            recorded: true,
            note: input.note
        }),
        proposeCreateKb: async (input, context) => {
            if (!context.workspaceId) {
                throw new Error('workspaceId is required');
            }
            const batchId = input.batchId || context.batchId || '';
            const sessionId = input.sessionId || context.sessionId || '';
            if (!batchId) {
                throw new Error('batchId is required for create proposal');
            }
            const created = await workspaceRepository.createAgentProposal({
                workspaceId: context.workspaceId,
                batchId,
                action: shared_types_1.ProposalAction.CREATE,
                _sessionId: sessionId,
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
            const created = await workspaceRepository.createAgentProposal({
                workspaceId: context.workspaceId,
                batchId,
                action: shared_types_1.ProposalAction.EDIT,
                _sessionId: sessionId,
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
            const created = await workspaceRepository.createAgentProposal({
                workspaceId: context.workspaceId,
                batchId,
                action: shared_types_1.ProposalAction.RETIRE,
                _sessionId: sessionId,
                localeVariantId: input.localeVariantId,
                note: input.note,
                rationale: input.rationale,
                relatedPbiIds: input.pbiIds,
                metadata: input.metadata
            });
            return { ok: true, ...created };
        }
    };
    const validThinkingModes = new Set(['inherit', 'on', 'off']);
    const validReasoningModes = new Set(['inherit', 'low', 'medium', 'high']);
    const buildRuntimeConfigFromSettings = (settings) => ({
        agentModelId: settings.agentModelId?.trim() || undefined,
        agentReasoning: settings.agentReasoning === 'inherit' ? undefined : settings.agentReasoning,
        agentThinking: settings.agentThinking === 'inherit' ? undefined : settings.agentThinking
    });
    const agentRuntime = new agent_runtime_1.CursorAcpRuntime(workspaceRoot, runtimeToolContext, (message, details) => {
        logger_1.logger.info(`[agent-runtime] ${message}`, details);
    });
    const agentRuntimeApi = agentRuntime;
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
    bus.register('agent.health.check', async () => {
        const health = await agentRuntime.checkHealth('system');
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
            const session = agentRuntime.createSession(input);
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
                input.agentRuntimeMode === undefined &&
                input.agentModelId === undefined &&
                input.agentReasoning === undefined &&
                input.agentThinking === undefined) {
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
            if (input.agentRuntimeMode !== undefined &&
                input.agentRuntimeMode !== 'mcp_only' &&
                input.agentRuntimeMode !== 'app_runtime') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'agentRuntimeMode must be mcp_only or app_runtime');
            }
            if (input.agentReasoning !== undefined &&
                !validReasoningModes.has(input.agentReasoning)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'agentReasoning must be inherit, low, medium, or high');
            }
            if (input.agentThinking !== undefined &&
                !validThinkingModes.has(input.agentThinking)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'agentThinking must be inherit, on, or off');
            }
            if (typeof input.agentModelId === 'string' && !input.agentModelId.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'agentModelId cannot be empty');
            }
            const updated = await workspaceRepository.updateWorkspaceSettings(input);
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
            const options = await agentRuntime.getRuntimeOptions(workspaceId);
            return {
                ok: true,
                data: {
                    ...options,
                    workspaceId,
                    modelCatalog: RUNTIME_MODEL_CATALOG
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
            if (!input?.workspaceId || !input.query) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.search requires workspaceId and query');
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
        emit({
            id: payload.jobId,
            command: payload.command,
            state: shared_types_2.JobState.RUNNING,
            progress: 15,
            message: `Starting analysis session for batch ${input.batchId}`
        });
        logger_1.logger.info('[agent.analysis.run] starting runtime', {
            jobId: payload.jobId,
            batchId: input.batchId,
            workspaceId: input.workspaceId
        });
        const workspaceSettings = await workspaceRepository.getWorkspaceSettings(input.workspaceId);
        const runtimeMode = workspaceSettings.agentRuntimeMode ?? 'mcp_only';
        const runtimeConfig = buildRuntimeConfigFromSettings(workspaceSettings);
        const result = await agentRuntime.runBatchAnalysis(input, (stream) => {
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.RUNNING,
                progress: stream.kind === 'result' ? 100 : 35,
                message: JSON.stringify(stream)
            });
        }, isCancelled, runtimeMode, runtimeConfig);
        logger_1.logger.info('[agent.analysis.run] runtime finished', {
            jobId: payload.jobId,
            batchId: input.batchId,
            runtimeMode,
            status: result.status,
            toolCalls: result.toolCalls.length,
            transcriptPath: result.transcriptPath
        });
        emit({
            id: payload.jobId,
            command: payload.command,
            state: result.status === 'error'
                ? shared_types_2.JobState.FAILED
                : result.status === 'canceled'
                    ? shared_types_2.JobState.CANCELED
                    : shared_types_2.JobState.SUCCEEDED,
            progress: 100,
            message: result.message ?? 'analysis command complete'
        });
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
        emit({
            id: payload.jobId,
            command: payload.command,
            state: shared_types_2.JobState.RUNNING,
            progress: 20,
            message: `Starting article edit session for variant ${input.localeVariantId}`
        });
        const workspaceSettings = await workspaceRepository.getWorkspaceSettings(input.workspaceId);
        const runtimeMode = workspaceSettings.agentRuntimeMode ?? 'mcp_only';
        const runtimeConfig = buildRuntimeConfigFromSettings(workspaceSettings);
        const result = await agentRuntime.runArticleEdit(input, (stream) => {
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.RUNNING,
                progress: stream.kind === 'result' ? 100 : 45,
                message: JSON.stringify(stream)
            });
        }, isCancelled, runtimeMode, runtimeConfig);
        emit({
            id: payload.jobId,
            command: payload.command,
            state: result.status === 'error'
                ? shared_types_2.JobState.FAILED
                : result.status === 'canceled'
                    ? shared_types_2.JobState.CANCELED
                    : shared_types_2.JobState.SUCCEEDED,
            progress: 100,
            message: result.message ?? 'article edit command complete'
        });
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
        agentRuntime
    };
}
