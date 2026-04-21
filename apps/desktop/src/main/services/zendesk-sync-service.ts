import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JobState, type JobEvent } from '@kb-vault/shared-types';
import { ZendeskClient } from '@kb-vault/zendesk-client';
import { type KBScopeCatalogUpsertInput, RevisionState, RevisionStatus } from '@kb-vault/shared-types';
import { logger } from './logger';
import { WorkspaceRepository } from './workspace-repository';

interface ZendeskArticleRecord {
  id: number;
  title: string;
  locale?: string;
  source_id?: number;
  section_id?: number;
  category_id?: number;
  body?: string;
}

interface ZendeskArticleResponse {
  items: ZendeskArticleRecord[];
  hasMore?: boolean;
  nextPage?: string | null;
}

export interface ZendeskSyncServiceInput {
  workspaceId: string;
  mode: 'full' | 'incremental';
  locale?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  retryMaxDelayMs?: number;
}

interface SyncAccumulator {
  syncedArticles: number;
  skippedArticles: number;
  createdFamilies: number;
  createdVariants: number;
  createdRevisions: number;
  startedAtUtc: string;
  cursorSummary?: Record<string, string>;
}

interface SyncRetryPolicy {
  maxRetries: number;
  retryDelayMs: number;
  retryMaxDelayMs: number;
}

function isSyncCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === 'sync_cancelled';
}

export class ZendeskSyncService {
  private static readonly REQUEST_TIMEOUT_MS = 30_000;
  private static readonly DEFAULT_RETRY_ATTEMPTS = 3;
  private static readonly DEFAULT_RETRY_DELAY_MS = 500;
  private static readonly DEFAULT_RETRY_MAX_DELAY_MS = 4_000;

  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  async runSync(
    input: ZendeskSyncServiceInput,
    emit: (event: JobEvent) => void,
    command: string,
    jobId: string,
    isCancelled?: () => boolean
  ): Promise<void> {
    const startedAtUtc = new Date().toISOString();
    const runId = `sync-${jobId}-${Date.now()}`;
    let totals: SyncAccumulator = {
      syncedArticles: 0,
      skippedArticles: 0,
      createdFamilies: 0,
      createdVariants: 0,
      createdRevisions: 0,
      startedAtUtc
    };
    const retryPolicy: SyncRetryPolicy = {
      maxRetries: Number.isInteger(input.maxRetries) ? Math.max(0, input.maxRetries!) : ZendeskSyncService.DEFAULT_RETRY_ATTEMPTS,
      retryDelayMs: Number.isInteger(input.retryDelayMs) ? Math.max(50, input.retryDelayMs!) : ZendeskSyncService.DEFAULT_RETRY_DELAY_MS,
      retryMaxDelayMs: Number.isInteger(input.retryMaxDelayMs)
        ? Math.max(200, input.retryMaxDelayMs!)
        : ZendeskSyncService.DEFAULT_RETRY_MAX_DELAY_MS
    };

    const ensureActive = () => {
      if (isCancelled?.()) {
        throw new Error('sync_cancelled');
      }
    };

    const emitProgress = (progress: number, message?: string, locale?: string) => {
      emit({
        id: jobId,
        command,
        state: JobState.RUNNING,
        progress,
        message: message ? `${locale ?? ''}${locale ? ': ' : ''}${message}` : message,
        startedAt: startedAtUtc
      });
    };

    emitProgress(0, 'Starting Zendesk sync');

    try {
      ensureActive();
      const settings = await this.workspaceRepository.getWorkspaceSettings(input.workspaceId);
      const credentials = await this.workspaceRepository.getZendeskCredentialsForSync(input.workspaceId);
      if (!credentials) {
        throw new Error('Zendesk credentials are not configured for this workspace');
      }

      const client = ZendeskClient.fromConfig(
        { timeoutMs: ZendeskSyncService.REQUEST_TIMEOUT_MS },
        {
          subdomain: settings.zendeskSubdomain,
          email: credentials.email,
          apiToken: credentials.apiToken
        }
      );

      await this.workspaceRepository.logSyncRunStart(input.workspaceId, runId, input.mode);
      emitProgress(5, 'Testing Zendesk connectivity');
      const connection = await this.retrySyncCall(
        async () => client.testConnection(),
        `connection check`,
        retryPolicy,
        emitProgress
      );
      if (!connection.ok) {
        throw new Error(`Zendesk connection test returned status ${connection.status}`);
      }

      emitProgress(10, `Starting ${input.mode} sync`);
      const targetLocales = input.locale ? [input.locale] : settings.enabledLocales;
      totals = await this.syncAllLocales(
        input.workspaceId,
        targetLocales,
        settings.defaultLocale,
        client,
        input.mode,
        emitProgress,
        retryPolicy,
        ensureActive
      );

      const endedAtUtc = new Date().toISOString();
      await this.workspaceRepository.logSyncRunComplete(
        input.workspaceId,
        runId,
        JobState.SUCCEEDED,
        totals.syncedArticles,
        totals.skippedArticles,
        totals.createdFamilies,
        totals.createdVariants,
        totals.createdRevisions,
        undefined,
        totals.cursorSummary ? JSON.stringify(totals.cursorSummary) : undefined
      );

      emit({
        id: jobId,
        command,
        state: JobState.SUCCEEDED,
        progress: 100,
        message: `Sync complete. Synced ${totals.syncedArticles} articles, skipped ${totals.skippedArticles}.`,
        startedAt: startedAtUtc,
        endedAt: endedAtUtc
      });
    } catch (error) {
      if (isSyncCancelledError(error)) {
        const endedAtUtc = new Date().toISOString();
        await this.workspaceRepository.logSyncRunComplete(
          input.workspaceId,
          runId,
          JobState.CANCELED,
          totals.syncedArticles,
          totals.skippedArticles,
          totals.createdFamilies,
          totals.createdVariants,
          totals.createdRevisions,
          undefined,
          totals.cursorSummary ? JSON.stringify(totals.cursorSummary) : undefined
        );

        emit({
          id: jobId,
          command,
          state: JobState.CANCELED,
          progress: 100,
          message: 'Sync canceled',
          startedAt: startedAtUtc,
          endedAt: endedAtUtc
        });
        return;
      }

      const remoteError = error instanceof Error ? error.message : String(error);
      const endedAtUtc = new Date().toISOString();
      try {
        await this.workspaceRepository.logSyncRunComplete(
          input.workspaceId,
          runId,
          JobState.FAILED,
          totals.syncedArticles,
          totals.skippedArticles,
          totals.createdFamilies,
          totals.createdVariants,
          totals.createdRevisions,
          remoteError,
          totals.cursorSummary ? JSON.stringify(totals.cursorSummary) : undefined
        );
      } catch (logError) {
        logger.error('zendesk-sync-service logSyncRunComplete failed', {
          runId,
          workspaceId: input.workspaceId,
          logErrorMessage: logError instanceof Error ? logError.message : String(logError)
        });
      }

      emit({
        id: jobId,
        command,
        state: JobState.FAILED,
        progress: 100,
        message: remoteError,
        startedAt: startedAtUtc,
        endedAt: endedAtUtc
      });
      throw error;
    }
  }

  private async syncAllLocales(
    workspaceId: string,
    locales: string[],
    defaultLocale: string,
    client: ZendeskClient,
    mode: 'full' | 'incremental',
    emitProgress: (progress: number, message?: string, locale?: string) => void,
    retryPolicy: SyncRetryPolicy,
    ensureActive: () => void
  ): Promise<SyncAccumulator> {
    ensureActive();
    const accumulator: SyncAccumulator = {
      syncedArticles: 0,
      skippedArticles: 0,
      createdFamilies: 0,
      createdVariants: 0,
      createdRevisions: 0,
      startedAtUtc: new Date().toISOString(),
      cursorSummary: {}
    };

    const totalLocales = Math.max(locales.length, 1);
    for (const [index, locale] of locales.entries()) {
      ensureActive();
      emitProgress(
        15 + Math.floor(((index + 1) / totalLocales) * 20),
        'Syncing locale',
        locale
      );

      const checkpoint = mode === 'incremental' ? await this.workspaceRepository.getSyncCheckpoint(workspaceId, locale) : null;
      const synced = await this.syncLocale(
        workspaceId,
        locale,
        defaultLocale,
        client,
        mode,
        checkpoint?.lastSyncedAt,
        (progress, message) => {
          const localeShare = (index + 1) / totalLocales;
          const localeContribution = Math.floor(40 * localeShare);
          emitProgress(
            35 + localeContribution + Math.min(40, progress),
            message,
            locale
          );
        },
        retryPolicy,
        ensureActive
      );

      accumulator.syncedArticles += synced.syncedArticles;
      accumulator.skippedArticles += synced.skippedArticles;
      accumulator.createdFamilies += synced.createdFamilies;
      accumulator.createdVariants += synced.createdVariants;
      accumulator.createdRevisions += synced.createdRevisions;
      if (synced.lastCursor) {
        accumulator.cursorSummary![locale] = synced.lastCursor;
      }
      await this.workspaceRepository.reconcileSyncedLocaleVariants(workspaceId, locale, synced.remoteFamilyKeys);

      await this.workspaceRepository.upsertSyncCheckpoint(
        workspaceId,
        locale,
        accumulator.syncedArticles,
        new Date().toISOString(),
        synced.lastCursor
      );
    }

    return accumulator;
  }

  private async syncLocale(
    workspaceId: string,
    locale: string,
    defaultLocale: string,
    client: ZendeskClient,
    mode: 'full' | 'incremental',
    since: string | undefined,
    emitProgress: (progress: number, message?: string) => void,
    retryPolicy: SyncRetryPolicy,
    ensureActive: () => void
  ): Promise<{
    syncedArticles: number;
    skippedArticles: number;
    createdFamilies: number;
    createdVariants: number;
    createdRevisions: number;
    remoteFamilyKeys: string[];
    lastCursor?: string;
  }> {
    const workspace = await this.workspaceRepository.getWorkspace(workspaceId);
    const sectionId = (article: { section_id?: number | null }) => {
      const value = article.section_id;
      return value != null ? String(value) : undefined;
    };
    const categoryId = (article: { category_id?: number }) => {
      const value = article.category_id;
      return value != null ? String(value) : undefined;
    };
    const metrics = {
      syncedArticles: 0,
      skippedArticles: 0,
      createdFamilies: 0,
      createdVariants: 0,
      createdRevisions: 0,
      remoteFamilyKeys: [] as string[]
    };

    let syncedScopeCatalog = false;
    try {
      syncedScopeCatalog = await this.syncScopeCatalog(
        workspaceId,
        locale,
        defaultLocale,
        client,
        retryPolicy,
        ensureActive,
        emitProgress
      );
    } catch (error) {
      if (isSyncCancelledError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('zendesk-sync-service taxonomy sync failed; continuing article sync', {
        workspaceId,
        locale,
        defaultLocale,
        message
      });
      emitProgress(0, `Category/section name refresh failed; continuing article sync (${message})`);
    }

    let page = 1;
    let hasMore = true;
    let lastCursor: string | undefined;

    while (hasMore) {
      ensureActive();
      const payload = await this.retrySyncCall<ZendeskArticleResponse>(
        () => (since ? client.listArticles(locale, page, since) : client.listArticles(locale, page)),
        `listArticles ${locale} page ${page}`,
        retryPolicy,
        emitProgress,
        locale
      );
      const articles = payload.items;
      if (articles.length === 0) {
        hasMore = false;
        break;
      }

      for (const article of articles) {
        ensureActive();
        const normalizedLocale = article.locale ?? locale;
        const familyExternalKey = `hc:${article.source_id ?? article.id}`;
        const existingFamily = await this.workspaceRepository.getArticleFamilyByExternalKey(workspaceId, familyExternalKey);

        let family = existingFamily;
        if (!family) {
          family = await this.workspaceRepository.createArticleFamily({
            workspaceId,
            externalKey: familyExternalKey,
            title: article.title,
            sourceSectionId: sectionId(article),
            sourceCategoryId: categoryId(article)
          });
          family = await this.workspaceRepository.resolveEffectiveArticleTaxonomyPlacement(workspaceId, family.id);
          metrics.createdFamilies += 1;
        } else {
          const shouldRename = (family.title ?? '').trim() !== (article.title ?? '').trim();
          const shouldRebindSection = String(family.sourceSectionId ?? '') !== (article.section_id != null ? String(article.section_id) : '');
          const shouldRebindCategory = String(family.sourceCategoryId ?? '') !== (article.category_id != null ? String(article.category_id) : '');

          if (shouldRename || shouldRebindSection || shouldRebindCategory) {
            await this.workspaceRepository.updateArticleFamily({
              workspaceId,
              familyId: family.id,
              title: shouldRename ? article.title : undefined,
              sourceSectionId: shouldRebindSection ? (sectionId(article) ?? null) : undefined,
              sourceCategoryId: shouldRebindCategory ? (categoryId(article) ?? null) : undefined
            });
            family = await this.workspaceRepository.resolveEffectiveArticleTaxonomyPlacement(workspaceId, family.id);
          }
        }
        metrics.remoteFamilyKeys.push(family.externalKey);

        let variant = await this.workspaceRepository.getLocaleVariantByFamilyAndLocale(workspaceId, family.id, normalizedLocale);
        if (!variant) {
          variant = await this.workspaceRepository.createLocaleVariant({
            workspaceId,
            familyId: family.id,
            locale: normalizedLocale,
            status: RevisionState.LIVE
          });
          metrics.createdVariants += 1;
        } else if (variant.status === RevisionState.RETIRED || variant.status === RevisionState.OBSOLETE) {
          await this.workspaceRepository.updateLocaleVariant({
            workspaceId,
            variantId: variant.id,
            status: RevisionState.LIVE,
            retiredAtUtc: null
          });
        }

        const existingLive = await this.workspaceRepository.getLatestRevision(workspaceId, variant.id, RevisionState.LIVE);
        const latestRevision = await this.workspaceRepository.getLatestRevision(workspaceId, variant.id);
        const articleBody = article.body ?? '';
        const incomingHash = this.hashContent(articleBody);
        if (existingLive && existingLive.contentHash === incomingHash) {
          metrics.skippedArticles += 1;
          continue;
        }

        const revisionId = `${randomUUID()}-${article.id}`;
        const revisionNumber = (latestRevision?.revisionNumber ?? 0) + 1;
        const revisionFilePath = await this.writeRevisionBody(workspace.path, variant.id, revisionId, articleBody);
        await this.workspaceRepository.createRevision({
          workspaceId,
          localeVariantId: variant.id,
          revisionType: RevisionState.LIVE,
          filePath: revisionFilePath,
          contentHash: incomingHash,
          sourceRevisionId: existingLive?.id,
          revisionNumber,
          status: RevisionStatus.PROMOTED
        });

        metrics.createdRevisions += 1;
        metrics.syncedArticles += 1;
        emitProgress(0, `Saved ${article.title}`);

        if (existingLive) {
          await this.workspaceRepository.markDraftBranchesAsConflicted(workspaceId, variant.id);
        }
      }

      hasMore = Boolean(payload.hasMore);
      lastCursor = payload.nextPage ?? undefined;
      page += 1;

      emitProgress(
        Math.min(100, Math.max(0, Math.floor((articles.length / Math.max(articles.length, 1)) * 100))),
        `Page ${page - 1} complete`
      );
    }

    if (syncedScopeCatalog) {
      await this.workspaceRepository.reconcileEffectiveArticleTaxonomyPlacements(workspaceId);
    }

    if (mode === 'incremental' && since) {
      return {
        ...metrics,
        remoteFamilyKeys: metrics.remoteFamilyKeys,
        lastCursor: `${locale}:${new Date().toISOString()}`
      };
    }

    return {
      ...metrics,
      remoteFamilyKeys: metrics.remoteFamilyKeys,
      lastCursor: lastCursor ?? `${locale}:${new Date().toISOString()}`
    };
  }

  private async syncScopeCatalog(
    workspaceId: string,
    locale: string,
    defaultLocale: string,
    client: ZendeskClient,
    retryPolicy: SyncRetryPolicy,
    ensureActive: () => void,
    emitProgress: (progress: number, message?: string) => void
  ): Promise<boolean> {
    ensureActive();
    const normalizedLocale = locale.trim().toLowerCase();
    const normalizedDefaultLocale = defaultLocale.trim().toLowerCase();
    if (!normalizedLocale || normalizedLocale !== normalizedDefaultLocale) {
      return false;
    }

    const categories = await this.retrySyncCall(
      () => client.listCategories(locale),
      `listCategories ${locale}`,
      retryPolicy,
      emitProgress,
      locale
    );

    const entries: KBScopeCatalogUpsertInput[] = [];
    for (const category of categories) {
      ensureActive();
      if (typeof category.id !== 'number') {
        continue;
      }

      if ((category.name ?? '').trim()) {
        entries.push({
          workspaceId,
          scopeType: 'category',
          scopeId: String(category.id),
          displayName: category.name,
          source: `zendesk:${normalizedDefaultLocale}`
        });
      }

      const sections = await this.retrySyncCall(
        () => client.listSections(category.id, locale),
        `listSections ${locale} category ${category.id}`,
        retryPolicy,
        emitProgress,
        locale
      );

      for (const section of sections) {
        ensureActive();
        if (typeof section.id !== 'number' || !(section.name ?? '').trim()) {
          continue;
        }
        entries.push({
          workspaceId,
          scopeType: 'section',
          scopeId: String(section.id),
          parentScopeId: String(section.category_id ?? category.id),
          displayName: section.name,
          source: `zendesk:${normalizedDefaultLocale}`
        });
      }
    }

    if (entries.length > 0) {
      await this.workspaceRepository.upsertKbScopeCatalogEntries(workspaceId, entries);
    }

    return true;
  }

  private async retrySyncCall<T>(
    operation: () => Promise<T>,
    context: string,
    retryPolicy: SyncRetryPolicy,
    emitProgress: (progress: number, message?: string, locale?: string) => void,
    locale?: string
  ): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await operation();
      } catch (error) {
        attempt += 1;
        if (attempt > retryPolicy.maxRetries) {
          throw error;
        }
        const waitMs = Math.min(retryPolicy.retryMaxDelayMs, retryPolicy.retryDelayMs * 2 ** (attempt - 1));
        emitProgress(0, `${context} failed; retry #${attempt} in ${waitMs}ms`, locale);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private async writeRevisionBody(
    workspacePath: string,
    localeVariantId: string,
    revisionId: string,
    content: string
  ): Promise<string> {
    const dir = path.join(workspacePath, 'revisions', localeVariantId);
    await fs.mkdir(dir, { recursive: true });
    const targetPath = path.join(dir, `${revisionId}.html`);
    await fs.writeFile(targetPath, content, 'utf8');
    return targetPath;
  }
}
