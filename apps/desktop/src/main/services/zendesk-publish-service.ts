import {
  DraftBranchStatus,
  DraftValidationCode,
  DraftValidationSeverity,
  JobState,
  PublishJobItemState,
  PublishStatus,
  type JobEvent,
  type WorkspaceSettingsRecord,
  type ZendeskPublishRunRequest,
  type ZendeskPublishTarget,
  type ZendeskPublishValidateRequest,
  type ZendeskPublishValidateResponse,
  type ZendeskPublishValidationIssue,
  type ZendeskPublishValidationItem,
  ZendeskPublishValidationCode
} from '@kb-vault/shared-types';
import {
  ZendeskApiError,
  type ZendeskGuideMedia,
  type ZendeskHelpCenterLocale,
  type ZendeskTranslationPayload,
  ZendeskClient
} from '@kb-vault/zendesk-client';
import { logger } from './logger';
import { WorkspaceRepository } from './workspace-repository';

type BuildZendeskClient = (workspaceId: string) => Promise<ZendeskClient>;

interface PublishableValidationContext {
  workspaceId: string;
  client?: ZendeskClient;
  remoteLocales: Set<string> | null;
  clientError?: string;
}

interface PublishExecutionResult {
  zendeskArticleId: string;
  zendeskSourceArticleId: string;
  externalKey: string;
  remoteUpdatedAtUtc?: string;
  remoteSectionId?: string;
  remoteCategoryId?: string;
  resultMessage: string;
  publishedHtml: string;
}

interface ResolvedPublishSection {
  categoryId?: number;
  sectionId: number;
}

interface PublishExecutionContext {
  publishTarget: ZendeskPublishTarget;
  settings: WorkspaceSettingsRecord;
}

function parseZendeskArticleId(externalKey?: string): number | undefined {
  const normalized = externalKey?.trim();
  if (!normalized?.startsWith('hc:')) {
    return undefined;
  }
  const raw = normalized.slice(3);
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeLocale(value?: string | null): string {
  return value?.trim().toLowerCase() ?? '';
}

function normalizeHtmlForConflict(value?: string | null): string {
  return (value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePositiveInteger(value?: string | number | null): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function issueHasError(issue: ZendeskPublishValidationIssue): boolean {
  return issue.severity === DraftValidationSeverity.ERROR;
}

function itemHasWarnings(item: ZendeskPublishValidationItem): boolean {
  return item.issues.some((issue) => issue.severity === DraftValidationSeverity.WARNING);
}

function canPublishItem(
  item: ZendeskPublishValidationItem,
  publishTarget: ZendeskPublishTarget,
  settings: WorkspaceSettingsRecord
): boolean {
  if (!item.canPublish) {
    return false;
  }
  if (publishTarget === 'live' && settings.zendeskBlockLiveOnWarnings && itemHasWarnings(item)) {
    return false;
  }
  return true;
}

function buildItemStatus(
  item: ZendeskPublishValidationItem,
  publishTarget: ZendeskPublishTarget,
  settings: WorkspaceSettingsRecord
): PublishJobItemState {
  const hasConflict = item.issues.some((issue) => issue.code === ZendeskPublishValidationCode.REMOTE_CONFLICT);
  if (canPublishItem(item, publishTarget, settings)) {
    return PublishJobItemState.QUEUED;
  }
  return hasConflict ? PublishJobItemState.CONFLICTED : PublishJobItemState.BLOCKED;
}

function summarizeValidation(items: ZendeskPublishValidationItem[]): ZendeskPublishValidateResponse['summary'] {
  return items.reduce<ZendeskPublishValidateResponse['summary']>((summary, item) => {
    summary.total += 1;
    if (item.canPublish) {
      summary.publishable += 1;
    } else {
      summary.blocked += 1;
    }
    if (item.issues.some((issue) => issue.code === ZendeskPublishValidationCode.REMOTE_CONFLICT)) {
      summary.conflicts += 1;
    }
    if (item.issues.some((issue) => issue.severity === DraftValidationSeverity.WARNING)) {
      summary.warnings += 1;
    }
    return summary;
  }, {
    total: 0,
    publishable: 0,
    blocked: 0,
    conflicts: 0,
    warnings: 0
  });
}

function mapDraftValidationIssue(
  warning: { code: DraftValidationCode; severity: DraftValidationSeverity; message: string; detail?: string },
  settings: WorkspaceSettingsRecord
): ZendeskPublishValidationIssue | null {
  if (warning.code === DraftValidationCode.UNRESOLVED_PLACEHOLDER) {
    if (settings.zendeskPlaceholderAssetPolicy === 'upload') {
      return {
        code: ZendeskPublishValidationCode.DRAFT_VALIDATION,
        severity: DraftValidationSeverity.INFO,
        message: 'Placeholder image tokens will be rendered and uploaded to Zendesk during publish.',
        detail: warning.detail,
        sourceCode: warning.code
      };
    }
    return {
      code: ZendeskPublishValidationCode.PLACEHOLDER_BLOCKED,
      severity: DraftValidationSeverity.ERROR,
      message: 'Publish is blocked until placeholder content is replaced with final article HTML.',
      detail: warning.detail,
      sourceCode: warning.code
    };
  }

  if (warning.code === DraftValidationCode.MISSING_PLACEMENT) {
    return null;
  }

  if (warning.code === DraftValidationCode.LOCALE_ISSUE) {
    return {
      code: ZendeskPublishValidationCode.LOCALE_DISABLED,
      severity: DraftValidationSeverity.ERROR,
      message: warning.message,
      detail: warning.detail,
      sourceCode: warning.code
    };
  }

  return {
    code: ZendeskPublishValidationCode.DRAFT_VALIDATION,
    severity: warning.severity,
    message: warning.message,
    detail: warning.detail,
    sourceCode: warning.code
  };
}

function normalizeNameForLookup(value?: string | null): string {
  return value?.trim().toLowerCase() ?? '';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function placeholderFileName(description: string, locale: string, index: number): string {
  const base = description
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'placeholder';
  return `${base}-${locale}-${index + 1}.svg`;
}

function buildPlaceholderSvg(description: string): string {
  const lines = wrapPlaceholderText(description.trim() || 'Placeholder image');
  const lineHeight = 28;
  const width = 1280;
  const height = 720;
  const firstY = 300 - ((lines.length - 1) * lineHeight) / 2;
  const text = lines.map((line, index) => (
    `<text x="640" y="${firstY + (index * lineHeight)}" text-anchor="middle" font-size="28" font-family="Arial, sans-serif" fill="#0f172a">${escapeHtml(line)}</text>`
  )).join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<defs><linearGradient id="bg" x1="0%" x2="100%" y1="0%" y2="100%"><stop offset="0%" stop-color="#f8fafc"/><stop offset="100%" stop-color="#dbeafe"/></linearGradient></defs>',
    '<rect width="1280" height="720" fill="url(#bg)"/>',
    '<rect x="48" y="48" width="1184" height="624" rx="28" fill="#ffffff" stroke="#94a3b8" stroke-width="4" stroke-dasharray="18 12"/>',
    '<text x="640" y="170" text-anchor="middle" font-size="42" font-family="Arial, sans-serif" fill="#1d4ed8">KB Vault Placeholder Image</text>',
    '<text x="640" y="225" text-anchor="middle" font-size="20" font-family="Arial, sans-serif" fill="#475569">Replace this generated placeholder with the final screenshot or illustration when ready.</text>',
    text,
    '</svg>'
  ].join('');
}

function wrapPlaceholderText(value: string): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return ['Placeholder image'];
  }
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > 56 && current) {
      lines.push(current);
      current = word;
      continue;
    }
    current = candidate;
  }
  if (current) {
    lines.push(current);
  }
  return lines.slice(0, 4);
}

export class ZendeskPublishService {
  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly buildZendeskClient: BuildZendeskClient
  ) {}

  async validate(input: ZendeskPublishValidateRequest): Promise<ZendeskPublishValidateResponse> {
    const workspaceId = input.workspaceId?.trim();
    if (!workspaceId) {
      throw new Error('publish.validate requires workspaceId');
    }

    const settings = await this.workspaceRepository.getWorkspaceSettings(workspaceId);
    const branchIds = await this.resolveBranchIds(workspaceId, input.branchIds);
    if (branchIds.length === 0) {
      return {
        workspaceId,
        summary: {
          total: 0,
          publishable: 0,
          blocked: 0,
          conflicts: 0,
          warnings: 0
        },
        items: [],
        validatedAtUtc: new Date().toISOString()
      };
    }

    const context: PublishableValidationContext = {
      workspaceId,
      remoteLocales: null
    };

    try {
      const client = await this.buildZendeskClient(workspaceId);
      context.client = client;
      const locales = await client.listEnabledLocales().catch((error) => {
        logger.warn('zendesk-publish-service locale fetch failed', {
          workspaceId,
          message: error instanceof Error ? error.message : String(error)
        });
        return [] as ZendeskHelpCenterLocale[];
      });
      context.remoteLocales = new Set(
        locales
          .map((locale) => normalizeLocale(locale.locale))
          .filter(Boolean)
      );
    } catch (error) {
      context.clientError = error instanceof Error ? error.message : String(error);
    }

    const items: ZendeskPublishValidationItem[] = [];
    const enabledLocales = new Set(settings.enabledLocales.map((locale) => normalizeLocale(locale)).filter(Boolean));
    for (const branchId of branchIds) {
      const branchDetail = await this.workspaceRepository.getDraftBranchEditor(workspaceId, branchId);
      const family = await this.workspaceRepository.getArticleFamily(workspaceId, branchDetail.branch.familyId);
      const issues = branchDetail.editor.validationWarnings
        .map((warning) => mapDraftValidationIssue(warning, settings))
        .filter((issue): issue is ZendeskPublishValidationIssue => Boolean(issue));

      if (branchDetail.branch.status !== DraftBranchStatus.READY_TO_PUBLISH) {
        issues.push({
          code: ZendeskPublishValidationCode.BRANCH_NOT_READY,
          severity: DraftValidationSeverity.ERROR,
          message: `Branch is ${branchDetail.branch.status} and is not eligible for publish.`
        });
      }

      const placementSectionId = branchDetail.branch.placement?.sectionId ?? family.sectionId ?? family.sourceSectionId ?? undefined;
      const placementSectionName = branchDetail.branch.placement?.sectionName?.trim() || family.sectionName?.trim() || undefined;
      const placementCategoryId = branchDetail.branch.placement?.categoryId ?? family.categoryId ?? family.sourceCategoryId ?? undefined;
      const placementCategoryName = branchDetail.branch.placement?.categoryName?.trim() || family.categoryName?.trim() || undefined;
      if (!branchDetail.branch.liveRevisionId && !placementSectionId && !placementSectionName) {
        if (!settings.zendeskAllowSectionCreation) {
          issues.push({
            code: ZendeskPublishValidationCode.MISSING_PLACEMENT,
            severity: DraftValidationSeverity.ERROR,
            message: 'New article publish requires a target section or section auto-create enabled.'
          });
        } else if (!placementCategoryId && !placementCategoryName && !settings.zendeskAllowCategoryCreation) {
          issues.push({
            code: ZendeskPublishValidationCode.MISSING_PLACEMENT,
            severity: DraftValidationSeverity.ERROR,
            message: 'New article publish requires a target category or category auto-create enabled.'
          });
        }
      }

      const normalizedLocale = normalizeLocale(branchDetail.branch.locale);
      if (!enabledLocales.has(normalizedLocale)) {
        issues.push({
          code: ZendeskPublishValidationCode.LOCALE_DISABLED,
          severity: DraftValidationSeverity.ERROR,
          message: `Locale ${branchDetail.branch.locale} is not enabled in workspace settings.`,
          detail: branchDetail.branch.locale
        });
      }

      if (context.clientError) {
        issues.push({
          code: ZendeskPublishValidationCode.ZENDESK_CONFIGURATION,
          severity: DraftValidationSeverity.ERROR,
          message: context.clientError
        });
      } else if (context.remoteLocales && context.remoteLocales.size > 0 && !context.remoteLocales.has(normalizedLocale)) {
        issues.push({
          code: ZendeskPublishValidationCode.REMOTE_LOCALE_DISABLED,
          severity: DraftValidationSeverity.ERROR,
          message: `Zendesk does not currently list ${branchDetail.branch.locale} as an enabled Help Center locale.`,
          detail: branchDetail.branch.locale
        });
      }

      const articleId = parseZendeskArticleId(family.externalKey);
      let remoteUpdatedAtUtc: string | undefined;
      if (articleId && !context.clientError) {
        try {
          const remoteArticle = await context.client!.showArticle(articleId, branchDetail.branch.locale).catch(async (error) => {
            if (error instanceof ZendeskApiError && error.status === 404 && !branchDetail.branch.liveRevisionId) {
              return context.client!.showArticle(articleId);
            }
            throw error;
          });
          remoteUpdatedAtUtc = remoteArticle.updated_at;

          if (branchDetail.branch.liveRevisionId) {
            const liveDetail = await this.workspaceRepository.getArticleDetail(workspaceId, {
              workspaceId,
              revisionId: branchDetail.branch.liveRevisionId,
              includeLineage: false,
              includePublishLog: false
            });
            const localLiveHtml = normalizeHtmlForConflict(liveDetail.sourceHtml);
            const remoteHtml = normalizeHtmlForConflict(remoteArticle.body);
            const localSectionId = String(family.sectionId ?? family.sourceSectionId ?? branchDetail.branch.placement?.sectionId ?? '');
            const remoteSectionId = String(remoteArticle.section_id ?? '');
            if (localLiveHtml !== remoteHtml || (localSectionId && remoteSectionId && localSectionId !== remoteSectionId)) {
              issues.push({
                code: ZendeskPublishValidationCode.REMOTE_CONFLICT,
                severity: DraftValidationSeverity.ERROR,
                message: 'Zendesk content has changed since this branch was based on live content.',
                detail: remoteUpdatedAtUtc
              });
            }
          }
        } catch (error) {
          if (error instanceof ZendeskApiError && error.status === 404) {
            issues.push({
              code: ZendeskPublishValidationCode.REMOTE_ARTICLE_MISSING,
              severity: DraftValidationSeverity.ERROR,
              message: `Zendesk article ${articleId} no longer exists for this family.`,
              detail: family.externalKey
            });
          } else {
            issues.push({
              code: ZendeskPublishValidationCode.ZENDESK_CONFIGURATION,
              severity: DraftValidationSeverity.ERROR,
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }

      const canPublish = !issues.some(issueHasError);
      items.push({
        workspaceId,
        branchId: branchDetail.branch.id,
        branchName: branchDetail.branch.name,
        branchStatus: branchDetail.branch.status,
        familyId: branchDetail.branch.familyId,
        familyTitle: branchDetail.branch.familyTitle,
        localeVariantId: branchDetail.branch.localeVariantId,
        locale: branchDetail.branch.locale,
        externalKey: family.externalKey,
        zendeskArticleId: articleId ? String(articleId) : undefined,
        headRevisionId: branchDetail.branch.headRevisionId,
        headRevisionNumber: branchDetail.branch.headRevisionNumber,
        liveRevisionId: branchDetail.branch.liveRevisionId,
        liveRevisionNumber: branchDetail.branch.liveRevisionNumber,
        placement: branchDetail.branch.placement,
        canPublish,
        issues,
        remoteUpdatedAtUtc
      });
    }

    return {
      workspaceId,
      summary: summarizeValidation(items),
      items,
      validatedAtUtc: new Date().toISOString()
    };
  }

  async runPublish(
    input: ZendeskPublishRunRequest,
    emit: (event: JobEvent) => void,
    command: string,
    jobId: string,
    isCancelled?: () => boolean
  ): Promise<void> {
    const workspaceId = input.workspaceId?.trim();
    if (!workspaceId) {
      emit({
        id: jobId,
        command,
        state: JobState.FAILED,
        progress: 100,
        message: 'zendesk.publish.run requires workspaceId'
      });
      return;
    }

    const publishTarget: ZendeskPublishTarget = input.publishTarget === 'draft' ? 'draft' : 'live';
    const settings = await this.workspaceRepository.getWorkspaceSettings(workspaceId);
    const targetLabel = publishTarget === 'draft' ? 'Zendesk draft' : 'Zendesk live';
    const startedAtUtc = new Date().toISOString();
    const ensureActive = () => {
      if (isCancelled?.()) {
        throw new Error('publish_cancelled');
      }
    };

    emit({
      id: jobId,
      command,
      state: JobState.RUNNING,
      progress: 5,
      message: `Validating ${targetLabel} queue`,
      startedAt: startedAtUtc
    });

    const validation = await this.validate({
      workspaceId,
      branchIds: input.branchIds
    });
    const selectedBranchIds = validation.items.map((item) => item.branchId);

    await this.workspaceRepository.createPublishJob(workspaceId, {
      jobId,
      branchIds: selectedBranchIds,
      requestedBy: input.requestedBy
    });
    await this.workspaceRepository.updatePublishJobStatus(workspaceId, jobId, PublishStatus.RUNNING, {
      startedAtUtc
    });
    await this.workspaceRepository.replacePublishJobItems(
      workspaceId,
      jobId,
      validation.items.map((item) => ({
        branchId: item.branchId,
        branchName: item.branchName,
        familyId: item.familyId,
        familyTitle: item.familyTitle,
        localeVariantId: item.localeVariantId,
        locale: item.locale,
        status: buildItemStatus(item, publishTarget, settings),
        zendeskArticleId: item.zendeskArticleId,
        remoteUpdatedAtUtc: item.remoteUpdatedAtUtc,
        issues: item.issues,
        resultCode: canPublishItem(item, publishTarget, settings)
          ? undefined
          : buildItemStatus(item, publishTarget, settings),
        resultMessage: canPublishItem(item, publishTarget, settings)
          ? undefined
          : (
              publishTarget === 'live' && settings.zendeskBlockLiveOnWarnings && item.canPublish && itemHasWarnings(item)
                ? 'Live publish is blocked while validation warnings remain.'
                : item.issues.map((issue) => issue.message).join(' | ')
            )
      }))
    );

    const publishable = validation.items.filter((item) => canPublishItem(item, publishTarget, settings));
    if (publishable.length === 0) {
      const completedAtUtc = new Date().toISOString();
      await this.workspaceRepository.updatePublishJobStatus(workspaceId, jobId, PublishStatus.FAILED, {
        startedAtUtc,
        completedAtUtc
      });
      emit({
        id: jobId,
        command,
        state: JobState.FAILED,
        progress: 100,
        message: publishTarget === 'draft'
          ? 'All selected draft publish items are blocked.'
          : 'All selected live publish items are blocked.',
        startedAt: startedAtUtc,
        endedAt: completedAtUtc
      });
      return;
    }

    const client = await this.buildZendeskClient(workspaceId);
    let completed = 0;

    try {
      for (const [index, item] of publishable.entries()) {
        ensureActive();
        const itemStartedAt = new Date().toISOString();
        const progressBase = Math.floor((index / publishable.length) * 80);
        await this.workspaceRepository.updatePublishJobItem(workspaceId, jobId, item.branchId, {
          status: PublishJobItemState.RUNNING,
          startedAtUtc: itemStartedAt
        });

        emit({
          id: jobId,
          command,
          state: JobState.RUNNING,
          progress: 10 + progressBase,
          message: `${publishTarget === 'draft' ? 'Syncing draft' : 'Publishing live'} ${item.familyTitle} (${item.locale})`,
          startedAt: startedAtUtc,
          metadata: {
            branchId: item.branchId,
            locale: item.locale,
            publishTarget
          }
        });

        try {
          const result = await this.publishItem(client, item, {
            publishTarget,
            settings
          });
          const publishRecord = publishTarget === 'live'
            ? await this.workspaceRepository.promotePublishedDraftBranch({
                workspaceId,
                branchId: item.branchId,
                jobId,
                zendeskArticleId: result.zendeskArticleId,
                zendeskSourceArticleId: result.zendeskSourceArticleId,
                externalKey: result.externalKey,
                remoteSectionId: result.remoteSectionId,
                remoteCategoryId: result.remoteCategoryId,
                remoteUpdatedAtUtc: result.remoteUpdatedAtUtc,
                resultMessage: result.resultMessage,
                publishedHtml: result.publishedHtml
              })
            : await this.workspaceRepository.recordDraftBranchRemotePublish({
                workspaceId,
                branchId: item.branchId,
                jobId,
                zendeskArticleId: result.zendeskArticleId,
                zendeskSourceArticleId: result.zendeskSourceArticleId,
                externalKey: result.externalKey,
                remoteSectionId: result.remoteSectionId,
                remoteCategoryId: result.remoteCategoryId,
                resultMessage: result.resultMessage
              });

          await this.workspaceRepository.updatePublishJobItem(workspaceId, jobId, item.branchId, {
            status: PublishJobItemState.SUCCEEDED,
            zendeskArticleId: result.zendeskArticleId,
            zendeskSourceArticleId: result.zendeskSourceArticleId,
            publishedRevisionId: publishTarget === 'live' ? publishRecord.revisionId : null,
            remoteUpdatedAtUtc: result.remoteUpdatedAtUtc ?? null,
            resultCode: publishTarget,
            resultMessage: result.resultMessage,
            completedAtUtc: new Date().toISOString()
          });
          completed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const conflict = error instanceof Error && error.message === 'remote_conflict';
          if (conflict) {
            await this.workspaceRepository.setDraftBranchStatus({
              workspaceId,
              branchId: item.branchId,
              status: DraftBranchStatus.CONFLICTED
            });
          }
          await this.workspaceRepository.updatePublishJobItem(workspaceId, jobId, item.branchId, {
            status: conflict ? PublishJobItemState.CONFLICTED : PublishJobItemState.FAILED,
            resultCode: conflict ? PublishJobItemState.CONFLICTED : PublishJobItemState.FAILED,
            resultMessage: message,
            completedAtUtc: new Date().toISOString()
          });
          logger.warn('zendesk-publish-service item publish failed', {
            workspaceId,
            branchId: item.branchId,
            message
          });
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'publish_cancelled') {
        await this.cancelQueuedItems(workspaceId, jobId);
        const endedAtUtc = new Date().toISOString();
        await this.workspaceRepository.updatePublishJobStatus(workspaceId, jobId, PublishStatus.CANCELED, {
          startedAtUtc,
          completedAtUtc: endedAtUtc
        });
        emit({
          id: jobId,
          command,
          state: JobState.CANCELED,
          progress: 100,
          message: 'Publish canceled',
          startedAt: startedAtUtc,
          endedAt: endedAtUtc
        });
        return;
      }
      throw error;
    }

    const snapshot = await this.workspaceRepository.getPublishJobSnapshot(workspaceId, jobId);
    const endedAtUtc = new Date().toISOString();
    const allSucceeded = snapshot.summary.total > 0
      && snapshot.summary.succeeded === snapshot.summary.total;
    await this.workspaceRepository.updatePublishJobStatus(
      workspaceId,
      jobId,
      allSucceeded ? PublishStatus.COMPLETED : PublishStatus.FAILED,
      {
        startedAtUtc,
        completedAtUtc: endedAtUtc
      }
    );

    emit({
      id: jobId,
      command,
      state: allSucceeded ? JobState.SUCCEEDED : JobState.FAILED,
      progress: 100,
      message: allSucceeded
        ? (
            publishTarget === 'draft'
              ? `Synced ${completed} branch${completed === 1 ? '' : 'es'} to Zendesk draft.`
              : `Published ${completed} branch${completed === 1 ? '' : 'es'} live to Zendesk.`
          )
        : (
            publishTarget === 'draft'
              ? `Synced ${snapshot.summary.succeeded} of ${snapshot.summary.total} branch${snapshot.summary.total === 1 ? '' : 'es'} to Zendesk draft.`
              : `Published ${snapshot.summary.succeeded} of ${snapshot.summary.total} branch${snapshot.summary.total === 1 ? '' : 'es'} live to Zendesk.`
          ),
      startedAt: startedAtUtc,
      endedAt: endedAtUtc,
      metadata: {
        summary: snapshot.summary,
        publishTarget
      }
    });
  }

  private async resolveBranchIds(workspaceId: string, branchIds?: string[]): Promise<string[]> {
    const normalized = Array.from(new Set((branchIds ?? []).map((branchId) => branchId.trim()).filter(Boolean)));
    if (normalized.length > 0) {
      return normalized;
    }
    const branches = await this.workspaceRepository.listDraftBranches(workspaceId, { workspaceId });
    return branches.branches
      .filter((branch) => branch.status === DraftBranchStatus.READY_TO_PUBLISH)
      .map((branch) => branch.id);
  }

  private async publishItem(
    client: ZendeskClient,
    item: ZendeskPublishValidationItem,
    execution: PublishExecutionContext
  ): Promise<PublishExecutionResult> {
    const detail = await this.workspaceRepository.getArticleDetail(item.workspaceId, {
      workspaceId: item.workspaceId,
      revisionId: item.headRevisionId,
      includeLineage: false,
      includePublishLog: false
    });
    const family = await this.workspaceRepository.getArticleFamily(item.workspaceId, item.familyId);
    const articleId = parseZendeskArticleId(family.externalKey);
    const publishAsDraft = execution.publishTarget === 'draft';
    const publishedHtml = await this.materializePublishHtml(client, detail.sourceHtml, item, execution.settings);
    const permissionGroupId = parsePositiveInteger(execution.settings.zendeskPermissionGroupId);
    const liveUserSegmentId = parsePositiveInteger(execution.settings.zendeskLiveUserSegmentId);
    const translationPayload: ZendeskTranslationPayload = {
      locale: item.locale,
      title: family.title,
      body: publishedHtml,
      draft: publishAsDraft
    };

    if (articleId) {
      const remoteArticle = await client.showArticle(articleId, item.locale).catch(async (error) => {
        if (error instanceof ZendeskApiError && error.status === 404) {
          if (!item.liveRevisionId) {
            return client.showArticle(articleId);
          }
          throw new Error('remote_conflict');
        }
        throw error;
      });

      const liveDetail = item.liveRevisionId
        ? await this.workspaceRepository.getArticleDetail(item.workspaceId, {
            workspaceId: item.workspaceId,
            revisionId: item.liveRevisionId,
            includeLineage: false,
            includePublishLog: false
          })
        : null;
      if (liveDetail && normalizeHtmlForConflict(liveDetail.sourceHtml) !== normalizeHtmlForConflict(remoteArticle.body)) {
        throw new Error('remote_conflict');
      }

      await client.upsertTranslation(articleId, translationPayload);
      const hasPlacementIntent = Boolean(
        family.sectionId
        || family.sectionName
        || family.sourceSectionId
        || family.categoryId
        || family.categoryName
        || family.sourceCategoryId
        || item.placement?.sectionId
        || item.placement?.categoryId
        || item.placement?.sectionName
        || item.placement?.categoryName
      );
      const resolvedSection = hasPlacementIntent
        ? await this.resolveTargetSection(client, item, family, execution.settings)
        : undefined;
      await client.updateArticleMetadata(articleId, {
        section_id: resolvedSection?.sectionId,
        permission_group_id: permissionGroupId,
        user_segment_id: liveUserSegmentId ?? null
      });
      const updatedArticle = await client.showArticle(articleId, item.locale).catch(() => remoteArticle);
      return {
        zendeskArticleId: String(updatedArticle.id),
        zendeskSourceArticleId: String(updatedArticle.source_id ?? updatedArticle.id),
        externalKey: `hc:${updatedArticle.source_id ?? updatedArticle.id}`,
        remoteUpdatedAtUtc: updatedArticle.updated_at,
        remoteSectionId: updatedArticle.section_id != null ? String(updatedArticle.section_id) : undefined,
        remoteCategoryId: updatedArticle.category_id != null ? String(updatedArticle.category_id) : undefined,
        resultMessage: publishAsDraft ? 'Synced Zendesk draft' : 'Published Zendesk article live',
        publishedHtml
      };
    }

    const resolvedSection = await this.resolveTargetSection(client, item, family, execution.settings);
    const createPayload = {
      title: translationPayload.title,
      body: translationPayload.body,
      locale: translationPayload.locale,
      draft: publishAsDraft,
      ...(permissionGroupId ? { permission_group_id: permissionGroupId } : {}),
      ...(liveUserSegmentId ? { user_segment_id: liveUserSegmentId } : {})
    };

    const createdArticle = await client.createArticleInSectionWithOptions(
      resolvedSection.sectionId,
      createPayload,
      { notifySubscribers: execution.publishTarget === 'live' ? execution.settings.zendeskNotifySubscribers : false }
    );
    return {
      zendeskArticleId: String(createdArticle.id),
      zendeskSourceArticleId: String(createdArticle.source_id ?? createdArticle.id),
      externalKey: `hc:${createdArticle.source_id ?? createdArticle.id}`,
      remoteUpdatedAtUtc: createdArticle.updated_at,
      remoteSectionId: createdArticle.section_id != null ? String(createdArticle.section_id) : undefined,
      remoteCategoryId: createdArticle.category_id != null ? String(createdArticle.category_id) : undefined,
      resultMessage: publishAsDraft ? 'Created Zendesk draft' : 'Created Zendesk article',
      publishedHtml
    };
  }

  private async materializePublishHtml(
    client: ZendeskClient,
    html: string,
    item: ZendeskPublishValidationItem,
    settings: WorkspaceSettingsRecord
  ): Promise<string> {
    let nextHtml = await this.uploadInlineDataImages(client, html, item);
    if (settings.zendeskPlaceholderAssetPolicy !== 'upload') {
      return nextHtml;
    }

    const placeholderPattern = /\{\{\s*([A-Za-z0-9._-]+)\s*\}\}|<image_placeholder\b[^>]*description="([^"]*)"[^>]*\/?>/gi;
    const matches = Array.from(nextHtml.matchAll(placeholderPattern));
    for (const [index, match] of matches.entries()) {
      const description = (match[1] ?? match[2] ?? 'Placeholder image').trim() || 'Placeholder image';
      const media = await this.uploadPlaceholderGuideMedia(client, item, description, index);
      const replacement = `<p><img src="${escapeHtml(media.url)}" alt="${escapeHtml(description)}" data-kbv-placeholder="true" /></p>`;
      nextHtml = nextHtml.replace(match[0], replacement);
    }
    return nextHtml;
  }

  private async uploadInlineDataImages(
    client: ZendeskClient,
    html: string,
    item: ZendeskPublishValidationItem
  ): Promise<string> {
    const pattern = /<img\b([^>]*?)src=(["'])(data:image\/[^"']+)\2([^>]*)>/gi;
    const matches = Array.from(html.matchAll(pattern));
    let nextHtml = html;
    for (const [index, match] of matches.entries()) {
      const parsed = this.parseDataImageUri(match[3]);
      const media = await this.uploadGuideMediaBinary(
        client,
        parsed.contentType,
        parsed.bytes,
        `inline-image-${item.locale}-${index + 1}.${parsed.extension}`
      );
      nextHtml = nextHtml.replace(match[3], media.url);
    }
    return nextHtml;
  }

  private parseDataImageUri(dataUri: string): { contentType: string; bytes: Buffer; extension: string } {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUri.trim());
    if (!match) {
      throw new Error('Unsupported inline image data URI');
    }
    const contentType = match[1].toLowerCase();
    const bytes = Buffer.from(match[2], 'base64');
    const extension = contentType.split('/')[1]?.replace(/[^a-z0-9]+/gi, '') || 'img';
    return {
      contentType,
      bytes,
      extension
    };
  }

  private async uploadPlaceholderGuideMedia(
    client: ZendeskClient,
    item: ZendeskPublishValidationItem,
    description: string,
    index: number
  ): Promise<ZendeskGuideMedia> {
    const svg = buildPlaceholderSvg(description);
    return this.uploadGuideMediaBinary(
      client,
      'image/svg+xml',
      Buffer.from(svg, 'utf8'),
      placeholderFileName(description, item.locale, index)
    );
  }

  private async uploadGuideMediaBinary(
    client: ZendeskClient,
    contentType: string,
    bytes: Buffer,
    filename: string
  ): Promise<ZendeskGuideMedia> {
    const upload = await client.createGuideMediaUploadUrl(contentType, bytes.byteLength);
    await client.uploadGuideMedia(upload.upload_url.url, upload.headers, bytes);
    return client.createGuideMedia(upload.upload_url.asset_upload_id, filename);
  }

  private async resolveTargetSection(
    client: ZendeskClient,
    item: ZendeskPublishValidationItem,
    family: {
      sectionId?: string;
      sectionName?: string;
      sourceSectionId?: string;
      categoryId?: string;
      categoryName?: string;
      sourceCategoryId?: string;
    },
    settings: WorkspaceSettingsRecord
  ): Promise<ResolvedPublishSection> {
    const explicitSectionId = parsePositiveInteger(
      item.placement?.sectionId ?? family.sectionId ?? family.sourceSectionId
    );
    if (explicitSectionId) {
      return {
        categoryId: parsePositiveInteger(item.placement?.categoryId ?? family.categoryId ?? family.sourceCategoryId),
        sectionId: explicitSectionId
      };
    }

    if (!settings.zendeskAllowSectionCreation) {
      throw new Error('Cannot publish without a Zendesk section when section auto-create is disabled');
    }

    const categoryId = await this.findOrCreateCategory(client, item, family, settings);
    const sectionName = item.placement?.sectionName?.trim()
      || family.sectionName?.trim()
      || settings.zendeskFallbackSectionName;
    const sectionId = await this.findOrCreateSection(client, categoryId, item.locale, sectionName, settings);
    return {
      categoryId,
      sectionId
    };
  }

  private async findOrCreateCategory(
    client: ZendeskClient,
    item: ZendeskPublishValidationItem,
    family: {
      categoryId?: string;
      categoryName?: string;
      sourceCategoryId?: string;
    },
    settings: WorkspaceSettingsRecord
  ): Promise<number> {
    const explicitCategoryId = parsePositiveInteger(
      item.placement?.categoryId ?? family.categoryId ?? family.sourceCategoryId
    );
    if (explicitCategoryId) {
      return explicitCategoryId;
    }
    if (!settings.zendeskAllowCategoryCreation) {
      throw new Error('Cannot publish without a Zendesk category when category auto-create is disabled');
    }

    const categoryName = item.placement?.categoryName?.trim()
      || family.categoryName?.trim()
      || settings.zendeskFallbackCategoryName;
    const categories = await client.listCategories(item.locale);
    const existing = categories.find((category) => normalizeNameForLookup(category.name) === normalizeNameForLookup(categoryName));
    if (existing?.id) {
      return existing.id;
    }
    const created = await client.createCategory(item.locale, {
      locale: item.locale,
      name: categoryName
    });
    return created.id;
  }

  private async findOrCreateSection(
    client: ZendeskClient,
    categoryId: number,
    locale: string,
    sectionName: string,
    settings: WorkspaceSettingsRecord
  ): Promise<number> {
    const sections = await client.listSections(categoryId, locale);
    const existing = sections.find((section) => normalizeNameForLookup(section.name) === normalizeNameForLookup(sectionName));
    if (existing?.id) {
      return existing.id;
    }
    if (!settings.zendeskAllowSectionCreation) {
      throw new Error('Cannot publish without a Zendesk section when section auto-create is disabled');
    }
    const created = await client.createSection(categoryId, locale, {
      locale,
      name: sectionName
    });
    return created.id;
  }

  private async cancelQueuedItems(workspaceId: string, jobId: string): Promise<void> {
    const snapshot = await this.workspaceRepository.getPublishJobSnapshot(workspaceId, jobId);
    const updates = snapshot.items
      .filter((item) => item.status === PublishJobItemState.QUEUED || item.status === PublishJobItemState.RUNNING)
      .map((item) => this.workspaceRepository.updatePublishJobItem(workspaceId, jobId, item.branchId, {
        status: PublishJobItemState.CANCELED,
        resultCode: PublishJobItemState.CANCELED,
        resultMessage: 'Publish canceled',
        completedAtUtc: new Date().toISOString()
      }));
    await Promise.all(updates);
  }
}
