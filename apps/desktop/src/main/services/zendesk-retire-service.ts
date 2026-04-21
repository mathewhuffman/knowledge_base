import {
  JobState,
  type JobEvent,
  type ZendeskRetireQueueItem,
  type ZendeskRetireRunRequest
} from '@kb-vault/shared-types';
import { ZendeskApiError, ZendeskClient } from '@kb-vault/zendesk-client';
import { logger } from './logger';
import { WorkspaceRepository } from './workspace-repository';

type BuildZendeskClient = (workspaceId: string) => Promise<ZendeskClient>;

interface ArchiveExecutionResult {
  status: 'archived' | 'already_archived';
  articleId: string;
  locale?: string;
  message: string;
}

function normalizeLocale(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export class ZendeskRetireService {
  constructor(
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly buildZendeskClient: BuildZendeskClient
  ) {}

  async runRetire(
    input: ZendeskRetireRunRequest,
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
      state: JobState.RUNNING,
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
        state: JobState.FAILED,
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
          state: JobState.RUNNING,
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
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.workspaceRepository.updateProposalZendeskRetireState(workspaceId, item.proposalId, {
            status: 'failed',
            attemptedAtUtc,
            completedAtUtc: new Date().toISOString(),
            zendeskArticleId: item.zendeskArticleId ?? null,
            locale: item.locale ?? null,
            message
          });
          logger.warn('zendesk-retire-service archive failed', {
            workspaceId,
            proposalId: item.proposalId,
            familyId: item.familyId,
            locale: item.locale,
            message
          });
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'retire_cancelled') {
        const endedAtUtc = new Date().toISOString();
        emit({
          id: jobId,
          command,
          state: JobState.CANCELED,
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
      state: allSucceeded ? JobState.SUCCEEDED : JobState.FAILED,
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

  private async archiveItem(client: ZendeskClient, item: ZendeskRetireQueueItem): Promise<ArchiveExecutionResult> {
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
    } catch (error) {
      if (error instanceof ZendeskApiError && error.status === 404) {
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
