"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZendeskSyncService = void 0;
const node_crypto_1 = require("node:crypto");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const shared_types_1 = require("@kb-vault/shared-types");
const zendesk_client_1 = require("@kb-vault/zendesk-client");
const shared_types_2 = require("@kb-vault/shared-types");
const logger_1 = require("./logger");
class ZendeskSyncService {
    workspaceRepository;
    static REQUEST_TIMEOUT_MS = 30_000;
    static DEFAULT_RETRY_ATTEMPTS = 3;
    static DEFAULT_RETRY_DELAY_MS = 500;
    static DEFAULT_RETRY_MAX_DELAY_MS = 4_000;
    constructor(workspaceRepository) {
        this.workspaceRepository = workspaceRepository;
    }
    async runSync(input, emit, command, jobId, isCancelled) {
        const startedAtUtc = new Date().toISOString();
        const runId = `sync-${jobId}-${Date.now()}`;
        let totals = {
            syncedArticles: 0,
            skippedArticles: 0,
            createdFamilies: 0,
            createdVariants: 0,
            createdRevisions: 0,
            startedAtUtc
        };
        const retryPolicy = {
            maxRetries: Number.isInteger(input.maxRetries) ? Math.max(0, input.maxRetries) : ZendeskSyncService.DEFAULT_RETRY_ATTEMPTS,
            retryDelayMs: Number.isInteger(input.retryDelayMs) ? Math.max(50, input.retryDelayMs) : ZendeskSyncService.DEFAULT_RETRY_DELAY_MS,
            retryMaxDelayMs: Number.isInteger(input.retryMaxDelayMs)
                ? Math.max(200, input.retryMaxDelayMs)
                : ZendeskSyncService.DEFAULT_RETRY_MAX_DELAY_MS
        };
        const ensureActive = () => {
            if (isCancelled?.()) {
                throw new Error('sync_cancelled');
            }
        };
        const emitProgress = (progress, message, locale) => {
            emit({
                id: jobId,
                command,
                state: shared_types_1.JobState.RUNNING,
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
            const client = zendesk_client_1.ZendeskClient.fromConfig({ timeoutMs: ZendeskSyncService.REQUEST_TIMEOUT_MS }, {
                subdomain: settings.zendeskSubdomain,
                email: credentials.email,
                apiToken: credentials.apiToken
            });
            await this.workspaceRepository.logSyncRunStart(input.workspaceId, runId, input.mode);
            emitProgress(5, 'Testing Zendesk connectivity');
            const connection = await this.retrySyncCall(async () => client.testConnection(), `connection check`, retryPolicy, emitProgress);
            if (!connection.ok) {
                throw new Error(`Zendesk connection test returned status ${connection.status}`);
            }
            emitProgress(10, `Starting ${input.mode} sync`);
            const targetLocales = input.locale ? [input.locale] : settings.enabledLocales;
            totals = await this.syncAllLocales(input.workspaceId, targetLocales, client, input.mode, emitProgress, retryPolicy, ensureActive);
            const endedAtUtc = new Date().toISOString();
            await this.workspaceRepository.logSyncRunComplete(input.workspaceId, runId, shared_types_1.JobState.SUCCEEDED, totals.syncedArticles, totals.skippedArticles, totals.createdFamilies, totals.createdVariants, totals.createdRevisions, undefined, totals.cursorSummary ? JSON.stringify(totals.cursorSummary) : undefined);
            emit({
                id: jobId,
                command,
                state: shared_types_1.JobState.SUCCEEDED,
                progress: 100,
                message: `Sync complete. Synced ${totals.syncedArticles} articles, skipped ${totals.skippedArticles}.`,
                startedAt: startedAtUtc,
                endedAt: endedAtUtc
            });
        }
        catch (error) {
            if (error instanceof Error && error.message === 'sync_cancelled') {
                const endedAtUtc = new Date().toISOString();
                await this.workspaceRepository.logSyncRunComplete(input.workspaceId, runId, shared_types_1.JobState.CANCELED, totals.syncedArticles, totals.skippedArticles, totals.createdFamilies, totals.createdVariants, totals.createdRevisions, undefined, totals.cursorSummary ? JSON.stringify(totals.cursorSummary) : undefined);
                emit({
                    id: jobId,
                    command,
                    state: shared_types_1.JobState.CANCELED,
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
                await this.workspaceRepository.logSyncRunComplete(input.workspaceId, runId, shared_types_1.JobState.FAILED, totals.syncedArticles, totals.skippedArticles, totals.createdFamilies, totals.createdVariants, totals.createdRevisions, remoteError, totals.cursorSummary ? JSON.stringify(totals.cursorSummary) : undefined);
            }
            catch (logError) {
                logger_1.logger.error('zendesk-sync-service logSyncRunComplete failed', {
                    runId,
                    workspaceId: input.workspaceId,
                    logErrorMessage: logError instanceof Error ? logError.message : String(logError)
                });
            }
            emit({
                id: jobId,
                command,
                state: shared_types_1.JobState.FAILED,
                progress: 100,
                message: remoteError,
                startedAt: startedAtUtc,
                endedAt: endedAtUtc
            });
            throw error;
        }
    }
    async syncAllLocales(workspaceId, locales, client, mode, emitProgress, retryPolicy, ensureActive) {
        ensureActive();
        const accumulator = {
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
            emitProgress(15 + Math.floor(((index + 1) / totalLocales) * 20), 'Syncing locale', locale);
            const checkpoint = mode === 'incremental' ? await this.workspaceRepository.getSyncCheckpoint(workspaceId, locale) : null;
            const synced = await this.syncLocale(workspaceId, locale, client, mode, checkpoint?.lastSyncedAt, (progress, message) => {
                const localeShare = (index + 1) / totalLocales;
                const localeContribution = Math.floor(40 * localeShare);
                emitProgress(35 + localeContribution + Math.min(40, progress), message, locale);
            }, retryPolicy, ensureActive);
            accumulator.syncedArticles += synced.syncedArticles;
            accumulator.skippedArticles += synced.skippedArticles;
            accumulator.createdFamilies += synced.createdFamilies;
            accumulator.createdVariants += synced.createdVariants;
            accumulator.createdRevisions += synced.createdRevisions;
            if (synced.lastCursor) {
                accumulator.cursorSummary[locale] = synced.lastCursor;
            }
            await this.workspaceRepository.reconcileSyncedLocaleVariants(workspaceId, locale, synced.remoteFamilyKeys);
            await this.workspaceRepository.upsertSyncCheckpoint(workspaceId, locale, accumulator.syncedArticles, new Date().toISOString(), synced.lastCursor);
        }
        return accumulator;
    }
    async syncLocale(workspaceId, locale, client, mode, since, emitProgress, retryPolicy, ensureActive) {
        const workspace = await this.workspaceRepository.getWorkspace(workspaceId);
        const sectionId = (article) => {
            const value = article.section_id;
            return value != null ? String(value) : undefined;
        };
        const categoryId = (article) => {
            const value = article.category_id;
            return value != null ? String(value) : undefined;
        };
        const metrics = {
            syncedArticles: 0,
            skippedArticles: 0,
            createdFamilies: 0,
            createdVariants: 0,
            createdRevisions: 0,
            remoteFamilyKeys: []
        };
        let page = 1;
        let hasMore = true;
        let lastCursor;
        while (hasMore) {
            ensureActive();
            const payload = await this.retrySyncCall(() => (since ? client.listArticles(locale, page, since) : client.listArticles(locale, page)), `listArticles ${locale} page ${page}`, retryPolicy, emitProgress, locale);
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
                        sectionId: sectionId(article),
                        categoryId: categoryId(article)
                    });
                    metrics.createdFamilies += 1;
                }
                else {
                    const shouldRename = (family.title ?? '').trim() !== (article.title ?? '').trim();
                    const shouldRebindSection = String(family.sectionId ?? '') !== (article.section_id != null ? String(article.section_id) : '');
                    const shouldRebindCategory = String(family.categoryId ?? '') !== (article.category_id != null ? String(article.category_id) : '');
                    if (shouldRename || shouldRebindSection || shouldRebindCategory) {
                        const nextSectionId = shouldRebindSection ? (sectionId(article) ?? null) : undefined;
                        const nextCategoryId = shouldRebindCategory ? (categoryId(article) ?? null) : undefined;
                        await this.workspaceRepository.updateArticleFamily({
                            workspaceId,
                            familyId: family.id,
                            title: shouldRename ? article.title : undefined,
                            sectionId: nextSectionId,
                            categoryId: nextCategoryId
                        });
                    }
                }
                metrics.remoteFamilyKeys.push(family.externalKey);
                let variant = await this.workspaceRepository.getLocaleVariantByFamilyAndLocale(workspaceId, family.id, normalizedLocale);
                if (!variant) {
                    variant = await this.workspaceRepository.createLocaleVariant({
                        workspaceId,
                        familyId: family.id,
                        locale: normalizedLocale,
                        status: shared_types_2.RevisionState.LIVE
                    });
                    metrics.createdVariants += 1;
                }
                else if (variant.status === shared_types_2.RevisionState.RETIRED || variant.status === shared_types_2.RevisionState.OBSOLETE) {
                    await this.workspaceRepository.updateLocaleVariant({
                        workspaceId,
                        variantId: variant.id,
                        status: shared_types_2.RevisionState.LIVE,
                        retiredAtUtc: undefined
                    });
                }
                const existingLive = await this.workspaceRepository.getLatestRevision(workspaceId, variant.id, shared_types_2.RevisionState.LIVE);
                const latestRevision = await this.workspaceRepository.getLatestRevision(workspaceId, variant.id);
                const articleBody = article.body ?? '';
                const incomingHash = this.hashContent(articleBody);
                if (existingLive && existingLive.contentHash === incomingHash) {
                    metrics.skippedArticles += 1;
                    continue;
                }
                const revisionId = `${(0, node_crypto_1.randomUUID)()}-${article.id}`;
                const revisionNumber = (latestRevision?.revisionNumber ?? 0) + 1;
                const revisionFilePath = await this.writeRevisionBody(workspace.path, variant.id, revisionId, articleBody);
                await this.workspaceRepository.createRevision({
                    workspaceId,
                    localeVariantId: variant.id,
                    revisionType: shared_types_2.RevisionState.LIVE,
                    filePath: revisionFilePath,
                    contentHash: incomingHash,
                    sourceRevisionId: existingLive?.id,
                    revisionNumber,
                    status: shared_types_2.RevisionStatus.PROMOTED
                });
                metrics.createdRevisions += 1;
                metrics.syncedArticles += 1;
                emitProgress(0, `Saved ${article.title}`);
                if (existingLive) {
                    await this.workspaceRepository.markDraftBranchesAsObsolete(workspaceId, variant.id);
                }
            }
            hasMore = Boolean(payload.hasMore);
            lastCursor = payload.nextPage ?? undefined;
            page += 1;
            emitProgress(Math.min(100, Math.max(0, Math.floor((articles.length / Math.max(articles.length, 1)) * 100))), `Page ${page - 1} complete`);
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
    async retrySyncCall(operation, context, retryPolicy, emitProgress, locale) {
        let attempt = 0;
        while (true) {
            try {
                return await operation();
            }
            catch (error) {
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
    hashContent(content) {
        return (0, node_crypto_1.createHash)('sha256').update(content).digest('hex');
    }
    async writeRevisionBody(workspacePath, localeVariantId, revisionId, content) {
        const dir = node_path_1.default.join(workspacePath, 'revisions', localeVariantId);
        await promises_1.default.mkdir(dir, { recursive: true });
        const targetPath = node_path_1.default.join(dir, `${revisionId}.html`);
        await promises_1.default.writeFile(targetPath, content, 'utf8');
        return targetPath;
    }
}
exports.ZendeskSyncService = ZendeskSyncService;
