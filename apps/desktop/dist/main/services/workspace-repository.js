"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceRepository = void 0;
const node_crypto_1 = require("node:crypto");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_util_1 = require("node:util");
const electron_1 = require("electron");
const shared_types_1 = require("@kb-vault/shared-types");
const db_1 = require("@kb-vault/db");
const logger_1 = require("./logger");
const DEFAULT_DB_FILE = 'kb-vault.sqlite';
const DEFAULT_KB_ACCESS_MODE = 'mcp';
const CATALOG_DB_PATH = node_path_1.default.join('.meta', 'catalog.sqlite');
const WORKSPACE_SCOPED_DB_TABLES = [
    'article_families',
    'revisions',
    'draft_branches',
    'pbi_batches',
    'ai_runs',
    'proposals',
    'publish_jobs',
    'assets',
    'template_packs',
    'zendesk_credentials',
    'zendesk_sync_checkpoints',
    'zendesk_sync_runs',
];
const PBIBATCH_STATUS_SEQUENCE = [
    shared_types_1.PBIBatchStatus.IMPORTED,
    shared_types_1.PBIBatchStatus.SCOPED,
    shared_types_1.PBIBatchStatus.SUBMITTED,
    shared_types_1.PBIBatchStatus.ANALYZED,
    shared_types_1.PBIBatchStatus.REVIEW_IN_PROGRESS,
    shared_types_1.PBIBatchStatus.REVIEW_COMPLETE,
    shared_types_1.PBIBatchStatus.ARCHIVED
];
class WorkspaceRepository {
    workspaceRoot;
    catalogDbPath;
    lastCatalogFailureMs = 0;
    lastCatalogFailureMessage;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.catalogDbPath = node_path_1.default.join(this.workspaceRoot, CATALOG_DB_PATH);
    }
    async listWorkspaces() {
        const catalog = await this.openCatalogWithRecovery();
        try {
            const rows = catalog.all(`
        SELECT id, name, path, created_at, updated_at, last_opened_at, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, state, is_default
        FROM workspaces
        ORDER BY name COLLATE NOCASE
      `);
            return rows.map(mapWorkspaceRow);
        }
        finally {
            catalog.close();
        }
    }
    async getWorkspace(id) {
        const catalog = await this.openCatalogWithRecovery();
        try {
            const row = catalog.get(`SELECT * FROM workspaces WHERE id = @id`, { id });
            if (!row) {
                throw new Error('Workspace not found');
            }
            return mapWorkspaceRow(row);
        }
        finally {
            catalog.close();
        }
    }
    async getWorkspaceSettings(id) {
        const catalog = await this.openCatalogWithRecovery();
        try {
            const row = catalog.get(`SELECT * FROM workspaces WHERE id = @id`, { id });
            if (!row) {
                throw new Error('Workspace not found');
            }
            const workspace = await this.getWorkspace(id);
            await this.ensureWorkspaceDb(workspace.path);
            const workspaceDbPath = node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE);
            const workspaceDb = this.openWorkspaceDbWithRecovery(workspaceDbPath);
            try {
                const settings = workspaceDb.get(`SELECT workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales
            , kb_access_mode
           FROM workspace_settings WHERE workspace_id = @workspaceId`, { workspaceId: id });
                if (settings) {
                    return {
                        workspaceId: settings.workspace_id,
                        zendeskSubdomain: settings.zendesk_subdomain,
                        zendeskBrandId: settings.zendesk_brand_id ?? undefined,
                        defaultLocale: settings.default_locale,
                        enabledLocales: safeParseLocales(settings.enabled_locales),
                        kbAccessMode: normalizeKbAccessMode(settings.kb_access_mode)
                    };
                }
                const enabledLocales = safeParseLocales(row.enabled_locales);
                workspaceDb.run(`INSERT INTO workspace_settings (
            workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, kb_access_mode, updated_at
          ) VALUES (
            @workspaceId, @zendeskSubdomain, @zendeskBrandId, @defaultLocale, @enabledLocales, @kbAccessMode, @updatedAt
          )`, {
                    workspaceId: id,
                    zendeskSubdomain: row.zendesk_subdomain,
                    zendeskBrandId: row.zendesk_brand_id,
                    defaultLocale: row.default_locale,
                    enabledLocales: JSON.stringify(enabledLocales),
                    kbAccessMode: DEFAULT_KB_ACCESS_MODE,
                    updatedAt: new Date().toISOString()
                });
                return {
                    workspaceId: id,
                    zendeskSubdomain: row.zendesk_subdomain,
                    zendeskBrandId: row.zendesk_brand_id ?? undefined,
                    defaultLocale: row.default_locale,
                    enabledLocales,
                    kbAccessMode: DEFAULT_KB_ACCESS_MODE
                };
            }
            finally {
                workspaceDb.close();
            }
        }
        finally {
            catalog.close();
        }
    }
    async updateWorkspaceSettings(payload) {
        const catalog = await this.openCatalogWithRecovery();
        try {
            const row = catalog.get(`SELECT * FROM workspaces WHERE id = @id`, { id: payload.workspaceId });
            if (!row) {
                throw new Error('Workspace not found');
            }
            const workspace = await this.getWorkspace(payload.workspaceId);
            const workspaceDbPath = node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE);
            const workspaceDb = this.openWorkspaceDbWithRecovery(workspaceDbPath);
            try {
                const existing = workspaceDb.get(`SELECT workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales
            , kb_access_mode
           FROM workspace_settings WHERE workspace_id = @workspaceId`, { workspaceId: payload.workspaceId });
                const fallbackDefaultLocale = existing?.default_locale ?? row.default_locale;
                const fallbackSubdomain = existing?.zendesk_subdomain ?? row.zendesk_subdomain;
                const fallbackBrand = existing?.zendesk_brand_id ?? row.zendesk_brand_id;
                const fallbackEnabledLocales = safeParseLocales(existing?.enabled_locales ?? row.enabled_locales);
                if (payload.zendeskSubdomain === undefined &&
                    payload.zendeskBrandId === undefined &&
                    payload.defaultLocale === undefined &&
                    payload.enabledLocales === undefined &&
                    payload.kbAccessMode === undefined) {
                    throw new Error('No settings provided');
                }
                if (payload.kbAccessMode !== undefined &&
                    !isValidKbAccessMode(payload.kbAccessMode)) {
                    throw new Error('kbAccessMode must be mcp or cli');
                }
                if (payload.defaultLocale !== undefined && !payload.defaultLocale.trim()) {
                    throw new Error('defaultLocale cannot be empty');
                }
                if (payload.zendeskSubdomain !== undefined && !payload.zendeskSubdomain.trim()) {
                    throw new Error('zendeskSubdomain cannot be empty');
                }
                if (payload.enabledLocales?.length === 0) {
                    throw new Error('enabledLocales cannot be empty');
                }
                const enabledLocales = payload.enabledLocales?.length
                    ? normalizeLocales(payload.enabledLocales)
                    : fallbackEnabledLocales;
                const nextDefaultLocale = payload.defaultLocale ?? fallbackDefaultLocale;
                const nextSubdomain = payload.zendeskSubdomain ?? fallbackSubdomain;
                const nextBrand = payload.zendeskBrandId !== undefined ? payload.zendeskBrandId : fallbackBrand;
                const nextKbAccessMode = normalizeKbAccessMode(payload.kbAccessMode ?? existing?.kb_access_mode);
                if (!nextSubdomain) {
                    throw new Error('zendeskSubdomain cannot be empty');
                }
                if (!nextDefaultLocale) {
                    throw new Error('defaultLocale cannot be empty');
                }
                if (!enabledLocales.length) {
                    throw new Error('enabledLocales cannot be empty');
                }
                if (!enabledLocales.includes(nextDefaultLocale)) {
                    throw new Error('defaultLocale must be included in enabledLocales');
                }
                const normalizedEnabledLocales = normalizeLocales(enabledLocales);
                const now = new Date().toISOString();
                workspaceDb.run(`INSERT OR REPLACE INTO workspace_settings (
            workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, kb_access_mode, updated_at
          ) VALUES (
            @workspaceId, @zendeskSubdomain, @zendeskBrandId, @defaultLocale, @enabledLocales, @kbAccessMode, @updatedAt
          )`, {
                    workspaceId: payload.workspaceId,
                    zendeskSubdomain: nextSubdomain,
                    zendeskBrandId: nextBrand,
                    defaultLocale: nextDefaultLocale,
                    enabledLocales: JSON.stringify(normalizedEnabledLocales),
                    kbAccessMode: nextKbAccessMode,
                    updatedAt: now
                });
                catalog.run(`UPDATE workspaces
           SET zendesk_subdomain = @zendeskSubdomain,
               zendesk_brand_id = @zendeskBrandId,
               default_locale = @defaultLocale,
               enabled_locales = @enabledLocales,
               updated_at = @updatedAt
           WHERE id = @id`, {
                    id: payload.workspaceId,
                    zendeskSubdomain: nextSubdomain,
                    zendeskBrandId: nextBrand,
                    defaultLocale: nextDefaultLocale,
                    enabledLocales: JSON.stringify(normalizedEnabledLocales),
                    updatedAt: now
                });
                return {
                    workspaceId: payload.workspaceId,
                    zendeskSubdomain: nextSubdomain,
                    zendeskBrandId: nextBrand ?? undefined,
                    defaultLocale: nextDefaultLocale,
                    enabledLocales: normalizedEnabledLocales,
                    kbAccessMode: nextKbAccessMode
                };
            }
            finally {
                workspaceDb.close();
            }
        }
        finally {
            catalog.close();
        }
    }
    async createWorkspace(payload) {
        const startedAt = Date.now();
        logger_1.logger.info('workspace-repository.createWorkspace start', {
            name: payload.name,
            defaultLocale: payload.defaultLocale,
            hasPathOverride: Boolean(payload.path),
            enabledLocalesCount: payload.enabledLocales?.length ?? 0
        });
        const catalog = await this.openCatalogWithRecovery();
        const now = new Date().toISOString();
        const resolvedPath = workspacePath(payload.path, this.workspaceRoot, payload.name);
        try {
            const existing = catalog.get(`SELECT id FROM workspaces WHERE name = @name OR path = @path`, { name: payload.name, path: resolvedPath });
            if (existing) {
                throw new Error('Workspace with name or path already exists');
            }
            const id = (0, node_crypto_1.randomUUID)();
            const enabledLocales = normalizeLocales(payload.enabledLocales);
            const totalExisting = catalog.get('SELECT COUNT(*) AS total FROM workspaces');
            const shouldBeDefault = (totalExisting?.total ?? 0) === 0;
            await this.prepareWorkspaceFilesystem(resolvedPath);
            const workspaceDbPath = await this.ensureWorkspaceDb(resolvedPath);
            this.normalizeWorkspaceDbIdentity(workspaceDbPath, id);
            const workspaceRecord = {
                id,
                name: payload.name,
                createdAtUtc: now,
                updatedAtUtc: now,
                lastOpenedAtUtc: now,
                isDefaultWorkspace: shouldBeDefault,
                zendeskConnectionId: id,
                defaultLocale: payload.defaultLocale,
                enabledLocales,
                state: shared_types_1.WorkspaceState.ACTIVE,
                path: resolvedPath
            };
            catalog.run(`INSERT INTO workspaces (
          id, name, path, created_at, updated_at, last_opened_at, zendesk_subdomain,
          zendesk_brand_id, default_locale, enabled_locales, state, is_default
        ) VALUES (
          @id, @name, @path, @createdAt, @updatedAt, @lastOpenedAt, @subdomain,
          @brand, @defaultLocale, @enabledLocales, @state, @isDefault
        )`, {
                id,
                name: payload.name,
                path: resolvedPath,
                createdAt: now,
                updatedAt: now,
                lastOpenedAt: now,
                subdomain: payload.zendeskSubdomain,
                brand: payload.zendeskBrandId ?? null,
                defaultLocale: payload.defaultLocale,
                enabledLocales: JSON.stringify(enabledLocales),
                state: shared_types_1.WorkspaceState.ACTIVE,
                isDefault: shouldBeDefault ? 1 : 0
            });
            const workspaceDb = this.openWorkspaceDbWithRecovery(workspaceDbPath);
            try {
                workspaceDb.run(`INSERT INTO workspace_settings (
            workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, kb_access_mode, updated_at
          ) VALUES (
            @workspaceId, @zendeskSubdomain, @zendeskBrandId, @defaultLocale, @enabledLocales, @kbAccessMode, @updatedAt
          )`, {
                    workspaceId: id,
                    zendeskSubdomain: payload.zendeskSubdomain,
                    zendeskBrandId: payload.zendeskBrandId ?? null,
                    defaultLocale: payload.defaultLocale,
                    enabledLocales: JSON.stringify(enabledLocales),
                    kbAccessMode: DEFAULT_KB_ACCESS_MODE,
                    updatedAt: now
                });
            }
            finally {
                workspaceDb.close();
            }
            return workspaceRecord;
        }
        catch (error) {
            logger_1.logger.error('workspace-repository.createWorkspace failed', {
                name: payload.name,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
        finally {
            const elapsedMs = Date.now() - startedAt;
            logger_1.logger.info('workspace-repository.createWorkspace complete', {
                name: payload.name,
                workspacePath: resolvedPath,
                elapsedMs
            });
            catalog.close();
        }
    }
    async openWorkspace(id) {
        const catalog = await this.openCatalogWithRecovery();
        try {
            const row = catalog.get(`SELECT * FROM workspaces WHERE id = @id`, { id });
            if (!row) {
                throw new Error('Workspace not found');
            }
            const now = new Date().toISOString();
            catalog.run(`UPDATE workspaces SET last_opened_at = @now, updated_at = @now WHERE id = @id`, { now, id });
            return { ...mapWorkspaceRow({ ...row, last_opened_at: now, updated_at: now }), lastOpenedAtUtc: now };
        }
        finally {
            catalog.close();
        }
    }
    async deleteWorkspace(id) {
        const catalog = await this.openCatalogWithRecovery();
        try {
            const row = catalog.get(`SELECT path FROM workspaces WHERE id = @id`, { id });
            if (!row) {
                throw new Error('Workspace not found');
            }
            await promises_1.default.rm(row.path, { recursive: true, force: true });
            catalog.run(`DELETE FROM workspaces WHERE id = @id`, { id });
        }
        finally {
            catalog.close();
        }
    }
    async getWorkspaceListWithCounts() {
        const catalog = await this.openCatalogWithRecovery();
        try {
            const catalogRows = catalog.all(`
        SELECT id, name, path, created_at, updated_at, last_opened_at, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, state, is_default
        FROM workspaces
        ORDER BY name COLLATE NOCASE
      `);
            const workspaceItems = [];
            for (const row of catalogRows) {
                const workspaceDbPath = node_path_1.default.join(row.path, '.meta', DEFAULT_DB_FILE);
                const workspaceDb = this.openWorkspaceDbWithRecovery(workspaceDbPath);
                try {
                    const articleCount = workspaceDb.get('SELECT COUNT(*) AS total FROM article_families', {})?.total ?? 0;
                    const draftCount = workspaceDb.get(`SELECT COUNT(*) AS total FROM revisions WHERE revision_type = 'draft_branch'`, {})?.total ?? 0;
                    workspaceItems.push(buildWorkspaceItemFromCatalog(row, articleCount, draftCount));
                }
                finally {
                    workspaceDb.close();
                }
            }
            return workspaceItems;
        }
        finally {
            catalog.close();
        }
    }
    async getWorkspaceList() {
        const startedAt = Date.now();
        logger_1.logger.info('workspace-repository.getWorkspaceList quick start');
        let catalog;
        try {
            catalog = await this.openCatalogWithRecovery();
        }
        catch (error) {
            logger_1.logger.warn('workspace-repository.getWorkspaceList unable to open catalog', {
                elapsedMs: Date.now() - startedAt,
                message: error instanceof Error ? error.message : String(error),
                code: error?.code
            });
            return [];
        }
        let itemCount = 0;
        try {
            const catalogRows = catalog.all(`
        SELECT id, name, path, created_at, updated_at, last_opened_at, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, state, is_default
        FROM workspaces
        ORDER BY name COLLATE NOCASE
      `);
            itemCount = catalogRows.length;
            const items = catalogRows.map((row) => ({
                ...mapWorkspaceRow(row),
                articleCount: 0,
                draftCount: 0
            }));
            return items;
        }
        catch (error) {
            logger_1.logger.error('workspace-repository.getWorkspaceList query failed', {
                elapsedMs: Date.now() - startedAt,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            return [];
        }
        finally {
            const elapsedMs = Date.now() - startedAt;
            logger_1.logger.info('workspace-repository.getWorkspaceList quick path', {
                elapsedMs,
                count: itemCount
            });
            catalog.close();
        }
    }
    async setDefaultWorkspace(workspaceId) {
        const catalog = await this.openCatalogWithRecovery();
        try {
            const existing = catalog.get(`SELECT id FROM workspaces WHERE id = @id`, { id: workspaceId });
            if (!existing) {
                throw new Error('Workspace not found');
            }
            catalog.run('BEGIN IMMEDIATE');
            try {
                catalog.run('UPDATE workspaces SET is_default = 0');
                catalog.run(`UPDATE workspaces SET is_default = 1 WHERE id = @id`, { id: workspaceId });
                catalog.run('COMMIT');
            }
            catch (error) {
                catalog.run('ROLLBACK');
                throw error;
            }
        }
        finally {
            catalog.close();
        }
    }
    async listArticleFamilies(workspaceId) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            return workspaceDb.all(`SELECT id, workspace_id as workspaceId, external_key as externalKey, title, section_id as sectionId, category_id as categoryId, retired_at as retiredAtUtc
         FROM article_families
         WHERE workspace_id = @workspaceId
         ORDER BY title`, { workspaceId });
        }
        finally {
            workspaceDb.close();
        }
    }
    async getArticleFamily(workspaceId, familyId) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const family = workspaceDb.get(`SELECT id, workspace_id as workspaceId, external_key as externalKey, title, section_id as sectionId, category_id as categoryId, retired_at as retiredAtUtc
         FROM article_families
         WHERE id = @familyId AND workspace_id = @workspaceId`, { familyId, workspaceId });
            if (!family) {
                throw new Error('Article family not found');
            }
            return family;
        }
        finally {
            workspaceDb.close();
        }
    }
    async createArticleFamily(payload) {
        const workspace = await this.getWorkspace(payload.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        const now = new Date().toISOString();
        try {
            const existing = workspaceDb.get(`SELECT id FROM article_families WHERE external_key = @externalKey AND workspace_id = @workspaceId`, { externalKey: payload.externalKey, workspaceId: payload.workspaceId });
            if (existing) {
                throw new Error('Article family already exists');
            }
            const id = (0, node_crypto_1.randomUUID)();
            const title = payload.title.trim();
            if (!title) {
                throw new Error('Article family title is required');
            }
            const externalKey = payload.externalKey.trim();
            if (!externalKey) {
                throw new Error('Article family externalKey is required');
            }
            workspaceDb.run(`INSERT INTO article_families (id, workspace_id, external_key, title, section_id, category_id, retired_at)
         VALUES (@id, @workspaceId, @externalKey, @title, @sectionId, @categoryId, @retiredAtUtc)`, {
                id,
                workspaceId: payload.workspaceId,
                externalKey,
                title,
                sectionId: payload.sectionId ?? null,
                categoryId: payload.categoryId ?? null,
                retiredAtUtc: payload.retiredAtUtc ?? null
            });
            return {
                id,
                workspaceId: payload.workspaceId,
                externalKey,
                title,
                sectionId: payload.sectionId,
                categoryId: payload.categoryId,
                retiredAtUtc: payload.retiredAtUtc
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async updateArticleFamily(payload) {
        const workspace = await this.getWorkspace(payload.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const existing = workspaceDb.get(`SELECT id, workspace_id as workspaceId, external_key as externalKey, title, section_id as sectionId, category_id as categoryId, retired_at as retiredAtUtc
         FROM article_families
         WHERE id = @familyId AND workspace_id = @workspaceId`, { familyId: payload.familyId, workspaceId: payload.workspaceId });
            if (!existing) {
                throw new Error('Article family not found');
            }
            if (payload.title === undefined &&
                payload.sectionId === undefined &&
                payload.categoryId === undefined &&
                payload.retiredAtUtc === undefined) {
                throw new Error('Article family update requires at least one field');
            }
            const title = payload.title ?? existing.title;
            if (payload.title !== undefined && !title.trim()) {
                throw new Error('Article family title cannot be empty');
            }
            const sectionId = payload.sectionId !== undefined
                ? (payload.sectionId ?? undefined)
                : (existing.sectionId ?? undefined);
            const categoryId = payload.categoryId !== undefined
                ? (payload.categoryId ?? undefined)
                : (existing.categoryId ?? undefined);
            const retiredAt = payload.retiredAtUtc === null ? null : (payload.retiredAtUtc ?? existing.retiredAtUtc ?? null);
            workspaceDb.run(`UPDATE article_families
         SET title = @title,
             section_id = @sectionId,
             category_id = @categoryId,
             retired_at = @retiredAtUtc
         WHERE id = @familyId AND workspace_id = @workspaceId`, {
                familyId: payload.familyId,
                workspaceId: payload.workspaceId,
                title,
                sectionId,
                categoryId,
                retiredAtUtc: retiredAt
            });
            return {
                ...existing,
                title,
                sectionId,
                categoryId,
                retiredAtUtc: retiredAt ?? undefined
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async deleteArticleFamily(workspaceId, familyId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            workspaceDb.run(`DELETE FROM revisions
         WHERE locale_variant_id IN (SELECT id FROM locale_variants WHERE family_id = @familyId)`, { familyId });
            workspaceDb.run(`DELETE FROM locale_variants WHERE family_id = @familyId`, { familyId });
            const removed = workspaceDb.run(`DELETE FROM article_families WHERE id = @familyId AND workspace_id = @workspaceId`, { familyId, workspaceId });
            if (removed.changes === 0) {
                throw new Error('Article family not found');
            }
        }
        finally {
            workspaceDb.close();
        }
    }
    async listLocaleVariants(workspaceId) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            return workspaceDb.all(`SELECT lv.id, lv.family_id as familyId, lv.locale, lv.status, lv.retired_at as retiredAtUtc
         FROM locale_variants lv
         JOIN article_families af ON af.id = lv.family_id
         WHERE af.workspace_id = @workspaceId
         ORDER BY lv.locale`, { workspaceId });
        }
        finally {
            workspaceDb.close();
        }
    }
    async getLocaleVariantsForFamily(workspaceId, familyId) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            return workspaceDb.all(`SELECT lv.id, lv.family_id as familyId, lv.locale, lv.status, lv.retired_at as retiredAtUtc
         FROM locale_variants lv
         WHERE lv.family_id = @familyId AND lv.family_id IN (SELECT id FROM article_families WHERE workspace_id = @workspaceId)
         ORDER BY lv.locale`, { familyId, workspaceId });
        }
        finally {
            workspaceDb.close();
        }
    }
    async listTemplatePacks(workspaceId) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            return workspaceDb.all(`SELECT id, workspace_id as workspaceId, name, language, prompt_template as promptTemplate,
                tone_rules as toneRules, examples, active, updated_at as updatedAtUtc
         FROM template_packs
         ORDER BY updated_at DESC`, { workspaceId });
        }
        finally {
            workspaceDb.close();
        }
    }
    async getTemplatePack(workspaceId, templatePackId) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const row = workspaceDb.get(`SELECT id, workspace_id as workspaceId, name, language, prompt_template as promptTemplate,
                tone_rules as toneRules, examples, active, updated_at as updatedAtUtc
         FROM template_packs
         WHERE id = @templatePackId AND workspace_id = @workspaceId`, { templatePackId, workspaceId });
            return row ?? null;
        }
        finally {
            workspaceDb.close();
        }
    }
    async getTemplatePackByLocale(workspaceId, locale) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const row = workspaceDb.get(`SELECT id, workspace_id as workspaceId, name, language, prompt_template as promptTemplate,
                tone_rules as toneRules, examples, active, updated_at as updatedAtUtc
         FROM template_packs
         WHERE workspace_id = @workspaceId AND language = @locale
         ORDER BY updated_at DESC LIMIT 1`, { locale, workspaceId });
            return row ?? null;
        }
        finally {
            workspaceDb.close();
        }
    }
    async getLocaleVariant(workspaceId, variantId) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const variant = workspaceDb.get(`SELECT id, family_id as familyId, locale, status, retired_at as retiredAtUtc
         FROM locale_variants
         WHERE id = @variantId AND family_id IN (SELECT id FROM article_families WHERE workspace_id = @workspaceId)`, { variantId, workspaceId });
            if (!variant) {
                throw new Error('Locale variant not found');
            }
            return variant;
        }
        finally {
            workspaceDb.close();
        }
    }
    async createLocaleVariant(payload) {
        const workspace = await this.getWorkspace(payload.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const family = workspaceDb.get(`SELECT id FROM article_families WHERE id = @familyId`, { familyId: payload.familyId });
            if (!family) {
                throw new Error('Article family not found');
            }
            const locale = payload.locale.trim();
            if (!locale) {
                throw new Error('Locale is required');
            }
            const duplicate = workspaceDb.get(`SELECT id FROM locale_variants WHERE family_id = @familyId AND locale = @locale`, { familyId: payload.familyId, locale });
            if (duplicate) {
                throw new Error('Locale variant already exists');
            }
            const status = payload.status ?? shared_types_1.RevisionState.LIVE;
            const id = (0, node_crypto_1.randomUUID)();
            workspaceDb.run(`INSERT INTO locale_variants (id, family_id, locale, status, retired_at)
         VALUES (@id, @familyId, @locale, @status, @retiredAtUtc)`, {
                id,
                familyId: payload.familyId,
                locale,
                status,
                retiredAtUtc: payload.retiredAtUtc ?? null
            });
            return {
                id,
                familyId: payload.familyId,
                locale,
                status,
                retiredAtUtc: payload.retiredAtUtc
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async updateLocaleVariant(payload) {
        const workspace = await this.getWorkspace(payload.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const existing = workspaceDb.get(`SELECT id, family_id as familyId, locale, status, retired_at as retiredAtUtc
         FROM locale_variants
         WHERE id = @variantId AND family_id IN (SELECT id FROM article_families WHERE workspace_id = @workspaceId)`, { variantId: payload.variantId, workspaceId: payload.workspaceId });
            if (!existing) {
                throw new Error('Locale variant not found');
            }
            if (payload.locale === undefined &&
                payload.status === undefined &&
                payload.retiredAtUtc === undefined) {
                throw new Error('Locale variant update requires at least one field');
            }
            const locale = payload.locale !== undefined ? payload.locale.trim() : existing.locale;
            if (!locale) {
                throw new Error('Locale is required');
            }
            if (payload.locale !== undefined) {
                const duplicate = workspaceDb.get(`SELECT id FROM locale_variants WHERE family_id = @familyId AND locale = @locale AND id != @variantId`, { familyId: existing.familyId, locale, variantId: payload.variantId });
                if (duplicate) {
                    throw new Error('Locale variant already exists');
                }
            }
            const status = payload.status ?? existing.status;
            const retiredAt = payload.retiredAtUtc === null ? null : (payload.retiredAtUtc ?? existing.retiredAtUtc ?? null);
            workspaceDb.run(`UPDATE locale_variants
         SET locale = @locale,
             status = @status,
             retired_at = @retiredAtUtc
         WHERE id = @variantId`, {
                variantId: payload.variantId,
                locale,
                status,
                retiredAtUtc: retiredAt
            });
            return {
                id: existing.id,
                familyId: existing.familyId,
                locale,
                status,
                retiredAtUtc: retiredAt ?? undefined
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async deleteLocaleVariant(workspaceId, variantId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            workspaceDb.run(`DELETE FROM revisions WHERE locale_variant_id = @variantId`, { variantId });
            const removed = workspaceDb.run(`DELETE FROM locale_variants
         WHERE id = @variantId
           AND family_id IN (SELECT id FROM article_families WHERE workspace_id = @workspaceId)`, { variantId, workspaceId });
            if (removed.changes === 0) {
                throw new Error('Locale variant not found');
            }
        }
        finally {
            workspaceDb.close();
        }
    }
    async listRevisions(workspaceId, localeVariantId) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            if (localeVariantId) {
                return workspaceDb.all(`SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                  workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                  revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
           FROM revisions
           WHERE workspace_id = @workspaceId AND locale_variant_id = @localeVariantId
           ORDER BY revision_number DESC`, { workspaceId, localeVariantId });
            }
            return workspaceDb.all(`SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
         FROM revisions
         WHERE workspace_id = @workspaceId
         ORDER BY revision_number DESC`, { workspaceId });
        }
        finally {
            workspaceDb.close();
        }
    }
    async listLocaleVariantsByLocale(workspaceId, locale) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            return workspaceDb.all(`SELECT lv.id, lv.family_id as familyId, lv.locale, lv.status, lv.retired_at as retiredAtUtc
         FROM locale_variants lv
         JOIN article_families af ON af.id = lv.family_id
         WHERE af.workspace_id = @workspaceId AND lv.locale = @locale`, { workspaceId, locale });
        }
        finally {
            workspaceDb.close();
        }
    }
    async reconcileSyncedLocaleVariants(workspaceId, locale, remoteFamilyExternalKeys) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const now = new Date().toISOString();
            const retainedStatus = shared_types_1.RevisionState.LIVE;
            const retiredStatus = shared_types_1.RevisionState.RETIRED;
            const retiredAtUtc = now;
            if (!remoteFamilyExternalKeys.length) {
                workspaceDb.run(`UPDATE locale_variants
           SET status = @retiredStatus,
               retired_at = @retiredAtUtc
           WHERE id IN (
             SELECT lv.id
             FROM locale_variants lv
             JOIN article_families af ON af.id = lv.family_id
             WHERE af.workspace_id = @workspaceId AND lv.locale = @locale AND lv.status != @retiredStatus
           )`, { workspaceId, locale, retiredStatus, retiredAtUtc });
                workspaceDb.run(`UPDATE draft_branches
           SET state = 'obsolete', updated_at = @retiredAtUtc
           WHERE workspace_id = @workspaceId
             AND state != 'obsolete'
             AND locale_variant_id IN (
               SELECT lv.id
               FROM locale_variants lv
               JOIN article_families af ON af.id = lv.family_id
               WHERE af.workspace_id = @workspaceId AND lv.locale = @locale
             )`, { workspaceId, locale, retiredAtUtc });
                return;
            }
            const keys = Array.from(new Set(remoteFamilyExternalKeys.filter(Boolean)));
            const placeholders = keys.map((_, idx) => `@remoteKey${idx}`).join(',');
            const queryParams = {
                workspaceId,
                locale,
                retainedStatus,
                retiredStatus,
                retiredAtUtc
            };
            keys.forEach((key, index) => {
                queryParams[`remoteKey${index}`] = key;
            });
            workspaceDb.run(`UPDATE locale_variants
         SET status = @retainedStatus,
             retired_at = NULL
         WHERE id IN (
           SELECT lv.id
           FROM locale_variants lv
           JOIN article_families af ON af.id = lv.family_id
           WHERE af.workspace_id = @workspaceId
             AND lv.locale = @locale
             AND af.external_key IN (${placeholders})
         )`, queryParams);
            workspaceDb.run(`UPDATE locale_variants
         SET status = @retiredStatus,
             retired_at = @retiredAtUtc
         WHERE id IN (
           SELECT lv.id
           FROM locale_variants lv
           JOIN article_families af ON af.id = lv.family_id
           WHERE af.workspace_id = @workspaceId
             AND lv.locale = @locale
             AND af.external_key NOT IN (${placeholders})
         )`, queryParams);
            workspaceDb.run(`UPDATE draft_branches
         SET state = 'obsolete', updated_at = @retiredAtUtc
         WHERE workspace_id = @workspaceId
           AND state != 'obsolete'
           AND locale_variant_id IN (
             SELECT lv.id
             FROM locale_variants lv
             JOIN article_families af ON af.id = lv.family_id
             WHERE af.workspace_id = @workspaceId
               AND lv.locale = @locale
               AND af.external_key NOT IN (${placeholders})
           )`, queryParams);
        }
        finally {
            workspaceDb.close();
        }
    }
    async getRevision(workspaceId, revisionId) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const revision = workspaceDb.get(`SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
         FROM revisions
         WHERE id = @revisionId AND workspace_id = @workspaceId`, { revisionId, workspaceId });
            if (!revision) {
                throw new Error('Revision not found');
            }
            return revision;
        }
        finally {
            workspaceDb.close();
        }
    }
    async createRevision(payload) {
        const workspace = await this.getWorkspace(payload.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const variant = workspaceDb.get(`SELECT id FROM locale_variants WHERE id = @variantId`, { variantId: payload.localeVariantId });
            if (!variant) {
                throw new Error('Locale variant not found');
            }
            const filePath = payload.filePath?.trim();
            if (!filePath) {
                throw new Error('filePath is required');
            }
            const revisionNumber = Number.isFinite(payload.revisionNumber) ? payload.revisionNumber : 0;
            if (!Number.isInteger(revisionNumber)) {
                throw new Error('revisionNumber must be an integer');
            }
            if (revisionNumber < 0) {
                throw new Error('revisionNumber must be non-negative');
            }
            const existingLatest = workspaceDb.get(`SELECT COALESCE(MAX(revision_number), 0) AS maxRevision FROM revisions WHERE locale_variant_id = @variantId`, { variantId: payload.localeVariantId });
            if (payload.revisionNumber < (existingLatest?.maxRevision ?? 0)) {
                throw new Error('revisionNumber must not regress');
            }
            const now = new Date().toISOString();
            const id = (0, node_crypto_1.randomUUID)();
            workspaceDb.run(`INSERT INTO revisions (
          id, locale_variant_id, revision_type, branch_id, workspace_id, file_path, content_hash, source_revision_id, revision_number, status, created_at, updated_at
        ) VALUES (@id, @localeVariantId, @revisionType, @branchId, @workspaceId, @filePath, @contentHash, @sourceRevisionId, @revisionNumber, @status, @createdAt, @updatedAt)`, {
                id,
                localeVariantId: payload.localeVariantId,
                revisionType: payload.revisionType,
                branchId: payload.branchId ?? null,
                workspaceId: payload.workspaceId,
                filePath,
                contentHash: payload.contentHash ?? null,
                sourceRevisionId: payload.sourceRevisionId ?? null,
                revisionNumber,
                status: payload.status,
                createdAt: payload.createdAtUtc ?? now,
                updatedAt: payload.updatedAtUtc ?? now
            });
            return {
                id,
                localeVariantId: payload.localeVariantId,
                revisionType: payload.revisionType,
                branchId: payload.branchId,
                workspaceId: payload.workspaceId,
                filePath,
                contentHash: payload.contentHash,
                sourceRevisionId: payload.sourceRevisionId,
                revisionNumber,
                status: payload.status,
                createdAtUtc: payload.createdAtUtc ?? now,
                updatedAtUtc: payload.updatedAtUtc ?? now
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async updateRevision(payload) {
        const workspace = await this.getWorkspace(payload.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const existing = workspaceDb.get(`SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
         FROM revisions
         WHERE id = @revisionId AND workspace_id = @workspaceId`, { revisionId: payload.revisionId, workspaceId: payload.workspaceId });
            if (!existing) {
                throw new Error('Revision not found');
            }
            const revisionType = payload.revisionType ?? existing.revisionType;
            const branchId = payload.branchId ?? existing.branchId;
            const filePath = payload.filePath ?? existing.filePath;
            const contentHash = payload.contentHash ?? existing.contentHash;
            const sourceRevisionId = payload.sourceRevisionId ?? existing.sourceRevisionId;
            const revisionNumber = payload.revisionNumber ?? existing.revisionNumber;
            if (!Number.isInteger(revisionNumber)) {
                throw new Error('revisionNumber must be an integer');
            }
            const status = payload.status ?? existing.status;
            const now = payload.updatedAtUtc ?? new Date().toISOString();
            if (!filePath?.trim()) {
                throw new Error('filePath is required');
            }
            if (revisionNumber < existing.revisionNumber) {
                throw new Error('revisionNumber must not regress');
            }
            workspaceDb.run(`UPDATE revisions
         SET revision_type = @revisionType,
             branch_id = @branchId,
             file_path = @filePath,
             content_hash = @contentHash,
             source_revision_id = @sourceRevisionId,
             revision_number = @revisionNumber,
             status = @status,
             updated_at = @updatedAt
         WHERE id = @revisionId AND workspace_id = @workspaceId`, {
                revisionId: payload.revisionId,
                workspaceId: payload.workspaceId,
                revisionType,
                branchId,
                filePath,
                contentHash: contentHash ?? null,
                sourceRevisionId: sourceRevisionId ?? null,
                revisionNumber,
                status,
                updatedAt: now
            });
            return {
                ...existing,
                revisionType,
                branchId,
                filePath,
                contentHash,
                sourceRevisionId,
                revisionNumber,
                status,
                updatedAtUtc: now
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async deleteRevision(workspaceId, revisionId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const removed = workspaceDb.run(`DELETE FROM revisions WHERE id = @revisionId AND workspace_id = @workspaceId`, {
                revisionId,
                workspaceId
            });
            if (removed.changes === 0) {
                throw new Error('Revision not found');
            }
        }
        finally {
            workspaceDb.close();
        }
    }
    async getExplorerTree(workspaceId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const families = workspaceDb.all(`SELECT * FROM article_families ORDER BY title`);
            const variants = workspaceDb.all(`SELECT id, family_id as familyId, locale, status FROM locale_variants`);
            const revisions = workspaceDb.all(`
        SELECT
          id,
          locale_variant_id as localeVariantId,
          revision_number as revisionNumber,
          revision_type as revisionType,
          file_path as filePath,
          updated_at as updatedAtUtc
        FROM revisions
      `);
            const branches = workspaceDb.all(`SELECT locale_variant_id, COUNT(*) AS total FROM draft_branches GROUP BY locale_variant_id`);
            const syncCheckpoints = workspaceDb.all(`SELECT locale, last_synced_at as lastSyncedAtUtc, updated_at as updatedAtUtc
         FROM zendesk_sync_checkpoints
         WHERE workspace_id = @workspaceId`, { workspaceId });
            const branchCounts = new Map(branches.map((row) => [row.locale_variant_id, row.total]));
            const syncTimestampByLocale = new Map(syncCheckpoints.map((checkpoint) => [
                checkpoint.locale,
                checkpoint.lastSyncedAtUtc ?? checkpoint.updatedAtUtc
            ]));
            const latestByVariant = getLatestRevisions(revisions);
            return families.map((family) => {
                const locales = variants
                    .filter((variant) => variant.familyId === family.id)
                    .map((variant) => {
                    const latest = latestByVariant.get(variant.id);
                    const syncUpdatedAtUtc = syncTimestampByLocale.get(variant.locale);
                    const explorerUpdatedAtUtc = latestTimestamp(syncUpdatedAtUtc, latest?.updatedAtUtc) ?? new Date().toISOString();
                    return {
                        locale: variant.locale,
                        localeVariantId: variant.id,
                        revision: {
                            revisionId: latest?.revisionId ?? '',
                            revisionNumber: latest?.revisionNumber ?? 0,
                            state: latest?.revisionType ?? variant.status ?? shared_types_1.RevisionState.LIVE,
                            updatedAtUtc: explorerUpdatedAtUtc,
                            draftCount: branchCounts.get(variant.id) ?? 0
                        },
                        hasConflicts: variant.status === shared_types_1.RevisionState.OBSOLETE
                    };
                });
                return {
                    familyId: family.id,
                    title: family.title,
                    familyStatus: locales.some((node) => node.revision.state === shared_types_1.RevisionState.OBSOLETE)
                        ? shared_types_1.RevisionState.OBSOLETE
                        : (family.retired_at
                            ? shared_types_1.RevisionState.RETIRED
                            : shared_types_1.RevisionState.LIVE),
                    locales
                };
            });
        }
        finally {
            workspaceDb.close();
        }
    }
    async searchArticles(workspaceId, payload) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const query = payload.query.trim().toLowerCase();
        if (!query) {
            return { workspaceId, total: 0, results: [] };
        }
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const scope = normalizeSearchScope(payload.scope);
            const includeArchived = Boolean(payload.includeArchived);
            const familyQueryParams = {
                q: query,
                includeArchived: includeArchived ? 1 : 0
            };
            const families = workspaceDb.all(includeArchived
                ? `SELECT id, title, external_key, section_id, category_id, retired_at
             FROM article_families
             WHERE lower(title) LIKE '%' || @q || '%' OR lower(external_key) LIKE '%' || @q || '%'`
                : `SELECT id, title, external_key, section_id, category_id, retired_at
             FROM article_families
             WHERE retired_at IS NULL
               AND (lower(title) LIKE '%' || @q || '%' OR lower(external_key) LIKE '%' || @q || '%')`, familyQueryParams);
            const variants = workspaceDb.all(`SELECT id, family_id as familyId, locale FROM locale_variants`);
            const revisions = workspaceDb.all(`SELECT id, locale_variant_id, revision_number, revision_type, file_path, updated_at FROM revisions`);
            const revisionByVariant = getLatestRevisions(revisions.map((revision) => ({
                id: revision.id,
                localeVariantId: revision.locale_variant_id,
                revisionNumber: revision.revision_number,
                revisionType: revision.revision_type,
                updatedAtUtc: revision.updated_at,
                filePath: revision.file_path
            })));
            const localeVariantToDraftCount = new Map();
            const draftCounts = workspaceDb.all(`SELECT locale_variant_id, COUNT(*) AS total
         FROM draft_branches
         GROUP BY locale_variant_id`);
            draftCounts.forEach((row) => localeVariantToDraftCount.set(row.locale_variant_id, row.total));
            const variantRows = workspaceDb.all(`SELECT id, status, retired_at FROM locale_variants`);
            const localeVariantStatus = new Map();
            for (const row of variantRows) {
                localeVariantStatus.set(row.id, {
                    status: row.status,
                    hasConflicts: row.status === shared_types_1.RevisionState.OBSOLETE,
                    retiredAt: row.retired_at ?? undefined
                });
            }
            const variantFamilyMap = new Map(variants.map((variant) => [variant.id, { familyId: variant.familyId, locale: variant.locale }]));
            const results = [];
            for (const family of families) {
                const familyVariants = variants.filter((variant) => variant.familyId === family.id);
                for (const variant of familyVariants) {
                    if (payload.locales?.length && !payload.locales.includes(variant.locale)) {
                        continue;
                    }
                    const statusState = localeVariantStatus.get(variant.id);
                    const revision = revisionByVariant.get(variant.id);
                    if (!statusState || !revision) {
                        continue;
                    }
                    if (scope === 'retired' && !family.retired_at) {
                        continue;
                    }
                    if (scope === 'live' && family.retired_at) {
                        continue;
                    }
                    if (!passSearchScope(statusState, scope, variantToDraftCount(localeVariantToDraftCount, variant.id), payload.hasDrafts, payload.includeConflicts, payload.changedWithinHours, revision.updatedAtUtc)) {
                        continue;
                    }
                    const hasRevisionFile = await this.fileExists(resolveRevisionPath(workspace.path, revision.filePath));
                    let matchSource = { context: 'title', snippet: family.title, scoreBoost: 1.5 };
                    if (hasRevisionFile) {
                        const sourceHtml = await this.readRevisionSource(resolveRevisionPath(workspace.path, revision.filePath));
                        const match = findTextMatch(sourceHtml, query);
                        if (!match && family.external_key.toLowerCase().includes(query)) {
                            matchSource = {
                                context: 'metadata',
                                snippet: `external_key: ${family.external_key}`,
                                scoreBoost: 0.9
                            };
                        }
                        if (match) {
                            matchSource = match;
                        }
                    }
                    else if (!family.title.toLowerCase().includes(query)) {
                        continue;
                    }
                    if (!revision) {
                        continue;
                    }
                    const familyStatus = family.retired_at ? shared_types_1.RevisionState.RETIRED : (statusState?.status ?? shared_types_1.RevisionState.LIVE);
                    results.push({
                        revisionId: revision.revisionId,
                        familyId: family.id,
                        localeVariantId: variant.id,
                        locale: variant.locale,
                        title: family.title,
                        familyExternalKey: family.external_key,
                        snippet: buildSearchSnippet(matchSource.snippet),
                        matchContext: matchSource.context,
                        score: Number((matchSource.scoreBoost / Math.max(1, (payload.query.length / 3))).toFixed(3))
                    });
                }
            }
            results.sort((a, b) => b.score - a.score);
            return { workspaceId, total: results.length, results };
        }
        finally {
            workspaceDb.close();
        }
    }
    async createPBIBatch(workspaceId, batchName, sourceFileName, sourcePath, sourceFormat, sourceRowCount, counts, scopeMode = shared_types_1.PBIBatchScopeMode.ALL, scopePayload, status = shared_types_1.PBIBatchStatus.IMPORTED) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const now = new Date().toISOString();
            const id = (0, node_crypto_1.randomUUID)();
            workspaceDb.run(`INSERT INTO pbi_batches (
          id, workspace_id, name, source_file_name, source_row_count, imported_at, status,
          source_path, source_format, candidate_row_count, ignored_row_count, malformed_row_count,
          duplicate_row_count, scoped_row_count, scope_mode, scope_payload
        ) VALUES (
          @id, @workspaceId, @name, @sourceFileName, @sourceRowCount, @importedAt, @status,
          @sourcePath, @sourceFormat, @candidateRowCount, @ignoredRowCount, @malformedRowCount,
          @duplicateRowCount, @scopedRowCount, @scopeMode, @scopePayload
        )`, {
                id,
                workspaceId,
                name: batchName,
                sourceFileName,
                sourceRowCount,
                importedAt: now,
                status,
                sourcePath,
                sourceFormat,
                candidateRowCount: counts.candidateRowCount,
                ignoredRowCount: counts.ignoredRowCount,
                malformedRowCount: counts.malformedRowCount,
                duplicateRowCount: counts.duplicateRowCount,
                scopedRowCount: counts.scopedRowCount,
                scopeMode,
                scopePayload: scopePayload ?? null
            });
            return {
                id,
                workspaceId,
                name: batchName,
                sourceFileName,
                sourceRowCount,
                sourcePath,
                sourceFormat,
                candidateRowCount: counts.candidateRowCount,
                ignoredRowCount: counts.ignoredRowCount,
                malformedRowCount: counts.malformedRowCount,
                duplicateRowCount: counts.duplicateRowCount,
                scopedRowCount: counts.scopedRowCount,
                scopeMode,
                scopePayload,
                importedAtUtc: now,
                status
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async findDuplicatePBIBatch(workspaceId, sourceFileName, sourceRowCount, counts) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const duplicate = await workspaceDb.get(`
        SELECT id, workspace_id as workspaceId, name, source_file_name as sourceFileName,
               source_row_count as sourceRowCount, source_path as sourcePath, source_format as sourceFormat,
               candidate_row_count as candidateRowCount, ignored_row_count as ignoredRowCount,
               malformed_row_count as malformedRowCount, duplicate_row_count as duplicateRowCount,
               scoped_row_count as scopedRowCount, scope_mode as scopeMode, scope_payload as scopePayload,
               imported_at as importedAtUtc, status
        FROM pbi_batches
        WHERE workspace_id = @workspaceId
          AND source_file_name = @sourceFileName
          AND source_row_count = @sourceRowCount
          AND candidate_row_count = @candidateRowCount
          AND malformed_row_count = @malformedRowCount
          AND duplicate_row_count = @duplicateRowCount
          AND ignored_row_count = @ignoredRowCount
          AND status IN (@importedStatus, @scopedStatus, @submittedStatus, @analyzedStatus, @reviewInProgressStatus, @reviewCompleteStatus, @archivedStatus)
          AND imported_at >= datetime('now', '-2 minutes')
        ORDER BY imported_at DESC
        LIMIT 1
      `, {
                workspaceId,
                sourceFileName,
                sourceRowCount,
                candidateRowCount: counts.candidateRowCount,
                malformedRowCount: counts.malformedRowCount,
                duplicateRowCount: counts.duplicateRowCount,
                ignoredRowCount: counts.ignoredRowCount,
                importedStatus: shared_types_1.PBIBatchStatus.IMPORTED,
                scopedStatus: shared_types_1.PBIBatchStatus.SCOPED,
                submittedStatus: shared_types_1.PBIBatchStatus.SUBMITTED,
                analyzedStatus: shared_types_1.PBIBatchStatus.ANALYZED,
                reviewInProgressStatus: shared_types_1.PBIBatchStatus.REVIEW_IN_PROGRESS,
                reviewCompleteStatus: shared_types_1.PBIBatchStatus.REVIEW_COMPLETE,
                archivedStatus: shared_types_1.PBIBatchStatus.ARCHIVED
            });
            return duplicate ?? null;
        }
        finally {
            workspaceDb.close();
        }
    }
    async deletePBIBatch(workspaceId, batchId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const batchExists = workspaceDb.get(`SELECT id FROM pbi_batches WHERE id = @batchId AND workspace_id = @workspaceId`, { batchId, workspaceId });
            if (!batchExists) {
                throw new Error('PBI batch not found');
            }
            workspaceDb.exec('BEGIN IMMEDIATE');
            try {
                workspaceDb.run(`DELETE FROM proposal_pbi_links
            WHERE proposal_id IN (SELECT id FROM proposals WHERE batch_id = @batchId)`, { batchId });
                workspaceDb.run(`DELETE FROM proposals WHERE batch_id = @batchId`, { batchId });
                workspaceDb.run(`DELETE FROM ai_runs WHERE batch_id = @batchId`, { batchId });
                workspaceDb.run(`DELETE FROM pbi_records WHERE batch_id = @batchId`, { batchId });
                workspaceDb.run(`DELETE FROM pbi_batches WHERE id = @batchId AND workspace_id = @workspaceId`, { batchId, workspaceId });
                workspaceDb.exec('COMMIT');
            }
            catch (error) {
                workspaceDb.exec('ROLLBACK');
                throw error;
            }
        }
        finally {
            workspaceDb.close();
        }
    }
    async insertPBIRecords(workspaceId, batchId, records) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const insert = workspaceDb.prepare(`
        INSERT INTO pbi_records (
          id, batch_id, source_row_number, external_id, title, description, priority,
          state, work_item_type, title1, title2, title3, raw_description, raw_acceptance_criteria,
          description_text, acceptance_criteria_text, parent_external_id, parent_record_id,
          validation_status, validation_reason
        ) VALUES (
          @id, @batchId, @sourceRowNumber, @externalId, @title, @description, @priority,
          @state, @workItemType, @title1, @title2, @title3, @rawDescription, @rawAcceptanceCriteria,
          @descriptionText, @acceptanceCriteriaText, @parentExternalId, @parentRecordId,
          @validationStatus, @validationReason
        )
      `);
            const insertedAt = new Date().toISOString();
            const values = records.map((record) => ({
                id: (0, node_crypto_1.randomUUID)(),
                batchId,
                sourceRowNumber: record.sourceRowNumber,
                externalId: record.externalId,
                title: record.title,
                description: record.description ?? null,
                priority: record.priority ?? null,
                state: record.state ?? null,
                workItemType: record.workItemType ?? null,
                title1: record.title1 ?? null,
                title2: record.title2 ?? null,
                title3: record.title3 ?? null,
                rawDescription: record.rawDescription ?? null,
                rawAcceptanceCriteria: record.rawAcceptanceCriteria ?? null,
                descriptionText: record.descriptionText ?? null,
                acceptanceCriteriaText: record.acceptanceCriteriaText ?? null,
                parentExternalId: record.parentExternalId ?? null,
                parentRecordId: record.parentRecordId ?? null,
                validationStatus: record.validationStatus ?? shared_types_1.PBIValidationStatus.CANDIDATE,
                validationReason: record.validationReason ?? null,
                insertedAt,
            }));
            workspaceDb.exec('BEGIN IMMEDIATE');
            try {
                for (const value of values) {
                    insert.run(value);
                }
                workspaceDb.exec('COMMIT');
            }
            catch (error) {
                workspaceDb.exec('ROLLBACK');
                throw error;
            }
        }
        finally {
            workspaceDb.close();
        }
    }
    async listPBIBatches(workspaceId) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            return workspaceDb.all(`
        SELECT id, workspace_id as workspaceId, name, source_file_name as sourceFileName,
               source_row_count as sourceRowCount, source_path as sourcePath, source_format as sourceFormat,
               candidate_row_count as candidateRowCount, ignored_row_count as ignoredRowCount,
               malformed_row_count as malformedRowCount, duplicate_row_count as duplicateRowCount,
               scoped_row_count as scopedRowCount, scope_mode as scopeMode, scope_payload as scopePayload,
               imported_at as importedAtUtc, status
        FROM pbi_batches
        WHERE workspace_id = @workspaceId
        ORDER BY imported_at DESC
      `, { workspaceId });
        }
        finally {
            workspaceDb.close();
        }
    }
    async getPBIBatch(workspaceId, batchId) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const batch = workspaceDb.get(`
        SELECT id, workspace_id as workspaceId, name, source_file_name as sourceFileName,
               source_row_count as sourceRowCount, source_path as sourcePath, source_format as sourceFormat,
               candidate_row_count as candidateRowCount, ignored_row_count as ignoredRowCount,
               malformed_row_count as malformedRowCount, duplicate_row_count as duplicateRowCount,
               scoped_row_count as scopedRowCount, scope_mode as scopeMode, scope_payload as scopePayload,
               imported_at as importedAtUtc, status
        FROM pbi_batches
        WHERE id = @batchId AND workspace_id = @workspaceId`, { batchId, workspaceId });
            if (!batch) {
                throw new Error('PBI batch not found');
            }
            return batch;
        }
        finally {
            workspaceDb.close();
        }
    }
    async getPBIRecords(workspaceId, batchId, validationStatuses) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const conditions = ['batch_id = @batchId'];
            const queryParams = { workspaceId, batchId };
            if (validationStatuses?.length) {
                const placeholders = validationStatuses.map((status, index) => `@validationStatus${index}`).join(', ');
                validationStatuses.forEach((status, index) => {
                    queryParams[`validationStatus${index}`] = status;
                });
                conditions.push(`validation_status IN (${placeholders})`);
            }
            const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
            return workspaceDb.all(`
        SELECT id, batch_id as batchId, source_row_number as sourceRowNumber, external_id as externalId, title, description, priority,
               state, work_item_type as workItemType, title1, title2, title3, raw_description as rawDescription,
               raw_acceptance_criteria as rawAcceptanceCriteria, description_text as descriptionText,
               acceptance_criteria_text as acceptanceCriteriaText, parent_external_id as parentExternalId,
               parent_record_id as parentRecordId, validation_status as validationStatus, validation_reason as validationReason
        FROM pbi_records
        ${whereClause}
        ORDER BY source_row_number ASC`, queryParams);
        }
        finally {
            workspaceDb.close();
        }
    }
    async getPBIRecord(workspaceId, pbiId) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const row = workspaceDb.get(`SELECT id, batch_id as batchId, source_row_number as sourceRowNumber, external_id as externalId, title,
                description, state, priority, work_item_type as workItemType, title1, title2, title3,
                raw_description as rawDescription, raw_acceptance_criteria as rawAcceptanceCriteria,
                description_text as descriptionText, acceptance_criteria_text as acceptanceCriteriaText,
                parent_external_id as parentExternalId, parent_record_id as parentRecordId,
                validation_status as validationStatus, validation_reason as validationReason
         FROM pbi_records
         WHERE id = @pbiId AND batch_id IN (SELECT id FROM pbi_batches WHERE workspace_id = @workspaceId)`, { pbiId, workspaceId });
            return row ?? null;
        }
        finally {
            workspaceDb.close();
        }
    }
    async getPBISubset(workspaceId, batchId, sourceRowNumbers) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            if (!sourceRowNumbers?.length) {
                return workspaceDb.all(`SELECT id, batch_id as batchId, source_row_number as sourceRowNumber, external_id as externalId, title,
                  description, state, priority, work_item_type as workItemType, title1, title2, title3,
                  raw_description as rawDescription, raw_acceptance_criteria as rawAcceptanceCriteria,
                  description_text as descriptionText, acceptance_criteria_text as acceptanceCriteriaText,
                  parent_external_id as parentExternalId, parent_record_id as parentRecordId,
                  validation_status as validationStatus, validation_reason as validationReason
           FROM pbi_records
           WHERE batch_id = @batchId`, { workspaceId, batchId });
            }
            const uniqueRows = Array.from(new Set(sourceRowNumbers.filter(Number.isInteger)));
            const placeholders = uniqueRows.map((_, idx) => `@row${idx}`).join(',');
            const params = uniqueRows.reduce((acc, row, idx) => {
                acc[`row${idx}`] = row;
                return acc;
            }, { workspaceId, batchId });
            return workspaceDb.all(`SELECT id, batch_id as batchId, source_row_number as sourceRowNumber, external_id as externalId, title,
                description, state, priority, work_item_type as workItemType, title1, title2, title3,
                raw_description as rawDescription, raw_acceptance_criteria as rawAcceptanceCriteria,
                description_text as descriptionText, acceptance_criteria_text as acceptanceCriteriaText,
                parent_external_id as parentExternalId, parent_record_id as parentRecordId,
                validation_status as validationStatus, validation_reason as validationReason
         FROM pbi_records
         WHERE batch_id = @batchId AND source_row_number IN (${placeholders})`, params);
        }
        finally {
            workspaceDb.close();
        }
    }
    async recordBatchAnalysisRun(params) {
        const workspace = await this.getWorkspace(params.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const id = (0, node_crypto_1.randomUUID)();
            workspaceDb.run(`INSERT INTO ai_runs (
          id, workspace_id, batch_id, status, started_at, ended_at, prompt_template, transcript_path,
          session_id, kb_access_mode, tool_calls_json, raw_output_json, message
        ) VALUES (
          @id, @workspaceId, @batchId, @status, @startedAt, @endedAt, @promptTemplate, @transcriptPath,
          @sessionId, @kbAccessMode, @toolCallsJson, @rawOutputJson, @message
        )`, {
                id,
                workspaceId: params.workspaceId,
                batchId: params.batchId,
                status: params.status,
                startedAt: params.startedAtUtc,
                endedAt: params.endedAtUtc ?? null,
                promptTemplate: params.promptTemplate ?? null,
                transcriptPath: params.transcriptPath ?? null,
                sessionId: params.sessionId ?? null,
                kbAccessMode: params.kbAccessMode ?? 'mcp',
                toolCallsJson: JSON.stringify(params.toolCalls ?? []),
                rawOutputJson: params.rawOutput ? JSON.stringify(params.rawOutput) : null,
                message: params.message ?? null
            });
            return {
                id,
                workspaceId: params.workspaceId,
                batchId: params.batchId,
                sessionId: params.sessionId,
                kbAccessMode: params.kbAccessMode ?? 'mcp',
                status: params.status,
                startedAtUtc: params.startedAtUtc,
                endedAtUtc: params.endedAtUtc,
                promptTemplate: params.promptTemplate,
                transcriptPath: params.transcriptPath,
                toolCalls: params.toolCalls ?? [],
                rawOutput: params.rawOutput,
                message: params.message
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getLatestBatchAnalysisRun(workspaceId, batchId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const row = workspaceDb.get(`SELECT id,
                workspace_id as workspaceId,
                batch_id as batchId,
                session_id as sessionId,
                kb_access_mode as kbAccessMode,
                status,
                started_at as startedAtUtc,
                ended_at as endedAtUtc,
                prompt_template as promptTemplate,
                transcript_path as transcriptPath,
                tool_calls_json as toolCallsJson,
                raw_output_json as rawOutputJson,
                message
           FROM ai_runs
          WHERE workspace_id = @workspaceId AND batch_id = @batchId
          ORDER BY started_at DESC
          LIMIT 1`, { workspaceId, batchId });
            if (!row) {
                return null;
            }
            let toolCalls = [];
            if (row.toolCallsJson) {
                try {
                    const parsed = JSON.parse(row.toolCallsJson);
                    if (Array.isArray(parsed)) {
                        toolCalls = parsed;
                    }
                }
                catch {
                    toolCalls = [];
                }
            }
            let rawOutput = [];
            if (row.rawOutputJson) {
                try {
                    const parsed = JSON.parse(row.rawOutputJson);
                    if (Array.isArray(parsed)) {
                        rawOutput = parsed;
                    }
                }
                catch {
                    rawOutput = [];
                }
            }
            return {
                id: row.id,
                workspaceId: row.workspaceId,
                batchId: row.batchId,
                sessionId: row.sessionId ?? undefined,
                kbAccessMode: row.kbAccessMode ?? 'mcp',
                status: row.status,
                startedAtUtc: row.startedAtUtc,
                endedAtUtc: row.endedAtUtc ?? undefined,
                promptTemplate: row.promptTemplate ?? undefined,
                transcriptPath: row.transcriptPath ?? undefined,
                toolCalls,
                rawOutput,
                message: row.message ?? undefined
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async createAgentProposal(params) {
        const workspace = await this.getWorkspace(params.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const proposalId = (0, node_crypto_1.randomUUID)();
            const now = new Date().toISOString();
            const rationale = params.rationale ?? params.note ?? (params.metadata ? JSON.stringify(params.metadata) : undefined);
            const status = shared_types_1.ProposalDecision.DEFER;
            workspaceDb.run(`INSERT INTO proposals (
          id, workspace_id, batch_id, action, locale_variant_id, branch_id, status, rationale, generated_at, updated_at
        ) VALUES (
          @id, @workspaceId, @batchId, @action, @localeVariantId, @branchId, @status, @rationale, @generatedAt, @updatedAt
        )`, {
                id: proposalId,
                workspaceId: params.workspaceId,
                batchId: params.batchId,
                action: params.action,
                localeVariantId: params.localeVariantId ?? null,
                branchId: null,
                status,
                rationale,
                generatedAt: now,
                updatedAt: now
            });
            if (params.relatedPbiIds?.length) {
                const uniquePbiIds = Array.from(new Set(params.relatedPbiIds.filter(Boolean)));
                for (const pbiId of uniquePbiIds) {
                    workspaceDb.run(`INSERT OR IGNORE INTO proposal_pbi_links (proposal_id, pbi_id, relation)
             VALUES (@proposalId, @pbiId, @relation)`, {
                        proposalId,
                        pbiId,
                        relation: 'primary'
                    });
                }
            }
            return {
                proposalId,
                workspaceId: params.workspaceId,
                batchId: params.batchId,
                action: params.action,
                localeVariantId: params.localeVariantId,
                status
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getBatchContext(workspaceId, batchId) {
        const batch = await this.getPBIBatch(workspaceId, batchId);
        if (!batch) {
            return null;
        }
        const records = await this.getPBIRecords(workspaceId, batchId);
        return {
            batch,
            candidateRows: records.filter((row) => row.validationStatus === 'candidate'),
            malformedRows: records.filter((row) => row.validationStatus === 'malformed'),
            duplicateRows: records.filter((row) => row.validationStatus === 'duplicate'),
            ignoredRows: records.filter((row) => row.validationStatus === 'ignored')
        };
    }
    async setPBIBatchScope(workspaceId, batchId, scopeMode, selectedSourceRowNumbers = [], selectedExternalIds = []) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const batchExists = workspaceDb.get(`SELECT id FROM pbi_batches WHERE id = @batchId AND workspace_id = @workspaceId`, { batchId, workspaceId });
            if (!batchExists) {
                throw new Error('PBI batch not found');
            }
            const candidateRows = workspaceDb.all(`SELECT source_row_number as sourceRowNumber, external_id as externalId
         FROM pbi_records
         WHERE batch_id = @batchId AND validation_status = @candidateStatus
         ORDER BY source_row_number ASC`, { batchId, candidateStatus: shared_types_1.PBIValidationStatus.CANDIDATE });
            const candidateSet = new Set();
            const selectedByExternal = new Set(selectedExternalIds);
            const selectedRows = new Set(selectedSourceRowNumbers.map((row) => Number(row)));
            const scopedSet = new Set();
            const selectedCandidateRows = [];
            for (const candidate of candidateRows) {
                candidateSet.add(candidate.sourceRowNumber);
                if (selectedByExternal.has(candidate.externalId) || selectedRows.has(candidate.sourceRowNumber)) {
                    selectedCandidateRows.push(candidate.sourceRowNumber);
                }
            }
            if (scopeMode === shared_types_1.PBIBatchScopeMode.SELECTED_ONLY) {
                selectedCandidateRows.forEach((row) => scopedSet.add(row));
            }
            else if (scopeMode === shared_types_1.PBIBatchScopeMode.ALL_EXCEPT_SELECTED) {
                for (const row of candidateSet) {
                    if (!selectedCandidateRows.includes(row)) {
                        scopedSet.add(row);
                    }
                }
            }
            else {
                candidateRows.forEach((candidate) => scopedSet.add(candidate.sourceRowNumber));
            }
            const scopedRows = Array.from(scopedSet).sort((a, b) => a - b);
            const scopedSetLookup = new Set(scopedRows);
            const updateState = workspaceDb.prepare(`
        UPDATE pbi_records
        SET state = @state
        WHERE batch_id = @batchId AND source_row_number = @sourceRowNumber AND validation_status = @candidateStatus
      `);
            workspaceDb.exec('BEGIN IMMEDIATE');
            try {
                for (const candidate of candidateRows) {
                    updateState.run({
                        batchId,
                        sourceRowNumber: candidate.sourceRowNumber,
                        state: scopedSetLookup.has(candidate.sourceRowNumber) ? 'candidate' : 'ignored',
                        candidateStatus: shared_types_1.PBIValidationStatus.CANDIDATE
                    });
                }
                workspaceDb.run(`UPDATE pbi_batches
           SET scope_mode = @scopeMode,
               scope_payload = @scopePayload,
               scoped_row_count = @scopedCount,
               status = @scopedStatus
           WHERE id = @batchId AND workspace_id = @workspaceId`, {
                    scopeMode,
                    scopePayload: JSON.stringify({
                        selectedSourceRowNumbers: scopedRows,
                        selectedExternalIds
                    }),
                    scopedCount: scopedRows.length,
                    scopedStatus: shared_types_1.PBIBatchStatus.SCOPED,
                    batchId,
                    workspaceId
                });
                workspaceDb.exec('COMMIT');
            }
            catch (error) {
                workspaceDb.exec('ROLLBACK');
                throw error;
            }
            return {
                scopedRowCount: scopedRows.length,
                scopedSourceRows: scopedRows
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async setPBIBatchStatus(workspaceId, batchId, nextStatus, force = false) {
        const batch = await this.getPBIBatch(workspaceId, batchId);
        const currentStatus = batch.status;
        if (!this.isPBIBatchStatusTransitionAllowed(currentStatus, nextStatus, force)) {
            throw new Error(`Cannot transition batch status from '${currentStatus}' to '${nextStatus}'`);
        }
        if (currentStatus === nextStatus) {
            return batch;
        }
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            workspaceDb.run(`UPDATE pbi_batches
         SET status = @status
         WHERE id = @batchId AND workspace_id = @workspaceId`, {
                status: nextStatus,
                batchId,
                workspaceId
            });
            return { ...batch, status: nextStatus };
        }
        finally {
            workspaceDb.close();
        }
    }
    isPBIBatchStatusTransitionAllowed(currentStatus, nextStatus, force) {
        if (currentStatus === nextStatus) {
            return true;
        }
        if (force) {
            return true;
        }
        const currentIndex = PBIBATCH_STATUS_SEQUENCE.indexOf(currentStatus);
        const nextIndex = PBIBATCH_STATUS_SEQUENCE.indexOf(nextStatus);
        if (currentIndex < 0 || nextIndex < 0) {
            return false;
        }
        return nextIndex === currentIndex + 1;
    }
    async linkPBIRecordParents(workspaceId, batchId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const rows = workspaceDb.all(`SELECT id, source_row_number as sourceRowNumber, parent_external_id as parentExternalId
         FROM pbi_records
         WHERE batch_id = @batchId AND parent_external_id IS NOT NULL`, { batchId });
            const index = workspaceDb.all(`
        SELECT external_id as externalId, id, source_row_number as sourceRowNumber
        FROM pbi_records
        WHERE batch_id = @batchId
      `, { batchId });
            const parentByExternal = new Map();
            for (const row of index) {
                parentByExternal.set(row.externalId.toLowerCase(), row.id);
            }
            const updateParent = workspaceDb.prepare(`
        UPDATE pbi_records
        SET parent_record_id = @parentRecordId
        WHERE id = @recordId
      `);
            workspaceDb.exec('BEGIN IMMEDIATE');
            try {
                for (const row of rows) {
                    const parentId = row.parentExternalId ? parentByExternal.get(row.parentExternalId.toLowerCase()) : null;
                    updateParent.run({
                        recordId: row.id,
                        parentRecordId: parentId ?? null
                    });
                }
                workspaceDb.exec('COMMIT');
            }
            catch (error) {
                workspaceDb.exec('ROLLBACK');
                throw error;
            }
        }
        finally {
            workspaceDb.close();
        }
    }
    async getHistory(workspaceId, localeVariantId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const rows = workspaceDb.all(`SELECT * FROM revisions WHERE locale_variant_id = @id ORDER BY revision_number DESC`, { id: localeVariantId });
            return { workspaceId, localeVariantId, revisions: rows };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getArticleDetail(workspaceId, payload) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const targetRevision = payload.revisionId
                ? workspaceDb.get(`SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                    workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                    revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
             FROM revisions WHERE id = @revisionId AND workspace_id = @workspaceId`, { revisionId: payload.revisionId, workspaceId })
                : null;
            let variantRow = null;
            let revision = null;
            if (targetRevision) {
                revision = targetRevision;
                variantRow = workspaceDb.get(`SELECT id, family_id as familyId, locale, status FROM locale_variants WHERE id = @localeVariantId`, {
                    localeVariantId: targetRevision.localeVariantId
                }) ?? null;
            }
            else if (payload.localeVariantId) {
                revision = workspaceDb.get(`
          SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                 workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                 revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
          FROM revisions
          WHERE locale_variant_id = @localeVariantId
            AND revision_type = @revisionType
          ORDER BY revision_number DESC LIMIT 1`, {
                    localeVariantId: payload.localeVariantId,
                    revisionType: payload.preferRevisionType ?? shared_types_1.RevisionState.LIVE
                }) ?? workspaceDb.get(`
          SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                 workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                 revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
          FROM revisions
          WHERE locale_variant_id = @localeVariantId
          ORDER BY revision_number DESC LIMIT 1`, { localeVariantId: payload.localeVariantId }) ?? null;
                variantRow = workspaceDb.get(`SELECT id, family_id as familyId, locale, status FROM locale_variants WHERE id = @id`, {
                    id: payload.localeVariantId
                }) ?? null;
            }
            if (!revision || !variantRow) {
                throw new Error('Revision or locale variant not found');
            }
            const family = workspaceDb.get(`
        SELECT af.id, af.title, af.external_key, af.retired_at
        FROM article_families af
        WHERE af.id = @familyId
      `, { familyId: variantRow.familyId });
            if (!family) {
                throw new Error('Article family not found');
            }
            const absolutePath = resolveRevisionPath(workspace.path, revision.filePath);
            const sourceHtml = payload.includeSource === false ? '' : await this.readRevisionSource(absolutePath);
            const previewHtml = payload.includePreview === false ? '' : sourceHtml;
            const placeholders = payload.includeSource === false ? [] : extractImagePlaceholders(sourceHtml);
            const lineage = payload.includeLineage === false
                ? []
                : workspaceDb.all(`
            SELECT id,
                   locale_variant_id as localeVariantId,
                   predecessor_revision_id as predecessorRevisionId,
                   successor_revision_id as successorRevisionId,
                   created_by as createdBy,
                   created_at as createdAtUtc
            FROM article_lineage
            WHERE locale_variant_id = @localeVariantId
            ORDER BY created_at DESC`, { localeVariantId: variantRow.id });
            const relatedPbis = payload.includeLineage === false
                ? []
                : workspaceDb.all(`
            SELECT DISTINCT p.id, p.batch_id as batchId, p.source_row_number as sourceRowNumber,
                   p.external_id as externalId, p.title, p.description, p.priority
            FROM pbi_records p
            JOIN proposal_pbi_links l ON l.pbi_id = p.id
            JOIN proposals r ON r.id = l.proposal_id
            WHERE r.locale_variant_id = @localeVariantId`, { localeVariantId: variantRow.id });
            const publishLog = payload.includePublishLog === false
                ? []
                : workspaceDb.all(`SELECT id, revision_id, zendesk_article_id, result, published_at
             FROM publish_records
             WHERE revision_id = @revisionId
             ORDER BY published_at DESC`, { revisionId: revision.id });
            return {
                workspaceId,
                familyId: family.id,
                familyTitle: family.title,
                externalKey: family.external_key,
                familyStatus: family.retired_at ? shared_types_1.RevisionState.RETIRED : revision.revisionType,
                localeVariant: {
                    id: variantRow.id,
                    locale: variantRow.locale,
                    status: variantRow.status
                },
                revision: {
                    id: revision.id,
                    revisionType: revision.revisionType,
                    revisionNumber: revision.revisionNumber,
                    updatedAtUtc: revision.updatedAtUtc,
                    contentHash: revision.contentHash
                },
                sourceHtml,
                previewHtml,
                placeholders,
                lineage,
                relatedPbis,
                publishLog: publishLog.map((record) => ({
                    id: record.id,
                    revisionId: record.revision_id,
                    zendeskArticleId: record.zendesk_article_id ?? undefined,
                    result: record.result ?? undefined,
                    publishedAtUtc: record.published_at
                })),
                filePath: absolutePath
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getRepositoryStructure(workspaceId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        return {
            workspaceId,
            rootPath: workspace.path,
            dbPath: node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE),
            storage: {
                root: workspace.path,
                articles: node_path_1.default.join(workspace.path, 'articles'),
                drafts: node_path_1.default.join(workspace.path, 'drafts'),
                revisions: node_path_1.default.join(workspace.path, 'revisions'),
                imports: node_path_1.default.join(workspace.path, 'imports'),
                proposals: node_path_1.default.join(workspace.path, 'proposals'),
                runs: node_path_1.default.join(workspace.path, 'runs'),
                assets: node_path_1.default.join(workspace.path, 'assets'),
                cache: node_path_1.default.join(workspace.path, 'cache'),
                searchIndex: node_path_1.default.join(workspace.path, 'search-index')
            }
        };
    }
    async workspaceRoutePayload(id) {
        const workspace = await this.getWorkspace(id);
        await this.ensureWorkspaceDb(workspace.path);
        return {
            workspaceId: id,
            workspaceRoot: this.workspaceRoot,
            workspacePath: workspace.path,
            dbPath: node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE)
        };
    }
    async getZendeskCredentials(workspaceId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const row = workspaceDb.get(`SELECT email, CASE WHEN encrypted_api_token IS NOT NULL AND encrypted_api_token != '' THEN 1 ELSE 0 END AS has_token
         FROM zendesk_credentials WHERE workspace_id = @workspaceId`, { workspaceId });
            if (!row) {
                return null;
            }
            return {
                workspaceId,
                email: row.email,
                hasApiToken: Boolean(row.has_token)
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getZendeskCredentialsForSync(workspaceId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const row = workspaceDb.get(`SELECT email, encrypted_api_token FROM zendesk_credentials WHERE workspace_id = @workspaceId`, { workspaceId });
            if (!row || !row.encrypted_api_token) {
                return null;
            }
            if (!electron_1.safeStorage.isEncryptionAvailable()) {
                throw new Error('Encrypted credential storage is unavailable');
            }
            return {
                workspaceId,
                email: row.email,
                apiToken: electron_1.safeStorage.decryptString(Buffer.from(row.encrypted_api_token, 'base64'))
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async saveZendeskCredentials(workspaceId, email, apiToken) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            if (!electron_1.safeStorage.isEncryptionAvailable()) {
                throw new Error('Encrypted credential storage is unavailable');
            }
            const normalizedEmail = email.trim().toLowerCase();
            const token = apiToken.trim();
            const encryptedApiToken = electron_1.safeStorage.encryptString(token).toString('base64');
            workspaceDb.run(`INSERT OR REPLACE INTO zendesk_credentials (workspace_id, email, encrypted_api_token, updated_at)
         VALUES (@workspaceId, @email, @token, @updatedAt)`, {
                workspaceId,
                email: normalizedEmail,
                token: encryptedApiToken,
                updatedAt: new Date().toISOString()
            });
            return {
                workspaceId,
                email: normalizedEmail,
                hasApiToken: true
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getSyncCheckpoint(workspaceId, locale) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const row = workspaceDb.get(`SELECT locale, last_synced_at, cursor, synced_articles, updated_at
         FROM zendesk_sync_checkpoints
         WHERE workspace_id = @workspaceId AND locale = @locale`, { workspaceId, locale });
            if (!row) {
                return null;
            }
            return {
                workspaceId,
                locale: row.locale,
                lastSyncedAt: row.last_synced_at ?? undefined,
                cursor: row.cursor ?? undefined,
                syncedArticles: row.synced_articles,
                updatedAtUtc: row.updated_at
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async upsertSyncCheckpoint(workspaceId, locale, syncedArticles, lastSyncedAt, cursor) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            workspaceDb.run(`INSERT INTO zendesk_sync_checkpoints (workspace_id, locale, last_synced_at, cursor, synced_articles, updated_at)
         VALUES (@workspaceId, @locale, @lastSyncedAt, @cursor, @syncedArticles, @updatedAt)
         ON CONFLICT(workspace_id, locale) DO UPDATE SET
           last_synced_at = excluded.last_synced_at,
           cursor = excluded.cursor,
           synced_articles = excluded.synced_articles,
           updated_at = excluded.updated_at`, {
                workspaceId,
                locale,
                lastSyncedAt: lastSyncedAt ?? null,
                cursor: cursor ?? null,
                syncedArticles,
                updatedAt: new Date().toISOString()
            });
        }
        finally {
            workspaceDb.close();
        }
    }
    async logSyncRunStart(workspaceId, runId, mode) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const now = new Date().toISOString();
            workspaceDb.run(`INSERT INTO zendesk_sync_runs (
          id, workspace_id, mode, state, started_at, updated_at
        ) VALUES (
          @id, @workspaceId, @mode, 'RUNNING', @startedAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          mode = excluded.mode,
          state = excluded.state,
          started_at = excluded.started_at,
          updated_at = excluded.updated_at`, {
                id: runId,
                workspaceId,
                mode,
                startedAt: now,
                updatedAt: now
            });
        }
        finally {
            workspaceDb.close();
        }
    }
    async logSyncRunComplete(workspaceId, runId, state, syncedArticles, skippedArticles, createdFamilies, createdVariants, createdRevisions, remoteError, cursorSummary) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            workspaceDb.run(`UPDATE zendesk_sync_runs SET
           state = @state,
           ended_at = @endedAt,
           synced_articles = @syncedArticles,
           skipped_articles = @skippedArticles,
           created_families = @createdFamilies,
           created_variants = @createdVariants,
           created_revisions = @createdRevisions,
           remote_error = @remoteError,
           cursor_summary = @cursorSummary,
           updated_at = @updatedAt
         WHERE id = @runId AND workspace_id = @workspaceId`, {
                workspaceId,
                runId,
                state,
                endedAt: new Date().toISOString(),
                syncedArticles,
                skippedArticles,
                createdFamilies,
                createdVariants,
                createdRevisions,
                remoteError: remoteError ?? null,
                cursorSummary: cursorSummary ?? null,
                updatedAt: new Date().toISOString()
            });
        }
        finally {
            workspaceDb.close();
        }
    }
    async getLatestSyncRun(workspaceId) {
        return this.getLatestSyncRunWithFilter(workspaceId);
    }
    async getLatestSuccessfulSyncRun(workspaceId) {
        return this.getLatestSyncRunWithFilter(workspaceId, 'SUCCEEDED');
    }
    async getLatestSyncRunWithFilter(workspaceId, state) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const row = workspaceDb.get(`SELECT id, mode, state, started_at, ended_at, synced_articles, skipped_articles,
                created_families, created_variants, created_revisions, cursor_summary, remote_error
         FROM zendesk_sync_runs
         WHERE workspace_id = @workspaceId
           ${state ? 'AND state = @state' : ''}
         ORDER BY started_at DESC
         LIMIT 1`, state ? { workspaceId, state } : { workspaceId });
            if (!row) {
                return null;
            }
            return {
                id: row.id,
                mode: row.mode,
                state: row.state,
                startedAtUtc: row.started_at,
                endedAtUtc: row.ended_at ?? undefined,
                syncedArticles: row.synced_articles,
                skippedArticles: row.skipped_articles,
                createdFamilies: row.created_families,
                createdVariants: row.created_variants,
                createdRevisions: row.created_revisions,
                cursorSummary: (() => {
                    if (!row.cursor_summary) {
                        return undefined;
                    }
                    try {
                        const parsed = JSON.parse(row.cursor_summary);
                        return parsed;
                    }
                    catch {
                        return undefined;
                    }
                })(),
                remoteError: row.remote_error ?? undefined
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getArticleFamilyByExternalKey(workspaceId, externalKey) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const row = workspaceDb.get(`SELECT id, workspace_id as workspaceId, external_key as externalKey, title, section_id as sectionId, category_id as categoryId, retired_at as retiredAtUtc
         FROM article_families WHERE workspace_id = @workspaceId AND external_key = @externalKey`, { workspaceId, externalKey });
            return row ?? null;
        }
        finally {
            workspaceDb.close();
        }
    }
    async getLocaleVariantByFamilyAndLocale(workspaceId, familyId, locale) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const row = workspaceDb.get(`SELECT id, family_id as familyId, locale, status, retired_at as retiredAtUtc
         FROM locale_variants
         WHERE family_id = @familyId AND locale = @locale`, { familyId, locale, workspaceId });
            return row ?? null;
        }
        finally {
            workspaceDb.close();
        }
    }
    async getLatestRevision(workspaceId, localeVariantId, revisionType) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const row = workspaceDb.get(`SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
         FROM revisions
         WHERE locale_variant_id = @localeVariantId
         ${revisionType ? 'AND revision_type = @revisionType' : ''}
         ORDER BY revision_number DESC LIMIT 1`, { localeVariantId, revisionType, workspaceId });
            return row ?? null;
        }
        finally {
            workspaceDb.close();
        }
    }
    async markDraftBranchesAsObsolete(workspaceId, localeVariantId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            workspaceDb.run(`UPDATE draft_branches
         SET state = 'obsolete', updated_at = @updatedAt
         WHERE workspace_id = @workspaceId AND locale_variant_id = @localeVariantId AND state != 'obsolete'`, {
                workspaceId,
                localeVariantId,
                updatedAt: new Date().toISOString()
            });
        }
        finally {
            workspaceDb.close();
        }
    }
    async getMigrationHealth(workspaceId) {
        const catalog = await this.openCatalogWithRecovery();
        try {
            const catalogVersion = (0, db_1.getCatalogMigrationVersion)(this.catalogDbPath);
            const rows = workspaceId
                ? catalog.all(`SELECT * FROM workspaces WHERE id = @id`, { id: workspaceId })
                : catalog.all(`SELECT * FROM workspaces`);
            if (workspaceId && rows.length === 0) {
                throw new Error('Workspace not found');
            }
            const workspaces = [];
            for (const row of rows) {
                const dbPath = node_path_1.default.join(row.path, '.meta', DEFAULT_DB_FILE);
                const existedBeforeCheck = await this.fileExists(dbPath);
                let repaired = false;
                let workspaceDbVersion = 0;
                if (existedBeforeCheck) {
                    try {
                        workspaceDbVersion = (0, db_1.getWorkspaceMigrationVersion)(dbPath);
                    }
                    catch {
                        const repairedResult = this.repairWorkspaceDb(dbPath);
                        workspaceDbVersion = repairedResult.appliedVersion;
                        repaired = true;
                    }
                }
                else {
                    const repairedResult = this.repairWorkspaceDb(dbPath);
                    workspaceDbVersion = repairedResult.appliedVersion;
                    repaired = true;
                }
                const exists = await this.fileExists(dbPath);
                workspaces.push({
                    workspaceId: row.id,
                    workspacePath: row.path,
                    catalogVersion,
                    workspaceDbPath: dbPath,
                    workspaceDbVersion,
                    repaired,
                    exists
                });
            }
            return {
                catalogVersion,
                workspaceId: workspaceId ?? null,
                workspaces
            };
        }
        finally {
            catalog.close();
        }
    }
    async openCatalogWithRecovery() {
        const startedAt = Date.now();
        if (this.lastCatalogFailureMs && Date.now() - this.lastCatalogFailureMs < 1500) {
            logger_1.logger.warn('workspace-repository.openCatalogWithRecovery skipped', {
                elapsedMs: Date.now() - startedAt,
                catalogFailureMessage: this.lastCatalogFailureMessage
            });
            throw new Error(this.lastCatalogFailureMessage ?? 'Maximum call stack size exceeded');
        }
        try {
            const catalogExists = await promises_1.default.access(this.catalogDbPath).then(() => true).catch(() => false);
            logger_1.logger.info('workspace-repository.openCatalogWithRecovery start', {
                catalogDbPath: this.catalogDbPath,
                catalogExists
            });
            const catalog = (0, db_1.ensureCatalogSchema)(this.catalogDbPath);
            this.ensureCatalogDefaultWorkspaceColumn(catalog);
            logger_1.logger.info('workspace-repository.openCatalogWithRecovery success', { elapsedMs: Date.now() - startedAt });
            this.lastCatalogFailureMs = 0;
            this.lastCatalogFailureMessage = undefined;
            return catalog;
        }
        catch (error) {
            console.error('[catalog-init] ensureCatalogSchema failed', {
                catalogDbPath: this.catalogDbPath,
                errorName: error?.name,
                errorMessage: error instanceof Error ? error.message : String(error),
                errorStack: error instanceof Error ? error.stack : undefined,
                errorDetails: (0, node_util_1.inspect)(error, { depth: 3, compact: false })
            });
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.lastCatalogFailureMs = Date.now();
            this.lastCatalogFailureMessage = errorMessage;
            logger_1.logger.warn('workspace-repository.openCatalogWithRecovery repair', {
                elapsedMs: Date.now() - startedAt,
                catalogDbPath: this.catalogDbPath
            });
            try {
                await promises_1.default.rm(this.catalogDbPath, { force: true });
                const catalog = (0, db_1.ensureCatalogSchema)(this.catalogDbPath);
                this.ensureCatalogDefaultWorkspaceColumn(catalog);
                logger_1.logger.info('workspace-repository.openCatalogWithRecovery repaired', { elapsedMs: Date.now() - startedAt });
                this.lastCatalogFailureMs = 0;
                this.lastCatalogFailureMessage = undefined;
                return catalog;
            }
            catch (repairError) {
                console.error('[catalog-init] ensureCatalogSchema repair failed', {
                    catalogDbPath: this.catalogDbPath,
                    repairErrorName: repairError?.name,
                    repairErrorMessage: repairError instanceof Error ? repairError.message : String(repairError),
                    repairErrorStack: repairError instanceof Error ? repairError.stack : undefined,
                    repairErrorDetails: (0, node_util_1.inspect)(repairError, { depth: 3, compact: false })
                });
                logger_1.logger.error('workspace-repository.openCatalogWithRecovery repair failed', {
                    elapsedMs: Date.now() - startedAt,
                    message: repairError instanceof Error ? repairError.message : String(repairError),
                    stack: repairError instanceof Error ? repairError.stack : undefined
                });
                throw repairError;
            }
        }
    }
    repairWorkspaceDb(dbPath) {
        return (0, db_1.applyWorkspaceMigrations)(dbPath);
    }
    ensureCatalogDefaultWorkspaceColumn(catalog) {
        const columns = catalog.all(`PRAGMA table_info(workspaces)`).map((column) => column.name);
        if (!columns.includes('is_default')) {
            catalog.exec('ALTER TABLE workspaces ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0');
        }
        const row = catalog.get(`
      SELECT id FROM workspaces
      WHERE is_default = 1
      ORDER BY (last_opened_at IS NULL) ASC, last_opened_at DESC, created_at DESC
      LIMIT 1
    `);
        if (row) {
            const defaultCount = catalog.get(`SELECT COUNT(*) AS total FROM workspaces WHERE is_default = 1`);
            if ((defaultCount?.total ?? 0) !== 1) {
                catalog.run(`
          UPDATE workspaces
          SET is_default = CASE
            WHEN id = @defaultId THEN 1
            ELSE 0
          END`, { defaultId: row.id });
            }
            return;
        }
        const fallback = catalog.get(`
      SELECT id FROM workspaces
      ORDER BY (last_opened_at IS NULL) ASC, last_opened_at DESC, created_at DESC
      LIMIT 1
    `);
        if (fallback) {
            catalog.run(`
        UPDATE workspaces
        SET is_default = CASE
          WHEN id = @defaultId THEN 1
          ELSE 0
        END`, { defaultId: fallback.id });
        }
    }
    openWorkspaceDbWithRecovery(dbPath) {
        try {
            return (0, db_1.openWorkspaceDatabase)(dbPath);
        }
        catch {
            console.error('[workspace-db] openWorkspaceDbWithRecovery failed, attempting repair', {
                workspaceDbPath: dbPath
            });
            this.repairWorkspaceDb(dbPath);
            return (0, db_1.openWorkspaceDatabase)(dbPath);
        }
    }
    async ensureWorkspaceDb(workspacePath) {
        const dbPath = node_path_1.default.join(workspacePath, '.meta', DEFAULT_DB_FILE);
        await promises_1.default.mkdir(node_path_1.default.dirname(dbPath), { recursive: true });
        this.repairWorkspaceDb(dbPath);
        this.ensureKbAccessModeColumn(dbPath);
        return dbPath;
    }
    normalizeWorkspaceDbIdentity(dbPath, workspaceId) {
        const db = this.openWorkspaceDbWithRecovery(dbPath);
        try {
            const staleWorkspaceIds = new Set();
            for (const tableName of WORKSPACE_SCOPED_DB_TABLES) {
                const rows = db.all(`SELECT DISTINCT workspace_id as workspaceId
           FROM ${tableName}
           WHERE workspace_id IS NOT NULL AND workspace_id != @workspaceId`, { workspaceId });
                for (const row of rows) {
                    if (row.workspaceId) {
                        staleWorkspaceIds.add(row.workspaceId);
                    }
                }
            }
            if (staleWorkspaceIds.size === 0) {
                db.run(`DELETE FROM workspace_settings WHERE workspace_id != @workspaceId`, { workspaceId });
                return;
            }
            const now = new Date().toISOString();
            db.exec('BEGIN IMMEDIATE TRANSACTION');
            for (const staleWorkspaceId of staleWorkspaceIds) {
                for (const tableName of WORKSPACE_SCOPED_DB_TABLES) {
                    db.run(`UPDATE ${tableName}
             SET workspace_id = @workspaceId
             WHERE workspace_id = @staleWorkspaceId`, { workspaceId, staleWorkspaceId });
                }
            }
            db.run(`DELETE FROM workspace_settings WHERE workspace_id != @workspaceId`, { workspaceId });
            db.run(`UPDATE draft_branches SET updated_at = @updatedAt WHERE workspace_id = @workspaceId`, { workspaceId, updatedAt: now });
            db.exec('COMMIT');
        }
        catch (error) {
            try {
                db.exec('ROLLBACK');
            }
            catch {
                // no-op
            }
            throw error;
        }
        finally {
            db.close();
        }
    }
    ensureKbAccessModeColumn(dbPath) {
        const db = (0, db_1.openWorkspaceDatabase)(dbPath);
        try {
            const columns = db.all(`PRAGMA table_info(workspace_settings)`).map((c) => c.name);
            if (!columns.includes('kb_access_mode')) {
                db.exec(`ALTER TABLE workspace_settings ADD COLUMN kb_access_mode TEXT NOT NULL DEFAULT 'mcp'`);
            }
        }
        finally {
            db.close();
        }
    }
    async prepareWorkspaceFilesystem(workspacePath) {
        const dirs = [
            workspacePath,
            node_path_1.default.join(workspacePath, '.meta'),
            node_path_1.default.join(workspacePath, 'articles'),
            node_path_1.default.join(workspacePath, 'revisions'),
            node_path_1.default.join(workspacePath, 'drafts'),
            node_path_1.default.join(workspacePath, 'runs'),
            node_path_1.default.join(workspacePath, 'assets'),
            node_path_1.default.join(workspacePath, 'imports'),
            node_path_1.default.join(workspacePath, 'proposals'),
            node_path_1.default.join(workspacePath, 'search-index'),
            node_path_1.default.join(workspacePath, 'cache')
        ];
        for (const dir of dirs) {
            await promises_1.default.mkdir(dir, { recursive: true });
        }
    }
    async fileExists(filePath) {
        try {
            await promises_1.default.access(filePath);
            return true;
        }
        catch {
            return false;
        }
    }
    async readRevisionSource(filePath) {
        try {
            return await promises_1.default.readFile(filePath, 'utf-8');
        }
        catch {
            return '';
        }
    }
}
exports.WorkspaceRepository = WorkspaceRepository;
function normalizeSearchScope(scope) {
    if (scope === 'live' || scope === 'drafts' || scope === 'retired' || scope === 'conflicted' || scope === 'all') {
        return scope;
    }
    return 'all';
}
function variantToDraftCount(map, localeVariantId) {
    return map.get(localeVariantId) ?? 0;
}
function passSearchScope(status, scope, draftCount, hasDrafts, includeConflicts, changedWithinHours, updatedAt) {
    if (scope === 'live' && status.status !== shared_types_1.RevisionState.LIVE) {
        return false;
    }
    if (scope === 'retired' && status.status !== shared_types_1.RevisionState.RETIRED) {
        return false;
    }
    if (scope === 'conflicted' && !status.hasConflicts) {
        return false;
    }
    if (scope === 'drafts' && draftCount <= 0) {
        return false;
    }
    if (hasDrafts && draftCount <= 0) {
        return false;
    }
    if (!includeConflicts && status.hasConflicts) {
        return false;
    }
    if (typeof changedWithinHours === 'number' && changedWithinHours > 0 && updatedAt) {
        const cutoffMs = Date.now() - (changedWithinHours * 60 * 60 * 1000);
        if (Date.parse(updatedAt) < cutoffMs) {
            return false;
        }
    }
    return true;
}
function resolveRevisionPath(workspacePath, filePath) {
    return node_path_1.default.isAbsolute(filePath) ? filePath : node_path_1.default.join(workspacePath, filePath);
}
function buildSearchSnippet(value) {
    const text = stripHtml(value);
    if (text.length <= 160) {
        return text;
    }
    return `${text.slice(0, 157)}...`;
}
function findTextMatch(source, query) {
    const normalized = source.toLowerCase();
    const search = query.toLowerCase();
    const index = normalized.indexOf(search);
    if (index < 0) {
        return null;
    }
    const start = Math.max(0, index - 80);
    const end = Math.min(source.length, index + search.length + 80);
    return {
        context: 'body',
        snippet: source.slice(start, end),
        scoreBoost: 1.0
    };
}
function sanitizePreviewHtml(html) {
    return stripHtml(html).slice(0, 400);
}
function extractImagePlaceholders(source) {
    const placeholders = [];
    const tokens = new Set();
    const tokenPattern = /\{\{\s*([A-Za-z0-9._-]+)\s*\}\}/g;
    let match = tokenPattern.exec(source);
    while (match) {
        const token = match[1]?.trim();
        if (token && !tokens.has(token)) {
            tokens.add(token);
            placeholders.push({
                token,
                description: `Placeholder token: ${token}`
            });
        }
        match = tokenPattern.exec(source);
    }
    return placeholders;
}
function stripHtml(input) {
    return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function getLatestRevisions(revisions) {
    const latest = new Map();
    revisions.forEach((revision) => {
        const current = latest.get(revision.localeVariantId);
        if (!current || revision.revisionNumber > current.revisionNumber) {
            latest.set(revision.localeVariantId, {
                revisionId: revision.id,
                localeVariantId: revision.localeVariantId,
                revisionNumber: revision.revisionNumber,
                revisionType: revision.revisionType,
                filePath: revision.filePath,
                updatedAtUtc: revision.updatedAtUtc
            });
        }
    });
    return latest;
}
function mapWorkspaceRow(row) {
    return {
        id: row.id,
        name: row.name,
        createdAtUtc: row.created_at,
        updatedAtUtc: row.updated_at,
        lastOpenedAtUtc: row.last_opened_at ?? undefined,
        zendeskConnectionId: row.id,
        defaultLocale: row.default_locale,
        enabledLocales: safeParseLocales(row.enabled_locales),
        state: row.state,
        isDefaultWorkspace: Boolean(row.is_default),
        path: row.path
    };
}
function buildWorkspaceItemFromCatalog(row, articleCount, draftCount) {
    return {
        ...mapWorkspaceRow(row),
        articleCount,
        draftCount
    };
}
function workspacePath(inputPath, root, name) {
    return node_path_1.default.resolve(inputPath ?? node_path_1.default.join(root, sanitizeName(name)));
}
function normalizeLocales(locales) {
    return locales && locales.length > 0 ? locales : ['en-us'];
}
function isValidKbAccessMode(value) {
    return value === 'mcp' || value === 'cli';
}
function normalizeKbAccessMode(value) {
    return isValidKbAccessMode(value ?? '') ? value : DEFAULT_KB_ACCESS_MODE;
}
function latestTimestamp(...values) {
    return values
        .filter((value) => Boolean(value))
        .sort((left, right) => right.localeCompare(left))[0];
}
function safeParseLocales(value) {
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
            return parsed;
        }
    }
    catch {
        // noop
    }
    return ['en-us'];
}
function sanitizeName(name) {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/(^-|-$)/g, '') || (0, node_crypto_1.randomUUID)();
}
