"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZendeskRetireService = void 0;
const shared_types_1 = require("@kb-vault/shared-types");
const zendesk_client_1 = require("@kb-vault/zendesk-client");
const logger_1 = require("./logger");
function normalizeLocale(value) {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}
class ZendeskRetireService {
    workspaceRepository;
    buildZendeskClient;
    constructor(workspaceRepository, buildZendeskClient) {
        this.workspaceRepository = workspaceRepository;
        this.buildZendeskClient = buildZendeskClient;
    }
    async runRetire(input, emit, command, jobId, isCancelled) {
        const workspaceId = input.workspaceId?.trim();
        if (!workspaceId) {
            emit({
                id: jobId,
                command,
                state: shared_types_1.JobState.FAILED,
                progress: 100,
                message: 'zendesk.retire.run requires workspaceId'
            });
            return;
        }
        const startedAtUtc = new Date().toISOString();
        const ensureActive = () => {
            if (isCancelled?.()) {
                throw new Error('retire_cancelled');
            }
        };
        emit({
            id: jobId,
            command,
            state: shared_types_1.JobState.RUNNING,
            progress: 5,
            message: 'Loading accepted retire actions',
            startedAt: startedAtUtc
        });
        const queue = await this.workspaceRepository.listZendeskRetireQueue(workspaceId, input.proposalIds);
        const archiveable = queue.items.filter((item) => item.canArchive);
        if (archiveable.length === 0) {
            emit({
                id: jobId,
                command,
                state: shared_types_1.JobState.FAILED,
                progress: 100,
                message: 'No archive-ready retire actions were selected.',
                startedAt: startedAtUtc,
                endedAt: new Date().toISOString()
            });
            return;
        }
        const client = await this.buildZendeskClient(workspaceId);
        let succeeded = 0;
        try {
            for (const [index, item] of archiveable.entries()) {
                ensureActive();
                const attemptedAtUtc = new Date().toISOString();
                await this.workspaceRepository.updateProposalZendeskRetireState(workspaceId, item.proposalId, {
                    status: 'running',
                    attemptedAtUtc,
                    completedAtUtc: null,
                    zendeskArticleId: item.zendeskArticleId ?? null,
                    locale: item.locale ?? null,
                    message: null
                });
                emit({
                    id: jobId,
                    command,
                    state: shared_types_1.JobState.RUNNING,
                    progress: 10 + Math.floor((index / archiveable.length) * 80),
                    message: `Archiving ${item.familyTitle}${item.locale ? ` (${item.locale})` : ''} in Zendesk`,
                    startedAt: startedAtUtc,
                    metadata: {
                        proposalId: item.proposalId,
                        familyId: item.familyId,
                        locale: item.locale
                    }
                });
                try {
                    const result = await this.archiveItem(client, item);
                    await this.workspaceRepository.updateProposalZendeskRetireState(workspaceId, item.proposalId, {
                        status: result.status,
                        attemptedAtUtc,
                        completedAtUtc: new Date().toISOString(),
                        zendeskArticleId: result.articleId,
                        locale: result.locale ?? item.locale ?? null,
                        message: result.message
                    });
                    succeeded += 1;
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    await this.workspaceRepository.updateProposalZendeskRetireState(workspaceId, item.proposalId, {
                        status: 'failed',
                        attemptedAtUtc,
                        completedAtUtc: new Date().toISOString(),
                        zendeskArticleId: item.zendeskArticleId ?? null,
                        locale: item.locale ?? null,
                        message
                    });
                    logger_1.logger.warn('zendesk-retire-service archive failed', {
                        workspaceId,
                        proposalId: item.proposalId,
                        familyId: item.familyId,
                        locale: item.locale,
                        message
                    });
                }
            }
        }
        catch (error) {
            if (error instanceof Error && error.message === 'retire_cancelled') {
                const endedAtUtc = new Date().toISOString();
                emit({
                    id: jobId,
                    command,
                    state: shared_types_1.JobState.CANCELED,
                    progress: 100,
                    message: 'Zendesk retire run canceled',
                    startedAt: startedAtUtc,
                    endedAt: endedAtUtc
                });
                return;
            }
            throw error;
        }
        const refreshedQueue = await this.workspaceRepository.listZendeskRetireQueue(workspaceId, input.proposalIds);
        const endedAtUtc = new Date().toISOString();
        const failedCount = refreshedQueue.items.filter((item) => item.remoteRetireStatus === 'failed').length;
        const allSucceeded = failedCount === 0;
        emit({
            id: jobId,
            command,
            state: allSucceeded ? shared_types_1.JobState.SUCCEEDED : shared_types_1.JobState.FAILED,
            progress: 100,
            message: allSucceeded
                ? `Archived ${succeeded} retire action${succeeded === 1 ? '' : 's'} in Zendesk.`
                : `Archived ${succeeded} of ${archiveable.length} retire action${archiveable.length === 1 ? '' : 's'} in Zendesk.`,
            startedAt: startedAtUtc,
            endedAt: endedAtUtc,
            metadata: {
                attempted: archiveable.length,
                succeeded,
                failed: failedCount
            }
        });
    }
    async archiveItem(client, item) {
        const articleIdRaw = item.zendeskArticleId?.trim();
        const articleId = Number.parseInt(articleIdRaw ?? '', 10);
        if (!Number.isInteger(articleId) || articleId <= 0) {
            throw new Error('Retire action is missing a valid Zendesk article id.');
        }
        let locale = normalizeLocale(item.locale);
        try {
            const remoteArticle = locale
                ? await client.showArticle(articleId, locale)
                : await client.showArticle(articleId);
            locale = locale ?? normalizeLocale(remoteArticle.locale);
            if (!locale) {
                throw new Error('Unable to determine the Zendesk locale required to archive this article.');
            }
            await client.archiveArticle(articleId, locale);
            return {
                status: 'archived',
                articleId: articleIdRaw ?? String(articleId),
                locale,
                message: locale === item.locale
                    ? 'Archived Zendesk article.'
                    : `Archived Zendesk article using source locale ${locale}.`
            };
        }
        catch (error) {
            if (error instanceof zendesk_client_1.ZendeskApiError && error.status === 404) {
                return {
                    status: 'already_archived',
                    articleId: articleIdRaw ?? String(articleId),
                    locale,
                    message: 'Zendesk article is already archived or no longer available.'
                };
            }
            throw error;
        }
    }
}
exports.ZendeskRetireService = ZendeskRetireService;
