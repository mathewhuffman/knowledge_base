import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  AppErrorCode,
  createErrorResult,
  AppRoute,
  isKbAccessMode,
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
  type PBILibraryGetRequest,
  type PBILibraryListRequest,
  type PBILibraryScopeState,
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
  type CoverageQueryRequest,
  type GraphQueryRequest,
  type FeatureMapSummaryRequest,
  type FeatureScopeRequest,
  type ArticleNeighborhoodRequest,
  type ArticleRelationDeleteRequest,
  type ArticleRelationFeedbackRecordRequest,
  type ArticleRelationRefreshRequest,
  type ArticleRelationsListRequest,
  type ArticleRelationUpsertRequest,
  type WorkspaceDefaultRequest,
  type ZendeskSyncRunRequest,
  type AgentAnalysisRunRequest,
  MAX_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES,
  MIN_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES,
  type AgentArticleEditRunRequest,
  type AgentSessionCreateRequest,
  type AgentSessionListRequest,
  type AgentSessionGetRequest,
  type AgentSessionCloseRequest,
  type AgentSessionListResponse,
  type AgentRuntimeOptionsRequest,
  type AgentRuntimeOptionsResponse,
  type AgentRuntimeModelOption,
  type AgentTranscriptRequest,
  type AgentTranscriptLine,
  type KbAccessMode,
  type PersistedAgentAnalysisRunResponse,
  type MCPSearchKbInput,
  type MCPGetArticleFamilyInput,
  type MCPGetArticleInput,
  type MCPGetArticleHistoryInput,
  type MCPGetBatchContextInput,
  type MCPGetLocaleVariantInput,
  type MCPGetTemplateInput,
  type MCPAppGetFormSchemaInput,
  type MCPAppPatchFormInput,
  type MCPGetPBISubsetInput,
  type MCPGetPBIInput,
  type MCPListArticleTemplatesInput,
  type MCPListCategoriesInput,
  type MCPListSectionsInput,
  type MCPRecordAgentNotesInput,
  type MCPFindRelatedArticlesInput,
  type AgentStreamingPayload,
  type AgentRunResult,
  normalizeBatchAnalysisWorkerStageBudgetMinutes,
  type BatchAnalysisStageEventDetails,
  type BatchAnalysisIterationRecord,
  type BatchAnalysisQuestion,
  type BatchAnalysisQuestionAnswer,
  type BatchAnalysisQuestionAnswerRequest,
  type BatchAnalysisQuestionAnswerResponse,
  type BatchAnalysisQuestionSet,
  type BatchAnalysisStageRunRecord,
  type BatchAnalysisPlan,
  type BatchAnalysisSessionReusePolicy,
  type BatchDiscoveredWorkItem,
  type BatchPlannerArticleMatch,
  type BatchPlannerArticleMatchResult,
  type BatchPlannerPrefetch,
  type BatchPlannerPrefetchCluster,
  type BatchPlannerRelationEvidence,
  type BatchPlannerRelationMatch,
  type BatchAnalysisStageStatus,
  type BatchPlanReview,
  type ProposalIngestRequest,
  type ProposalReviewDecisionRequest,
  type ProposalReviewDeleteRequest,
  type ProposalReviewBatchListRequest,
  type ProposalReviewSaveWorkingCopyRequest,
  type ProposalReviewDetailResponse,
  ProposalReviewDecision,
  ProposalReviewStatus,
  type ProposalReviewGetRequest,
  type ProposalReviewQueueItem,
  type ProposalReviewListRequest,
  type LocaleVariantRecord,
  type ArticleFamilyRecord,
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
  type TemplatePackUpsertRequest,
  type AiAssistantArtifactDecisionRequest,
  type AiAssistantContextGetResponse,
  type AiAssistantContextPublishRequest,
  type AiAssistantContextGetRequest,
  type AiAssistantMessageSendRequest,
  type AiAssistantPresentationGetResponse,
  type AiAssistantPresentationTransitionRequest,
  type AiAssistantSessionCreateRequest,
  type AiAssistantSessionDeleteRequest,
  type AiAssistantSessionGetRequest,
  type AiAssistantSessionListRequest,
  type AiAssistantSessionOpenRequest,
  type AiAssistantSessionResetRequest,
  type AiAssistantStreamEvent,
  type AppNavigationDispatchRequest,
  type AppNavigationEvent,
  type AppWorkingStatePatchAppliedEvent,
  type AppWorkingStatePatchRequest,
  type AppWorkingStateRegistration,
  type AppWorkingStateSchemaRequest
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
import { AiAssistantService } from './ai-assistant-service';
import { AppWorkingStateService } from './app-working-state-service';
import { AssistantPresentationService } from './assistant-presentation-service';
import { AssistantViewContextService } from './assistant-view-context-service';
import { BatchAnalysisOrchestrator, type BatchFinalReviewerProposalContext } from './batch-analysis-orchestrator';
import { KbActionService } from './kb-action-service';
import { DirectKbExecutor } from './direct-kb-executor';
import type { ArticleRelationsV2RebuildRequest } from './article-relations-v2/types';
import {
  KbAccessModePreflightError,
  requireHealthyKbAccessModeSelection,
  resolveKbAccessModeSelection,
  selectKbAccessMode
} from './kb-access-mode-resolver';
import { applyAppWorkingStatePatch } from './proposal-working-state';

interface RuntimeModelCatalogEntry {
  provider: string;
  name: string;
  aliases: string[];
  costs: AgentRuntimeModelOption['costs'];
}

const RUNTIME_MODEL_CATALOG: RuntimeModelCatalogEntry[] = [
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

const normalizeModelCatalogToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const resolveRuntimeModelOption = (modelId: string): AgentRuntimeModelOption => {
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

const buildRuntimeModelCatalog = (availableModels: string[] | undefined, currentModelId?: string): AgentRuntimeModelOption[] => {
  const orderedModelIds: string[] = [];
  for (const modelId of availableModels ?? []) {
    const normalized = modelId?.trim();
    if (normalized) {
      orderedModelIds.push(normalized);
    }
  }
  if (currentModelId?.trim()) {
    orderedModelIds.unshift(currentModelId.trim());
  }

  const deduped = new Map<string, AgentRuntimeModelOption>();
  for (const modelId of orderedModelIds) {
    const option = resolveRuntimeModelOption(modelId);
    const key = `${normalizeModelCatalogToken(option.provider)}::${normalizeModelCatalogToken(option.name)}`;
    if (!deduped.has(key)) {
      deduped.set(key, option);
    }
  }

  return Array.from(deduped.values());
};

const extractOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined;

const extractOptionalKbAccessMode = (value: unknown): KbAccessMode | undefined =>
  isKbAccessMode(value)
    ? value
    : undefined;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

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
  } catch {
    return [];
  }
};

const normalizePlannerPhrase = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const dedupeStrings = (values: Array<string | undefined | null>): string[] =>
  Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));

const PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX = 'proposal-';
const FINAL_REVIEW_STAGE_TIMEOUT_MS = 180_000;
const FINAL_REVIEW_STAGE_WATCHDOG_MS = 210_000;
const DEFAULT_WORKER_STAGE_TIMEOUT_MS = 300_000;
const DEFAULT_WORKER_STAGE_WATCHDOG_MS = 330_000;
const CONFIGURED_WORKER_STAGE_WATCHDOG_BUFFER_MS = 30_000;

const parseStageTimeoutOverride = (envName: string, fallbackMs: number): number => {
  const raw = process.env[envName]?.trim();
  if (!raw) {
    return fallbackMs;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
};

const getWorkerStageTimeoutMs = (): number =>
  parseStageTimeoutOverride('KBV_WORKER_STAGE_TIMEOUT_MS', DEFAULT_WORKER_STAGE_TIMEOUT_MS);

const getWorkerStageWatchdogMs = (): number =>
  Math.max(
    parseStageTimeoutOverride('KBV_WORKER_STAGE_WATCHDOG_MS', DEFAULT_WORKER_STAGE_WATCHDOG_MS),
    getWorkerStageTimeoutMs() + 5_000
  );

const resolveWorkerStageRunBudget = (configuredBudgetMinutes?: number | null): {
  timeoutMs: number;
  watchdogMs: number;
  budgetMinutes?: number;
} => {
  const normalizedBudgetMinutes = normalizeBatchAnalysisWorkerStageBudgetMinutes(configuredBudgetMinutes);
  if (normalizedBudgetMinutes !== undefined) {
    const timeoutMs = normalizedBudgetMinutes * 60_000;
    return {
      timeoutMs,
      watchdogMs: timeoutMs + CONFIGURED_WORKER_STAGE_WATCHDOG_BUFFER_MS,
      budgetMinutes: normalizedBudgetMinutes
    };
  }
  const timeoutMs = getWorkerStageTimeoutMs();
  return {
    timeoutMs,
    watchdogMs: Math.max(getWorkerStageWatchdogMs(), timeoutMs + 5_000)
  };
};

class BatchStageWatchdogError extends Error {
  constructor(
    readonly stage: string,
    readonly sessionId: string,
    readonly timeoutMs: number
  ) {
    super(`${stage} exceeded the stage watchdog after ${timeoutMs}ms.`);
    this.name = 'BatchStageWatchdogError';
  }
}

const stripHtmlForPromptPreview = (value: string | undefined, maxLength = 240): string | undefined => {
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

const summarizeFinalReviewProposalContext = async (
  workspaceRepository: WorkspaceRepository,
  workspaceId: string,
  proposalId: string
): Promise<BatchFinalReviewerProposalContext | null> => {
  let detail: ProposalReviewDetailResponse;
  try {
    detail = await workspaceRepository.getProposalReviewDetail(workspaceId, proposalId);
  } catch {
    return null;
  }

  const proposal = detail.proposal;
  const [variant, family] = await Promise.all([
    proposal.localeVariantId
      ? workspaceRepository.getLocaleVariant(workspaceId, proposal.localeVariantId).catch(() => null as LocaleVariantRecord | null)
      : Promise.resolve(null as LocaleVariantRecord | null),
    proposal.familyId
      ? workspaceRepository.getArticleFamily(workspaceId, proposal.familyId).catch(() => null as ArticleFamilyRecord | null)
      : Promise.resolve(null as ArticleFamilyRecord | null)
  ]);

  const familyExternalKey = family?.externalKey?.trim();
  const proposalScoped = familyExternalKey?.toLowerCase().startsWith(PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX) ?? false;
  let targetState: BatchFinalReviewerProposalContext['targetState'] = 'unknown';
  let targetStateReason = 'Target could not be deterministically classified from persisted proposal metadata.';

  if (proposalScoped) {
    targetState = proposal.action === ProposalAction.CREATE ? 'net_new_draft_target' : 'proposal_scoped_draft';
    targetStateReason = `Family external key ${familyExternalKey} marks a generated proposal artifact, so it is not live KB coverage.`;
  } else if (proposal.action === ProposalAction.CREATE && !proposal.localeVariantId) {
    targetState = 'net_new_draft_target';
    targetStateReason = 'Net-new proposal without a live locale variant target yet.';
  } else if (variant?.status === RevisionState.LIVE) {
    targetState = 'live_kb_article';
    targetStateReason = `Locale variant ${variant.id} is a live KB target in family ${variant.familyId}.`;
  } else if (variant?.status) {
    targetStateReason = `Locale variant ${variant.id} is currently ${variant.status}, so it should not be treated as live KB without corroborating evidence.`;
  } else if (familyExternalKey) {
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

const buildFinalReviewProposalContext = async (
  workspaceRepository: WorkspaceRepository,
  workspaceId: string,
  workerReport: { executedItems: Array<{ proposalId?: string | null; artifactIds?: string[] | null }> }
): Promise<BatchFinalReviewerProposalContext[]> => {
  const proposalIds = Array.from(
    new Set(
      workerReport.executedItems
        .flatMap((item) => [
          item.proposalId?.trim(),
          ...(item.artifactIds ?? []).map((artifactId) => artifactId.trim())
        ])
        .filter((value): value is string => Boolean(value))
    )
  );
  if (proposalIds.length === 0) {
    return [];
  }

  const snapshots = await Promise.all(
    proposalIds.map((proposalId) => summarizeFinalReviewProposalContext(workspaceRepository, workspaceId, proposalId))
  );
  return snapshots.filter((item): item is BatchFinalReviewerProposalContext => Boolean(item));
};

const inferBatchStageFailureStatus = (error: unknown): 'error' | 'timeout' => {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|watchdog/i.test(message) ? 'timeout' : 'error';
};

const runBatchAnalysisWithStageWatchdog = async (
  agentRuntime: CursorAcpRuntime,
  request: AgentAnalysisRunRequest,
  emit: (payload: AgentStreamingPayload) => Promise<void> | void,
  isCancelled: () => boolean,
  options: {
    stage: string;
    sessionId: string;
    watchdogMs: number;
  }
): Promise<AgentRunResult> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      agentRuntime.runBatchAnalysis(request, emit, isCancelled),
      new Promise<AgentRunResult>((_, reject) => {
        timer = setTimeout(() => {
          agentRuntime.closeSession({ workspaceId: request.workspaceId, sessionId: options.sessionId });
          reject(new BatchStageWatchdogError(options.stage, options.sessionId, options.watchdogMs));
        }, options.watchdogMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const extractPlannerPbiRows = (uploadedPbis: unknown): Array<{
  pbiId: string;
  title: string;
  titlePath: string[];
}> => {
  const rows = Array.isArray(uploadedPbis)
    ? uploadedPbis
    : uploadedPbis && typeof uploadedPbis === 'object' && Array.isArray((uploadedPbis as { rows?: unknown[] }).rows)
      ? (uploadedPbis as { rows: unknown[] }).rows
      : [];

  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') {
        return null;
      }
      const record = row as Record<string, unknown>;
      const title = typeof record.title === 'string' ? record.title.trim() : '';
      const pbiId = typeof record.id === 'string' ? record.id : '';
      const titlePath = [record.title1, record.title2, record.title3]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim());
      if (!pbiId || !title) {
        return null;
      }
      return { pbiId, title, titlePath };
    })
    .filter((row): row is { pbiId: string; title: string; titlePath: string[] } => Boolean(row));
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

const plannerIncludesWord = (value: string, word: string): boolean =>
  normalizePlannerPhrase(value).split(' ').includes(word);

const plannerCombinePathSegments = (...segments: Array<string | undefined>): string =>
  dedupeStrings(segments).join(' ').trim();

const buildPlannerSpecificPhrase = (row: { title: string; titlePath: string[] }): string => {
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

const classifyPlannerSurface = (row: { title: string; titlePath: string[] }): {
  clusterKey: string;
  clusterLabel: string;
  queryCandidates: string[];
} => {
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
    clusterKey: normalizePlannerPhrase(specificPhrase).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `cluster-${randomUUID()}`,
    clusterLabel: specificPhrase,
    queryCandidates: [specificPhrase, ...path]
  };
};

const buildPlannerTopicClusters = (uploadedPbis: unknown): BatchPlannerPrefetchCluster[] => {
  const rows = extractPlannerPbiRows(uploadedPbis);
  const clusters = new Map<string, BatchPlannerPrefetchCluster>();

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

const summarizeRelationEvidence = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      const record = item as { snippet?: unknown; sourceRef?: unknown };
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

const summarizeCoverageEvidence = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      const record = item as { snippet?: unknown; sourceRef?: unknown; evidenceType?: unknown };
      if (typeof record.snippet === 'string' && record.snippet.trim()) {
        return record.snippet.trim();
      }
      if (typeof record.sourceRef === 'string' && record.sourceRef.trim()) {
        return record.sourceRef.trim();
      }
      if (typeof record.evidenceType === 'string' && record.evidenceType.trim()) {
        return record.evidenceType.trim();
      }
      return '';
    })
    .filter(Boolean)
    .slice(0, 3);
};

const normalizePlannerComparableText = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const selectCoverageMatchContext = (result: { evidence?: unknown; relationEligible?: unknown }): string | undefined => {
  const evidence = Array.isArray(result.evidence)
    ? result.evidence as Array<{ evidenceType?: unknown }>
    : [];
  const evidenceTypes = new Set(
    evidence
      .map((item) => typeof item?.evidenceType === 'string' ? item.evidenceType : '')
      .filter(Boolean)
  );

  if (evidenceTypes.has('external_key_exact') || evidenceTypes.has('alias_exact')) {
    return 'metadata';
  }
  if (evidenceTypes.has('title_fts') || evidenceTypes.has('heading_fts')) {
    return 'title';
  }
  if (evidenceTypes.has('explicit_link')) {
    return 'link';
  }
  if (result.relationEligible === true) {
    return 'coverage';
  }

  return undefined;
};

const buildPlannerCoverageDisplay = (
  result: Record<string, unknown>,
  canonicalTitle: string | null
): {
  title: string;
  matchContext?: string;
  snippet: string;
} => {
  const rawTitle = typeof result.title === 'string' && result.title.trim()
    ? result.title.trim()
    : 'Untitled article';
  const title = canonicalTitle?.trim() || rawTitle;
  const matchContext = selectCoverageMatchContext(result);
  const evidenceSnippets = summarizeCoverageEvidence(result.evidence);
  const normalizedRawTitle = normalizePlannerComparableText(rawTitle);
  const normalizedCanonicalTitle = normalizePlannerComparableText(title);
  const titleMismatch = Boolean(
    normalizedRawTitle
    && normalizedCanonicalTitle
    && normalizedRawTitle !== normalizedCanonicalTitle
  );

  if (!titleMismatch) {
    return {
      title,
      matchContext,
      snippet: evidenceSnippets[0] ?? ''
    };
  }

  const safeSnippet = evidenceSnippets.find((snippet) => {
    const normalizedSnippet = normalizePlannerComparableText(snippet);
    return normalizedSnippet && !normalizedSnippet.includes(normalizedRawTitle);
  });

  return {
    title,
    matchContext: matchContext === 'title' ? 'content' : matchContext,
    snippet: safeSnippet ?? `Canonical KB title: ${title}`
  };
};

const normalizePlannerRelationEvidence = (value: unknown): BatchPlannerRelationEvidence[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const record = item as {
        evidenceType?: unknown;
        sourceRef?: unknown;
        snippet?: unknown;
        weight?: unknown;
        metadata?: unknown;
      };
      return {
        evidenceType: typeof record.evidenceType === 'string' ? record.evidenceType : 'unknown',
        sourceRef: typeof record.sourceRef === 'string' ? record.sourceRef : undefined,
        snippet: typeof record.snippet === 'string' ? record.snippet : undefined,
        weight: typeof record.weight === 'number' ? record.weight : 0,
        metadata: record.metadata
      };
    })
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 4);
};

const isPlannerCoverageExpansionCandidate = (result: {
  familyId?: unknown;
  finalScore?: unknown;
  relationEligible?: unknown;
  evidence?: unknown;
}): result is {
  familyId: string;
  finalScore: number;
  relationEligible?: boolean;
  evidence?: unknown;
} => {
  if (typeof result.familyId !== 'string' || !result.familyId.trim()) {
    return false;
  }

  const finalScore = typeof result.finalScore === 'number' ? result.finalScore : 0;
  const matchContext = selectCoverageMatchContext(result);
  return result.relationEligible === true || finalScore >= 1 || matchContext === 'title' || matchContext === 'metadata' || matchContext === 'link';
};

const pickPreferredPlannerLocaleVariantId = (
  variants: LocaleVariantRecord[],
  preferredLocale: string,
  allowedVariantIds: Set<string>
): string => {
  const allowedVariants = allowedVariantIds.size > 0
    ? variants.filter((variant) => allowedVariantIds.has(variant.id))
    : variants;

  const pickVariant = (pool: LocaleVariantRecord[]): LocaleVariantRecord | undefined =>
    pool.find((variant) => !variant.retiredAtUtc && variant.status === RevisionState.LIVE && variant.locale === preferredLocale) ??
    pool.find((variant) => !variant.retiredAtUtc && variant.status === RevisionState.LIVE) ??
    pool.find((variant) => !variant.retiredAtUtc && variant.locale === preferredLocale) ??
    pool.find((variant) => !variant.retiredAtUtc) ??
    pool.find((variant) => variant.status === RevisionState.LIVE && variant.locale === preferredLocale) ??
    pool.find((variant) => variant.status === RevisionState.LIVE) ??
    pool.find((variant) => variant.locale === preferredLocale) ??
    pool[0];

  return (
    pickVariant(allowedVariants)?.id ??
    pickVariant(variants)?.id ??
    Array.from(allowedVariantIds)[0] ??
    ''
  );
};

const mapPlannerRelationMatches = (
  relationResponses: Array<{ seedFamilyId: string; relations: Array<Record<string, unknown>> }>
): BatchPlannerRelationMatch[] => {
  const matchesByFamilyId = new Map<string, BatchPlannerRelationMatch>();

  for (const response of relationResponses) {
    for (const relation of response.relations) {
      const sourceFamily = asRecord((relation as { sourceFamily?: unknown }).sourceFamily);
      const targetFamily = asRecord((relation as { targetFamily?: unknown }).targetFamily);
      const sourceFamilyId = typeof sourceFamily?.id === 'string' ? sourceFamily.id : undefined;
      const targetFamilyId = typeof targetFamily?.id === 'string' ? targetFamily.id : undefined;
      const counterpart =
        sourceFamilyId === response.seedFamilyId
          ? targetFamily
          : targetFamilyId === response.seedFamilyId
            ? sourceFamily
            : targetFamily ?? sourceFamily;

      const familyId = typeof counterpart?.id === 'string' ? counterpart.id.trim() : '';
      const title = typeof counterpart?.title === 'string' ? counterpart.title.trim() : '';
      if (!familyId || !title) {
        continue;
      }

      const typedEvidence = normalizePlannerRelationEvidence((relation as { evidence?: unknown }).evidence);
      const nextMatch: BatchPlannerRelationMatch = {
        title,
        familyId,
        strengthScore: typeof relation.strengthScore === 'number' ? relation.strengthScore : 0,
        relationType: typeof relation.relationType === 'string' ? relation.relationType : 'related',
        evidence: summarizeRelationEvidence((relation as { evidence?: unknown }).evidence),
        relationEligible: true,
        typedEvidence
      };

      const existing = matchesByFamilyId.get(familyId);
      if (!existing || nextMatch.strengthScore > existing.strengthScore) {
        matchesByFamilyId.set(familyId, nextMatch);
      }
    }
  }

  return Array.from(matchesByFamilyId.values())
    .sort((left, right) => right.strengthScore - left.strengthScore || left.title.localeCompare(right.title))
    .slice(0, 12);
};

const buildPlannerPrefetch = async (
  workspaceRepository: WorkspaceRepository,
  workspaceId: string,
  batchId: string,
  uploadedPbis: unknown
): Promise<BatchPlannerPrefetch> => {
  const topicClusters = buildPlannerTopicClusters(uploadedPbis);
  const workspaceSettingsPromise = workspaceRepository.getWorkspaceSettings(workspaceId).catch(() => null);
  const familyVariantsByFamilyId = new Map<string, Promise<LocaleVariantRecord[]>>();
  const familyTitlesByFamilyId = new Map<string, Promise<string | null>>();
  const getFamilyVariants = (familyId: string): Promise<LocaleVariantRecord[]> => {
    const normalizedFamilyId = familyId.trim();
    if (!normalizedFamilyId) {
      return Promise.resolve([]);
    }

    const existing = familyVariantsByFamilyId.get(normalizedFamilyId);
    if (existing) {
      return existing;
    }

    const next = workspaceRepository.getLocaleVariantsForFamily(workspaceId, normalizedFamilyId).catch(() => []);
    familyVariantsByFamilyId.set(normalizedFamilyId, next);
    return next;
  };
  const getCanonicalFamilyTitle = (familyId: string): Promise<string | null> => {
    const normalizedFamilyId = familyId.trim();
    if (!normalizedFamilyId) {
      return Promise.resolve(null);
    }

    const existing = familyTitlesByFamilyId.get(normalizedFamilyId);
    if (existing) {
      return existing;
    }

    const repositoryWithFamilyLookup = workspaceRepository as WorkspaceRepository & {
      getArticleFamily?: (workspaceId: string, familyId: string) => Promise<{ title?: string }>;
    };
    const next = typeof repositoryWithFamilyLookup.getArticleFamily === 'function'
      ? repositoryWithFamilyLookup
        .getArticleFamily(workspaceId, normalizedFamilyId)
        .then((family) => typeof family?.title === 'string' && family.title.trim() ? family.title.trim() : null)
        .catch(() => null)
      : Promise.resolve(null);
    familyTitlesByFamilyId.set(normalizedFamilyId, next);
    return next;
  };
  const resolvePlannerCoverageLocaleVariantId = async (result: Record<string, unknown>): Promise<string> => {
    const familyId = typeof result.familyId === 'string' ? result.familyId.trim() : '';
    const allowedVariantIds = new Set(
      Array.isArray(result.localeVariantIds)
        ? dedupeStrings(result.localeVariantIds.filter((value): value is string => typeof value === 'string'))
        : []
    );
    if (!familyId) {
      return Array.from(allowedVariantIds)[0] ?? '';
    }

    const [workspaceSettings, familyVariants] = await Promise.all([
      workspaceSettingsPromise,
      getFamilyVariants(familyId)
    ]);
    return pickPreferredPlannerLocaleVariantId(
      familyVariants,
      workspaceSettings?.defaultLocale ?? '',
      allowedVariantIds
    );
  };
  const [inspection, articleMatchResponses] = await Promise.all([
    workspaceRepository.getBatchAnalysisInspection(workspaceId, batchId).catch(() => null),
    Promise.all(
      topicClusters.slice(0, 12).flatMap((cluster) =>
        cluster.queries.slice(0, 4).map(async (query) => {
          const coverage = await workspaceRepository.queryArticleRelationCoverage({
            workspaceId,
            query,
            maxResults: 5,
            minScore: 0.08,
            includeEvidence: true
          }).catch(() => ({ results: [] as Array<Record<string, unknown>> }));

          const results = Array.isArray((coverage as { results?: unknown[] }).results)
            ? (coverage as { results: Array<Record<string, unknown>> }).results
            : [];
          const topResults: BatchPlannerArticleMatchResult[] = await Promise.all(results.slice(0, 3).map(async (result) => {
            const familyId = typeof result.familyId === 'string' ? result.familyId : '';
            const canonicalTitle = familyId
              ? await getCanonicalFamilyTitle(familyId)
              : null;
            const display = buildPlannerCoverageDisplay(result, canonicalTitle);

            return {
              title: display.title,
              familyId,
              localeVariantId: await resolvePlannerCoverageLocaleVariantId(result),
              score: typeof result.finalScore === 'number' ? result.finalScore : 0,
              matchContext: display.matchContext,
              snippet: display.snippet
            };
          }));

          return {
            articleMatch: {
              clusterId: cluster.clusterId,
              query,
              total: results.length,
              topResults
            } satisfies BatchPlannerArticleMatch,
            expansionFamilyIds: results
              .filter(isPlannerCoverageExpansionCandidate)
              .map((result) => result.familyId)
              .slice(0, 3)
          };
        })
      )
    )
  ]);

  const articleMatches = articleMatchResponses.map((response) => response.articleMatch);
  const relationSeedFamilyIds = dedupeStrings(
    articleMatchResponses.flatMap((response) => response.expansionFamilyIds)
  ).slice(0, 12);
  const relationResponses = await Promise.all(
    relationSeedFamilyIds.map(async (seedFamilyId) => ({
      seedFamilyId,
      relations: (
        await workspaceRepository.listArticleRelations(workspaceId, {
          workspaceId,
          familyId: seedFamilyId,
          limit: 6,
          minScore: 0.35,
          includeEvidence: true
        }).catch(() => ({ relations: [] }))
      ).relations as Array<Record<string, unknown>>
    }))
  );

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
    relationMatches: mapPlannerRelationMatches(relationResponses)
  };
};

const dedupeResultTextCandidates = (values: string[]): string[] => {
  const candidates = new Set<string>();
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

const extractResultTextCandidates = (payload: unknown): string[] => {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const record = payload as {
    finalText?: unknown;
    text?: unknown;
    streamedText?: unknown;
    content?: Array<{ type?: string; text?: string }>;
  };
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

type BatchAnalysisResultShape = 'planner' | 'plan_review' | 'worker' | 'final_review';

type DirectBatchEnvelopeInspection =
  | { kind: 'needs_action' }
  | { kind: 'terminal'; completionState: 'blocked' | 'needs_user_input' | 'errored' };

type BatchAnalysisDevBuildPair = {
  label: string;
  sourceRelativePath: string;
  buildRelativePath: string;
};

const BATCH_ANALYSIS_DEV_BUILD_PAIRS: BatchAnalysisDevBuildPair[] = [
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

const statMtimeMs = async (filePath: string): Promise<number | null> => {
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch {
    return null;
  }
};

const evaluateBatchAnalysisDevBuildFreshness = async (
  repoRoot: string,
  pairs: BatchAnalysisDevBuildPair[] = BATCH_ANALYSIS_DEV_BUILD_PAIRS
): Promise<{
  stale: boolean;
  message?: string;
  stalePairs: Array<{
    label: string;
    sourcePath: string;
    buildPath: string;
  }>;
}> => {
  const stalePairs: Array<{
    label: string;
    sourcePath: string;
    buildPath: string;
  }> = [];
  let discoveredSourceCount = 0;

  for (const pair of pairs) {
    const sourcePath = path.join(repoRoot, pair.sourceRelativePath);
    const buildPath = path.join(repoRoot, pair.buildRelativePath);
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
    .map((pair) => `${pair.label} (${path.relative(repoRoot, pair.sourcePath)} > ${path.relative(repoRoot, pair.buildPath)})`)
    .join('; ');

  return {
    stale: true,
    message: `Batch analyzation is running against a stale desktop main build. Restart the desktop dev process before running it again. Newer source files were detected: ${examples}.`,
    stalePairs
  };
};

const getBatchAnalysisDevBuildFreshnessMessage = async (): Promise<string | null> => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
  const freshness = await evaluateBatchAnalysisDevBuildFreshness(repoRoot);
  return freshness.stale ? freshness.message ?? 'Batch analyzation is running against a stale desktop main build.' : null;
};

const matchesExpectedBatchResultShape = (
  parsed: Record<string, unknown>,
  expectedShape?: BatchAnalysisResultShape
): boolean => {
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

const inspectDirectBatchEnvelope = (candidate: string): DirectBatchEnvelopeInspection | null => {
  const extracted = extractJsonObject(candidate);
  if (!extracted) {
    return null;
  }

  const completionState = typeof extracted.completionState === 'string'
    ? extracted.completionState.trim().toLowerCase()
    : '';
  if (
    completionState === 'needs_action'
    && extracted.isFinal === false
    && extracted.action
    && typeof extracted.action === 'object'
  ) {
    return { kind: 'needs_action' };
  }
  if (
    extracted.isFinal === true
    && (completionState === 'blocked' || completionState === 'needs_user_input' || completionState === 'errored')
  ) {
    return {
      kind: 'terminal',
      completionState
    };
  }
  return null;
};

const scoreResultTextCandidate = (candidate: string, expectedShape?: BatchAnalysisResultShape): number => {
  const trimmed = candidate.trim();
  if (!trimmed) {
    return -1;
  }
  const extracted = extractJsonObject(trimmed);
  if (extracted && matchesExpectedBatchResultShape(extracted, expectedShape)) {
    return 10_000 + trimmed.length;
  }

  let score = trimmed.length;
  const directEnvelope = inspectDirectBatchEnvelope(trimmed);
  if (expectedShape === 'worker' && directEnvelope?.kind === 'terminal') {
    return 9_500 + trimmed.length;
  }
  if (expectedShape && !trimmed.includes('{')) {
    score -= 1_500;
  }
  if (expectedShape === 'worker' && directEnvelope?.kind === 'needs_action') {
    score -= 6_000;
  }
  if (
    expectedShape
    && !trimmed.includes('{')
    && /^(reviewing|checking|searching|probing|let me|i['’]m)\b/i.test(trimmed)
  ) {
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

const selectBestResultText = (candidates: string[], expectedShape?: BatchAnalysisResultShape): string => {
  if (candidates.length === 0) {
    return '';
  }
  return [...candidates]
    .sort((left, right) => scoreResultTextCandidate(right, expectedShape) - scoreResultTextCandidate(left, expectedShape))[0] ?? '';
};

const selectBestParseableResultText = (candidates: string[], expectedShape?: BatchAnalysisResultShape): string => {
  const parseableCandidates = candidates.filter((candidate) => {
    const extracted = extractJsonObject(candidate);
    return Boolean(extracted && matchesExpectedBatchResultShape(extracted, expectedShape));
  });
  if (parseableCandidates.length === 0) {
    return '';
  }

  const pureJsonCandidates = parseableCandidates.filter((candidate) => candidate.trim().startsWith('{'));
  return selectBestResultText(
    pureJsonCandidates.length > 0 ? pureJsonCandidates : parseableCandidates,
    expectedShape
  );
};

const collapseRepeatedTranscriptText = (value: string): string => {
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

const findTranscriptChunkOverlap = (left: string, right: string): number => {
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

const getLastTranscriptSequence = (lines: AgentTranscriptLine[]): number => {
  const sequenced = lines
    .map((line) => (typeof line.seq === 'number' ? line.seq : Number.NEGATIVE_INFINITY))
    .filter((seq) => Number.isFinite(seq));
  if (sequenced.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  return Math.max(...sequenced);
};

const shouldAwaitMoreStructuredBatchResult = (params: {
  text: string;
  expectedShape?: BatchAnalysisResultShape;
  parseable: boolean;
  initialCandidateCount: number;
  transcriptCandidateCount: number;
  recoveryAbortReason?: string;
}): boolean => {
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
  if (params.expectedShape === 'worker' && inspectDirectBatchEnvelope(trimmed)?.kind === 'terminal') {
    return false;
  }
  return (
    looksLikeStructuredBatchResultText(trimmed, params.expectedShape)
    || /^(reviewing|checking|searching|finding|looking|investigating)\b/i.test(trimmed)
    || /^i['’]m\s+(reviewing|checking|searching|finding|looking|investigating)\b/i.test(trimmed)
  );
};

const isStructuredBatchRecoveryAbortReason = (
  reason: string | undefined,
  expectedShape?: BatchAnalysisResultShape
): boolean => {
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

const extractStructuredBatchRecoveryAbortReason = (
  lines: AgentTranscriptLine[],
  expectedShape?: BatchAnalysisResultShape
): string | undefined => {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line || line.event !== 'prompt_abort' || typeof line.payload !== 'string') {
      continue;
    }
    try {
      const payload = JSON.parse(line.payload) as { reason?: unknown };
      const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
      if (reason && isStructuredBatchRecoveryAbortReason(reason, expectedShape)) {
        return reason;
      }
    } catch {
      continue;
    }
  }
  return undefined;
};

const appendTranscriptChunk = (chunks: string[], chunk: string): void => {
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

const looksLikeStructuredBatchResultText = (
  text: string,
  expectedShape: BatchAnalysisResultShape
): boolean => {
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

const shouldRetryReviewWithFreshSession = (resolution: {
  text: string;
  initialCandidateCount: number;
  transcriptCandidateCount: number;
  parseable: boolean;
}): boolean => {
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
  constructor(
    message: string,
    readonly terminalStage: BatchAnalysisIterationRecord['stage'],
    readonly terminalStatus: BatchAnalysisIterationRecord['status']
  ) {
    super(message);
    this.name = 'BatchAnalysisTerminalError';
  }
}

const PLAN_HUMAN_REVIEW_GUIDANCE = 'Review the batch plan and plan-review delta in Batch Analysis; no proposal review items were created.';

const buildPlanHumanReviewMessage = (summary?: string): string => {
  const trimmed = summary?.trim();
  if (!trimmed) {
    return `Batch plan requires human review before execution. ${PLAN_HUMAN_REVIEW_GUIDANCE}`;
  }
  return /[.!?]$/.test(trimmed)
    ? `${trimmed} ${PLAN_HUMAN_REVIEW_GUIDANCE}`
    : `${trimmed}. ${PLAN_HUMAN_REVIEW_GUIDANCE}`;
};

const detectBatchInfrastructureFailureText = (text: string): { message: string; code?: string } | null => {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('```')) {
    return null;
  }

  const normalized = trimmed.toLowerCase();
  const looksLikeExplicitError =
    /^error\b/i.test(trimmed)
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

const detectPlannerInfrastructureFailure = (
  resultStatus: AgentRunResult['status'],
  resolution: {
    text: string;
    parseable: boolean;
    recoveryAbortReason?: string;
  }
): { message: string; code?: string } | null => {
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

const shouldRetryPlannerWithFreshSession = (resolution: {
  text: string;
  initialCandidateCount: number;
  transcriptCandidateCount: number;
  parseable: boolean;
}): boolean => {
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

const plannerOutputLooksStructuredButIncomplete = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  return trimmed.startsWith('{')
    || trimmed.startsWith('```json')
    || trimmed.includes('"coverage"')
    || trimmed.includes('"items"');
};

const normalizeRecoveredJsonText = (text: string): string | null => {
  const extracted = extractJsonObject(text);
  return extracted ? JSON.stringify(extracted) : null;
};

const extractJsonStringField = (text: string, fieldName: string): string | null => {
  const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`"${escapedField}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 's').exec(text);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1];
  }
};

const extractJsonBooleanField = (text: string, fieldName: string): boolean | null => {
  const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`"${escapedField}"\\s*:\\s*(true|false)`, 's').exec(text);
  if (!match) {
    return null;
  }
  return match[1] === 'true';
};

const findJsonArrayStart = (text: string, fieldName: string): number => {
  const escapedField = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`"${escapedField}"\\s*:\\s*\\[`, 's').exec(text);
  return match ? match.index + match[0].length - 1 : -1;
};

const extractCompleteJsonObjectsFromArray = (text: string, fieldName: string): Record<string, unknown>[] => {
  const arrayStart = findJsonArrayStart(text, fieldName);
  if (arrayStart < 0) {
    return [];
  }

  const results: Record<string, unknown>[] = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let objectStart = -1;

  for (let index = arrayStart + 1; index < text.length; index += 1) {
    const char = text[index];

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
        objectStart = index;
      }
      depth += 1;
      continue;
    }

    if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        try {
          const parsed = JSON.parse(text.slice(objectStart, index + 1)) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            results.push(parsed as Record<string, unknown>);
          }
        } catch {
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

const extractCompleteJsonStringsFromArray = (text: string, fieldName: string): string[] => {
  const arrayStart = findJsonArrayStart(text, fieldName);
  if (arrayStart < 0) {
    return [];
  }

  const results: string[] = [];
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
          results.push(JSON.parse(text.slice(stringStart, index + 1)) as string);
        } catch {
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

const extractRecoveredQuestionsFromText = (text: string): Array<Record<string, unknown>> => {
  const structured = extractCompleteJsonObjectsFromArray(text, 'questions')
    .filter((question) => typeof question.prompt === 'string');
  if (structured.length > 0) {
    return structured;
  }
  return extractCompleteJsonStringsFromArray(text, 'openQuestions')
    .map((prompt) => ({
      prompt,
      reason: 'Recovered legacy open question.',
      requiresUserInput: true,
      linkedPbiIds: [],
      linkedPlanItemIds: [],
      linkedDiscoveryIds: []
    }));
};

const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const normalizeRecoveredPlannerTargetId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return UUID_LIKE_PATTERN.test(trimmed) ? trimmed : undefined;
};

const recoveredPlannerItemLooksLikeCreate = (item: Record<string, unknown>): boolean => {
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

const salvagePlannerJsonText = (text: string): string | null => {
  const summary = extractJsonStringField(text, 'summary');
  const rawCoverage = extractCompleteJsonObjectsFromArray(text, 'coverage');
  const rawItems = extractCompleteJsonObjectsFromArray(text, 'items');
  const questions = extractRecoveredQuestionsFromText(text);

  const items: Array<Record<string, unknown> & { planItemId: string; dependsOn: string[] }> = rawItems
    .filter((item) =>
      typeof item.planItemId === 'string'
      && Array.isArray(item.pbiIds)
      && typeof item.action === 'string'
      && typeof item.targetType === 'string'
      && typeof item.targetTitle === 'string'
      && typeof item.reason === 'string'
    )
    .map((item) => {
      const rawAction = typeof item.action === 'string' ? item.action : 'no_impact';
      const retainedTargetArticleId = normalizeRecoveredPlannerTargetId(item.targetArticleId);
      const retainedTargetFamilyId = normalizeRecoveredPlannerTargetId(item.targetFamilyId);
      const hasRetainedArticleTarget = Boolean(retainedTargetArticleId || retainedTargetFamilyId);
      const promoteToCreate =
        rawAction === 'no_impact'
        && !hasRetainedArticleTarget
        && recoveredPlannerItemLooksLikeCreate(item);
      const action =
        rawAction === 'create' || rawAction === 'edit' || rawAction === 'retire' || rawAction === 'no_impact'
          ? rawAction
          : 'no_impact';
      const normalizedAction = promoteToCreate ? 'create' : action;
      const rawTargetType = typeof item.targetType === 'string' ? item.targetType : 'unknown';
      const targetType =
        normalizedAction === 'create'
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
        planItemId: item.planItemId as string,
        pbiIds: (item.pbiIds as unknown[]).filter((value): value is string => typeof value === 'string'),
        action: normalizedAction,
        targetType,
        ...(retainedTargetArticleId ? { targetArticleId: retainedTargetArticleId } : {}),
        ...(retainedTargetFamilyId ? { targetFamilyId: retainedTargetFamilyId } : {}),
        targetTitle: item.targetTitle,
        reason: item.reason,
        evidence: Array.isArray(item.evidence)
          ? (item.evidence as Array<Record<string, unknown>>).filter((evidence) =>
              evidence
              && typeof evidence === 'object'
              && typeof evidence.kind === 'string'
              && typeof evidence.ref === 'string'
              && typeof evidence.summary === 'string'
            )
          : [],
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
        dependsOn: Array.isArray(item.dependsOn)
          ? (item.dependsOn as unknown[]).filter((value): value is string => typeof value === 'string')
          : [],
        executionStatus: typeof item.executionStatus === 'string' ? item.executionStatus : 'pending'
      } as Record<string, unknown> & { planItemId: string; dependsOn: string[] };
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
        ? (entry.planItemIds as unknown[]).filter((value): value is string => typeof value === 'string' && itemIds.has(value))
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
    questions,
    openQuestions: questions.map((question) => question.prompt).filter((prompt): prompt is string => typeof prompt === 'string')
  });
};

const summarizePlannerRecoveryContext = (text: string): string => {
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
  const questions = extractRecoveredQuestionsFromText(normalized).slice(0, 12);

  if (summary || coverage.length > 0 || items.length > 0 || questions.length > 0) {
    return JSON.stringify({
      summary: summary ?? 'Recovered partial planner draft context.',
      coverage,
      items,
      questions,
      openQuestions: questions.map((question) => question.prompt).filter((prompt): prompt is string => typeof prompt === 'string')
    }, null, 2);
  }

  return normalized.slice(0, 6_000);
};

const salvagePlanReviewJsonText = (text: string): string | null => {
  const normalized = normalizeRecoveredJsonText(text);
  if (normalized) {
    const parsed = extractJsonObject(normalized);
    if (parsed && matchesExpectedBatchResultShape(parsed, 'plan_review')) {
      return normalized;
    }
  }

  const summary = extractJsonStringField(text, 'summary');
  const verdict = extractJsonStringField(text, 'verdict');
  const questions = extractRecoveredQuestionsFromText(text);
  const requestedChanges = extractCompleteJsonStringsFromArray(text, 'requestedChanges');
  const missingPbiIds = extractCompleteJsonStringsFromArray(text, 'missingPbiIds');
  const missingCreates = extractCompleteJsonStringsFromArray(text, 'missingCreates');
  const missingEdits = extractCompleteJsonStringsFromArray(text, 'missingEdits');
  const additionalArticleWork = extractCompleteJsonStringsFromArray(text, 'additionalArticleWork');
  const targetCorrections = extractCompleteJsonStringsFromArray(text, 'targetCorrections');
  const overlapConflicts = extractCompleteJsonStringsFromArray(text, 'overlapConflicts');

  const hasAnyStructuredSignal =
    typeof summary === 'string'
    || typeof verdict === 'string'
    || requestedChanges.length > 0
    || missingPbiIds.length > 0
    || missingCreates.length > 0
    || missingEdits.length > 0
    || additionalArticleWork.length > 0
    || targetCorrections.length > 0
    || overlapConflicts.length > 0
    || questions.length > 0;

  if (!hasAnyStructuredSignal) {
    return null;
  }

  return JSON.stringify({
    summary: summary ?? 'Recovered plan review output from truncated response.',
    verdict: verdict === 'approved' || verdict === 'needs_human_review' || verdict === 'needs_user_input' ? verdict : 'needs_revision',
    didAccountForEveryPbi: extractJsonBooleanField(text, 'didAccountForEveryPbi') ?? false,
    hasMissingCreates: extractJsonBooleanField(text, 'hasMissingCreates') ?? (missingCreates.length > 0),
    hasMissingEdits: extractJsonBooleanField(text, 'hasMissingEdits') ?? (missingEdits.length > 0),
    hasTargetIssues: extractJsonBooleanField(text, 'hasTargetIssues') ?? (targetCorrections.length > 0),
    hasOverlapOrConflict: extractJsonBooleanField(text, 'hasOverlapOrConflict') ?? (overlapConflicts.length > 0),
    foundAdditionalArticleWork: extractJsonBooleanField(text, 'foundAdditionalArticleWork') ?? (additionalArticleWork.length > 0),
    underScopedKbImpact: extractJsonBooleanField(text, 'underScopedKbImpact') ?? (
      missingCreates.length > 0
      || missingEdits.length > 0
      || additionalArticleWork.length > 0
    ),
    questions,
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

const buildMalformedPlanReviewFallback = (
  summary: string,
  verdict: 'needs_revision' | 'needs_user_input' | 'needs_human_review' = 'needs_human_review'
): string =>
  JSON.stringify({
    summary,
    verdict,
    didAccountForEveryPbi: false,
    hasMissingCreates: false,
    hasMissingEdits: false,
    hasTargetIssues: false,
    hasOverlapOrConflict: false,
    foundAdditionalArticleWork: false,
    underScopedKbImpact: false,
    questions: [],
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

const buildMalformedFinalReviewFallback = (summary: string): string =>
  JSON.stringify({
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

const buildStageEventTextPreview = (value: string | undefined, limit = STAGE_EVENT_TEXT_PREVIEW_LIMIT): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
};

const isPromptRequestTranscriptLine = (line: AgentTranscriptLine): boolean => {
  if (line.direction !== 'to_agent' || line.event !== 'request') {
    return false;
  }
  try {
    const parsed = JSON.parse(line.payload) as { method?: unknown };
    return parsed.method === 'session/prompt';
  } catch {
    return false;
  }
};

const extractTranscriptResultTextCandidates = (
  lines: AgentTranscriptLine[],
  scope: 'latest_request' | 'all' = 'latest_request'
): string[] => {
  const relevantLines =
    scope === 'all'
      ? lines
      : (() => {
          const reversedIndex = [...lines].reverse().findIndex(
            (line) => isPromptRequestTranscriptLine(line)
          );
          if (reversedIndex < 0) {
            return lines;
          }
          const lastRequestIndex = lines.length - reversedIndex - 1;
          return lines.slice(lastRequestIndex + 1);
        })();
  const chunkParts: string[] = [];
  const rawChunkParts: string[] = [];
  const candidates: string[] = [];

  for (const line of relevantLines) {
    if (line.direction !== 'from_agent') {
      continue;
    }

    if (line.event === 'response') {
      try {
        const parsed = JSON.parse(line.payload) as { result?: unknown };
        candidates.push(...extractResultTextCandidates(parsed.result));
      } catch {
        // ignore malformed transcript response lines
      }
      continue;
    }

    if (line.event === 'session_update') {
      try {
        const parsed = JSON.parse(line.payload) as {
          update?: {
            sessionUpdate?: string;
            content?: { text?: string };
          };
        };
        if (parsed.update?.sessionUpdate === 'agent_message_chunk' && typeof parsed.update.content?.text === 'string') {
          rawChunkParts.push(parsed.update.content.text);
          appendTranscriptChunk(chunkParts, parsed.update.content.text);
        }
      } catch {
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

const extractResultText = (payload: unknown): string =>
  selectBestResultText(extractResultTextCandidates(payload));

export const __commandRegistryTestables = {
  buildPlannerTopicClusters,
  buildPlannerPrefetch,
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
  shouldRetryReviewWithFreshSession,
  shouldAwaitMoreStructuredBatchResult,
  inspectDirectBatchEnvelope
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
  const normalizedCandidates = [
    trimmed,
    trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '')
  ];
  const parsedCandidates: Array<{ score: number; value: Record<string, unknown> }> = [];

  const scoreCandidate = (value: Record<string, unknown>): number => {
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

  const balancedCandidates = (value: string): string[] => {
    const candidates: string[] = [];
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
        const parsed = JSON.parse(jsonCandidate) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsedCandidates.push({
            score: scoreCandidate(parsed as Record<string, unknown>),
            value: parsed as Record<string, unknown>
          });
        }
      } catch {
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

const resolveBatchAnalysisResultText = async (
  agentRuntime: CursorAcpRuntime,
  workspaceId: string,
  sessionId: string | undefined,
  payload: unknown,
  expectedShape?: BatchAnalysisResultShape
): Promise<{
  text: string;
  usedTranscript: boolean;
  initialCandidateCount: number;
  transcriptCandidateCount: number;
  parseable: boolean;
  recoveryAbortReason?: string;
}> => {
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
  let transcriptCandidates =
    latestTranscriptCandidates.length > 0
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

    while (
      Date.now() - waitStartedAt < maxWaitMs
      && Date.now() - lastTranscriptChangeAt < idleMs
      && !parseable
    ) {
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

const summarizeWorkerExecutionFallback = (
  fallbackSummary: string,
  proposalQueue: ProposalReviewQueueItem[]
): string => {
  if (proposalQueue.length === 0) {
    return fallbackSummary;
  }

  const actionCounts = proposalQueue.reduce<Record<string, number>>((counts, proposal) => {
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

export function registerCoreCommands(
  bus: CommandBus,
  jobs: JobRegistry,
  workspaceRoot: string,
  emitAppWorkingStateEvent?: (event: AppWorkingStatePatchAppliedEvent) => void,
  emitAiAssistantEvent?: (event: AiAssistantStreamEvent) => void,
  assistantPresentationService?: AssistantPresentationService,
  assistantViewContextService?: AssistantViewContextService,
  dispatchAppNavigation?: (event: AppNavigationEvent) => void
) {
  const workspaceRepository = new WorkspaceRepository(workspaceRoot);
  const batchAnalysisOrchestrator = new BatchAnalysisOrchestrator(workspaceRepository);
  const zendeskSyncService = new ZendeskSyncService(workspaceRepository);
  const pbiBatchImportService = new PBIBatchImportService(workspaceRepository);
  const defaultKbAccessMode: KbAccessMode = 'direct';
  const validRevisionStates = new Set(Object.values(RevisionState));
  const validRevisionStatuses = new Set(Object.values(RevisionStatus));
  const validPBIScopeModes = new Set([PBIBatchScopeMode.ALL, PBIBatchScopeMode.SELECTED_ONLY]);
  const validPBIBatchStatuses = new Set(Object.values(PBIBatchStatus));
  const validPBIValidationStatuses = new Set(Object.values(PBIValidationStatus));
  const validPBILibraryScopeStates = new Set<PBILibraryScopeState>(['in_scope', 'out_of_scope', 'not_eligible']);
  const validPBILibrarySortFields = new Set([
    'importedAtUtc',
    'externalId',
    'title',
    'workItemType',
    'priority',
    'validationStatus',
    'scopeState',
    'batchName',
    'proposalCount'
  ]);
  const validDraftBranchStatuses = new Set(Object.values(DraftBranchStatus));
  const appWorkingStateService = new AppWorkingStateService((event) => emitAppWorkingStateEvent?.(event));
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
  const kbActionService = new KbActionService({
    workspaceRepository,
    appWorkingStateService,
    buildZendeskClient
  });
  const directKbExecutor = new DirectKbExecutor({ kbActionService });
  const batchAnalysisAutoResumeLocks = new Set<string>();
  const scheduleBatchAnalysisAutoResume = (workspaceId: string, batchId: string, questionSetId: string): boolean => {
    const lockKey = `${workspaceId}:${batchId}:${questionSetId}`;
    if (batchAnalysisAutoResumeLocks.has(lockKey)) {
      return false;
    }
    batchAnalysisAutoResumeLocks.add(lockKey);
    void jobs.start('agent.analysis.run', {
      workspaceId,
      batchId
    }).catch((error) => {
      logger.error('[batch.analysis.questions.answer] automatic resume failed', {
        workspaceId,
        batchId,
        questionSetId,
        error: error instanceof Error ? error.message : String(error)
      });
    }).finally(() => {
      batchAnalysisAutoResumeLocks.delete(lockKey);
    });
    return true;
  };
  type ProposalToolContext = Parameters<AgentRuntimeToolContext['proposeCreateKb']>[1];
  const runtimeToolContext: AgentRuntimeToolContext = {
    searchKb: async (input: MCPSearchKbInput) => kbActionService.searchKb(input),
    getExplorerTree: async (workspaceId: string) => kbActionService.getExplorerTree(workspaceId),
    getArticle: async (input: MCPGetArticleInput) => kbActionService.getArticle(input),
    getArticleFamily: async (input: MCPGetArticleFamilyInput) => kbActionService.getArticleFamily(input),
    getLocaleVariant: async (input: MCPGetLocaleVariantInput) => kbActionService.getLocaleVariant(input),
    getAppFormSchema: async (input: MCPAppGetFormSchemaInput) => kbActionService.getAppFormSchema(input),
    patchAppForm: async (input: MCPAppPatchFormInput) => kbActionService.patchAppForm(input),
    findRelatedArticles: async (input: MCPFindRelatedArticlesInput) => kbActionService.findRelatedArticles(input),
    listCategories: async (input: MCPListCategoriesInput) => kbActionService.listCategories(input),
    listSections: async (input: MCPListSectionsInput) => kbActionService.listSections(input),
    listArticleTemplates: async (input: MCPListArticleTemplatesInput) => kbActionService.listArticleTemplates(input),
    getTemplate: async (input: MCPGetTemplateInput) => kbActionService.getTemplate(input),
    getBatchContext: async (input: MCPGetBatchContextInput) => kbActionService.getBatchContext(input),
    getPBI: async (input: MCPGetPBIInput) => kbActionService.getPBI(input),
    getPBISubset: async (input: MCPGetPBISubsetInput) => kbActionService.getPBISubset(input),
    getArticleHistory: async (input: MCPGetArticleHistoryInput) => kbActionService.getArticleHistory(input),
    recordAgentNotes: async (input: MCPRecordAgentNotesInput) => kbActionService.recordAgentNotes(input),
    proposeCreateKb: async (input: MCPRecordAgentNotesInput, context: ProposalToolContext) => {
      if (!context.workspaceId) {
        throw new Error('workspaceId is required');
      }
      const batchId = input.batchId || context.batchId || '';
      const sessionId = input.sessionId || context.sessionId || '';
      if (!batchId) {
        throw new Error('batchId is required for create proposal');
      }
      const reviewStatus = context.batchId ? ProposalReviewStatus.STAGED_ANALYSIS : ProposalReviewStatus.PENDING_REVIEW;
      const created = await kbActionService.createProposal({
        workspaceId: context.workspaceId,
        batchId,
        action: ProposalAction.CREATE,
        reviewStatus,
        sessionId,
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
      const reviewStatus = context.batchId ? ProposalReviewStatus.STAGED_ANALYSIS : ProposalReviewStatus.PENDING_REVIEW;
      const created = await kbActionService.createProposal({
        workspaceId: context.workspaceId,
        batchId,
        action: ProposalAction.EDIT,
        reviewStatus,
        sessionId,
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
      const reviewStatus = context.batchId ? ProposalReviewStatus.STAGED_ANALYSIS : ProposalReviewStatus.PENDING_REVIEW;
      const created = await kbActionService.createProposal({
        workspaceId: context.workspaceId,
        batchId,
        action: ProposalAction.RETIRE,
        reviewStatus,
        sessionId,
        localeVariantId: input.localeVariantId,
        note: input.note,
        rationale: input.rationale,
        relatedPbiIds: input.pbiIds,
        metadata: input.metadata
      });
      return { ok: true, ...created };
    }
  };
  const kbCliLoopback = new KbCliLoopbackService(workspaceRepository, appWorkingStateService);
  const kbCliRuntime = new KbCliRuntimeService(kbCliLoopback, workspaceRepository);
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
  const agentRuntime = new CursorAcpRuntime(workspaceRoot, runtimeToolContext, {
    prepareCliEnvironment: async (workspaceId) => kbCliRuntime.ensureReady(),
    getCliHealth: (workspaceId) => kbCliRuntime.checkHealth(workspaceId),
    getDirectHealth: (workspaceId) => directKbExecutor.checkHealth(workspaceId),
    executeDirectAction: async (request) => directKbExecutor.execute(request),
    buildCliPromptSuffix: () => kbCliRuntime.buildPromptSuffix(),
    getWorkspaceAgentModel: async (workspaceId) => {
      const settings = await workspaceRepository.getWorkspaceSettings(workspaceId);
      return settings.acpModelId;
    }
  }, (message, details) => {
    if (noisyAgentRuntimeLogs.has(message)) {
      return;
    }
    if (
      message.includes('failed')
      || message.includes('unreachable')
      || message.includes('timeout')
      || message.includes('violation')
      || message.includes('abort')
    ) {
      logger.warn(`[agent-runtime] ${message}`, details);
      return;
    }
    logger.info(`[agent-runtime] ${message}`, details);
  });
  const resolveWorkspaceKbAccessMode = async (workspaceId: string): Promise<KbAccessMode> => {
    const settings = await workspaceRepository.getWorkspaceSettings(workspaceId);
    return settings.kbAccessMode || defaultKbAccessMode;
  };
  const inspectKbAccessMode = (workspaceId: string, requestedMode?: KbAccessMode) => resolveKbAccessModeSelection({
    workspaceId,
    requestedMode,
    resolveWorkspaceKbAccessMode,
    agentRuntime
  });
  const requireHealthyKbAccessMode = (workspaceId: string, requestedMode?: KbAccessMode) => requireHealthyKbAccessModeSelection({
    workspaceId,
    requestedMode,
    resolveWorkspaceKbAccessMode,
    agentRuntime
  });
  const aiAssistantService = new AiAssistantService(
    workspaceRepository,
    agentRuntime,
    resolveWorkspaceKbAccessMode,
    appWorkingStateService,
    emitAiAssistantEvent
  );

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
    const selection = await inspectKbAccessMode(workspaceId, requestedMode);
    const { workspaceMode, selectedMode, health } = selection;
    logger.info('agent.health.check', {
      requestId,
      workspaceId,
      requestedMode,
      workspaceMode,
      selectedMode
    });
    logger.info('agent.health.check.result', {
      requestId,
      workspaceId,
      selectedMode,
      availableModes: health.availableModes,
      issues: health.issues,
      providers: {
        direct: {
          ok: health.providers.direct.ok,
          failureCode: health.providers.direct.failureCode,
          message: health.providers.direct.message,
          acpReachable: health.providers.direct.acpReachable
        },
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
      const kbAccessMode = selectKbAccessMode(input.kbAccessMode, await resolveWorkspaceKbAccessMode(workspaceId));
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
      const existingSession = input?.sessionId ? agentRuntime.getSession(input.sessionId) : null;
      if (
        existingSession
        && existingSession.workspaceId === workspaceId
        && existingSession.type === 'batch_analysis'
        && (existingSession.status === 'running' || existingSession.status === 'starting')
      ) {
        return createErrorResult(
          AppErrorCode.INVALID_REQUEST,
          'Running batch analysis sessions cannot be closed from the generic session panel.'
        );
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
      const orchestration = await workspaceRepository.getBatchAnalysisSnapshot(input.workspaceId, input.batchId);
      const lines = await readTranscriptLines(run?.transcriptPath, input.limit);
      const response: PersistedAgentAnalysisRunResponse = {
        workspaceId: input.workspaceId,
        batchId: input.batchId,
        run,
        lines,
        orchestration
      };
      return { ok: true, data: response };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
    }
  });

  bus.register('batch.analysis.snapshot.get', async (payload: unknown) => {
    const input = payload as { workspaceId?: string; batchId?: string };
    try {
      if (!input?.workspaceId || !input.batchId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'batch.analysis.snapshot.get requires workspaceId and batchId');
      }
      return {
        ok: true,
        data: await workspaceRepository.getBatchAnalysisSnapshot(input.workspaceId, input.batchId)
      };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
    }
  });

  bus.register('batch.analysis.inspection.get', async (payload: unknown) => {
    const input = payload as { workspaceId?: string; batchId?: string };
    try {
      if (!input?.workspaceId || !input.batchId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'batch.analysis.inspection.get requires workspaceId and batchId');
      }
      return {
        ok: true,
        data: await workspaceRepository.getBatchAnalysisInspection(input.workspaceId, input.batchId)
      };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
    }
  });

  bus.register('batch.analysis.runtime.get', async (payload: unknown) => {
    const input = payload as { workspaceId?: string; batchId?: string };
    try {
      if (!input?.workspaceId || !input.batchId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'batch.analysis.runtime.get requires workspaceId and batchId');
      }
      return {
        ok: true,
        data: await workspaceRepository.getBatchAnalysisRuntimeStatus(input.workspaceId, input.batchId)
      };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
    }
  });

  bus.register('batch.analysis.events.get', async (payload: unknown) => {
    const input = payload as { workspaceId?: string; batchId?: string; limit?: number };
    try {
      if (!input?.workspaceId || !input.batchId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'batch.analysis.events.get requires workspaceId and batchId');
      }
      return {
        ok: true,
        data: await workspaceRepository.getBatchAnalysisEventStream(input.workspaceId, input.batchId, input.limit)
      };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
    }
  });

  bus.register('batch.analysis.questions.answer', async (payload: unknown) => {
    const input = payload as BatchAnalysisQuestionAnswerRequest;
    try {
      if (!input?.workspaceId || !input.batchId || !input.questionId || !input.answer?.trim()) {
        return createErrorResult(
          AppErrorCode.INVALID_REQUEST,
          'batch.analysis.questions.answer requires workspaceId, batchId, questionId, and a non-empty answer'
        );
      }
      const answered = await workspaceRepository.answerBatchAnalysisQuestion(input);
      let questionSetStatus = answered.questionSet.status;
      let resumeTriggered = false;
      if (answered.unansweredRequiredQuestionCount === 0 && answered.questionSet.status === 'waiting') {
        const markedReady = await workspaceRepository.markBatchAnalysisQuestionSetReadyToResume({
          workspaceId: input.workspaceId,
          questionSetId: answered.questionSet.id
        });
        questionSetStatus = markedReady.questionSet?.status ?? 'ready_to_resume';
        resumeTriggered = markedReady.transitioned
          ? scheduleBatchAnalysisAutoResume(input.workspaceId, input.batchId, answered.questionSet.id)
          : false;
      }
      const response: BatchAnalysisQuestionAnswerResponse = {
        workspaceId: input.workspaceId,
        batchId: input.batchId,
        questionId: answered.question.id,
        questionSetId: answered.questionSet.id,
        unansweredRequiredQuestionCount: answered.unansweredRequiredQuestionCount,
        resumeTriggered,
        questionSetStatus,
        question: answered.question
      };
      return {
        ok: true,
        data: response
      };
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
        input.kbAccessMode === undefined &&
        input.agentModelId === undefined &&
        input.acpModelId === undefined
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
      if (input.kbAccessMode !== undefined && !isKbAccessMode(input.kbAccessMode)) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'kbAccessMode must be direct, mcp, or cli');
      }
      if (typeof input.agentModelId === 'string' && !input.agentModelId.trim()) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'agentModelId cannot be empty');
      }
      if (typeof input.acpModelId === 'string' && !input.acpModelId.trim()) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'acpModelId cannot be empty');
      }

      const updated = await workspaceRepository.updateWorkspaceSettings(input);
      await agentRuntime.setWorkspaceAgentModel(updated.workspaceId, updated.acpModelId);
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

  bus.register('agent.runtime.options.get', async (payload) => {
    try {
      const workspaceId = (payload as AgentRuntimeOptionsRequest | undefined)?.workspaceId;
      if (!workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'agent.runtime.options.get requires workspaceId');
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
        } satisfies AgentRuntimeOptionsResponse
      };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
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

  bus.register('article.relations.coverage.query', async (payload) => {
    try {
      const input = payload as CoverageQueryRequest | undefined;
      const hasSignals = Boolean(input?.query?.trim())
        || (input?.seedFamilyIds?.some((value) => value.trim()) ?? false)
        || (input?.batchQueries?.some((value) => value.trim()) ?? false);
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.relations.coverage.query requires workspaceId');
      }
      if (!hasSignals) {
        return createErrorResult(
          AppErrorCode.INVALID_REQUEST,
          'article.relations.coverage.query requires query, seedFamilyIds, or batchQueries'
        );
      }
      const response = await workspaceRepository.queryArticleRelationCoverage(input);
      return { ok: true, data: response };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.relations.graph', async (payload) => {
    try {
      const input = payload as GraphQueryRequest | undefined;
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.relations.graph requires workspaceId');
      }
      if (!input.familyId && !input.sectionId && !input.categoryId && input.minScore === undefined) {
        return createErrorResult(
          AppErrorCode.INVALID_REQUEST,
          'article.relations.graph requires a filter or an explicit minScore for workspace overview mode'
        );
      }
      const response = await workspaceRepository.queryArticleRelationGraph(input);
      return { ok: true, data: response };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.relations.feature-map.summary', async (payload) => {
    try {
      const input = payload as FeatureMapSummaryRequest | undefined;
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.relations.feature-map.summary requires workspaceId');
      }
      const response = await workspaceRepository.getArticleRelationFeatureMapSummary(input);
      return { ok: true, data: response };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.relations.feature-map.scope', async (payload) => {
    try {
      const input = payload as FeatureScopeRequest | undefined;
      if (!input?.workspaceId || !input.scopeType) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.relations.feature-map.scope requires workspaceId and scopeType');
      }
      const response = await workspaceRepository.getArticleRelationFeatureScope(input);
      return { ok: true, data: response };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.relations.neighborhood', async (payload) => {
    try {
      const input = payload as ArticleNeighborhoodRequest | undefined;
      if (!input?.workspaceId || !input.familyId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.relations.neighborhood requires workspaceId and familyId');
      }
      const response = await workspaceRepository.getArticleRelationNeighborhood(input);
      return { ok: true, data: response };
    } catch (error) {
      if ((error as Error).message === 'Article family not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Article family not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.relations.rebuild', async (payload) => {
    try {
      const input = payload as ArticleRelationsV2RebuildRequest | undefined;
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'article.relations.rebuild requires workspaceId');
      }
      const response = await workspaceRepository.rebuildArticleRelationCoverageIndex(input.workspaceId, {
        forceFullRebuild: input.forceFullRebuild
      });
      return { ok: true, data: response };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('article.relations.feedback.record', async (payload) => {
    try {
      const input = payload as ArticleRelationFeedbackRecordRequest | undefined;
      if (!input?.workspaceId || !input.leftFamilyId || !input.rightFamilyId || !input.feedbackType) {
        return createErrorResult(
          AppErrorCode.INVALID_REQUEST,
          'article.relations.feedback.record requires workspaceId, leftFamilyId, rightFamilyId, and feedbackType'
        );
      }
      const response = await workspaceRepository.recordArticleRelationFeedback(input);
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
      const hasQuery = Boolean(input?.query?.trim());
      const hasIdFilters = Boolean(
        input?.localeVariantIds?.length
        || input?.familyIds?.length
        || input?.revisionIds?.length
      );
      if (!input?.workspaceId || (!hasQuery && !hasIdFilters)) {
        return createErrorResult(
          AppErrorCode.INVALID_REQUEST,
          'workspace.search requires workspaceId plus query or article ids'
        );
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

  bus.register('pbiLibrary.list', async (payload) => {
    try {
      const input = payload as PBILibraryListRequest | undefined;
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiLibrary.list requires workspaceId');
      }
      if (input.validationStatuses?.length && !input.validationStatuses.every((status) => validPBIValidationStatuses.has(status))) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiLibrary.list requires validationStatuses to be candidate|malformed|duplicate|ignored');
      }
      if (input.scopeStates?.length && !input.scopeStates.every((state) => validPBILibraryScopeStates.has(state))) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiLibrary.list requires scopeStates to be in_scope|out_of_scope|not_eligible');
      }
      if (input.sortBy && !validPBILibrarySortFields.has(input.sortBy)) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiLibrary.list sortBy must be importedAtUtc|externalId|title|workItemType|priority|validationStatus|scopeState|batchName|proposalCount');
      }
      if (input.sortDirection && input.sortDirection !== 'asc' && input.sortDirection !== 'desc') {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiLibrary.list sortDirection must be asc|desc');
      }

      const list = await workspaceRepository.listPBILibrary(input.workspaceId, input);
      return { ok: true, data: list };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, 'Workspace not found');
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('pbiLibrary.get', async (payload) => {
    try {
      const input = payload as PBILibraryGetRequest | undefined;
      if (!input?.workspaceId || !input?.pbiId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'pbiLibrary.get requires workspaceId and pbiId');
      }

      const detail = await workspaceRepository.getPBILibraryDetail(input.workspaceId, input.pbiId);
      return { ok: true, data: detail };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'PBI library record not found') {
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
        Boolean(input?.force),
        input && Object.prototype.hasOwnProperty.call(input, 'workerStageBudgetMinutes')
          ? { workerStageBudgetMinutes: input.workerStageBudgetMinutes }
          : undefined
      );
      return { ok: true, data: { batch } };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'PBI batch not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      if ((error as Error).message?.startsWith('Cannot transition batch status')) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, (error as Error).message);
      }
      if ((error as Error).message?.startsWith('workerStageBudgetMinutes')) {
        return createErrorResult(
          AppErrorCode.INVALID_REQUEST,
          `${(error as Error).message} Allowed range: ${MIN_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES}-${MAX_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES} minutes.`
        );
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
      const input = payload as ProposalIngestRequest & {
        kbAccessMode?: KbAccessMode;
        acpSessionId?: string;
        originPath?: string;
      };
      if (!input?.workspaceId || !input.batchId || !input.action) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'proposal.ingest requires workspaceId, batchId, and action');
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

  bus.register('proposal.review.delete', async (payload) => {
    try {
      const input = payload as ProposalReviewDeleteRequest;
      if (!input?.workspaceId || !input.proposalId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'proposal.review.delete requires workspaceId and proposalId');
      }
      return { ok: true, data: await workspaceRepository.deleteProposalReview(input.workspaceId, input.proposalId) };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Proposal not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('proposal.review.saveWorkingCopy', async (payload) => {
    try {
      const input = payload as ProposalReviewSaveWorkingCopyRequest;
      if (!input?.workspaceId || !input.proposalId || typeof input.html !== 'string') {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'proposal.review.saveWorkingCopy requires workspaceId, proposalId, and html');
      }
      return {
        ok: true,
        data: await workspaceRepository.updateProposalReviewWorkingCopy(input.workspaceId, input.proposalId, { html: input.html })
      };
    } catch (error) {
      if ((error as Error).message === 'Workspace not found' || (error as Error).message === 'Proposal not found') {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('ai.assistant.context.get', async (payload) => {
    try {
      const input = payload as AiAssistantContextGetRequest;
      if (!input?.workspaceId || !input.context) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'ai.assistant.context.get requires workspaceId and context');
      }
      return { ok: true, data: await aiAssistantService.getContext(input) };
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('ai.assistant.context.current', async () => {
    try {
      const data: AiAssistantContextGetResponse = assistantViewContextService
        ? assistantViewContextService.getCurrent()
        : {};
      return { ok: true, data };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('ai.assistant.context.publish', async (payload) => {
    try {
      const input = payload as AiAssistantContextPublishRequest;
      if (!assistantViewContextService) {
        return createErrorResult(AppErrorCode.INTERNAL_ERROR, 'Assistant context publishing is not available.');
      }
      if (!input?.sourceWindowRole) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'ai.assistant.context.publish requires sourceWindowRole');
      }
      return {
        ok: true,
        data: assistantViewContextService.publish(input)
      };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('ai.assistant.presentation.get', async () => {
    try {
      const data: AiAssistantPresentationGetResponse = {
        state: assistantPresentationService?.getState() ?? {
          dockMode: 'embedded',
          surfaceMode: 'closed',
          state: 'embedded_closed',
          hasUnread: false,
          updatedAtUtc: new Date().toISOString(),
          lastDetachedSurfaceMode: 'launcher'
        }
      };
      return { ok: true, data };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('ai.assistant.presentation.transition', async (payload) => {
    try {
      const input = payload as AiAssistantPresentationTransitionRequest;
      if (!assistantPresentationService) {
        return createErrorResult(AppErrorCode.INTERNAL_ERROR, 'Assistant presentation is not available.');
      }
      if (!input?.transition?.type) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'ai.assistant.presentation.transition requires a transition');
      }
      return {
        ok: true,
        data: {
          state: assistantPresentationService.transition(input.transition)
        } satisfies AiAssistantPresentationGetResponse
      };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('ai.assistant.session.get', async (payload) => {
    try {
      const input = payload as AiAssistantSessionGetRequest;
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'ai.assistant.session.get requires workspaceId');
      }
      return { ok: true, data: await aiAssistantService.getSession(input) };
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('ai.assistant.session.list', async (payload) => {
    try {
      const input = payload as AiAssistantSessionListRequest;
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'ai.assistant.session.list requires workspaceId');
      }
      return { ok: true, data: await aiAssistantService.listSessions(input) };
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('ai.assistant.session.create', async (payload) => {
    try {
      const input = payload as AiAssistantSessionCreateRequest;
      if (!input?.workspaceId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'ai.assistant.session.create requires workspaceId');
      }
      return { ok: true, data: await aiAssistantService.createSession(input) };
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('ai.assistant.session.open', async (payload) => {
    try {
      const input = payload as AiAssistantSessionOpenRequest;
      if (!input?.workspaceId || !input.sessionId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'ai.assistant.session.open requires workspaceId and sessionId');
      }
      return { ok: true, data: await aiAssistantService.openSession(input) };
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('ai.assistant.session.delete', async (payload) => {
    try {
      const input = payload as AiAssistantSessionDeleteRequest;
      if (!input?.workspaceId || !input.sessionId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'ai.assistant.session.delete requires workspaceId and sessionId');
      }
      return { ok: true, data: await aiAssistantService.deleteSession(input) };
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('ai.assistant.message.send', async (payload) => {
    try {
      const input = payload as AiAssistantMessageSendRequest;
      if (!input?.workspaceId || !input.context || !input.message?.trim()) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'ai.assistant.message.send requires workspaceId, context, and message');
      }
      return { ok: true, data: await aiAssistantService.sendMessage(input) };
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('ai.assistant.session.reset', async (payload) => {
    try {
      const input = payload as AiAssistantSessionResetRequest;
      if (!input?.workspaceId || !input.sessionId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'ai.assistant.session.reset requires workspaceId and sessionId');
      }
      return { ok: true, data: await aiAssistantService.resetSession(input) };
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('ai.assistant.artifact.apply', async (payload) => {
    try {
      const input = payload as AiAssistantArtifactDecisionRequest;
      if (!input?.workspaceId || !input.sessionId || !input.artifactId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'ai.assistant.artifact.apply requires workspaceId, sessionId, and artifactId');
      }
      return { ok: true, data: await aiAssistantService.applyArtifact(input) };
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('ai.assistant.artifact.reject', async (payload) => {
    try {
      const input = payload as AiAssistantArtifactDecisionRequest;
      if (!input?.workspaceId || !input.sessionId || !input.artifactId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'ai.assistant.artifact.reject requires workspaceId, sessionId, and artifactId');
      }
      return { ok: true, data: await aiAssistantService.rejectArtifact(input) };
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        return createErrorResult(AppErrorCode.NOT_FOUND, (error as Error).message);
      }
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('app.navigation.dispatch', async (payload) => {
    try {
      const input = payload as AppNavigationDispatchRequest;
      if (!input?.action?.type) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'app.navigation.dispatch requires an action');
      }
      const event: AppNavigationEvent = {
        action: input.action,
        atUtc: new Date().toISOString()
      };
      dispatchAppNavigation?.(event);
      return {
        ok: true,
        data: event
      };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('app.workingState.register', async (payload) => {
    try {
      const input = payload as AppWorkingStateRegistration;
      if (!input?.workspaceId || !input.route || !input.entityType || !input.entityId || !input.versionToken || !input.currentValues) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'app.workingState.register requires workspaceId, route, entityType, entityId, versionToken, and currentValues');
      }
      appWorkingStateService.register(input);
      return { ok: true, data: { registered: true } };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('app.workingState.unregister', async (payload) => {
    try {
      const input = payload as Pick<AppWorkingStateRegistration, 'workspaceId' | 'route' | 'entityType' | 'entityId'>;
      if (!input?.workspaceId || !input.route || !input.entityType || !input.entityId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'app.workingState.unregister requires workspaceId, route, entityType, and entityId');
      }
      appWorkingStateService.unregister(input);
      return { ok: true, data: { unregistered: true } };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('app.workingState.getFormSchema', async (payload) => {
    try {
      const input = payload as AppWorkingStateSchemaRequest;
      if (!input?.workspaceId || !input.route || !input.entityType || !input.entityId) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'app.workingState.getFormSchema requires workspaceId, route, entityType, and entityId');
      }
      return { ok: true, data: appWorkingStateService.getFormSchema(input) };
    } catch (error) {
      return createErrorResult(AppErrorCode.INTERNAL_ERROR, String((error as Error).message || error));
    }
  });

  bus.register('app.workingState.patchForm', async (payload) => {
    try {
      const input = payload as AppWorkingStatePatchRequest;
      if (!input?.workspaceId || !input.route || !input.entityType || !input.entityId || !input.patch) {
        return createErrorResult(AppErrorCode.INVALID_REQUEST, 'app.workingState.patchForm requires workspaceId, route, entityType, entityId, and patch');
      }
      const result = await applyAppWorkingStatePatch({
        workspaceRepository,
        appWorkingStateService,
        request: input
      });
      return { ok: true, data: result };
    } catch (error) {
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

      const kbAccessSelection = await requireHealthyKbAccessMode(input.workspaceId);
      const kbAccessMode = kbAccessSelection.selectedMode;
      const run = await agentRuntime.runArticleEdit(
        {
          workspaceId: input.workspaceId,
          localeVariantId: session.session.localeVariantId,
          sessionId: session.session.runtimeSessionId,
          kbAccessMode,
          locale: input.targetLocale ?? session.session.locale,
          directContext: kbAccessMode === 'direct'
            ? {
                route: input.branchId ? AppRoute.DRAFTS : AppRoute.ARTICLE_EXPLORER,
                localeVariantIds: [session.session.localeVariantId],
                familyIds: [session.session.familyId]
              }
            : undefined,
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

      if (run.status === 'error') {
        return createErrorResult(AppErrorCode.INTERNAL_ERROR, run.message ?? 'Article AI runtime failed');
      }
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
    const workspaceSettings = await workspaceRepository.getWorkspaceSettings(input.workspaceId);
    const agentModelId = workspaceSettings.acpModelId;
    await agentRuntime.setWorkspaceAgentModel(input.workspaceId, agentModelId);
    let kbAccessMode: KbAccessMode;
    try {
      const kbAccessSelection = await requireHealthyKbAccessMode(input.workspaceId, input.kbAccessMode);
      kbAccessMode = kbAccessSelection.selectedMode;
    } catch (error) {
      const selectedMode =
        error instanceof KbAccessModePreflightError
          ? error.selection.selectedMode
          : selectKbAccessMode(input.kbAccessMode, await resolveWorkspaceKbAccessMode(input.workspaceId));
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.FAILED,
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
      state: JobState.RUNNING,
      progress: 15,
      message: `Starting analysis session for batch ${input.batchId}`,
      metadata: {
        batchId: input.batchId,
        requestedKbAccessMode: kbAccessMode,
        kbAccessMode,
        agentModelId
      }
    });
    logger.info('[agent.analysis.run] starting runtime', {
      jobId: payload.jobId,
      batchId: input.batchId,
      workspaceId: input.workspaceId
    });
    const staleDevBuildMessage = await getBatchAnalysisDevBuildFreshnessMessage();
    if (staleDevBuildMessage) {
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.FAILED,
        progress: 100,
        message: staleDevBuildMessage
      });
      logger.warn('[agent.analysis.trace] blocked batch analyzation because desktop dev build is stale', {
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
        state: JobState.FAILED,
        progress: 100,
        message: 'Batch context not found'
      });
      return;
    }
    const requestedWorkerStageBudgetMinutes = input.workerStageBudgetMinutes;
    const normalizedRequestedWorkerStageBudgetMinutes = requestedWorkerStageBudgetMinutes == null
      ? undefined
      : normalizeBatchAnalysisWorkerStageBudgetMinutes(requestedWorkerStageBudgetMinutes);
    if (requestedWorkerStageBudgetMinutes != null && normalizedRequestedWorkerStageBudgetMinutes === undefined) {
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.FAILED,
        progress: 100,
        message: `workerStageBudgetMinutes must be between ${MIN_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES} and ${MAX_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES} minutes.`,
        metadata: {
          batchId: input.batchId,
          requestedKbAccessMode: kbAccessMode,
          kbAccessMode,
          agentModelId
        }
      });
      return;
    }
    const workerStageRunBudget = resolveWorkerStageRunBudget(
      normalizedRequestedWorkerStageBudgetMinutes ?? batchContext.batch.workerStageBudgetMinutes
    );
    const uploadedPbis = await workspaceRepository.getPBISubset(input.workspaceId, input.batchId).catch(() => ({ rows: [] }));
    const plannerPrefetch = await buildPlannerPrefetch(
      workspaceRepository,
      input.workspaceId,
      input.batchId,
      uploadedPbis
    ).catch(() => ({
      priorAnalysis: null,
      topicClusters: [],
      articleMatches: [],
      relationMatches: []
    }));
    const existingSnapshot = await workspaceRepository.getBatchAnalysisSnapshot(input.workspaceId, input.batchId);
    let latestPendingQuestionSet = existingSnapshot.activeQuestionSet;
    const latestPendingQuestions = existingSnapshot.questions;
    const latestPendingQuestionCount = existingSnapshot.unansweredRequiredQuestionCount;
    const buildResolvedUserAnswers = (questions: BatchAnalysisQuestion[]): BatchAnalysisQuestionAnswer[] =>
      questions
        .filter((question) => Boolean(question.answer?.trim()))
        .map((question) => ({
          questionId: question.id,
          prompt: question.prompt,
          answer: question.answer!.trim(),
          answeredAtUtc: question.answeredAtUtc
        }));
    type BatchAnalysisResumeState =
      | {
          kind: 'planning';
          questionSet: BatchAnalysisQuestionSet;
          questions: BatchAnalysisQuestion[];
          resolvedUserAnswers: BatchAnalysisQuestionAnswer[];
          priorPlanJson?: string;
          reviewDeltaJson?: string;
          nextAttempt: number;
        }
      | {
          kind: 'amendment';
          questionSet: BatchAnalysisQuestionSet;
          questions: BatchAnalysisQuestion[];
          resolvedUserAnswers: BatchAnalysisQuestionAnswer[];
          activeApprovedPlan: BatchAnalysisPlan;
          discoveredForAmendment: BatchDiscoveredWorkItem[];
          amendmentLoops: number;
        }
      | null;
    let resumeState: BatchAnalysisResumeState = null;
    if (existingSnapshot.latestIteration?.status === 'needs_user_input' && latestPendingQuestionSet) {
      if (latestPendingQuestionCount > 0) {
        emit({
          id: payload.jobId,
          command: payload.command,
          state: JobState.FAILED,
          progress: 100,
          message: `Batch analysis is waiting for ${latestPendingQuestionCount} required answer(s) before it can resume.`,
          metadata: {
            batchId: input.batchId,
            requestedKbAccessMode: kbAccessMode,
            kbAccessMode,
            agentModelId
          }
        });
        return;
      }
      if (latestPendingQuestionSet.status === 'waiting') {
        const markedReady = await workspaceRepository.markBatchAnalysisQuestionSetReadyToResume({
          workspaceId: input.workspaceId,
          questionSetId: latestPendingQuestionSet.id
        });
        latestPendingQuestionSet = markedReady.questionSet ?? latestPendingQuestionSet;
      }
      if (latestPendingQuestionSet.status === 'ready_to_resume') {
        const markedResuming = await workspaceRepository.markBatchAnalysisQuestionSetResuming({
          workspaceId: input.workspaceId,
          questionSetId: latestPendingQuestionSet.id
        });
        if (!markedResuming.questionSet) {
          emit({
            id: payload.jobId,
            command: payload.command,
            state: JobState.CANCELED,
            progress: 100,
            message: 'Resume already claimed by another batch-analysis run.'
          });
          return;
        }
        latestPendingQuestionSet = markedResuming.questionSet;
      }

      const inspection = await workspaceRepository.getBatchAnalysisInspection(input.workspaceId, input.batchId);
      const resolvedUserAnswers = buildResolvedUserAnswers(latestPendingQuestions);
      const pendingQuestionSet = latestPendingQuestionSet;
      if (!pendingQuestionSet) {
        throw new Error('Cannot resume batch analysis without a pending question set.');
      }
      if (pendingQuestionSet.resumeStage === 'worker_discovery_review') {
        const activeApprovedPlan = existingSnapshot.latestApprovedPlan;
        if (!activeApprovedPlan) {
          throw new Error('Cannot resume amendment review without an approved plan.');
        }
        const discoveryIds = new Set(
          latestPendingQuestions.flatMap((question) => question.linkedDiscoveryIds)
        );
        const discoveredForAmendment = inspection.discoveredWork.filter((item) => discoveryIds.has(item.discoveryId));
        if (discoveredForAmendment.length === 0) {
          throw new Error('Cannot resume amendment review without linked discovered work.');
        }
        resumeState = {
          kind: 'amendment',
          questionSet: pendingQuestionSet,
          questions: latestPendingQuestions,
          resolvedUserAnswers,
          activeApprovedPlan,
          discoveredForAmendment,
          amendmentLoops: Math.max(
            1,
            inspection.amendments.filter((amendment) => amendment.iterationId === existingSnapshot.latestIteration?.id).length
          )
        };
      } else {
        const priorPlan = inspection.plans.find((plan) => plan.id === pendingQuestionSet.planId)
          ?? inspection.plans[0]
          ?? null;
        const priorReview = inspection.reviews.find((review) => review.id === pendingQuestionSet.reviewId)
          ?? inspection.reviews[0]
          ?? null;
        resumeState = {
          kind: 'planning',
          questionSet: pendingQuestionSet,
          questions: latestPendingQuestions,
          resolvedUserAnswers,
          priorPlanJson: priorPlan ? JSON.stringify(priorPlan) : undefined,
          reviewDeltaJson: priorReview?.delta ? JSON.stringify(priorReview.delta) : undefined,
          nextAttempt: (priorPlan?.planVersion ?? 1) + 1
        };
      }
    }
    const streamMetadata: {
      batchId: string;
      kbAccessMode: KbAccessMode;
      workspaceId: string;
      agentModelId?: string;
      iterationId?: string;
      stage?: string;
      role?: string;
      status?: 'ok' | 'error' | 'timeout' | 'canceled';
      sessionId?: string;
    } = {
      batchId: input.batchId,
      kbAccessMode,
      workspaceId: input.workspaceId,
      agentModelId
    };
    const orchestrationIteration = resumeState && existingSnapshot.latestIteration
      ? existingSnapshot.latestIteration
      : await batchAnalysisOrchestrator.startIteration({
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
    let planningSessionId = orchestrationIteration.sessionId;
    let workerSessionId: string | undefined;
    let liveStageStartedAtUtc = orchestrationIteration.startedAtUtc;
    let liveActiveQuestionSetId = existingSnapshot.activeQuestionSet?.id;
    let liveActiveQuestionSetStatus = existingSnapshot.activeQuestionSet?.status;
    let livePausedForUserInput = existingSnapshot.pausedForUserInput;
    let liveUnansweredRequiredQuestionCount = existingSnapshot.unansweredRequiredQuestionCount;
    const buildStreamMetadata = (
      overrides?: Partial<typeof streamMetadata> & {
        sessionId?: string;
        stageEndedAtUtc?: string;
      }
    ) => ({
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
        activeQuestionSetId: liveActiveQuestionSetId,
        activeQuestionSetStatus: liveActiveQuestionSetStatus,
        pausedForUserInput: livePausedForUserInput,
        unansweredRequiredQuestionCount: liveUnansweredRequiredQuestionCount,
        executionCounts: liveExecutionCounts,
        stageStartedAtUtc: liveStageStartedAtUtc,
        stageEndedAtUtc: overrides?.stageEndedAtUtc,
        updatedAtUtc: new Date().toISOString()
      }
    });
    const logAnalysisProgress = async (
      summary: string,
      overrides?: Partial<{
        stage: string;
        role: string;
        sessionId: string;
        eventType: 'iteration_started' | 'stage_transition' | 'stage_progress' | 'iteration_completed';
      }>,
      details?: BatchAnalysisStageEventDetails
    ) => {
      const stage = (overrides?.stage ?? streamMetadata.stage ?? liveIteration.stage) as BatchAnalysisStageStatus;
      const role = (overrides?.role ?? streamMetadata.role ?? liveIteration.role) as BatchAnalysisIterationRecord['role'];
      const sessionId = overrides?.sessionId ?? liveSessionId ?? streamMetadata.sessionId ?? liveIteration.sessionId;
      const eventDetails: BatchAnalysisStageEventDetails = {
        previousStage: liveIteration.stage,
        previousRole: liveIteration.role,
        ...(details ?? {})
      };
      logger.info('[agent.analysis.trace] ' + summary, {
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
        id: randomUUID(),
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
    const resolveStageKbAccessMode = (_role: BatchAnalysisIterationRecord['role']): KbAccessMode => kbAccessMode;
    const ensurePlanningSession = (role: Extract<BatchAnalysisIterationRecord['role'], 'planner' | 'plan-reviewer'>): {
      sessionId: string;
      reusePolicy: BatchAnalysisSessionReusePolicy;
    } => {
      if (planningSessionId?.trim()) {
        return {
          sessionId: planningSessionId,
          reusePolicy: 'reuse'
        };
      }
      const session = agentRuntime.createSession({
        workspaceId: input.workspaceId,
        kbAccessMode,
        type: 'batch_analysis',
        mode: 'plan',
        role,
        batchId: input.batchId,
        locale: input.locale,
        templatePackId: input.templatePackId
      });
      planningSessionId = session.id;
      return {
        sessionId: session.id,
        reusePolicy: 'new_local_session'
      };
    };
    const ensureWorkerSession = (stage: Extract<BatchAnalysisStageStatus, 'building' | 'reworking'>): {
      sessionId: string;
      reusePolicy: BatchAnalysisSessionReusePolicy;
    } => {
      if (workerSessionId?.trim()) {
        return {
          sessionId: workerSessionId,
          reusePolicy: 'reuse'
        };
      }
      const session = agentRuntime.createSession({
        workspaceId: input.workspaceId,
        kbAccessMode: resolveStageKbAccessMode('worker'),
        type: 'batch_analysis',
        mode: 'agent',
        role: 'worker',
        batchId: input.batchId,
        locale: input.locale,
        templatePackId: input.templatePackId
      });
      workerSessionId = session.id;
      logger.info('[agent.analysis.run] created dedicated worker session', {
        jobId: payload.jobId,
        workspaceId: input.workspaceId,
        batchId: input.batchId,
        iterationId: orchestrationIteration.id,
        stage,
        sessionId: session.id
      });
      return {
        sessionId: session.id,
        reusePolicy: 'new_local_session'
      };
    };
    const beginWorkerStage = async (params: {
      stage: Extract<BatchAnalysisStageStatus, 'building' | 'reworking'>;
      summary: string;
      approvedPlanId: string;
      lastReviewVerdict?: BatchPlanReview['verdict'];
    }): Promise<{
      sessionId: string;
      reusePolicy: BatchAnalysisSessionReusePolicy;
    }> => {
      const workerSession = ensureWorkerSession(params.stage);
      liveSessionId = workerSession.sessionId;
      liveIteration = await batchAnalysisOrchestrator.transitionIteration({
        workspaceId: input.workspaceId,
        iterationId: orchestrationIteration.id,
        stage: params.stage,
        role: 'worker',
        summary: params.summary,
        agentModelId,
        sessionId: workerSession.sessionId,
        approvedPlanId: params.approvedPlanId,
        lastReviewVerdict: params.lastReviewVerdict
      });
      streamMetadata.stage = params.stage;
      streamMetadata.role = 'worker';
      liveApprovedPlanId = params.approvedPlanId;
      if (params.lastReviewVerdict) {
        liveLastReviewVerdict = params.lastReviewVerdict;
      }
      liveStageStartedAtUtc = liveIteration.updatedAtUtc;
      return workerSession;
    };
    const persistBatchStageRun = async (params: {
      stageRunId?: string;
      stage: BatchAnalysisStageStatus;
      role: BatchAnalysisIterationRecord['role'];
      stageKbAccessMode?: KbAccessMode;
      result: {
        sessionId?: string;
        acpSessionId?: string;
        kbAccessMode?: KbAccessMode;
        status: 'ok' | 'error' | 'timeout' | 'canceled';
        startedAtUtc: string;
        endedAtUtc?: string;
        transcriptPath?: string;
        toolCalls?: unknown[];
        rawOutput?: string[];
        message?: string;
      };
      promptTemplate?: string;
      retryType?: string;
      sessionReusePolicy?: BatchAnalysisSessionReusePolicy;
      resolution?: {
        parseable: boolean;
        usedTranscript: boolean;
        initialCandidateCount: number;
        transcriptCandidateCount: number;
        text: string;
      };
    }) => {
      const stageKbAccessMode = params.stageKbAccessMode ?? kbAccessMode;
      const stageRunStatus: BatchAnalysisStageRunRecord['status'] =
        params.result.status === 'ok' || params.resolution?.parseable
          ? 'complete'
          : params.result.status === 'canceled'
            ? 'canceled'
            : 'failed';
      const stageRunPayload: {
        workspaceId: string;
        batchId: string;
        iterationId: string;
        iteration: number;
        stage: BatchAnalysisStageStatus;
        role: BatchAnalysisIterationRecord['role'];
        retryType?: string;
        sessionReusePolicy?: BatchAnalysisSessionReusePolicy;
        localSessionId?: string;
        acpSessionId?: string;
        kbAccessMode: KbAccessMode;
        agentModelId?: string;
        status: BatchAnalysisStageRunRecord['status'];
        startedAtUtc: string;
        endedAtUtc?: string;
        promptTemplate?: string;
        transcriptPath?: string;
        toolCalls: AgentRunResult['toolCalls'];
        rawOutput?: string[];
        message: string;
        parseable?: boolean;
        usedTranscriptRecovery?: boolean;
        initialCandidateCount?: number;
        transcriptCandidateCount?: number;
        textLength?: number;
        resultTextPreview?: string;
      } = {
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
        kbAccessMode: stageKbAccessMode,
        agentModelId,
        status: stageRunStatus,
        startedAtUtc: params.result.startedAtUtc,
        endedAtUtc: params.result.endedAtUtc,
        promptTemplate: params.promptTemplate,
        transcriptPath: params.result.transcriptPath,
        toolCalls: Array.isArray(params.result.toolCalls) ? params.result.toolCalls as AgentRunResult['toolCalls'] : [],
        rawOutput: params.result.rawOutput,
        message: `[${params.stage}/${params.role}] ${params.result.message ?? params.result.status}`,
        parseable: params.resolution?.parseable,
        usedTranscriptRecovery: params.resolution?.usedTranscript,
        initialCandidateCount: params.resolution?.initialCandidateCount,
        transcriptCandidateCount: params.resolution?.transcriptCandidateCount,
        textLength: params.resolution?.text.length,
        resultTextPreview: params.resolution ? buildStageEventTextPreview(params.resolution.text) : undefined
      };
      if (params.stageRunId) {
        await workspaceRepository.updateBatchAnalysisStageRun({
          workspaceId: input.workspaceId,
          stageRunId: params.stageRunId,
          localSessionId: stageRunPayload.localSessionId,
          acpSessionId: stageRunPayload.acpSessionId,
          kbAccessMode: stageRunPayload.kbAccessMode,
          agentModelId: stageRunPayload.agentModelId,
          status: stageRunPayload.status,
          startedAtUtc: stageRunPayload.startedAtUtc,
          endedAtUtc: stageRunPayload.endedAtUtc,
          promptTemplate: stageRunPayload.promptTemplate,
          transcriptPath: stageRunPayload.transcriptPath,
          toolCalls: stageRunPayload.toolCalls,
          rawOutput: stageRunPayload.rawOutput,
          message: stageRunPayload.message,
          parseable: stageRunPayload.parseable,
          usedTranscriptRecovery: stageRunPayload.usedTranscriptRecovery,
          initialCandidateCount: stageRunPayload.initialCandidateCount,
          transcriptCandidateCount: stageRunPayload.transcriptCandidateCount,
          textLength: stageRunPayload.textLength,
          resultTextPreview: stageRunPayload.resultTextPreview
        });
      } else {
        await workspaceRepository.recordBatchAnalysisStageRun(stageRunPayload);
      }
      if (params.result.sessionId) {
        await workspaceRepository.annotateProposalProvenanceForSession({
          workspaceId: input.workspaceId,
          batchId: input.batchId,
          sessionId: params.result.sessionId,
          kbAccessMode: stageKbAccessMode,
          acpSessionId: params.result.acpSessionId,
          originPath: 'batch_analysis'
        });
      }
    };
    const pauseForUserInput = async (params: {
      questionSet: BatchAnalysisQuestionSet;
      questions: BatchAnalysisQuestion[];
      summary: string;
      role: BatchAnalysisIterationRecord['role'];
      lastReviewVerdict?: BatchPlanReview['verdict'];
      progressMessage: string;
      logMessage: string;
      details?: BatchAnalysisStageEventDetails;
    }) => {
      await workspaceRepository.recordBatchAnalysisQuestionSet(params.questionSet);
      await workspaceRepository.recordBatchAnalysisQuestions({
        workspaceId: params.questionSet.workspaceId,
        batchId: params.questionSet.batchId,
        iterationId: params.questionSet.iterationId,
        questionSetId: params.questionSet.id,
        questions: params.questions
      });
      liveActiveQuestionSetId = params.questionSet.id;
      liveActiveQuestionSetStatus = params.questionSet.status;
      livePausedForUserInput = true;
      liveUnansweredRequiredQuestionCount = params.questions.filter((question) =>
        question.requiresUserInput
        && question.status === 'pending'
        && !question.answer?.trim()
      ).length;
      await logAnalysisProgress(params.logMessage, {
        stage: 'awaiting_user_input',
        role: params.role
      }, {
        questionSetId: params.questionSet.id,
        questionCount: params.questions.length,
        unansweredRequiredQuestionCount: liveUnansweredRequiredQuestionCount,
        ...(params.details ?? {})
      });
      liveIteration = await workspaceRepository.updateBatchAnalysisIteration({
        workspaceId: input.workspaceId,
        iterationId: orchestrationIteration.id,
        stage: 'awaiting_user_input',
        role: params.role,
        status: 'needs_user_input',
        summary: params.summary,
        agentModelId,
        lastReviewVerdict: params.lastReviewVerdict
      });
      streamMetadata.stage = 'awaiting_user_input';
      streamMetadata.role = params.role;
      liveStageStartedAtUtc = liveIteration.updatedAtUtc;
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.FAILED,
        progress: 100,
        message: params.progressMessage,
        metadata: buildStreamMetadata()
      });
    };
    try {
      streamMetadata.iterationId = orchestrationIteration.id;
      streamMetadata.stage = orchestrationIteration.stage;
      streamMetadata.role = orchestrationIteration.role;
      if (resumeState) {
        liveActiveQuestionSetId = resumeState.questionSet.id;
        liveActiveQuestionSetStatus = 'resuming';
        livePausedForUserInput = false;
        liveUnansweredRequiredQuestionCount = 0;
        await logAnalysisProgress('Resuming batch analysis after required user answers were submitted.', { eventType: 'stage_progress' }, {
          kbAccessMode,
          agentModelId,
          resumedQuestionSetId: resumeState.questionSet.id,
          resumedQuestionCount: resumeState.questions.length,
          resumeStage: resumeState.questionSet.resumeStage,
          resumeRole: resumeState.questionSet.resumeRole
        });
      } else {
        await logAnalysisProgress('Batch analysis iteration started.', { eventType: 'stage_progress' }, {
          kbAccessMode,
          agentModelId,
          uploadedPbiCount: Array.isArray((uploadedPbis as { rows?: unknown[] })?.rows) ? ((uploadedPbis as { rows?: unknown[] }).rows?.length ?? 0) : 0,
          prefetchedClusterCount: plannerPrefetch.topicClusters.length,
          prefetchedArticleMatchCount: plannerPrefetch.articleMatches.length,
          prefetchedRelationCount: plannerPrefetch.relationMatches.length
        });
      }
      let approvedPlanId: string | undefined;
      let resumeQuestionSetToResolve = resumeState?.questionSet.id;
      const runPlanningPass = async (
        attempt: number,
        priorPlanJson?: string,
        reviewDeltaJson?: string,
        resolvedUserAnswers?: BatchAnalysisQuestionAnswer[]
      ) => {
      const planningStage = attempt === 1 ? 'planning' : 'plan_revision';
      const planningSession = ensurePlanningSession('planner');
      liveSessionId = planningSession.sessionId;
      await logAnalysisProgress(
        attempt === 1 ? 'Planner attempt 1 started.' : `Planner revision attempt ${attempt} started.`,
        { stage: planningStage, role: 'planner' },
        {
          attempt,
          hasPriorPlan: Boolean(priorPlanJson),
          hasReviewDelta: Boolean(reviewDeltaJson)
        }
      );
      liveIteration = await batchAnalysisOrchestrator.transitionIteration({
        workspaceId: input.workspaceId,
        iterationId: orchestrationIteration.id,
        stage: planningStage,
        role: 'planner',
        summary: attempt === 1 ? 'Generating initial batch plan.' : `Revising plan after review feedback (attempt ${attempt}).`,
        agentModelId,
        sessionId: planningSession.sessionId
      });
      streamMetadata.stage = planningStage;
      streamMetadata.role = 'planner';
      liveStageStartedAtUtc = liveIteration.updatedAtUtc;
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.RUNNING,
        progress: 20,
        message: attempt === 1 ? 'Generating structured batch plan...' : `Revising plan (attempt ${attempt})...`,
        metadata: buildStreamMetadata()
      });

      const plannerPrompt = batchAnalysisOrchestrator.buildPlannerPrompt({
        batchContext,
        uploadedPbis,
        plannerPrefetch,
        priorPlan: priorPlanJson ? JSON.parse(priorPlanJson) : undefined,
        reviewDelta: reviewDeltaJson ? JSON.parse(reviewDeltaJson) : undefined,
        resolvedUserAnswers
      });

      let plannerResult: Awaited<ReturnType<typeof agentRuntime.runBatchAnalysis>>;
      try {
        plannerResult = await agentRuntime.runBatchAnalysis(
          {
            ...input,
            sessionId: planningSession.sessionId,
            kbAccessMode,
            agentRole: 'planner',
            sessionMode: 'plan',
            prompt: plannerPrompt
          },
          (stream: AgentStreamingPayload) => {
            emit({
              id: payload.jobId,
              command: payload.command,
              state: JobState.RUNNING,
              progress: 28,
              message: JSON.stringify(stream),
              metadata: buildStreamMetadata({ sessionId: stream.sessionId })
            });
          },
          isCancelled
        );
      } catch (error) {
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
      planningSessionId = plannerResult.sessionId;
      const parseDraftPlan = (resultText: string, sessionId?: string) =>
        batchAnalysisOrchestrator.parsePlannerResult({
          workspaceId: input.workspaceId,
          batchId: input.batchId,
          iteration: orchestrationIteration,
          resultText,
          agentModelId,
          sessionId,
          planVersion: attempt,
          supersedesPlanId: priorPlanJson ? (JSON.parse(priorPlanJson) as { id?: string }).id : undefined
        });

      let plannerResolution = await resolveBatchAnalysisResultText(
        agentRuntime,
        input.workspaceId,
        plannerResult.sessionId,
        plannerResult.resultPayload,
        'planner'
      );
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
            state: JobState.RUNNING,
            progress: 30,
            message: 'Planner hit a provider/runtime failure. Retrying in a fresh session...',
            metadata: buildStreamMetadata({ sessionId: plannerResult.sessionId })
          });
          plannerResult = await agentRuntime.runBatchAnalysis(
            {
              ...input,
              sessionId: planningSessionId,
              sessionReusePolicy: 'new_local_session',
              kbAccessMode,
              agentRole: 'planner',
              sessionMode: 'plan',
              prompt: plannerPrompt
            },
            (stream: AgentStreamingPayload) => {
              emit({
                id: payload.jobId,
                command: payload.command,
                state: JobState.RUNNING,
                progress: 31,
                message: JSON.stringify(stream),
                metadata: buildStreamMetadata({ sessionId: stream.sessionId })
              });
            },
            isCancelled
          );
          liveSessionId = plannerResult.sessionId;
          planningSessionId = plannerResult.sessionId;
          plannerResolution = await resolveBatchAnalysisResultText(
            agentRuntime,
            input.workspaceId,
            plannerResult.sessionId,
            plannerResult.resultPayload,
            'planner'
          );
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
            state: JobState.RUNNING,
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
          plannerResult = await agentRuntime.runBatchAnalysis(
            {
              ...input,
              sessionId: planningSessionId,
              sessionReusePolicy: 'reset_acp',
              kbAccessMode,
              agentRole: 'planner',
              sessionMode: 'plan',
              prompt: retryPrompt
            },
            (stream: AgentStreamingPayload) => {
              emit({
                id: payload.jobId,
                command: payload.command,
                state: JobState.RUNNING,
                progress: 31,
                message: JSON.stringify(stream),
                metadata: buildStreamMetadata({ sessionId: stream.sessionId })
              });
            },
            isCancelled
          );
          liveSessionId = plannerResult.sessionId;
          planningSessionId = plannerResult.sessionId;
          plannerResolution = await resolveBatchAnalysisResultText(
            agentRuntime,
            input.workspaceId,
            plannerResult.sessionId,
            plannerResult.resultPayload,
            'planner'
          );
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
            state: JobState.RUNNING,
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
      let draftPlan: BatchAnalysisPlan | null = null;
      try {
        draftPlan = parseDraftPlan(plannerText, plannerResult.sessionId);
      } catch (error) {
        const parseError = error instanceof Error ? error.message : 'Planner output could not be parsed';
        const locallySalvagedPlan =
          normalizeRecoveredJsonText(plannerText)
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
          } catch {
            salvageSucceeded = false;
          }
        }
        if (salvageSucceeded) {
          // Continue through the normal reviewer flow below using the locally salvaged plan.
        } else {
          const fallbackMessage = buildPlanHumanReviewMessage(
            'Planner returned incomplete output and could not be salvaged locally.'
          );
          emit({
            id: payload.jobId,
            command: payload.command,
            state: JobState.RUNNING,
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
      if (resumeState?.kind === 'planning' && resumeQuestionSetToResolve) {
        await workspaceRepository.resolveBatchAnalysisQuestionSet({
          workspaceId: input.workspaceId,
          questionSetId: resumeQuestionSetToResolve
        });
        liveActiveQuestionSetId = undefined;
        liveActiveQuestionSetStatus = 'resolved';
        livePausedForUserInput = false;
        liveUnansweredRequiredQuestionCount = 0;
        resumeQuestionSetToResolve = undefined;
        resumeState = null;
      }
      await logAnalysisProgress('Planner draft plan recorded.', { stage: planningStage, role: 'planner', sessionId: draftPlan.sessionId }, {
        attempt,
        planId: draftPlan.id,
        planVersion: draftPlan.planVersion,
        coverageCount: draftPlan.coverage.length,
        itemCount: draftPlan.items.length,
        openQuestionCount: draftPlan.openQuestions.length,
        structuredQuestionCount: draftPlan.questions?.length ?? 0
      });

      const planningReviewSession = ensurePlanningSession('plan-reviewer');
      liveSessionId = planningReviewSession.sessionId;
      liveIteration = await batchAnalysisOrchestrator.transitionIteration({
        workspaceId: input.workspaceId,
        iterationId: orchestrationIteration.id,
        stage: 'plan_reviewing',
        role: 'plan-reviewer',
        summary: 'Reviewing planner output for completeness and missed KB impact.',
        agentModelId,
        sessionId: planningReviewSession.sessionId
      });
      streamMetadata.stage = 'plan_reviewing';
      streamMetadata.role = 'plan-reviewer';
      liveStageStartedAtUtc = liveIteration.updatedAtUtc;
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.RUNNING,
        progress: 36,
        message: 'Reviewing plan for missed creates, edits, and target issues...',
        metadata: buildStreamMetadata()
      });
      const reviewCandidateQuestions = batchAnalysisOrchestrator.buildReviewCandidateQuestions({
        plan: draftPlan,
        plannerPrefetch
      });
      const reviewPrompt = batchAnalysisOrchestrator.buildPlanReviewerPrompt({
        batchContext,
        uploadedPbis,
        plan: draftPlan,
        plannerPrefetch,
        candidateQuestions: reviewCandidateQuestions
      });
      let reviewResult = await agentRuntime.runBatchAnalysis(
        {
          ...input,
          sessionId: planningReviewSession.sessionId,
          kbAccessMode,
          agentRole: 'plan-reviewer',
          sessionMode: 'plan',
          prompt: reviewPrompt
        },
        (stream: AgentStreamingPayload) => {
          emit({
            id: payload.jobId,
            command: payload.command,
            state: JobState.RUNNING,
            progress: 44,
            message: JSON.stringify(stream),
            metadata: buildStreamMetadata({ sessionId: stream.sessionId })
          });
        },
        isCancelled
      );
      liveSessionId = reviewResult.sessionId;
      planningSessionId = reviewResult.sessionId;
      let reviewResolution = await resolveBatchAnalysisResultText(
        agentRuntime,
        input.workspaceId,
        reviewResult.sessionId,
        reviewResult.resultPayload,
        'plan_review'
      );
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

        reviewResult = await agentRuntime.runBatchAnalysis(
          {
            ...input,
            sessionId: planningSessionId,
            sessionReusePolicy: 'reset_acp',
            kbAccessMode,
            agentRole: 'plan-reviewer',
            sessionMode: 'plan',
            prompt: reviewPrompt
          },
          (stream: AgentStreamingPayload) => {
            emit({
              id: payload.jobId,
              command: payload.command,
              state: JobState.RUNNING,
              progress: 44,
              message: JSON.stringify(stream),
              metadata: buildStreamMetadata({ sessionId: stream.sessionId })
            });
          },
          isCancelled
        );
        liveSessionId = reviewResult.sessionId;
        planningSessionId = reviewResult.sessionId;
        reviewResolution = await resolveBatchAnalysisResultText(
          agentRuntime,
          input.workspaceId,
          reviewResult.sessionId,
          reviewResult.resultPayload,
          'plan_review'
        );
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
      let review: BatchPlanReview;
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
      } catch (error) {
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
        candidateQuestions: reviewCandidateQuestions,
        plannerPrefetch,
        unresolvedTargetIssues: normalizedDraftPlanResult.unresolvedTargetIssues,
        unresolvedReferenceIssues: normalizedBatchReferences.unresolvedReferenceIssues
      });
      review = deterministicReviewGuard.review;
      if (deterministicReviewGuard.missingEditTargets.length > 0) {
        await logAnalysisProgress(
          'Deterministic prefetch surfaced advisory likely edit targets for reviewer visibility.',
          {
            stage: 'plan_reviewing',
            role: 'plan-reviewer',
            sessionId: review.sessionId
          },
          {
            attempt,
            advisoryOnly: true,
            missingEditTargets: deterministicReviewGuard.missingEditTargets,
            transitionReason: 'deterministic_prefetch_missing_edits_advisory'
          }
        );
      }
      if (deterministicReviewGuard.missingCreateTargets.length > 0) {
        await logAnalysisProgress(
          'Deterministic prefetch surfaced advisory likely net-new article work for reviewer visibility.',
          {
            stage: 'plan_reviewing',
            role: 'plan-reviewer',
            sessionId: review.sessionId
          },
          {
            attempt,
            advisoryOnly: true,
            missingCreateTargets: deterministicReviewGuard.missingCreateTargets,
            transitionReason: 'deterministic_prefetch_missing_creates_advisory'
          }
        );
      }
      if (deterministicReviewGuard.invalidCoverageReasons.length > 0) {
        await logAnalysisProgress(
          deterministicReviewGuard.forcedRevision
            ? 'Deterministic approval validation blocked approval because the plan still contained unresolved PBI coverage.'
            : 'Deterministic approval validation added unresolved PBI coverage issues to the review delta.',
          {
            stage: 'plan_reviewing',
            role: 'plan-reviewer',
            sessionId: review.sessionId
          },
          {
            attempt,
            forcedRevision: deterministicReviewGuard.forcedRevision,
            invalidCoverageReasons: deterministicReviewGuard.invalidCoverageReasons,
            transitionReason: deterministicReviewGuard.forcedRevision
              ? 'deterministic_unresolved_coverage_blocked_approval'
              : 'deterministic_unresolved_coverage_review_delta_augmented'
          }
        );
      }
      if (deterministicReviewGuard.unresolvedTargetIssues.length > 0) {
        await logAnalysisProgress(
          deterministicReviewGuard.forcedRevision
            ? 'Deterministic target validation blocked approval because the plan still referenced unresolved KB targets.'
            : 'Deterministic target validation added unresolved KB target corrections to the review delta.',
          {
            stage: 'plan_reviewing',
            role: 'plan-reviewer',
            sessionId: review.sessionId
          },
          {
            attempt,
            forcedRevision: deterministicReviewGuard.forcedRevision,
            unresolvedTargetIssues: deterministicReviewGuard.unresolvedTargetIssues,
            transitionReason: deterministicReviewGuard.forcedRevision
              ? 'deterministic_invalid_target_blocked_approval'
              : 'deterministic_invalid_target_review_delta_augmented'
          }
        );
      }
      if (deterministicReviewGuard.unresolvedReferenceIssues.length > 0) {
        await logAnalysisProgress(
          deterministicReviewGuard.forcedRevision
            ? 'Deterministic batch-reference validation blocked approval because the plan still referenced unresolved uploaded PBIs.'
            : 'Deterministic batch-reference validation added unresolved uploaded PBI corrections to the review delta.',
          {
            stage: 'plan_reviewing',
            role: 'plan-reviewer',
            sessionId: review.sessionId
          },
          {
            attempt,
            forcedRevision: deterministicReviewGuard.forcedRevision,
            unresolvedReferenceIssues: deterministicReviewGuard.unresolvedReferenceIssues,
            transitionReason: deterministicReviewGuard.forcedRevision
              ? 'deterministic_invalid_batch_reference_blocked_approval'
              : 'deterministic_invalid_batch_reference_review_delta_augmented'
          }
        );
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

      if (review.verdict === 'needs_user_input') {
        const questionSetCreatedAtUtc = new Date().toISOString();
        const blockingQuestions = deterministicReviewGuard.blockingUserInputQuestions.map((question) => ({
          ...question,
          id: question.id?.trim() ? question.id : randomUUID(),
          createdAtUtc: question.createdAtUtc ?? questionSetCreatedAtUtc
        }));
        const questionSet: BatchAnalysisQuestionSet = {
          id: randomUUID(),
          workspaceId: input.workspaceId,
          batchId: input.batchId,
          iterationId: orchestrationIteration.id,
          sourceStage: 'plan_reviewing',
          sourceRole: 'plan-reviewer',
          resumeStage: 'plan_revision',
          resumeRole: 'planner',
          status: 'waiting',
          summary: review.summary,
          planId: draftPlan.id,
          reviewId: review.id,
          createdAtUtc: questionSetCreatedAtUtc,
          updatedAtUtc: questionSetCreatedAtUtc
        };
        await pauseForUserInput({
          questionSet,
          questions: blockingQuestions,
          summary: review.summary,
          role: 'plan-reviewer',
          lastReviewVerdict: review.verdict,
          progressMessage: 'Batch analysis paused until required user questions are answered.',
          logMessage: 'Plan review paused execution pending required user input.',
          details: {
            attempt,
            reviewId: review.id,
            transitionReason: 'plan_review_needs_user_input',
            triggerBranch: 'review.verdict === needs_user_input',
            triggerArtifactType: 'question_set',
            triggerArtifactId: questionSet.id,
            triggerSessionId: review.sessionId,
            triggerVerdict: review.verdict,
            triggerSummary: review.summary
          }
        });
        return { needsUserInput: true as const, review, questionSet };
      }

      if (review.verdict === 'approved') {
        const reconciledApprovedDraftPlan = batchAnalysisOrchestrator.reconcilePlanQuestionState(
          draftPlan,
          review.questions ?? []
        );
        const approvedPlan = {
          ...reconciledApprovedDraftPlan,
          id: randomUUID(),
          verdict: 'approved' as const,
          createdAtUtc: new Date().toISOString(),
          supersedesPlanId: draftPlan.id
        };
        await batchAnalysisOrchestrator.recordPlan(approvedPlan);
        approvedPlanId = approvedPlan.id;
        await beginWorkerStage({
          stage: 'building',
          summary: 'Plan approved. Executing worker stage.',
          approvedPlanId: approvedPlan.id,
          lastReviewVerdict: review.verdict
        });
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

    let planningOutcome: { approvedPlan: BatchAnalysisPlan; review: BatchPlanReview } | null = null;
    let priorPlanJson: string | undefined;
    let reviewDeltaJson: string | undefined;
    const planningResolvedUserAnswers = resumeState?.kind === 'planning'
      ? resumeState.resolvedUserAnswers
      : undefined;
    const maxPlannerAttempts = 3;
    const planningStartAttempt = resumeState?.kind === 'planning' ? resumeState.nextAttempt : 1;
    const planningAttemptLimit = resumeState?.kind === 'planning'
      ? Math.max(maxPlannerAttempts, resumeState.nextAttempt + 1)
      : maxPlannerAttempts;
    priorPlanJson = resumeState?.kind === 'planning' ? resumeState.priorPlanJson : undefined;
    reviewDeltaJson = resumeState?.kind === 'planning' ? resumeState.reviewDeltaJson : undefined;
    for (let attempt = planningStartAttempt; attempt <= planningAttemptLimit; attempt += 1) {
      const outcome = await runPlanningPass(
        attempt,
        priorPlanJson,
        reviewDeltaJson,
        planningResolvedUserAnswers
      );
      if ('needsUserInput' in outcome) {
        return;
      }
      if ('approvedPlan' in outcome) {
        planningOutcome = outcome as { approvedPlan: BatchAnalysisPlan; review: BatchPlanReview };
        break;
      }
      priorPlanJson = JSON.stringify(outcome.draftPlan);
      reviewDeltaJson = outcome.review.delta ? JSON.stringify(outcome.review.delta) : undefined;
    }
    if (!planningOutcome?.approvedPlan || !approvedPlanId) {
      const humanReviewMessage = buildPlanHumanReviewMessage(
        'Planner/reviewer loop did not reach an approved plan within the revision limit.'
      );
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
        state: JobState.FAILED,
        progress: 100,
        message: humanReviewMessage,
        metadata: buildStreamMetadata()
      });
      return;
    }

      const runAnalysis = async (plan: BatchAnalysisPlan, extraInstructions?: string) => {
      const workerStageKbAccessMode = resolveStageKbAccessMode('worker');
      const workerStage = (streamMetadata.stage ?? liveIteration.stage) as Extract<BatchAnalysisStageStatus, 'building' | 'reworking'>;
      const workerSession = ensureWorkerSession(workerStage);
      liveSessionId = workerSession.sessionId;
      const promptTemplate = await batchAnalysisOrchestrator.buildWorkerPrompt(plan, extraInstructions ?? input.prompt);
      const startedAtUtc = new Date().toISOString();
      const stageRun = await workspaceRepository.recordBatchAnalysisStageRun({
        workspaceId: input.workspaceId,
        batchId: input.batchId,
        iterationId: liveIteration.id,
        iteration: liveIteration.iteration,
        stage: workerStage,
        role: 'worker',
        sessionReusePolicy: workerSession.reusePolicy,
        localSessionId: workerSession.sessionId,
        kbAccessMode: workerStageKbAccessMode,
        agentModelId,
        status: 'running',
        promptTemplate,
        message: `[${workerStage}/worker] running`,
        startedAtUtc
      });
      try {
        const result = await runBatchAnalysisWithStageWatchdog(
          agentRuntime,
          {
            ...input,
            sessionId: workerSession.sessionId,
            kbAccessMode: workerStageKbAccessMode,
            agentRole: 'worker',
            sessionMode: 'agent',
            timeoutMs: workerStageRunBudget.timeoutMs,
            prompt: promptTemplate
          },
          (stream: AgentStreamingPayload) => {
            emit({
              id: payload.jobId,
              command: payload.command,
              state: JobState.RUNNING,
              progress: stream.kind === 'result' ? 100 : 35,
              message: JSON.stringify(stream),
              metadata: buildStreamMetadata({ sessionId: stream.sessionId, kbAccessMode: workerStageKbAccessMode })
            });
          },
          isCancelled,
          {
            stage: workerStage,
            sessionId: workerSession.sessionId,
            watchdogMs: workerStageRunBudget.watchdogMs
          }
        );
        return {
          result,
          promptTemplate,
          workerStageKbAccessMode,
          workerStage,
          stageRunId: stageRun.id
        };
      } catch (error) {
        const inferredStatus = inferBatchStageFailureStatus(error);
        await workspaceRepository.updateBatchAnalysisStageRun({
          workspaceId: input.workspaceId,
          stageRunId: stageRun.id,
          localSessionId: workerSession.sessionId,
          kbAccessMode: workerStageKbAccessMode,
          agentModelId,
          status: inferredStatus === 'timeout' ? 'failed' : 'failed',
          promptTemplate,
          message: `[${workerStage}/worker] ${error instanceof Error ? error.message : String(error)}`,
          endedAtUtc: new Date().toISOString()
        });
        throw error;
      }
    };

    const executeWorkerPass = async (
      approvedPlan: BatchAnalysisPlan,
      extraInstructions?: string
    ): Promise<{
      result: Awaited<ReturnType<typeof agentRuntime.runBatchAnalysis>>;
      workerSummary: string;
      discoveredWork: ReturnType<typeof batchAnalysisOrchestrator.parseWorkerResult>['discoveredWork'];
    }> => {
      const workerAttempt = await runAnalysis(approvedPlan, extraInstructions);
      let workerResult = workerAttempt.result;
      let workerPromptTemplate = workerAttempt.promptTemplate;
      const workerStageKbAccessMode = workerAttempt.workerStageKbAccessMode;
      const workerStage = workerAttempt.workerStage;

      const workerResolution = await resolveBatchAnalysisResultText(
        agentRuntime,
        input.workspaceId,
        workerResult.sessionId,
        workerResult.resultPayload,
        'worker'
      );
      await persistBatchStageRun({
        stageRunId: workerAttempt.stageRunId,
        stage: workerStage,
        role: 'worker',
        stageKbAccessMode: workerStageKbAccessMode,
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
        kbAccessMode: workerStageKbAccessMode,
        status: workerResult.status
      });
      const workerFallbackSummary = workerResult.message ?? 'Worker pass completed.';
      const locallySalvagedWorker = extractJsonObject(workerResolution.text);
      let workerParsed: ReturnType<typeof batchAnalysisOrchestrator.parseWorkerResult>;
      try {
        workerParsed = batchAnalysisOrchestrator.parseWorkerResult(
          locallySalvagedWorker ? JSON.stringify(locallySalvagedWorker) : workerResolution.text,
          workerFallbackSummary,
          workerResult.sessionId
        );
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
      } catch (error) {
        const proposalRecords = await workspaceRepository.listBatchProposalRecords(input.workspaceId, input.batchId, {
          includeStaged: true,
          openOnly: true
        });
        const fallbackProposalQueue: ProposalReviewQueueItem[] = proposalRecords.map((proposal) => ({
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
      workerSessionId = workerResult.sessionId;
      return {
        result: workerResult,
        workerSummary: workerParsed.summary,
        discoveredWork: workerParsed.discoveredWork
      };
    };

    let workerPass = resumeState?.kind === 'amendment'
      ? {
          result: {
            sessionId: liveSessionId ?? planningSessionId ?? 'resume-amendment',
            kbAccessMode,
            status: 'ok' as const,
            startedAtUtc: new Date().toISOString(),
            endedAtUtc: new Date().toISOString(),
            transcriptPath: '',
            rawOutput: [],
            toolCalls: [],
            durationMs: 0,
            message: 'Resuming amendment review after required user answers.'
          },
          workerSummary: existingSnapshot.latestWorkerReport?.summary ?? 'Resuming amendment review after user answers.',
          discoveredWork: existingSnapshot.latestWorkerReport?.discoveredWork ?? resumeState.discoveredForAmendment
        }
      : await executeWorkerPass(planningOutcome.approvedPlan);

    const maxAmendmentLoops = 2;
    let amendmentLoops = resumeState?.kind === 'amendment'
      ? Math.max(0, resumeState.amendmentLoops - 1)
      : 0;
    const amendmentResolvedUserAnswers = resumeState?.kind === 'amendment'
      ? resumeState.resolvedUserAnswers
      : undefined;
    let activeApprovedPlan = resumeState?.kind === 'amendment'
      ? resumeState.activeApprovedPlan
      : planningOutcome.approvedPlan;
    let reusedWorkerReportForResume = resumeState?.kind === 'amendment' ? existingSnapshot.latestWorkerReport : null;
    while (workerPass.result.status === 'ok' && workerPass.discoveredWork.some((item) => item.requiresPlanAmendment)) {
      amendmentLoops += 1;
      const discoveredForAmendment = reusedWorkerReportForResume
        ? resumeState?.kind === 'amendment'
          ? resumeState.discoveredForAmendment
          : workerPass.discoveredWork.filter((item) => item.requiresPlanAmendment)
        : workerPass.discoveredWork.filter((item) => item.requiresPlanAmendment);
      await logAnalysisProgress('Worker discovered additional scope requiring plan amendment.', {
        stage: 'worker_discovery_review',
        role: 'planner',
        sessionId: workerPass.result.sessionId
      }, {
        discoveredCount: discoveredForAmendment.length,
        totalDiscoveredCount: workerPass.discoveredWork.length,
        amendmentLoop: amendmentLoops
      });
      const workerPassRecord = reusedWorkerReportForResume
        ? {
            workerReport: reusedWorkerReportForResume,
            executionCounts: liveExecutionCounts
          }
        : await batchAnalysisOrchestrator.recordWorkerPass({
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
      reusedWorkerReportForResume = null;

      const amendmentPlanningSession = ensurePlanningSession('planner');
      liveSessionId = amendmentPlanningSession.sessionId;
      liveIteration = await batchAnalysisOrchestrator.transitionIteration({
        workspaceId: input.workspaceId,
        iterationId: orchestrationIteration.id,
        stage: 'worker_discovery_review',
        role: 'planner',
        summary: 'Worker discovered additional scope. Reviewing amendment.',
        agentModelId,
        sessionId: amendmentPlanningSession.sessionId
      });
      streamMetadata.stage = 'worker_discovery_review';
      streamMetadata.role = 'planner';
      liveStageStartedAtUtc = liveIteration.updatedAtUtc;

      const amendmentId = randomUUID();
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
        state: JobState.RUNNING,
        progress: 68,
        message: `Reviewing ${discoveredForAmendment.length} discovered work item(s) before continuing execution...`,
        metadata: buildStreamMetadata()
      });

      const amendmentPlannerResult = await agentRuntime.runBatchAnalysis(
        {
          ...input,
          sessionId: amendmentPlanningSession.sessionId,
          kbAccessMode,
          agentRole: 'planner',
          sessionMode: 'plan',
          prompt: batchAnalysisOrchestrator.buildAmendmentPlannerPrompt({
            batchContext,
            uploadedPbis,
          approvedPlan: activeApprovedPlan,
          discoveredWork: discoveredForAmendment,
          plannerPrefetch,
          resolvedUserAnswers: amendmentResolvedUserAnswers
        })
        },
        (stream: AgentStreamingPayload) => {
          emit({
            id: payload.jobId,
            command: payload.command,
            state: JobState.RUNNING,
            progress: 72,
            message: JSON.stringify(stream),
            metadata: buildStreamMetadata({ sessionId: stream.sessionId })
          });
        },
        isCancelled
      );
      liveSessionId = amendmentPlannerResult.sessionId;
      planningSessionId = amendmentPlannerResult.sessionId;
      const amendmentPlannerResolution = await resolveBatchAnalysisResultText(
        agentRuntime,
        input.workspaceId,
        amendmentPlannerResult.sessionId,
        amendmentPlannerResult.resultPayload,
        'planner'
      );
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
      if (resumeState?.kind === 'amendment' && resumeQuestionSetToResolve) {
        await workspaceRepository.resolveBatchAnalysisQuestionSet({
          workspaceId: input.workspaceId,
          questionSetId: resumeQuestionSetToResolve
        });
        liveActiveQuestionSetId = undefined;
        liveActiveQuestionSetStatus = 'resolved';
        livePausedForUserInput = false;
        liveUnansweredRequiredQuestionCount = 0;
        resumeQuestionSetToResolve = undefined;
        resumeState = null;
      }

      const amendmentReviewSession = ensurePlanningSession('plan-reviewer');
      streamMetadata.role = 'plan-reviewer';
      liveSessionId = amendmentReviewSession.sessionId;
      const amendmentReviewCandidateQuestions = batchAnalysisOrchestrator.buildReviewCandidateQuestions({
        plan: amendmentDraftPlan,
        plannerPrefetch,
        existingQuestions: activeApprovedPlan.questions ?? [],
        discoveredWork: discoveredForAmendment
      });
      const amendmentReviewResult = await agentRuntime.runBatchAnalysis(
        {
          ...input,
          sessionId: amendmentReviewSession.sessionId,
          kbAccessMode,
          agentRole: 'plan-reviewer',
          sessionMode: 'plan',
          prompt: batchAnalysisOrchestrator.buildPlanReviewerPrompt({
            batchContext,
            uploadedPbis,
            plan: amendmentDraftPlan,
            plannerPrefetch,
            candidateQuestions: amendmentReviewCandidateQuestions
          })
        },
        (stream: AgentStreamingPayload) => {
          emit({
            id: payload.jobId,
            command: payload.command,
            state: JobState.RUNNING,
            progress: 76,
            message: JSON.stringify(stream),
            metadata: buildStreamMetadata({ role: 'plan-reviewer', sessionId: stream.sessionId })
          });
        },
        isCancelled
      );
      liveSessionId = amendmentReviewResult.sessionId;
      planningSessionId = amendmentReviewResult.sessionId;
      const amendmentReviewResolution = await resolveBatchAnalysisResultText(
        agentRuntime,
        input.workspaceId,
        amendmentReviewResult.sessionId,
        amendmentReviewResult.resultPayload,
        'plan_review'
      );
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
      const salvagedAmendmentReviewText =
        normalizedAmendmentReviewText
        ?? salvagePlanReviewJsonText(amendmentReviewResolution.text);
      let amendmentReview: BatchPlanReview;
      try {
        amendmentReview = batchAnalysisOrchestrator.parsePlanReviewResult({
          workspaceId: input.workspaceId,
          batchId: input.batchId,
          iteration: orchestrationIteration,
          plan: amendmentDraftPlan,
          resultText: salvagedAmendmentReviewText ?? amendmentReviewResolution.text,
          stage: 'worker_discovery_review',
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
      } catch (error) {
        const fallbackSummary = 'Amendment review output was malformed and could not be parsed safely.';
        amendmentReview = batchAnalysisOrchestrator.parsePlanReviewResult({
          workspaceId: input.workspaceId,
          batchId: input.batchId,
          iteration: orchestrationIteration,
          plan: amendmentDraftPlan,
          resultText: buildMalformedPlanReviewFallback(fallbackSummary),
          stage: 'worker_discovery_review',
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
        candidateQuestions: amendmentReviewCandidateQuestions,
        plannerPrefetch,
        unresolvedTargetIssues: normalizedAmendmentDraftPlanResult.unresolvedTargetIssues,
        unresolvedReferenceIssues: normalizedAmendmentBatchReferences.unresolvedReferenceIssues
      });
      amendmentReview = deterministicAmendmentReviewGuard.review;
      if (deterministicAmendmentReviewGuard.missingEditTargets.length > 0) {
        await logAnalysisProgress(
          'Deterministic prefetch surfaced advisory likely edit targets during amendment review.',
          {
            stage: 'worker_discovery_review',
            role: 'plan-reviewer',
            sessionId: amendmentReview.sessionId
          },
          {
            amendmentLoop: amendmentLoops,
            advisoryOnly: true,
            missingEditTargets: deterministicAmendmentReviewGuard.missingEditTargets,
            transitionReason: 'deterministic_prefetch_missing_edits_advisory'
          }
        );
      }
      if (deterministicAmendmentReviewGuard.missingCreateTargets.length > 0) {
        await logAnalysisProgress(
          'Deterministic prefetch surfaced advisory likely net-new article work during amendment review.',
          {
            stage: 'worker_discovery_review',
            role: 'plan-reviewer',
            sessionId: amendmentReview.sessionId
          },
          {
            amendmentLoop: amendmentLoops,
            advisoryOnly: true,
            missingCreateTargets: deterministicAmendmentReviewGuard.missingCreateTargets,
            transitionReason: 'deterministic_prefetch_missing_creates_advisory'
          }
        );
      }
      if (deterministicAmendmentReviewGuard.unresolvedTargetIssues.length > 0) {
        await logAnalysisProgress(
          deterministicAmendmentReviewGuard.forcedRevision
            ? 'Deterministic target validation blocked amendment approval because the plan still referenced unresolved KB targets.'
            : 'Deterministic target validation added unresolved KB target corrections to the amendment review delta.',
          {
            stage: 'worker_discovery_review',
            role: 'plan-reviewer',
            sessionId: amendmentReview.sessionId
          },
          {
            amendmentLoop: amendmentLoops,
            forcedRevision: deterministicAmendmentReviewGuard.forcedRevision,
            unresolvedTargetIssues: deterministicAmendmentReviewGuard.unresolvedTargetIssues,
            transitionReason: deterministicAmendmentReviewGuard.forcedRevision
              ? 'deterministic_invalid_target_blocked_approval'
              : 'deterministic_invalid_target_review_delta_augmented'
          }
        );
      }
      if (deterministicAmendmentReviewGuard.unresolvedReferenceIssues.length > 0) {
        await logAnalysisProgress(
          deterministicAmendmentReviewGuard.forcedRevision
            ? 'Deterministic batch-reference validation blocked amendment approval because the plan still referenced unresolved uploaded PBIs.'
            : 'Deterministic batch-reference validation added unresolved uploaded PBI corrections to the amendment review delta.',
          {
            stage: 'worker_discovery_review',
            role: 'plan-reviewer',
            sessionId: amendmentReview.sessionId
          },
          {
            amendmentLoop: amendmentLoops,
            forcedRevision: deterministicAmendmentReviewGuard.forcedRevision,
            unresolvedReferenceIssues: deterministicAmendmentReviewGuard.unresolvedReferenceIssues,
            transitionReason: deterministicAmendmentReviewGuard.forcedRevision
              ? 'deterministic_invalid_batch_reference_blocked_approval'
              : 'deterministic_invalid_batch_reference_review_delta_augmented'
          }
        );
      }
      await batchAnalysisOrchestrator.recordReview(amendmentReview);

      if (amendmentReview.verdict === 'needs_user_input') {
        const questionSetCreatedAtUtc = new Date().toISOString();
        const blockingQuestions = deterministicAmendmentReviewGuard.blockingUserInputQuestions.map((question) => ({
          ...question,
          id: question.id?.trim() ? question.id : randomUUID(),
          createdAtUtc: question.createdAtUtc ?? questionSetCreatedAtUtc
        }));
        const questionSet: BatchAnalysisQuestionSet = {
          id: randomUUID(),
          workspaceId: input.workspaceId,
          batchId: input.batchId,
          iterationId: orchestrationIteration.id,
          sourceStage: 'worker_discovery_review',
          sourceRole: 'plan-reviewer',
          resumeStage: 'worker_discovery_review',
          resumeRole: 'planner',
          status: 'waiting',
          summary: amendmentReview.summary,
          planId: amendmentDraftPlan.id,
          reviewId: amendmentReview.id,
          createdAtUtc: questionSetCreatedAtUtc,
          updatedAtUtc: questionSetCreatedAtUtc
        };
        await batchAnalysisOrchestrator.recordAmendment({
          id: randomUUID(),
          workspaceId: input.workspaceId,
          batchId: input.batchId,
          iterationId: orchestrationIteration.id,
          approvedPlanId: activeApprovedPlan.id,
          sourceWorkerReportId: workerPassRecord.workerReport.id,
          sourceDiscoveryIds: discoveredForAmendment.map((item) => item.discoveryId),
          proposedPlanId: amendmentDraftPlan.id,
          reviewId: amendmentReview.id,
          status: 'needs_user_input',
          summary: amendmentReview.summary,
          createdAtUtc: questionSetCreatedAtUtc,
          updatedAtUtc: questionSetCreatedAtUtc
        });
        await pauseForUserInput({
          questionSet,
          questions: blockingQuestions,
          summary: amendmentReview.summary,
          role: 'plan-reviewer',
          lastReviewVerdict: amendmentReview.verdict,
          progressMessage: 'Batch analysis paused until amendment questions are answered.',
          logMessage: 'Amendment review paused execution pending required user input.',
          details: {
            amendmentLoop: amendmentLoops,
            reviewId: amendmentReview.id,
            transitionReason: 'amendment_review_needs_user_input',
            triggerBranch: 'amendmentReview.verdict === needs_user_input',
            triggerArtifactType: 'question_set',
            triggerArtifactId: questionSet.id,
            triggerSessionId: amendmentReview.sessionId,
            triggerVerdict: amendmentReview.verdict,
            triggerSummary: amendmentReview.summary
          }
        });
        return;
      }

      if (amendmentReview.verdict !== 'approved') {
        const amendmentStatus = amendmentReview.verdict === 'needs_human_review' ? 'needs_human_review' : 'rejected';
        await batchAnalysisOrchestrator.recordAmendment({
          id: randomUUID(),
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
            batchId: input.batchId,
            discoveryIds: discoveredForAmendment.map((item) => item.discoveryId),
            status: 'rejected'
          });
          liveOutstandingDiscoveredWorkCount = Math.max(
            0,
            liveOutstandingDiscoveredWorkCount - discoveredForAmendment.length
          );
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
            state: JobState.FAILED,
            progress: 100,
            message: 'Worker discoveries require human review before execution can continue.',
            metadata: buildStreamMetadata()
          });
          return;
        }
        break;
      }

      const reconciledApprovedAmendmentDraftPlan = batchAnalysisOrchestrator.reconcilePlanQuestionState(
        amendmentDraftPlan,
        amendmentReview.questions ?? []
      );
      const approvedAmendmentPlan: BatchAnalysisPlan = {
        ...reconciledApprovedAmendmentDraftPlan,
        id: randomUUID(),
        verdict: 'approved',
        createdAtUtc: new Date().toISOString(),
        supersedesPlanId: amendmentDraftPlan.id
      };
      await batchAnalysisOrchestrator.recordPlan(approvedAmendmentPlan);
      await batchAnalysisOrchestrator.recordAmendment({
        id: randomUUID(),
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
        batchId: input.batchId,
        discoveryIds: discoveredForAmendment.map((item) => item.discoveryId),
        status: 'approved'
      });
      liveOutstandingDiscoveredWorkCount = Math.max(
        0,
        liveOutstandingDiscoveredWorkCount - discoveredForAmendment.length
      );

      activeApprovedPlan = approvedAmendmentPlan;
      approvedPlanId = approvedAmendmentPlan.id;
      const resumedWorkerSession = await beginWorkerStage({
        stage: 'building',
        summary: 'Plan amendment approved. Resuming worker execution.',
        approvedPlanId,
        lastReviewVerdict: amendmentReview.verdict
      });
      await logAnalysisProgress('Amendment approved; resuming worker execution.', {
        stage: 'building',
        role: 'worker',
        sessionId: resumedWorkerSession.sessionId
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
      workerPass = await executeWorkerPass(
        activeApprovedPlan,
        'Resume execution against the approved amended plan. Only execute work that remains pending or newly added.'
      );
    }

    emit({
      id: payload.jobId,
      command: payload.command,
      state: JobState.RUNNING,
      progress: 92,
      message: 'Finalizing analysis run...',
      metadata: buildStreamMetadata({
        status: workerPass.result.status,
        sessionId: workerPass.result.sessionId
      })
    });
    const primaryWorkerKbAccessMode = resolveStageKbAccessMode('worker');

    logger.info('[agent.analysis.run] runtime finished', {
      jobId: payload.jobId,
      batchId: input.batchId,
      status: workerPass.result.status,
      kbAccessMode: primaryWorkerKbAccessMode,
      toolCalls: workerPass.result.toolCalls.length,
      transcriptPath: workerPass.result.transcriptPath
    });
    await logAnalysisProgress('Primary worker runtime finished.', {
      stage: streamMetadata.stage,
      role: streamMetadata.role,
      sessionId: workerPass.result.sessionId
    }, {
      status: workerPass.result.status,
      kbAccessMode: primaryWorkerKbAccessMode,
      durationMs: workerPass.result.durationMs,
      toolCallCount: workerPass.result.toolCalls.length,
      transcriptPath: workerPass.result.transcriptPath
    });
    const persistedStatus =
      workerPass.result.status === 'ok'
        ? 'complete'
        : workerPass.result.status === 'canceled'
          ? 'canceled'
          : 'failed';
    await workspaceRepository.recordBatchAnalysisRun({
      workspaceId: input.workspaceId,
      batchId: input.batchId,
      sessionId: workerPass.result.sessionId,
      kbAccessMode: primaryWorkerKbAccessMode,
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
    workerSessionId = workerPass.result.sessionId;

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
      const proposalContext = await buildFinalReviewProposalContext(
        workspaceRepository,
        input.workspaceId,
        latestWorkerReport
      );
      const finalReviewPrompt = batchAnalysisOrchestrator.buildFinalReviewerPrompt({
        batchContext,
        uploadedPbis,
        approvedPlan: activeApprovedPlan,
        workerReport: latestWorkerReport,
        discoveredWork: latestWorkerReport.discoveredWork,
        proposalContext
      });
      const finalReviewStartedAtUtc = new Date().toISOString();
      let finalReviewResult: AgentRunResult;
      let finalReviewResolution: {
        text: string;
        usedTranscript: boolean;
        initialCandidateCount: number;
        transcriptCandidateCount: number;
        parseable: boolean;
        recoveryAbortReason?: string;
      };

      try {
        finalReviewResult = await runBatchAnalysisWithStageWatchdog(
          agentRuntime,
          {
            ...input,
            sessionId: finalReviewSession.id,
            kbAccessMode,
            agentRole: 'final-reviewer',
            sessionMode: 'plan',
            timeoutMs: FINAL_REVIEW_STAGE_TIMEOUT_MS,
            prompt: finalReviewPrompt
          },
          (stream: AgentStreamingPayload) => {
            emit({
              id: payload.jobId,
              command: payload.command,
              state: JobState.RUNNING,
              progress: 95,
              message: JSON.stringify(stream),
              metadata: buildStreamMetadata({ sessionId: stream.sessionId })
            });
          },
          isCancelled,
          {
            stage: 'final_reviewing',
            sessionId: finalReviewSession.id,
            watchdogMs: FINAL_REVIEW_STAGE_WATCHDOG_MS
          }
        );
        liveSessionId = finalReviewResult.sessionId;
        finalReviewResolution = await resolveBatchAnalysisResultText(
          agentRuntime,
          input.workspaceId,
          finalReviewResult.sessionId,
          finalReviewResult.resultPayload,
          'final_review'
        );
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
      } catch (error) {
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
        finalReviewResolution = await resolveBatchAnalysisResultText(
          agentRuntime,
          input.workspaceId,
          finalReviewSession.id,
          undefined,
          'final_review'
        );
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
      } catch (error) {
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
      await beginWorkerStage({
        stage: 'reworking',
        summary: 'Final review requested rework. Executing rework pass.',
        approvedPlanId: activeApprovedPlan.id,
        lastReviewVerdict: finalReviewOutcome.finalReview.verdict
      });
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
      workerSessionId = workerPass.result.sessionId;
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
      const proposalIdsToPromote = Array.from(
        new Set(
          latestWorkerReport.executedItems
            .filter((item) => item.status === 'executed')
            .flatMap((item) => [
              item.proposalId?.trim(),
              ...(item.artifactIds ?? []).map((artifactId) => artifactId.trim())
            ])
            .filter((proposalId): proposalId is string => Boolean(proposalId))
        )
      );
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
    } else if (
      finalReviewOutcome.finalReview.verdict === 'needs_human_review'
      || reworkLoops >= maxFinalReworkLoops
      || (finalReviewOutcome.finalReview.verdict === 'approved' && !hardGateValidation.ok)
    ) {
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
    } else {
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
        state:
          completedIteration.status === 'failed'
            ? JobState.FAILED
            : completedIteration.status === 'canceled'
              ? JobState.CANCELED
              : completedIteration.status === 'needs_human_review'
                ? JobState.FAILED
              : JobState.SUCCEEDED,
        progress: 100,
        message:
          completedIteration.status === 'needs_human_review'
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
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : String(error);
      const explicitTerminalError = error instanceof BatchAnalysisTerminalError ? error : null;
      const terminalStage: BatchAnalysisIterationRecord['stage'] =
        explicitTerminalError?.terminalStage
        ?? (
          liveIteration.stage === 'planning' || liveIteration.stage === 'plan_revision' || liveIteration.stage === 'plan_reviewing'
            ? 'needs_human_review'
            : liveIteration.stage === 'approved'
              ? 'failed'
              : liveIteration.stage
        );
      const terminalStatus: BatchAnalysisIterationRecord['status'] =
        explicitTerminalError?.terminalStatus
        ?? (terminalStage === 'needs_human_review' ? 'needs_human_review' : 'failed');
      logger.error('[agent.analysis.run] orchestration failed', {
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
        state: JobState.FAILED,
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
    let kbAccessMode: KbAccessMode;
    try {
      const kbAccessSelection = await requireHealthyKbAccessMode(input.workspaceId, input.kbAccessMode);
      kbAccessMode = kbAccessSelection.selectedMode;
    } catch (error) {
      const selectedMode =
        error instanceof KbAccessModePreflightError
          ? error.selection.selectedMode
          : selectKbAccessMode(input.kbAccessMode, await resolveWorkspaceKbAccessMode(input.workspaceId));
      emit({
        id: payload.jobId,
        command: payload.command,
        state: JobState.FAILED,
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
      state: JobState.RUNNING,
      progress: 20,
      message: `Starting article edit session for variant ${input.localeVariantId}`,
      metadata: {
        requestedKbAccessMode: kbAccessMode,
        kbAccessMode
      }
    });
    const result = await agentRuntime.runArticleEdit(
      { ...input, kbAccessMode },
      (stream: AgentStreamingPayload) => {
        emit({
          id: payload.jobId,
          command: payload.command,
          state: JobState.RUNNING,
          progress: stream.kind === 'result' ? 100 : 45,
          message: JSON.stringify(stream),
          metadata: {
            requestedKbAccessMode: kbAccessMode,
            kbAccessMode
          }
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
      message: result.message ?? 'article edit command complete',
      metadata: {
        requestedKbAccessMode: kbAccessMode,
        kbAccessMode
      }
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
    kbCliRuntime,
    batchAnalysisOrchestrator
  };
}
