import path from 'node:path';
import fs from 'node:fs/promises';
import {
  AppErrorCode,
  createErrorResult,
  AppRoute,
  type JobRunContext,
  type SearchPayload,
  type ZendeskCredentialsInput,
  type WorkspaceCreateRequest,
  type WorkspaceSettingsUpdateRequest,
  type ArticleFamilyCreateRequest,
  type ArticleFamilyUpdateRequest,
  type LocaleVariantCreateRequest,
  type LocaleVariantUpdateRequest,
  type RevisionCreateRequest,
  type RevisionUpdateRequest,
  RevisionState,
  RevisionStatus,
  ProposalAction,
  PBIBatchScopeMode,
  PBIBatchStatus,
  PBIValidationStatus,
  type PBIBatchImportRequest,
  type PBIBatchRowsRequest,
  type PBIBatchStatusUpdateRequest,
  type PBIBatchDeleteRequest,
  type ZendeskCategoryRecord,
  type ZendeskSectionRecord,
  type ZendeskSearchArticleRecord,
  type ZendeskCategoriesListRequest,
  type ZendeskSectionsListRequest,
  type ZendeskSearchArticlesRequest,
  type ArticleDetailRequest,
  type ArticleRelationDeleteRequest,
  type ArticleRelationRefreshRequest,
  type ArticleRelationsListRequest,
  type ArticleRelationUpsertRequest,
  type WorkspaceDefaultRequest,
  type ZendeskSyncRunRequest,
  type AgentAnalysisRunRequest,
  type AgentArticleEditRunRequest,
  type AgentSessionCreateRequest,
  type AgentSessionListRequest,
  type AgentSessionGetRequest,
  type AgentSessionCloseRequest,
  type AgentSessionListResponse,
  type AgentTranscriptRequest,
  type AgentTranscriptLine,
  type KbAccessMode,
  type PersistedAgentAnalysisRunResponse,
  type MCPGetArticleFamilyInput,
  type MCPGetArticleInput,
  type MCPGetArticleHistoryInput,
  type MCPGetBatchContextInput,
  type MCPGetLocaleVariantInput,
  type MCPGetPBISubsetInput,
  type MCPGetPBIInput,
  type MCPListArticleTemplatesInput,
  type MCPListCategoriesInput,
  type MCPListSectionsInput,
  type MCPRecordAgentNotesInput,
  type MCPFindRelatedArticlesInput,
  type AgentStreamingPayload,
  type ProposalIngestRequest,
  type ProposalReviewDecisionRequest,
  type ProposalReviewBatchListRequest,
  ProposalReviewDecision,
  type ProposalReviewGetRequest,
  type ProposalReviewListRequest,
  DraftBranchStatus,
  type DraftBranchCreateRequest,
  type DraftBranchDiscardRequest,
  type DraftBranchGetRequest,
  type DraftBranchHistoryStepRequest,
  type DraftBranchListRequest,
  type DraftBranchSaveRequest,
  type DraftBranchStatusUpdateRequest,
  ArticleAiPresetAction,
  type ArticleAiDecisionRequest,
  type ArticleAiResetRequest,
  type ArticleAiSessionGetRequest,
  type ArticleAiSubmitRequest,
  type TemplatePackAnalysisRequest,
  type TemplatePackDeleteRequest,
  type TemplatePackGetRequest,
  type TemplatePackListRequest,
  type TemplatePackUpsertRequest
} from '@kb-vault/shared-types';
import { ZendeskClient } from '@kb-vault/zendesk-client';
import { CursorAcpRuntime, type AgentRuntimeToolContext } from '@kb-vault/agent-runtime';
import { CommandBus } from './command-bus';
import { JobRegistry } from './job-runner';
import { JobState } from '@kb-vault/shared-types';
import { WorkspaceRepository } from './workspace-repository';
import { ZendeskSyncService, type ZendeskSyncServiceInput } from './zendesk-sync-service';
import { PBIBatchImportService } from './pbi-batch-import-service';
import { logger } from './logger';
import { KbCliLoopbackService } from './kb-cli-loopback-service';
import { KbCliRuntimeService } from './kb-cli-runtime-service';

const ZENDESK_PREVIEW_STYLE_TOKENS: Record<string, string> = {
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

const sanitizeZendeskStyles = (cssText: string): string => {
  const withFunctionsStripped = cssText
    .replace(/(?:darken|lighten)\(\s*([^)]+?),\s*[0-9.]+%?\s*\)/g, '$1');

  return withFunctionsStripped.replace(/\$([a-zA-Z0-9_-]+)/g, 'var(--kbv-zendesk-preview-$1)');
};

const buildFallbackZendeskVariableCss = (): string => {
  const vars = Object.entries(ZENDESK_PREVIEW_STYLE_TOKENS)
    .map(([token, value]) => `  --kbv-zendesk-preview-${token}: ${value};`)
    .join('\n');
  return `:root {\n${vars}\n}\n`;
};

const resolveArticlePreviewStylePath = async (override?: string): Promise<string | null> => {
  const explicit = override?.trim();
  const envPath = (process.env.KB_VAULT_ARTICLE_PREVIEW_STYLE_PATH ?? process.env.KB_VAULT_ZENDESK_STYLE_PATH ?? '').trim();
  const candidates = [
    explicit,
    envPath,
    path.resolve(process.cwd(), 'style1.css'),
    path.resolve(process.cwd(), '..', 'style1.css')
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const absoluteCandidate = path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
    try {
      await fs.access(absoluteCandidate);
      return absoluteCandidate;
    } catch {
      // try next location
    }
  }

  return null;
};

const readTranscriptLines = async (transcriptPath?: string, limit?: number): Promise<AgentTranscriptLine[]> => {
  if (!transcriptPath) {
    return [];
  }

  try {
    const text = await fs.readFile(transcriptPath, 'utf8');
    const parsed = text
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
      });

    return typeof limit === 'number' && limit > 0 ? parsed.slice(-limit) : parsed;
  } catch {
    return [];
  }
};

const ARTICLE_AI_PRESET_PROMPTS: Record<ArticleAiPresetAction, string> = {
  [ArticleAiPresetAction.REWRITE_TONE]: 'Rewrite the article for clearer tone and readability while preserving factual meaning.',
  [ArticleAiPresetAction.SHORTEN]: 'Shorten the article by removing repetition and tightening wording without losing key steps.',
  [ArticleAiPresetAction.EXPAND]: 'Expand the article with missing context, examples, and step detail where it will help users succeed.',
  [ArticleAiPresetAction.RESTRUCTURE]: 'Restructure the article into a clearer section flow and improve heading hierarchy.',
  [ArticleAiPresetAction.CONVERT_TO_TROUBLESHOOTING]: 'Convert the article into a troubleshooting format with symptoms, causes, and resolutions.',
  [ArticleAiPresetAction.ALIGN_TO_TEMPLATE]: 'Align the article to the selected template pack while keeping accurate product content.',
  [ArticleAiPresetAction.UPDATE_LOCALE]: 'Adapt the article for the requested target locale while keeping terminology and structure consistent.',
  [ArticleAiPresetAction.INSERT_IMAGE_PLACEHOLDERS]: 'Insert helpful image placeholders where screenshots would improve comprehension.',
  [ArticleAiPresetAction.FREEFORM]: 'Apply the user request directly.'
};

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const directCandidates = [
    trimmed,
    trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '')
  ];
  for (const candidate of directCandidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next candidate
    }
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function parseArticleAiResult(resultPayload: unknown): { updatedHtml: string; summary: string; rationale?: string } | null {
  const candidates: string[] = [];
  if (typeof resultPayload === 'string') {
    candidates.push(resultPayload);
  } else if (resultPayload && typeof resultPayload === 'object') {
    candidates.push(JSON.stringify(resultPayload));
    const payload = resultPayload as Record<string, unknown>;
    if (typeof payload.text === 'string') {
      candidates.push(payload.text);
    }
    if (Array.isArray(payload.content)) {
      for (const part of payload.content) {
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          candidates.push((part as { text: string }).text);
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

function buildArticleAiPrompt(params: {
  session: Awaited<ReturnType<WorkspaceRepository['getOrCreateArticleAiSession']>>;
  request: ArticleAiSubmitRequest;
  currentHtml: string;
  templatePrompt?: string;
}): string {
  const transcript = params.session.messages
    .slice(-8)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n');
  const presetInstruction = ARTICLE_AI_PRESET_PROMPTS[params.request.presetAction ?? ArticleAiPresetAction.FREEFORM];
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

export function registerCoreCommands(bus: CommandBus, jobs: JobRegistry, workspaceRoot: string) {
  const workspaceRepository = new WorkspaceRepository(workspaceRoot);
  const zendeskSyncService = new ZendeskSyncService(workspaceRepository);
  const pbiBatchImportService = new PBIBatchImportService(workspaceRepository);
  const defaultKbAccessMode: KbAccessMode = 'mcp';
  const validRevisionStates = new Set(Object.values(RevisionState));
  const validRevisionStatuses = new Set(Object.values(RevisionStatus));
  const validPBIScopeModes = new Set([PBIBatchScopeMode.ALL, PBIBatchScopeMode.SELECTED_ONLY]);
  const validPBIBatchStatuses = new Set(Object.values(PBIBatchStatus));
  const validPBIValidationStatuses = new Set(Object.values(PBIValidationStatus));
  const validDraftBranchStatuses = new Set(Object.values(DraftBranchStatus));
  type ProposalToolContext = Parameters<AgentRuntimeToolContext['proposeCreateKb']>[1];
  const runtimeToolContext: AgentRuntimeToolContext = {
    searchKb: async (input: MCPFindRelatedArticlesInput & { workspaceId: string }) => {
      return workspaceRepository.searchArticles(input.workspaceId, {
        workspaceId: input.workspaceId,
        query: input.query ?? '',
        scope: 'all',
        includeArchived: true
      });
    },
    getExplorerTree: async (workspaceId: string) => {
      return workspaceRepository.getExplorerTree(workspaceId);
    },
    getArticle: async (input: MCPGetArticleInput) => {
      return workspaceRepository.getArticleDetail(input.workspaceId, {
        workspaceId: input.workspaceId,
        revisionId: input.revisionId,
        localeVariantId: input.localeVariantId,
        includePublishLog: true,
        includeLineage: true
      });
    },
    getArticleFamily: async (input: MCPGetArticleFamilyInput) => {
      return workspaceRepository.getArticleFamily(input.workspaceId, input.familyId);
    },
    getLocaleVariant: async (input: MCPGetLocaleVariantInput) => {
      return workspaceRepository.getLocaleVariant(input.workspaceId, input.familyId);
    },
    findRelatedArticles: async (input: MCPFindRelatedArticlesInput) => {
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
    listCategories: async (input: MCPListCategoriesInput) => {
      const client = await buildZendeskClient(input.workspaceId);
      const categories = await client.listCategories(input.locale.trim()) as unknown as ZendeskCategoryRecord[];
      return {
        ok: true,
        workspaceId: input.workspaceId,
        locale: input.locale,
        categories
      };
    },
    listSections: async (input: MCPListSectionsInput) => {
      const client = await buildZendeskClient(input.workspaceId);
      const sections = await client.listSections(input.categoryId, input.locale.trim()) as unknown as ZendeskSectionRecord[];
      return {
        ok: true,
        workspaceId: input.workspaceId,
        locale: input.locale,
        categoryId: input.categoryId,
        sections
      };
    },
    listArticleTemplates: async (input: MCPListArticleTemplatesInput) => {
      const templates = await workspaceRepository.listTemplatePacks(input.workspaceId);
      return { workspaceId: input.workspaceId, templates };
    },
    getTemplate: async (input: MCPListArticleTemplatesInput & { templatePackId: string; workspaceId: string }) => {
      return workspaceRepository.getTemplatePack(input.workspaceId, input.templatePackId);
    },
    getBatchContext: async (input: MCPGetBatchContextInput) => {
      const context = await workspaceRepository.getBatchContext(input.workspaceId, input.batchId);
      if (!context) {
        throw new Error('batch not found');
      }
      return context;
    },
    getPBI: async (input: MCPGetPBIInput) => {
      const pbi = await workspaceRepository.getPBIRecord(input.workspaceId, input.pbiId);
      if (!pbi) {
        throw new Error('pbi not found');
      }
      return pbi;
    },
    getPBISubset: async (input: MCPGetPBISubsetInput) => {
      return workspaceRepository.getPBISubset(input.workspaceId, input.batchId, input.rowNumbers);
    },
    getArticleHistory: async (input: MCPGetArticleHistoryInput) => {
      return workspaceRepository.getHistory(input.workspaceId, input.localeVariantId);
    },
    recordAgentNotes: async (input: MCPRecordAgentNotesInput) => ({
      ok: true,
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      recorded: true,
      note: input.note
    }),
    proposeCreateKb: async (input: MCPRecordAgentNotesInput, context: ProposalToolContext) => {
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
        action: ProposalAction.CREATE,
        _sessionId: sessionId,
        localeVariantId: input.localeVariantId,
        note: input.note,
        rationale: input.rationale,
        relatedPbiIds: input.pbiIds,
        metadata: input.metadata
      });
      return { ok: true, ...created };
    },
    proposeEditKb: async (input: MCPRecordAgentNotesInput, context: ProposalToolContext) => {
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
        action: ProposalAction.EDIT,
        _sessionId: sessionId,
        localeVariantId: input.localeVariantId,
        note: input.note,
        rationale: input.rationale,
        relatedPbiIds: input.pbiIds,
        metadata: input.metadata
      });
      return { ok: true, ...created };
    },
    proposeRetireKb: async (input: MCPRecordAgentNotesInput, context: ProposalToolContext) => {
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
        action: ProposalAction.RETIRE,
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
  const kbCliLoopback = new KbCliLoopbackService(workspaceRepository);
  const kbCliRuntime = new KbCliRuntimeService(kbCliLoopback, workspaceRepository);
  const agentRuntime = new CursorAcpRuntime(workspaceRoot, runtimeToolContext, {
    getCliHealth: (workspaceId) => kbCliRuntime.checkHealth(workspaceId),
    buildCliPromptSuffix: () => kbCliRuntime.buildPromptSuffix()
  }, (message, details) => {
    logger.info(`[agent-runtime] ${message}`, details);
  });
  const resolveWorkspaceKbAccessMode = async (workspaceId: string): Promise<KbAccessMode> => {
    const settings = await workspaceRepository.getWorkspaceSettings(workspaceId);
    return settings.kbAccessMode || defaultKbAccessMode;
  };
  const buildZendeskClient = async (workspaceId: string): Promise<ZendeskClient> => {
    const settings = await workspaceRepository.getWorkspaceSettings(workspaceId);
    const credentials = await workspaceRepository.getZendeskCredentialsForSync(workspaceId);
    if (!credentials) {
      throw new Error('Zendesk credentials are not configured for this workspace');
    }
    return ZendeskClient.fromConfig(
      { timeoutMs: 30_000 },
      {
        subdomain: settings.zendeskSubdomain,
        email: credentials.email,
        apiToken: credentials.apiToken
      }
    );
  };

  bus.register('workspace.getRouteConfig', async () => ({
    ok: true,
    data: {
      routes: AppRoute
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
    const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
    const requestedMode = (payload as { kbAccessMode?: KbAccessMode })?.kbAccessMode;
    if (!workspaceId) {
      return createErrorResult(AppErrorCode.INVALID_REQUEST, 'agent.health.check requires workspaceId');
    }
    const workspaceMode = await resolveWorkspaceKbAccessMode(workspaceId);
    const selectedMode = requestedMode === 'mcp' || requestedMode === 'cli' ? requestedMode : workspaceMode;
    logger.info('agent.health.check', {
      requestId,
      workspaceId,
      requestedMode,
      workspaceMode,
      selectedMode
    });
    const health = await agentRuntime.checkHealth(workspaceId, selectedMode, workspaceMode);
    logger.info('agent.health.check.result', {
      requestId,
      workspaceId,
      selectedMode,
      availableModes: health.availableModes,
      issues: health.issues,
      providers: {
        mcp: {
          ok: health.providers.mcp.ok,
          failureCode: health.providers.mcp.failureCode,
          message: health.providers.mcp.message
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

  bus.register('agent.session.create', async (payload: unknown, requestId) => {
    const input = payload as AgentSessionCreateRequest;
    try {
      const workspaceId = input?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'agent.session.create requires workspaceId');
      }
      if (!input.type) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'agent.session.create requires type');
      }
      const kbAccessMode = input.kbAccessMode ?? (await resolveWorkspaceKbAccessMode(workspaceId));
      const session = agentRuntime.createSession({ ...input, kbAccessMode });
      logger.info('agent.session.create', { requestId, sessionId: session.id });
      return { ok: true, data: session };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
    }
  });

  bus.register('agent.session.list', async (payload: unknown, requestId) => {
    const input = payload as AgentSessionListRequest;
    try {
      const workspaceId = input?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'agent.session.list requires workspaceId');
      }
      logger.info('agent.session.list', { requestId, workspaceId });
      return {
        ok: true,
        data: {
          workspaceId,
          sessions: agentRuntime.listSessions(workspaceId, Boolean(input?.includeClosed))
        } as AgentSessionListResponse
      };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
    }
  });

  bus.register('agent.session.get', async (payload: unknown, requestId) => {
    const input = payload as AgentSessionGetRequest;
    try {
      const session = input?.sessionId
        ? agentRuntime.getSession(input.sessionId)
        : null;
      if (!session) {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'session not found');
      }
      if (session.workspaceId !== input.workspaceId) {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'session not found');
      }
      logger.info('agent.session.get', { requestId, workspaceId: input.workspaceId, sessionId: input.sessionId });
      return { ok: true, data: session };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
    }
  });

  bus.register('agent.session.close', async (payload: unknown, requestId) => {
    const input = payload as AgentSessionCloseRequest;
    try {
      const workspaceId = input?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'agent.session.close requires workspaceId');
      }
      const session = agentRuntime.closeSession(input);
      logger.info('agent.session.close', { requestId, workspaceId, sessionId: input.sessionId });
      if (!session) {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'session not found');
      }
      return { ok: true, data: session };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
    }
  });

  bus.register('agent.transcript.get', async (payload: unknown) => {
    const input = payload as AgentTranscriptRequest;
    try {
      if (!input?.workspaceId || !input.sessionId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'agent.transcript.get requires workspaceId and sessionId');
      }
      return { ok: true, data: await agentRuntime.getTranscripts(input) };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
    }
  });

  bus.register('agent.tool.calls', async (payload: unknown) => {
    const input = payload as AgentSessionGetRequest;
    try {
      if (!input?.workspaceId || !input.sessionId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'agent.tool.calls requires workspaceId and sessionId');
      }
      const session = agentRuntime.getSession(input.sessionId);
      if (!session || session.workspaceId !== input.workspaceId) {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'session not found');
      }
      return {
        ok: true,
        data: {
          workspaceId: input.workspaceId,
          sessionId: input.sessionId,
          toolCalls: agentRuntime.listToolCallAudit(input.sessionId, input.workspaceId)
        }
      };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
    }
  });

  bus.register('agent.analysis.latest', async (payload: unknown) => {
    const input = payload as { workspaceId?: string; batchId?: string; limit?: number };
    try {
      if (!input?.workspaceId || !input.batchId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'agent.analysis.latest requires workspaceId and batchId');
      }

      const run = await workspaceRepository.getLatestBatchAnalysisRun(input.workspaceId, input.batchId);
      const lines = await readTranscriptLines(run?.transcriptPath, input.limit);
      const response: PersistedAgentAnalysisRunResponse = {
        workspaceId: input.workspaceId,
        batchId: input.batchId,
        run,
        lines
      };
      return { ok: true, data: response };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
    }
  });

  bus.register('workspace.create', async (payload, requestId) => {
    logger.info('command workspace.create begin', { requestId });
    try {
      const input = payload as WorkspaceCreateRequest;
      const required = ['name', 'zendeskSubdomain', 'defaultLocale'] as const;
      if (!input || required.some((key) => !input[key])) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'workspace.create requires name, zendeskSubdomain, defaultLocale');
      }

      const created = await workspaceRepository.createWorkspace({
        name: input.name,
        zendeskSubdomain: input.zendeskSubdomain,
        defaultLocale: input.defaultLocale,
        enabledLocales: input.enabledLocales,
        path: input.path,
        zendeskBrandId: input.zendeskBrandId
      });
      logger.info('command workspace.create success', {
        requestId,
        workspaceId: created.id
      });
      return {
        ok: true,
        data: created
      };
    } catch (error) {
      console.error('[command-error] workspace.create failed', {
        requestId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      logger.error('command workspace.create failed', {
        requestId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('workspace.list', async (_payload, requestId) => {
    logger.info('command workspace.list begin', { requestId });
    try {
      const workspaces = await workspaceRepository.getWorkspaceList();
      logger.info('command workspace.list success', { requestId, count: workspaces.length });
      return {
        ok: true,
        data: { workspaces }
      };
    } catch (error) {
      console.error('[command-error] workspace.list failed', {
        requestId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      logger.error('command workspace.list failed', {
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
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('workspace.get', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'workspace.get requires workspaceId');
      }

      const workspace = await workspaceRepository.getWorkspace(workspaceId);
      return { ok: true, data: workspace };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('workspace.settings.get', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'workspace.settings.get requires workspaceId');
      }

      const settings = await workspaceRepository.getWorkspaceSettings(workspaceId);
      return { ok: true, data: settings };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('workspace.settings.update', async (payload) => {
    try {
      const input = payload as WorkspaceSettingsUpdateRequest | undefined;
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'workspace.settings.update requires workspaceId');
      }
      if (
        input.zendeskSubdomain === undefined &&
        input.zendeskBrandId === undefined &&
        input.defaultLocale === undefined &&
        input.enabledLocales === undefined &&
        input.kbAccessMode === undefined
      ) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'workspace.settings.update requires at least one setting field');
      }
      if (typeof input.defaultLocale === 'string' && !input.defaultLocale.trim()) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'defaultLocale cannot be empty');
      }
      if (typeof input.zendeskSubdomain === 'string' && !input.zendeskSubdomain.trim()) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'zendeskSubdomain cannot be empty');
      }
      if (Array.isArray(input.enabledLocales) && input.enabledLocales.length === 0) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'enabledLocales cannot be empty');
      }
      if (Array.isArray(input.enabledLocales) && input.enabledLocales.length && input.enabledLocales.some((locale) => !locale || !String(locale).trim())) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'enabledLocales must only contain non-empty values');
      }
      if (input.kbAccessMode !== undefined && input.kbAccessMode !== 'mcp' && input.kbAccessMode !== 'cli') {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'kbAccessMode must be mcp or cli');
      }

      const updated = await workspaceRepository.updateWorkspaceSettings(input);
      return { ok: true, data: updated };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      if (
        (error as Error).message === 'defaultLocale must be included in enabledLocales' ||
        (error as Error).message === 'No settings provided' ||
        (error as Error).message === 'defaultLocale cannot be empty' ||
        (error as Error).message === 'enabledLocales cannot be empty' ||
        (error as Error).message === 'zendeskSubdomain cannot be empty'
      ) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('workspace.open', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'workspace.open requires workspaceId');
      }

      const workspace = await workspaceRepository.openWorkspace(workspaceId);
      return { ok: true, data: workspace };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('workspace.delete', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'workspace.delete requires workspaceId');
      }

      await workspaceRepository.deleteWorkspace(workspaceId);
      return { ok: true, data: { workspaceId, deleted: true } };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('workspace.default.set', async (payload) => {
    try {
      const { workspaceId } = payload as WorkspaceDefaultRequest;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'workspace.default.set requires workspaceId');
      }

      await workspaceRepository.setDefaultWorkspace(workspaceId);
      return {
        ok: true,
        data: {
          workspaceId,
          isDefault: true
        }
      };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('workspace.explorer.getTree', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'workspace.explorer.getTree requires workspaceId');
      }

      const nodes = await workspaceRepository.getExplorerTree(workspaceId);
      return {
        ok: true,
        data: {
          workspaceId,
          nodes
        }
      };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.detail.get', async (payload) => {
    try {
      const input = payload as ArticleDetailRequest | undefined;
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.detail.get requires workspaceId');
      }
      if (!input.revisionId && !input.localeVariantId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.detail.get requires revisionId or localeVariantId');
      }

      const response = await workspaceRepository.getArticleDetail(input.workspaceId, input);
      return { ok: true, data: response };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      if (
        (error as Error).message === 'Revision or locale variant not found' ||
        (error as Error).message === 'Article family not found'
      ) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.relations.list', async (payload) => {
    try {
      const input = payload as ArticleRelationsListRequest | undefined;
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.relations.list requires workspaceId');
      }
      if (!input.familyId && !input.localeVariantId && !input.batchId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.relations.list requires familyId, localeVariantId, or batchId');
      }
      const response = await workspaceRepository.listArticleRelations(input.workspaceId, input);
      return { ok: true, data: response };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.relations.upsert', async (payload) => {
    try {
      const input = payload as ArticleRelationUpsertRequest | undefined;
      if (!input?.workspaceId || !input.sourceFamilyId || !input.targetFamilyId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.relations.upsert requires workspaceId, sourceFamilyId, and targetFamilyId');
      }
      const response = await workspaceRepository.upsertManualArticleRelation(input);
      return { ok: true, data: response };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.relations.delete', async (payload) => {
    try {
      const input = payload as ArticleRelationDeleteRequest | undefined;
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.relations.delete requires workspaceId');
      }
      const response = await workspaceRepository.deleteArticleRelation(input);
      return { ok: true, data: response };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.relations.status', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string } | undefined)?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.relations.status requires workspaceId');
      }
      const response = await workspaceRepository.getArticleRelationsStatus(workspaceId);
      return { ok: true, data: response };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.preview.styles.get', async (payload) => {
    try {
      const stylePath = await resolveArticlePreviewStylePath((payload as { stylePath?: string })?.stylePath);
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

      const styleContent = await fs.readFile(stylePath, 'utf8');
      const safeStyle = `${fallbackCss}\n${sanitizeZendeskStyles(styleContent)}`;

      return {
        ok: true,
        data: {
          css: safeStyle,
          sourcePath: stylePath
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {
          ok: true,
          data: {
            css: buildFallbackZendeskVariableCss(),
            sourcePath: ''
          }
        };
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('articleFamily.list', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'articleFamily.list requires workspaceId');
      }
      const families = await workspaceRepository.listArticleFamilies(workspaceId);
      return { ok: true, data: { workspaceId, families } };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('articleFamily.get', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string; familyId?: string })?.workspaceId;
      const familyId = (payload as { familyId?: string })?.familyId;
      if (!workspaceId || !familyId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'articleFamily.get requires workspaceId and familyId');
      }
      const family = await workspaceRepository.getArticleFamily(workspaceId, familyId);
      return { ok: true, data: family };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      if ((error as Error).message === 'Article family not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Article family not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('articleFamily.create', async (payload) => {
    try {
      const input = payload as ArticleFamilyCreateRequest | undefined;
      if (!input?.workspaceId || !input.externalKey || !input.title) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'articleFamily.create requires workspaceId, externalKey, title');
      }
      if (typeof input.externalKey === 'string' && !input.externalKey.trim()) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'articleFamily.externalKey cannot be empty');
      }
      if (typeof input.title === 'string' && !input.title.trim()) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'articleFamily.title cannot be empty');
      }
      const family = await workspaceRepository.createArticleFamily(input);
      return { ok: true, data: family };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      if ((error as Error).message === 'Article family already exists' ||
        (error as Error).message === 'Article family title is required' ||
        (error as Error).message === 'Article family externalKey is required' ||
        (error as Error).message === 'Article family title cannot be empty'
      ) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('articleFamily.update', async (payload) => {
    try {
      const input = payload as ArticleFamilyUpdateRequest | undefined;
      if (!input?.workspaceId || !input.familyId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'articleFamily.update requires workspaceId and familyId');
      }
      if (
        input.title === undefined &&
        input.sectionId === undefined &&
        input.categoryId === undefined &&
        input.retiredAtUtc === undefined
      ) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'articleFamily.update requires at least one field');
      }
      const family = await workspaceRepository.updateArticleFamily(input);
      return { ok: true, data: family };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Article family not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      if ((error as Error).message === 'Article family update requires at least one field' || (error as Error).message === 'Article family title cannot be empty') {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('articleFamily.delete', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string; familyId?: string })?.workspaceId;
      const familyId = (payload as { familyId?: string })?.familyId;
      if (!workspaceId || !familyId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'articleFamily.delete requires workspaceId and familyId');
      }
      await workspaceRepository.deleteArticleFamily(workspaceId, familyId);
      return { ok: true, data: { workspaceId, familyId, deleted: true } };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Article family not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('localeVariant.list', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'localeVariant.list requires workspaceId');
      }
      const variants = await workspaceRepository.listLocaleVariants(workspaceId);
      return { ok: true, data: { workspaceId, variants } };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('localeVariant.get', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string; variantId?: string })?.workspaceId;
      const variantId = (payload as { variantId?: string })?.variantId;
      if (!workspaceId || !variantId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'localeVariant.get requires workspaceId and variantId');
      }
      const variant = await workspaceRepository.getLocaleVariant(workspaceId, variantId);
      return { ok: true, data: variant };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Locale variant not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('localeVariant.create', async (payload) => {
    try {
      const input = payload as LocaleVariantCreateRequest | undefined;
      if (!input?.workspaceId || !input.familyId || !input.locale) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'localeVariant.create requires workspaceId, familyId, locale');
      }
      if (typeof input.locale === 'string' && !input.locale.trim()) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'locale is required');
      }
      if (input.status && !validRevisionStates.has(input.status)) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'localeVariant.status must be live|draft_branch|obsolete|retired');
      }
      const variant = await workspaceRepository.createLocaleVariant(input);
      return { ok: true, data: variant };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Article family not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      if (
        (error as Error).message === 'Locale is required' ||
        (error as Error).message === 'Locale variant already exists'
      ) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('localeVariant.update', async (payload) => {
    try {
      const input = payload as LocaleVariantUpdateRequest | undefined;
      if (!input?.workspaceId || !input.variantId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'localeVariant.update requires workspaceId and variantId');
      }
      if (
        input.locale === undefined &&
        input.status === undefined &&
        input.retiredAtUtc === undefined
      ) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'localeVariant.update requires at least one field');
      }
      if (input.status && !validRevisionStates.has(input.status)) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'localeVariant.status must be live|draft_branch|obsolete|retired');
      }
      const variant = await workspaceRepository.updateLocaleVariant(input);
      return { ok: true, data: variant };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Locale variant not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      if (
        (error as Error).message === 'Locale is required' ||
        (error as Error).message === 'Locale variant update requires at least one field' ||
        (error as Error).message === 'Locale variant already exists'
      ) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('localeVariant.delete', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string; variantId?: string })?.workspaceId;
      const variantId = (payload as { variantId?: string })?.variantId;
      if (!workspaceId || !variantId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'localeVariant.delete requires workspaceId and variantId');
      }
      await workspaceRepository.deleteLocaleVariant(workspaceId, variantId);
      return { ok: true, data: { workspaceId, variantId, deleted: true } };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Locale variant not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('revision.list', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string; localeVariantId?: string })?.workspaceId;
      const localeVariantId = (payload as { localeVariantId?: string })?.localeVariantId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'revision.list requires workspaceId');
      }
      const revisions = await workspaceRepository.listRevisions(workspaceId, localeVariantId);
      return { ok: true, data: { workspaceId, localeVariantId, revisions } };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('revision.get', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string; revisionId?: string })?.workspaceId;
      const revisionId = (payload as { revisionId?: string })?.revisionId;
      if (!workspaceId || !revisionId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'revision.get requires workspaceId and revisionId');
      }
      const revision = await workspaceRepository.getRevision(workspaceId, revisionId);
      return { ok: true, data: revision };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Revision not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('revision.create', async (payload) => {
    try {
      const input = payload as RevisionCreateRequest | undefined;
      if (!input?.workspaceId || !input.localeVariantId || !input.filePath || !input.revisionType || !input.status || input.revisionNumber === undefined) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'revision.create requires workspaceId, localeVariantId, revisionType, status, revisionNumber, filePath');
      }
      if (!validRevisionStates.has(input.revisionType)) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'revisionType must be live|draft_branch|obsolete|retired');
      }
      if (!validRevisionStatuses.has(input.status)) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'status must be open|promoted|failed|deleted');
      }
      if (!Number.isInteger(input.revisionNumber) || input.revisionNumber < 0) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'revisionNumber must be a non-negative integer');
      }
      const revision = await workspaceRepository.createRevision(input);
      return { ok: true, data: revision };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Locale variant not found' || (error as Error).message === 'Revision not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      if ((error as Error).message === 'filePath is required' || (error as Error).message === 'revisionNumber must not regress' || (error as Error).message === 'revisionNumber must be non-negative') {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, (error as Error).message);
      }
      if ((error as Error).message === 'revisionNumber must be an integer') {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('revision.update', async (payload) => {
    try {
      const input = payload as RevisionUpdateRequest | undefined;
      if (!input?.workspaceId || !input.revisionId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'revision.update requires workspaceId and revisionId');
      }
      if (
        input.revisionType === undefined &&
        input.branchId === undefined &&
        input.filePath === undefined &&
        input.contentHash === undefined &&
        input.sourceRevisionId === undefined &&
        input.revisionNumber === undefined &&
        input.status === undefined
      ) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'revision.update requires at least one field');
      }
      if (input.revisionType && !validRevisionStates.has(input.revisionType)) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'revisionType must be live|draft_branch|obsolete|retired');
      }
      if (input.status && !validRevisionStatuses.has(input.status)) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'status must be open|promoted|failed|deleted');
      }
      if (input.revisionNumber !== undefined && (!Number.isInteger(input.revisionNumber) || input.revisionNumber < 0)) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'revisionNumber must be a non-negative integer');
      }
      const revision = await workspaceRepository.updateRevision(input);
      return { ok: true, data: revision };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Revision not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      if ((error as Error).message === 'filePath is required' || (error as Error).message === 'revisionNumber must not regress') {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, (error as Error).message);
      }
      if ((error as Error).message === 'revisionNumber must be an integer' || (error as Error).message === 'revision.update requires at least one field') {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('revision.delete', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string; revisionId?: string })?.workspaceId;
      const revisionId = (payload as { revisionId?: string })?.revisionId;
      if (!workspaceId || !revisionId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'revision.delete requires workspaceId and revisionId');
      }
      await workspaceRepository.deleteRevision(workspaceId, revisionId);
      return { ok: true, data: { workspaceId, revisionId, deleted: true } };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Revision not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('workspace.search', async (payload) => {
    try {
      const input = payload as SearchPayload | undefined;
      if (!input?.workspaceId || !input.query) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'workspace.search requires workspaceId and query');
      }

      const result = await workspaceRepository.searchArticles(input.workspaceId, input);
      return { ok: true, data: result };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('workspace.history.get', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string; localeVariantId?: string })?.workspaceId;
      const localeVariantId = (payload as { localeVariantId?: string })?.localeVariantId;
      if (!workspaceId || !localeVariantId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'workspace.history.get requires workspaceId and localeVariantId');
      }

      const result = await workspaceRepository.getHistory(workspaceId, localeVariantId);
      return { ok: true, data: result };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('workspace.repository.info', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'workspace.repository.info requires workspaceId');
      }
      const payloadData = await workspaceRepository.getRepositoryStructure(workspaceId);
      return { ok: true, data: payloadData };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('workspace.route.get', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'workspace.route.get requires workspaceId');
      }
      const route = await workspaceRepository.workspaceRoutePayload(workspaceId);
      return { ok: true, data: route };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('pbiBatch.import', async (payload) => {
    try {
      const input = payload as PBIBatchImportRequest | undefined;
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiBatch.import requires workspaceId');
      }
      if (!input.sourceFileName?.trim()) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiBatch.import requires sourceFileName');
      }
      if (!input.sourcePath && !input.sourceContent) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiBatch.import requires sourcePath or sourceContent');
      }
      if (input.scope?.mode && !validPBIScopeModes.has(input.scope.mode)) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiBatch.import scope.mode must be all|selected_only');
      }

      const trimmedInput: PBIBatchImportRequest = {
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
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      if ((error as Error).message === 'No headers found in PBI source' || (error as Error).message === 'pbi.import requires sourcePath or sourceContent') {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('pbiBatch.list', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiBatch.list requires workspaceId');
      }
      const batches = await workspaceRepository.listPBIBatches(workspaceId);
      return { ok: true, data: { workspaceId, batches } };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('pbiBatch.get', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      const batchId = (payload as { batchId?: string })?.batchId;
      if (!workspaceId || !batchId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiBatch.get requires workspaceId and batchId');
      }
      const batch = await workspaceRepository.getPBIBatch(workspaceId, batchId);
      return { ok: true, data: { workspaceId, batch } };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'PBI batch not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('pbiBatch.rows.list', async (payload) => {
    try {
      const input = payload as PBIBatchRowsRequest | undefined;
      if (!input?.workspaceId || !input?.batchId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiBatch.rows.list requires workspaceId and batchId');
      }
      if (input.validationStatuses?.length && !input.validationStatuses.every((status) => validPBIValidationStatuses.has(status))) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiBatch.rows.list requires validationStatuses to be candidate|malformed|duplicate|ignored');
      }
      const rows = await workspaceRepository.getPBIRecords(input.workspaceId, input.batchId, input.validationStatuses);
      return { ok: true, data: { workspaceId: input.workspaceId, batchId: input.batchId, rows } };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'PBI batch not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('pbiBatch.scope.set', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      const batchId = (payload as { batchId?: string })?.batchId;
      const mode = (payload as { mode?: PBIBatchScopeMode })?.mode;
      const selectedRows = (payload as { selectedRows?: number[] })?.selectedRows;
      const selectedExternalIds = (payload as { selectedExternalIds?: string[] })?.selectedExternalIds;

      if (!workspaceId || !batchId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiBatch.scope.set requires workspaceId and batchId');
      }
      if (!mode) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiBatch.scope.set requires mode');
      }
      if (!validPBIScopeModes.has(mode)) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiBatch.scope.set mode must be all|selected_only');
      }

      const result = await workspaceRepository.setPBIBatchScope(
        workspaceId,
        batchId,
        mode,
        selectedRows ?? [],
        selectedExternalIds ?? []
      );
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
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'PBI batch not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('pbiBatch.setStatus', async (payload) => {
    try {
      const input = payload as PBIBatchStatusUpdateRequest | undefined;
      const workspaceId = input?.workspaceId;
      const batchId = input?.batchId;
      const status = input?.status;

      if (!workspaceId || !batchId || !status) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiBatch.setStatus requires workspaceId, batchId, and status');
      }
      if (status === 'proposed') {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiBatch.setStatus status must be imported|scoped|submitted|analyzed|review_in_progress|review_complete|archived');
      }
      const batchStatus = status as PBIBatchStatus;
      if (!validPBIBatchStatuses.has(batchStatus)) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiBatch.setStatus status must be imported|scoped|submitted|analyzed|review_in_progress|review_complete|archived');
      }

      const batch = await workspaceRepository.setPBIBatchStatus(
        workspaceId,
        batchId,
        batchStatus,
        Boolean(input?.force)
      );
      return { ok: true, data: { batch } };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'PBI batch not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      if ((error as Error).message?.startsWith('Cannot transition batch status')) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('pbiBatch.delete', async (payload) => {
    try {
      const input = payload as PBIBatchDeleteRequest | undefined;
      const workspaceId = input?.workspaceId;
      const batchId = input?.batchId;
      if (!workspaceId || !batchId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiBatch.delete requires workspaceId and batchId');
      }

      await workspaceRepository.deletePBIBatch(workspaceId, batchId);
      return { ok: true, data: { workspaceId, batchId } };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'PBI batch not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('pbiBatch.getPreflight', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      const batchId = (payload as { batchId?: string })?.batchId;
      if (!workspaceId || !batchId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiBatch.getPreflight requires workspaceId and batchId');
      }
      const preflight = await pbiBatchImportService.getBatchPreflight(workspaceId, batchId);
      return { ok: true, data: preflight };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'PBI batch not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('proposal.ingest', async (payload) => {
    try {
      const input = payload as ProposalIngestRequest;
      if (!input?.workspaceId || !input.batchId || !input.action) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'proposal.ingest requires workspaceId, batchId, and action');
      }
      const proposal = await workspaceRepository.createAgentProposal({
        workspaceId: input.workspaceId,
        batchId: input.batchId,
        action: input.action,
        _sessionId: input.sessionId,
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
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'PBI batch not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('proposal.review.list', async (payload) => {
    try {
      const input = payload as ProposalReviewListRequest;
      if (!input?.workspaceId || !input.batchId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'proposal.review.list requires workspaceId and batchId');
      }
      return { ok: true, data: await workspaceRepository.listProposalReviewQueue(input.workspaceId, input.batchId) };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'PBI batch not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('proposal.review.batchList', async (payload) => {
    try {
      const input = payload as ProposalReviewBatchListRequest;
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'proposal.review.batchList requires workspaceId');
      }
      return { ok: true, data: await workspaceRepository.listProposalReviewBatches(input.workspaceId) };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('proposal.review.get', async (payload) => {
    try {
      const input = payload as ProposalReviewGetRequest;
      if (!input?.workspaceId || !input.proposalId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'proposal.review.get requires workspaceId and proposalId');
      }
      return { ok: true, data: await workspaceRepository.getProposalReviewDetail(input.workspaceId, input.proposalId) };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Proposal not found' || (error as Error).message === 'PBI batch not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('proposal.review.decide', async (payload) => {
    try {
      const input = payload as ProposalReviewDecisionRequest;
      if (!input?.workspaceId || !input.proposalId || !input.decision) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'proposal.review.decide requires workspaceId, proposalId, and decision');
      }
      if (!Object.values(ProposalReviewDecision).includes(input.decision)) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'proposal.review.decide decision must be accept|deny|defer|apply_to_branch|archive');
      }
      return { ok: true, data: await workspaceRepository.decideProposalReview(input) };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Proposal not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.ai.get', async (payload) => {
    try {
      const input = payload as ArticleAiSessionGetRequest;
      if (!input?.workspaceId || (!input.branchId && !input.localeVariantId)) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.ai.get requires workspaceId and branchId or localeVariantId');
      }
      return { ok: true, data: await workspaceRepository.getOrCreateArticleAiSession(input) };
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.ai.submit', async (payload) => {
    try {
      const input = payload as ArticleAiSubmitRequest;
      if (!input?.workspaceId || (!input.branchId && !input.localeVariantId) || !input.message?.trim()) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.ai.submit requires workspaceId, branchId or localeVariantId, and message');
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

      const kbAccessMode = await resolveWorkspaceKbAccessMode(input.workspaceId);
      const run = await agentRuntime.runArticleEdit(
        {
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
        },
        () => undefined,
        () => false
      );

      const parsed = parseArticleAiResult(run.resultPayload);
      if (!parsed) {
        return createErrorResult(AppErrorCode.INTERNAL_ERROR, 'Unable to parse AI article edit result');
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
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.ai.reset', async (payload) => {
    try {
      const input = payload as ArticleAiResetRequest;
      if (!input?.workspaceId || !input.sessionId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.ai.reset requires workspaceId and sessionId');
      }
      return { ok: true, data: await workspaceRepository.resetArticleAiSession(input) };
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.ai.accept', async (payload) => {
    try {
      const input = payload as ArticleAiDecisionRequest;
      if (!input?.workspaceId || !input.sessionId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.ai.accept requires workspaceId and sessionId');
      }
      return { ok: true, data: await workspaceRepository.acceptArticleAiEdit(input) };
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.ai.reject', async (payload) => {
    try {
      const input = payload as ArticleAiDecisionRequest;
      if (!input?.workspaceId || !input.sessionId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.ai.reject requires workspaceId and sessionId');
      }
      return { ok: true, data: await workspaceRepository.rejectArticleAiEdit(input) };
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('template.pack.list', async (payload) => {
    try {
      const input = payload as TemplatePackListRequest;
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'template.pack.list requires workspaceId');
      }
      return { ok: true, data: await workspaceRepository.listTemplatePackSummaries(input) };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('template.pack.get', async (payload) => {
    try {
      const input = payload as TemplatePackGetRequest;
      if (!input?.workspaceId || !input.templatePackId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'template.pack.get requires workspaceId and templatePackId');
      }
      const detail = await workspaceRepository.getTemplatePackDetail(input);
      if (!detail) {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Template pack not found');
      }
      return { ok: true, data: detail };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('template.pack.save', async (payload) => {
    try {
      const input = payload as TemplatePackUpsertRequest;
      if (!input?.workspaceId || !input.name || !input.language || !input.templateType || !input.promptTemplate || !input.toneRules) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'template.pack.save requires workspaceId, name, language, templateType, promptTemplate, and toneRules');
      }
      return { ok: true, data: await workspaceRepository.upsertTemplatePack(input) };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('template.pack.delete', async (payload) => {
    try {
      const input = payload as TemplatePackDeleteRequest;
      if (!input?.workspaceId || !input.templatePackId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'template.pack.delete requires workspaceId and templatePackId');
      }
      return { ok: true, data: await workspaceRepository.deleteTemplatePack(input) };
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('template.pack.analyze', async (payload) => {
    try {
      const input = payload as TemplatePackAnalysisRequest;
      if (!input?.workspaceId || !input.templatePackId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'template.pack.analyze requires workspaceId and templatePackId');
      }
      const detail = await workspaceRepository.analyzeTemplatePack(input);
      if (!detail) {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Template pack not found');
      }
      return { ok: true, data: detail };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('draft.branch.list', async (payload) => {
    try {
      const input = payload as DraftBranchListRequest;
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'draft.branch.list requires workspaceId');
      }
      return { ok: true, data: await workspaceRepository.listDraftBranches(input.workspaceId, input) };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('draft.branch.get', async (payload) => {
    try {
      const input = payload as DraftBranchGetRequest;
      if (!input?.workspaceId || !input.branchId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'draft.branch.get requires workspaceId and branchId');
      }
      return { ok: true, data: await workspaceRepository.getDraftBranchEditor(input.workspaceId, input.branchId) };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Draft branch not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('draft.branch.create', async (payload) => {
    try {
      const input = payload as DraftBranchCreateRequest;
      if (!input?.workspaceId || !input.localeVariantId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'draft.branch.create requires workspaceId and localeVariantId');
      }
      return { ok: true, data: await workspaceRepository.createDraftBranch(input) };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Locale variant not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('draft.branch.save', async (payload) => {
    try {
      const input = payload as DraftBranchSaveRequest;
      if (!input?.workspaceId || !input.branchId || typeof input.html !== 'string') {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'draft.branch.save requires workspaceId, branchId, and html');
      }
      return { ok: true, data: await workspaceRepository.saveDraftBranch(input) };
    } catch (error) {
      if (
        (error as Error).message === 'Workspace not found' ||
        (error as Error).message === 'Draft branch not found'
      ) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('draft.branch.status.set', async (payload) => {
    try {
      const input = payload as DraftBranchStatusUpdateRequest;
      if (!input?.workspaceId || !input.branchId || !input.status) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'draft.branch.status.set requires workspaceId, branchId, and status');
      }
      if (!validDraftBranchStatuses.has(input.status)) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'draft.branch.status.set status is invalid');
      }
      return { ok: true, data: await workspaceRepository.setDraftBranchStatus(input) };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Draft branch not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('draft.branch.discard', async (payload) => {
    try {
      const input = payload as DraftBranchDiscardRequest;
      if (!input?.workspaceId || !input.branchId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'draft.branch.discard requires workspaceId and branchId');
      }
      return { ok: true, data: await workspaceRepository.discardDraftBranch(input) };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Draft branch not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('draft.branch.undo', async (payload) => {
    try {
      const input = payload as DraftBranchHistoryStepRequest;
      if (!input?.workspaceId || !input.branchId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'draft.branch.undo requires workspaceId and branchId');
      }
      return { ok: true, data: await workspaceRepository.undoDraftBranch(input) };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Draft branch not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('draft.branch.redo', async (payload) => {
    try {
      const input = payload as DraftBranchHistoryStepRequest;
      if (!input?.workspaceId || !input.branchId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'draft.branch.redo requires workspaceId and branchId');
      }
      return { ok: true, data: await workspaceRepository.redoDraftBranch(input) };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Draft branch not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  jobs.registerRunner('workspace.bootstrap', async (payload: JobRunContext, emit) => {
    emit({
      id: payload.jobId ?? 'bootstrap',
      command: 'workspace.bootstrap',
      state: JobState.RUNNING,
      progress: 20,
      message: 'Resolving workspace root'
    });
    emit({
      id: payload.jobId ?? 'bootstrap',
      command: 'workspace.bootstrap',
      state: JobState.RUNNING,
      progress: 80,
      message: `Using root ${workspaceRoot}`
    });
    emit({
      id: payload.jobId ?? 'bootstrap',
      command: 'workspace.bootstrap',
      state: JobState.RUNNING,
      progress: 100,
      message: `Workspace path: ${path.resolve(workspaceRoot)}`
    });
  });

  jobs.registerRunner('agent.analysis.run', async (payload: JobRunContext, emit, isCancelled) => {
    const input = payload.input as unknown as AgentAnalysisRunRequest;
    logger.info('[agent.analysis.run] request received', {
      jobId: payload.jobId,
      workspaceId: input?.workspaceId,
      batchId: input?.batchId
    });
    if (!input?.workspaceId || !input.batchId) {
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.FAILED,
        progress: 100,
        message: 'agent.analysis.run requires workspaceId and batchId'
      });
      return;
    }
    if (isCancelled()) {
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.CANCELED,
        progress: 100,
        message: 'analysis canceled'
      });
      return;
    }
    const workspaceMode = await resolveWorkspaceKbAccessMode(input.workspaceId);
    const kbAccessMode = input.kbAccessMode ?? workspaceMode;
    const providerHealth = await agentRuntime.checkHealth(input.workspaceId, kbAccessMode, workspaceMode);
    const selectedProvider = providerHealth.providers[kbAccessMode];
    if (!selectedProvider.ok) {
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.FAILED,
        progress: 100,
        message: `Selected runtime ${kbAccessMode.toUpperCase()} is not ready: ${selectedProvider.message || 'not ready'}`
      });
      return;
    }
    emit({
      id: payload.jobId,
      command: payload.command,
      state: JobState.RUNNING,
      progress: 15,
      message: `Starting analysis session for batch ${input.batchId}`,
      metadata: {
        batchId: input.batchId,
        kbAccessMode
      }
    });
    logger.info('[agent.analysis.run] starting runtime', {
      jobId: payload.jobId,
      batchId: input.batchId,
      workspaceId: input.workspaceId
    });
    const streamMetadata: {
      batchId: string;
      kbAccessMode: KbAccessMode;
      workspaceId: string;
      status?: 'ok' | 'error' | 'timeout' | 'canceled';
      sessionId?: string;
    } = {
      batchId: input.batchId,
      kbAccessMode,
      workspaceId: input.workspaceId
    };
    const result = await agentRuntime.runBatchAnalysis(
      { ...input, kbAccessMode },
      (stream: AgentStreamingPayload) => {
        emit({
          id: payload.jobId,
          command: payload.command,
          state: JobState.RUNNING,
          progress: stream.kind === 'result' ? 100 : 35,
          message: JSON.stringify(stream),
          metadata: streamMetadata
        });
      },
      isCancelled
    );
    logger.info('[agent.analysis.run] runtime finished', {
      jobId: payload.jobId,
      batchId: input.batchId,
      status: result.status,
      toolCalls: result.toolCalls.length,
      transcriptPath: result.transcriptPath
    });
    const persistedStatus =
      result.status === 'ok'
        ? 'complete'
        : result.status === 'canceled'
          ? 'canceled'
          : 'failed';
    await workspaceRepository.recordBatchAnalysisRun({
      workspaceId: input.workspaceId,
      batchId: input.batchId,
      sessionId: result.sessionId,
      kbAccessMode,
      status: persistedStatus,
      startedAtUtc: result.startedAtUtc,
      endedAtUtc: result.endedAtUtc,
      promptTemplate: input.prompt,
      transcriptPath: result.transcriptPath,
      toolCalls: result.toolCalls,
      rawOutput: result.rawOutput,
      message: result.message
    });
    if (result.status === 'ok') {
      await workspaceRepository.setPBIBatchStatus(
        input.workspaceId,
        input.batchId,
        PBIBatchStatus.ANALYZED,
        true
      );
    }
    emit({
      id: payload.jobId,
      command: payload.command,
      state:
        result.status === 'error'
          ? JobState.FAILED
          : result.status === 'canceled'
            ? JobState.CANCELED
            : JobState.SUCCEEDED,
      progress: 100,
      message: result.message ?? 'analysis command complete',
      metadata: {
        ...streamMetadata,
        status: result.status,
        sessionId: result.sessionId
      }
    });
  });

  jobs.registerRunner('agent.article_edit.run', async (payload: JobRunContext, emit, isCancelled) => {
    const input = payload.input as unknown as AgentArticleEditRunRequest;
    if (!input?.workspaceId || !input.localeVariantId) {
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.FAILED,
        progress: 100,
        message: 'agent.article_edit.run requires workspaceId and localeVariantId'
      });
      return;
    }
    if (isCancelled()) {
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.CANCELED,
        progress: 100,
        message: 'article edit canceled'
      });
      return;
    }
    emit({
      id: payload.jobId,
      command: payload.command,
      state: JobState.RUNNING,
      progress: 20,
      message: `Starting article edit session for variant ${input.localeVariantId}`
    });
    const kbAccessMode = input.kbAccessMode ?? (await resolveWorkspaceKbAccessMode(input.workspaceId));
    const result = await agentRuntime.runArticleEdit(
      { ...input, kbAccessMode },
      (stream: AgentStreamingPayload) => {
        emit({
          id: payload.jobId,
          command: payload.command,
          state: JobState.RUNNING,
          progress: stream.kind === 'result' ? 100 : 45,
          message: JSON.stringify(stream)
        });
      },
      isCancelled
    );
    emit({
      id: payload.jobId,
      command: payload.command,
      state:
        result.status === 'error'
          ? JobState.FAILED
          : result.status === 'canceled'
            ? JobState.CANCELED
            : JobState.SUCCEEDED,
      progress: 100,
      message: result.message ?? 'article edit command complete'
    });
  });

  jobs.registerRunner('article.relations.refresh', async (payload: JobRunContext, emit, isCancelled) => {
    const input = payload.input as unknown as ArticleRelationRefreshRequest;
    if (!input?.workspaceId) {
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.FAILED,
        progress: 100,
        message: 'article.relations.refresh requires workspaceId'
      });
      return;
    }
    if (isCancelled()) {
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.CANCELED,
        progress: 100,
        message: 'relation refresh canceled'
      });
      return;
    }

    emit({
      id: payload.jobId,
      command: payload.command,
      state: JobState.RUNNING,
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
        state: JobState.SUCCEEDED,
        progress: 100,
        message: JSON.stringify(result.summary ?? {}),
        metadata: {
          runId: result.id,
          totalArticles: result.summary?.totalArticles ?? 0,
          candidatePairs: result.summary?.candidatePairs ?? 0,
          inferredRelations: result.summary?.inferredRelations ?? 0
        }
      });
    } catch (error) {
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.FAILED,
        progress: 100,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  bus.register('zendesk.credentials.get', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'zendesk.credentials.get requires workspaceId');
      }

      const credentials = await workspaceRepository.getZendeskCredentials(workspaceId);
      return {
        ok: true,
        data: credentials
      };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('zendesk.credentials.save', async (payload) => {
    try {
      const input = payload as ZendeskCredentialsInput | undefined;
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'zendesk.credentials.save requires workspaceId');
      }
      if (!input.email?.trim()) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'zendesk.credentials.save requires email');
      }
      if (!input.apiToken?.trim()) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'zendesk.credentials.save requires apiToken');
      }

      const saved = await workspaceRepository.saveZendeskCredentials(input.workspaceId, input.email, input.apiToken);
      return { ok: true, data: saved };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      if ((error as Error).message === 'Encrypted credential storage is unavailable') {
        return createErrorResult(AppErrorCode.NOT_AUTHORIZED, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('zendesk.connection.test', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'zendesk.connection.test requires workspaceId');
      }

      const client = await buildZendeskClient(workspaceId);
      const result = await client.testConnection();
      return { ok: true, data: { ...result, workspaceId, checkedAtUtc: new Date().toISOString() } };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      if ((error as Error).message === 'Encrypted credential storage is unavailable') {
        return createErrorResult(AppErrorCode.NOT_AUTHORIZED, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('zendesk.categories.list', async (payload) => {
    try {
      const { workspaceId, locale } = payload as ZendeskCategoriesListRequest;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'zendesk.categories.list requires workspaceId');
      }
      if (!locale?.trim()) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'zendesk.categories.list requires locale');
      }
      const client = await buildZendeskClient(workspaceId);
      const categories = await client.listCategories(locale.trim()) as unknown as ZendeskCategoryRecord[];
      return { ok: true, data: categories };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      if ((error as Error).message === 'Zendesk credentials are not configured for this workspace') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      if ((error as Error).message === 'Encrypted credential storage is unavailable') {
        return createErrorResult(AppErrorCode.NOT_AUTHORIZED, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('zendesk.sections.list', async (payload) => {
    try {
      const { workspaceId, locale, categoryId } = payload as ZendeskSectionsListRequest;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'zendesk.sections.list requires workspaceId');
      }
      if (!locale?.trim()) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'zendesk.sections.list requires locale');
      }
      if (!Number.isInteger(categoryId) || categoryId < 0) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'zendesk.sections.list requires categoryId');
      }
      const client = await buildZendeskClient(workspaceId);
      const sections = await client.listSections(categoryId, locale.trim()) as unknown as ZendeskSectionRecord[];
      return { ok: true, data: sections };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      if ((error as Error).message === 'Zendesk credentials are not configured for this workspace') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      if ((error as Error).message === 'Encrypted credential storage is unavailable') {
        return createErrorResult(AppErrorCode.NOT_AUTHORIZED, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('zendesk.articles.search', async (payload) => {
    try {
      const { workspaceId, locale, query } = payload as ZendeskSearchArticlesRequest;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'zendesk.articles.search requires workspaceId');
      }
      if (!locale?.trim()) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'zendesk.articles.search requires locale');
      }
      if (!query?.trim()) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'zendesk.articles.search requires query');
      }
      const client = await buildZendeskClient(workspaceId);
      const articles = await client.searchArticles(locale.trim(), query.trim()) as unknown as ZendeskSearchArticleRecord[];
      return { ok: true, data: articles };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      if ((error as Error).message === 'Zendesk credentials are not configured for this workspace') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      if ((error as Error).message === 'Encrypted credential storage is unavailable') {
        return createErrorResult(AppErrorCode.NOT_AUTHORIZED, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('zendesk.sync.getLatest', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'zendesk.sync.getLatest requires workspaceId');
      }

      const latest = await workspaceRepository.getLatestSyncRun(workspaceId);
      return {
        ok: true,
        data: latest ?? null
      };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('zendesk.sync.getLatestSuccessful', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'zendesk.sync.getLatestSuccessful requires workspaceId');
      }

      const latest = await workspaceRepository.getLatestSuccessfulSyncRun(workspaceId);
      return {
        ok: true,
        data: latest ?? null
      };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  jobs.registerRunner('zendesk.sync.run', async (payload: JobRunContext, emit) => {
    const input = payload.input as unknown as ZendeskSyncServiceInput | ZendeskSyncRunRequest | undefined;
    if (!input?.workspaceId || !input.mode) {
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.FAILED,
        progress: 100,
        message: 'zendesk.sync.run requires workspaceId and mode'
      });
      return;
    }
    if (input.mode !== 'full' && input.mode !== 'incremental') {
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.FAILED,
        progress: 100,
        message: 'sync mode must be full or incremental'
      });
      return;
    }

    const syncInput = input as unknown as ZendeskSyncServiceInput;
    await zendeskSyncService.runSync(
      {
        workspaceId: syncInput.workspaceId,
        mode: syncInput.mode,
        locale: syncInput.locale ? String(syncInput.locale).trim() : undefined,
        maxRetries: syncInput.maxRetries,
        retryDelayMs: syncInput.retryDelayMs,
        retryMaxDelayMs: syncInput.retryMaxDelayMs
      },
      emit,
      payload.command,
      payload.jobId
    );
  });

  bus.register('system.migrations.health', async (payload) => {
    try {
      const workspaceId = (payload as { workspaceId?: string })?.workspaceId;
      const health = await workspaceRepository.getMigrationHealth(workspaceId);
      return {
        ok: true,
        data: health
      };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  return {
    agentRuntime,
    kbCliLoopback,
    kbCliRuntime
  };
}
