import { createHash } from 'node:crypto';
import {
  ProposalAction,
  ProposalReviewStatus
} from '@kb-vault/shared-types';
import type {
  AgentSessionMode,
  BatchAnalysisAgentRole,
  DirectCreateProposalInput,
  DirectCreateProposalsResult,
  MCPSearchKbInput,
  MCPGetArticleInput,
  MCPGetArticleFamilyInput,
  MCPGetLocaleVariantInput,
  MCPAppGetFormSchemaInput,
  MCPAppPatchFormInput,
  MCPFindRelatedArticlesInput,
  MCPListCategoriesInput,
  MCPListSectionsInput,
  MCPListArticleTemplatesInput,
  MCPGetTemplateInput,
  MCPGetBatchContextInput,
  MCPGetPBIInput,
  MCPGetPBISubsetInput,
  MCPGetArticleHistoryInput,
  MCPRecordAgentNotesInput,
  ProposalPlacementSuggestion,
  ProposalReviewRecord,
  ZendeskCategoryRecord,
  ZendeskSectionRecord,
  ExplorerNode
} from '@kb-vault/shared-types';
import type { ZendeskClient } from '@kb-vault/zendesk-client';
import { applyAppWorkingStatePatch } from './proposal-working-state';
import { AppWorkingStateService } from './app-working-state-service';
import { WorkspaceRepository } from './workspace-repository';

interface KbActionServiceDeps {
  workspaceRepository: WorkspaceRepository;
  appWorkingStateService: AppWorkingStateService;
  buildZendeskClient: (workspaceId: string) => Promise<ZendeskClient>;
}

interface CreateProposalInput {
  workspaceId: string;
  batchId: string;
  sessionId?: string;
  reviewStatus: ProposalReviewStatus;
  action: ProposalAction;
  idempotencyKey?: string;
  familyId?: string;
  localeVariantId?: string;
  sourceRevisionId?: string;
  targetTitle?: string;
  targetLocale?: string;
  confidenceScore?: number;
  note?: string;
  rationale?: string;
  rationaleSummary?: string;
  aiNotes?: string;
  suggestedPlacement?: ProposalPlacementSuggestion;
  sourceHtml?: string;
  proposedHtml?: string;
  relatedPbiIds?: string[];
  metadata?: unknown;
  originPath?: 'batch_analysis' | 'assistant';
}

interface CreateProposalsInput {
  workspaceId: string;
  batchId: string;
  sessionId: string;
  sessionMode?: AgentSessionMode;
  agentRole?: BatchAnalysisAgentRole;
  reviewStatus: ProposalReviewStatus;
  proposals: DirectCreateProposalInput[];
  originPath?: 'batch_analysis' | 'assistant';
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeProposalAction(action: string): ProposalAction {
  if (action === ProposalAction.CREATE || action === ProposalAction.EDIT || action === ProposalAction.RETIRE) {
    return action;
  }
  throw new Error(`Unsupported proposal mutation action ${action}`);
}

function normalizeRelatedPbiIds(values?: string[]): string[] | undefined {
  if (!values?.length) {
    return undefined;
  }
  const normalized = Array.from(new Set(
    values.map((value) => value.trim()).filter(Boolean)
  )).sort((left, right) => left.localeCompare(right));
  return normalized.length > 0 ? normalized : undefined;
}

function buildCreateProposalIdempotencyKey(params: {
  workspaceId: string;
  batchId: string;
  sessionId: string;
  sessionMode?: AgentSessionMode;
  agentRole?: BatchAnalysisAgentRole;
  proposal: DirectCreateProposalInput;
}): string {
  const normalized = {
    workspaceId: params.workspaceId.trim(),
    batchId: params.batchId.trim(),
    sessionId: params.sessionId.trim(),
    sessionMode: params.sessionMode?.trim() ?? '',
    agentRole: params.agentRole?.trim() ?? '',
    proposal: {
      itemId: params.proposal.itemId?.trim() ?? '',
      action: normalizeProposalAction(params.proposal.action),
      familyId: params.proposal.familyId?.trim() ?? '',
      localeVariantId: params.proposal.localeVariantId?.trim() ?? '',
      sourceRevisionId: params.proposal.sourceRevisionId?.trim() ?? '',
      targetTitle: params.proposal.targetTitle?.trim() ?? '',
      targetLocale: params.proposal.targetLocale?.trim() ?? '',
      confidenceScore: typeof params.proposal.confidenceScore === 'number' ? params.proposal.confidenceScore : null,
      note: params.proposal.note?.trim() ?? '',
      rationale: params.proposal.rationale?.trim() ?? '',
      rationaleSummary: params.proposal.rationaleSummary?.trim() ?? '',
      aiNotes: params.proposal.aiNotes?.trim() ?? '',
      suggestedPlacement: params.proposal.suggestedPlacement ?? null,
      sourceHtml: params.proposal.sourceHtml?.trim() ?? '',
      proposedHtml: params.proposal.proposedHtml?.trim() ?? '',
      relatedPbiIds: normalizeRelatedPbiIds(params.proposal.relatedPbiIds) ?? [],
      metadata:
        params.proposal.metadata && typeof params.proposal.metadata === 'object' && !Array.isArray(params.proposal.metadata)
          ? params.proposal.metadata as Record<string, unknown>
          : {}
    }
  };

  return createHash('sha256').update(stableStringify(normalized)).digest('hex');
}

export class KbActionService {
  constructor(private readonly deps: KbActionServiceDeps) {}

  async searchKb(input: MCPSearchKbInput): Promise<unknown> {
    return this.deps.workspaceRepository.searchArticles(input.workspaceId, {
      workspaceId: input.workspaceId,
      query: input.query,
      localeVariantIds: input.localeVariantIds,
      familyIds: input.familyIds,
      revisionIds: input.revisionIds,
      scope: 'all',
      includeArchived: input.includeArchived ?? true
    });
  }

  async getExplorerTree(workspaceId: string): Promise<ExplorerNode[]> {
    return this.deps.workspaceRepository.getExplorerTree(workspaceId);
  }

  async getArticle(input: MCPGetArticleInput): Promise<unknown> {
    return this.deps.workspaceRepository.getArticleDetail(input.workspaceId, {
      workspaceId: input.workspaceId,
      revisionId: input.revisionId,
      localeVariantId: input.localeVariantId,
      includePublishLog: true,
      includeLineage: true
    });
  }

  async getArticleFamily(input: MCPGetArticleFamilyInput): Promise<unknown> {
    return this.deps.workspaceRepository.getArticleFamily(input.workspaceId, input.familyId);
  }

  async getLocaleVariant(input: MCPGetLocaleVariantInput): Promise<unknown> {
    return this.deps.workspaceRepository.getLocaleVariant(input.workspaceId, input.localeVariantId);
  }

  async getAppFormSchema(input: MCPAppGetFormSchemaInput): Promise<unknown> {
    return this.deps.appWorkingStateService.getFormSchema(input);
  }

  async patchAppForm(input: MCPAppPatchFormInput): Promise<unknown> {
    return applyAppWorkingStatePatch({
      workspaceRepository: this.deps.workspaceRepository,
      appWorkingStateService: this.deps.appWorkingStateService,
      request: input
    });
  }

  async findRelatedArticles(input: MCPFindRelatedArticlesInput): Promise<unknown> {
    if (input.query?.trim() && !input.articleId && !input.familyId && !input.batchId) {
      return this.deps.workspaceRepository.queryArticleRelationCoverage({
        workspaceId: input.workspaceId,
        query: input.query.trim(),
        maxResults: input.max,
        minScore: input.minScore,
        includeEvidence: input.includeEvidence
      });
    }

    if (input.articleId || input.familyId || input.batchId) {
      return this.deps.workspaceRepository.listArticleRelations(input.workspaceId, {
        workspaceId: input.workspaceId,
        localeVariantId: input.articleId,
        familyId: input.familyId,
        batchId: input.batchId,
        limit: input.max,
        minScore: input.minScore,
        includeEvidence: input.includeEvidence
      });
    }

    return {
      workspaceId: input.workspaceId,
      engineVersion: 'article-relations-v2',
      results: []
    };
  }

  async listCategories(input: MCPListCategoriesInput): Promise<unknown> {
    const client = await this.deps.buildZendeskClient(input.workspaceId);
    const categories = await client.listCategories(input.locale.trim()) as unknown as ZendeskCategoryRecord[];
    return {
      ok: true,
      workspaceId: input.workspaceId,
      locale: input.locale,
      categories
    };
  }

  async listSections(input: MCPListSectionsInput): Promise<unknown> {
    const client = await this.deps.buildZendeskClient(input.workspaceId);
    const sections = await client.listSections(input.categoryId, input.locale.trim()) as unknown as ZendeskSectionRecord[];
    return {
      ok: true,
      workspaceId: input.workspaceId,
      locale: input.locale,
      categoryId: input.categoryId,
      sections
    };
  }

  async listArticleTemplates(input: MCPListArticleTemplatesInput): Promise<unknown> {
    const templates = await this.deps.workspaceRepository.listTemplatePacks(input.workspaceId);
    return { workspaceId: input.workspaceId, templates };
  }

  async getTemplate(input: MCPGetTemplateInput): Promise<unknown> {
    return this.deps.workspaceRepository.getTemplatePack(input.workspaceId, input.templatePackId);
  }

  async getBatchContext(input: MCPGetBatchContextInput): Promise<unknown> {
    const context = await this.deps.workspaceRepository.getBatchContext(input.workspaceId, input.batchId);
    if (!context) {
      throw new Error('batch not found');
    }
    return context;
  }

  async getPBI(input: MCPGetPBIInput): Promise<unknown> {
    const pbi = await this.deps.workspaceRepository.getPBIRecord(input.workspaceId, input.pbiId);
    if (!pbi) {
      throw new Error('pbi not found');
    }
    return pbi;
  }

  async getPBISubset(input: MCPGetPBISubsetInput): Promise<unknown> {
    return this.deps.workspaceRepository.getPBISubset(input.workspaceId, input.batchId, input.rowNumbers);
  }

  async getArticleHistory(input: MCPGetArticleHistoryInput): Promise<unknown> {
    return this.deps.workspaceRepository.getHistory(input.workspaceId, input.localeVariantId);
  }

  async recordAgentNotes(input: MCPRecordAgentNotesInput & { idempotencyKey?: string }): Promise<unknown> {
    return this.deps.workspaceRepository.recordAgentNotes(input);
  }

  async createProposal(input: CreateProposalInput): Promise<ProposalReviewRecord> {
    return await this.deps.workspaceRepository.createAgentProposal({
      workspaceId: input.workspaceId,
      batchId: input.batchId,
      action: input.action,
      reviewStatus: input.reviewStatus,
      _sessionId: input.sessionId,
      idempotencyKey: input.idempotencyKey,
      originPath: input.originPath ?? 'batch_analysis',
      familyId: input.familyId,
      localeVariantId: input.localeVariantId,
      sourceRevisionId: input.sourceRevisionId,
      targetTitle: input.targetTitle,
      targetLocale: input.targetLocale,
      confidenceScore: input.confidenceScore,
      note: input.note,
      rationale: input.rationale,
      rationaleSummary: input.rationaleSummary,
      aiNotes: input.aiNotes,
      suggestedPlacement: input.suggestedPlacement,
      sourceHtml: input.sourceHtml,
      proposedHtml: input.proposedHtml,
      relatedPbiIds: input.relatedPbiIds,
      metadata: input.metadata
    });
  }

  async createProposals(input: CreateProposalsInput): Promise<DirectCreateProposalsResult> {
    const proposals = input.proposals ?? [];
    if (proposals.length === 0) {
      throw new Error('create_proposals requires at least one proposal item');
    }

    const created = await Promise.all(
      proposals.map(async (proposal) => {
        const action = normalizeProposalAction(proposal.action);
        const idempotencyKey = buildCreateProposalIdempotencyKey({
          workspaceId: input.workspaceId,
          batchId: input.batchId,
          sessionId: input.sessionId,
          sessionMode: input.sessionMode,
          agentRole: input.agentRole,
          proposal
        });
        const record = await this.createProposal({
          workspaceId: input.workspaceId,
          batchId: input.batchId,
          sessionId: input.sessionId,
          reviewStatus: input.reviewStatus,
          action,
          idempotencyKey,
          familyId: proposal.familyId,
          localeVariantId: proposal.localeVariantId,
          sourceRevisionId: proposal.sourceRevisionId,
          targetTitle: proposal.targetTitle,
          targetLocale: proposal.targetLocale,
          confidenceScore: proposal.confidenceScore,
          note: proposal.note,
          rationale: proposal.rationale,
          rationaleSummary: proposal.rationaleSummary,
          aiNotes: proposal.aiNotes,
          suggestedPlacement: proposal.suggestedPlacement,
          sourceHtml: proposal.sourceHtml,
          proposedHtml: proposal.proposedHtml,
          relatedPbiIds: normalizeRelatedPbiIds(proposal.relatedPbiIds),
          metadata: proposal.metadata,
          originPath: input.originPath
        });

        return {
          itemId: proposal.itemId,
          proposalId: record.id,
          action: proposal.action,
          targetTitle: record.targetTitle ?? proposal.targetTitle,
          targetLocale: record.targetLocale ?? proposal.targetLocale,
          localeVariantId: record.localeVariantId ?? proposal.localeVariantId,
          familyId: record.familyId ?? proposal.familyId,
          reviewStatus: record.reviewStatus,
          idempotencyKey
        };
      })
    );

    return {
      workspaceId: input.workspaceId,
      batchId: input.batchId,
      sessionId: input.sessionId,
      proposals: created
    };
  }
}
