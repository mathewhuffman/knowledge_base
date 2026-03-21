"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCoreCommands = registerCoreCommands;
const node_path_1 = __importDefault(require("node:path"));
const shared_types_1 = require("@kb-vault/shared-types");
const zendesk_client_1 = require("@kb-vault/zendesk-client");
const shared_types_2 = require("@kb-vault/shared-types");
const workspace_repository_1 = require("./workspace-repository");
const zendesk_sync_service_1 = require("./zendesk-sync-service");
const logger_1 = require("./logger");
function registerCoreCommands(bus, jobs, workspaceRoot) {
    const workspaceRepository = new workspace_repository_1.WorkspaceRepository(workspaceRoot);
    const zendeskSyncService = new zendesk_sync_service_1.ZendeskSyncService(workspaceRepository);
    const validRevisionStates = new Set(Object.values(shared_types_1.RevisionState));
    const validRevisionStatuses = new Set(Object.values(shared_types_1.RevisionStatus));
    const buildZendeskClient = async (workspaceId) => {
        const settings = await workspaceRepository.getWorkspaceSettings(workspaceId);
        const credentials = await workspaceRepository.getZendeskCredentialsForSync(workspaceId);
        if (!credentials) {
            throw new Error('Zendesk credentials are not configured for this workspace');
        }
        return zendesk_client_1.ZendeskClient.fromConfig({ timeoutMs: 30_000 }, {
            subdomain: settings.zendeskSubdomain,
            email: credentials.email,
            apiToken: credentials.apiToken
        });
    };
    bus.register('workspace.getRouteConfig', async () => ({
        ok: true,
        data: {
            routes: shared_types_1.AppRoute
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
        logger_1.logger.info('command workspace.create begin', { requestId });
        try {
            const input = payload;
            const required = ['name', 'zendeskSubdomain', 'defaultLocale'];
            if (!input || required.some((key) => !input[key])) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.create requires name, zendeskSubdomain, defaultLocale');
            }
            const created = await workspaceRepository.createWorkspace({
                name: input.name,
                zendeskSubdomain: input.zendeskSubdomain,
                defaultLocale: input.defaultLocale,
                enabledLocales: input.enabledLocales,
                path: input.path,
                zendeskBrandId: input.zendeskBrandId
            });
            logger_1.logger.info('command workspace.create success', {
                requestId,
                workspaceId: created.id
            });
            return {
                ok: true,
                data: created
            };
        }
        catch (error) {
            console.error('[command-error] workspace.create failed', {
                requestId,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            logger_1.logger.error('command workspace.create failed', {
                requestId,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.list', async (_payload, requestId) => {
        logger_1.logger.info('command workspace.list begin', { requestId });
        try {
            const workspaces = await workspaceRepository.getWorkspaceList();
            logger_1.logger.info('command workspace.list success', { requestId, count: workspaces.length });
            return {
                ok: true,
                data: { workspaces }
            };
        }
        catch (error) {
            console.error('[command-error] workspace.list failed', {
                requestId,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            logger_1.logger.error('command workspace.list failed', {
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
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.get requires workspaceId');
            }
            const workspace = await workspaceRepository.getWorkspace(workspaceId);
            return { ok: true, data: workspace };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.settings.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.settings.get requires workspaceId');
            }
            const settings = await workspaceRepository.getWorkspaceSettings(workspaceId);
            return { ok: true, data: settings };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.settings.update', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.settings.update requires workspaceId');
            }
            if (input.zendeskSubdomain === undefined &&
                input.zendeskBrandId === undefined &&
                input.defaultLocale === undefined &&
                input.enabledLocales === undefined) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.settings.update requires at least one setting field');
            }
            if (typeof input.defaultLocale === 'string' && !input.defaultLocale.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'defaultLocale cannot be empty');
            }
            if (typeof input.zendeskSubdomain === 'string' && !input.zendeskSubdomain.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendeskSubdomain cannot be empty');
            }
            if (Array.isArray(input.enabledLocales) && input.enabledLocales.length === 0) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'enabledLocales cannot be empty');
            }
            if (Array.isArray(input.enabledLocales) && input.enabledLocales.length && input.enabledLocales.some((locale) => !locale || !String(locale).trim())) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'enabledLocales must only contain non-empty values');
            }
            const updated = await workspaceRepository.updateWorkspaceSettings(input);
            return { ok: true, data: updated };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'defaultLocale must be included in enabledLocales' ||
                error.message === 'No settings provided' ||
                error.message === 'defaultLocale cannot be empty' ||
                error.message === 'enabledLocales cannot be empty' ||
                error.message === 'zendeskSubdomain cannot be empty') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.open', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.open requires workspaceId');
            }
            const workspace = await workspaceRepository.openWorkspace(workspaceId);
            return { ok: true, data: workspace };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.delete', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.delete requires workspaceId');
            }
            await workspaceRepository.deleteWorkspace(workspaceId);
            return { ok: true, data: { workspaceId, deleted: true } };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.default.set', async (payload) => {
        try {
            const { workspaceId } = payload;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.default.set requires workspaceId');
            }
            await workspaceRepository.setDefaultWorkspace(workspaceId);
            return {
                ok: true,
                data: {
                    workspaceId,
                    isDefault: true
                }
            };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.explorer.getTree', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.explorer.getTree requires workspaceId');
            }
            const nodes = await workspaceRepository.getExplorerTree(workspaceId);
            return {
                ok: true,
                data: {
                    workspaceId,
                    nodes
                }
            };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('articleFamily.list', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'articleFamily.list requires workspaceId');
            }
            const families = await workspaceRepository.listArticleFamilies(workspaceId);
            return { ok: true, data: { workspaceId, families } };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('articleFamily.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const familyId = payload?.familyId;
            if (!workspaceId || !familyId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'articleFamily.get requires workspaceId and familyId');
            }
            const family = await workspaceRepository.getArticleFamily(workspaceId, familyId);
            return { ok: true, data: family };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'Article family not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Article family not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('articleFamily.create', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.externalKey || !input.title) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'articleFamily.create requires workspaceId, externalKey, title');
            }
            if (typeof input.externalKey === 'string' && !input.externalKey.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'articleFamily.externalKey cannot be empty');
            }
            if (typeof input.title === 'string' && !input.title.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'articleFamily.title cannot be empty');
            }
            const family = await workspaceRepository.createArticleFamily(input);
            return { ok: true, data: family };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'Article family already exists' ||
                error.message === 'Article family title is required' ||
                error.message === 'Article family externalKey is required' ||
                error.message === 'Article family title cannot be empty') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('articleFamily.update', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.familyId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'articleFamily.update requires workspaceId and familyId');
            }
            if (input.title === undefined &&
                input.sectionId === undefined &&
                input.categoryId === undefined &&
                input.retiredAtUtc === undefined) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'articleFamily.update requires at least one field');
            }
            const family = await workspaceRepository.updateArticleFamily(input);
            return { ok: true, data: family };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Article family not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'Article family update requires at least one field' || error.message === 'Article family title cannot be empty') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('articleFamily.delete', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const familyId = payload?.familyId;
            if (!workspaceId || !familyId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'articleFamily.delete requires workspaceId and familyId');
            }
            await workspaceRepository.deleteArticleFamily(workspaceId, familyId);
            return { ok: true, data: { workspaceId, familyId, deleted: true } };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Article family not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('localeVariant.list', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'localeVariant.list requires workspaceId');
            }
            const variants = await workspaceRepository.listLocaleVariants(workspaceId);
            return { ok: true, data: { workspaceId, variants } };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('localeVariant.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const variantId = payload?.variantId;
            if (!workspaceId || !variantId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'localeVariant.get requires workspaceId and variantId');
            }
            const variant = await workspaceRepository.getLocaleVariant(workspaceId, variantId);
            return { ok: true, data: variant };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Locale variant not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('localeVariant.create', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.familyId || !input.locale) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'localeVariant.create requires workspaceId, familyId, locale');
            }
            if (typeof input.locale === 'string' && !input.locale.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'locale is required');
            }
            if (input.status && !validRevisionStates.has(input.status)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'localeVariant.status must be live|draft_branch|obsolete|retired');
            }
            const variant = await workspaceRepository.createLocaleVariant(input);
            return { ok: true, data: variant };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Article family not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'Locale is required' ||
                error.message === 'Locale variant already exists') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('localeVariant.update', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.variantId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'localeVariant.update requires workspaceId and variantId');
            }
            if (input.locale === undefined &&
                input.status === undefined &&
                input.retiredAtUtc === undefined) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'localeVariant.update requires at least one field');
            }
            if (input.status && !validRevisionStates.has(input.status)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'localeVariant.status must be live|draft_branch|obsolete|retired');
            }
            const variant = await workspaceRepository.updateLocaleVariant(input);
            return { ok: true, data: variant };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Locale variant not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'Locale is required' ||
                error.message === 'Locale variant update requires at least one field' ||
                error.message === 'Locale variant already exists') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('localeVariant.delete', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const variantId = payload?.variantId;
            if (!workspaceId || !variantId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'localeVariant.delete requires workspaceId and variantId');
            }
            await workspaceRepository.deleteLocaleVariant(workspaceId, variantId);
            return { ok: true, data: { workspaceId, variantId, deleted: true } };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Locale variant not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('revision.list', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const localeVariantId = payload?.localeVariantId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revision.list requires workspaceId');
            }
            const revisions = await workspaceRepository.listRevisions(workspaceId, localeVariantId);
            return { ok: true, data: { workspaceId, localeVariantId, revisions } };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('revision.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const revisionId = payload?.revisionId;
            if (!workspaceId || !revisionId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revision.get requires workspaceId and revisionId');
            }
            const revision = await workspaceRepository.getRevision(workspaceId, revisionId);
            return { ok: true, data: revision };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Revision not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('revision.create', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.localeVariantId || !input.filePath || !input.revisionType || !input.status || input.revisionNumber === undefined) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revision.create requires workspaceId, localeVariantId, revisionType, status, revisionNumber, filePath');
            }
            if (!validRevisionStates.has(input.revisionType)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revisionType must be live|draft_branch|obsolete|retired');
            }
            if (!validRevisionStatuses.has(input.status)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'status must be open|promoted|failed|deleted');
            }
            if (!Number.isInteger(input.revisionNumber) || input.revisionNumber < 0) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revisionNumber must be a non-negative integer');
            }
            const revision = await workspaceRepository.createRevision(input);
            return { ok: true, data: revision };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Locale variant not found' || error.message === 'Revision not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'filePath is required' || error.message === 'revisionNumber must not regress' || error.message === 'revisionNumber must be non-negative') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            if (error.message === 'revisionNumber must be an integer') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('revision.update', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.revisionId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revision.update requires workspaceId and revisionId');
            }
            if (input.revisionType === undefined &&
                input.branchId === undefined &&
                input.filePath === undefined &&
                input.contentHash === undefined &&
                input.sourceRevisionId === undefined &&
                input.revisionNumber === undefined &&
                input.status === undefined) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revision.update requires at least one field');
            }
            if (input.revisionType && !validRevisionStates.has(input.revisionType)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revisionType must be live|draft_branch|obsolete|retired');
            }
            if (input.status && !validRevisionStatuses.has(input.status)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'status must be open|promoted|failed|deleted');
            }
            if (input.revisionNumber !== undefined && (!Number.isInteger(input.revisionNumber) || input.revisionNumber < 0)) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revisionNumber must be a non-negative integer');
            }
            const revision = await workspaceRepository.updateRevision(input);
            return { ok: true, data: revision };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Revision not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'filePath is required' || error.message === 'revisionNumber must not regress') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            if (error.message === 'revisionNumber must be an integer' || error.message === 'revision.update requires at least one field') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('revision.delete', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const revisionId = payload?.revisionId;
            if (!workspaceId || !revisionId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'revision.delete requires workspaceId and revisionId');
            }
            await workspaceRepository.deleteRevision(workspaceId, revisionId);
            return { ok: true, data: { workspaceId, revisionId, deleted: true } };
        }
        catch (error) {
            if (error.message === 'Workspace not found' || error.message === 'Revision not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.search', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId || !input.query) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.search requires workspaceId and query');
            }
            const result = await workspaceRepository.searchArticles(input.workspaceId, input);
            return { ok: true, data: result };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.history.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const localeVariantId = payload?.localeVariantId;
            if (!workspaceId || !localeVariantId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.history.get requires workspaceId and localeVariantId');
            }
            const result = await workspaceRepository.getHistory(workspaceId, localeVariantId);
            return { ok: true, data: result };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.repository.info', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.repository.info requires workspaceId');
            }
            const payloadData = await workspaceRepository.getRepositoryStructure(workspaceId);
            return { ok: true, data: payloadData };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('workspace.route.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'workspace.route.get requires workspaceId');
            }
            const route = await workspaceRepository.workspaceRoutePayload(workspaceId);
            return { ok: true, data: route };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    jobs.registerRunner('workspace.bootstrap', async (payload, emit) => {
        emit({
            id: payload.jobId ?? 'bootstrap',
            command: 'workspace.bootstrap',
            state: shared_types_2.JobState.RUNNING,
            progress: 20,
            message: 'Resolving workspace root'
        });
        emit({
            id: payload.jobId ?? 'bootstrap',
            command: 'workspace.bootstrap',
            state: shared_types_2.JobState.RUNNING,
            progress: 80,
            message: `Using root ${workspaceRoot}`
        });
        emit({
            id: payload.jobId ?? 'bootstrap',
            command: 'workspace.bootstrap',
            state: shared_types_2.JobState.RUNNING,
            progress: 100,
            message: `Workspace path: ${node_path_1.default.resolve(workspaceRoot)}`
        });
    });
    bus.register('zendesk.credentials.get', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.credentials.get requires workspaceId');
            }
            const credentials = await workspaceRepository.getZendeskCredentials(workspaceId);
            return {
                ok: true,
                data: credentials
            };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('zendesk.credentials.save', async (payload) => {
        try {
            const input = payload;
            if (!input?.workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.credentials.save requires workspaceId');
            }
            if (!input.email?.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.credentials.save requires email');
            }
            if (!input.apiToken?.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.credentials.save requires apiToken');
            }
            const saved = await workspaceRepository.saveZendeskCredentials(input.workspaceId, input.email, input.apiToken);
            return { ok: true, data: saved };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'Encrypted credential storage is unavailable') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_AUTHORIZED, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('zendesk.connection.test', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.connection.test requires workspaceId');
            }
            const client = await buildZendeskClient(workspaceId);
            const result = await client.testConnection();
            return { ok: true, data: { ...result, workspaceId, checkedAtUtc: new Date().toISOString() } };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'Encrypted credential storage is unavailable') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_AUTHORIZED, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('zendesk.categories.list', async (payload) => {
        try {
            const { workspaceId, locale } = payload;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.categories.list requires workspaceId');
            }
            if (!locale?.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.categories.list requires locale');
            }
            const client = await buildZendeskClient(workspaceId);
            const categories = await client.listCategories(locale.trim());
            return { ok: true, data: categories };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'Zendesk credentials are not configured for this workspace') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'Encrypted credential storage is unavailable') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_AUTHORIZED, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('zendesk.sections.list', async (payload) => {
        try {
            const { workspaceId, locale, categoryId } = payload;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.sections.list requires workspaceId');
            }
            if (!locale?.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.sections.list requires locale');
            }
            if (!Number.isInteger(categoryId) || categoryId < 0) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.sections.list requires categoryId');
            }
            const client = await buildZendeskClient(workspaceId);
            const sections = await client.listSections(categoryId, locale.trim());
            return { ok: true, data: sections };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'Zendesk credentials are not configured for this workspace') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'Encrypted credential storage is unavailable') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_AUTHORIZED, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('zendesk.articles.search', async (payload) => {
        try {
            const { workspaceId, locale, query } = payload;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.articles.search requires workspaceId');
            }
            if (!locale?.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.articles.search requires locale');
            }
            if (!query?.trim()) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.articles.search requires query');
            }
            const client = await buildZendeskClient(workspaceId);
            const articles = await client.searchArticles(locale.trim(), query.trim());
            return { ok: true, data: articles };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            if (error.message === 'Zendesk credentials are not configured for this workspace') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, error.message);
            }
            if (error.message === 'Encrypted credential storage is unavailable') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_AUTHORIZED, error.message);
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    bus.register('zendesk.sync.getLatest', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            if (!workspaceId) {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INVALID_REQUEST, 'zendesk.sync.getLatest requires workspaceId');
            }
            const latest = await workspaceRepository.getLatestSyncRun(workspaceId);
            return {
                ok: true,
                data: latest ?? null
            };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
    jobs.registerRunner('zendesk.sync.run', async (payload, emit) => {
        const input = payload.input;
        if (!input?.workspaceId || !input.mode) {
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.FAILED,
                progress: 100,
                message: 'zendesk.sync.run requires workspaceId and mode'
            });
            return;
        }
        if (input.mode !== 'full' && input.mode !== 'incremental') {
            emit({
                id: payload.jobId,
                command: payload.command,
                state: shared_types_2.JobState.FAILED,
                progress: 100,
                message: 'sync mode must be full or incremental'
            });
            return;
        }
        const syncInput = input;
        await zendeskSyncService.runSync({
            workspaceId: syncInput.workspaceId,
            mode: syncInput.mode,
            locale: syncInput.locale ? String(syncInput.locale).trim() : undefined,
            maxRetries: syncInput.maxRetries,
            retryDelayMs: syncInput.retryDelayMs,
            retryMaxDelayMs: syncInput.retryMaxDelayMs
        }, emit, payload.command, payload.jobId);
    });
    bus.register('system.migrations.health', async (payload) => {
        try {
            const workspaceId = payload?.workspaceId;
            const health = await workspaceRepository.getMigrationHealth(workspaceId);
            return {
                ok: true,
                data: health
            };
        }
        catch (error) {
            if (error.message === 'Workspace not found') {
                return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.NOT_FOUND, 'Workspace not found');
            }
            return (0, shared_types_1.createErrorResult)(shared_types_1.AppErrorCode.INTERNAL_ERROR, String(error.message || error));
        }
    });
}
