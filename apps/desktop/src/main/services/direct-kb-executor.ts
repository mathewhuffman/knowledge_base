import type {
  ArticleDetailResponse,
  DirectActionType,
  DirectActionExecutionRequest,
  DirectActionExecutionResult,
  DirectActionRequest,
  DirectProposalMutationAction,
  KbAccessHealth,
  LocaleVariantRecord,
  PBIRecord,
  ProposalReviewStatus,
  RevisionHistoryResponse
} from '@kb-vault/shared-types';
import {
  DIRECT_ARTICLE_EDIT_ACTION_TYPES,
  DIRECT_ASSISTANT_READ_ACTION_TYPES,
  DIRECT_ASSISTANT_TEMPLATE_ACTION_TYPES,
  DIRECT_BATCH_READ_ONLY_ACTION_TYPES,
  DIRECT_BATCH_WORKER_ACTION_TYPES,
  ProposalAction,
  validateDirectActionArgs
} from '@kb-vault/shared-types';
import { KbActionService } from './kb-action-service';

const DIRECT_STAGE_ACTIONS: Record<string, ReadonlySet<DirectActionType>> = {
  planner: new Set(DIRECT_BATCH_READ_ONLY_ACTION_TYPES),
  'plan-reviewer': new Set(DIRECT_BATCH_READ_ONLY_ACTION_TYPES),
  worker: new Set(DIRECT_BATCH_WORKER_ACTION_TYPES),
  'final-reviewer': new Set(DIRECT_BATCH_READ_ONLY_ACTION_TYPES)
};

const DIRECT_ARTICLE_EDIT_ACTIONS = new Set<DirectActionType>(DIRECT_ARTICLE_EDIT_ACTION_TYPES);
const DIRECT_ASSISTANT_READ_ACTIONS = new Set<DirectActionType>(DIRECT_ASSISTANT_READ_ACTION_TYPES);
const DIRECT_ASSISTANT_TEMPLATE_ACTIONS = new Set<DirectActionType>(DIRECT_ASSISTANT_TEMPLATE_ACTION_TYPES);

interface DirectKbExecutorDeps {
  kbActionService: KbActionService;
}

export class DirectKbExecutor {
  constructor(private readonly deps: DirectKbExecutorDeps) {}

  async checkHealth(workspaceId?: string): Promise<KbAccessHealth> {
    if (!workspaceId?.trim()) {
      return {
        mode: 'direct',
        provider: 'direct',
        ok: false,
        message: 'Direct executor requires a workspace context',
        issues: ['Direct executor requires a workspace context']
      };
    }

    try {
      await this.deps.kbActionService.getExplorerTree(workspaceId);
      return {
        mode: 'direct',
        provider: 'direct',
        ok: true,
        message: 'Direct executor ready for assistant chat, article edit, and batch analysis'
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        mode: 'direct',
        provider: 'direct',
        ok: false,
        message: `Direct executor unavailable: ${message}`,
        issues: [message]
      };
    }
  }

  async execute(request: DirectActionExecutionRequest): Promise<DirectActionExecutionResult> {
    try {
      this.assertActionAllowed(request.action, request.context);
      const validationError = validateDirectActionArgs(request.action.type, request.action.args);
      if (validationError) {
        throw new Error(validationError);
      }
      const data = await this.dispatch(request);
      return {
        actionId: request.action.id,
        ok: true,
        data
      };
    } catch (error) {
      return {
        actionId: request.action.id,
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  private assertActionAllowed(action: DirectActionRequest, requestContext: DirectActionExecutionRequest['context']): void {
    const allowed = this.resolveAllowedActions(requestContext);
    if (!allowed?.has(action.type)) {
      const descriptor =
        requestContext.sessionType === 'assistant_chat'
          ? requestContext.directContext?.route
            ? `assistant route ${requestContext.directContext.route}`
            : 'assistant session'
          : requestContext.sessionType === 'article_edit'
            ? 'article edit session'
            : `role ${requestContext.agentRole ?? 'unknown'}`;
      throw new Error(`Direct action ${action.type} is not allowed for ${descriptor}`);
    }
  }

  private resolveAllowedActions(
    context: DirectActionExecutionRequest['context']
  ): ReadonlySet<DirectActionType> | null {
    if (context.sessionType === 'assistant_chat') {
      return context.directContext?.allowPatchForm
        ? DIRECT_ASSISTANT_TEMPLATE_ACTIONS
        : DIRECT_ASSISTANT_READ_ACTIONS;
    }
    if (context.sessionType === 'article_edit') {
      return DIRECT_ARTICLE_EDIT_ACTIONS;
    }
    if (context.sessionType === 'batch_analysis') {
      return context.agentRole ? DIRECT_STAGE_ACTIONS[context.agentRole] ?? null : null;
    }
    return context.agentRole ? DIRECT_STAGE_ACTIONS[context.agentRole] ?? null : null;
  }

  private async dispatch(request: DirectActionExecutionRequest): Promise<unknown> {
    const workspaceId = request.context.workspaceId;

    switch (request.action.type) {
      case 'search_kb':
        return this.deps.kbActionService.searchKb({
          workspaceId,
          ...request.action.args,
          localeVariantIds: this.mergeScopedIds(
            request.action.args.localeVariantIds,
            request.context.scope?.localeVariantIds,
            'localeVariantIds'
          ),
          familyIds: this.mergeScopedIds(
            request.action.args.familyIds,
            request.context.scope?.familyIds,
            'familyIds'
          )
        });

      case 'get_explorer_tree':
        return this.deps.kbActionService.getExplorerTree(workspaceId);

      case 'get_batch_context': {
        const batchId = this.requireBatchId(request.action.args.batchId, request.context.batchId);
        return this.deps.kbActionService.getBatchContext({ workspaceId, batchId });
      }

      case 'get_pbi': {
        const pbi = await this.deps.kbActionService.getPBI({
          workspaceId,
          pbiId: request.action.args.pbiId
        }) as PBIRecord;
        if (request.context.batchId && pbi.batchId !== request.context.batchId) {
          throw new Error(`Requested PBI ${pbi.id} is outside the active batch scope`);
        }
        return pbi;
      }

      case 'get_pbi_subset': {
        const batchId = this.requireBatchId(request.action.args.batchId, request.context.batchId);
        return this.deps.kbActionService.getPBISubset({
          workspaceId,
          batchId,
          rowNumbers: request.action.args.rowNumbers
        });
      }

      case 'get_article': {
        const detail = await this.deps.kbActionService.getArticle({
          workspaceId,
          revisionId: request.action.args.revisionId,
          localeVariantId: request.action.args.localeVariantId
        }) as ArticleDetailResponse;
        this.assertLocaleVariantAllowed(detail.localeVariant.id, request.context.scope?.localeVariantIds);
        this.assertFamilyAllowed(detail.familyId, request.context.scope?.familyIds);
        return detail;
      }

      case 'get_article_family': {
        this.assertFamilyAllowed(request.action.args.familyId, request.context.scope?.familyIds);
        return this.deps.kbActionService.getArticleFamily({
          workspaceId,
          familyId: request.action.args.familyId
        });
      }

      case 'get_locale_variant': {
        this.assertLocaleVariantAllowed(request.action.args.localeVariantId, request.context.scope?.localeVariantIds);
        const variant = await this.deps.kbActionService.getLocaleVariant({
          workspaceId,
          localeVariantId: request.action.args.localeVariantId
        }) as LocaleVariantRecord;
        this.assertFamilyAllowed(variant.familyId, request.context.scope?.familyIds);
        return variant;
      }

      case 'get_article_history': {
        this.assertLocaleVariantAllowed(request.action.args.localeVariantId, request.context.scope?.localeVariantIds);
        const history = await this.deps.kbActionService.getArticleHistory({
          workspaceId,
          localeVariantId: request.action.args.localeVariantId
        }) as RevisionHistoryResponse;
        this.assertLocaleVariantAllowed(history.localeVariantId, request.context.scope?.localeVariantIds);
        return history;
      }

      case 'find_related_articles': {
        if (request.action.args.articleId) {
          this.assertLocaleVariantAllowed(request.action.args.articleId, request.context.scope?.localeVariantIds);
        }
        if (request.action.args.familyId) {
          this.assertFamilyAllowed(request.action.args.familyId, request.context.scope?.familyIds);
        }
        if (!request.action.args.articleId && !request.action.args.familyId) {
          const hasScopedFamilies = (request.context.scope?.familyIds?.length ?? 0) > 0;
          const hasScopedVariants = (request.context.scope?.localeVariantIds?.length ?? 0) > 0;
          if (hasScopedFamilies || hasScopedVariants) {
            throw new Error('Scoped direct sessions must identify a family or article when requesting related articles');
          }
        }
        if (request.action.args.batchId) {
          this.requireBatchId(request.action.args.batchId, request.context.batchId);
        }
        return this.deps.kbActionService.findRelatedArticles({
          workspaceId,
          ...request.action.args
        });
      }

      case 'list_categories':
        return this.deps.kbActionService.listCategories({
          workspaceId,
          locale: request.action.args.locale
        });

      case 'list_sections':
        return this.deps.kbActionService.listSections({
          workspaceId,
          locale: request.action.args.locale,
          categoryId: request.action.args.categoryId
        });

      case 'list_article_templates':
        return this.deps.kbActionService.listArticleTemplates({
          workspaceId,
          locale: request.action.args.locale,
          includeInactive: request.action.args.includeInactive
        });

      case 'get_template':
        return this.deps.kbActionService.getTemplate({
          workspaceId,
          templatePackId: request.action.args.templatePackId
        });

      case 'record_agent_notes': {
        if (request.action.args.localeVariantId) {
          this.assertLocaleVariantAllowed(request.action.args.localeVariantId, request.context.scope?.localeVariantIds);
        }
        if (request.action.args.familyId) {
          this.assertFamilyAllowed(request.action.args.familyId, request.context.scope?.familyIds);
        }
        const batchId = request.action.args.batchId
          ? this.requireBatchId(request.action.args.batchId, request.context.batchId)
          : request.context.batchId;
        return this.deps.kbActionService.recordAgentNotes({
          workspaceId,
          sessionId: request.context.sessionId,
          note: request.action.args.note,
          metadata: request.action.args.metadata,
          batchId,
          localeVariantId: request.action.args.localeVariantId,
          familyId: request.action.args.familyId,
          pbiIds: request.action.args.pbiIds,
          rationale: request.action.args.rationale
        });
      }

      case 'create_proposals': {
        const batchId = this.requireBatchId(undefined, request.context.batchId);
        const proposals = request.action.args.proposals;
        if (!Array.isArray(proposals) || proposals.length === 0) {
          throw new Error('create_proposals requires at least one proposal item');
        }

        for (const proposal of proposals) {
          const action = this.normalizeProposalMutationAction(proposal.action);
          if (proposal.localeVariantId) {
            this.assertLocaleVariantAllowed(proposal.localeVariantId, request.context.scope?.localeVariantIds);
          }
          if (proposal.familyId) {
            this.assertFamilyAllowed(proposal.familyId, request.context.scope?.familyIds);
          }
          if (
            (action === ProposalAction.EDIT || action === ProposalAction.RETIRE)
            && !proposal.localeVariantId?.trim()
            && !proposal.familyId?.trim()
            && !proposal.targetTitle?.trim()
          ) {
            throw new Error(`${action} proposals require a localeVariantId, familyId, or targetTitle`);
          }
        }

        return this.deps.kbActionService.createProposals({
          workspaceId,
          batchId,
          sessionId: request.context.sessionId,
          sessionMode: request.context.sessionMode,
          agentRole: request.context.agentRole,
          reviewStatus: 'staged_analysis' as ProposalReviewStatus,
          originPath: 'batch_analysis',
          proposals
        });
      }

      case 'patch_form': {
        const directContext = request.context.directContext;
        if (
          !directContext?.allowPatchForm
          || !directContext.route
          || !directContext.entityType
          || !directContext.entityId
        ) {
          throw new Error('patch_form is not available for this direct session');
        }
        if (!request.action.args.patch || typeof request.action.args.patch !== 'object' || Array.isArray(request.action.args.patch)) {
          throw new Error('patch_form requires a structured patch object');
        }
        return this.deps.kbActionService.patchAppForm({
          workspaceId,
          route: directContext.route,
          entityType: directContext.entityType,
          entityId: directContext.entityId,
          versionToken: directContext.workingStateVersionToken,
          patch: request.action.args.patch
        });
      }

      default:
        throw new Error(`Unsupported direct action ${(request.action as { type?: string }).type ?? 'unknown'}`);
    }
  }

  private requireBatchId(requestedBatchId: string | undefined, scopedBatchId?: string): string {
    const normalizedRequested = requestedBatchId?.trim();
    const normalizedScoped = scopedBatchId?.trim();

    if (normalizedScoped && normalizedRequested && normalizedRequested !== normalizedScoped) {
      throw new Error(`Requested batch ${normalizedRequested} is outside the active batch scope`);
    }
    if (normalizedScoped) {
      return normalizedScoped;
    }
    if (normalizedRequested) {
      return normalizedRequested;
    }
    throw new Error('Direct batch action requires a batchId');
  }

  private mergeScopedIds(
    requested: string[] | undefined,
    allowed: string[] | undefined,
    label: string
  ): string[] | undefined {
    if (!allowed?.length) {
      return requested;
    }

    if (!requested?.length) {
      return [...allowed];
    }

    const allowedSet = new Set(allowed);
    const normalizedRequested = requested.filter(Boolean);
    const outOfScope = normalizedRequested.filter((value) => !allowedSet.has(value));
    if (outOfScope.length > 0) {
      throw new Error(`Requested ${label} are outside the active scope: ${outOfScope.join(', ')}`);
    }
    return normalizedRequested;
  }

  private assertLocaleVariantAllowed(localeVariantId: string, allowedLocaleVariantIds?: string[]): void {
    if (!allowedLocaleVariantIds?.length) {
      return;
    }
    if (!allowedLocaleVariantIds.includes(localeVariantId)) {
      throw new Error(`Locale variant ${localeVariantId} is outside the active direct-action scope`);
    }
  }

  private assertFamilyAllowed(familyId: string, allowedFamilyIds?: string[]): void {
    if (!allowedFamilyIds?.length) {
      return;
    }
    if (!allowedFamilyIds.includes(familyId)) {
      throw new Error(`Article family ${familyId} is outside the active direct-action scope`);
    }
  }

  private normalizeProposalMutationAction(action: string): DirectProposalMutationAction {
    if (action === ProposalAction.CREATE || action === ProposalAction.EDIT || action === ProposalAction.RETIRE) {
      return action;
    }
    throw new Error(`Unsupported proposal mutation action ${action}`);
  }
}
