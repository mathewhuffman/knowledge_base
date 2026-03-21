import path from 'node:path';
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
  type ZendeskCategoryRecord,
  type ZendeskSectionRecord,
  type ZendeskSearchArticleRecord,
  type ZendeskCategoriesListRequest,
  type ZendeskSectionsListRequest,
  type ZendeskSearchArticlesRequest,
  type WorkspaceDefaultRequest,
  type ZendeskSyncRunRequest
} from '@kb-vault/shared-types';
import { ZendeskClient } from '@kb-vault/zendesk-client';
import { CommandBus } from './command-bus';
import { JobRegistry } from './job-runner';
import { JobState } from '@kb-vault/shared-types';
import { WorkspaceRepository } from './workspace-repository';
import { ZendeskSyncService, type ZendeskSyncServiceInput } from './zendesk-sync-service';
import { logger } from './logger';

export function registerCoreCommands(bus: CommandBus, jobs: JobRegistry, workspaceRoot: string) {
  const workspaceRepository = new WorkspaceRepository(workspaceRoot);
  const zendeskSyncService = new ZendeskSyncService(workspaceRepository);
  const validRevisionStates = new Set(Object.values(RevisionState));
  const validRevisionStatuses = new Set(Object.values(RevisionStatus));
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
        input.enabledLocales === undefined
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
}
