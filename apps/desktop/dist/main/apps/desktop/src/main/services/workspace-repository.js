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
const diff_engine_1 = require("@kb-vault/diff-engine");
const db_1 = require("@kb-vault/db");
const export_service_1 = require("./article-relations-v2/export-service");
const feature_map_service_1 = require("./article-relations-v2/feature-map-service");
const index_builder_1 = require("./article-relations-v2/index-builder");
const index_db_1 = require("./article-relations-v2/index-db");
const query_service_1 = require("./article-relations-v2/query-service");
const relation_orchestrator_1 = require("./article-relations-v2/relation-orchestrator");
const types_1 = require("./article-relations-v2/types");
const logger_1 = require("./logger");
const DEFAULT_DB_FILE = 'kb-vault.sqlite';
const DEFAULT_KB_ACCESS_MODE = 'direct';
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
    'article_relation_runs',
    'article_relations',
    'article_relation_overrides',
    'article_relation_index_state',
    'article_relation_feedback',
    'kb_scope_catalog',
    'kb_scope_overrides',
    'batch_analysis_iterations',
    'batch_analysis_stage_runs',
    'batch_analysis_plans',
    'batch_analysis_plan_items',
    'batch_analysis_reviews',
    'batch_analysis_worker_reports',
    'batch_analysis_discovered_work',
    'batch_analysis_question_sets',
    'batch_analysis_questions',
    'batch_analysis_final_reviews',
    'batch_analysis_amendments',
    'batch_analysis_stage_events',
    'agent_notes'
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
const PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX = 'proposal-';
const ARTICLE_TAXONOMY_SOURCE_VALUES = [
    'zendesk_article',
    'zendesk_section_parent',
    'inferred_existing_scope',
    'inferred_local_scope',
    'manual_override',
    'none'
];
const ARTICLE_FAMILY_SELECT_COLUMNS = `
  id,
  workspace_id as workspaceId,
  external_key as externalKey,
  title,
  section_id as sectionId,
  category_id as categoryId,
  source_section_id as sourceSectionId,
  source_category_id as sourceCategoryId,
  section_source as sectionSource,
  category_source as categorySource,
  taxonomy_confidence as taxonomyConfidence,
  taxonomy_updated_at as taxonomyUpdatedAt,
  taxonomy_note as taxonomyNote,
  retired_at as retiredAtUtc
`;
const REVIEWABLE_PROPOSAL_STATUSES = new Set([
    shared_types_1.ProposalReviewStatus.PENDING_REVIEW,
    shared_types_1.ProposalReviewStatus.ACCEPTED,
    shared_types_1.ProposalReviewStatus.DENIED,
    shared_types_1.ProposalReviewStatus.DEFERRED,
    shared_types_1.ProposalReviewStatus.APPLIED_TO_BRANCH,
    shared_types_1.ProposalReviewStatus.ARCHIVED
]);
const OPEN_PROPOSAL_STATUSES = new Set([
    shared_types_1.ProposalReviewStatus.STAGED_ANALYSIS,
    shared_types_1.ProposalReviewStatus.PENDING_REVIEW,
    shared_types_1.ProposalReviewStatus.DEFERRED
]);
const PBI_LIBRARY_PRIORITY_ORDER_SQL = `
  CASE COALESCE(p.priority, '')
    WHEN 'low' THEN 1
    WHEN 'medium' THEN 2
    WHEN 'high' THEN 3
    WHEN 'urgent' THEN 4
    ELSE 5
  END
`;
function buildPBILibraryScopeStateSql(recordAlias) {
    return `
    CASE
      WHEN ${recordAlias}.validation_status = '${shared_types_1.PBIValidationStatus.CANDIDATE}'
        AND COALESCE(${recordAlias}.state, '${shared_types_1.PBIValidationStatus.CANDIDATE}') = '${shared_types_1.PBIValidationStatus.CANDIDATE}'
        THEN 'in_scope'
      WHEN ${recordAlias}.validation_status = '${shared_types_1.PBIValidationStatus.CANDIDATE}'
        AND ${recordAlias}.state = '${shared_types_1.PBIValidationStatus.IGNORED}'
        THEN 'out_of_scope'
      ELSE 'not_eligible'
    END
  `;
}
function escapeSqlLikePattern(value) {
    return value.replace(/[\\%_]/g, '\\$&');
}
const ACP_ALLOWED_MODEL_IDS = new Set([
    'composer-2[fast=true]',
    'composer-1.5[]',
    'gpt-5.3-codex[reasoning=medium,fast=false]',
    'gpt-5.4[reasoning=medium,context=272k,fast=false]',
    'claude-sonnet-4-6[thinking=true,context=200k,effort=medium]',
    'claude-opus-4-6[thinking=true,context=200k,effort=high,fast=false]',
    'claude-opus-4-5[thinking=true]',
    'gpt-5.2[reasoning=medium,fast=false]',
    'gemini-3.1-pro[]',
    'gpt-5.4-mini[reasoning=medium]',
    'gpt-5.4-nano[reasoning=medium]',
    'claude-haiku-4-5[thinking=true]',
    'gpt-5.3-codex-spark[reasoning=medium]',
    'grok-4-20[thinking=true]',
    'claude-sonnet-4-5[thinking=true,context=200k]',
    'gpt-5.2-codex[reasoning=medium,fast=false]',
    'gpt-5.1-codex-max[reasoning=medium,fast=false]',
    'gpt-5.1[reasoning=medium]',
    'gemini-3-pro[]',
    'gemini-3-flash[]',
    'gpt-5.1-codex-mini[reasoning=medium]',
    'claude-sonnet-4[thinking=false,context=200k]',
    'gpt-5-mini[]',
    'gemini-2.5-flash[]',
    'kimi-k2.5[]'
]);
class WorkspaceRepository {
    workspaceRoot;
    catalogDbPath;
    articleRelationsV2ExportService;
    articleRelationsV2FeatureMapService;
    articleRelationsV2QueryService;
    articleRelationsV2RelationOrchestrator;
    lastCatalogFailureMs = 0;
    lastCatalogFailureMessage;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.catalogDbPath = node_path_1.default.join(this.workspaceRoot, CATALOG_DB_PATH);
        this.articleRelationsV2ExportService = new export_service_1.ArticleRelationsV2ExportService({
            fileExists: async (filePath) => this.fileExists(filePath),
            readTextFile: async (filePath) => promises_1.default.readFile(filePath, 'utf8')
        });
        this.articleRelationsV2FeatureMapService = new feature_map_service_1.ArticleRelationsV2FeatureMapService({
            withWorkspaceDb: async (workspaceId, handler) => this.withWorkspaceDb(workspaceId, handler),
            resolveKbScopeDisplayNames: async (workspaceId, scopes) => this.resolveKbScopeDisplayNames(workspaceId, scopes)
        });
        this.articleRelationsV2QueryService = new query_service_1.ArticleRelationsV2QueryService();
        this.articleRelationsV2RelationOrchestrator = new relation_orchestrator_1.ArticleRelationsV2RelationOrchestrator(this.articleRelationsV2QueryService);
    }
    normalizeAgentModelId(modelId) {
        const next = modelId?.trim();
        if (!next) {
            return undefined;
        }
        const withoutAnsi = next.replace(/\u001B\[[0-9;]*m/g, '').trim();
        const withoutMarkers = withoutAnsi.replace(/\s+\((?:current|default)[^)]+\)\s*$/i, '').trim();
        const normalized = withoutMarkers.split(/\s+-\s+/, 1)[0]?.trim() ?? withoutMarkers;
        return normalized || undefined;
    }
    normalizeAcpModelId(modelId) {
        const normalized = this.normalizeAgentModelId(modelId);
        if (!normalized || !ACP_ALLOWED_MODEL_IDS.has(normalized)) {
            return undefined;
        }
        return normalized;
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
    async withWorkspaceDb(workspaceId, handler) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            return await handler(workspaceDb);
        }
        finally {
            workspaceDb.close();
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
            , kb_access_mode, agent_model_id, acp_model_id
           FROM workspace_settings WHERE workspace_id = @workspaceId`, { workspaceId: id });
                if (settings) {
                    return {
                        workspaceId: settings.workspace_id,
                        zendeskSubdomain: settings.zendesk_subdomain,
                        zendeskBrandId: settings.zendesk_brand_id ?? undefined,
                        defaultLocale: settings.default_locale,
                        enabledLocales: safeParseLocales(settings.enabled_locales),
                        kbAccessMode: normalizeKbAccessMode(settings.kb_access_mode),
                        agentModelId: this.normalizeAgentModelId(settings.agent_model_id),
                        acpModelId: this.normalizeAcpModelId(settings.acp_model_id)
                    };
                }
                const enabledLocales = safeParseLocales(row.enabled_locales);
                workspaceDb.run(`INSERT INTO workspace_settings (
            workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, kb_access_mode, agent_model_id, acp_model_id, updated_at
          ) VALUES (
            @workspaceId, @zendeskSubdomain, @zendeskBrandId, @defaultLocale, @enabledLocales, @kbAccessMode, @agentModelId, @acpModelId, @updatedAt
          )`, {
                    workspaceId: id,
                    zendeskSubdomain: row.zendesk_subdomain,
                    zendeskBrandId: row.zendesk_brand_id,
                    defaultLocale: row.default_locale,
                    enabledLocales: JSON.stringify(enabledLocales),
                    kbAccessMode: DEFAULT_KB_ACCESS_MODE,
                    agentModelId: null,
                    acpModelId: null,
                    updatedAt: new Date().toISOString()
                });
                return {
                    workspaceId: id,
                    zendeskSubdomain: row.zendesk_subdomain,
                    zendeskBrandId: row.zendesk_brand_id ?? undefined,
                    defaultLocale: row.default_locale,
                    enabledLocales,
                    kbAccessMode: DEFAULT_KB_ACCESS_MODE,
                    agentModelId: undefined,
                    acpModelId: undefined
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
            , kb_access_mode, agent_model_id, acp_model_id
           FROM workspace_settings WHERE workspace_id = @workspaceId`, { workspaceId: payload.workspaceId });
                const fallbackDefaultLocale = existing?.default_locale ?? row.default_locale;
                const fallbackSubdomain = existing?.zendesk_subdomain ?? row.zendesk_subdomain;
                const fallbackBrand = existing?.zendesk_brand_id ?? row.zendesk_brand_id;
                const fallbackEnabledLocales = safeParseLocales(existing?.enabled_locales ?? row.enabled_locales);
                if (payload.zendeskSubdomain === undefined &&
                    payload.zendeskBrandId === undefined &&
                    payload.defaultLocale === undefined &&
                    payload.enabledLocales === undefined &&
                    payload.kbAccessMode === undefined &&
                    payload.agentModelId === undefined &&
                    payload.acpModelId === undefined) {
                    throw new Error('No settings provided');
                }
                if (payload.kbAccessMode !== undefined &&
                    !isValidKbAccessMode(payload.kbAccessMode)) {
                    throw new Error('kbAccessMode must be direct, mcp, or cli');
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
                if (typeof payload.agentModelId === 'string' && !payload.agentModelId.trim()) {
                    throw new Error('agentModelId cannot be empty');
                }
                if (typeof payload.acpModelId === 'string' && !payload.acpModelId.trim()) {
                    throw new Error('acpModelId cannot be empty');
                }
                const enabledLocales = payload.enabledLocales?.length
                    ? normalizeLocales(payload.enabledLocales)
                    : fallbackEnabledLocales;
                const nextDefaultLocale = payload.defaultLocale ?? fallbackDefaultLocale;
                const nextSubdomain = payload.zendeskSubdomain ?? fallbackSubdomain;
                const nextBrand = payload.zendeskBrandId !== undefined ? payload.zendeskBrandId : fallbackBrand;
                const nextKbAccessMode = normalizeKbAccessMode(payload.kbAccessMode ?? existing?.kb_access_mode);
                const nextAgentModelId = payload.agentModelId !== undefined
                    ? this.normalizeAgentModelId(payload.agentModelId)
                    : this.normalizeAgentModelId(existing?.agent_model_id);
                const nextAcpModelId = payload.acpModelId !== undefined
                    ? this.normalizeAcpModelId(payload.acpModelId)
                    : this.normalizeAcpModelId(existing?.acp_model_id);
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
            workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, kb_access_mode, agent_model_id, acp_model_id, updated_at
          ) VALUES (
            @workspaceId, @zendeskSubdomain, @zendeskBrandId, @defaultLocale, @enabledLocales, @kbAccessMode, @agentModelId, @acpModelId, @updatedAt
          )`, {
                    workspaceId: payload.workspaceId,
                    zendeskSubdomain: nextSubdomain,
                    zendeskBrandId: nextBrand,
                    defaultLocale: nextDefaultLocale,
                    enabledLocales: JSON.stringify(normalizedEnabledLocales),
                    kbAccessMode: nextKbAccessMode,
                    agentModelId: nextAgentModelId ?? null,
                    acpModelId: nextAcpModelId ?? null,
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
                    kbAccessMode: nextKbAccessMode,
                    agentModelId: nextAgentModelId,
                    acpModelId: nextAcpModelId
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
            workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, kb_access_mode, agent_model_id, acp_model_id, updated_at
          ) VALUES (
            @workspaceId, @zendeskSubdomain, @zendeskBrandId, @defaultLocale, @enabledLocales, @kbAccessMode, @agentModelId, @acpModelId, @updatedAt
          )`, {
                    workspaceId: id,
                    zendeskSubdomain: payload.zendeskSubdomain,
                    zendeskBrandId: payload.zendeskBrandId ?? null,
                    defaultLocale: payload.defaultLocale,
                    enabledLocales: JSON.stringify(enabledLocales),
                    kbAccessMode: DEFAULT_KB_ACCESS_MODE,
                    agentModelId: null,
                    acpModelId: null,
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
        try {
            const catalogRows = catalog.all(`
        SELECT id, name, path, created_at, updated_at, last_opened_at, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, state, is_default
        FROM workspaces
        ORDER BY name COLLATE NOCASE
      `);
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
            return workspaceDb.all(`SELECT ${ARTICLE_FAMILY_SELECT_COLUMNS}
         FROM article_families
         WHERE workspace_id = @workspaceId
         ORDER BY title`, { workspaceId }).map(mapArticleFamilyRow);
        }
        finally {
            workspaceDb.close();
        }
    }
    async getArticleFamily(workspaceId, familyId) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const family = workspaceDb.get(`SELECT ${ARTICLE_FAMILY_SELECT_COLUMNS}
         FROM article_families
         WHERE id = @familyId AND workspace_id = @workspaceId`, { familyId, workspaceId });
            if (!family) {
                throw new Error('Article family not found');
            }
            return mapArticleFamilyRow(family);
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
            const sectionId = normalizeFeatureMapScopeId(payload.sectionId);
            const categoryId = normalizeFeatureMapScopeId(payload.categoryId);
            const sourceSectionId = normalizeFeatureMapScopeId(payload.sourceSectionId);
            const sourceCategoryId = normalizeFeatureMapScopeId(payload.sourceCategoryId);
            const sectionSource = payload.sectionSource !== undefined
                ? normalizeArticleTaxonomySource(payload.sectionSource)
                : (sectionId ? 'manual_override' : 'none');
            const categorySource = payload.categorySource !== undefined
                ? normalizeArticleTaxonomySource(payload.categorySource)
                : (categoryId ? 'manual_override' : 'none');
            const taxonomyConfidence = normalizeArticleTaxonomyConfidence(payload.taxonomyConfidence);
            const taxonomyNote = normalizeFeatureMapScopeId(payload.taxonomyNote);
            const taxonomyUpdatedAt = payload.taxonomyUpdatedAt !== undefined
                ? normalizeFeatureMapScopeId(payload.taxonomyUpdatedAt)
                : (sectionId
                    || categoryId
                    || sourceSectionId
                    || sourceCategoryId
                    || sectionSource !== 'none'
                    || categorySource !== 'none'
                    || taxonomyConfidence !== undefined
                    || taxonomyNote)
                    ? now
                    : undefined;
            workspaceDb.run(`INSERT INTO article_families (
           id,
           workspace_id,
           external_key,
           title,
           section_id,
           category_id,
           source_section_id,
           source_category_id,
           section_source,
           category_source,
           taxonomy_confidence,
           taxonomy_updated_at,
           taxonomy_note,
           retired_at
         )
         VALUES (
           @id,
           @workspaceId,
           @externalKey,
           @title,
           @sectionId,
           @categoryId,
           @sourceSectionId,
           @sourceCategoryId,
           @sectionSource,
           @categorySource,
           @taxonomyConfidence,
           @taxonomyUpdatedAt,
           @taxonomyNote,
           @retiredAtUtc
         )`, {
                id,
                workspaceId: payload.workspaceId,
                externalKey,
                title,
                sectionId: sectionId ?? null,
                categoryId: categoryId ?? null,
                sourceSectionId: sourceSectionId ?? null,
                sourceCategoryId: sourceCategoryId ?? null,
                sectionSource,
                categorySource,
                taxonomyConfidence: taxonomyConfidence ?? null,
                taxonomyUpdatedAt: taxonomyUpdatedAt ?? null,
                taxonomyNote: taxonomyNote ?? null,
                retiredAtUtc: payload.retiredAtUtc ?? null
            });
            return mapArticleFamilyRow({
                id,
                workspaceId: payload.workspaceId,
                externalKey,
                title,
                sectionId: sectionId ?? null,
                categoryId: categoryId ?? null,
                sourceSectionId: sourceSectionId ?? null,
                sourceCategoryId: sourceCategoryId ?? null,
                sectionSource,
                categorySource,
                taxonomyConfidence: taxonomyConfidence ?? null,
                taxonomyUpdatedAt: taxonomyUpdatedAt ?? null,
                taxonomyNote: taxonomyNote ?? null,
                retiredAtUtc: payload.retiredAtUtc ?? null
            });
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
            const existingRow = workspaceDb.get(`SELECT ${ARTICLE_FAMILY_SELECT_COLUMNS}
         FROM article_families
         WHERE id = @familyId AND workspace_id = @workspaceId`, { familyId: payload.familyId, workspaceId: payload.workspaceId });
            if (!existingRow) {
                throw new Error('Article family not found');
            }
            const existing = mapArticleFamilyRow(existingRow);
            if (payload.title === undefined &&
                payload.sectionId === undefined &&
                payload.categoryId === undefined &&
                payload.sourceSectionId === undefined &&
                payload.sourceCategoryId === undefined &&
                payload.sectionSource === undefined &&
                payload.categorySource === undefined &&
                payload.taxonomyConfidence === undefined &&
                payload.taxonomyUpdatedAt === undefined &&
                payload.taxonomyNote === undefined &&
                payload.retiredAtUtc === undefined) {
                throw new Error('Article family update requires at least one field');
            }
            const title = payload.title ?? existing.title;
            if (payload.title !== undefined && !title.trim()) {
                throw new Error('Article family title cannot be empty');
            }
            const sectionId = payload.sectionId !== undefined
                ? normalizeFeatureMapScopeId(payload.sectionId)
                : existing.sectionId;
            const categoryId = payload.categoryId !== undefined
                ? normalizeFeatureMapScopeId(payload.categoryId)
                : existing.categoryId;
            const sourceSectionId = payload.sourceSectionId !== undefined
                ? normalizeFeatureMapScopeId(payload.sourceSectionId)
                : existing.sourceSectionId;
            const sourceCategoryId = payload.sourceCategoryId !== undefined
                ? normalizeFeatureMapScopeId(payload.sourceCategoryId)
                : existing.sourceCategoryId;
            const sectionSource = payload.sectionSource !== undefined
                ? normalizeArticleTaxonomySource(payload.sectionSource)
                : (payload.sectionId !== undefined
                    ? (sectionId ? 'manual_override' : 'none')
                    : (existing.sectionSource ?? 'none'));
            const categorySource = payload.categorySource !== undefined
                ? normalizeArticleTaxonomySource(payload.categorySource)
                : (payload.categoryId !== undefined
                    ? (categoryId ? 'manual_override' : 'none')
                    : (existing.categorySource ?? 'none'));
            const taxonomyConfidence = payload.taxonomyConfidence !== undefined
                ? normalizeArticleTaxonomyConfidence(payload.taxonomyConfidence)
                : existing.taxonomyConfidence;
            const taxonomyNote = payload.taxonomyNote !== undefined
                ? normalizeFeatureMapScopeId(payload.taxonomyNote)
                : existing.taxonomyNote;
            const retiredAt = payload.retiredAtUtc === null ? null : (payload.retiredAtUtc ?? existing.retiredAtUtc ?? null);
            const taxonomyFieldsChanged = sectionId !== existing.sectionId
                || categoryId !== existing.categoryId
                || sourceSectionId !== existing.sourceSectionId
                || sourceCategoryId !== existing.sourceCategoryId
                || sectionSource !== (existing.sectionSource ?? 'none')
                || categorySource !== (existing.categorySource ?? 'none')
                || taxonomyConfidence !== existing.taxonomyConfidence
                || taxonomyNote !== existing.taxonomyNote;
            const taxonomyUpdatedAt = payload.taxonomyUpdatedAt !== undefined
                ? normalizeFeatureMapScopeId(payload.taxonomyUpdatedAt)
                : (taxonomyFieldsChanged ? new Date().toISOString() : existing.taxonomyUpdatedAt);
            workspaceDb.run(`UPDATE article_families
         SET title = @title,
             section_id = @sectionId,
             category_id = @categoryId,
             source_section_id = @sourceSectionId,
             source_category_id = @sourceCategoryId,
             section_source = @sectionSource,
             category_source = @categorySource,
             taxonomy_confidence = @taxonomyConfidence,
             taxonomy_updated_at = @taxonomyUpdatedAt,
             taxonomy_note = @taxonomyNote,
             retired_at = @retiredAtUtc
         WHERE id = @familyId AND workspace_id = @workspaceId`, {
                familyId: payload.familyId,
                workspaceId: payload.workspaceId,
                title,
                sectionId,
                categoryId,
                sourceSectionId: sourceSectionId ?? null,
                sourceCategoryId: sourceCategoryId ?? null,
                sectionSource,
                categorySource,
                taxonomyConfidence: taxonomyConfidence ?? null,
                taxonomyUpdatedAt: taxonomyUpdatedAt ?? null,
                taxonomyNote: taxonomyNote ?? null,
                retiredAtUtc: retiredAt
            });
            const familyMetadataChanged = title !== existing.title
                || sectionId !== (existing.sectionId ?? undefined)
                || categoryId !== (existing.categoryId ?? undefined)
                || sourceSectionId !== (existing.sourceSectionId ?? undefined)
                || sourceCategoryId !== (existing.sourceCategoryId ?? undefined)
                || sectionSource !== (existing.sectionSource ?? 'none')
                || categorySource !== (existing.categorySource ?? 'none')
                || taxonomyConfidence !== existing.taxonomyConfidence
                || taxonomyNote !== existing.taxonomyNote
                || (retiredAt ?? undefined) !== (existing.retiredAtUtc ?? undefined);
            if (familyMetadataChanged) {
                try {
                    this.markArticleRelationFamiliesStale(workspaceDb, payload.workspaceId, [payload.familyId]);
                }
                catch (error) {
                    logger_1.logger.warn('workspace-repository.updateArticleFamily stale-mark failed', {
                        workspaceId: payload.workspaceId,
                        familyId: payload.familyId,
                        message: error instanceof Error ? error.message : String(error)
                    });
                }
            }
            return {
                ...existing,
                title,
                sectionId,
                categoryId,
                sourceSectionId,
                sourceCategoryId,
                sectionSource,
                categorySource,
                taxonomyConfidence,
                taxonomyUpdatedAt,
                taxonomyNote,
                retiredAtUtc: retiredAt ?? undefined
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getKbSectionParentCategory(workspaceId, sectionId) {
        const normalizedSectionId = normalizeFeatureMapScopeId(sectionId);
        if (!normalizedSectionId) {
            return undefined;
        }
        return this.withWorkspaceDb(workspaceId, (workspaceDb) => (this.getKbSectionParentCategoryInDb(workspaceDb, workspaceId, normalizedSectionId)));
    }
    async resolveEffectiveArticleTaxonomyPlacement(workspaceId, familyId, options = {}) {
        const reconciled = await this.reconcileEffectiveArticleTaxonomyPlacements(workspaceId, {
            familyIds: [familyId],
            allowInference: options.allowInference,
            indexDb: options.indexDb
        });
        const family = reconciled[0];
        if (!family) {
            throw new Error('Article family not found');
        }
        return family;
    }
    async reconcileEffectiveArticleTaxonomyPlacements(workspaceId, options = {}) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        let ownedIndexDb = false;
        let indexDb = options.indexDb;
        try {
            if (!indexDb && options.allowInference === true) {
                const indexDbPath = this.getArticleRelationsV2IndexDbPath(workspace.path);
                if (await this.fileExists(indexDbPath)) {
                    indexDb = this.getArticleRelationsV2IndexDb(workspace.path).open();
                    ownedIndexDb = true;
                }
            }
            const families = this.listArticleFamiliesForTaxonomyInDb(workspaceDb, workspaceId, options.familyIds);
            if (families.length === 0) {
                return [];
            }
            const changedFamilyIds = [];
            const results = [];
            workspaceDb.exec('BEGIN IMMEDIATE');
            try {
                for (const family of families) {
                    const resolution = this.resolveEffectiveArticleTaxonomyPlacementInDb(workspaceDb, workspaceId, family, {
                        allowInference: options.allowInference === true,
                        indexDb
                    });
                    const applied = this.applyArticleTaxonomyResolutionInDb(workspaceDb, workspaceId, family, resolution);
                    results.push(applied.family);
                    if (applied.changed) {
                        changedFamilyIds.push(family.id);
                    }
                }
                workspaceDb.exec('COMMIT');
            }
            catch (error) {
                workspaceDb.exec('ROLLBACK');
                throw error;
            }
            if (changedFamilyIds.length > 0) {
                try {
                    this.markArticleRelationFamiliesStale(workspaceDb, workspaceId, changedFamilyIds);
                }
                catch (error) {
                    logger_1.logger.warn('workspace-repository.reconcileEffectiveArticleTaxonomyPlacements stale-mark failed', {
                        workspaceId,
                        familyIds: changedFamilyIds,
                        message: error instanceof Error ? error.message : String(error)
                    });
                }
            }
            return results;
        }
        finally {
            if (ownedIndexDb) {
                indexDb?.close();
            }
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
            await this.ensureDefaultTemplatePacks(workspaceId, workspaceDb);
            return workspaceDb.all(`SELECT id, workspace_id as workspaceId, name, language, prompt_template as promptTemplate,
                tone_rules as toneRules, examples, active, updated_at as updatedAtUtc
         FROM template_packs
         WHERE workspace_id = @workspaceId
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
            await this.ensureDefaultTemplatePacks(workspaceId, workspaceDb);
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
            await this.ensureDefaultTemplatePacks(workspaceId, workspaceDb);
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
    async listTemplatePackSummaries(input) {
        const workspace = await this.getWorkspace(input.workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            await this.ensureDefaultTemplatePacks(input.workspaceId, workspaceDb);
            const rows = workspaceDb.all(`SELECT id,
                workspace_id as workspaceId,
                name,
                language,
                prompt_template as promptTemplate,
                tone_rules as toneRules,
                examples,
                active,
                updated_at as updatedAtUtc,
                template_type as templateType,
                description,
                analysis_json as analysisJson
         FROM template_packs
         WHERE workspace_id = @workspaceId
           AND (@includeInactive = 1 OR active = 1)
         ORDER BY active DESC, updated_at DESC, name ASC`, {
                workspaceId: input.workspaceId,
                includeInactive: input.includeInactive ? 1 : 0
            });
            return {
                workspaceId: input.workspaceId,
                templates: rows.map((row) => this.mapTemplatePackSummary(row))
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getTemplatePackDetail(input) {
        const workspace = await this.getWorkspace(input.workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            await this.ensureDefaultTemplatePacks(input.workspaceId, workspaceDb);
            const row = workspaceDb.get(`SELECT id,
                workspace_id as workspaceId,
                name,
                language,
                prompt_template as promptTemplate,
                tone_rules as toneRules,
                examples,
                active,
                updated_at as updatedAtUtc,
                template_type as templateType,
                description,
                analysis_json as analysisJson
         FROM template_packs
         WHERE workspace_id = @workspaceId AND id = @templatePackId`, { workspaceId: input.workspaceId, templatePackId: input.templatePackId });
            return row ? this.mapTemplatePackSummary(row) : null;
        }
        finally {
            workspaceDb.close();
        }
    }
    async upsertTemplatePack(input) {
        const workspace = await this.getWorkspace(input.workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            await this.ensureDefaultTemplatePacks(input.workspaceId, workspaceDb);
            const id = input.templatePackId ?? (0, node_crypto_1.randomUUID)();
            const now = new Date().toISOString();
            workspaceDb.run(`INSERT INTO template_packs (
          id, workspace_id, name, language, prompt_template, tone_rules, examples, active, updated_at, template_type, description, analysis_json
        ) VALUES (
          @id, @workspaceId, @name, @language, @promptTemplate, @toneRules, @examples, @active, @updatedAt, @templateType, @description, NULL
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          language = excluded.language,
          prompt_template = excluded.prompt_template,
          tone_rules = excluded.tone_rules,
          examples = excluded.examples,
          active = excluded.active,
          updated_at = excluded.updated_at,
          template_type = excluded.template_type,
          description = excluded.description,
          analysis_json = NULL`, {
                id,
                workspaceId: input.workspaceId,
                name: input.name.trim(),
                language: input.language.trim().toLowerCase(),
                promptTemplate: input.promptTemplate.trim(),
                toneRules: input.toneRules.trim(),
                examples: input.examples?.trim() || null,
                active: input.active === false ? 0 : 1,
                updatedAt: now,
                templateType: input.templateType,
                description: input.description?.trim() || null
            });
            const detail = await this.getTemplatePackDetail({ workspaceId: input.workspaceId, templatePackId: id });
            if (!detail) {
                throw new Error('Template pack not found after save');
            }
            return detail;
        }
        finally {
            workspaceDb.close();
        }
    }
    async deleteTemplatePack(input) {
        const workspace = await this.getWorkspace(input.workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const existing = workspaceDb.get(`SELECT id FROM template_packs WHERE workspace_id = @workspaceId AND id = @templatePackId`, { workspaceId: input.workspaceId, templatePackId: input.templatePackId });
            if (!existing) {
                throw new Error('Template pack not found');
            }
            workspaceDb.run(`DELETE FROM template_packs WHERE workspace_id = @workspaceId AND id = @templatePackId`, { workspaceId: input.workspaceId, templatePackId: input.templatePackId });
            return input;
        }
        finally {
            workspaceDb.close();
        }
    }
    async analyzeTemplatePack(input) {
        const workspace = await this.getWorkspace(input.workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const detail = await this.getTemplatePackDetail(input);
            if (!detail) {
                return null;
            }
            const analysis = buildTemplatePackAnalysis(detail);
            workspaceDb.run(`UPDATE template_packs
         SET analysis_json = @analysisJson, updated_at = @updatedAt
         WHERE workspace_id = @workspaceId AND id = @templatePackId`, {
                workspaceId: input.workspaceId,
                templatePackId: input.templatePackId,
                analysisJson: JSON.stringify(analysis),
                updatedAt: new Date().toISOString()
            });
            return this.getTemplatePackDetail(input);
        }
        finally {
            workspaceDb.close();
        }
    }
    async getOrCreateArticleAiSession(input) {
        const workspace = await this.getWorkspace(input.workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            await this.ensureDefaultTemplatePacks(input.workspaceId, workspaceDb);
            const target = await this.resolveArticleAiTarget(workspace.path, workspaceDb, input);
            const existing = workspaceDb.get(`SELECT id,
                workspace_id as workspaceId,
                locale_variant_id as localeVariantId,
                branch_id as branchId,
                target_type as targetType,
                current_revision_id as currentRevisionId,
                current_html as currentHtml,
                pending_html as pendingHtml,
                pending_summary as pendingSummary,
                pending_rationale as pendingRationale,
                pending_metadata_json as pendingMetadataJson,
                template_pack_id as templatePackId,
                runtime_session_id as runtimeSessionId,
                status,
                created_at as createdAtUtc,
                updated_at as updatedAtUtc
         FROM article_ai_sessions
         WHERE workspace_id = @workspaceId
           AND locale_variant_id = @localeVariantId
           AND COALESCE(branch_id, '') = COALESCE(@branchId, '')
         ORDER BY updated_at DESC
         LIMIT 1`, {
                workspaceId: input.workspaceId,
                localeVariantId: target.localeVariantId,
                branchId: target.branchId ?? null
            });
            const sessionRow = existing ?? await this.createArticleAiSessionRow(workspaceDb, target);
            return this.buildArticleAiSessionResponse(workspaceDb, target, sessionRow);
        }
        finally {
            workspaceDb.close();
        }
    }
    async submitArticleAiMessage(input, aiResult) {
        const workspace = await this.getWorkspace(input.workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const response = await this.getOrCreateArticleAiSession({
                workspaceId: input.workspaceId,
                localeVariantId: input.localeVariantId,
                branchId: input.branchId
            });
            const now = new Date().toISOString();
            const sessionId = response.session.id;
            await this.insertArticleAiMessage(workspaceDb, {
                id: (0, node_crypto_1.randomUUID)(),
                sessionId,
                workspaceId: input.workspaceId,
                role: shared_types_1.ArticleAiMessageRole.USER,
                messageKind: shared_types_1.ArticleAiMessageKind.CHAT,
                presetAction: input.presetAction ?? shared_types_1.ArticleAiPresetAction.FREEFORM,
                content: input.message.trim(),
                metadataJson: JSON.stringify({
                    targetLocale: input.targetLocale,
                    templatePackId: input.templatePackId
                }),
                createdAtUtc: now
            });
            await this.insertArticleAiMessage(workspaceDb, {
                id: (0, node_crypto_1.randomUUID)(),
                sessionId,
                workspaceId: input.workspaceId,
                role: shared_types_1.ArticleAiMessageRole.ASSISTANT,
                messageKind: shared_types_1.ArticleAiMessageKind.EDIT_RESULT,
                presetAction: input.presetAction ?? shared_types_1.ArticleAiPresetAction.FREEFORM,
                content: aiResult.summary,
                metadataJson: JSON.stringify({
                    rationale: aiResult.rationale,
                    runtimeSessionId: aiResult.runtimeSessionId,
                    rawResult: aiResult.rawResult
                }),
                createdAtUtc: now
            });
            workspaceDb.run(`UPDATE article_ai_sessions
         SET pending_html = @pendingHtml,
             pending_summary = @pendingSummary,
             pending_rationale = @pendingRationale,
             pending_metadata_json = @pendingMetadataJson,
             template_pack_id = COALESCE(@templatePackId, template_pack_id),
             runtime_session_id = COALESCE(@runtimeSessionId, runtime_session_id),
             status = @status,
             updated_at = @updatedAt
         WHERE id = @id`, {
                id: sessionId,
                pendingHtml: aiResult.updatedHtml,
                pendingSummary: aiResult.summary,
                pendingRationale: aiResult.rationale ?? null,
                pendingMetadataJson: JSON.stringify({
                    targetLocale: input.targetLocale,
                    presetAction: input.presetAction ?? shared_types_1.ArticleAiPresetAction.FREEFORM
                }),
                templatePackId: aiResult.templatePackId ?? input.templatePackId ?? null,
                runtimeSessionId: aiResult.runtimeSessionId ?? null,
                status: shared_types_1.ArticleAiSessionStatus.HAS_PENDING_EDIT,
                updatedAt: now
            });
            const refreshed = await this.getOrCreateArticleAiSession({
                workspaceId: input.workspaceId,
                localeVariantId: input.localeVariantId,
                branchId: input.branchId
            });
            return {
                ...refreshed,
                acceptedRuntimeSessionId: aiResult.runtimeSessionId
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async resetArticleAiSession(input) {
        const workspace = await this.getWorkspace(input.workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const session = workspaceDb.get(`SELECT id,
                workspace_id as workspaceId,
                locale_variant_id as localeVariantId,
                branch_id as branchId,
                target_type as targetType,
                current_revision_id as currentRevisionId,
                current_html as currentHtml,
                pending_html as pendingHtml,
                pending_summary as pendingSummary,
                pending_rationale as pendingRationale,
                pending_metadata_json as pendingMetadataJson,
                template_pack_id as templatePackId,
                runtime_session_id as runtimeSessionId,
                status,
                created_at as createdAtUtc,
                updated_at as updatedAtUtc
         FROM article_ai_sessions
         WHERE workspace_id = @workspaceId AND id = @sessionId`, { workspaceId: input.workspaceId, sessionId: input.sessionId });
            if (!session) {
                throw new Error('Article AI session not found');
            }
            workspaceDb.run(`DELETE FROM article_ai_messages WHERE workspace_id = @workspaceId AND session_id = @sessionId`, {
                workspaceId: input.workspaceId,
                sessionId: input.sessionId
            });
            workspaceDb.run(`UPDATE article_ai_sessions
         SET pending_html = NULL,
             pending_summary = NULL,
             pending_rationale = NULL,
             pending_metadata_json = NULL,
             runtime_session_id = NULL,
             status = @status,
             updated_at = @updatedAt
         WHERE workspace_id = @workspaceId AND id = @sessionId`, {
                workspaceId: input.workspaceId,
                sessionId: input.sessionId,
                status: shared_types_1.ArticleAiSessionStatus.IDLE,
                updatedAt: new Date().toISOString()
            });
            return this.getOrCreateArticleAiSession({
                workspaceId: input.workspaceId,
                localeVariantId: session.localeVariantId,
                branchId: session.branchId ?? undefined
            });
        }
        finally {
            workspaceDb.close();
        }
    }
    async rejectArticleAiEdit(input) {
        const workspace = await this.getWorkspace(input.workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const session = this.requireArticleAiSession(workspaceDb, input.workspaceId, input.sessionId);
            const now = new Date().toISOString();
            await this.insertArticleAiMessage(workspaceDb, {
                id: (0, node_crypto_1.randomUUID)(),
                sessionId: session.id,
                workspaceId: input.workspaceId,
                role: shared_types_1.ArticleAiMessageRole.SYSTEM,
                messageKind: shared_types_1.ArticleAiMessageKind.DECISION,
                presetAction: null,
                content: 'Rejected pending AI edit.',
                metadataJson: null,
                createdAtUtc: now
            });
            workspaceDb.run(`UPDATE article_ai_sessions
         SET pending_html = NULL,
             pending_summary = NULL,
             pending_rationale = NULL,
             pending_metadata_json = NULL,
             status = @status,
             updated_at = @updatedAt
         WHERE id = @id`, {
                id: session.id,
                status: shared_types_1.ArticleAiSessionStatus.IDLE,
                updatedAt: now
            });
            return this.getOrCreateArticleAiSession({
                workspaceId: input.workspaceId,
                localeVariantId: session.localeVariantId,
                branchId: session.branchId ?? undefined
            });
        }
        finally {
            workspaceDb.close();
        }
    }
    async acceptArticleAiEdit(input) {
        const workspace = await this.getWorkspace(input.workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        let acceptedBranchId;
        let acceptedRevisionId;
        try {
            const session = this.requireArticleAiSession(workspaceDb, input.workspaceId, input.sessionId);
            if (!session.pendingHtml) {
                throw new Error('No pending AI edit to accept');
            }
            const metadata = safeParseJson(session.pendingMetadataJson);
            if (session.branchId) {
                const saved = await this.saveDraftBranch({
                    workspaceId: input.workspaceId,
                    branchId: session.branchId,
                    html: session.pendingHtml,
                    commitMessage: session.pendingSummary ?? 'Accepted AI edit',
                    expectedHeadRevisionId: session.currentRevisionId,
                    editorState: {
                        source: 'article_ai'
                    }
                });
                acceptedBranchId = saved.branch.id;
                acceptedRevisionId = saved.branch.headRevisionId;
            }
            else {
                const family = workspaceDb.get(`SELECT af.title
           FROM article_families af
           JOIN locale_variants lv ON lv.family_id = af.id
           WHERE lv.id = @localeVariantId
           LIMIT 1`, { localeVariantId: session.localeVariantId });
                const created = await this.createDraftBranch({
                    workspaceId: input.workspaceId,
                    localeVariantId: session.localeVariantId,
                    name: `${family?.title ?? 'Article'} AI Draft`
                });
                const saved = await this.saveDraftBranch({
                    workspaceId: input.workspaceId,
                    branchId: created.branch.id,
                    html: session.pendingHtml,
                    commitMessage: session.pendingSummary ?? `Accepted AI edit${metadata?.targetLocale ? ` (${metadata.targetLocale})` : ''}`,
                    expectedHeadRevisionId: created.branch.headRevisionId,
                    editorState: {
                        source: 'article_ai'
                    }
                });
                acceptedBranchId = saved.branch.id;
                acceptedRevisionId = saved.branch.headRevisionId;
            }
        }
        finally {
            workspaceDb.close();
        }
        const workspaceDb2 = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const session = this.requireArticleAiSession(workspaceDb2, input.workspaceId, input.sessionId);
            const acceptedHtml = acceptedBranchId
                ? await this.getDraftBranchHtml(workspace.path, workspaceDb2, input.workspaceId, acceptedBranchId)
                : session.currentHtml;
            const acceptedRevision = acceptedRevisionId
                ? workspaceDb2.get(`SELECT id,
                    locale_variant_id as localeVariantId,
                    revision_type as revisionType,
                    branch_id as branchId,
                    workspace_id as workspaceId,
                    file_path as filePath,
                    content_hash as contentHash,
                    source_revision_id as sourceRevisionId,
                    revision_number as revisionNumber,
                    status,
                    created_at as createdAtUtc,
                    updated_at as updatedAtUtc
             FROM revisions WHERE id = @id`, { id: acceptedRevisionId })
                : null;
            const now = new Date().toISOString();
            await this.insertArticleAiMessage(workspaceDb2, {
                id: (0, node_crypto_1.randomUUID)(),
                sessionId: session.id,
                workspaceId: input.workspaceId,
                role: shared_types_1.ArticleAiMessageRole.SYSTEM,
                messageKind: shared_types_1.ArticleAiMessageKind.DECISION,
                presetAction: null,
                content: acceptedBranchId ? 'Accepted AI edit into draft branch.' : 'Accepted AI edit.',
                metadataJson: JSON.stringify({
                    branchId: acceptedBranchId,
                    revisionId: acceptedRevisionId
                }),
                createdAtUtc: now
            });
            workspaceDb2.run(`UPDATE article_ai_sessions
         SET branch_id = COALESCE(@branchId, branch_id),
             target_type = CASE WHEN @branchId IS NOT NULL THEN 'draft_branch' ELSE target_type END,
             current_revision_id = COALESCE(@currentRevisionId, current_revision_id),
             current_html = @currentHtml,
             pending_html = NULL,
             pending_summary = NULL,
             pending_rationale = NULL,
             pending_metadata_json = NULL,
             status = @status,
             updated_at = @updatedAt
         WHERE id = @id`, {
                id: session.id,
                branchId: acceptedBranchId ?? null,
                currentRevisionId: acceptedRevision?.id ?? null,
                currentHtml: acceptedHtml,
                status: shared_types_1.ArticleAiSessionStatus.IDLE,
                updatedAt: now
            });
            const refreshed = await this.getOrCreateArticleAiSession({
                workspaceId: input.workspaceId,
                localeVariantId: session.localeVariantId,
                branchId: acceptedBranchId ?? session.branchId ?? undefined
            });
            return {
                ...refreshed,
                acceptedBranchId,
                acceptedRevisionId
            };
        }
        finally {
            workspaceDb2.close();
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
            const variantMetadataChanged = locale !== existing.locale
                || status !== existing.status
                || (retiredAt ?? undefined) !== (existing.retiredAtUtc ?? undefined);
            if (variantMetadataChanged) {
                try {
                    this.markArticleRelationFamiliesStale(workspaceDb, payload.workspaceId, [existing.familyId]);
                }
                catch (error) {
                    logger_1.logger.warn('workspace-repository.updateLocaleVariant stale-mark failed', {
                        workspaceId: payload.workspaceId,
                        familyId: existing.familyId,
                        localeVariantId: payload.variantId,
                        message: error instanceof Error ? error.message : String(error)
                    });
                }
            }
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
            const affectedFamilies = workspaceDb.all(`SELECT DISTINCT af.id as familyId
         FROM locale_variants lv
         JOIN article_families af ON af.id = lv.family_id
         WHERE af.workspace_id = @workspaceId
           AND lv.locale = @locale`, { workspaceId, locale }).map((row) => row.familyId);
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
                if (affectedFamilies.length > 0) {
                    try {
                        this.markArticleRelationFamiliesStale(workspaceDb, workspaceId, affectedFamilies);
                    }
                    catch (error) {
                        logger_1.logger.warn('workspace-repository.reconcileSyncedLocaleVariants stale-mark failed', {
                            workspaceId,
                            locale,
                            message: error instanceof Error ? error.message : String(error)
                        });
                    }
                }
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
            if (affectedFamilies.length > 0) {
                try {
                    this.markArticleRelationFamiliesStale(workspaceDb, workspaceId, affectedFamilies);
                }
                catch (error) {
                    logger_1.logger.warn('workspace-repository.reconcileSyncedLocaleVariants stale-mark failed', {
                        workspaceId,
                        locale,
                        message: error instanceof Error ? error.message : String(error)
                    });
                }
            }
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
            const variant = workspaceDb.get(`SELECT id, family_id as familyId
         FROM locale_variants
         WHERE id = @variantId`, { variantId: payload.localeVariantId });
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
            if (payload.revisionType === shared_types_1.RevisionState.LIVE) {
                try {
                    this.markArticleRelationFamiliesStale(workspaceDb, payload.workspaceId, [variant.familyId]);
                }
                catch (error) {
                    logger_1.logger.warn('workspace-repository.createRevision stale-mark failed', {
                        workspaceId: payload.workspaceId,
                        familyId: variant.familyId,
                        localeVariantId: payload.localeVariantId,
                        revisionId: id,
                        message: error instanceof Error ? error.message : String(error)
                    });
                }
            }
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
            const variant = workspaceDb.get(`SELECT family_id as familyId
         FROM locale_variants
         WHERE id = @localeVariantId`, { localeVariantId: existing.localeVariantId });
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
            if (variant && (revisionType === shared_types_1.RevisionState.LIVE || existing.revisionType === shared_types_1.RevisionState.LIVE)) {
                try {
                    this.markArticleRelationFamiliesStale(workspaceDb, payload.workspaceId, [variant.familyId]);
                }
                catch (error) {
                    logger_1.logger.warn('workspace-repository.updateRevision stale-mark failed', {
                        workspaceId: payload.workspaceId,
                        familyId: variant.familyId,
                        localeVariantId: existing.localeVariantId,
                        revisionId: payload.revisionId,
                        message: error instanceof Error ? error.message : String(error)
                    });
                }
            }
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
            const existing = workspaceDb.get(`SELECT r.locale_variant_id as localeVariantId,
                r.revision_type as revisionType,
                lv.family_id as familyId
           FROM revisions r
           JOIN locale_variants lv ON lv.id = r.locale_variant_id
          WHERE r.id = @revisionId
            AND r.workspace_id = @workspaceId`, {
                revisionId,
                workspaceId
            });
            const removed = workspaceDb.run(`DELETE FROM revisions WHERE id = @revisionId AND workspace_id = @workspaceId`, {
                revisionId,
                workspaceId
            });
            if (removed.changes === 0) {
                throw new Error('Revision not found');
            }
            if (existing?.revisionType === shared_types_1.RevisionState.LIVE) {
                try {
                    this.markArticleRelationFamiliesStale(workspaceDb, workspaceId, [existing.familyId]);
                }
                catch (error) {
                    logger_1.logger.warn('workspace-repository.deleteRevision stale-mark failed', {
                        workspaceId,
                        familyId: existing.familyId,
                        localeVariantId: existing.localeVariantId,
                        revisionId,
                        message: error instanceof Error ? error.message : String(error)
                    });
                }
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
                    sectionId: family.sectionId ?? undefined,
                    sectionName: family.sectionId ?? undefined,
                    categoryId: family.categoryId ?? undefined,
                    categoryName: family.categoryId ?? undefined,
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
        const query = (payload.query ?? '').trim().toLowerCase();
        const localeVariantIdFilter = new Set(normalizeSearchIdList(payload.localeVariantIds));
        const familyIdFilter = new Set(normalizeSearchIdList(payload.familyIds));
        const revisionIdFilter = new Set(normalizeSearchIdList(payload.revisionIds));
        const hasIdFilters = localeVariantIdFilter.size > 0 || familyIdFilter.size > 0 || revisionIdFilter.size > 0;
        if (!query && !hasIdFilters) {
            return { workspaceId, total: 0, results: [] };
        }
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const scope = normalizeSearchScope(payload.scope);
            const includeArchived = Boolean(payload.includeArchived);
            const familyQueryParams = { q: query };
            const families = workspaceDb.all((hasIdFilters || !query)
                ? (includeArchived
                    ? `SELECT id, title, external_key, section_id, category_id, retired_at
               FROM article_families`
                    : `SELECT id, title, external_key, section_id, category_id, retired_at
               FROM article_families
               WHERE retired_at IS NULL`)
                : includeArchived
                    ? `SELECT id, title, external_key, section_id, category_id, retired_at
             FROM article_families
             WHERE lower(title) LIKE '%' || @q || '%' OR lower(external_key) LIKE '%' || @q || '%'`
                    : `SELECT id, title, external_key, section_id, category_id, retired_at
             FROM article_families
             WHERE retired_at IS NULL
               AND (lower(title) LIKE '%' || @q || '%' OR lower(external_key) LIKE '%' || @q || '%')`, familyQueryParams).filter((family) => !isProposalScopedExternalKey(family.external_key));
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
            const revisionsByVariant = new Map();
            for (const revision of revisions) {
                const normalizedRevision = {
                    revisionId: revision.id,
                    localeVariantId: revision.locale_variant_id,
                    revisionNumber: revision.revision_number,
                    revisionType: revision.revision_type,
                    updatedAtUtc: revision.updated_at,
                    filePath: revision.file_path
                };
                const existing = revisionsByVariant.get(normalizedRevision.localeVariantId) ?? [];
                existing.push(normalizedRevision);
                revisionsByVariant.set(normalizedRevision.localeVariantId, existing);
            }
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
                    const statusState = localeVariantStatus.get(variant.id);
                    const exactRevision = (revisionsByVariant.get(variant.id) ?? []).find((revision) => revisionIdFilter.has(revision.revisionId));
                    const revision = exactRevision ?? revisionByVariant.get(variant.id);
                    if (!statusState || !revision) {
                        continue;
                    }
                    const directIdMatch = familyIdFilter.has(family.id) || localeVariantIdFilter.has(variant.id) || Boolean(exactRevision);
                    if (!directIdMatch) {
                        if (payload.locales?.length && !payload.locales.includes(variant.locale)) {
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
                    }
                    const hasRevisionFile = await this.fileExists(resolveRevisionPath(workspace.path, revision.filePath));
                    let matchSource = {
                        context: directIdMatch ? 'metadata' : 'title',
                        snippet: directIdMatch
                            ? `familyId=${family.id}; localeVariantId=${variant.id}; revisionId=${revision.revisionId}`
                            : family.title,
                        scoreBoost: directIdMatch ? 3 : 1.5
                    };
                    let queryMatched = !query;
                    if (query) {
                        if (hasRevisionFile) {
                            const sourceHtml = await this.readRevisionSource(resolveRevisionPath(workspace.path, revision.filePath));
                            const match = findTextMatch(sourceHtml, query);
                            if (!match && family.external_key.toLowerCase().includes(query)) {
                                matchSource = {
                                    context: 'metadata',
                                    snippet: `external_key: ${family.external_key}`,
                                    scoreBoost: 0.9
                                };
                                queryMatched = true;
                            }
                            if (match) {
                                matchSource = match;
                                queryMatched = true;
                            }
                        }
                        if (!queryMatched && family.title.toLowerCase().includes(query)) {
                            matchSource = { context: 'title', snippet: family.title, scoreBoost: 1.5 };
                            queryMatched = true;
                        }
                    }
                    if (!directIdMatch && !queryMatched) {
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
                        score: Number((matchSource.scoreBoost / Math.max(1, (query.length / 3) || 1)).toFixed(3))
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
    async getArticleRelationsStatus(workspaceId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const indexStats = await this.loadArticleRelationIndexStats(workspace.path, workspaceId);
            const latestRun = workspaceDb.get(`SELECT id, workspace_id, status, source, triggered_by, agent_session_id, started_at, ended_at, summary_json,
                engine_version, indexed_document_count, stale_document_count, degraded_mode, thresholds_json
         FROM article_relation_runs
         WHERE workspace_id = @workspaceId
         ORDER BY started_at DESC
         LIMIT 1`, { workspaceId });
            const counts = workspaceDb.get(`SELECT
           COUNT(*) as totalActive,
           SUM(CASE WHEN origin = 'inferred' THEN 1 ELSE 0 END) as inferred,
           SUM(CASE WHEN origin = 'manual' THEN 1 ELSE 0 END) as manual
         FROM article_relations
         WHERE workspace_id = @workspaceId
           AND status = @status`, {
                workspaceId,
                status: shared_types_1.ArticleRelationStatus.ACTIVE
            });
            const indexCounts = this.loadArticleRelationIndexStateCounts(workspaceDb, workspaceId, this.loadArticleRelationEnabledLocales(workspaceDb, workspaceId));
            const summary = {
                totalActive: counts?.totalActive ?? 0,
                inferred: counts?.inferred ?? 0,
                manual: counts?.manual ?? 0,
                lastRefreshedAtUtc: latestRun?.ended_at ?? latestRun?.started_at,
                latestRunState: normalizeRelationRunStatus(latestRun?.status),
                engineVersion: latestRun?.engine_version ?? types_1.ARTICLE_RELATIONS_V2_LEGACY_ENGINE_VERSION,
                indexedDocumentCount: indexCounts.indexedDocumentCount ?? latestRun?.indexed_document_count ?? 0,
                staleDocumentCount: indexCounts.staleDocumentCount ?? latestRun?.stale_document_count ?? 0,
                degradedMode: Boolean(latestRun?.degraded_mode),
                indexStats
            };
            return {
                workspaceId,
                latestRun: latestRun
                    ? {
                        id: latestRun.id,
                        workspaceId: latestRun.workspace_id,
                        status: normalizeRelationRunStatus(latestRun.status) ?? 'failed',
                        source: normalizeRelationRunSource(latestRun.source),
                        triggeredBy: latestRun.triggered_by ?? undefined,
                        startedAtUtc: latestRun.started_at,
                        endedAtUtc: latestRun.ended_at ?? undefined,
                        agentSessionId: latestRun.agent_session_id ?? undefined,
                        engineVersion: latestRun.engine_version ?? types_1.ARTICLE_RELATIONS_V2_LEGACY_ENGINE_VERSION,
                        indexedDocumentCount: latestRun.indexed_document_count ?? 0,
                        staleDocumentCount: latestRun.stale_document_count ?? 0,
                        degradedMode: Boolean(latestRun.degraded_mode),
                        thresholdsUsed: safeParseJson(latestRun.thresholds_json) ?? undefined,
                        summary: safeParseJson(latestRun.summary_json) ?? undefined
                    }
                    : null,
                summary
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async listArticleRelations(workspaceId, payload) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const seedFamilyIds = await this.resolveRelationSeedFamilyIds(workspaceId, workspaceDb, payload);
            if (seedFamilyIds.length === 0) {
                return {
                    workspaceId,
                    seedFamilyIds: [],
                    total: 0,
                    relations: []
                };
            }
            const minScore = typeof payload.minScore === 'number' ? payload.minScore : 0;
            const limit = clampRelationLimit(payload.limit ?? 24);
            const includeEvidence = payload.includeEvidence !== false;
            const params = {
                workspaceId,
                activeStatus: shared_types_1.ArticleRelationStatus.ACTIVE,
                minScore
            };
            const placeholders = seedFamilyIds.map((familyId, index) => {
                const key = `seed${index}`;
                params[key] = familyId;
                return `@${key}`;
            }).join(', ');
            const rows = workspaceDb.all(`SELECT
           r.id,
           r.workspace_id as workspaceId,
           r.left_family_id as leftFamilyId,
           r.right_family_id as rightFamilyId,
           r.relation_type as relationType,
           r.direction as direction,
           r.strength_score as strengthScore,
           r.status as status,
           r.origin as origin,
           r.run_id as runId,
           r.created_at as createdAtUtc,
           r.updated_at as updatedAtUtc,
           left_f.title as leftTitle,
           left_f.external_key as leftExternalKey,
           right_f.title as rightTitle,
           right_f.external_key as rightExternalKey
         FROM article_relations r
         JOIN article_families left_f ON left_f.id = r.left_family_id
         JOIN article_families right_f ON right_f.id = r.right_family_id
         WHERE r.workspace_id = @workspaceId
           AND r.status = @activeStatus
           AND r.strength_score >= @minScore
           AND lower(left_f.external_key) NOT LIKE @proposalScopedPattern
           AND lower(right_f.external_key) NOT LIKE @proposalScopedPattern
           AND (r.left_family_id IN (${placeholders}) OR r.right_family_id IN (${placeholders}))
         ORDER BY r.strength_score DESC, r.updated_at DESC
         LIMIT ${limit}`, {
                ...params,
                proposalScopedPattern: `${PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX}%`
            });
            const relations = rows.map((row) => this.mapArticleRelationRow(row, workspaceDb, includeEvidence));
            return {
                workspaceId,
                seedFamilyIds,
                total: relations.length,
                relations
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async upsertManualArticleRelation(payload) {
        const workspace = await this.getWorkspace(payload.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const now = new Date().toISOString();
            const pair = normalizeFamilyPair(payload.sourceFamilyId, payload.targetFamilyId);
            const direction = payload.direction ?? shared_types_1.ArticleRelationDirection.BIDIRECTIONAL;
            const existing = workspaceDb.get(`SELECT id
         FROM article_relations
         WHERE workspace_id = @workspaceId
           AND left_family_id = @leftFamilyId
           AND right_family_id = @rightFamilyId
           AND relation_type = @relationType
           AND origin = @origin`, {
                workspaceId: payload.workspaceId,
                leftFamilyId: pair.leftFamilyId,
                rightFamilyId: pair.rightFamilyId,
                relationType: payload.relationType,
                origin: shared_types_1.ArticleRelationOrigin.MANUAL
            });
            const relationId = existing?.id ?? (0, node_crypto_1.randomUUID)();
            workspaceDb.exec('BEGIN IMMEDIATE');
            try {
                workspaceDb.run(`INSERT INTO article_relations (
             id, workspace_id, left_family_id, right_family_id, relation_type, direction, strength_score, status, origin, run_id, created_at, updated_at
           ) VALUES (
             @id, @workspaceId, @leftFamilyId, @rightFamilyId, @relationType, @direction, @strengthScore, @status, @origin, NULL, @createdAt, @updatedAt
           )
           ON CONFLICT(id) DO UPDATE SET
             relation_type = excluded.relation_type,
             direction = excluded.direction,
             strength_score = excluded.strength_score,
             status = excluded.status,
             updated_at = excluded.updated_at`, {
                    id: relationId,
                    workspaceId: payload.workspaceId,
                    leftFamilyId: pair.leftFamilyId,
                    rightFamilyId: pair.rightFamilyId,
                    relationType: payload.relationType,
                    direction,
                    strengthScore: 1,
                    status: shared_types_1.ArticleRelationStatus.ACTIVE,
                    origin: shared_types_1.ArticleRelationOrigin.MANUAL,
                    createdAt: now,
                    updatedAt: now
                });
                workspaceDb.run(`DELETE FROM article_relation_overrides
           WHERE workspace_id = @workspaceId
             AND left_family_id = @leftFamilyId
             AND right_family_id = @rightFamilyId
             AND override_type = 'force_remove'`, {
                    workspaceId: payload.workspaceId,
                    leftFamilyId: pair.leftFamilyId,
                    rightFamilyId: pair.rightFamilyId
                });
                if (payload.note?.trim()) {
                    workspaceDb.run(`DELETE FROM article_relation_evidence
             WHERE relation_id = @relationId
               AND evidence_type = @evidenceType`, {
                        relationId,
                        evidenceType: shared_types_1.ArticleRelationEvidenceType.MANUAL_NOTE
                    });
                    workspaceDb.run(`INSERT INTO article_relation_evidence (
               id, relation_id, evidence_type, source_ref, snippet, weight, metadata_json
             ) VALUES (
               @id, @relationId, @evidenceType, NULL, @snippet, @weight, NULL
             )`, {
                        id: (0, node_crypto_1.randomUUID)(),
                        relationId,
                        evidenceType: shared_types_1.ArticleRelationEvidenceType.MANUAL_NOTE,
                        snippet: payload.note.trim(),
                        weight: 1
                    });
                }
                this.insertArticleRelationFeedback(workspaceDb, {
                    workspaceId: payload.workspaceId,
                    leftFamilyId: pair.leftFamilyId,
                    rightFamilyId: pair.rightFamilyId,
                    feedbackType: shared_types_1.ArticleRelationFeedbackType.ADD,
                    source: shared_types_1.ArticleRelationFeedbackSource.MANUAL_RELATION,
                    note: payload.note
                }, now);
                workspaceDb.exec('COMMIT');
            }
            catch (error) {
                workspaceDb.exec('ROLLBACK');
                throw error;
            }
            try {
                this.markArticleRelationNeighborhoodStale(workspaceDb, payload.workspaceId, [
                    pair.leftFamilyId,
                    pair.rightFamilyId
                ]);
            }
            catch (error) {
                logger_1.logger.warn('workspace-repository.upsertManualArticleRelation stale-mark failed', {
                    workspaceId: payload.workspaceId,
                    leftFamilyId: pair.leftFamilyId,
                    rightFamilyId: pair.rightFamilyId,
                    message: error instanceof Error ? error.message : String(error)
                });
            }
            const row = workspaceDb.get(`SELECT
           r.id,
           r.workspace_id as workspaceId,
           r.left_family_id as leftFamilyId,
           r.right_family_id as rightFamilyId,
           r.relation_type as relationType,
           r.direction as direction,
           r.strength_score as strengthScore,
           r.status as status,
           r.origin as origin,
           r.run_id as runId,
           r.created_at as createdAtUtc,
           r.updated_at as updatedAtUtc,
           left_f.title as leftTitle,
           left_f.external_key as leftExternalKey,
           right_f.title as rightTitle,
           right_f.external_key as rightExternalKey
         FROM article_relations r
         JOIN article_families left_f ON left_f.id = r.left_family_id
         JOIN article_families right_f ON right_f.id = r.right_family_id
         WHERE r.id = @id`, { id: relationId });
            if (!row) {
                throw new Error('Article relation not found');
            }
            return this.mapArticleRelationRow(row, workspaceDb, true);
        }
        finally {
            workspaceDb.close();
        }
    }
    async deleteArticleRelation(payload) {
        const workspace = await this.getWorkspace(payload.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            let pair = null;
            let relationId = payload.relationId;
            let relationOrigin = null;
            if (payload.relationId) {
                const relation = workspaceDb.get(`SELECT id, left_family_id as leftFamilyId, right_family_id as rightFamilyId, origin
           FROM article_relations
           WHERE id = @id AND workspace_id = @workspaceId`, {
                    id: payload.relationId,
                    workspaceId: payload.workspaceId
                });
                if (relation) {
                    pair = {
                        leftFamilyId: relation.leftFamilyId,
                        rightFamilyId: relation.rightFamilyId
                    };
                    relationOrigin = relation.origin;
                }
            }
            else if (payload.sourceFamilyId && payload.targetFamilyId) {
                pair = normalizeFamilyPair(payload.sourceFamilyId, payload.targetFamilyId);
            }
            if (!pair) {
                throw new Error('Article relation not found');
            }
            const now = new Date().toISOString();
            workspaceDb.exec('BEGIN IMMEDIATE');
            try {
                if (relationId && relationOrigin === shared_types_1.ArticleRelationOrigin.MANUAL) {
                    workspaceDb.run(`DELETE FROM article_relation_evidence WHERE relation_id = @relationId`, { relationId });
                    workspaceDb.run(`DELETE FROM article_relations WHERE id = @relationId`, { relationId });
                }
                else if (relationId) {
                    workspaceDb.run(`UPDATE article_relations
             SET status = @status, updated_at = @updatedAt
             WHERE id = @relationId`, {
                        relationId,
                        status: shared_types_1.ArticleRelationStatus.SUPPRESSED,
                        updatedAt: now
                    });
                }
                workspaceDb.run(`INSERT INTO article_relation_overrides (
             id, workspace_id, left_family_id, right_family_id, override_type, relation_type, note, created_by, created_at, updated_at
           ) VALUES (
             @id, @workspaceId, @leftFamilyId, @rightFamilyId, 'force_remove', '', NULL, 'user', @createdAt, @updatedAt
           )
           ON CONFLICT(workspace_id, left_family_id, right_family_id, override_type, relation_type) DO UPDATE SET
             updated_at = excluded.updated_at`, {
                    id: (0, node_crypto_1.randomUUID)(),
                    workspaceId: payload.workspaceId,
                    leftFamilyId: pair.leftFamilyId,
                    rightFamilyId: pair.rightFamilyId,
                    createdAt: now,
                    updatedAt: now
                });
                this.insertArticleRelationFeedback(workspaceDb, {
                    workspaceId: payload.workspaceId,
                    leftFamilyId: pair.leftFamilyId,
                    rightFamilyId: pair.rightFamilyId,
                    feedbackType: shared_types_1.ArticleRelationFeedbackType.REMOVE,
                    source: shared_types_1.ArticleRelationFeedbackSource.MANUAL_RELATION
                }, now);
                workspaceDb.exec('COMMIT');
            }
            catch (error) {
                workspaceDb.exec('ROLLBACK');
                throw error;
            }
            try {
                this.markArticleRelationNeighborhoodStale(workspaceDb, payload.workspaceId, [
                    pair.leftFamilyId,
                    pair.rightFamilyId
                ]);
            }
            catch (error) {
                logger_1.logger.warn('workspace-repository.deleteArticleRelation stale-mark failed', {
                    workspaceId: payload.workspaceId,
                    leftFamilyId: pair.leftFamilyId,
                    rightFamilyId: pair.rightFamilyId,
                    message: error instanceof Error ? error.message : String(error)
                });
            }
            return {
                workspaceId: payload.workspaceId,
                relationId
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async refreshArticleRelations(workspaceId, options) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        const runId = (0, node_crypto_1.randomUUID)();
        const startedAtUtc = new Date().toISOString();
        const source = options?.source ?? 'manual_refresh';
        const triggeredBy = options?.triggeredBy ?? 'user';
        const limitPerArticle = clampRelationLimit(options?.limitPerArticle ?? 12);
        const thresholdsUsed = {
            limitPerArticle
        };
        let indexedDocumentCount = 0;
        let staleDocumentCount = 0;
        let degradedMode = false;
        let indexDb;
        try {
            workspaceDb.run(`INSERT INTO article_relation_runs (
           id, workspace_id, status, source, triggered_by, started_at,
           engine_version, indexed_document_count, stale_document_count, degraded_mode, thresholds_json
         ) VALUES (
           @id, @workspaceId, @status, @source, @triggeredBy, @startedAt,
           @engineVersion, @indexedDocumentCount, @staleDocumentCount, @degradedMode, @thresholdsJson
         )`, {
                id: runId,
                workspaceId,
                status: 'running',
                source,
                triggeredBy,
                startedAt: startedAtUtc,
                engineVersion: types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION,
                indexedDocumentCount: 0,
                staleDocumentCount: 0,
                degradedMode: 0,
                thresholdsJson: JSON.stringify(thresholdsUsed)
            });
            const preparedIndex = await this.prepareArticleRelationCoverageIndexForRefresh({
                workspaceId,
                workspacePath: workspace.path,
                enabledLocales: workspace.enabledLocales,
                workspaceDb
            });
            indexedDocumentCount = preparedIndex.indexedDocumentCount;
            staleDocumentCount = preparedIndex.staleDocumentCount;
            degradedMode = preparedIndex.degradedMode;
            if (preparedIndex.seedFamilyIds.length > 0) {
                indexDb = this.getArticleRelationsV2IndexDb(workspace.path).open();
            }
            const summary = this.articleRelationsV2RelationOrchestrator.refreshRelations({
                workspaceId,
                runId,
                startedAtUtc,
                workspaceDb,
                indexDb,
                seedFamilyIds: preparedIndex.seedFamilyIds,
                limitPerArticle,
                indexedDocumentCount,
                staleDocumentCount,
                degradedMode
            });
            const endedAtUtc = new Date().toISOString();
            workspaceDb.run(`UPDATE article_relation_runs
         SET status = 'complete',
             ended_at = @endedAt,
             summary_json = @summaryJson,
             engine_version = @engineVersion,
             indexed_document_count = @indexedDocumentCount,
             stale_document_count = @staleDocumentCount,
             degraded_mode = @degradedMode,
             thresholds_json = @thresholdsJson
         WHERE id = @id`, {
                id: runId,
                endedAt: endedAtUtc,
                summaryJson: JSON.stringify(summary),
                engineVersion: types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION,
                indexedDocumentCount: summary.indexedDocumentCount ?? indexedDocumentCount,
                staleDocumentCount: summary.staleDocumentCount ?? staleDocumentCount,
                degradedMode: summary.degradedMode ? 1 : 0,
                thresholdsJson: JSON.stringify(summary.thresholdsUsed ?? thresholdsUsed)
            });
            return {
                id: runId,
                workspaceId,
                status: 'complete',
                source,
                triggeredBy,
                startedAtUtc,
                endedAtUtc,
                engineVersion: types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION,
                indexedDocumentCount: summary.indexedDocumentCount ?? indexedDocumentCount,
                staleDocumentCount: summary.staleDocumentCount ?? staleDocumentCount,
                degradedMode: summary.degradedMode ?? degradedMode,
                thresholdsUsed: summary.thresholdsUsed ?? thresholdsUsed,
                summary
            };
        }
        catch (error) {
            workspaceDb.run(`UPDATE article_relation_runs
         SET status = 'failed',
             ended_at = @endedAt,
             summary_json = @summaryJson,
             engine_version = @engineVersion,
             indexed_document_count = @indexedDocumentCount,
             stale_document_count = @staleDocumentCount,
             degraded_mode = @degradedMode,
             thresholds_json = @thresholdsJson
         WHERE id = @id`, {
                id: runId,
                endedAt: new Date().toISOString(),
                summaryJson: JSON.stringify({
                    totalArticles: 0,
                    candidatePairs: 0,
                    inferredRelations: 0,
                    manualRelations: 0,
                    suppressedRelations: 0,
                    engineVersion: types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION,
                    indexedDocumentCount,
                    staleDocumentCount,
                    degradedMode,
                    thresholdsUsed,
                    error: error instanceof Error ? error.message : String(error)
                }),
                engineVersion: types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION,
                indexedDocumentCount,
                staleDocumentCount,
                degradedMode: degradedMode ? 1 : 0,
                thresholdsJson: JSON.stringify(thresholdsUsed)
            });
            throw error;
        }
        finally {
            indexDb?.close();
            workspaceDb.close();
        }
    }
    async exportArticleRelationCorpus(workspaceId, payload = {}) {
        const workspace = await this.getWorkspace(workspaceId);
        const settings = await this.getWorkspaceSettings(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            return await this.exportArticleRelationCorpusWithDb({
                workspaceId,
                workspacePath: workspace.path,
                enabledLocales: settings.enabledLocales,
                workspaceDb,
                payload
            });
        }
        finally {
            workspaceDb.close();
        }
    }
    async rebuildArticleRelationCoverageIndex(workspaceId, options) {
        const workspace = await this.getWorkspace(workspaceId);
        const settings = await this.getWorkspaceSettings(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            return await this.rebuildArticleRelationCoverageIndexWithDb({
                workspaceId,
                workspacePath: workspace.path,
                enabledLocales: settings.enabledLocales,
                workspaceDb,
                forceFullRebuild: options?.forceFullRebuild
            });
        }
        finally {
            workspaceDb.close();
        }
    }
    async queryArticleRelationCoverage(request) {
        const hasSignals = Boolean(request.query?.trim())
            || (request.seedFamilyIds?.some((value) => value.trim()) ?? false)
            || (request.batchQueries?.some((value) => value.trim()) ?? false);
        if (!hasSignals) {
            return {
                workspaceId: request.workspaceId,
                engineVersion: types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION,
                results: []
            };
        }
        const workspace = await this.getWorkspace(request.workspaceId);
        const settings = await this.getWorkspaceSettings(request.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const freshness = await this.evaluateArticleRelationCoverageIndexFreshness({
                workspaceId: request.workspaceId,
                workspacePath: workspace.path,
                enabledLocales: settings.enabledLocales,
                workspaceDb
            });
            if (freshness.sourceStates.length === 0) {
                return {
                    workspaceId: request.workspaceId,
                    engineVersion: types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION,
                    results: []
                };
            }
            if (freshness.requiresRebuild) {
                try {
                    await this.rebuildArticleRelationCoverageIndexWithDb({
                        workspaceId: request.workspaceId,
                        workspacePath: workspace.path,
                        enabledLocales: settings.enabledLocales,
                        workspaceDb,
                        forceFullRebuild: freshness.reason === 'engine_version_mismatch'
                            || freshness.reason === 'missing_index_file'
                            || freshness.reason === 'index_open_failed'
                    });
                }
                catch (error) {
                    if (!freshness.hasUsableIndex) {
                        throw error;
                    }
                    logger_1.logger.warn('workspace-repository.queryArticleRelationCoverage using stale index fallback', {
                        workspaceId: request.workspaceId,
                        reason: freshness.reason,
                        message: error instanceof Error ? error.message : String(error)
                    });
                }
            }
            const indexDb = this.getArticleRelationsV2IndexDb(workspace.path).open();
            try {
                return this.articleRelationsV2QueryService.queryCoverage({
                    workspaceDb,
                    indexDb,
                    request
                });
            }
            finally {
                indexDb.close();
            }
        }
        finally {
            workspaceDb.close();
        }
    }
    async queryArticleRelationGraph(request) {
        const workspace = await this.getWorkspace(request.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const minScore = typeof request.minScore === 'number' ? Math.max(0, request.minScore) : 0;
            const includeSuppressed = request.includeSuppressed === true;
            const limitNodes = clampGraphLimit(request.limitNodes);
            const where = [
                'r.workspace_id = @workspaceId',
                'r.strength_score >= @minScore',
                'lower(left_f.external_key) NOT LIKE @proposalScopedPattern',
                'lower(right_f.external_key) NOT LIKE @proposalScopedPattern'
            ];
            const params = {
                workspaceId: request.workspaceId,
                minScore,
                proposalScopedPattern: `${PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX}%`,
                activeStatus: shared_types_1.ArticleRelationStatus.ACTIVE,
                suppressedStatus: shared_types_1.ArticleRelationStatus.SUPPRESSED
            };
            if (includeSuppressed) {
                where.push('(r.status = @activeStatus OR r.status = @suppressedStatus)');
            }
            else {
                where.push('r.status = @activeStatus');
            }
            if (request.familyId) {
                where.push('(r.left_family_id = @familyId OR r.right_family_id = @familyId)');
                params.familyId = request.familyId;
            }
            if (request.sectionId) {
                where.push('left_f.section_id = @sectionId');
                where.push('right_f.section_id = @sectionId');
                params.sectionId = request.sectionId;
            }
            if (request.categoryId) {
                where.push('left_f.category_id = @categoryId');
                where.push('right_f.category_id = @categoryId');
                params.categoryId = request.categoryId;
            }
            const rows = workspaceDb.all(`SELECT
           r.id,
           r.workspace_id as workspaceId,
           r.left_family_id as leftFamilyId,
           r.right_family_id as rightFamilyId,
           r.relation_type as relationType,
           r.direction as direction,
           r.strength_score as strengthScore,
           r.status as status,
           r.origin as origin,
           r.run_id as runId,
           r.created_at as createdAtUtc,
           r.updated_at as updatedAtUtc,
           left_f.title as leftTitle,
           left_f.external_key as leftExternalKey,
           right_f.title as rightTitle,
           right_f.external_key as rightExternalKey
         FROM article_relations r
         JOIN article_families left_f ON left_f.id = r.left_family_id
         JOIN article_families right_f ON right_f.id = r.right_family_id
         WHERE ${where.join('\n           AND ')}
         ORDER BY r.strength_score DESC, r.updated_at DESC
         LIMIT ${Math.max(limitNodes * 8, 48)}`, params);
            const relationRecords = rows.map((row) => this.mapArticleRelationRow(row, workspaceDb, true));
            const limitedRelations = limitArticleRelationGraphEdges(relationRecords, limitNodes, request.familyId);
            const familyIds = new Set();
            for (const relation of limitedRelations) {
                familyIds.add(relation.sourceFamily.id);
                familyIds.add(relation.targetFamily.id);
            }
            if (request.familyId) {
                familyIds.add(request.familyId);
            }
            const nodeRows = familyIds.size > 0
                ? workspaceDb.all(`SELECT id as familyId,
                    title,
                    external_key as externalKey,
                    section_id as sectionId,
                    category_id as categoryId
               FROM article_families
              WHERE id IN (${buildRelationCoverageInClause('family', Array.from(familyIds), params)})`, params)
                : [];
            return {
                workspaceId: request.workspaceId,
                nodes: nodeRows.map((row) => ({
                    familyId: row.familyId,
                    title: row.title,
                    externalKey: row.externalKey ?? undefined,
                    sectionId: row.sectionId ?? undefined,
                    categoryId: row.categoryId ?? undefined
                })),
                edges: limitedRelations.map((relation) => ({
                    relationId: relation.id,
                    leftFamilyId: relation.sourceFamily.id,
                    rightFamilyId: relation.targetFamily.id,
                    relationType: relation.relationType,
                    origin: relation.origin,
                    status: relation.status,
                    strengthScore: relation.strengthScore,
                    evidence: relation.evidence
                }))
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getArticleRelationFeatureMapSummary(request) {
        return this.articleRelationsV2FeatureMapService.getFeatureMapSummary(request);
    }
    async getArticleRelationFeatureScope(request) {
        return this.articleRelationsV2FeatureMapService.getFeatureScope(request);
    }
    async getArticleRelationNeighborhood(request) {
        return this.articleRelationsV2FeatureMapService.getNeighborhood(request);
    }
    async recordArticleRelationFeedback(payload) {
        const workspace = await this.getWorkspace(payload.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const now = new Date().toISOString();
            const pair = normalizeFamilyPair(payload.leftFamilyId, payload.rightFamilyId);
            const record = this.insertArticleRelationFeedback(workspaceDb, {
                workspaceId: payload.workspaceId,
                leftFamilyId: pair.leftFamilyId,
                rightFamilyId: pair.rightFamilyId,
                feedbackType: payload.feedbackType,
                source: payload.source ?? shared_types_1.ArticleRelationFeedbackSource.UI,
                note: payload.note
            }, now);
            if (shouldReevaluateFromRelationFeedback(payload.feedbackType)) {
                try {
                    this.markArticleRelationNeighborhoodStale(workspaceDb, payload.workspaceId, [
                        pair.leftFamilyId,
                        pair.rightFamilyId
                    ]);
                }
                catch (error) {
                    logger_1.logger.warn('workspace-repository.recordArticleRelationFeedback stale-mark failed', {
                        workspaceId: payload.workspaceId,
                        leftFamilyId: pair.leftFamilyId,
                        rightFamilyId: pair.rightFamilyId,
                        feedbackType: payload.feedbackType,
                        message: error instanceof Error ? error.message : String(error)
                    });
                }
            }
            return record;
        }
        finally {
            workspaceDb.close();
        }
    }
    async exportArticleRelationCorpusWithDb(input) {
        try {
            return await this.articleRelationsV2ExportService.exportDocuments({
                workspaceId: input.workspaceId,
                familyIds: input.payload.familyIds,
                localeVariantIds: input.payload.localeVariantIds,
                locales: input.payload.locales,
                workspacePath: input.workspacePath,
                enabledLocales: input.enabledLocales,
                workspaceDb: input.workspaceDb
            });
        }
        catch (error) {
            if (error instanceof export_service_1.ArticleRelationsV2ExportDocumentError) {
                this.recordArticleRelationExportError(input.workspaceDb, input.workspaceId, error);
            }
            throw error;
        }
    }
    async rebuildArticleRelationCoverageIndexWithDb(input) {
        const initialExport = await this.exportArticleRelationCorpusWithDb({
            workspaceId: input.workspaceId,
            workspacePath: input.workspacePath,
            enabledLocales: input.enabledLocales,
            workspaceDb: input.workspaceDb,
            payload: {}
        });
        const builder = new index_builder_1.ArticleRelationsV2IndexBuilder(this.getArticleRelationsV2IndexDb(input.workspacePath));
        builder.rebuild({
            workspaceId: input.workspaceId,
            workspaceDb: input.workspaceDb,
            documents: initialExport.documents,
            forceFullRebuild: input.forceFullRebuild
        });
        const inferenceIndexDb = this.getArticleRelationsV2IndexDb(input.workspacePath).open();
        try {
            await this.reconcileEffectiveArticleTaxonomyPlacements(input.workspaceId, {
                familyIds: Array.from(new Set(initialExport.documents.map((document) => document.familyId))),
                allowInference: true,
                indexDb: inferenceIndexDb
            });
        }
        finally {
            inferenceIndexDb.close();
        }
        const finalExport = await this.exportArticleRelationCorpusWithDb({
            workspaceId: input.workspaceId,
            workspacePath: input.workspacePath,
            enabledLocales: input.enabledLocales,
            workspaceDb: input.workspaceDb,
            payload: {}
        });
        return builder.rebuild({
            workspaceId: input.workspaceId,
            workspaceDb: input.workspaceDb,
            documents: finalExport.documents,
            forceFullRebuild: input.forceFullRebuild
        });
    }
    async evaluateArticleRelationCoverageIndexFreshness(input) {
        const rawSourceStates = this.loadArticleRelationCoverageSourceStates(input.workspaceId, input.enabledLocales, input.workspaceDb);
        if (rawSourceStates.length === 0) {
            return {
                sourceStates: rawSourceStates,
                requiresRebuild: false,
                hasUsableIndex: false,
                reason: 'no_live_documents'
            };
        }
        const indexDbPath = this.getArticleRelationsV2IndexDbPath(input.workspacePath);
        if (!(await this.fileExists(indexDbPath))) {
            return {
                sourceStates: rawSourceStates,
                requiresRebuild: true,
                hasUsableIndex: false,
                reason: 'missing_index_file'
            };
        }
        let derivedStates = [];
        let derivedDocumentCount = 0;
        let derivedEngineVersion = types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION;
        try {
            const indexDbRef = this.getArticleRelationsV2IndexDb(input.workspacePath);
            const indexDb = indexDbRef.open();
            try {
                const stats = indexDbRef.getStats(indexDb, input.workspaceId);
                derivedStates = indexDbRef.listDocumentStates(indexDb);
                derivedDocumentCount = stats.documentCount;
                derivedEngineVersion = stats.engineVersion;
            }
            finally {
                indexDb.close();
            }
        }
        catch (error) {
            logger_1.logger.warn('workspace-repository.evaluateArticleRelationCoverageIndexFreshness index open failed', {
                workspaceId: input.workspaceId,
                message: error instanceof Error ? error.message : String(error)
            });
            return {
                sourceStates: rawSourceStates,
                requiresRebuild: true,
                hasUsableIndex: false,
                reason: 'index_open_failed'
            };
        }
        if (derivedEngineVersion !== types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION) {
            return {
                sourceStates: rawSourceStates,
                requiresRebuild: true,
                hasUsableIndex: false,
                reason: 'engine_version_mismatch'
            };
        }
        const mainIndexStates = input.workspaceDb.all(`SELECT locale_variant_id as localeVariantId,
              family_id as familyId,
              revision_id as revisionId,
              content_hash as contentHash,
              engine_version as engineVersion,
              status as status
       FROM article_relation_index_state
       WHERE workspace_id = @workspaceId`, { workspaceId: input.workspaceId });
        const sourceByLocaleVariant = new Map(rawSourceStates.map((row) => [row.localeVariantId, row]));
        const derivedByLocaleVariant = new Map(derivedStates.map((row) => [row.localeVariantId, row]));
        const mainByLocaleVariant = new Map(mainIndexStates.map((row) => [row.localeVariantId, row]));
        for (const sourceState of rawSourceStates) {
            const derivedState = derivedByLocaleVariant.get(sourceState.localeVariantId);
            if (!derivedState) {
                return {
                    sourceStates: rawSourceStates,
                    requiresRebuild: true,
                    hasUsableIndex: false,
                    reason: 'missing_derived_document'
                };
            }
            if (derivedState.familyId !== sourceState.familyId || derivedState.revisionId !== sourceState.revisionId) {
                return {
                    sourceStates: rawSourceStates,
                    requiresRebuild: true,
                    hasUsableIndex: false,
                    reason: 'derived_document_mismatch'
                };
            }
        }
        for (const derivedState of derivedStates) {
            if (!sourceByLocaleVariant.has(derivedState.localeVariantId)) {
                return {
                    sourceStates: rawSourceStates,
                    requiresRebuild: true,
                    hasUsableIndex: false,
                    reason: 'orphaned_derived_document'
                };
            }
        }
        // Once source and derived documents align exactly, the index is complete enough to answer
        // coverage queries even if workspace metadata repair later fails.
        const hasUsableIndex = true;
        for (const mainState of mainIndexStates) {
            if (!sourceByLocaleVariant.has(mainState.localeVariantId)) {
                return {
                    sourceStates: rawSourceStates,
                    requiresRebuild: true,
                    hasUsableIndex,
                    reason: 'orphaned_main_index_state'
                };
            }
        }
        if (derivedDocumentCount !== rawSourceStates.length || derivedDocumentCount !== derivedStates.length) {
            return {
                sourceStates: rawSourceStates,
                requiresRebuild: true,
                hasUsableIndex,
                reason: 'index_metadata_count_mismatch'
            };
        }
        for (const sourceState of rawSourceStates) {
            const derivedState = derivedByLocaleVariant.get(sourceState.localeVariantId);
            if (!derivedState) {
                continue;
            }
            const mainState = mainByLocaleVariant.get(sourceState.localeVariantId);
            if (!mainState) {
                return {
                    sourceStates: rawSourceStates,
                    requiresRebuild: true,
                    hasUsableIndex,
                    reason: 'missing_main_index_state'
                };
            }
            if (mainState.status !== shared_types_1.ArticleRelationIndexStateStatus.INDEXED) {
                return {
                    sourceStates: rawSourceStates,
                    requiresRebuild: true,
                    hasUsableIndex,
                    reason: 'main_index_state_not_indexed'
                };
            }
            if (mainState.familyId !== sourceState.familyId
                || mainState.revisionId !== sourceState.revisionId
                || mainState.engineVersion !== types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION
                || mainState.contentHash !== derivedState.contentHash) {
                return {
                    sourceStates: rawSourceStates,
                    requiresRebuild: true,
                    hasUsableIndex,
                    reason: 'main_index_state_mismatch'
                };
            }
        }
        let exportResponse;
        try {
            exportResponse = await this.exportArticleRelationCorpusWithDb({
                workspaceId: input.workspaceId,
                workspacePath: input.workspacePath,
                enabledLocales: input.enabledLocales,
                workspaceDb: input.workspaceDb,
                payload: {}
            });
        }
        catch (error) {
            if (error instanceof export_service_1.ArticleRelationsV2ExportDocumentError) {
                return {
                    sourceStates: rawSourceStates,
                    requiresRebuild: true,
                    hasUsableIndex,
                    reason: 'export_validation_failed'
                };
            }
            throw error;
        }
        const sourceStates = exportResponse.documents.map((document) => ({
            familyId: document.familyId,
            localeVariantId: document.localeVariantId,
            revisionId: document.revisionId,
            contentHash: document.contentHash
        }));
        const exportedByLocaleVariant = new Map(sourceStates.map((row) => [row.localeVariantId, row]));
        if (sourceStates.length !== derivedStates.length || sourceStates.length !== rawSourceStates.length) {
            return {
                sourceStates,
                requiresRebuild: true,
                hasUsableIndex,
                reason: 'exported_document_count_mismatch'
            };
        }
        for (const sourceState of sourceStates) {
            const derivedState = derivedByLocaleVariant.get(sourceState.localeVariantId);
            const mainState = mainByLocaleVariant.get(sourceState.localeVariantId);
            if (!derivedState || !mainState) {
                return {
                    sourceStates,
                    requiresRebuild: true,
                    hasUsableIndex,
                    reason: 'exported_document_missing'
                };
            }
            if (derivedState.familyId !== sourceState.familyId
                || derivedState.revisionId !== sourceState.revisionId
                || derivedState.contentHash !== sourceState.contentHash) {
                return {
                    sourceStates,
                    requiresRebuild: true,
                    hasUsableIndex,
                    reason: 'exported_document_mismatch'
                };
            }
            if (mainState.contentHash !== sourceState.contentHash) {
                return {
                    sourceStates,
                    requiresRebuild: true,
                    hasUsableIndex,
                    reason: 'main_index_export_mismatch'
                };
            }
        }
        return {
            sourceStates,
            requiresRebuild: false,
            hasUsableIndex,
            reason: 'fresh'
        };
    }
    getArticleRelationsV2IndexDb(workspacePath) {
        return new index_db_1.ArticleRelationsV2IndexDb(this.getArticleRelationsV2IndexDbPath(workspacePath));
    }
    getArticleRelationsV2IndexDbPath(workspacePath) {
        return node_path_1.default.join(workspacePath, types_1.ARTICLE_RELATIONS_V2_INDEX_DB_RELATIVE_PATH);
    }
    loadArticleRelationEnabledLocales(workspaceDb, workspaceId) {
        const row = workspaceDb.get(`SELECT enabled_locales as enabledLocales
       FROM workspace_settings
       WHERE workspace_id = @workspaceId`, { workspaceId });
        return safeParseLocales(row?.enabledLocales ?? '["en-us"]');
    }
    loadArticleRelationCoverageSourceStates(workspaceId, enabledLocales, workspaceDb, familyIds) {
        const selectedLocaleKeys = normalizeRelationCoverageLocaleKeys(enabledLocales);
        if (selectedLocaleKeys.length === 0) {
            return [];
        }
        const scopedFamilyIds = familyIds
            ? Array.from(new Set(familyIds.map((value) => value.trim()).filter(Boolean)))
            : [];
        if (familyIds && scopedFamilyIds.length === 0) {
            return [];
        }
        const params = {
            workspaceId,
            proposalScopedPattern: `${PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX}%`,
            liveRevisionType: shared_types_1.RevisionState.LIVE
        };
        const familyFilter = scopedFamilyIds.length > 0
            ? `\n         AND af.id IN (${buildRelationCoverageInClause('family', scopedFamilyIds, params)})`
            : '';
        return workspaceDb.all(`SELECT
         af.id as familyId,
         lv.id as localeVariantId,
         r.id as revisionId,
         COALESCE(r.content_hash, '') as contentHash
       FROM article_families af
       JOIN locale_variants lv ON lv.family_id = af.id
       JOIN revisions r
         ON r.id = (
           SELECT live.id
           FROM revisions live
           WHERE live.locale_variant_id = lv.id
             AND live.revision_type = @liveRevisionType
           ORDER BY live.revision_number DESC, live.updated_at DESC, live.id DESC
           LIMIT 1
         )
       WHERE af.workspace_id = @workspaceId
         AND af.retired_at IS NULL
         AND lower(af.external_key) NOT LIKE @proposalScopedPattern
         AND (lv.retired_at IS NULL OR lv.retired_at = '')
         AND lower(lv.locale) IN (${buildRelationCoverageInClause('locale', selectedLocaleKeys, params)})${familyFilter}
       ORDER BY af.id ASC, lv.id ASC`, params);
    }
    recordArticleRelationExportError(workspaceDb, workspaceId, error) {
        workspaceDb.run(`INSERT INTO article_relation_index_state (
         workspace_id, locale_variant_id, family_id, revision_id, content_hash, engine_version, status, last_indexed_at, last_error
       ) VALUES (
         @workspaceId, @localeVariantId, @familyId, @revisionId, @contentHash, @engineVersion, @status, NULL, @lastError
       )
       ON CONFLICT(workspace_id, locale_variant_id) DO UPDATE SET
         family_id = excluded.family_id,
         revision_id = excluded.revision_id,
         content_hash = excluded.content_hash,
         engine_version = excluded.engine_version,
         status = excluded.status,
         last_indexed_at = NULL,
         last_error = excluded.last_error`, {
            workspaceId,
            localeVariantId: error.row.localeVariantId,
            familyId: error.row.familyId,
            revisionId: error.row.revisionId,
            contentHash: error.row.contentHash ?? '',
            engineVersion: types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION,
            status: shared_types_1.ArticleRelationIndexStateStatus.ERROR,
            lastError: error.message
        });
    }
    async prepareArticleRelationCoverageIndexForRefresh(input) {
        const freshness = await this.evaluateArticleRelationCoverageIndexFreshness(input);
        const seedFamilyIds = Array.from(new Set(freshness.sourceStates.map((row) => row.familyId)));
        if (seedFamilyIds.length === 0) {
            return {
                seedFamilyIds: [],
                indexedDocumentCount: 0,
                staleDocumentCount: 0,
                degradedMode: false
            };
        }
        let degradedMode = false;
        if (freshness.requiresRebuild) {
            try {
                await this.rebuildArticleRelationCoverageIndexWithDb({
                    workspaceId: input.workspaceId,
                    workspacePath: input.workspacePath,
                    enabledLocales: input.enabledLocales,
                    workspaceDb: input.workspaceDb,
                    forceFullRebuild: freshness.reason === 'engine_version_mismatch'
                        || freshness.reason === 'missing_index_file'
                        || freshness.reason === 'index_open_failed'
                });
            }
            catch (error) {
                if (!freshness.hasUsableIndex) {
                    throw error;
                }
                degradedMode = true;
                logger_1.logger.warn('workspace-repository.refreshArticleRelations using stale index fallback', {
                    workspaceId: input.workspaceId,
                    reason: freshness.reason,
                    message: error instanceof Error ? error.message : String(error)
                });
            }
        }
        const indexCounts = this.loadArticleRelationIndexStateCounts(input.workspaceDb, input.workspaceId, input.enabledLocales);
        return {
            seedFamilyIds,
            indexedDocumentCount: indexCounts.indexedDocumentCount || freshness.sourceStates.length,
            staleDocumentCount: indexCounts.staleDocumentCount,
            degradedMode
        };
    }
    loadArticleRelationIndexStateCounts(workspaceDb, workspaceId, enabledLocales) {
        const sourceStates = this.loadArticleRelationCoverageSourceStates(workspaceId, enabledLocales, workspaceDb);
        if (sourceStates.length === 0) {
            return {
                indexedDocumentCount: 0,
                staleDocumentCount: 0
            };
        }
        const params = { workspaceId };
        const localeVariantPlaceholders = buildRelationCoverageInClause('countLocaleVariant', sourceStates.map((row) => row.localeVariantId), params);
        const row = workspaceDb.get(`SELECT
         SUM(CASE WHEN status = 'indexed' THEN 1 ELSE 0 END) as indexedDocumentCount,
         SUM(CASE WHEN status = 'stale' THEN 1 ELSE 0 END) as staleDocumentCount
         FROM article_relation_index_state
        WHERE workspace_id = @workspaceId
          AND locale_variant_id IN (${localeVariantPlaceholders})`, params);
        return {
            indexedDocumentCount: row?.indexedDocumentCount ?? 0,
            staleDocumentCount: row?.staleDocumentCount ?? 0
        };
    }
    upsertKbScopeCatalogEntriesInDb(workspaceDb, workspaceId, entries, updatedAtUtc) {
        const recordsByKey = new Map();
        for (const entry of entries) {
            const scopeType = normalizeKbScopeType(entry.scopeType);
            const scopeId = normalizeRequiredKbScopeId(entry.scopeId, 'scopeId');
            const displayName = normalizeRequiredKbScopeDisplayName(entry.displayName);
            const source = normalizeRequiredKbScopeSource(entry.source);
            const parentScopeId = normalizeFeatureMapScopeId(entry.parentScopeId ?? undefined);
            const record = {
                workspaceId,
                scopeType,
                scopeId,
                parentScopeId,
                displayName,
                source,
                updatedAtUtc
            };
            recordsByKey.set(buildFeatureMapBucketKey(scopeType, scopeId), record);
        }
        for (const record of recordsByKey.values()) {
            workspaceDb.run(`INSERT INTO kb_scope_catalog (
           workspace_id, scope_type, scope_id, parent_scope_id, display_name, source, updated_at
         ) VALUES (
           @workspaceId, @scopeType, @scopeId, @parentScopeId, @displayName, @source, @updatedAtUtc
         )
         ON CONFLICT(workspace_id, scope_type, scope_id) DO UPDATE SET
           parent_scope_id = excluded.parent_scope_id,
           display_name = excluded.display_name,
           source = excluded.source,
           updated_at = excluded.updated_at`, {
                workspaceId: record.workspaceId,
                scopeType: record.scopeType,
                scopeId: record.scopeId,
                parentScopeId: record.parentScopeId ?? null,
                displayName: record.displayName,
                source: record.source,
                updatedAtUtc: record.updatedAtUtc
            });
        }
        return Array.from(recordsByKey.values())
            .sort((left, right) => (left.scopeType.localeCompare(right.scopeType)
            || left.displayName.localeCompare(right.displayName)
            || left.scopeId.localeCompare(right.scopeId)));
    }
    listKbScopeCatalogEntriesInDb(workspaceDb, workspaceId, query = {}) {
        const where = ['workspace_id = @workspaceId'];
        const params = { workspaceId };
        if (query.scopeType) {
            where.push('scope_type = @scopeType');
            params.scopeType = normalizeKbScopeType(query.scopeType);
        }
        const scopeIds = Array.from(new Set((query.scopeIds ?? []).map((value) => normalizeFeatureMapScopeId(value)).filter(Boolean)));
        if (scopeIds.length > 0) {
            where.push(`scope_id IN (${buildRelationCoverageInClause('scopeId', scopeIds, params)})`);
        }
        return workspaceDb.all(`SELECT workspace_id as workspaceId,
              scope_type as scopeType,
              scope_id as scopeId,
              parent_scope_id as parentScopeId,
              display_name as displayName,
              source,
              updated_at as updatedAtUtc
         FROM kb_scope_catalog
        WHERE ${where.join('\n          AND ')}
        ORDER BY scope_type ASC, display_name COLLATE NOCASE ASC, scope_id ASC`, params).map((row) => ({
            ...row,
            parentScopeId: normalizeFeatureMapScopeId(row.parentScopeId)
        }));
    }
    listKbScopeOverridesInDb(workspaceDb, workspaceId, query = {}) {
        const where = ['workspace_id = @workspaceId'];
        const params = { workspaceId };
        if (query.scopeType) {
            where.push('scope_type = @scopeType');
            params.scopeType = normalizeKbScopeType(query.scopeType);
        }
        const scopeIds = Array.from(new Set((query.scopeIds ?? []).map((value) => normalizeFeatureMapScopeId(value)).filter(Boolean)));
        if (scopeIds.length > 0) {
            where.push(`scope_id IN (${buildRelationCoverageInClause('overrideScopeId', scopeIds, params)})`);
        }
        return workspaceDb.all(`SELECT id,
              workspace_id as workspaceId,
              scope_type as scopeType,
              scope_id as scopeId,
              display_name as displayName,
              parent_scope_id as parentScopeId,
              is_hidden as isHidden,
              created_at as createdAtUtc,
              updated_at as updatedAtUtc
         FROM kb_scope_overrides
        WHERE ${where.join('\n          AND ')}
        ORDER BY scope_type ASC, updated_at DESC, scope_id ASC`, params).map((row) => ({
            ...row,
            displayName: normalizeFeatureMapScopeId(row.displayName),
            parentScopeId: normalizeFeatureMapScopeId(row.parentScopeId),
            isHidden: Boolean(row.isHidden)
        }));
    }
    resolveKbScopeDisplayNamesInDb(workspaceDb, workspaceId, scopes) {
        const normalizedScopes = [];
        const seen = new Set();
        for (const scope of scopes) {
            const scopeType = normalizeKbScopeType(scope.scopeType);
            const scopeId = normalizeFeatureMapScopeId(scope.scopeId);
            const key = buildFeatureMapBucketKey(scopeType, scopeId);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            normalizedScopes.push({
                scopeType,
                scopeId
            });
        }
        if (normalizedScopes.length === 0) {
            return [];
        }
        const scopeIds = normalizedScopes
            .map((scope) => scope.scopeId)
            .filter((value) => Boolean(value));
        const catalogByKey = new Map(this.listKbScopeCatalogEntriesInDb(workspaceDb, workspaceId, { scopeIds })
            .map((record) => [buildFeatureMapBucketKey(record.scopeType, record.scopeId), record]));
        const overridesByKey = new Map(this.listKbScopeOverridesInDb(workspaceDb, workspaceId, { scopeIds })
            .map((record) => [buildFeatureMapBucketKey(record.scopeType, record.scopeId), record]));
        return normalizedScopes.map((scope) => {
            const key = buildFeatureMapBucketKey(scope.scopeType, scope.scopeId);
            const override = overridesByKey.get(key);
            const catalog = catalogByKey.get(key);
            const overrideName = normalizeFeatureMapScopeId(override?.displayName);
            const catalogName = normalizeFeatureMapScopeId(catalog?.displayName);
            const labelSource = overrideName
                ? 'override'
                : (catalogName ? 'catalog' : 'fallback');
            return {
                scopeType: scope.scopeType,
                scopeId: scope.scopeId,
                displayName: overrideName
                    ?? catalogName
                    ?? buildFallbackKbScopeDisplayName(scope.scopeType, scope.scopeId),
                labelSource,
                parentScopeId: normalizeFeatureMapScopeId(override?.parentScopeId) ?? normalizeFeatureMapScopeId(catalog?.parentScopeId),
                isHidden: Boolean(override?.isHidden)
            };
        });
    }
    loadFeatureMapContext(workspaceDb, workspaceId, options) {
        const families = this.loadFeatureMapFamilies(workspaceDb, workspaceId);
        const relations = this.loadFeatureMapRelations(workspaceDb, workspaceId, options);
        const staleCountsByFamily = this.loadFeatureMapStaleCounts(workspaceDb, workspaceId);
        return {
            families,
            relations,
            staleCountsByFamily
        };
    }
    loadFeatureMapFamilies(workspaceDb, workspaceId) {
        return workspaceDb.all(`SELECT id as familyId,
              title,
              section_id as sectionId,
              category_id as categoryId
         FROM article_families
        WHERE workspace_id = @workspaceId
          AND retired_at IS NULL
          AND lower(external_key) NOT LIKE @proposalScopedPattern
        ORDER BY title COLLATE NOCASE ASC`, {
            workspaceId,
            proposalScopedPattern: `${PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX}%`
        });
    }
    loadFeatureMapRelations(workspaceDb, workspaceId, options) {
        const where = [
            'r.workspace_id = @workspaceId',
            'r.strength_score >= @minScore',
            'left_f.retired_at IS NULL',
            'right_f.retired_at IS NULL',
            'lower(left_f.external_key) NOT LIKE @proposalScopedPattern',
            'lower(right_f.external_key) NOT LIKE @proposalScopedPattern'
        ];
        const params = {
            workspaceId,
            minScore: options.minScore,
            proposalScopedPattern: `${PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX}%`,
            activeStatus: shared_types_1.ArticleRelationStatus.ACTIVE,
            suppressedStatus: shared_types_1.ArticleRelationStatus.SUPPRESSED
        };
        if (options.includeSuppressed) {
            where.push('(r.status = @activeStatus OR r.status = @suppressedStatus)');
        }
        else {
            where.push('r.status = @activeStatus');
        }
        return workspaceDb.all(`SELECT
         r.id,
         r.workspace_id as workspaceId,
         r.left_family_id as leftFamilyId,
         r.right_family_id as rightFamilyId,
         r.relation_type as relationType,
         r.direction as direction,
         r.strength_score as strengthScore,
         r.status as status,
         r.origin as origin,
         r.run_id as runId,
         r.created_at as createdAtUtc,
         r.updated_at as updatedAtUtc,
         left_f.title as leftTitle,
         left_f.external_key as leftExternalKey,
         left_f.section_id as leftSectionId,
         left_f.category_id as leftCategoryId,
         right_f.title as rightTitle,
         right_f.external_key as rightExternalKey,
         right_f.section_id as rightSectionId,
         right_f.category_id as rightCategoryId
       FROM article_relations r
       JOIN article_families left_f ON left_f.id = r.left_family_id
       JOIN article_families right_f ON right_f.id = r.right_family_id
       WHERE ${where.join('\n         AND ')}
       ORDER BY r.strength_score DESC, r.updated_at DESC, r.id ASC`, params);
    }
    loadFeatureMapStaleCounts(workspaceDb, workspaceId) {
        const sourceStates = this.loadArticleRelationCoverageSourceStates(workspaceId, this.loadArticleRelationEnabledLocales(workspaceDb, workspaceId), workspaceDb);
        if (sourceStates.length === 0) {
            return new Map();
        }
        const params = { workspaceId };
        const localeVariantPlaceholders = buildRelationCoverageInClause('featureMapLocaleVariant', sourceStates.map((row) => row.localeVariantId), params);
        const rows = workspaceDb.all(`SELECT family_id as familyId,
              COUNT(*) as total
         FROM article_relation_index_state
        WHERE workspace_id = @workspaceId
          AND status = @status
          AND locale_variant_id IN (${localeVariantPlaceholders})
        GROUP BY family_id`, {
            ...params,
            status: shared_types_1.ArticleRelationIndexStateStatus.STALE
        });
        return new Map(rows.map((row) => [row.familyId, row.total]));
    }
    async loadArticleRelationIndexStats(workspacePath, workspaceId) {
        const indexDbPath = this.getArticleRelationsV2IndexDbPath(workspacePath);
        if (!(await this.fileExists(indexDbPath))) {
            return undefined;
        }
        try {
            const indexDbRef = this.getArticleRelationsV2IndexDb(workspacePath);
            const indexDb = indexDbRef.open();
            try {
                const stats = indexDbRef.getStats(indexDb, workspaceId);
                return {
                    engineVersion: stats.engineVersion,
                    documentCount: stats.documentCount,
                    chunkCount: stats.chunkCount,
                    aliasCount: stats.aliasCount,
                    linkCount: stats.linkCount,
                    lastBuiltAtUtc: stats.lastBuiltAtUtc
                };
            }
            finally {
                indexDb.close();
            }
        }
        catch (error) {
            logger_1.logger.warn('workspace-repository.loadArticleRelationIndexStats failed', {
                workspaceId,
                message: error instanceof Error ? error.message : String(error)
            });
            return undefined;
        }
    }
    insertArticleRelationFeedback(workspaceDb, input, createdAtUtc) {
        const record = {
            id: (0, node_crypto_1.randomUUID)(),
            workspaceId: input.workspaceId,
            leftFamilyId: input.leftFamilyId,
            rightFamilyId: input.rightFamilyId,
            feedbackType: input.feedbackType,
            source: input.source,
            note: input.note?.trim() ? input.note.trim() : undefined,
            createdAtUtc
        };
        workspaceDb.run(`INSERT INTO article_relation_feedback (
         id, workspace_id, left_family_id, right_family_id, feedback_type, source, note, created_at
       ) VALUES (
         @id, @workspaceId, @leftFamilyId, @rightFamilyId, @feedbackType, @source, @note, @createdAt
       )`, {
            id: record.id,
            workspaceId: record.workspaceId,
            leftFamilyId: record.leftFamilyId,
            rightFamilyId: record.rightFamilyId,
            feedbackType: record.feedbackType,
            source: record.source,
            note: record.note ?? null,
            createdAt: record.createdAtUtc
        });
        return record;
    }
    markArticleRelationNeighborhoodStale(workspaceDb, workspaceId, familyIds) {
        const neighborhoodFamilyIds = this.loadArticleRelationNeighborhoodFamilyIds(workspaceDb, workspaceId, familyIds);
        this.markArticleRelationFamiliesStale(workspaceDb, workspaceId, neighborhoodFamilyIds);
    }
    loadArticleRelationNeighborhoodFamilyIds(workspaceDb, workspaceId, familyIds) {
        const dedupedFamilyIds = Array.from(new Set(familyIds.map((value) => value.trim()).filter(Boolean)));
        if (dedupedFamilyIds.length === 0) {
            return [];
        }
        const params = { workspaceId };
        const placeholders = buildRelationCoverageInClause('family', dedupedFamilyIds, params);
        const relatedFamilies = workspaceDb.all(`SELECT DISTINCT CASE
           WHEN left_family_id IN (${placeholders}) THEN right_family_id
           ELSE left_family_id
         END as familyId
       FROM article_relations
       WHERE workspace_id = @workspaceId
         AND (left_family_id IN (${placeholders}) OR right_family_id IN (${placeholders}))`, params);
        return Array.from(new Set([
            ...dedupedFamilyIds,
            ...relatedFamilies.map((row) => row.familyId).filter(Boolean)
        ]));
    }
    markArticleRelationFamiliesStale(workspaceDb, workspaceId, familyIds) {
        const dedupedFamilyIds = Array.from(new Set(familyIds.map((value) => value.trim()).filter(Boolean)));
        if (dedupedFamilyIds.length === 0) {
            return;
        }
        const sourceStates = this.loadArticleRelationCoverageSourceStates(workspaceId, this.loadArticleRelationEnabledLocales(workspaceDb, workspaceId), workspaceDb, dedupedFamilyIds);
        const params = { workspaceId };
        const familyPlaceholders = buildRelationCoverageInClause('family', dedupedFamilyIds, params);
        if (sourceStates.length === 0) {
            workspaceDb.run(`DELETE FROM article_relation_index_state
         WHERE workspace_id = @workspaceId
           AND family_id IN (${familyPlaceholders})`, params);
            return;
        }
        const scopedParams = { ...params };
        const keepLocaleVariantPlaceholders = buildRelationCoverageInClause('keepLocaleVariant', sourceStates.map((row) => row.localeVariantId), scopedParams);
        workspaceDb.run(`DELETE FROM article_relation_index_state
       WHERE workspace_id = @workspaceId
         AND family_id IN (${familyPlaceholders})
         AND locale_variant_id NOT IN (${keepLocaleVariantPlaceholders})`, scopedParams);
        for (const row of sourceStates) {
            workspaceDb.run(`INSERT INTO article_relation_index_state (
           workspace_id, locale_variant_id, family_id, revision_id, content_hash, engine_version, status, last_indexed_at, last_error
         ) VALUES (
           @workspaceId, @localeVariantId, @familyId, @revisionId, @contentHash, @engineVersion, @status, NULL, NULL
         )
         ON CONFLICT(workspace_id, locale_variant_id) DO UPDATE SET
           family_id = excluded.family_id,
           revision_id = excluded.revision_id,
           content_hash = excluded.content_hash,
           engine_version = excluded.engine_version,
           status = excluded.status,
           last_error = NULL`, {
                workspaceId,
                localeVariantId: row.localeVariantId,
                familyId: row.familyId,
                revisionId: row.revisionId,
                contentHash: row.contentHash,
                engineVersion: types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION,
                status: shared_types_1.ArticleRelationIndexStateStatus.STALE
            });
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
          duplicate_row_count, scoped_row_count, scope_mode, scope_payload, analysis_worker_budget_minutes
        ) VALUES (
          @id, @workspaceId, @name, @sourceFileName, @sourceRowCount, @importedAt, @status,
          @sourcePath, @sourceFormat, @candidateRowCount, @ignoredRowCount, @malformedRowCount,
          @duplicateRowCount, @scopedRowCount, @scopeMode, @scopePayload, @workerStageBudgetMinutes
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
                scopePayload: scopePayload ?? null,
                workerStageBudgetMinutes: null
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
                workerStageBudgetMinutes: undefined,
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
               analysis_worker_budget_minutes as workerStageBudgetMinutes,
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
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            return workspaceDb.all(`
        SELECT id, workspace_id as workspaceId, name, source_file_name as sourceFileName,
               source_row_count as sourceRowCount, source_path as sourcePath, source_format as sourceFormat,
               candidate_row_count as candidateRowCount, ignored_row_count as ignoredRowCount,
               malformed_row_count as malformedRowCount, duplicate_row_count as duplicateRowCount,
               scoped_row_count as scopedRowCount, scope_mode as scopeMode, scope_payload as scopePayload,
               analysis_worker_budget_minutes as workerStageBudgetMinutes,
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
    async listProposalReviewBatches(workspaceId) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const rows = workspaceDb.all(`
        SELECT b.id as batchId,
               b.name as batchName,
               b.source_file_name as sourceFileName,
               b.imported_at as importedAtUtc,
               b.status as batchStatus,
               COUNT(p.id) as totalCount,
               SUM(CASE WHEN COALESCE(p.review_status, 'pending_review') = 'pending_review' THEN 1 ELSE 0 END) as pendingCount,
               SUM(CASE WHEN p.review_status = 'accepted' THEN 1 ELSE 0 END) as acceptedCount,
               SUM(CASE WHEN p.review_status = 'denied' THEN 1 ELSE 0 END) as deniedCount,
               SUM(CASE WHEN p.review_status = 'deferred' THEN 1 ELSE 0 END) as deferredCount,
               SUM(CASE WHEN p.review_status = 'applied_to_branch' THEN 1 ELSE 0 END) as appliedCount,
               SUM(CASE WHEN p.review_status = 'archived' THEN 1 ELSE 0 END) as archivedCount
        FROM pbi_batches b
        JOIN proposals p ON p.batch_id = b.id
        WHERE b.workspace_id = @workspaceId
          AND COALESCE(p.review_status, 'pending_review') != @stagedStatus
        GROUP BY b.id, b.name, b.source_file_name, b.imported_at, b.status
        ORDER BY b.imported_at DESC
      `, {
                workspaceId,
                stagedStatus: shared_types_1.ProposalReviewStatus.STAGED_ANALYSIS
            });
            return {
                workspaceId,
                batches: rows.map((row) => ({
                    batchId: row.batchId,
                    batchName: row.batchName,
                    sourceFileName: row.sourceFileName,
                    importedAtUtc: row.importedAtUtc,
                    batchStatus: row.batchStatus,
                    proposalCount: row.totalCount,
                    pendingReviewCount: row.pendingCount,
                    acceptedCount: row.acceptedCount,
                    deniedCount: row.deniedCount,
                    deferredCount: row.deferredCount,
                    appliedToBranchCount: row.appliedCount,
                    archivedCount: row.archivedCount,
                })),
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getPBIBatch(workspaceId, batchId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const normalizedBatchId = batchId.trim();
            let batch = workspaceDb.get(`
        SELECT id, workspace_id as workspaceId, name, source_file_name as sourceFileName,
               source_row_count as sourceRowCount, source_path as sourcePath, source_format as sourceFormat,
               candidate_row_count as candidateRowCount, ignored_row_count as ignoredRowCount,
               malformed_row_count as malformedRowCount, duplicate_row_count as duplicateRowCount,
               scoped_row_count as scopedRowCount, scope_mode as scopeMode, scope_payload as scopePayload,
               analysis_worker_budget_minutes as workerStageBudgetMinutes,
               imported_at as importedAtUtc, status
        FROM pbi_batches
        WHERE id = @batchId AND workspace_id = @workspaceId`, { batchId: normalizedBatchId, workspaceId });
            if (!batch && normalizedBatchId.length >= 6) {
                const prefixMatches = workspaceDb.all(`
          SELECT id, workspace_id as workspaceId, name, source_file_name as sourceFileName,
                 source_row_count as sourceRowCount, source_path as sourcePath, source_format as sourceFormat,
                 candidate_row_count as candidateRowCount, ignored_row_count as ignoredRowCount,
                 malformed_row_count as malformedRowCount, duplicate_row_count as duplicateRowCount,
                 scoped_row_count as scopedRowCount, scope_mode as scopeMode, scope_payload as scopePayload,
                 analysis_worker_budget_minutes as workerStageBudgetMinutes,
                 imported_at as importedAtUtc, status
          FROM pbi_batches
          WHERE workspace_id = @workspaceId
            AND id LIKE @batchIdPrefix
          ORDER BY imported_at DESC
          LIMIT 2`, {
                    workspaceId,
                    batchIdPrefix: `${normalizedBatchId}%`
                });
                if (prefixMatches.length === 1) {
                    batch = prefixMatches[0];
                }
            }
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
    async listPBILibrary(workspaceId, request) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const scopeStateSql = buildPBILibraryScopeStateSql('p');
            const conditions = ['b.workspace_id = @workspaceId'];
            const params = { workspaceId };
            const trimmedQuery = request.query?.trim();
            if (trimmedQuery) {
                params.query = `%${escapeSqlLikePattern(trimmedQuery.toLowerCase())}%`;
                conditions.push(`(
          LOWER(COALESCE(p.external_id, '')) LIKE @query ESCAPE '\\'
          OR LOWER(COALESCE(p.title, '')) LIKE @query ESCAPE '\\'
          OR LOWER(COALESCE(p.title1, '')) LIKE @query ESCAPE '\\'
          OR LOWER(COALESCE(p.title2, '')) LIKE @query ESCAPE '\\'
          OR LOWER(COALESCE(p.title3, '')) LIKE @query ESCAPE '\\'
          OR LOWER(COALESCE(p.description_text, '')) LIKE @query ESCAPE '\\'
          OR LOWER(COALESCE(p.acceptance_criteria_text, '')) LIKE @query ESCAPE '\\'
          OR LOWER(COALESCE(p.work_item_type, '')) LIKE @query ESCAPE '\\'
          OR LOWER(COALESCE(b.name, '')) LIKE @query ESCAPE '\\'
          OR LOWER(COALESCE(b.source_file_name, '')) LIKE @query ESCAPE '\\'
        )`);
            }
            if (request.validationStatuses?.length) {
                const validationPlaceholders = request.validationStatuses.map((_, index) => `@validationStatus${index}`);
                request.validationStatuses.forEach((status, index) => {
                    params[`validationStatus${index}`] = status;
                });
                conditions.push(`p.validation_status IN (${validationPlaceholders.join(', ')})`);
            }
            if (request.scopeStates?.length) {
                const scopePlaceholders = request.scopeStates.map((_, index) => `@scopeState${index}`);
                request.scopeStates.forEach((state, index) => {
                    params[`scopeState${index}`] = state;
                });
                conditions.push(`${scopeStateSql} IN (${scopePlaceholders.join(', ')})`);
            }
            if (request.batchId?.trim()) {
                params.batchId = request.batchId.trim();
                conditions.push('p.batch_id = @batchId');
            }
            const sortField = request.sortBy ?? 'importedAtUtc';
            const sortDirection = request.sortDirection === 'asc' ? 'ASC' : 'DESC';
            const sortExpression = this.resolvePBILibrarySortExpression(sortField, scopeStateSql);
            const rows = workspaceDb.all(`
        WITH proposal_counts AS (
          SELECT pbi_id as pbiId, COUNT(*) as proposalCount
          FROM proposal_pbi_links
          GROUP BY pbi_id
        )
        SELECT p.id as pbiId,
               p.batch_id as batchId,
               p.external_id as externalId,
               p.title as title,
               p.work_item_type as workItemType,
               p.priority as priority,
               COALESCE(p.validation_status, @candidateStatus) as validationStatus,
               ${scopeStateSql} as scopeState,
               b.name as batchName,
               b.source_file_name as sourceFileName,
               b.imported_at as importedAtUtc,
               COALESCE(proposal_counts.proposalCount, 0) as proposalCount
        FROM pbi_records p
        JOIN pbi_batches b
          ON b.id = p.batch_id
        LEFT JOIN proposal_counts
          ON proposal_counts.pbiId = p.id
        WHERE ${conditions.join('\n          AND ')}
        ORDER BY ${sortExpression} ${sortDirection},
                 b.imported_at DESC,
                 p.source_row_number ASC,
                 p.id ASC
      `, {
                ...params,
                candidateStatus: shared_types_1.PBIValidationStatus.CANDIDATE
            });
            return {
                workspaceId,
                items: rows.map((row) => ({
                    pbiId: row.pbiId,
                    batchId: row.batchId,
                    externalId: row.externalId,
                    title: row.title,
                    workItemType: row.workItemType ?? undefined,
                    priority: row.priority ?? undefined,
                    validationStatus: row.validationStatus ?? shared_types_1.PBIValidationStatus.CANDIDATE,
                    scopeState: row.scopeState,
                    batchName: row.batchName,
                    sourceFileName: row.sourceFileName,
                    importedAtUtc: row.importedAtUtc,
                    proposalCount: row.proposalCount
                }))
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getPBILibraryDetail(workspaceId, pbiId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const scopeStateSql = buildPBILibraryScopeStateSql('p');
            const row = workspaceDb.get(`
        WITH proposal_counts AS (
          SELECT pbi_id as pbiId, COUNT(*) as proposalCount
          FROM proposal_pbi_links
          GROUP BY pbi_id
        )
        SELECT p.id as pbiId,
               p.batch_id as batchId,
               p.external_id as externalId,
               p.title as title,
               p.work_item_type as workItemType,
               p.priority as priority,
               COALESCE(p.validation_status, @candidateStatus) as validationStatus,
               ${scopeStateSql} as scopeState,
               b.name as batchName,
               b.source_file_name as sourceFileName,
               b.imported_at as importedAtUtc,
               COALESCE(proposal_counts.proposalCount, 0) as proposalCount,
               p.source_row_number as sourceRowNumber,
               p.description as description,
               p.state as state,
               p.title1 as title1,
               p.title2 as title2,
               p.title3 as title3,
               p.raw_description as rawDescription,
               p.raw_acceptance_criteria as rawAcceptanceCriteria,
               p.description_text as descriptionText,
               p.acceptance_criteria_text as acceptanceCriteriaText,
               p.parent_external_id as parentExternalId,
               p.parent_record_id as parentRecordId,
               p.validation_reason as validationReason,
               b.workspace_id as batchWorkspaceId,
               b.source_row_count as batchSourceRowCount,
               b.source_path as batchSourcePath,
               b.source_format as batchSourceFormat,
               b.candidate_row_count as batchCandidateRowCount,
               b.ignored_row_count as batchIgnoredRowCount,
               b.malformed_row_count as batchMalformedRowCount,
               b.duplicate_row_count as batchDuplicateRowCount,
               b.scoped_row_count as batchScopedRowCount,
               b.scope_mode as batchScopeMode,
               b.scope_payload as batchScopePayload,
               b.analysis_worker_budget_minutes as batchWorkerStageBudgetMinutes,
               b.status as batchStatus
        FROM pbi_records p
        JOIN pbi_batches b
          ON b.id = p.batch_id
        LEFT JOIN proposal_counts
          ON proposal_counts.pbiId = p.id
        WHERE b.workspace_id = @workspaceId
          AND p.id = @pbiId
      `, {
                workspaceId,
                pbiId,
                candidateStatus: shared_types_1.PBIValidationStatus.CANDIDATE
            });
            if (!row) {
                throw new Error('PBI library record not found');
            }
            const parent = row.parentRecordId
                ? workspaceDb.get(`
            SELECT id as pbiId,
                   external_id as externalId,
                   title
            FROM pbi_records
            WHERE batch_id = @batchId
              AND id = @parentRecordId
          `, {
                    batchId: row.batchId,
                    parentRecordId: row.parentRecordId
                }) ?? undefined
                : undefined;
            const children = workspaceDb.all(`
        SELECT id as pbiId,
               external_id as externalId,
               title
        FROM pbi_records
        WHERE batch_id = @batchId
          AND parent_record_id = @pbiId
        ORDER BY source_row_number ASC, id ASC
      `, {
                batchId: row.batchId,
                pbiId: row.pbiId
            });
            const linkedProposals = workspaceDb.all(`
        SELECT proposals.id as proposalId,
               proposals.batch_id as batchId,
               proposals.action as action,
               COALESCE(proposals.review_status, @pendingReviewStatus) as reviewStatus,
               proposals.generated_at as generatedAtUtc
        FROM proposal_pbi_links links
        JOIN proposals
          ON proposals.id = links.proposal_id
        WHERE proposals.workspace_id = @workspaceId
          AND links.pbi_id = @pbiId
        ORDER BY proposals.generated_at DESC, proposals.id ASC
      `, {
                workspaceId,
                pbiId,
                pendingReviewStatus: shared_types_1.ProposalReviewStatus.PENDING_REVIEW
            });
            const item = {
                pbiId: row.pbiId,
                batchId: row.batchId,
                externalId: row.externalId,
                title: row.title,
                workItemType: row.workItemType ?? undefined,
                priority: row.priority ?? undefined,
                validationStatus: row.validationStatus ?? shared_types_1.PBIValidationStatus.CANDIDATE,
                scopeState: row.scopeState,
                batchName: row.batchName,
                sourceFileName: row.sourceFileName,
                importedAtUtc: row.importedAtUtc,
                proposalCount: row.proposalCount
            };
            const record = {
                id: row.pbiId,
                batchId: row.batchId,
                sourceRowNumber: row.sourceRowNumber,
                externalId: row.externalId,
                title: row.title,
                description: row.description ?? undefined,
                state: row.state ?? undefined,
                priority: row.priority ?? undefined,
                workItemType: row.workItemType ?? undefined,
                title1: row.title1 ?? undefined,
                title2: row.title2 ?? undefined,
                title3: row.title3 ?? undefined,
                rawDescription: row.rawDescription ?? undefined,
                rawAcceptanceCriteria: row.rawAcceptanceCriteria ?? undefined,
                descriptionText: row.descriptionText ?? undefined,
                acceptanceCriteriaText: row.acceptanceCriteriaText ?? undefined,
                parentExternalId: row.parentExternalId ?? undefined,
                parentRecordId: row.parentRecordId ?? undefined,
                validationStatus: row.validationStatus ?? shared_types_1.PBIValidationStatus.CANDIDATE,
                validationReason: row.validationReason ?? undefined
            };
            const batch = {
                id: row.batchId,
                workspaceId: row.batchWorkspaceId,
                name: row.batchName,
                sourceFileName: row.sourceFileName,
                sourceRowCount: row.batchSourceRowCount,
                sourcePath: row.batchSourcePath,
                sourceFormat: row.batchSourceFormat,
                candidateRowCount: row.batchCandidateRowCount,
                ignoredRowCount: row.batchIgnoredRowCount,
                malformedRowCount: row.batchMalformedRowCount,
                duplicateRowCount: row.batchDuplicateRowCount,
                scopedRowCount: row.batchScopedRowCount,
                scopeMode: row.batchScopeMode,
                scopePayload: row.batchScopePayload ?? undefined,
                workerStageBudgetMinutes: row.batchWorkerStageBudgetMinutes ?? undefined,
                importedAtUtc: row.importedAtUtc,
                status: row.batchStatus
            };
            const titlePath = [row.title1, row.title2, row.title3]
                .map((value) => value?.trim() ?? '')
                .filter((value) => Boolean(value));
            if (titlePath.length === 0 && row.title.trim()) {
                titlePath.push(row.title.trim());
            }
            return {
                workspaceId,
                item,
                record,
                batch,
                titlePath,
                parent,
                children,
                linkedProposals
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    resolvePBILibrarySortExpression(sortField, scopeStateSql) {
        switch (sortField) {
            case 'externalId':
                return `LOWER(COALESCE(p.external_id, ''))`;
            case 'title':
                return `LOWER(COALESCE(p.title, ''))`;
            case 'workItemType':
                return `LOWER(COALESCE(p.work_item_type, ''))`;
            case 'priority':
                return PBI_LIBRARY_PRIORITY_ORDER_SQL;
            case 'validationStatus':
                return `LOWER(COALESCE(p.validation_status, ''))`;
            case 'scopeState':
                return `
          CASE ${scopeStateSql}
            WHEN 'in_scope' THEN 1
            WHEN 'out_of_scope' THEN 2
            ELSE 3
          END
        `;
            case 'batchName':
                return `LOWER(COALESCE(b.name, ''))`;
            case 'proposalCount':
                return `COALESCE(proposal_counts.proposalCount, 0)`;
            case 'importedAtUtc':
            default:
                return `b.imported_at`;
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
          session_id, kb_access_mode, agent_model_id, tool_calls_json, raw_output_json, message
        ) VALUES (
          @id, @workspaceId, @batchId, @status, @startedAt, @endedAt, @promptTemplate, @transcriptPath,
          @sessionId, @kbAccessMode, @agentModelId, @toolCallsJson, @rawOutputJson, @message
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
                kbAccessMode: params.kbAccessMode ?? DEFAULT_KB_ACCESS_MODE,
                agentModelId: params.agentModelId ?? null,
                toolCallsJson: JSON.stringify(params.toolCalls ?? []),
                rawOutputJson: params.rawOutput ? JSON.stringify(params.rawOutput) : null,
                message: params.message ?? null
            });
            return {
                id,
                workspaceId: params.workspaceId,
                batchId: params.batchId,
                sessionId: params.sessionId,
                kbAccessMode: params.kbAccessMode ?? DEFAULT_KB_ACCESS_MODE,
                agentModelId: params.agentModelId,
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
    async recordBatchAnalysisStageRun(params) {
        const workspace = await this.getWorkspace(params.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const id = (0, node_crypto_1.randomUUID)();
            const toolCalls = params.toolCalls ?? [];
            const createdAtUtc = params.createdAtUtc ?? params.endedAtUtc ?? params.startedAtUtc;
            const attempt = Number.isFinite(params.attempt)
                ? Math.max(1, Math.trunc(params.attempt))
                : (workspaceDb.get(`SELECT COALESCE(MAX(attempt), 0) + 1 as nextAttempt
               FROM batch_analysis_stage_runs
              WHERE iteration_id = @iterationId AND stage = @stage AND role = @role`, {
                    iterationId: params.iterationId,
                    stage: params.stage,
                    role: params.role
                })?.nextAttempt ?? 1);
            workspaceDb.run(`INSERT INTO batch_analysis_stage_runs (
          id, workspace_id, batch_id, iteration_id, iteration, stage, role, attempt, retry_type,
          session_reuse_policy, local_session_id, acp_session_id, kb_access_mode, agent_model_id, status,
          prompt_template, transcript_path, tool_call_count, tool_calls_json, raw_output_json, message,
          parseable, used_transcript_recovery, initial_candidate_count, transcript_candidate_count, text_length,
          result_text_preview, started_at, ended_at, created_at
        ) VALUES (
          @id, @workspaceId, @batchId, @iterationId, @iteration, @stage, @role, @attempt, @retryType,
          @sessionReusePolicy, @localSessionId, @acpSessionId, @kbAccessMode, @agentModelId, @status,
          @promptTemplate, @transcriptPath, @toolCallCount, @toolCallsJson, @rawOutputJson, @message,
          @parseable, @usedTranscriptRecovery, @initialCandidateCount, @transcriptCandidateCount, @textLength,
          @resultTextPreview, @startedAtUtc, @endedAtUtc, @createdAtUtc
        )`, {
                id,
                workspaceId: params.workspaceId,
                batchId: params.batchId,
                iterationId: params.iterationId,
                iteration: params.iteration,
                stage: params.stage,
                role: params.role,
                attempt,
                retryType: params.retryType ?? null,
                sessionReusePolicy: params.sessionReusePolicy ?? null,
                localSessionId: params.localSessionId ?? null,
                acpSessionId: params.acpSessionId ?? null,
                kbAccessMode: params.kbAccessMode ?? null,
                agentModelId: params.agentModelId ?? null,
                status: params.status,
                promptTemplate: params.promptTemplate ?? null,
                transcriptPath: params.transcriptPath ?? null,
                toolCallCount: toolCalls.length,
                toolCallsJson: JSON.stringify(toolCalls),
                rawOutputJson: params.rawOutput ? JSON.stringify(params.rawOutput) : null,
                message: params.message ?? null,
                parseable: typeof params.parseable === 'boolean' ? (params.parseable ? 1 : 0) : null,
                usedTranscriptRecovery: typeof params.usedTranscriptRecovery === 'boolean' ? (params.usedTranscriptRecovery ? 1 : 0) : null,
                initialCandidateCount: params.initialCandidateCount ?? null,
                transcriptCandidateCount: params.transcriptCandidateCount ?? null,
                textLength: params.textLength ?? null,
                resultTextPreview: params.resultTextPreview ?? null,
                startedAtUtc: params.startedAtUtc,
                endedAtUtc: params.endedAtUtc ?? null,
                createdAtUtc
            });
            return {
                id,
                workspaceId: params.workspaceId,
                batchId: params.batchId,
                iterationId: params.iterationId,
                iteration: params.iteration,
                stage: params.stage,
                role: params.role,
                attempt,
                retryType: params.retryType,
                sessionReusePolicy: params.sessionReusePolicy,
                localSessionId: params.localSessionId,
                acpSessionId: params.acpSessionId,
                kbAccessMode: params.kbAccessMode,
                agentModelId: params.agentModelId,
                status: params.status,
                promptTemplate: params.promptTemplate,
                transcriptPath: params.transcriptPath,
                toolCallCount: toolCalls.length,
                toolCalls,
                rawOutput: params.rawOutput,
                message: params.message,
                parseable: params.parseable,
                usedTranscriptRecovery: params.usedTranscriptRecovery,
                initialCandidateCount: params.initialCandidateCount,
                transcriptCandidateCount: params.transcriptCandidateCount,
                textLength: params.textLength,
                resultTextPreview: params.resultTextPreview,
                startedAtUtc: params.startedAtUtc,
                endedAtUtc: params.endedAtUtc,
                createdAtUtc
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async updateBatchAnalysisStageRun(params) {
        const workspace = await this.getWorkspace(params.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const existing = workspaceDb.get(`SELECT id,
                workspace_id as workspaceId,
                batch_id as batchId,
                iteration_id as iterationId,
                iteration,
                stage,
                role,
                attempt,
                retry_type as retryType,
                session_reuse_policy as sessionReusePolicy,
                local_session_id as localSessionId,
                acp_session_id as acpSessionId,
                kb_access_mode as kbAccessMode,
                agent_model_id as agentModelId,
                status,
                prompt_template as promptTemplate,
                transcript_path as transcriptPath,
                tool_call_count as toolCallCount,
                tool_calls_json as toolCallsJson,
                raw_output_json as rawOutputJson,
                message,
                parseable,
                used_transcript_recovery as usedTranscriptRecovery,
                initial_candidate_count as initialCandidateCount,
                transcript_candidate_count as transcriptCandidateCount,
                text_length as textLength,
                result_text_preview as resultTextPreview,
                started_at as startedAtUtc,
                ended_at as endedAtUtc,
                created_at as createdAtUtc
           FROM batch_analysis_stage_runs
          WHERE workspace_id = @workspaceId
            AND id = @stageRunId
          LIMIT 1`, {
                workspaceId: params.workspaceId,
                stageRunId: params.stageRunId
            });
            if (!existing) {
                throw new Error(`Batch analysis stage run ${params.stageRunId} was not found`);
            }
            const toolCalls = params.toolCalls ?? this.parseBatchAnalysisToolCalls(existing.toolCallsJson);
            const rawOutput = params.rawOutput ?? this.parseBatchAnalysisRawOutput(existing.rawOutputJson);
            workspaceDb.run(`UPDATE batch_analysis_stage_runs
            SET local_session_id = @localSessionId,
                acp_session_id = @acpSessionId,
                kb_access_mode = @kbAccessMode,
                agent_model_id = @agentModelId,
                status = @status,
                prompt_template = @promptTemplate,
                transcript_path = @transcriptPath,
                tool_call_count = @toolCallCount,
                tool_calls_json = @toolCallsJson,
                raw_output_json = @rawOutputJson,
                message = @message,
                parseable = @parseable,
                used_transcript_recovery = @usedTranscriptRecovery,
                initial_candidate_count = @initialCandidateCount,
                transcript_candidate_count = @transcriptCandidateCount,
                text_length = @textLength,
                result_text_preview = @resultTextPreview,
                started_at = @startedAtUtc,
                ended_at = @endedAtUtc
          WHERE workspace_id = @workspaceId
            AND id = @stageRunId`, {
                workspaceId: params.workspaceId,
                stageRunId: params.stageRunId,
                localSessionId: params.localSessionId ?? existing.localSessionId ?? null,
                acpSessionId: params.acpSessionId ?? existing.acpSessionId ?? null,
                kbAccessMode: params.kbAccessMode ?? existing.kbAccessMode ?? null,
                agentModelId: params.agentModelId ?? existing.agentModelId ?? null,
                status: params.status ?? existing.status,
                promptTemplate: params.promptTemplate ?? existing.promptTemplate ?? null,
                transcriptPath: params.transcriptPath ?? existing.transcriptPath ?? null,
                toolCallCount: toolCalls.length,
                toolCallsJson: JSON.stringify(toolCalls),
                rawOutputJson: rawOutput ? JSON.stringify(rawOutput) : null,
                message: params.message ?? existing.message ?? null,
                parseable: typeof params.parseable === 'boolean'
                    ? (params.parseable ? 1 : 0)
                    : existing.parseable,
                usedTranscriptRecovery: typeof params.usedTranscriptRecovery === 'boolean'
                    ? (params.usedTranscriptRecovery ? 1 : 0)
                    : existing.usedTranscriptRecovery,
                initialCandidateCount: params.initialCandidateCount ?? existing.initialCandidateCount ?? null,
                transcriptCandidateCount: params.transcriptCandidateCount ?? existing.transcriptCandidateCount ?? null,
                textLength: params.textLength ?? existing.textLength ?? null,
                resultTextPreview: params.resultTextPreview ?? existing.resultTextPreview ?? null,
                startedAtUtc: params.startedAtUtc ?? existing.startedAtUtc,
                endedAtUtc: params.endedAtUtc ?? existing.endedAtUtc ?? null
            });
            const updated = workspaceDb.get(`SELECT id,
                workspace_id as workspaceId,
                batch_id as batchId,
                iteration_id as iterationId,
                iteration,
                stage,
                role,
                attempt,
                retry_type as retryType,
                session_reuse_policy as sessionReusePolicy,
                local_session_id as localSessionId,
                acp_session_id as acpSessionId,
                kb_access_mode as kbAccessMode,
                agent_model_id as agentModelId,
                status,
                prompt_template as promptTemplate,
                transcript_path as transcriptPath,
                tool_call_count as toolCallCount,
                tool_calls_json as toolCallsJson,
                raw_output_json as rawOutputJson,
                message,
                parseable,
                used_transcript_recovery as usedTranscriptRecovery,
                initial_candidate_count as initialCandidateCount,
                transcript_candidate_count as transcriptCandidateCount,
                text_length as textLength,
                result_text_preview as resultTextPreview,
                started_at as startedAtUtc,
                ended_at as endedAtUtc,
                created_at as createdAtUtc
           FROM batch_analysis_stage_runs
          WHERE workspace_id = @workspaceId
            AND id = @stageRunId
          LIMIT 1`, {
                workspaceId: params.workspaceId,
                stageRunId: params.stageRunId
            });
            if (!updated) {
                throw new Error(`Batch analysis stage run ${params.stageRunId} disappeared during update`);
            }
            return this.mapStageRunRow(updated);
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
            const latestStageRun = workspaceDb.get(`SELECT id,
                workspace_id as workspaceId,
                batch_id as batchId,
                iteration_id as iterationId,
                iteration,
                stage,
                role,
                attempt,
                retry_type as retryType,
                session_reuse_policy as sessionReusePolicy,
                local_session_id as localSessionId,
                acp_session_id as acpSessionId,
                kb_access_mode as kbAccessMode,
                agent_model_id as agentModelId,
                status,
                prompt_template as promptTemplate,
                transcript_path as transcriptPath,
                tool_call_count as toolCallCount,
                tool_calls_json as toolCallsJson,
                raw_output_json as rawOutputJson,
                message,
                parseable,
                used_transcript_recovery as usedTranscriptRecovery,
                initial_candidate_count as initialCandidateCount,
                transcript_candidate_count as transcriptCandidateCount,
                text_length as textLength,
                result_text_preview as resultTextPreview,
                started_at as startedAtUtc,
                ended_at as endedAtUtc,
                created_at as createdAtUtc
           FROM batch_analysis_stage_runs
          WHERE workspace_id = @workspaceId AND batch_id = @batchId
          ORDER BY created_at DESC
          LIMIT 1`, { workspaceId, batchId });
            if (latestStageRun) {
                return this.mapStageRunRowToPersistedRun(latestStageRun);
            }
            const row = workspaceDb.get(`SELECT id,
                workspace_id as workspaceId,
                batch_id as batchId,
                session_id as sessionId,
                kb_access_mode as kbAccessMode,
                agent_model_id as agentModelId,
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
            return this.mapLegacyRunRowToPersistedRun(row);
        }
        finally {
            workspaceDb.close();
        }
    }
    async createBatchAnalysisIteration(params) {
        const workspace = await this.getWorkspace(params.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const now = new Date().toISOString();
            const row = workspaceDb.get(`SELECT COALESCE(MAX(iteration), 0) + 1 as nextIteration
           FROM batch_analysis_iterations
          WHERE workspace_id = @workspaceId AND batch_id = @batchId`, { workspaceId: params.workspaceId, batchId: params.batchId });
            const iteration = row?.nextIteration ?? 1;
            const id = (0, node_crypto_1.randomUUID)();
            const executionCounts = this.normalizeBatchAnalysisExecutionCounts(params.executionCounts);
            workspaceDb.run(`INSERT INTO batch_analysis_iterations (
          id, workspace_id, batch_id, iteration, status, stage, role, summary, agent_model_id, session_id,
          approved_plan_id, last_review_verdict, outstanding_discovered_work_count, execution_counts_json,
          started_at, ended_at, created_at, updated_at
        ) VALUES (
          @id, @workspaceId, @batchId, @iteration, @status, @stage, @role, @summary, @agentModelId, @sessionId,
          @approvedPlanId, @lastReviewVerdict, @outstandingDiscoveredWorkCount, @executionCountsJson,
          @startedAtUtc, @endedAtUtc, @createdAtUtc, @updatedAtUtc
        )`, {
                id,
                workspaceId: params.workspaceId,
                batchId: params.batchId,
                iteration,
                status: params.status,
                stage: params.stage,
                role: params.role,
                summary: params.summary ?? null,
                agentModelId: params.agentModelId ?? null,
                sessionId: params.sessionId ?? null,
                approvedPlanId: params.approvedPlanId ?? null,
                lastReviewVerdict: params.lastReviewVerdict ?? null,
                outstandingDiscoveredWorkCount: params.outstandingDiscoveredWorkCount ?? 0,
                executionCountsJson: JSON.stringify(executionCounts),
                startedAtUtc: params.startedAtUtc ?? now,
                endedAtUtc: params.endedAtUtc ?? null,
                createdAtUtc: now,
                updatedAtUtc: now
            });
            return {
                id,
                workspaceId: params.workspaceId,
                batchId: params.batchId,
                iteration,
                status: params.status,
                stage: params.stage,
                role: params.role,
                summary: params.summary,
                agentModelId: params.agentModelId,
                sessionId: params.sessionId,
                approvedPlanId: params.approvedPlanId,
                lastReviewVerdict: params.lastReviewVerdict,
                outstandingDiscoveredWorkCount: params.outstandingDiscoveredWorkCount ?? 0,
                executionCounts,
                startedAtUtc: params.startedAtUtc ?? now,
                endedAtUtc: params.endedAtUtc,
                createdAtUtc: now,
                updatedAtUtc: now
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async updateBatchAnalysisIteration(params) {
        const workspace = await this.getWorkspace(params.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const existing = this.getBatchAnalysisIterationRow(workspaceDb, params.workspaceId, params.iterationId);
            if (!existing) {
                throw new Error('Batch analysis iteration not found');
            }
            const updatedAtUtc = new Date().toISOString();
            const executionCounts = params.executionCounts
                ? this.normalizeBatchAnalysisExecutionCounts(params.executionCounts)
                : this.parseBatchAnalysisExecutionCounts(existing.executionCountsJson);
            workspaceDb.run(`UPDATE batch_analysis_iterations
            SET status = COALESCE(@status, status),
                stage = COALESCE(@stage, stage),
                role = COALESCE(@role, role),
                summary = COALESCE(@summary, summary),
                agent_model_id = COALESCE(@agentModelId, agent_model_id),
                session_id = COALESCE(@sessionId, session_id),
                approved_plan_id = COALESCE(@approvedPlanId, approved_plan_id),
                last_review_verdict = COALESCE(@lastReviewVerdict, last_review_verdict),
                outstanding_discovered_work_count = COALESCE(@outstandingDiscoveredWorkCount, outstanding_discovered_work_count),
                execution_counts_json = @executionCountsJson,
                ended_at = COALESCE(@endedAtUtc, ended_at),
                updated_at = @updatedAtUtc
          WHERE workspace_id = @workspaceId AND id = @iterationId`, {
                workspaceId: params.workspaceId,
                iterationId: params.iterationId,
                status: params.status ?? null,
                stage: params.stage ?? null,
                role: params.role ?? null,
                summary: params.summary ?? null,
                agentModelId: params.agentModelId ?? null,
                sessionId: params.sessionId ?? null,
                approvedPlanId: params.approvedPlanId ?? null,
                lastReviewVerdict: params.lastReviewVerdict ?? null,
                outstandingDiscoveredWorkCount: params.outstandingDiscoveredWorkCount ?? null,
                executionCountsJson: JSON.stringify(executionCounts),
                endedAtUtc: params.endedAtUtc ?? null,
                updatedAtUtc
            });
            const nextIterationStatus = params.status ?? existing.status;
            if (nextIterationStatus === 'completed'
                || nextIterationStatus === 'failed'
                || nextIterationStatus === 'needs_human_review') {
                await this.syncTerminalBatchAnalysisStatus(workspaceDb, params.workspaceId, existing.batchId);
            }
            return {
                id: existing.id,
                workspaceId: existing.workspaceId,
                batchId: existing.batchId,
                iteration: existing.iteration,
                status: params.status ?? existing.status,
                stage: params.stage ?? existing.stage,
                role: params.role ?? existing.role,
                summary: params.summary ?? existing.summary ?? undefined,
                agentModelId: params.agentModelId ?? existing.agentModelId ?? undefined,
                sessionId: params.sessionId ?? existing.sessionId ?? undefined,
                approvedPlanId: params.approvedPlanId ?? existing.approvedPlanId ?? undefined,
                lastReviewVerdict: params.lastReviewVerdict ?? existing.lastReviewVerdict ?? undefined,
                outstandingDiscoveredWorkCount: params.outstandingDiscoveredWorkCount ?? existing.outstandingDiscoveredWorkCount,
                executionCounts,
                startedAtUtc: existing.startedAtUtc,
                endedAtUtc: params.endedAtUtc ?? existing.endedAtUtc ?? undefined,
                createdAtUtc: existing.createdAtUtc,
                updatedAtUtc
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async recordBatchWorkerExecutionReport(report) {
        const workspace = await this.getWorkspace(report.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            workspaceDb.run(`INSERT INTO batch_analysis_worker_reports (
          id, workspace_id, batch_id, iteration_id, iteration, stage, role, summary, status, plan_id,
          executed_items_json, blocker_notes_json, payload_json, agent_model_id, session_id, created_at
        ) VALUES (
          @id, @workspaceId, @batchId, @iterationId, @iteration, @stage, @role, @summary, @status, @planId,
          @executedItemsJson, @blockerNotesJson, @payloadJson, @agentModelId, @sessionId, @createdAtUtc
        )`, {
                id: report.id,
                workspaceId: report.workspaceId,
                batchId: report.batchId,
                iterationId: report.iterationId,
                iteration: report.iteration,
                stage: report.stage,
                role: report.role,
                summary: report.summary,
                status: report.status,
                planId: report.planId ?? null,
                executedItemsJson: JSON.stringify(report.executedItems),
                blockerNotesJson: JSON.stringify(report.blockerNotes),
                payloadJson: JSON.stringify(report),
                agentModelId: report.agentModelId ?? null,
                sessionId: report.sessionId ?? null,
                createdAtUtc: report.createdAtUtc
            });
            for (const item of report.discoveredWork) {
                workspaceDb.run(`INSERT INTO batch_analysis_discovered_work (
            id, workspace_id, batch_id, iteration_id, worker_report_id, discovery_id, discovered_action,
            suspected_target, reason, evidence_json, linked_pbi_ids_json, confidence,
            requires_plan_amendment, status, payload_json, created_at
          ) VALUES (
            @id, @workspaceId, @batchId, @iterationId, @workerReportId, @discoveryId, @discoveredAction,
            @suspectedTarget, @reason, @evidenceJson, @linkedPbiIdsJson, @confidence,
            @requiresPlanAmendment, @status, @payloadJson, @createdAtUtc
          )`, {
                    id: (0, node_crypto_1.randomUUID)(),
                    workspaceId: report.workspaceId,
                    batchId: report.batchId,
                    iterationId: report.iterationId,
                    workerReportId: report.id,
                    discoveryId: item.discoveryId,
                    discoveredAction: item.discoveredAction,
                    suspectedTarget: item.suspectedTarget,
                    reason: item.reason,
                    evidenceJson: JSON.stringify(item.evidence),
                    linkedPbiIdsJson: JSON.stringify(item.linkedPbiIds),
                    confidence: item.confidence,
                    requiresPlanAmendment: item.requiresPlanAmendment ? 1 : 0,
                    status: item.status ?? null,
                    payloadJson: JSON.stringify(item),
                    createdAtUtc: report.createdAtUtc
                });
            }
            return report;
        }
        finally {
            workspaceDb.close();
        }
    }
    async recordBatchAnalysisPlan(plan) {
        const workspace = await this.getWorkspace(plan.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            workspaceDb.run(`INSERT INTO batch_analysis_plans (
          id, workspace_id, batch_id, iteration_id, iteration, stage, role, verdict, plan_version, summary,
          coverage_json, open_questions_json, payload_json, supersedes_plan_id, source_discovery_ids_json,
          agent_model_id, session_id, created_at
        ) VALUES (
          @id, @workspaceId, @batchId, @iterationId, @iteration, @stage, @role, @verdict, @planVersion, @summary,
          @coverageJson, @openQuestionsJson, @payloadJson, @supersedesPlanId, @sourceDiscoveryIdsJson,
          @agentModelId, @sessionId, @createdAtUtc
        )`, {
                id: plan.id,
                workspaceId: plan.workspaceId,
                batchId: plan.batchId,
                iterationId: plan.iterationId,
                iteration: plan.iteration,
                stage: plan.stage,
                role: plan.role,
                verdict: plan.verdict,
                planVersion: plan.planVersion,
                summary: plan.summary,
                coverageJson: JSON.stringify(plan.coverage),
                openQuestionsJson: JSON.stringify(this.serializeBatchAnalysisPlanOpenQuestions(plan)),
                payloadJson: JSON.stringify(plan),
                supersedesPlanId: plan.supersedesPlanId ?? null,
                sourceDiscoveryIdsJson: plan.sourceDiscoveryIds ? JSON.stringify(plan.sourceDiscoveryIds) : null,
                agentModelId: plan.agentModelId ?? null,
                sessionId: plan.sessionId ?? null,
                createdAtUtc: plan.createdAtUtc
            });
            for (const item of plan.items) {
                workspaceDb.run(`INSERT INTO batch_analysis_plan_items (
            id, workspace_id, batch_id, plan_id, iteration_id, plan_item_id, pbi_ids_json, action, target_type,
            target_article_id, target_family_id, target_title, reason, evidence_json, confidence,
            depends_on_json, execution_status, created_at
          ) VALUES (
            @id, @workspaceId, @batchId, @planId, @iterationId, @planItemId, @pbiIdsJson, @action, @targetType,
            @targetArticleId, @targetFamilyId, @targetTitle, @reason, @evidenceJson, @confidence,
            @dependsOnJson, @executionStatus, @createdAtUtc
          )`, {
                    id: (0, node_crypto_1.randomUUID)(),
                    workspaceId: plan.workspaceId,
                    batchId: plan.batchId,
                    planId: plan.id,
                    iterationId: plan.iterationId,
                    planItemId: item.planItemId,
                    pbiIdsJson: JSON.stringify(item.pbiIds),
                    action: item.action,
                    targetType: item.targetType,
                    targetArticleId: item.targetArticleId ?? null,
                    targetFamilyId: item.targetFamilyId ?? null,
                    targetTitle: item.targetTitle,
                    reason: item.reason,
                    evidenceJson: JSON.stringify(item.evidence),
                    confidence: item.confidence,
                    dependsOnJson: item.dependsOn ? JSON.stringify(item.dependsOn) : null,
                    executionStatus: item.executionStatus,
                    createdAtUtc: plan.createdAtUtc
                });
            }
            return plan;
        }
        finally {
            workspaceDb.close();
        }
    }
    async recordBatchPlanReview(review) {
        const workspace = await this.getWorkspace(review.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            workspaceDb.run(`INSERT INTO batch_analysis_reviews (
          id, workspace_id, batch_id, iteration_id, iteration, stage, role, verdict, summary,
          did_account_for_every_pbi, has_missing_creates, has_missing_edits, has_target_issues,
          has_overlap_or_conflict, found_additional_article_work, under_scoped_kb_impact, delta_json,
          plan_id, agent_model_id, session_id, created_at
        ) VALUES (
          @id, @workspaceId, @batchId, @iterationId, @iteration, @stage, @role, @verdict, @summary,
          @didAccountForEveryPbi, @hasMissingCreates, @hasMissingEdits, @hasTargetIssues,
          @hasOverlapOrConflict, @foundAdditionalArticleWork, @underScopedKbImpact, @deltaJson,
          @planId, @agentModelId, @sessionId, @createdAtUtc
        )`, {
                id: review.id,
                workspaceId: review.workspaceId,
                batchId: review.batchId,
                iterationId: review.iterationId,
                iteration: review.iteration,
                stage: review.stage,
                role: review.role,
                verdict: review.verdict,
                summary: review.summary,
                didAccountForEveryPbi: review.didAccountForEveryPbi ? 1 : 0,
                hasMissingCreates: review.hasMissingCreates ? 1 : 0,
                hasMissingEdits: review.hasMissingEdits ? 1 : 0,
                hasTargetIssues: review.hasTargetIssues ? 1 : 0,
                hasOverlapOrConflict: review.hasOverlapOrConflict ? 1 : 0,
                foundAdditionalArticleWork: review.foundAdditionalArticleWork ? 1 : 0,
                underScopedKbImpact: review.underScopedKbImpact ? 1 : 0,
                deltaJson: review.delta ? JSON.stringify(review.delta) : null,
                planId: review.planId ?? null,
                agentModelId: review.agentModelId ?? null,
                sessionId: review.sessionId ?? null,
                createdAtUtc: review.createdAtUtc
            });
            return review;
        }
        finally {
            workspaceDb.close();
        }
    }
    async updateBatchAnalysisPlanItemStatuses(params) {
        if (params.statuses.length === 0) {
            return;
        }
        const workspace = await this.getWorkspace(params.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const statement = workspaceDb.prepare(`UPDATE batch_analysis_plan_items
            SET execution_status = @executionStatus
          WHERE workspace_id = @workspaceId AND plan_id = @planId AND plan_item_id = @planItemId`);
            workspaceDb.exec('BEGIN IMMEDIATE');
            try {
                for (const status of params.statuses) {
                    statement.run({
                        workspaceId: params.workspaceId,
                        planId: params.planId,
                        planItemId: status.planItemId,
                        executionStatus: status.executionStatus
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
    async updateBatchAnalysisDiscoveredWorkStatuses(params) {
        if (params.discoveryIds.length === 0) {
            return;
        }
        const workspace = await this.getWorkspace(params.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const statement = workspaceDb.prepare(`UPDATE batch_analysis_discovered_work
            SET status = @status,
                payload_json = CASE
                  WHEN json_valid(payload_json) THEN json_set(payload_json, '$.status', @status)
                  ELSE payload_json
                END
          WHERE workspace_id = @workspaceId AND batch_id = @batchId AND discovery_id = @discoveryId`);
            workspaceDb.exec('BEGIN IMMEDIATE');
            try {
                for (const discoveryId of Array.from(new Set(params.discoveryIds))) {
                    statement.run({
                        workspaceId: params.workspaceId,
                        batchId: params.batchId,
                        discoveryId,
                        status: params.status
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
    async recordBatchAnalysisQuestionSet(questionSet) {
        const workspace = await this.getWorkspace(questionSet.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            workspaceDb.run(`INSERT INTO batch_analysis_question_sets (
          id, workspace_id, batch_id, iteration_id, source_stage, source_role, resume_stage, resume_role,
          status, summary, plan_id, review_id, created_at, updated_at
        ) VALUES (
          @id, @workspaceId, @batchId, @iterationId, @sourceStage, @sourceRole, @resumeStage, @resumeRole,
          @status, @summary, @planId, @reviewId, @createdAtUtc, @updatedAtUtc
        )`, {
                id: questionSet.id,
                workspaceId: questionSet.workspaceId,
                batchId: questionSet.batchId,
                iterationId: questionSet.iterationId,
                sourceStage: questionSet.sourceStage,
                sourceRole: questionSet.sourceRole,
                resumeStage: questionSet.resumeStage,
                resumeRole: questionSet.resumeRole,
                status: questionSet.status,
                summary: questionSet.summary,
                planId: questionSet.planId ?? null,
                reviewId: questionSet.reviewId ?? null,
                createdAtUtc: questionSet.createdAtUtc,
                updatedAtUtc: questionSet.updatedAtUtc
            });
            return questionSet;
        }
        finally {
            workspaceDb.close();
        }
    }
    async recordBatchAnalysisQuestions(params) {
        if (params.questions.length === 0) {
            return [];
        }
        const workspace = await this.getWorkspace(params.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const idAlreadyExists = workspaceDb.prepare('SELECT id FROM batch_analysis_questions WHERE id = @id LIMIT 1');
            const reservedIds = new Set();
            const persistedQuestions = params.questions.map((question) => {
                const normalizedQuestionId = question.id?.trim() || (0, node_crypto_1.randomUUID)();
                let persistedQuestionId = normalizedQuestionId;
                if (reservedIds.has(persistedQuestionId) || idAlreadyExists.get({ id: persistedQuestionId })) {
                    persistedQuestionId = `${params.questionSetId}:${normalizedQuestionId}`;
                }
                while (reservedIds.has(persistedQuestionId) || idAlreadyExists.get({ id: persistedQuestionId })) {
                    persistedQuestionId = `${params.questionSetId}:${(0, node_crypto_1.randomUUID)()}`;
                }
                reservedIds.add(persistedQuestionId);
                return {
                    ...question,
                    id: persistedQuestionId,
                    questionSetId: params.questionSetId
                };
            });
            workspaceDb.exec('BEGIN IMMEDIATE');
            try {
                persistedQuestions.forEach((question, index) => {
                    workspaceDb.run(`INSERT INTO batch_analysis_questions (
              id, question_set_id, workspace_id, batch_id, iteration_id, question_order, prompt, reason,
              requires_user_input, linked_pbi_ids_json, linked_plan_item_ids_json, linked_discovery_ids_json,
              answer, status, created_at, answered_at
            ) VALUES (
              @id, @questionSetId, @workspaceId, @batchId, @iterationId, @questionOrder, @prompt, @reason,
              @requiresUserInput, @linkedPbiIdsJson, @linkedPlanItemIdsJson, @linkedDiscoveryIdsJson,
              @answer, @status, @createdAtUtc, @answeredAtUtc
            )`, {
                        id: question.id,
                        questionSetId: params.questionSetId,
                        workspaceId: params.workspaceId,
                        batchId: params.batchId,
                        iterationId: params.iterationId,
                        questionOrder: index,
                        prompt: question.prompt,
                        reason: question.reason,
                        requiresUserInput: question.requiresUserInput ? 1 : 0,
                        linkedPbiIdsJson: JSON.stringify(question.linkedPbiIds ?? []),
                        linkedPlanItemIdsJson: JSON.stringify(question.linkedPlanItemIds ?? []),
                        linkedDiscoveryIdsJson: JSON.stringify(question.linkedDiscoveryIds ?? []),
                        answer: question.answer ?? null,
                        status: question.status,
                        createdAtUtc: question.createdAtUtc,
                        answeredAtUtc: question.answeredAtUtc ?? null
                    });
                });
                workspaceDb.exec('COMMIT');
            }
            catch (error) {
                workspaceDb.exec('ROLLBACK');
                throw error;
            }
            return persistedQuestions;
        }
        finally {
            workspaceDb.close();
        }
    }
    async listBatchAnalysisQuestionSets(workspaceId, batchId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            return this.listBatchAnalysisQuestionSetsFromDb(workspaceDb, workspaceId, batchId);
        }
        finally {
            workspaceDb.close();
        }
    }
    async listBatchAnalysisQuestions(workspaceId, batchId, questionSetId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            return this.listBatchAnalysisQuestionsFromDb(workspaceDb, workspaceId, batchId, questionSetId);
        }
        finally {
            workspaceDb.close();
        }
    }
    async answerBatchAnalysisQuestion(request) {
        const workspace = await this.getWorkspace(request.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        const trimmedAnswer = request.answer.trim();
        if (!trimmedAnswer) {
            throw new Error('Question answers cannot be empty.');
        }
        try {
            workspaceDb.exec('BEGIN IMMEDIATE');
            try {
                const existingQuestion = workspaceDb.get(`SELECT id,
                  question_set_id as questionSetId,
                  workspace_id as workspaceId,
                  batch_id as batchId,
                  iteration_id as iterationId,
                  question_order as questionOrder,
                  prompt,
                  reason,
                  requires_user_input as requiresUserInput,
                  linked_pbi_ids_json as linkedPbiIdsJson,
                  linked_plan_item_ids_json as linkedPlanItemIdsJson,
                  linked_discovery_ids_json as linkedDiscoveryIdsJson,
                  answer,
                  status,
                  created_at as createdAtUtc,
                  answered_at as answeredAtUtc
             FROM batch_analysis_questions
            WHERE workspace_id = @workspaceId AND batch_id = @batchId AND id = @questionId`, {
                    workspaceId: request.workspaceId,
                    batchId: request.batchId,
                    questionId: request.questionId
                });
                if (!existingQuestion) {
                    throw new Error('Question not found.');
                }
                const answeredAtUtc = new Date().toISOString();
                workspaceDb.run(`UPDATE batch_analysis_questions
              SET answer = @answer,
                  status = 'answered',
                  answered_at = @answeredAtUtc
            WHERE workspace_id = @workspaceId AND batch_id = @batchId AND id = @questionId`, {
                    workspaceId: request.workspaceId,
                    batchId: request.batchId,
                    questionId: request.questionId,
                    answer: trimmedAnswer,
                    answeredAtUtc
                });
                const questionSetRow = workspaceDb.get(`SELECT id,
                  workspace_id as workspaceId,
                  batch_id as batchId,
                  iteration_id as iterationId,
                  source_stage as sourceStage,
                  source_role as sourceRole,
                  resume_stage as resumeStage,
                  resume_role as resumeRole,
                  status,
                  summary,
                  plan_id as planId,
                  review_id as reviewId,
                  created_at as createdAtUtc,
                  updated_at as updatedAtUtc
             FROM batch_analysis_question_sets
            WHERE workspace_id = @workspaceId AND id = @questionSetId`, {
                    workspaceId: request.workspaceId,
                    questionSetId: existingQuestion.questionSetId
                });
                if (!questionSetRow) {
                    throw new Error('Question set not found.');
                }
                const questions = this.listBatchAnalysisQuestionsFromDb(workspaceDb, request.workspaceId, request.batchId, existingQuestion.questionSetId).map((question) => (question.id === request.questionId
                    ? {
                        ...question,
                        answer: trimmedAnswer,
                        status: 'answered',
                        answeredAtUtc
                    }
                    : question));
                const unansweredRequiredQuestionCount = questions.filter((question) => question.requiresUserInput
                    && question.status === 'pending'
                    && !question.answer?.trim()).length;
                workspaceDb.exec('COMMIT');
                return {
                    question: questions.find((question) => question.id === request.questionId),
                    questionSet: this.mapBatchAnalysisQuestionSetRow(questionSetRow),
                    unansweredRequiredQuestionCount
                };
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
    async markBatchAnalysisQuestionSetReadyToResume(params) {
        return this.transitionBatchAnalysisQuestionSetStatus({
            workspaceId: params.workspaceId,
            questionSetId: params.questionSetId,
            fromStatuses: ['waiting'],
            toStatus: 'ready_to_resume'
        });
    }
    async markBatchAnalysisQuestionSetResuming(params) {
        return this.transitionBatchAnalysisQuestionSetStatus({
            workspaceId: params.workspaceId,
            questionSetId: params.questionSetId,
            fromStatuses: ['ready_to_resume'],
            toStatus: 'resuming'
        });
    }
    async getLatestPendingBatchAnalysisQuestionSet(workspaceId, batchId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            return this.getLatestPendingBatchAnalysisQuestionSetFromDb(workspaceDb, workspaceId, batchId);
        }
        finally {
            workspaceDb.close();
        }
    }
    async resolveBatchAnalysisQuestionSet(params) {
        const workspace = await this.getWorkspace(params.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            workspaceDb.exec('BEGIN IMMEDIATE');
            try {
                const updatedAtUtc = new Date().toISOString();
                workspaceDb.run(`UPDATE batch_analysis_question_sets
              SET status = 'resolved',
                  updated_at = @updatedAtUtc
            WHERE workspace_id = @workspaceId AND id = @questionSetId`, {
                    workspaceId: params.workspaceId,
                    questionSetId: params.questionSetId,
                    updatedAtUtc
                });
                workspaceDb.run(`UPDATE batch_analysis_questions
              SET status = CASE
                WHEN status = 'answered' THEN 'resolved'
                ELSE status
              END
            WHERE workspace_id = @workspaceId AND question_set_id = @questionSetId`, {
                    workspaceId: params.workspaceId,
                    questionSetId: params.questionSetId
                });
                workspaceDb.exec('COMMIT');
            }
            catch (error) {
                workspaceDb.exec('ROLLBACK');
                throw error;
            }
            const row = workspaceDb.get(`SELECT id,
                workspace_id as workspaceId,
                batch_id as batchId,
                iteration_id as iterationId,
                source_stage as sourceStage,
                source_role as sourceRole,
                resume_stage as resumeStage,
                resume_role as resumeRole,
                status,
                summary,
                plan_id as planId,
                review_id as reviewId,
                created_at as createdAtUtc,
                updated_at as updatedAtUtc
           FROM batch_analysis_question_sets
          WHERE workspace_id = @workspaceId AND id = @questionSetId`, {
                workspaceId: params.workspaceId,
                questionSetId: params.questionSetId
            });
            return row ? this.mapBatchAnalysisQuestionSetRow(row) : null;
        }
        finally {
            workspaceDb.close();
        }
    }
    async recordBatchPlanAmendment(amendment) {
        const workspace = await this.getWorkspace(amendment.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            workspaceDb.run(`INSERT INTO batch_analysis_amendments (
          id, workspace_id, batch_id, iteration_id, approved_plan_id, source_worker_report_id,
          source_discovery_ids_json, proposed_plan_id, review_id, status, summary, created_at, updated_at
        ) VALUES (
          @id, @workspaceId, @batchId, @iterationId, @approvedPlanId, @sourceWorkerReportId,
          @sourceDiscoveryIdsJson, @proposedPlanId, @reviewId, @status, @summary, @createdAtUtc, @updatedAtUtc
        )`, {
                id: amendment.id,
                workspaceId: amendment.workspaceId,
                batchId: amendment.batchId,
                iterationId: amendment.iterationId,
                approvedPlanId: amendment.approvedPlanId ?? null,
                sourceWorkerReportId: amendment.sourceWorkerReportId,
                sourceDiscoveryIdsJson: JSON.stringify(amendment.sourceDiscoveryIds),
                proposedPlanId: amendment.proposedPlanId ?? null,
                reviewId: amendment.reviewId ?? null,
                status: amendment.status,
                summary: amendment.summary,
                createdAtUtc: amendment.createdAtUtc,
                updatedAtUtc: amendment.updatedAtUtc
            });
            return amendment;
        }
        finally {
            workspaceDb.close();
        }
    }
    async recordBatchFinalReview(review) {
        const workspace = await this.getWorkspace(review.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            workspaceDb.run(`INSERT INTO batch_analysis_final_reviews (
          id, workspace_id, batch_id, iteration_id, iteration, stage, role, verdict, summary,
          all_pbis_mapped, plan_execution_complete, has_missing_article_changes, has_unresolved_discovered_work,
          delta_json, plan_id, worker_report_id, agent_model_id, session_id, created_at
        ) VALUES (
          @id, @workspaceId, @batchId, @iterationId, @iteration, @stage, @role, @verdict, @summary,
          @allPbisMapped, @planExecutionComplete, @hasMissingArticleChanges, @hasUnresolvedDiscoveredWork,
          @deltaJson, @planId, @workerReportId, @agentModelId, @sessionId, @createdAtUtc
        )`, {
                id: review.id,
                workspaceId: review.workspaceId,
                batchId: review.batchId,
                iterationId: review.iterationId,
                iteration: review.iteration,
                stage: review.stage,
                role: review.role,
                verdict: review.verdict,
                summary: review.summary,
                allPbisMapped: review.allPbisMapped ? 1 : 0,
                planExecutionComplete: review.planExecutionComplete ? 1 : 0,
                hasMissingArticleChanges: review.hasMissingArticleChanges ? 1 : 0,
                hasUnresolvedDiscoveredWork: review.hasUnresolvedDiscoveredWork ? 1 : 0,
                deltaJson: review.delta ? JSON.stringify(review.delta) : null,
                planId: review.planId ?? null,
                workerReportId: review.workerReportId ?? null,
                agentModelId: review.agentModelId ?? null,
                sessionId: review.sessionId ?? null,
                createdAtUtc: review.createdAtUtc
            });
            return review;
        }
        finally {
            workspaceDb.close();
        }
    }
    async recordBatchAnalysisStageEvent(event) {
        const workspace = await this.getWorkspace(event.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            workspaceDb.run(`INSERT INTO batch_analysis_stage_events (
          id, workspace_id, batch_id, iteration_id, iteration, stage, role, event_type, status, summary,
          session_id, agent_model_id, approved_plan_id, last_review_verdict, outstanding_discovered_work_count,
          execution_counts_json, details_json, created_at
        ) VALUES (
          @id, @workspaceId, @batchId, @iterationId, @iteration, @stage, @role, @eventType, @status, @summary,
          @sessionId, @agentModelId, @approvedPlanId, @lastReviewVerdict, @outstandingDiscoveredWorkCount,
          @executionCountsJson, @detailsJson, @createdAtUtc
        )`, {
                id: event.id,
                workspaceId: event.workspaceId,
                batchId: event.batchId,
                iterationId: event.iterationId,
                iteration: event.iteration,
                stage: event.stage,
                role: event.role,
                eventType: event.eventType,
                status: event.status ?? null,
                summary: event.summary ?? null,
                sessionId: event.sessionId ?? null,
                agentModelId: event.agentModelId ?? null,
                approvedPlanId: event.approvedPlanId ?? null,
                lastReviewVerdict: event.lastReviewVerdict ?? null,
                outstandingDiscoveredWorkCount: event.outstandingDiscoveredWorkCount,
                executionCountsJson: JSON.stringify(this.normalizeBatchAnalysisExecutionCounts(event.executionCounts)),
                detailsJson: event.details ? JSON.stringify(event.details) : null,
                createdAtUtc: event.createdAtUtc
            });
            return event;
        }
        finally {
            workspaceDb.close();
        }
    }
    async getBatchAnalysisSnapshot(workspaceId, batchId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const latestIteration = this.getLatestBatchAnalysisIterationFromDb(workspaceDb, workspaceId, batchId);
            const latestApprovedPlan = this.getLatestApprovedBatchAnalysisPlanFromDb(workspaceDb, workspaceId, batchId);
            const latestPlanReview = this.getLatestBatchAnalysisReviewFromDb(workspaceDb, workspaceId, batchId);
            const latestWorkerReport = this.getLatestBatchAnalysisWorkerReportFromDb(workspaceDb, workspaceId, batchId);
            const latestFinalReview = this.getLatestBatchAnalysisFinalReviewFromDb(workspaceDb, workspaceId, batchId);
            const activeQuestionSet = this.getLatestPendingBatchAnalysisQuestionSetFromDb(workspaceDb, workspaceId, batchId);
            const questions = activeQuestionSet
                ? this.listBatchAnalysisQuestionsFromDb(workspaceDb, workspaceId, batchId, activeQuestionSet.id)
                : [];
            const unansweredRequiredQuestionCount = questions.filter((question) => question.requiresUserInput
                && question.status === 'pending'
                && !question.answer?.trim()).length;
            const discoveredWork = workspaceDb.all(`SELECT payload_json as payloadJson,
                status as status
           FROM batch_analysis_discovered_work
          WHERE workspace_id = @workspaceId AND batch_id = @batchId
          ORDER BY created_at DESC`, { workspaceId, batchId }).flatMap((row) => {
                const item = this.parseBatchDiscoveredWorkRow(row);
                return item ? [item] : [];
            });
            return {
                workspaceId,
                batchId,
                latestIteration,
                latestApprovedPlan,
                latestPlanReview,
                latestWorkerReport,
                latestFinalReview,
                discoveredWork,
                activeQuestionSet,
                questions,
                pausedForUserInput: Boolean(activeQuestionSet),
                unansweredRequiredQuestionCount
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getBatchAnalysisInspection(workspaceId, batchId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const snapshot = await this.getBatchAnalysisSnapshot(workspaceId, batchId);
            const iterations = this.listBatchAnalysisIterationsFromDb(workspaceDb, workspaceId, batchId);
            const stageRuns = this.listBatchAnalysisStageRunsFromDb(workspaceDb, workspaceId, batchId);
            const plans = this.listBatchAnalysisPlansFromDb(workspaceDb, workspaceId, batchId);
            const reviews = this.listBatchAnalysisReviewsFromDb(workspaceDb, workspaceId, batchId);
            const workerReports = this.listBatchAnalysisWorkerReportsFromDb(workspaceDb, workspaceId, batchId);
            const discoveredWork = this.listBatchAnalysisDiscoveredWorkFromDb(workspaceDb, workspaceId, batchId);
            const questionSets = this.listBatchAnalysisQuestionSetsFromDb(workspaceDb, workspaceId, batchId);
            const questions = this.listBatchAnalysisQuestionsFromDb(workspaceDb, workspaceId, batchId);
            const amendments = this.listBatchAnalysisAmendmentsFromDb(workspaceDb, workspaceId, batchId);
            const finalReviews = this.listBatchAnalysisFinalReviewsFromDb(workspaceDb, workspaceId, batchId);
            const latestPlanId = plans[0]?.id;
            const supersededPlans = latestPlanId ? plans.filter((plan) => plan.id !== latestPlanId) : [];
            const reviewDeltas = reviews
                .filter((review) => review.delta)
                .map((review) => ({
                reviewId: review.id,
                iterationId: review.iterationId,
                iteration: review.iteration,
                stage: review.stage,
                verdict: review.verdict,
                summary: review.summary,
                createdAtUtc: review.createdAtUtc,
                planId: review.planId,
                delta: review.delta
            }));
            const finalReviewReworkPlans = finalReviews
                .filter((review) => review.delta && review.verdict === 'needs_rework')
                .map((review) => ({
                finalReviewId: review.id,
                iterationId: review.iterationId,
                iteration: review.iteration,
                verdict: review.verdict,
                summary: review.summary,
                createdAtUtc: review.createdAtUtc,
                planId: review.planId,
                workerReportId: review.workerReportId,
                delta: review.delta
            }));
            const transcriptLinks = [
                ...iterations.flatMap((iteration) => iteration.sessionId ? [{
                        artifactType: 'iteration',
                        artifactId: iteration.id,
                        iterationId: iteration.id,
                        iteration: iteration.iteration,
                        stage: iteration.stage,
                        role: iteration.role,
                        sessionId: iteration.sessionId,
                        agentModelId: iteration.agentModelId,
                        createdAtUtc: iteration.startedAtUtc
                    }] : []),
                ...plans.flatMap((plan) => plan.sessionId ? [{
                        artifactType: 'plan',
                        artifactId: plan.id,
                        iterationId: plan.iterationId,
                        iteration: plan.iteration,
                        stage: plan.stage,
                        role: plan.role,
                        sessionId: plan.sessionId,
                        agentModelId: plan.agentModelId,
                        createdAtUtc: plan.createdAtUtc
                    }] : []),
                ...reviews.flatMap((review) => review.sessionId ? [{
                        artifactType: 'review',
                        artifactId: review.id,
                        iterationId: review.iterationId,
                        iteration: review.iteration,
                        stage: review.stage,
                        role: review.role,
                        sessionId: review.sessionId,
                        agentModelId: review.agentModelId,
                        createdAtUtc: review.createdAtUtc
                    }] : []),
                ...workerReports.flatMap((report) => report.sessionId ? [{
                        artifactType: 'worker_report',
                        artifactId: report.id,
                        iterationId: report.iterationId,
                        iteration: report.iteration,
                        stage: report.stage,
                        role: report.role,
                        sessionId: report.sessionId,
                        agentModelId: report.agentModelId,
                        createdAtUtc: report.createdAtUtc
                    }] : []),
                ...amendments.map((amendment) => ({
                    artifactType: 'amendment',
                    artifactId: amendment.id,
                    iterationId: amendment.iterationId,
                    stage: 'worker_discovery_review',
                    role: 'planner',
                    createdAtUtc: amendment.createdAtUtc
                })),
                ...finalReviews.flatMap((review) => review.sessionId ? [{
                        artifactType: 'final_review',
                        artifactId: review.id,
                        iterationId: review.iterationId,
                        iteration: review.iteration,
                        stage: review.stage,
                        role: review.role,
                        sessionId: review.sessionId,
                        agentModelId: review.agentModelId,
                        createdAtUtc: review.createdAtUtc
                    }] : []),
                ...stageRuns.flatMap((run) => run.localSessionId ? [{
                        artifactType: 'stage_run',
                        artifactId: run.id,
                        iterationId: run.iterationId,
                        iteration: run.iteration,
                        stage: run.stage,
                        role: run.role,
                        sessionId: run.localSessionId,
                        transcriptPath: run.transcriptPath,
                        agentModelId: run.agentModelId,
                        createdAtUtc: run.createdAtUtc
                    }] : [])
            ].sort((left, right) => left.createdAtUtc.localeCompare(right.createdAtUtc));
            const timeline = [
                ...iterations.map((iteration) => ({
                    artifactType: 'iteration',
                    artifactId: iteration.id,
                    iterationId: iteration.id,
                    iteration: iteration.iteration,
                    stage: iteration.stage,
                    role: iteration.role,
                    status: iteration.status,
                    verdict: iteration.lastReviewVerdict,
                    summary: iteration.summary,
                    sessionId: iteration.sessionId,
                    agentModelId: iteration.agentModelId,
                    createdAtUtc: iteration.startedAtUtc
                })),
                ...plans.map((plan) => ({
                    artifactType: 'plan',
                    artifactId: plan.id,
                    iterationId: plan.iterationId,
                    iteration: plan.iteration,
                    stage: plan.stage,
                    role: plan.role,
                    verdict: plan.verdict,
                    summary: plan.summary,
                    relatedPlanId: plan.supersedesPlanId,
                    sessionId: plan.sessionId,
                    agentModelId: plan.agentModelId,
                    createdAtUtc: plan.createdAtUtc
                })),
                ...reviews.map((review) => ({
                    artifactType: 'review',
                    artifactId: review.id,
                    iterationId: review.iterationId,
                    iteration: review.iteration,
                    stage: review.stage,
                    role: review.role,
                    verdict: review.verdict,
                    summary: review.summary,
                    relatedPlanId: review.planId,
                    sessionId: review.sessionId,
                    agentModelId: review.agentModelId,
                    createdAtUtc: review.createdAtUtc
                })),
                ...workerReports.map((report) => ({
                    artifactType: 'worker_report',
                    artifactId: report.id,
                    iterationId: report.iterationId,
                    iteration: report.iteration,
                    stage: report.stage,
                    role: report.role,
                    status: report.status,
                    summary: report.summary,
                    relatedPlanId: report.planId,
                    sessionId: report.sessionId,
                    agentModelId: report.agentModelId,
                    createdAtUtc: report.createdAtUtc
                })),
                ...amendments.map((amendment) => ({
                    artifactType: 'amendment',
                    artifactId: amendment.id,
                    iterationId: amendment.iterationId,
                    stage: 'worker_discovery_review',
                    role: 'planner',
                    status: amendment.status,
                    summary: amendment.summary,
                    relatedPlanId: amendment.proposedPlanId ?? amendment.approvedPlanId,
                    relatedReviewId: amendment.reviewId,
                    relatedWorkerReportId: amendment.sourceWorkerReportId,
                    createdAtUtc: amendment.createdAtUtc
                })),
                ...finalReviews.map((review) => ({
                    artifactType: 'final_review',
                    artifactId: review.id,
                    iterationId: review.iterationId,
                    iteration: review.iteration,
                    stage: review.stage,
                    role: review.role,
                    verdict: review.verdict,
                    summary: review.summary,
                    relatedPlanId: review.planId,
                    relatedWorkerReportId: review.workerReportId,
                    sessionId: review.sessionId,
                    agentModelId: review.agentModelId,
                    createdAtUtc: review.createdAtUtc
                })),
                ...stageRuns.map((run) => ({
                    artifactType: 'stage_run',
                    artifactId: run.id,
                    iterationId: run.iterationId,
                    iteration: run.iteration,
                    stage: run.stage,
                    role: run.role,
                    status: run.status,
                    summary: run.message,
                    sessionId: run.localSessionId,
                    agentModelId: run.agentModelId,
                    createdAtUtc: run.createdAtUtc
                }))
            ].sort((left, right) => left.createdAtUtc.localeCompare(right.createdAtUtc));
            return {
                workspaceId,
                batchId,
                snapshot,
                iterations,
                stageRuns,
                plans,
                supersededPlans,
                reviews,
                reviewDeltas,
                workerReports,
                discoveredWork,
                questionSets,
                questions,
                amendments,
                finalReviews,
                finalReviewReworkPlans,
                timeline,
                transcriptLinks
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getBatchAnalysisRuntimeStatus(workspaceId, batchId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const latestIteration = this.getLatestBatchAnalysisIterationFromDb(workspaceDb, workspaceId, batchId);
            const latestEvent = this.getLatestBatchAnalysisStageEventFromDb(workspaceDb, workspaceId, batchId);
            if (!latestIteration && !latestEvent) {
                return null;
            }
            const activeQuestionSet = this.getLatestPendingBatchAnalysisQuestionSetFromDb(workspaceDb, workspaceId, batchId);
            const questions = activeQuestionSet
                ? this.listBatchAnalysisQuestionsFromDb(workspaceDb, workspaceId, batchId, activeQuestionSet.id)
                : [];
            const unansweredRequiredQuestionCount = questions.filter((question) => question.requiresUserInput
                && question.status === 'pending'
                && !question.answer?.trim()).length;
            return {
                workspaceId,
                batchId,
                iterationId: latestIteration?.id ?? latestEvent?.iterationId,
                iteration: latestIteration?.iteration ?? latestEvent?.iteration,
                iterationStatus: latestIteration?.status ?? latestEvent?.status,
                stage: latestIteration?.stage ?? latestEvent?.stage,
                role: latestIteration?.role ?? latestEvent?.role,
                agentModelId: latestIteration?.agentModelId ?? latestEvent?.agentModelId,
                sessionId: latestIteration?.sessionId ?? latestEvent?.sessionId,
                approvedPlanId: latestIteration?.approvedPlanId ?? latestEvent?.approvedPlanId,
                lastReviewVerdict: latestIteration?.lastReviewVerdict ?? latestEvent?.lastReviewVerdict,
                outstandingDiscoveredWorkCount: latestIteration?.outstandingDiscoveredWorkCount ?? latestEvent?.outstandingDiscoveredWorkCount ?? 0,
                activeQuestionSetId: activeQuestionSet?.id,
                activeQuestionSetStatus: activeQuestionSet?.status,
                pausedForUserInput: Boolean(activeQuestionSet),
                unansweredRequiredQuestionCount,
                executionCounts: latestIteration?.executionCounts ?? latestEvent?.executionCounts ?? this.normalizeBatchAnalysisExecutionCounts(),
                stageStartedAtUtc: latestEvent?.createdAtUtc ?? latestIteration?.startedAtUtc,
                stageEndedAtUtc: latestIteration?.endedAtUtc,
                updatedAtUtc: latestIteration?.updatedAtUtc ?? latestEvent?.createdAtUtc,
                latestEventId: latestEvent?.id,
                latestEventType: latestEvent?.eventType
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getBatchAnalysisEventStream(workspaceId, batchId, limit = 100) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 100;
            return {
                workspaceId,
                batchId,
                events: this.listBatchAnalysisStageEventsFromDb(workspaceDb, workspaceId, batchId, normalizedLimit)
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async recordAgentNotes(input) {
        const workspace = await this.getWorkspace(input.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const note = extractString(input.note);
            if (!note) {
                throw new Error('note is required');
            }
            const noteId = (0, node_crypto_1.randomUUID)();
            const createdAtUtc = new Date().toISOString();
            const sessionId = extractString(input.sessionId);
            const batchId = extractString(input.batchId);
            const localeVariantId = extractString(input.localeVariantId);
            const familyId = extractString(input.familyId);
            const rationale = extractString(input.rationale);
            const pbiIds = normalizeSearchIdList(input.pbiIds);
            const metadata = input.metadata;
            workspaceDb.run(`INSERT INTO agent_notes (
          id, workspace_id, session_id, batch_id, locale_variant_id, family_id, note, rationale, metadata_json, pbi_ids_json, created_at
        ) VALUES (
          @id, @workspaceId, @sessionId, @batchId, @localeVariantId, @familyId, @note, @rationale, @metadataJson, @pbiIdsJson, @createdAt
        )`, {
                id: noteId,
                workspaceId: input.workspaceId,
                sessionId: sessionId ?? null,
                batchId: batchId ?? null,
                localeVariantId: localeVariantId ?? null,
                familyId: familyId ?? null,
                note,
                rationale: rationale ?? null,
                metadataJson: metadata === undefined ? null : JSON.stringify(metadata),
                pbiIdsJson: pbiIds.length > 0 ? JSON.stringify(pbiIds) : null,
                createdAt: createdAtUtc
            });
            return {
                ok: true,
                workspaceId: input.workspaceId,
                noteId,
                recorded: true,
                sessionId,
                batchId,
                localeVariantId,
                familyId,
                note,
                rationale,
                pbiIds,
                metadata,
                createdAtUtc
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
            const now = new Date().toISOString();
            const inputMetadata = normalizeProposalMetadata(params.metadata);
            if (params.idempotencyKey?.trim() && !extractString(inputMetadata._agentCommandKey)) {
                inputMetadata._agentCommandKey = params.idempotencyKey.trim();
            }
            const hasStructuredContent = Boolean(params.sourceHtml?.trim()
                || params.proposedHtml?.trim()
                || extractString(inputMetadata.sourceHtml)
                || extractString(inputMetadata.proposedHtml));
            const hasMeaningfulContext = Boolean(params.note?.trim()
                || params.rationale?.trim()
                || params.rationaleSummary?.trim()
                || params.aiNotes?.trim()
                || Object.keys(inputMetadata).length > 0
                || params.relatedPbiIds?.length
                || hasStructuredContent);
            if (!hasMeaningfulContext) {
                throw new Error('Proposal must include notes, rationale, metadata, linked PBIs, or HTML content');
            }
            const identity = await this.resolveProposalIdentity(workspaceDb, {
                workspaceId: params.workspaceId,
                action: params.action,
                localeVariantId: params.localeVariantId,
                familyId: params.familyId,
                targetTitle: params.targetTitle,
                targetLocale: params.targetLocale,
                note: params.note,
                rationale: params.rationale,
                metadata: inputMetadata
            });
            const targetTitle = identity.targetTitle;
            const targetLocale = identity.targetLocale;
            const existingProposal = (params.idempotencyKey?.trim()
                ? this.findOpenProposalByIdempotencyKey(workspaceDb, {
                    workspaceId: params.workspaceId,
                    batchId: params.batchId,
                    idempotencyKey: params.idempotencyKey.trim()
                })
                : null)
                ?? this.findOpenMatchingProposal(workspaceDb, {
                    workspaceId: params.workspaceId,
                    batchId: params.batchId,
                    action: params.action,
                    localeVariantId: params.localeVariantId,
                    familyId: identity.familyId,
                    targetTitle,
                    targetLocale
                });
            const metadata = mergePersistedProposalMetadata(existingProposal
                ? this.getStoredProposalMetadata(workspaceDb, params.workspaceId, existingProposal.id)
                : undefined, inputMetadata, {
                runtimeSessionId: params._sessionId,
                kbAccessMode: params.kbAccessMode,
                acpSessionId: params.acpSessionId,
                originPath: params.originPath
            });
            const rationale = params.rationale ?? params.note ?? undefined;
            const rationaleSummary = params.rationaleSummary ?? extractString(metadata.rationaleSummary) ?? rationale;
            const aiNotes = params.aiNotes ?? params.note ?? extractString(metadata.aiNotes) ?? undefined;
            if (params.action === shared_types_1.ProposalAction.CREATE && !targetTitle) {
                throw new Error('Create proposals must include a targetTitle or note/rationale text that clearly names the article');
            }
            const suggestedPlacement = params.suggestedPlacement ?? normalizePlacement(metadata.suggestedPlacement);
            const confidenceScore = normalizeConfidenceScore(params.confidenceScore ?? metadata.confidenceScore);
            const reviewStatus = params.reviewStatus ?? shared_types_1.ProposalReviewStatus.PENDING_REVIEW;
            const status = shared_types_1.ProposalDecision.DEFER;
            const sourceRevisionId = params.sourceRevisionId ?? extractString(metadata.sourceRevisionId) ?? null;
            const proposalId = existingProposal?.id ?? (0, node_crypto_1.randomUUID)();
            const queueOrder = existingProposal?.queueOrder ?? (workspaceDb.get(`SELECT COALESCE(MAX(queue_order), 0) + 1 as nextOrder
           FROM proposals
           WHERE batch_id = @batchId`, { batchId: params.batchId })?.nextOrder ?? 1);
            const artifacts = await this.persistProposalArtifacts(workspace.path, proposalId, {
                sourceHtml: params.sourceHtml ?? extractString(metadata.sourceHtml) ?? '',
                proposedHtml: params.proposedHtml ?? extractString(metadata.proposedHtml) ?? '',
                metadata
            });
            if (existingProposal) {
                workspaceDb.run(`UPDATE proposals
           SET locale_variant_id = COALESCE(@localeVariantId, locale_variant_id),
               status = @status,
               rationale = @rationale,
               updated_at = @updatedAt,
               review_status = @reviewStatus,
               family_id = COALESCE(@familyId, family_id),
               source_revision_id = COALESCE(@sourceRevisionId, source_revision_id),
               target_title = COALESCE(@targetTitle, target_title),
               target_locale = COALESCE(@targetLocale, target_locale),
               confidence_score = COALESCE(@confidenceScore, confidence_score),
               rationale_summary = COALESCE(@rationaleSummary, rationale_summary),
               ai_notes = COALESCE(@aiNotes, ai_notes),
               suggested_placement_json = COALESCE(@suggestedPlacementJson, suggested_placement_json),
               source_html_path = COALESCE(@sourceHtmlPath, source_html_path),
               proposed_html_path = COALESCE(@proposedHtmlPath, proposed_html_path),
               metadata_json = COALESCE(@metadataJson, metadata_json),
               agent_session_id = COALESCE(@sessionId, agent_session_id)
           WHERE workspace_id = @workspaceId AND id = @proposalId`, {
                    proposalId,
                    workspaceId: params.workspaceId,
                    localeVariantId: params.localeVariantId ?? null,
                    status,
                    rationale: rationale ?? null,
                    updatedAt: now,
                    reviewStatus,
                    familyId: identity.familyId ?? null,
                    sourceRevisionId,
                    targetTitle: targetTitle ?? null,
                    targetLocale: targetLocale ?? null,
                    confidenceScore: confidenceScore ?? null,
                    rationaleSummary: rationaleSummary ?? null,
                    aiNotes: aiNotes ?? null,
                    suggestedPlacementJson: suggestedPlacement ? JSON.stringify(suggestedPlacement) : null,
                    sourceHtmlPath: artifacts.sourceHtmlPath ?? null,
                    proposedHtmlPath: artifacts.proposedHtmlPath ?? null,
                    metadataJson: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
                    sessionId: params._sessionId ?? null
                });
            }
            else {
                workspaceDb.run(`INSERT INTO proposals (
            id, workspace_id, batch_id, action, locale_variant_id, branch_id, status, rationale, generated_at, updated_at,
            review_status, queue_order, family_id, source_revision_id, target_title, target_locale, confidence_score,
            rationale_summary, ai_notes, suggested_placement_json, source_html_path, proposed_html_path, metadata_json,
            decision_payload_json, decided_at, agent_session_id
          ) VALUES (
            @id, @workspaceId, @batchId, @action, @localeVariantId, @branchId, @status, @rationale, @generatedAt, @updatedAt,
            @reviewStatus, @queueOrder, @familyId, @sourceRevisionId, @targetTitle, @targetLocale, @confidenceScore,
            @rationaleSummary, @aiNotes, @suggestedPlacementJson, @sourceHtmlPath, @proposedHtmlPath, @metadataJson,
            @decisionPayloadJson, @decidedAt, @sessionId
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
                    updatedAt: now,
                    reviewStatus,
                    queueOrder,
                    familyId: identity.familyId ?? null,
                    sourceRevisionId,
                    targetTitle: targetTitle ?? null,
                    targetLocale: targetLocale ?? null,
                    confidenceScore: confidenceScore ?? null,
                    rationaleSummary: rationaleSummary ?? null,
                    aiNotes: aiNotes ?? null,
                    suggestedPlacementJson: suggestedPlacement ? JSON.stringify(suggestedPlacement) : null,
                    sourceHtmlPath: artifacts.sourceHtmlPath ?? null,
                    proposedHtmlPath: artifacts.proposedHtmlPath ?? null,
                    metadataJson: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
                    decisionPayloadJson: null,
                    decidedAt: null,
                    sessionId: params._sessionId ?? null
                });
            }
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
            await this.syncBatchReviewStatus(workspaceDb, params.workspaceId, params.batchId);
            const row = workspaceDb.get(`
        SELECT p.id,
               p.workspace_id as workspaceId,
               p.batch_id as batchId,
               p.action,
               p.locale_variant_id as localeVariantId,
               p.branch_id as branchId,
               p.status,
               p.rationale,
               p.generated_at as generatedAtUtc,
               p.updated_at as updatedAtUtc,
               p.review_status as reviewStatus,
               p.queue_order as queueOrder,
               p.family_id as familyId,
               p.source_revision_id as sourceRevisionId,
               p.target_title as targetTitle,
               p.target_locale as targetLocale,
               p.confidence_score as confidenceScore,
               p.rationale_summary as rationaleSummary,
               p.ai_notes as aiNotes,
               p.suggested_placement_json as suggestedPlacementJson,
               p.source_html_path as sourceHtmlPath,
               p.proposed_html_path as proposedHtmlPath,
               p.metadata_json as metadataJson,
               p.decision_payload_json as decisionPayloadJson,
               p.decided_at as decidedAtUtc,
               p.agent_session_id as sessionId
        FROM proposals p
        WHERE p.id = @proposalId
      `, { proposalId });
            if (!row) {
                throw new Error('Failed to load saved proposal');
            }
            return this.mapProposalRow(row);
        }
        finally {
            workspaceDb.close();
        }
    }
    async annotateProposalProvenanceForSession(params) {
        const sessionId = params.sessionId.trim();
        if (!sessionId) {
            return { updatedProposalIds: [] };
        }
        const workspace = await this.getWorkspace(params.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const rows = workspaceDb.all(`SELECT id,
                metadata_json as metadataJson
           FROM proposals
          WHERE workspace_id = @workspaceId
            AND batch_id = @batchId
            AND agent_session_id = @sessionId`, {
                workspaceId: params.workspaceId,
                batchId: params.batchId,
                sessionId
            });
            const updatedProposalIds = [];
            for (const row of rows) {
                const existingMetadata = safeParseJson(row.metadataJson) ?? {};
                const nextMetadata = mergePersistedProposalMetadata(existingMetadata, undefined, {
                    runtimeSessionId: sessionId,
                    kbAccessMode: params.kbAccessMode,
                    acpSessionId: params.acpSessionId,
                    originPath: params.originPath
                });
                if (JSON.stringify(existingMetadata) === JSON.stringify(nextMetadata)) {
                    continue;
                }
                await this.persistProposalArtifacts(workspace.path, row.id, {
                    metadata: nextMetadata
                });
                workspaceDb.run(`UPDATE proposals
           SET metadata_json = @metadataJson
           WHERE workspace_id = @workspaceId AND id = @proposalId`, {
                    workspaceId: params.workspaceId,
                    proposalId: row.id,
                    metadataJson: Object.keys(nextMetadata).length > 0 ? JSON.stringify(nextMetadata) : null
                });
                updatedProposalIds.push(row.id);
            }
            return { updatedProposalIds };
        }
        finally {
            workspaceDb.close();
        }
    }
    async listBatchProposalRecords(workspaceId, batchId, options) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const rows = workspaceDb.all(`
        SELECT p.id,
               p.workspace_id as workspaceId,
               p.batch_id as batchId,
               p.action,
               p.locale_variant_id as localeVariantId,
               p.branch_id as branchId,
               p.status,
               p.rationale,
               p.generated_at as generatedAtUtc,
               p.updated_at as updatedAtUtc,
               p.review_status as reviewStatus,
               p.queue_order as queueOrder,
               p.family_id as familyId,
               p.source_revision_id as sourceRevisionId,
               p.target_title as targetTitle,
               p.target_locale as targetLocale,
               p.confidence_score as confidenceScore,
               p.rationale_summary as rationaleSummary,
               p.ai_notes as aiNotes,
               p.suggested_placement_json as suggestedPlacementJson,
               p.source_html_path as sourceHtmlPath,
               p.proposed_html_path as proposedHtmlPath,
               p.metadata_json as metadataJson,
               p.decision_payload_json as decisionPayloadJson,
               p.decided_at as decidedAtUtc,
               p.agent_session_id as sessionId
        FROM proposals p
        WHERE p.workspace_id = @workspaceId AND p.batch_id = @batchId
        ORDER BY p.queue_order ASC, p.generated_at ASC
      `, { workspaceId, batchId });
            const includeStaged = options?.includeStaged === true;
            const reviewStatusFilter = options?.reviewStatuses ? new Set(options.reviewStatuses) : null;
            return rows
                .map((row) => this.hydrateProposalDisplayFields(this.mapProposalRow(row), workspaceDb))
                .filter((proposal) => includeStaged || proposal.reviewStatus !== shared_types_1.ProposalReviewStatus.STAGED_ANALYSIS)
                .filter((proposal) => !options?.openOnly || OPEN_PROPOSAL_STATUSES.has(proposal.reviewStatus))
                .filter((proposal) => !reviewStatusFilter || reviewStatusFilter.has(proposal.reviewStatus))
                .filter((proposal) => !options?.sessionId || proposal.sessionId === options.sessionId);
        }
        finally {
            workspaceDb.close();
        }
    }
    async listProposalReviewQueue(workspaceId, batchId) {
        const batch = await this.getPBIBatch(workspaceId, batchId);
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const relatedCounts = workspaceDb.all(`
        SELECT proposal_id as proposalId, COUNT(*) as count
        FROM proposal_pbi_links
        WHERE proposal_id IN (SELECT id FROM proposals WHERE batch_id = @batchId)
        GROUP BY proposal_id
      `, { batchId });
            const relatedCountMap = new Map(relatedCounts.map((entry) => [entry.proposalId, entry.count]));
            const records = (await this.listBatchProposalRecords(workspaceId, batchId)).filter((proposal) => REVIEWABLE_PROPOSAL_STATUSES.has(proposal.reviewStatus));
            const queue = records.map((proposal) => {
                const article = deriveProposalArticleDescriptor(proposal);
                return {
                    proposalId: proposal.id,
                    queueOrder: proposal.queueOrder,
                    action: proposal.action,
                    reviewStatus: proposal.reviewStatus,
                    articleKey: article.articleKey,
                    articleLabel: article.articleLabel,
                    locale: article.locale,
                    confidenceScore: proposal.confidenceScore,
                    rationaleSummary: proposal.rationaleSummary,
                    relatedPbiCount: relatedCountMap.get(proposal.id) ?? 0
                };
            });
            const groupMap = new Map();
            for (const item of queue) {
                const existing = groupMap.get(item.articleKey);
                if (existing) {
                    existing.proposalIds.push(item.proposalId);
                    existing.total += 1;
                    if (!existing.actions.includes(item.action)) {
                        existing.actions.push(item.action);
                    }
                }
                else {
                    groupMap.set(item.articleKey, {
                        articleKey: item.articleKey,
                        articleLabel: item.articleLabel,
                        locale: item.locale,
                        proposalIds: [item.proposalId],
                        total: 1,
                        actions: [item.action]
                    });
                }
            }
            return {
                workspaceId,
                batchId,
                batchStatus: batch.status,
                summary: summarizeProposalStatuses(records),
                queue,
                groups: Array.from(groupMap.values())
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async promoteBatchProposalsToPendingReview(params) {
        const workspace = await this.getWorkspace(params.workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const proposalIds = Array.from(new Set((params.proposalIds ?? []).map((proposalId) => proposalId.trim()).filter(Boolean)));
            if (proposalIds.length > 0) {
                workspaceDb.exec('BEGIN IMMEDIATE');
                try {
                    for (const proposalId of proposalIds) {
                        workspaceDb.run(`UPDATE proposals
               SET review_status = @nextStatus,
                   updated_at = @updatedAt
               WHERE workspace_id = @workspaceId
                 AND batch_id = @batchId
                 AND id = @proposalId
                 AND review_status = @currentStatus`, {
                            workspaceId: params.workspaceId,
                            batchId: params.batchId,
                            proposalId,
                            currentStatus: shared_types_1.ProposalReviewStatus.STAGED_ANALYSIS,
                            nextStatus: shared_types_1.ProposalReviewStatus.PENDING_REVIEW,
                            updatedAt: new Date().toISOString()
                        });
                    }
                    workspaceDb.exec('COMMIT');
                }
                catch (error) {
                    workspaceDb.exec('ROLLBACK');
                    throw error;
                }
            }
            const promotedRows = proposalIds.length > 0
                ? workspaceDb.all(`SELECT id
             FROM proposals
             WHERE workspace_id = @workspaceId
               AND batch_id = @batchId
               AND review_status = @reviewStatus
               AND id IN (${proposalIds.map((_, index) => `@proposalId${index}`).join(', ')})`, proposalIds.reduce((acc, proposalId, index) => {
                    acc[`proposalId${index}`] = proposalId;
                    return acc;
                }, {
                    workspaceId: params.workspaceId,
                    batchId: params.batchId,
                    reviewStatus: shared_types_1.ProposalReviewStatus.PENDING_REVIEW
                }))
                : [];
            const batchStatus = await this.syncBatchReviewStatus(workspaceDb, params.workspaceId, params.batchId);
            return {
                promotedProposalIds: promotedRows.map((row) => row.id),
                batchStatus
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getProposalReviewDetail(workspaceId, proposalId) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const row = workspaceDb.get(`
        SELECT p.id,
               p.workspace_id as workspaceId,
               p.batch_id as batchId,
               p.action,
               p.locale_variant_id as localeVariantId,
               p.branch_id as branchId,
               p.status,
               p.rationale,
               p.generated_at as generatedAtUtc,
               p.updated_at as updatedAtUtc,
               p.review_status as reviewStatus,
               p.queue_order as queueOrder,
               p.family_id as familyId,
               p.source_revision_id as sourceRevisionId,
               p.target_title as targetTitle,
               p.target_locale as targetLocale,
               p.confidence_score as confidenceScore,
               p.rationale_summary as rationaleSummary,
               p.ai_notes as aiNotes,
               p.suggested_placement_json as suggestedPlacementJson,
               p.source_html_path as sourceHtmlPath,
               p.proposed_html_path as proposedHtmlPath,
               p.metadata_json as metadataJson,
               p.decision_payload_json as decisionPayloadJson,
               p.decided_at as decidedAtUtc,
               p.agent_session_id as sessionId
        FROM proposals p
        WHERE p.workspace_id = @workspaceId AND p.id = @proposalId
      `, { workspaceId, proposalId });
            if (!row) {
                throw new Error('Proposal not found');
            }
            const proposal = this.hydrateProposalDisplayFields(this.mapProposalRow(row), workspaceDb);
            const batch = await this.getPBIBatch(workspaceId, proposal.batchId);
            const relatedPbis = workspaceDb.all(`
        SELECT p.id, p.batch_id as batchId, p.source_row_number as sourceRowNumber, p.external_id as externalId, p.title,
               p.description, p.priority, p.state, p.work_item_type as workItemType, p.title1, p.title2, p.title3,
               p.raw_description as rawDescription, p.raw_acceptance_criteria as rawAcceptanceCriteria,
               p.description_text as descriptionText, p.acceptance_criteria_text as acceptanceCriteriaText,
               p.parent_external_id as parentExternalId, p.parent_record_id as parentRecordId,
               p.validation_status as validationStatus, p.validation_reason as validationReason
        FROM pbi_records p
        JOIN proposal_pbi_links l ON l.pbi_id = p.id
        WHERE l.proposal_id = @proposalId
        ORDER BY p.source_row_number ASC
      `, { proposalId });
            const queueRows = workspaceDb.all(`
        SELECT id
        FROM proposals
        WHERE batch_id = @batchId
        ORDER BY queue_order ASC, generated_at ASC
      `, { batchId: proposal.batchId });
            const currentIndex = Math.max(0, queueRows.findIndex((entry) => entry.id === proposalId));
            const hydrated = await this.ensureProposalReviewArtifacts(workspace.path, workspaceDb, proposal, relatedPbis);
            const beforeHtml = hydrated.beforeHtml;
            const afterHtml = hydrated.afterHtml;
            const diff = (0, diff_engine_1.diffHtml)(beforeHtml, afterHtml);
            return {
                workspaceId,
                batchId: hydrated.proposal.batchId,
                batchStatus: batch.status,
                proposal: hydrated.proposal,
                relatedPbis,
                diff: {
                    beforeHtml: diff.beforeHtml,
                    afterHtml: diff.afterHtml,
                    sourceDiff: {
                        lines: diff.sourceLines.map((line) => ({
                            kind: line.kind,
                            lineNumberBefore: line.beforeLineNumber,
                            lineNumberAfter: line.afterLineNumber,
                            content: line.content
                        }))
                    },
                    renderedDiff: {
                        blocks: diff.renderedBlocks.map((block) => ({
                            kind: block.kind,
                            beforeText: block.beforeText,
                            afterText: block.afterText
                        }))
                    },
                    changeRegions: diff.changeRegions.map((region) => ({
                        id: region.id,
                        kind: region.kind,
                        label: region.label,
                        beforeText: region.beforeText,
                        afterText: region.afterText,
                        beforeLineStart: region.beforeLineStart,
                        beforeLineEnd: region.beforeLineEnd,
                        afterLineStart: region.afterLineStart,
                        afterLineEnd: region.afterLineEnd
                    })),
                    gutter: diff.gutter.map((item) => ({
                        lineNumber: item.lineNumber,
                        kind: item.kind,
                        regionId: item.regionId,
                        side: item.side
                    }))
                },
                navigation: {
                    currentIndex,
                    total: queueRows.length,
                    previousProposalId: currentIndex > 0 ? queueRows[currentIndex - 1]?.id : undefined,
                    nextProposalId: currentIndex < queueRows.length - 1 ? queueRows[currentIndex + 1]?.id : undefined
                }
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async updateProposalReviewWorkingCopy(workspaceId, proposalId, patch) {
        if (!patch.html?.trim()) {
            throw new Error('Proposal working copy updates require resolved HTML content');
        }
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const row = workspaceDb.get(`
        SELECT p.id,
               p.workspace_id as workspaceId,
               p.batch_id as batchId,
               p.action,
               p.locale_variant_id as localeVariantId,
               p.branch_id as branchId,
               p.status,
               p.rationale,
               p.generated_at as generatedAtUtc,
               p.updated_at as updatedAtUtc,
               p.review_status as reviewStatus,
               p.queue_order as queueOrder,
               p.family_id as familyId,
               p.source_revision_id as sourceRevisionId,
               p.target_title as targetTitle,
               p.target_locale as targetLocale,
               p.confidence_score as confidenceScore,
               p.rationale_summary as rationaleSummary,
               p.ai_notes as aiNotes,
               p.suggested_placement_json as suggestedPlacementJson,
               p.source_html_path as sourceHtmlPath,
               p.proposed_html_path as proposedHtmlPath,
               p.metadata_json as metadataJson,
               p.decision_payload_json as decisionPayloadJson,
               p.decided_at as decidedAtUtc,
               p.agent_session_id as sessionId
        FROM proposals p
        WHERE p.workspace_id = @workspaceId AND p.id = @proposalId
      `, { workspaceId, proposalId });
            if (!row) {
                throw new Error('Proposal not found');
            }
            const proposal = this.hydrateProposalDisplayFields(this.mapProposalRow(row), workspaceDb);
            const relatedPbis = workspaceDb.all(`
        SELECT p.id, p.batch_id as batchId, p.source_row_number as sourceRowNumber, p.external_id as externalId, p.title,
               p.description, p.priority, p.state, p.work_item_type as workItemType, p.title1, p.title2, p.title3,
               p.raw_description as rawDescription, p.raw_acceptance_criteria as rawAcceptanceCriteria,
               p.description_text as descriptionText, p.acceptance_criteria_text as acceptanceCriteriaText,
               p.parent_external_id as parentExternalId, p.parent_record_id as parentRecordId,
               p.validation_status as validationStatus, p.validation_reason as validationReason
        FROM pbi_records p
        JOIN proposal_pbi_links l ON l.pbi_id = p.id
        WHERE l.proposal_id = @proposalId
        ORDER BY p.source_row_number ASC
      `, { proposalId });
            const hydrated = await this.ensureProposalReviewArtifacts(workspace.path, workspaceDb, proposal, relatedPbis);
            const now = new Date().toISOString();
            const existingMetadata = normalizeProposalMetadata(proposal.metadata);
            const nextMetadata = {
                ...existingMetadata,
                assistantWorkingCopyUpdatedAt: now
            };
            const artifacts = await this.persistProposalArtifacts(workspace.path, proposalId, {
                sourceHtml: hydrated.beforeHtml,
                proposedHtml: patch.html,
                metadata: nextMetadata
            });
            workspaceDb.run(`UPDATE proposals
         SET target_title = COALESCE(@targetTitle, target_title),
             rationale = COALESCE(@rationale, rationale),
             rationale_summary = COALESCE(@rationaleSummary, rationale_summary),
             ai_notes = COALESCE(@aiNotes, ai_notes),
             source_html_path = COALESCE(@sourceHtmlPath, source_html_path),
             proposed_html_path = COALESCE(@proposedHtmlPath, proposed_html_path),
             metadata_json = @metadataJson,
             updated_at = @updatedAt
         WHERE workspace_id = @workspaceId AND id = @proposalId`, {
                workspaceId,
                proposalId,
                targetTitle: patch.title ?? null,
                rationale: patch.rationale ?? null,
                rationaleSummary: patch.rationaleSummary ?? null,
                aiNotes: patch.aiNotes ?? null,
                sourceHtmlPath: artifacts.sourceHtmlPath ?? null,
                proposedHtmlPath: artifacts.proposedHtmlPath ?? null,
                metadataJson: JSON.stringify(nextMetadata),
                updatedAt: now
            });
            return this.getProposalReviewDetail(workspaceId, proposalId);
        }
        finally {
            workspaceDb.close();
        }
    }
    async deleteProposalReview(workspaceId, proposalId) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const existing = workspaceDb.get(`
        SELECT p.id,
               p.workspace_id as workspaceId,
               p.batch_id as batchId,
               p.action,
               p.locale_variant_id as localeVariantId,
               p.branch_id as branchId,
               p.status,
               p.rationale,
               p.generated_at as generatedAtUtc,
               p.updated_at as updatedAtUtc,
               p.review_status as reviewStatus,
               p.queue_order as queueOrder,
               p.family_id as familyId,
               p.source_revision_id as sourceRevisionId,
               p.target_title as targetTitle,
               p.target_locale as targetLocale,
               p.confidence_score as confidenceScore,
               p.rationale_summary as rationaleSummary,
               p.ai_notes as aiNotes,
               p.suggested_placement_json as suggestedPlacementJson,
               p.source_html_path as sourceHtmlPath,
               p.proposed_html_path as proposedHtmlPath,
               p.metadata_json as metadataJson,
               p.decision_payload_json as decisionPayloadJson,
               p.decided_at as decidedAtUtc,
               p.agent_session_id as sessionId
        FROM proposals p
        WHERE p.workspace_id = @workspaceId AND p.id = @proposalId
      `, { workspaceId, proposalId });
            if (!existing) {
                throw new Error('Proposal not found');
            }
            const batch = await this.getPBIBatch(workspaceId, existing.batchId);
            workspaceDb.exec('BEGIN IMMEDIATE');
            try {
                workspaceDb.run(`DELETE FROM proposal_pbi_links
           WHERE proposal_id = @proposalId`, { proposalId });
                workspaceDb.run(`DELETE FROM proposals
           WHERE workspace_id = @workspaceId AND id = @proposalId`, { workspaceId, proposalId });
                workspaceDb.exec('COMMIT');
            }
            catch (error) {
                workspaceDb.exec('ROLLBACK');
                throw error;
            }
            await promises_1.default.rm(node_path_1.default.join(workspace.path, 'proposals', proposalId), { recursive: true, force: true });
            const remainingRows = workspaceDb.all(`
        SELECT p.id,
               p.workspace_id as workspaceId,
               p.batch_id as batchId,
               p.action,
               p.locale_variant_id as localeVariantId,
               p.branch_id as branchId,
               p.status,
               p.rationale,
               p.generated_at as generatedAtUtc,
               p.updated_at as updatedAtUtc,
               p.review_status as reviewStatus,
               p.queue_order as queueOrder,
               p.family_id as familyId,
               p.source_revision_id as sourceRevisionId,
               p.target_title as targetTitle,
               p.target_locale as targetLocale,
               p.confidence_score as confidenceScore,
               p.rationale_summary as rationaleSummary,
               p.ai_notes as aiNotes,
               p.suggested_placement_json as suggestedPlacementJson,
               p.source_html_path as sourceHtmlPath,
               p.proposed_html_path as proposedHtmlPath,
               p.metadata_json as metadataJson,
               p.decision_payload_json as decisionPayloadJson,
               p.decided_at as decidedAtUtc,
               p.agent_session_id as sessionId
        FROM proposals p
        WHERE p.workspace_id = @workspaceId AND p.batch_id = @batchId
        ORDER BY p.queue_order ASC, p.generated_at ASC
      `, { workspaceId, batchId: existing.batchId });
            const remaining = remainingRows.map((row) => this.hydrateProposalDisplayFields(this.mapProposalRow(row), workspaceDb));
            return {
                workspaceId,
                batchId: existing.batchId,
                deletedProposalId: proposalId,
                batchStatus: batch.status,
                summary: summarizeProposalStatuses(remaining)
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async decideProposalReview(input) {
        const workspace = await this.getWorkspace(input.workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const existing = workspaceDb.get(`
        SELECT p.id,
               p.workspace_id as workspaceId,
               p.batch_id as batchId,
               p.action,
               p.locale_variant_id as localeVariantId,
               p.branch_id as branchId,
               p.status,
               p.rationale,
               p.generated_at as generatedAtUtc,
               p.updated_at as updatedAtUtc,
               p.review_status as reviewStatus,
               p.queue_order as queueOrder,
               p.family_id as familyId,
               p.source_revision_id as sourceRevisionId,
               p.target_title as targetTitle,
               p.target_locale as targetLocale,
               p.confidence_score as confidenceScore,
               p.rationale_summary as rationaleSummary,
               p.ai_notes as aiNotes,
               p.suggested_placement_json as suggestedPlacementJson,
               p.source_html_path as sourceHtmlPath,
               p.proposed_html_path as proposedHtmlPath,
               p.metadata_json as metadataJson,
               p.decision_payload_json as decisionPayloadJson,
               p.decided_at as decidedAtUtc,
               p.agent_session_id as sessionId
        FROM proposals p
        WHERE p.workspace_id = @workspaceId AND p.id = @proposalId
      `, { workspaceId: input.workspaceId, proposalId: input.proposalId });
            if (!existing) {
                throw new Error('Proposal not found');
            }
            const proposal = this.hydrateProposalDisplayFields(this.mapProposalRow(existing), workspaceDb);
            const mutation = await this.applyProposalDecisionMutation(workspace.path, workspaceDb, proposal, input);
            const mappedStatus = mutation.reviewStatus ?? mapReviewDecisionToStatus(input.decision);
            const legacyStatus = mutation.legacyStatus ?? mapReviewDecisionToLegacyStatus(input.decision);
            const decidedAt = new Date().toISOString();
            const nextPlacement = input.placementOverride
                ? JSON.stringify(input.placementOverride)
                : existing.suggestedPlacementJson;
            workspaceDb.run(`UPDATE proposals
         SET review_status = @reviewStatus,
             status = @status,
             branch_id = COALESCE(@branchId, branch_id),
             suggested_placement_json = @suggestedPlacementJson,
             decision_payload_json = @decisionPayloadJson,
             decided_at = @decidedAt,
             updated_at = @updatedAt
         WHERE id = @proposalId AND workspace_id = @workspaceId`, {
                reviewStatus: mappedStatus,
                status: legacyStatus,
                branchId: mutation.branchId ?? input.branchId ?? null,
                suggestedPlacementJson: nextPlacement ?? null,
                decisionPayloadJson: JSON.stringify({
                    decision: input.decision,
                    branchId: mutation.branchId ?? input.branchId,
                    revisionId: mutation.revisionId,
                    familyId: mutation.familyId,
                    localeVariantId: mutation.localeVariantId,
                    retiredAtUtc: mutation.retiredAtUtc,
                    note: input.note,
                    placementOverride: input.placementOverride
                }),
                decidedAt,
                updatedAt: decidedAt,
                proposalId: input.proposalId,
                workspaceId: input.workspaceId
            });
            const batchStatus = await this.syncBatchReviewStatus(workspaceDb, input.workspaceId, existing.batchId);
            const queueRows = workspaceDb.all(`
        SELECT p.id,
               p.workspace_id as workspaceId,
               p.batch_id as batchId,
               p.action,
               p.locale_variant_id as localeVariantId,
               p.branch_id as branchId,
               p.status,
               p.rationale,
               p.generated_at as generatedAtUtc,
               p.updated_at as updatedAtUtc,
               p.review_status as reviewStatus,
               p.queue_order as queueOrder,
               p.family_id as familyId,
               p.source_revision_id as sourceRevisionId,
               p.target_title as targetTitle,
               p.target_locale as targetLocale,
               p.confidence_score as confidenceScore,
               p.rationale_summary as rationaleSummary,
               p.ai_notes as aiNotes,
               p.suggested_placement_json as suggestedPlacementJson,
               p.source_html_path as sourceHtmlPath,
               p.proposed_html_path as proposedHtmlPath,
               p.metadata_json as metadataJson,
               p.decision_payload_json as decisionPayloadJson,
               p.decided_at as decidedAtUtc,
               p.agent_session_id as sessionId
        FROM proposals p
        WHERE p.batch_id = @batchId
      `, { batchId: existing.batchId });
            return {
                workspaceId: input.workspaceId,
                batchId: existing.batchId,
                proposalId: input.proposalId,
                reviewStatus: mappedStatus,
                batchStatus,
                branchId: mutation.branchId ?? input.branchId ?? undefined,
                revisionId: mutation.revisionId,
                familyId: mutation.familyId,
                localeVariantId: mutation.localeVariantId,
                retiredAtUtc: mutation.retiredAtUtc,
                summary: summarizeProposalStatuses(queueRows.map((row) => this.mapProposalRow(row)))
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
    async setPBIBatchStatus(workspaceId, batchId, nextStatus, force = false, options) {
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
            const hasWorkerStageBudgetUpdate = Boolean(options && Object.prototype.hasOwnProperty.call(options, 'workerStageBudgetMinutes'));
            let workerStageBudgetMinutes = undefined;
            if (hasWorkerStageBudgetUpdate) {
                if (options?.workerStageBudgetMinutes == null) {
                    workerStageBudgetMinutes = null;
                }
                else {
                    workerStageBudgetMinutes = (0, shared_types_1.normalizeBatchAnalysisWorkerStageBudgetMinutes)(options.workerStageBudgetMinutes);
                    if (workerStageBudgetMinutes === undefined) {
                        throw new Error('workerStageBudgetMinutes must be a positive number of minutes.');
                    }
                }
            }
            workspaceDb.run(`UPDATE pbi_batches
         SET status = @status,
             analysis_worker_budget_minutes = CASE
               WHEN @hasWorkerStageBudgetUpdate = 1 THEN @workerStageBudgetMinutes
               ELSE analysis_worker_budget_minutes
             END
         WHERE id = @batchId AND workspace_id = @workspaceId`, {
                status: nextStatus,
                hasWorkerStageBudgetUpdate: hasWorkerStageBudgetUpdate ? 1 : 0,
                workerStageBudgetMinutes: workerStageBudgetMinutes ?? null,
                batchId,
                workspaceId
            });
            return {
                ...batch,
                status: nextStatus,
                workerStageBudgetMinutes: hasWorkerStageBudgetUpdate
                    ? (workerStageBudgetMinutes ?? undefined)
                    : batch.workerStageBudgetMinutes
            };
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
            const relationSummaryStatus = await this.getArticleRelationsStatus(workspaceId);
            const relationResults = await this.listArticleRelations(workspaceId, {
                workspaceId,
                familyId: family.id,
                limit: 16,
                includeEvidence: true
            });
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
                relations: relationResults.relations,
                relationSummary: relationSummaryStatus.summary,
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
    async upsertKbScopeCatalogEntries(workspaceId, entries) {
        if (entries.length === 0) {
            return [];
        }
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        const updatedAtUtc = new Date().toISOString();
        try {
            workspaceDb.exec('BEGIN IMMEDIATE');
            const records = this.upsertKbScopeCatalogEntriesInDb(workspaceDb, workspaceId, entries, updatedAtUtc);
            workspaceDb.exec('COMMIT');
            return records;
        }
        catch (error) {
            try {
                workspaceDb.exec('ROLLBACK');
            }
            catch {
                // no-op
            }
            throw error;
        }
        finally {
            workspaceDb.close();
        }
    }
    async listKbScopeCatalogEntries(workspaceId, query = {}) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            return this.listKbScopeCatalogEntriesInDb(workspaceDb, workspaceId, query);
        }
        finally {
            workspaceDb.close();
        }
    }
    async listKbScopeOverrides(workspaceId, query = {}) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            return this.listKbScopeOverridesInDb(workspaceDb, workspaceId, query);
        }
        finally {
            workspaceDb.close();
        }
    }
    async resolveKbScopeDisplayNames(workspaceId, scopes) {
        if (scopes.length === 0) {
            return [];
        }
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            return this.resolveKbScopeDisplayNamesInDb(workspaceDb, workspaceId, scopes);
        }
        finally {
            workspaceDb.close();
        }
    }
    listArticleFamiliesForTaxonomyInDb(workspaceDb, workspaceId, familyIds) {
        const where = ['workspace_id = @workspaceId'];
        const params = { workspaceId };
        const dedupedFamilyIds = Array.from(new Set((familyIds ?? []).map((value) => value.trim()).filter(Boolean)));
        if (dedupedFamilyIds.length > 0) {
            where.push(`id IN (${buildRelationCoverageInClause('taxonomyFamily', dedupedFamilyIds, params)})`);
        }
        return workspaceDb.all(`SELECT ${ARTICLE_FAMILY_SELECT_COLUMNS}
         FROM article_families
        WHERE ${where.join('\n          AND ')}
        ORDER BY title COLLATE NOCASE ASC, id ASC`, params).map(mapArticleFamilyRow);
    }
    getKbSectionParentCategoryInDb(workspaceDb, workspaceId, sectionId) {
        const row = workspaceDb.get(`SELECT (
          SELECT parent_scope_id
            FROM kb_scope_overrides
           WHERE workspace_id = @workspaceId
             AND scope_type = 'section'
             AND scope_id = @sectionId
           ORDER BY updated_at DESC, id DESC
           LIMIT 1
        ) as overrideParentScopeId,
        (
          SELECT parent_scope_id
            FROM kb_scope_catalog
           WHERE workspace_id = @workspaceId
             AND scope_type = 'section'
             AND scope_id = @sectionId
           LIMIT 1
        ) as catalogParentScopeId`, {
            workspaceId,
            sectionId
        });
        return normalizeFeatureMapScopeId(row?.overrideParentScopeId)
            ?? normalizeFeatureMapScopeId(row?.catalogParentScopeId);
    }
    isKbScopeCatalogEntryPresentInDb(workspaceDb, workspaceId, scopeType, scopeId) {
        const normalizedScopeId = normalizeFeatureMapScopeId(scopeId);
        if (!normalizedScopeId) {
            return false;
        }
        const row = workspaceDb.get(`SELECT 1 as present
         FROM kb_scope_catalog
        WHERE workspace_id = @workspaceId
          AND scope_type = @scopeType
          AND scope_id = @scopeId
        LIMIT 1`, {
            workspaceId,
            scopeType,
            scopeId: normalizedScopeId
        });
        return Boolean(row?.present);
    }
    resolveEffectiveArticleTaxonomyPlacementInDb(workspaceDb, workspaceId, family, options) {
        const rawSectionId = normalizeFeatureMapScopeId(family.sourceSectionId);
        const rawCategoryId = normalizeFeatureMapScopeId(family.sourceCategoryId);
        const currentSectionId = normalizeFeatureMapScopeId(family.sectionId);
        const currentCategoryId = normalizeFeatureMapScopeId(family.categoryId);
        const currentSectionSource = normalizeArticleTaxonomySource(family.sectionSource);
        const currentCategorySource = normalizeArticleTaxonomySource(family.categorySource);
        const manualSection = currentSectionSource === 'manual_override';
        const manualCategory = currentCategorySource === 'manual_override';
        let sectionId = currentSectionId;
        let categoryId = currentCategoryId;
        let sectionSource = currentSectionSource;
        let categorySource = currentCategorySource;
        let taxonomyConfidence = normalizeArticleTaxonomyConfidence(family.taxonomyConfidence);
        let taxonomyNote = normalizeFeatureMapScopeId(family.taxonomyNote);
        if (rawSectionId && rawCategoryId) {
            const sectionParentCategoryId = this.getKbSectionParentCategoryInDb(workspaceDb, workspaceId, rawSectionId);
            if (!manualSection) {
                sectionId = rawSectionId;
                sectionSource = 'zendesk_article';
            }
            if (!manualCategory) {
                if (sectionParentCategoryId && sectionParentCategoryId !== rawCategoryId) {
                    categoryId = sectionParentCategoryId;
                    categorySource = 'zendesk_section_parent';
                    taxonomyConfidence = 0.98;
                    taxonomyNote = `Zendesk category ${rawCategoryId} conflicts with section ${rawSectionId} parent ${sectionParentCategoryId}; effective category follows the section parent.`;
                }
                else {
                    categoryId = rawCategoryId;
                    categorySource = 'zendesk_article';
                    taxonomyConfidence = 1;
                    taxonomyNote = undefined;
                }
            }
            return {
                sectionId,
                categoryId,
                sourceSectionId: rawSectionId,
                sourceCategoryId: rawCategoryId,
                sectionSource,
                categorySource,
                taxonomyConfidence,
                taxonomyNote
            };
        }
        if (rawSectionId) {
            const sectionParentCategoryId = this.getKbSectionParentCategoryInDb(workspaceDb, workspaceId, rawSectionId);
            if (!manualSection) {
                sectionId = rawSectionId;
                sectionSource = 'zendesk_article';
            }
            if (!manualCategory && sectionParentCategoryId) {
                categoryId = sectionParentCategoryId;
                categorySource = 'zendesk_section_parent';
                taxonomyConfidence = 0.98;
                taxonomyNote = undefined;
            }
            return {
                sectionId,
                categoryId,
                sourceSectionId: rawSectionId,
                sourceCategoryId: rawCategoryId,
                sectionSource,
                categorySource,
                taxonomyConfidence,
                taxonomyNote
            };
        }
        if (rawCategoryId) {
            if (!manualSection) {
                sectionId = undefined;
                sectionSource = 'none';
            }
            if (!manualCategory) {
                categoryId = rawCategoryId;
                categorySource = 'zendesk_article';
                taxonomyConfidence = 0.92;
                taxonomyNote = undefined;
            }
            return {
                sectionId,
                categoryId,
                sourceSectionId: rawSectionId,
                sourceCategoryId: rawCategoryId,
                sectionSource,
                categorySource,
                taxonomyConfidence,
                taxonomyNote
            };
        }
        if (options.allowInference) {
            const inferred = options.indexDb
                ? this.inferExistingArticleTaxonomyPlacementInDb(workspaceDb, workspaceId, family.id, options.indexDb)
                : null;
            if (inferred) {
                if (!manualSection) {
                    sectionId = inferred.sectionId;
                    sectionSource = inferred.sectionId ? 'inferred_existing_scope' : 'none';
                }
                if (!manualCategory) {
                    categoryId = inferred.categoryId;
                    categorySource = inferred.categoryId ? 'inferred_existing_scope' : 'none';
                }
                taxonomyConfidence = inferred.confidence;
                taxonomyNote = inferred.note;
            }
        }
        return {
            sectionId,
            categoryId,
            sourceSectionId: rawSectionId,
            sourceCategoryId: rawCategoryId,
            sectionSource,
            categorySource,
            taxonomyConfidence,
            taxonomyNote
        };
    }
    inferExistingArticleTaxonomyPlacementInDb(workspaceDb, workspaceId, familyId, indexDb) {
        const response = this.articleRelationsV2QueryService.queryCoverage({
            workspaceDb,
            indexDb,
            request: {
                workspaceId,
                seedFamilyIds: [familyId],
                maxResults: 12,
                minScore: 0.18,
                includeEvidence: true
            }
        });
        if (response.results.length < 2) {
            return null;
        }
        const candidateFamilies = new Map(this.listArticleFamiliesForTaxonomyInDb(workspaceDb, workspaceId, response.results.map((result) => result.familyId)).map((family) => [family.id, family]));
        const sectionVotes = new Map();
        const categoryVotes = new Map();
        for (const result of response.results) {
            const candidateFamily = candidateFamilies.get(result.familyId);
            if (!candidateFamily || candidateFamily.id === familyId) {
                continue;
            }
            const evidenceTypes = new Set(result.evidence.map((entry) => entry.evidenceType));
            const hasExplicitLink = evidenceTypes.has('explicit_link');
            const lexicalEvidenceCount = [
                'title_fts',
                'heading_fts',
                'body_chunk_fts',
                'external_key_exact',
                'alias_exact'
            ].filter((type) => evidenceTypes.has(type)).length;
            if (!hasExplicitLink && lexicalEvidenceCount < 2 && result.finalScore < 0.72) {
                continue;
            }
            let candidateSectionId = normalizeFeatureMapScopeId(candidateFamily.sectionId);
            let candidateCategoryId = normalizeFeatureMapScopeId(candidateFamily.categoryId);
            if (candidateSectionId) {
                const sectionParentCategoryId = this.getKbSectionParentCategoryInDb(workspaceDb, workspaceId, candidateSectionId);
                if (!sectionParentCategoryId) {
                    candidateSectionId = undefined;
                }
                else {
                    candidateCategoryId = sectionParentCategoryId;
                }
            }
            if (candidateCategoryId && !this.isKbScopeCatalogEntryPresentInDb(workspaceDb, workspaceId, 'category', candidateCategoryId)) {
                candidateCategoryId = undefined;
            }
            if (!candidateSectionId && !candidateCategoryId) {
                continue;
            }
            let score = result.finalScore;
            if (hasExplicitLink) {
                score += 0.35;
            }
            if (lexicalEvidenceCount >= 2) {
                score += 0.12;
            }
            else if (lexicalEvidenceCount === 1) {
                score += 0.05;
            }
            score = Number(score.toFixed(3));
            if (candidateSectionId && candidateCategoryId) {
                const sectionVote = sectionVotes.get(candidateSectionId) ?? {
                    sectionId: candidateSectionId,
                    categoryId: candidateCategoryId,
                    score: 0,
                    supporters: new Set(),
                    explicitLinkSupporters: new Set()
                };
                sectionVote.score = Number((sectionVote.score + score).toFixed(3));
                sectionVote.supporters.add(candidateFamily.id);
                if (hasExplicitLink) {
                    sectionVote.explicitLinkSupporters.add(candidateFamily.id);
                }
                sectionVotes.set(candidateSectionId, sectionVote);
                const categoryVote = categoryVotes.get(candidateCategoryId) ?? {
                    categoryId: candidateCategoryId,
                    score: 0,
                    supporters: new Set(),
                    explicitLinkSupporters: new Set()
                };
                categoryVote.score = Number((categoryVote.score + (score * 0.92)).toFixed(3));
                categoryVote.supporters.add(candidateFamily.id);
                if (hasExplicitLink) {
                    categoryVote.explicitLinkSupporters.add(candidateFamily.id);
                }
                categoryVotes.set(candidateCategoryId, categoryVote);
                continue;
            }
            if (candidateCategoryId) {
                const categoryVote = categoryVotes.get(candidateCategoryId) ?? {
                    categoryId: candidateCategoryId,
                    score: 0,
                    supporters: new Set(),
                    explicitLinkSupporters: new Set()
                };
                categoryVote.score = Number((categoryVote.score + (score * 0.82)).toFixed(3));
                categoryVote.supporters.add(candidateFamily.id);
                if (hasExplicitLink) {
                    categoryVote.explicitLinkSupporters.add(candidateFamily.id);
                }
                categoryVotes.set(candidateCategoryId, categoryVote);
            }
        }
        const rankedSections = Array.from(sectionVotes.values()).sort((left, right) => (right.score - left.score
            || right.supporters.size - left.supporters.size
            || right.explicitLinkSupporters.size - left.explicitLinkSupporters.size
            || left.sectionId.localeCompare(right.sectionId)));
        const rankedCategories = Array.from(categoryVotes.values()).sort((left, right) => (right.score - left.score
            || right.supporters.size - left.supporters.size
            || right.explicitLinkSupporters.size - left.explicitLinkSupporters.size
            || left.categoryId.localeCompare(right.categoryId)));
        const topSection = rankedSections[0];
        const secondSection = rankedSections[1];
        if (topSection
            && topSection.supporters.size >= 2
            && topSection.score >= 1.55
            && (topSection.score - (secondSection?.score ?? 0)) >= 0.2) {
            return {
                sectionId: topSection.sectionId,
                categoryId: topSection.categoryId,
                confidence: normalizeArticleTaxonomyConfidence(0.5
                    + Math.min(0.25, topSection.score / 5)
                    + Math.min(0.12, topSection.supporters.size * 0.04)
                    + Math.min(0.06, topSection.explicitLinkSupporters.size * 0.03)) ?? 0.82,
                note: `Inferred from ${topSection.supporters.size} related articles into existing Zendesk section ${topSection.sectionId} and category ${topSection.categoryId}.`
            };
        }
        const topCategory = rankedCategories[0];
        const secondCategory = rankedCategories[1];
        if (topCategory
            && topCategory.supporters.size >= 2
            && topCategory.score >= 1.45
            && (topCategory.score - (secondCategory?.score ?? 0)) >= 0.18) {
            return {
                categoryId: topCategory.categoryId,
                confidence: normalizeArticleTaxonomyConfidence(0.46
                    + Math.min(0.22, topCategory.score / 5.5)
                    + Math.min(0.1, topCategory.supporters.size * 0.035)
                    + Math.min(0.04, topCategory.explicitLinkSupporters.size * 0.02)) ?? 0.76,
                note: `Inferred from ${topCategory.supporters.size} related articles into existing Zendesk category ${topCategory.categoryId}.`
            };
        }
        return null;
    }
    applyArticleTaxonomyResolutionInDb(workspaceDb, workspaceId, family, resolution) {
        const next = {
            ...family,
            sectionId: normalizeFeatureMapScopeId(resolution.sectionId),
            categoryId: normalizeFeatureMapScopeId(resolution.categoryId),
            sourceSectionId: normalizeFeatureMapScopeId(resolution.sourceSectionId),
            sourceCategoryId: normalizeFeatureMapScopeId(resolution.sourceCategoryId),
            sectionSource: normalizeArticleTaxonomySource(resolution.sectionSource),
            categorySource: normalizeArticleTaxonomySource(resolution.categorySource),
            taxonomyConfidence: normalizeArticleTaxonomyConfidence(resolution.taxonomyConfidence),
            taxonomyUpdatedAt: normalizeFeatureMapScopeId(resolution.taxonomyUpdatedAt) ?? new Date().toISOString(),
            taxonomyNote: normalizeFeatureMapScopeId(resolution.taxonomyNote)
        };
        const changed = next.sectionId !== family.sectionId
            || next.categoryId !== family.categoryId
            || next.sourceSectionId !== family.sourceSectionId
            || next.sourceCategoryId !== family.sourceCategoryId
            || next.sectionSource !== family.sectionSource
            || next.categorySource !== family.categorySource
            || next.taxonomyConfidence !== family.taxonomyConfidence
            || next.taxonomyNote !== family.taxonomyNote;
        if (!changed) {
            return {
                family,
                changed: false
            };
        }
        workspaceDb.run(`UPDATE article_families
          SET section_id = @sectionId,
              category_id = @categoryId,
              source_section_id = @sourceSectionId,
              source_category_id = @sourceCategoryId,
              section_source = @sectionSource,
              category_source = @categorySource,
              taxonomy_confidence = @taxonomyConfidence,
              taxonomy_updated_at = @taxonomyUpdatedAt,
              taxonomy_note = @taxonomyNote
        WHERE id = @familyId
          AND workspace_id = @workspaceId`, {
            familyId: family.id,
            workspaceId,
            sectionId: next.sectionId ?? null,
            categoryId: next.categoryId ?? null,
            sourceSectionId: next.sourceSectionId ?? null,
            sourceCategoryId: next.sourceCategoryId ?? null,
            sectionSource: next.sectionSource ?? 'none',
            categorySource: next.categorySource ?? 'none',
            taxonomyConfidence: next.taxonomyConfidence ?? null,
            taxonomyUpdatedAt: next.taxonomyUpdatedAt ?? null,
            taxonomyNote: next.taxonomyNote ?? null
        });
        return {
            family: next,
            changed: true
        };
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
            const row = workspaceDb.get(`SELECT ${ARTICLE_FAMILY_SELECT_COLUMNS}
         FROM article_families WHERE workspace_id = @workspaceId AND external_key = @externalKey`, { workspaceId, externalKey });
            return row ? mapArticleFamilyRow(row) : null;
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
    async listDraftBranches(workspaceId, payload) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const clauses = ['workspace_id = @workspaceId'];
            const params = { workspaceId };
            if (payload.localeVariantId) {
                clauses.push('locale_variant_id = @localeVariantId');
                params.localeVariantId = payload.localeVariantId;
            }
            if (!payload.includeDiscarded) {
                clauses.push(`state != '${shared_types_1.DraftBranchStatus.DISCARDED}'`);
            }
            const branchRows = workspaceDb.all(`
        SELECT id,
               workspace_id as workspaceId,
               locale_variant_id as localeVariantId,
               name,
               base_revision_id as baseRevisionId,
               state,
               head_revision_id as headRevisionId,
               autosave_enabled as autosaveEnabled,
               last_autosaved_at as lastAutosavedAtUtc,
               last_manual_saved_at as lastManualSavedAtUtc,
               change_summary as changeSummary,
               editor_state_json as editorStateJson,
               created_at as createdAtUtc,
               updated_at as updatedAtUtc,
               retired_at as retiredAtUtc
        FROM draft_branches
        WHERE ${clauses.join(' AND ')}
        ORDER BY updated_at DESC, created_at DESC
      `, params);
            const branches = await Promise.all(branchRows.map((branch) => this.buildDraftBranchSummary(workspace.path, workspaceDb, branch)));
            return {
                workspaceId,
                summary: summarizeDraftBranchStatuses(branches),
                branches
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async getDraftBranchEditor(workspaceId, branchId) {
        const workspace = await this.getWorkspace(workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const branch = this.getDraftBranchRow(workspaceDb, workspaceId, branchId);
            const summary = await this.buildDraftBranchSummary(workspace.path, workspaceDb, branch);
            const editor = await this.buildDraftEditorPayload(workspace.path, workspaceDb, branch, summary);
            return {
                workspaceId,
                branch: summary,
                editor
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async createDraftBranch(payload) {
        const workspace = await this.getWorkspace(payload.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const variant = workspaceDb.get(`SELECT family_id as familyId, locale
         FROM locale_variants
         WHERE id = @localeVariantId
         LIMIT 1`, { localeVariantId: payload.localeVariantId });
            if (!variant) {
                throw new Error('Locale variant not found');
            }
            const baseRevision = payload.baseRevisionId
                ? workspaceDb.get(`SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                    workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                    revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
             FROM revisions
             WHERE id = @revisionId AND workspace_id = @workspaceId
             LIMIT 1`, { revisionId: payload.baseRevisionId, workspaceId: payload.workspaceId })
                : await this.getLatestRevisionForVariant(workspaceDb, payload.localeVariantId, shared_types_1.RevisionState.LIVE);
            const headSourceHtml = payload.sourceHtml
                ?? (baseRevision ? await this.readRevisionSource(resolveRevisionPath(workspace.path, baseRevision.filePath)) : '');
            const branchId = (0, node_crypto_1.randomUUID)();
            const revisionId = (0, node_crypto_1.randomUUID)();
            const revisionNumber = (await this.getLatestRevisionForVariant(workspaceDb, payload.localeVariantId))?.revisionNumber ?? 0;
            const nextRevisionNumber = revisionNumber + 1;
            const now = new Date().toISOString();
            const branchName = payload.name?.trim() || `${variant.locale.toUpperCase()} Draft ${nextRevisionNumber}`;
            const filePath = await this.writeProposalDraftRevision(workspace.path, payload.localeVariantId, branchId, revisionId, nextRevisionNumber, headSourceHtml);
            const liveHtml = baseRevision ? await this.readRevisionSource(resolveRevisionPath(workspace.path, baseRevision.filePath)) : '';
            const changeSummary = summarizeDraftChanges((0, diff_engine_1.diffHtml)(liveHtml, headSourceHtml));
            workspaceDb.run(`INSERT INTO draft_branches (
          id, workspace_id, locale_variant_id, name, base_revision_id, state, created_at, updated_at, retired_at,
          head_revision_id, autosave_enabled, last_autosaved_at, last_manual_saved_at, change_summary, editor_state_json
        ) VALUES (
          @id, @workspaceId, @localeVariantId, @name, @baseRevisionId, @state, @createdAt, @updatedAt, NULL,
          @headRevisionId, 1, NULL, @lastManualSavedAt, @changeSummary, @editorStateJson
        )`, {
                id: branchId,
                workspaceId: payload.workspaceId,
                localeVariantId: payload.localeVariantId,
                name: branchName,
                baseRevisionId: baseRevision?.id ?? revisionId,
                state: shared_types_1.DraftBranchStatus.ACTIVE,
                createdAt: now,
                updatedAt: now,
                headRevisionId: revisionId,
                lastManualSavedAt: now,
                changeSummary,
                editorStateJson: payload.editorState ? JSON.stringify(payload.editorState) : null
            });
            workspaceDb.run(`INSERT INTO revisions (
          id, locale_variant_id, revision_type, branch_id, workspace_id, file_path, content_hash, source_revision_id, revision_number, status, created_at, updated_at
        ) VALUES (
          @id, @localeVariantId, @revisionType, @branchId, @workspaceId, @filePath, @contentHash, @sourceRevisionId, @revisionNumber, @status, @createdAt, @updatedAt
        )`, {
                id: revisionId,
                localeVariantId: payload.localeVariantId,
                revisionType: shared_types_1.RevisionState.DRAFT_BRANCH,
                branchId,
                workspaceId: payload.workspaceId,
                filePath,
                contentHash: createContentHash(headSourceHtml),
                sourceRevisionId: baseRevision?.id ?? null,
                revisionNumber: nextRevisionNumber,
                status: shared_types_1.RevisionStatus.OPEN,
                createdAt: now,
                updatedAt: now
            });
            this.recordDraftRevisionCommit(workspaceDb, {
                revisionId,
                branchId,
                workspaceId: payload.workspaceId,
                source: shared_types_1.DraftCommitSource.MANUAL,
                message: 'Created draft branch'
            });
            if (baseRevision) {
                this.recordArticleLineage(workspaceDb, payload.localeVariantId, baseRevision.id, revisionId, 'manual', now);
            }
            return this.getDraftBranchEditor(payload.workspaceId, branchId);
        }
        finally {
            workspaceDb.close();
        }
    }
    async saveDraftBranch(payload) {
        const workspace = await this.getWorkspace(payload.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const branch = this.getDraftBranchRow(workspaceDb, payload.workspaceId, payload.branchId);
            const currentHead = await this.getDraftBranchHeadRevision(workspaceDb, branch);
            if (payload.expectedHeadRevisionId && currentHead && payload.expectedHeadRevisionId !== currentHead.id) {
                throw new Error('Draft branch changed since the editor loaded');
            }
            if (normalizeDraftBranchStatus(branch.state) === shared_types_1.DraftBranchStatus.OBSOLETE) {
                throw new Error('Cannot save an obsolete draft branch');
            }
            if (normalizeDraftBranchStatus(branch.state) === shared_types_1.DraftBranchStatus.DISCARDED) {
                throw new Error('Cannot save a discarded draft branch');
            }
            const nextRevisionNumber = ((await this.getLatestRevisionForVariant(workspaceDb, branch.localeVariantId))?.revisionNumber ?? 0) + 1;
            const revisionId = (0, node_crypto_1.randomUUID)();
            const now = new Date().toISOString();
            const html = payload.html ?? '';
            const filePath = await this.writeProposalDraftRevision(workspace.path, branch.localeVariantId, branch.id, revisionId, nextRevisionNumber, html);
            const liveRevision = await this.getLatestRevisionForVariant(workspaceDb, branch.localeVariantId, shared_types_1.RevisionState.LIVE);
            const liveHtml = liveRevision ? await this.readRevisionSource(resolveRevisionPath(workspace.path, liveRevision.filePath)) : '';
            const diff = (0, diff_engine_1.diffHtml)(liveHtml, html);
            const changeSummary = summarizeDraftChanges(diff);
            const status = normalizeDraftBranchStatus(branch.state, Boolean(liveRevision && branch.baseRevisionId !== liveRevision.id));
            workspaceDb.run(`INSERT INTO revisions (
          id, locale_variant_id, revision_type, branch_id, workspace_id, file_path, content_hash, source_revision_id, revision_number, status, created_at, updated_at
        ) VALUES (
          @id, @localeVariantId, @revisionType, @branchId, @workspaceId, @filePath, @contentHash, @sourceRevisionId, @revisionNumber, @status, @createdAt, @updatedAt
        )`, {
                id: revisionId,
                localeVariantId: branch.localeVariantId,
                revisionType: shared_types_1.RevisionState.DRAFT_BRANCH,
                branchId: branch.id,
                workspaceId: payload.workspaceId,
                filePath,
                contentHash: createContentHash(html),
                sourceRevisionId: currentHead?.id ?? branch.baseRevisionId,
                revisionNumber: nextRevisionNumber,
                status: shared_types_1.RevisionStatus.OPEN,
                createdAt: now,
                updatedAt: now
            });
            this.recordDraftRevisionCommit(workspaceDb, {
                revisionId,
                branchId: branch.id,
                workspaceId: payload.workspaceId,
                source: payload.autosave ? shared_types_1.DraftCommitSource.AUTOSAVE : shared_types_1.DraftCommitSource.MANUAL,
                message: payload.commitMessage
            });
            if (currentHead) {
                this.recordArticleLineage(workspaceDb, branch.localeVariantId, currentHead.id, revisionId, payload.autosave ? 'system' : 'manual', now);
            }
            workspaceDb.run(`UPDATE draft_branches
         SET head_revision_id = @headRevisionId,
             state = @state,
             updated_at = @updatedAt,
             last_autosaved_at = CASE WHEN @isAutosave = 1 THEN @updatedAt ELSE last_autosaved_at END,
             last_manual_saved_at = CASE WHEN @isAutosave = 0 THEN @updatedAt ELSE last_manual_saved_at END,
             change_summary = @changeSummary,
             editor_state_json = COALESCE(@editorStateJson, editor_state_json)
         WHERE id = @branchId AND workspace_id = @workspaceId`, {
                branchId: branch.id,
                workspaceId: payload.workspaceId,
                headRevisionId: revisionId,
                state: status,
                updatedAt: now,
                isAutosave: payload.autosave ? 1 : 0,
                changeSummary,
                editorStateJson: payload.editorState ? JSON.stringify(payload.editorState) : null
            });
            const summary = await this.buildDraftBranchSummary(workspace.path, workspaceDb, {
                ...branch,
                headRevisionId: revisionId,
                state: status,
                updatedAtUtc: now,
                lastAutosavedAtUtc: payload.autosave ? now : branch.lastAutosavedAtUtc,
                lastManualSavedAtUtc: payload.autosave ? branch.lastManualSavedAtUtc : now,
                changeSummary
            });
            const editor = await this.buildDraftEditorPayload(workspace.path, workspaceDb, {
                ...branch,
                headRevisionId: revisionId,
                state: status,
                updatedAtUtc: now,
                lastAutosavedAtUtc: payload.autosave ? now : branch.lastAutosavedAtUtc,
                lastManualSavedAtUtc: payload.autosave ? branch.lastManualSavedAtUtc : now,
                changeSummary,
                editorStateJson: payload.editorState ? JSON.stringify(payload.editorState) : branch.editorStateJson
            }, summary);
            return {
                workspaceId: payload.workspaceId,
                branch: summary,
                editor
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    async setDraftBranchStatus(payload) {
        const workspace = await this.getWorkspace(payload.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const branch = this.getDraftBranchRow(workspaceDb, payload.workspaceId, payload.branchId);
            const nextStatus = payload.status;
            workspaceDb.run(`UPDATE draft_branches
         SET state = @state,
             updated_at = @updatedAt
         WHERE id = @branchId AND workspace_id = @workspaceId`, {
                branchId: payload.branchId,
                workspaceId: payload.workspaceId,
                state: nextStatus,
                updatedAt: new Date().toISOString()
            });
            return this.getDraftBranchEditor(payload.workspaceId, branch.id);
        }
        finally {
            workspaceDb.close();
        }
    }
    async discardDraftBranch(payload) {
        return this.setDraftBranchStatus({
            workspaceId: payload.workspaceId,
            branchId: payload.branchId,
            status: shared_types_1.DraftBranchStatus.DISCARDED
        });
    }
    async undoDraftBranch(payload) {
        return this.stepDraftBranchHistory(payload.workspaceId, payload.branchId, -1);
    }
    async redoDraftBranch(payload) {
        return this.stepDraftBranchHistory(payload.workspaceId, payload.branchId, 1);
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
                let batchAnalysisRepair;
                if (existedBeforeCheck) {
                    try {
                        workspaceDbVersion = (0, db_1.getWorkspaceMigrationVersion)(dbPath);
                        const repairedResult = this.repairWorkspaceDb(dbPath);
                        workspaceDbVersion = repairedResult.appliedVersion;
                        batchAnalysisRepair = repairedResult.batchAnalysisRepair;
                        repaired = repaired || repairedResult.migrationCount > 0 || this.hasBatchAnalysisRepairChanges(repairedResult.batchAnalysisRepair);
                    }
                    catch {
                        const repairedResult = this.repairWorkspaceDb(dbPath);
                        workspaceDbVersion = repairedResult.appliedVersion;
                        batchAnalysisRepair = repairedResult.batchAnalysisRepair;
                        repaired = repaired || repairedResult.migrationCount > 0 || this.hasBatchAnalysisRepairChanges(repairedResult.batchAnalysisRepair);
                    }
                }
                else {
                    const repairedResult = this.repairWorkspaceDb(dbPath);
                    workspaceDbVersion = repairedResult.appliedVersion;
                    batchAnalysisRepair = repairedResult.batchAnalysisRepair;
                    repaired = repaired || repairedResult.migrationCount > 0 || this.hasBatchAnalysisRepairChanges(repairedResult.batchAnalysisRepair);
                }
                const exists = await this.fileExists(dbPath);
                workspaces.push({
                    workspaceId: row.id,
                    workspacePath: row.path,
                    catalogVersion,
                    workspaceDbPath: dbPath,
                    workspaceDbVersion,
                    repaired,
                    exists,
                    batchAnalysisRepair
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
            const catalog = (0, db_1.ensureCatalogSchema)(this.catalogDbPath);
            this.ensureCatalogDefaultWorkspaceColumn(catalog);
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
        const migrationResult = (0, db_1.applyWorkspaceMigrations)(dbPath);
        this.ensureKbAccessModeColumn(dbPath);
        this.ensureAgentModelIdColumn(dbPath);
        this.ensureAcpModelIdColumn(dbPath);
        this.ensureAiRunsAgentModelIdColumn(dbPath);
        const batchAnalysisRepair = this.repairBatchAnalysisRolloutState(dbPath);
        return {
            ...migrationResult,
            batchAnalysisRepair
        };
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
    mapArticleRelationRow(row, workspaceDb, includeEvidence) {
        const evidence = includeEvidence
            ? workspaceDb.all(`SELECT id, relation_id, evidence_type, source_ref, snippet, weight, metadata_json
           FROM article_relation_evidence
           WHERE relation_id = @relationId
           ORDER BY weight DESC, id ASC`, { relationId: row.id }).map((evidenceRow) => ({
                id: evidenceRow.id,
                relationId: evidenceRow.relation_id,
                evidenceType: evidenceRow.evidence_type,
                sourceRef: evidenceRow.source_ref ?? undefined,
                snippet: evidenceRow.snippet ?? undefined,
                weight: evidenceRow.weight,
                metadata: safeParseJson(evidenceRow.metadata_json)
            }))
            : [];
        return {
            id: row.id,
            workspaceId: row.workspaceId,
            relationType: row.relationType,
            direction: row.direction,
            strengthScore: row.strengthScore,
            status: row.status,
            origin: row.origin,
            runId: row.runId ?? undefined,
            createdAtUtc: row.createdAtUtc,
            updatedAtUtc: row.updatedAtUtc,
            sourceFamily: {
                id: row.leftFamilyId,
                title: row.leftTitle,
                externalKey: row.leftExternalKey ?? undefined
            },
            targetFamily: {
                id: row.rightFamilyId,
                title: row.rightTitle,
                externalKey: row.rightExternalKey ?? undefined
            },
            evidence
        };
    }
    async resolveRelationSeedFamilyIds(workspaceId, workspaceDb, payload) {
        if (payload.familyId) {
            return [payload.familyId];
        }
        if (payload.localeVariantId) {
            const variant = workspaceDb.get(`SELECT family_id as familyId FROM locale_variants WHERE id = @id`, { id: payload.localeVariantId });
            return variant ? [variant.familyId] : [];
        }
        if (!payload.batchId) {
            return [];
        }
        const proposalFamilies = workspaceDb.all(`SELECT DISTINCT COALESCE(p.family_id, lv.family_id) as familyId
       FROM proposals p
       LEFT JOIN locale_variants lv ON lv.id = p.locale_variant_id
       WHERE p.batch_id = @batchId
         AND COALESCE(p.family_id, lv.family_id) IS NOT NULL`, { batchId: payload.batchId });
        if (proposalFamilies.length > 0) {
            return proposalFamilies.map((row) => row.familyId);
        }
        const pbiRows = workspaceDb.all(`SELECT title
       FROM pbi_records
       WHERE batch_id = @batchId
         AND validation_status = @candidateStatus
       ORDER BY source_row_number ASC
       LIMIT 8`, {
            batchId: payload.batchId,
            candidateStatus: shared_types_1.PBIValidationStatus.CANDIDATE
        });
        const seedFamilyIds = new Set();
        for (const row of pbiRows) {
            const results = await this.searchArticles(workspaceId, {
                workspaceId,
                query: row.title,
                scope: 'all',
                includeArchived: true
            });
            const top = results.results[0];
            if (top?.familyId) {
                seedFamilyIds.add(top.familyId);
            }
        }
        return Array.from(seedFamilyIds);
    }
    async buildArticleRelationCorpus(workspacePath, workspaceDb) {
        // Legacy Phase 2 corpus builder retained only as an unused fallback reference while
        // the v2 relation engine is rolled out. Phase 3 removes it from the refresh hot path.
        const families = workspaceDb.all(`SELECT id, title, external_key as externalKey, section_id as sectionId, category_id as categoryId
       FROM article_families
       WHERE retired_at IS NULL
         AND lower(external_key) NOT LIKE @proposalScopedPattern
       ORDER BY title COLLATE NOCASE`, { proposalScopedPattern: `${PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX}%` });
        const variants = workspaceDb.all(`SELECT id, family_id as familyId, locale, status
       FROM locale_variants
       WHERE status != @retiredStatus`, { retiredStatus: shared_types_1.RevisionState.RETIRED });
        const revisions = workspaceDb.all(`SELECT id, locale_variant_id, revision_number, revision_type, file_path, updated_at
       FROM revisions`);
        const latestByVariant = getLatestRevisions(revisions.map((revision) => ({
            id: revision.id,
            localeVariantId: revision.locale_variant_id,
            revisionNumber: revision.revision_number,
            revisionType: revision.revision_type,
            filePath: revision.file_path,
            updatedAtUtc: revision.updated_at
        })));
        const variantsByFamily = new Map();
        for (const variant of variants) {
            const bucket = variantsByFamily.get(variant.familyId) ?? [];
            bucket.push({ id: variant.id, locale: variant.locale });
            variantsByFamily.set(variant.familyId, bucket);
        }
        const corpus = [];
        for (const family of families) {
            const familyVariants = variantsByFamily.get(family.id) ?? [];
            const chosenVariant = familyVariants.find((variant) => variant.locale.toLowerCase().startsWith('en'))
                ?? familyVariants[0];
            let bodyText = '';
            if (chosenVariant) {
                const revision = latestByVariant.get(chosenVariant.id);
                if (revision?.filePath) {
                    const absolutePath = resolveRevisionPath(workspacePath, revision.filePath);
                    if (await this.fileExists(absolutePath)) {
                        bodyText = await this.readRevisionSource(absolutePath);
                    }
                }
            }
            corpus.push(buildCorpusItemFromFamily(family, bodyText));
        }
        return corpus;
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
        this.ensurePBIBatchWorkerStageBudgetMinutesColumn(dbPath);
        this.ensureAgentModelIdColumn(dbPath);
        this.ensureAcpModelIdColumn(dbPath);
        this.ensureAiRunsAgentModelIdColumn(dbPath);
        return dbPath;
    }
    hasBatchAnalysisRepairChanges(summary) {
        return Boolean(summary
            && (summary.backfilledLegacyIterations > 0
                || summary.backfilledLegacyStageRuns > 0
                || summary.backfilledLegacyWorkerReports > 0
                || summary.backfilledStageEvents > 0
                || summary.normalizedIterations > 0));
    }
    repairBatchAnalysisRolloutState(dbPath) {
        const db = (0, db_1.openWorkspaceDatabase)(dbPath);
        const summary = {
            backfilledLegacyIterations: 0,
            backfilledLegacyStageRuns: 0,
            backfilledLegacyWorkerReports: 0,
            backfilledStageEvents: 0,
            normalizedIterations: 0
        };
        try {
            const tableNames = new Set(db.all(`SELECT name FROM sqlite_master WHERE type = 'table'`).map((row) => row.name));
            if (!tableNames.has('batch_analysis_iterations')) {
                return summary;
            }
            db.exec('BEGIN IMMEDIATE');
            try {
                summary.backfilledLegacyIterations += this.backfillLegacyBatchAnalysisIterations(db);
                summary.backfilledLegacyStageRuns += this.backfillLegacyBatchAnalysisStageRuns(db);
                summary.backfilledLegacyWorkerReports += this.backfillLegacyBatchAnalysisWorkerReports(db);
                summary.normalizedIterations += this.normalizeBatchAnalysisIterations(db);
                summary.backfilledStageEvents += this.backfillBatchAnalysisStageEvents(db);
                db.exec('COMMIT');
            }
            catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
            return summary;
        }
        finally {
            db.close();
        }
    }
    normalizeWorkspaceDbIdentity(dbPath, workspaceId) {
        const db = this.openWorkspaceDbWithRecovery(dbPath);
        try {
            const availableTables = new Set(db.all(`SELECT name FROM sqlite_master WHERE type = 'table'`).map((row) => row.name));
            const staleWorkspaceIds = new Set();
            for (const tableName of WORKSPACE_SCOPED_DB_TABLES) {
                if (!availableTables.has(tableName)) {
                    continue;
                }
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
                    if (!availableTables.has(tableName)) {
                        continue;
                    }
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
                db.exec(`ALTER TABLE workspace_settings ADD COLUMN kb_access_mode TEXT NOT NULL DEFAULT 'direct'`);
            }
        }
        finally {
            db.close();
        }
    }
    ensurePBIBatchWorkerStageBudgetMinutesColumn(dbPath) {
        const db = (0, db_1.openWorkspaceDatabase)(dbPath);
        try {
            const columns = db.all(`PRAGMA table_info(pbi_batches)`).map((c) => c.name);
            if (!columns.includes('analysis_worker_budget_minutes')) {
                db.exec(`ALTER TABLE pbi_batches ADD COLUMN analysis_worker_budget_minutes INTEGER`);
            }
        }
        finally {
            db.close();
        }
    }
    ensureAgentModelIdColumn(dbPath) {
        const db = (0, db_1.openWorkspaceDatabase)(dbPath);
        try {
            const columns = db.all(`PRAGMA table_info(workspace_settings)`).map((c) => c.name);
            if (!columns.includes('agent_model_id')) {
                db.exec(`ALTER TABLE workspace_settings ADD COLUMN agent_model_id TEXT`);
            }
        }
        finally {
            db.close();
        }
    }
    ensureAcpModelIdColumn(dbPath) {
        const db = (0, db_1.openWorkspaceDatabase)(dbPath);
        try {
            const columns = db.all(`PRAGMA table_info(workspace_settings)`).map((c) => c.name);
            if (!columns.includes('acp_model_id')) {
                db.exec(`ALTER TABLE workspace_settings ADD COLUMN acp_model_id TEXT`);
            }
        }
        finally {
            db.close();
        }
    }
    ensureAiRunsAgentModelIdColumn(dbPath) {
        const db = (0, db_1.openWorkspaceDatabase)(dbPath);
        try {
            const columns = db.all(`PRAGMA table_info(ai_runs)`).map((c) => c.name);
            if (!columns.includes('agent_model_id')) {
                db.exec(`ALTER TABLE ai_runs ADD COLUMN agent_model_id TEXT`);
            }
        }
        finally {
            db.close();
        }
    }
    normalizeBatchAnalysisExecutionCounts(counts) {
        return {
            total: counts?.total ?? 0,
            create: counts?.create ?? 0,
            edit: counts?.edit ?? 0,
            retire: counts?.retire ?? 0,
            noImpact: counts?.noImpact ?? 0,
            executed: counts?.executed ?? 0,
            blocked: counts?.blocked ?? 0,
            rejected: counts?.rejected ?? 0
        };
    }
    parseBatchAnalysisExecutionCounts(payload) {
        if (!payload) {
            return this.normalizeBatchAnalysisExecutionCounts();
        }
        try {
            return this.normalizeBatchAnalysisExecutionCounts(JSON.parse(payload));
        }
        catch {
            return this.normalizeBatchAnalysisExecutionCounts();
        }
    }
    getBatchAnalysisIterationRow(db, workspaceId, iterationId) {
        return db.get(`SELECT id,
              workspace_id as workspaceId,
              batch_id as batchId,
              iteration,
              status,
              stage,
              role,
              summary,
              agent_model_id as agentModelId,
              session_id as sessionId,
              approved_plan_id as approvedPlanId,
              last_review_verdict as lastReviewVerdict,
              outstanding_discovered_work_count as outstandingDiscoveredWorkCount,
              execution_counts_json as executionCountsJson,
              started_at as startedAtUtc,
              ended_at as endedAtUtc,
              created_at as createdAtUtc,
              updated_at as updatedAtUtc
         FROM batch_analysis_iterations
        WHERE workspace_id = @workspaceId AND id = @iterationId`, { workspaceId, iterationId });
    }
    mapBatchAnalysisIterationRow(row) {
        return {
            id: row.id,
            workspaceId: row.workspaceId,
            batchId: row.batchId,
            iteration: row.iteration,
            status: row.status,
            stage: row.stage,
            role: row.role,
            summary: row.summary ?? undefined,
            agentModelId: row.agentModelId ?? undefined,
            sessionId: row.sessionId ?? undefined,
            approvedPlanId: row.approvedPlanId ?? undefined,
            lastReviewVerdict: row.lastReviewVerdict ?? undefined,
            outstandingDiscoveredWorkCount: row.outstandingDiscoveredWorkCount,
            executionCounts: this.parseBatchAnalysisExecutionCounts(row.executionCountsJson),
            startedAtUtc: row.startedAtUtc,
            endedAtUtc: row.endedAtUtc ?? undefined,
            createdAtUtc: row.createdAtUtc,
            updatedAtUtc: row.updatedAtUtc
        };
    }
    getLatestBatchAnalysisIterationFromDb(db, workspaceId, batchId) {
        const row = db.get(`SELECT id,
              workspace_id as workspaceId,
              batch_id as batchId,
              iteration,
              status,
              stage,
              role,
              summary,
              agent_model_id as agentModelId,
              session_id as sessionId,
              approved_plan_id as approvedPlanId,
              last_review_verdict as lastReviewVerdict,
              outstanding_discovered_work_count as outstandingDiscoveredWorkCount,
              execution_counts_json as executionCountsJson,
              started_at as startedAtUtc,
              ended_at as endedAtUtc,
              created_at as createdAtUtc,
              updated_at as updatedAtUtc
         FROM batch_analysis_iterations
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY iteration DESC, updated_at DESC
        LIMIT 1`, { workspaceId, batchId });
        return row ? this.mapBatchAnalysisIterationRow(row) : null;
    }
    getLatestBatchAnalysisPlanFromDb(db, workspaceId, batchId) {
        const row = db.get(`SELECT id, payload_json as payloadJson
         FROM batch_analysis_plans
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY created_at DESC
        LIMIT 1`, { workspaceId, batchId });
        if (!row?.payloadJson) {
            return null;
        }
        try {
            const plan = JSON.parse(row.payloadJson);
            const itemStatuses = new Map(db.all(`SELECT plan_item_id as planItemId, execution_status as executionStatus
             FROM batch_analysis_plan_items
            WHERE workspace_id = @workspaceId AND plan_id = @planId`, { workspaceId, planId: row.id }).map((entry) => [entry.planItemId, entry.executionStatus]));
            return {
                ...plan,
                openQuestions: this.serializeBatchAnalysisPlanOpenQuestions(plan),
                items: plan.items.map((item) => ({
                    ...item,
                    executionStatus: itemStatuses.get(item.planItemId) ?? item.executionStatus
                }))
            };
        }
        catch {
            return null;
        }
    }
    getLatestApprovedBatchAnalysisPlanFromDb(db, workspaceId, batchId) {
        const rows = db.all(`SELECT id, payload_json as payloadJson
         FROM batch_analysis_plans
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY created_at DESC`, { workspaceId, batchId });
        for (const row of rows) {
            const plan = this.hydrateBatchAnalysisPlan(db, workspaceId, row);
            if (plan?.verdict === 'approved') {
                return plan;
            }
        }
        return null;
    }
    getLatestBatchAnalysisReviewFromDb(db, workspaceId, batchId) {
        const row = db.get(`SELECT json_object(
          'id', id,
          'workspaceId', workspace_id,
          'batchId', batch_id,
          'iterationId', iteration_id,
          'iteration', iteration,
          'stage', stage,
          'role', role,
          'verdict', verdict,
          'summary', summary,
          'didAccountForEveryPbi', did_account_for_every_pbi,
          'hasMissingCreates', has_missing_creates,
          'hasMissingEdits', has_missing_edits,
          'hasTargetIssues', has_target_issues,
          'hasOverlapOrConflict', has_overlap_or_conflict,
          'foundAdditionalArticleWork', found_additional_article_work,
          'underScopedKbImpact', under_scoped_kb_impact,
          'delta', json(delta_json),
          'createdAtUtc', created_at,
          'planId', plan_id,
          'agentModelId', agent_model_id,
          'sessionId', session_id
        ) as payloadJson
         FROM batch_analysis_reviews
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY created_at DESC
        LIMIT 1`, { workspaceId, batchId });
        if (!row?.payloadJson) {
            return null;
        }
        try {
            return JSON.parse(row.payloadJson);
        }
        catch {
            return null;
        }
    }
    getLatestBatchAnalysisWorkerReportFromDb(db, workspaceId, batchId) {
        const row = db.get(`SELECT payload_json as payloadJson
         FROM batch_analysis_worker_reports
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY created_at DESC
        LIMIT 1`, { workspaceId, batchId });
        if (!row?.payloadJson) {
            return null;
        }
        try {
            return JSON.parse(row.payloadJson);
        }
        catch {
            return null;
        }
    }
    getLatestBatchAnalysisWorkerReportForIterationFromDb(db, iterationId) {
        const row = db.get(`SELECT payload_json as payloadJson
         FROM batch_analysis_worker_reports
        WHERE iteration_id = @iterationId
        ORDER BY created_at DESC
        LIMIT 1`, { iterationId });
        if (!row?.payloadJson) {
            return null;
        }
        try {
            return JSON.parse(row.payloadJson);
        }
        catch {
            return null;
        }
    }
    getLatestBatchAnalysisFinalReviewFromDb(db, workspaceId, batchId) {
        const row = db.get(`SELECT json_object(
          'id', id,
          'workspaceId', workspace_id,
          'batchId', batch_id,
          'iterationId', iteration_id,
          'iteration', iteration,
          'stage', stage,
          'role', role,
          'verdict', verdict,
          'summary', summary,
          'allPbisMapped', all_pbis_mapped,
          'planExecutionComplete', plan_execution_complete,
          'hasMissingArticleChanges', has_missing_article_changes,
          'hasUnresolvedDiscoveredWork', has_unresolved_discovered_work,
          'delta', json(delta_json),
          'createdAtUtc', created_at,
          'planId', plan_id,
          'workerReportId', worker_report_id,
          'agentModelId', agent_model_id,
          'sessionId', session_id
        ) as payloadJson
         FROM batch_analysis_final_reviews
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY created_at DESC
        LIMIT 1`, { workspaceId, batchId });
        if (!row?.payloadJson) {
            return null;
        }
        try {
            return JSON.parse(row.payloadJson);
        }
        catch {
            return null;
        }
    }
    mapBatchAnalysisStageEventRow(row) {
        let details;
        if (row.detailsJson) {
            try {
                const parsed = JSON.parse(row.detailsJson);
                if (parsed && typeof parsed === 'object') {
                    details = parsed;
                }
            }
            catch {
                details = undefined;
            }
        }
        return {
            id: row.id,
            workspaceId: row.workspaceId,
            batchId: row.batchId,
            iterationId: row.iterationId,
            iteration: row.iteration,
            stage: row.stage,
            role: row.role,
            eventType: row.eventType,
            status: row.status ?? undefined,
            summary: row.summary ?? undefined,
            sessionId: row.sessionId ?? undefined,
            agentModelId: row.agentModelId ?? undefined,
            approvedPlanId: row.approvedPlanId ?? undefined,
            lastReviewVerdict: row.lastReviewVerdict ?? undefined,
            outstandingDiscoveredWorkCount: row.outstandingDiscoveredWorkCount,
            executionCounts: this.parseBatchAnalysisExecutionCounts(row.executionCountsJson),
            details,
            createdAtUtc: row.createdAtUtc
        };
    }
    getLatestBatchAnalysisStageEventFromDb(db, workspaceId, batchId) {
        const row = db.get(`SELECT id,
              workspace_id as workspaceId,
              batch_id as batchId,
              iteration_id as iterationId,
              iteration,
              stage,
              role,
              event_type as eventType,
              status,
              summary,
              session_id as sessionId,
              agent_model_id as agentModelId,
              approved_plan_id as approvedPlanId,
              last_review_verdict as lastReviewVerdict,
              outstanding_discovered_work_count as outstandingDiscoveredWorkCount,
              execution_counts_json as executionCountsJson,
              details_json as detailsJson,
              created_at as createdAtUtc
         FROM batch_analysis_stage_events
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY created_at DESC
        LIMIT 1`, { workspaceId, batchId });
        return row ? this.mapBatchAnalysisStageEventRow(row) : null;
    }
    hydrateBatchAnalysisPlan(db, workspaceId, row) {
        if (!row.payloadJson) {
            return null;
        }
        try {
            const plan = JSON.parse(row.payloadJson);
            const itemStatuses = new Map(db.all(`SELECT plan_item_id as planItemId, execution_status as executionStatus
             FROM batch_analysis_plan_items
            WHERE workspace_id = @workspaceId AND plan_id = @planId`, { workspaceId, planId: row.id }).map((entry) => [entry.planItemId, entry.executionStatus]));
            return {
                ...plan,
                items: plan.items.map((item) => ({
                    ...item,
                    executionStatus: itemStatuses.get(item.planItemId) ?? item.executionStatus
                }))
            };
        }
        catch {
            return null;
        }
    }
    serializeBatchAnalysisPlanOpenQuestions(plan) {
        const structuredQuestionByKey = new Map((plan.questions ?? [])
            .map((question) => [
            this.normalizeBatchAnalysisQuestionPromptKey(question.prompt),
            question
        ]));
        const promptsFromQuestions = (plan.questions ?? [])
            .filter((question) => this.shouldPersistBatchAnalysisQuestionAsOpen(question))
            .map((question) => question.prompt?.trim())
            .filter((prompt) => Boolean(prompt));
        const promptsFromLegacyOpenQuestions = (plan.openQuestions ?? [])
            .map((prompt) => prompt.trim())
            .filter(Boolean)
            .filter((prompt) => {
            const matchingStructuredQuestion = structuredQuestionByKey.get(this.normalizeBatchAnalysisQuestionPromptKey(prompt));
            return !matchingStructuredQuestion || this.shouldPersistBatchAnalysisQuestionAsOpen(matchingStructuredQuestion);
        });
        return Array.from(new Set([...promptsFromLegacyOpenQuestions, ...promptsFromQuestions]));
    }
    shouldPersistBatchAnalysisQuestionAsOpen(question) {
        return question.status === 'pending'
            && !question.answer?.trim()
            && Boolean(question.prompt?.trim());
    }
    normalizeBatchAnalysisQuestionPromptKey(prompt) {
        return (prompt ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    }
    listBatchAnalysisIterationsFromDb(db, workspaceId, batchId) {
        const rows = db.all(`SELECT id,
              workspace_id as workspaceId,
              batch_id as batchId,
              iteration,
              status,
              stage,
              role,
              summary,
              agent_model_id as agentModelId,
              session_id as sessionId,
              approved_plan_id as approvedPlanId,
              last_review_verdict as lastReviewVerdict,
              outstanding_discovered_work_count as outstandingDiscoveredWorkCount,
              execution_counts_json as executionCountsJson,
              started_at as startedAtUtc,
              ended_at as endedAtUtc,
              created_at as createdAtUtc,
              updated_at as updatedAtUtc
         FROM batch_analysis_iterations
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY iteration DESC, updated_at DESC`, { workspaceId, batchId });
        return rows.flatMap((row) => row ? [this.mapBatchAnalysisIterationRow(row)] : []);
    }
    listBatchAnalysisPlansFromDb(db, workspaceId, batchId) {
        const rows = db.all(`SELECT id, payload_json as payloadJson
         FROM batch_analysis_plans
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY created_at DESC`, { workspaceId, batchId });
        return rows.flatMap((row) => {
            const plan = this.hydrateBatchAnalysisPlan(db, workspaceId, row);
            return plan ? [plan] : [];
        });
    }
    listBatchAnalysisReviewsFromDb(db, workspaceId, batchId) {
        const rows = db.all(`SELECT json_object(
          'id', id,
          'workspaceId', workspace_id,
          'batchId', batch_id,
          'iterationId', iteration_id,
          'iteration', iteration,
          'stage', stage,
          'role', role,
          'verdict', verdict,
          'summary', summary,
          'didAccountForEveryPbi', did_account_for_every_pbi,
          'hasMissingCreates', has_missing_creates,
          'hasMissingEdits', has_missing_edits,
          'hasTargetIssues', has_target_issues,
          'hasOverlapOrConflict', has_overlap_or_conflict,
          'foundAdditionalArticleWork', found_additional_article_work,
          'underScopedKbImpact', under_scoped_kb_impact,
          'delta', json(delta_json),
          'createdAtUtc', created_at,
          'planId', plan_id,
          'agentModelId', agent_model_id,
          'sessionId', session_id
        ) as payloadJson
         FROM batch_analysis_reviews
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY created_at DESC`, { workspaceId, batchId });
        return rows.flatMap((row) => {
            try {
                return row.payloadJson ? [JSON.parse(row.payloadJson)] : [];
            }
            catch {
                return [];
            }
        });
    }
    listBatchAnalysisWorkerReportsFromDb(db, workspaceId, batchId) {
        const rows = db.all(`SELECT payload_json as payloadJson
         FROM batch_analysis_worker_reports
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY created_at DESC`, { workspaceId, batchId });
        return rows.flatMap((row) => {
            try {
                return row.payloadJson ? [JSON.parse(row.payloadJson)] : [];
            }
            catch {
                return [];
            }
        });
    }
    listBatchAnalysisDiscoveredWorkFromDb(db, workspaceId, batchId) {
        const rows = db.all(`SELECT payload_json as payloadJson,
              status as status
         FROM batch_analysis_discovered_work
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY created_at DESC`, { workspaceId, batchId });
        return rows.flatMap((row) => {
            const item = this.parseBatchDiscoveredWorkRow(row);
            return item ? [item] : [];
        });
    }
    parseBatchDiscoveredWorkRow(row) {
        if (!row.payloadJson) {
            return null;
        }
        try {
            const item = JSON.parse(row.payloadJson);
            return row.status ? { ...item, status: row.status } : item;
        }
        catch {
            return null;
        }
    }
    mapBatchAnalysisQuestionSetRow(row) {
        return {
            id: row.id,
            workspaceId: row.workspaceId,
            batchId: row.batchId,
            iterationId: row.iterationId,
            sourceStage: row.sourceStage,
            sourceRole: row.sourceRole,
            resumeStage: row.resumeStage,
            resumeRole: row.resumeRole,
            status: row.status,
            summary: row.summary,
            planId: row.planId ?? undefined,
            reviewId: row.reviewId ?? undefined,
            createdAtUtc: row.createdAtUtc,
            updatedAtUtc: row.updatedAtUtc
        };
    }
    mapBatchAnalysisQuestionRow(row) {
        const parseIdList = (value) => {
            if (!value) {
                return [];
            }
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
            }
            catch {
                return [];
            }
        };
        return {
            id: row.id,
            questionSetId: row.questionSetId,
            prompt: row.prompt,
            reason: row.reason,
            requiresUserInput: row.requiresUserInput === 1,
            linkedPbiIds: parseIdList(row.linkedPbiIdsJson),
            linkedPlanItemIds: parseIdList(row.linkedPlanItemIdsJson),
            linkedDiscoveryIds: parseIdList(row.linkedDiscoveryIdsJson),
            answer: row.answer ?? undefined,
            status: row.status,
            createdAtUtc: row.createdAtUtc,
            answeredAtUtc: row.answeredAtUtc ?? undefined
        };
    }
    listBatchAnalysisQuestionSetsFromDb(db, workspaceId, batchId) {
        const rows = db.all(`SELECT id,
              workspace_id as workspaceId,
              batch_id as batchId,
              iteration_id as iterationId,
              source_stage as sourceStage,
              source_role as sourceRole,
              resume_stage as resumeStage,
              resume_role as resumeRole,
              status,
              summary,
              plan_id as planId,
              review_id as reviewId,
              created_at as createdAtUtc,
              updated_at as updatedAtUtc
         FROM batch_analysis_question_sets
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY updated_at DESC, created_at DESC`, { workspaceId, batchId });
        return rows.map((row) => this.mapBatchAnalysisQuestionSetRow(row));
    }
    listBatchAnalysisQuestionsFromDb(db, workspaceId, batchId, questionSetId) {
        const rows = db.all(`SELECT id,
              question_set_id as questionSetId,
              workspace_id as workspaceId,
              batch_id as batchId,
              iteration_id as iterationId,
              question_order as questionOrder,
              prompt,
              reason,
              requires_user_input as requiresUserInput,
              linked_pbi_ids_json as linkedPbiIdsJson,
              linked_plan_item_ids_json as linkedPlanItemIdsJson,
              linked_discovery_ids_json as linkedDiscoveryIdsJson,
              answer,
              status,
              created_at as createdAtUtc,
              answered_at as answeredAtUtc
         FROM batch_analysis_questions
        WHERE workspace_id = @workspaceId
          AND batch_id = @batchId
          AND (@questionSetId IS NULL OR question_set_id = @questionSetId)
        ORDER BY created_at DESC, question_order ASC`, {
            workspaceId,
            batchId,
            questionSetId: questionSetId ?? null
        });
        return rows.map((row) => this.mapBatchAnalysisQuestionRow(row));
    }
    getLatestPendingBatchAnalysisQuestionSetFromDb(db, workspaceId, batchId) {
        const row = db.get(`SELECT id,
              workspace_id as workspaceId,
              batch_id as batchId,
              iteration_id as iterationId,
              source_stage as sourceStage,
              source_role as sourceRole,
              resume_stage as resumeStage,
              resume_role as resumeRole,
              status,
              summary,
              plan_id as planId,
              review_id as reviewId,
              created_at as createdAtUtc,
              updated_at as updatedAtUtc
         FROM batch_analysis_question_sets
        WHERE workspace_id = @workspaceId
          AND batch_id = @batchId
          AND status IN ('waiting', 'ready_to_resume', 'resuming')
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1`, { workspaceId, batchId });
        return row ? this.mapBatchAnalysisQuestionSetRow(row) : null;
    }
    listBatchAnalysisAmendmentsFromDb(db, workspaceId, batchId) {
        const rows = db.all(`SELECT json_object(
          'id', id,
          'workspaceId', workspace_id,
          'batchId', batch_id,
          'iterationId', iteration_id,
          'approvedPlanId', approved_plan_id,
          'sourceWorkerReportId', source_worker_report_id,
          'sourceDiscoveryIds', json(source_discovery_ids_json),
          'proposedPlanId', proposed_plan_id,
          'reviewId', review_id,
          'status', status,
          'summary', summary,
          'createdAtUtc', created_at,
          'updatedAtUtc', updated_at
        ) as payloadJson
         FROM batch_analysis_amendments
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY created_at DESC`, { workspaceId, batchId });
        return rows.flatMap((row) => {
            try {
                return row.payloadJson ? [JSON.parse(row.payloadJson)] : [];
            }
            catch {
                return [];
            }
        });
    }
    listBatchAnalysisFinalReviewsFromDb(db, workspaceId, batchId) {
        const rows = db.all(`SELECT json_object(
          'id', id,
          'workspaceId', workspace_id,
          'batchId', batch_id,
          'iterationId', iteration_id,
          'iteration', iteration,
          'stage', stage,
          'role', role,
          'verdict', verdict,
          'summary', summary,
          'allPbisMapped', all_pbis_mapped,
          'planExecutionComplete', plan_execution_complete,
          'hasMissingArticleChanges', has_missing_article_changes,
          'hasUnresolvedDiscoveredWork', has_unresolved_discovered_work,
          'delta', json(delta_json),
          'createdAtUtc', created_at,
          'planId', plan_id,
          'workerReportId', worker_report_id,
          'agentModelId', agent_model_id,
          'sessionId', session_id
        ) as payloadJson
         FROM batch_analysis_final_reviews
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY created_at DESC`, { workspaceId, batchId });
        return rows.flatMap((row) => {
            try {
                return row.payloadJson ? [JSON.parse(row.payloadJson)] : [];
            }
            catch {
                return [];
            }
        });
    }
    async transitionBatchAnalysisQuestionSetStatus(params) {
        const workspace = await this.getWorkspace(params.workspaceId);
        await this.ensureWorkspaceDb(workspace.path);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const current = workspaceDb.get(`SELECT id,
                workspace_id as workspaceId,
                batch_id as batchId,
                iteration_id as iterationId,
                source_stage as sourceStage,
                source_role as sourceRole,
                resume_stage as resumeStage,
                resume_role as resumeRole,
                status,
                summary,
                plan_id as planId,
                review_id as reviewId,
                created_at as createdAtUtc,
                updated_at as updatedAtUtc
           FROM batch_analysis_question_sets
          WHERE workspace_id = @workspaceId AND id = @questionSetId`, {
                workspaceId: params.workspaceId,
                questionSetId: params.questionSetId
            });
            if (!current) {
                return { questionSet: null, transitioned: false };
            }
            if (!params.fromStatuses.includes(current.status)) {
                return {
                    questionSet: this.mapBatchAnalysisQuestionSetRow(current),
                    transitioned: false
                };
            }
            const updatedAtUtc = new Date().toISOString();
            workspaceDb.run(`UPDATE batch_analysis_question_sets
            SET status = @status,
                updated_at = @updatedAtUtc
          WHERE workspace_id = @workspaceId AND id = @questionSetId`, {
                workspaceId: params.workspaceId,
                questionSetId: params.questionSetId,
                status: params.toStatus,
                updatedAtUtc
            });
            return {
                questionSet: {
                    ...this.mapBatchAnalysisQuestionSetRow(current),
                    status: params.toStatus,
                    updatedAtUtc
                },
                transitioned: true
            };
        }
        finally {
            workspaceDb.close();
        }
    }
    parseBatchAnalysisToolCalls(raw) {
        if (!raw) {
            return [];
        }
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    }
    parseBatchAnalysisRawOutput(raw) {
        if (!raw) {
            return [];
        }
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    }
    mapLegacyRunRowToPersistedRun(row) {
        if (!row) {
            return null;
        }
        return {
            id: row.id,
            workspaceId: row.workspaceId,
            batchId: row.batchId,
            sessionId: row.sessionId ?? undefined,
            kbAccessMode: row.kbAccessMode ?? DEFAULT_KB_ACCESS_MODE,
            agentModelId: row.agentModelId?.trim() ? row.agentModelId.trim() : undefined,
            status: row.status,
            startedAtUtc: row.startedAtUtc,
            endedAtUtc: row.endedAtUtc ?? undefined,
            promptTemplate: row.promptTemplate ?? undefined,
            transcriptPath: row.transcriptPath ?? undefined,
            toolCalls: this.parseBatchAnalysisToolCalls(row.toolCallsJson),
            rawOutput: this.parseBatchAnalysisRawOutput(row.rawOutputJson),
            message: row.message ?? undefined
        };
    }
    mapStageRunRow(row) {
        return {
            id: row.id,
            workspaceId: row.workspaceId,
            batchId: row.batchId,
            iterationId: row.iterationId,
            iteration: row.iteration,
            stage: row.stage,
            role: row.role,
            attempt: row.attempt,
            retryType: row.retryType ?? undefined,
            sessionReusePolicy: row.sessionReusePolicy ?? undefined,
            localSessionId: row.localSessionId ?? undefined,
            acpSessionId: row.acpSessionId ?? undefined,
            kbAccessMode: row.kbAccessMode ?? undefined,
            agentModelId: row.agentModelId?.trim() ? row.agentModelId.trim() : undefined,
            status: row.status,
            promptTemplate: row.promptTemplate ?? undefined,
            transcriptPath: row.transcriptPath ?? undefined,
            toolCallCount: row.toolCallCount ?? 0,
            toolCalls: this.parseBatchAnalysisToolCalls(row.toolCallsJson),
            rawOutput: this.parseBatchAnalysisRawOutput(row.rawOutputJson),
            message: row.message ?? undefined,
            parseable: row.parseable == null ? undefined : row.parseable === 1,
            usedTranscriptRecovery: row.usedTranscriptRecovery == null ? undefined : row.usedTranscriptRecovery === 1,
            initialCandidateCount: row.initialCandidateCount ?? undefined,
            transcriptCandidateCount: row.transcriptCandidateCount ?? undefined,
            textLength: row.textLength ?? undefined,
            resultTextPreview: row.resultTextPreview ?? undefined,
            startedAtUtc: row.startedAtUtc,
            endedAtUtc: row.endedAtUtc ?? undefined,
            createdAtUtc: row.createdAtUtc
        };
    }
    mapStageRunRowToPersistedRun(row) {
        const stageRun = this.mapStageRunRow(row);
        return {
            id: stageRun.id,
            workspaceId: stageRun.workspaceId,
            batchId: stageRun.batchId,
            sessionId: stageRun.localSessionId,
            acpSessionId: stageRun.acpSessionId,
            kbAccessMode: stageRun.kbAccessMode,
            agentModelId: stageRun.agentModelId,
            status: stageRun.status,
            startedAtUtc: stageRun.startedAtUtc,
            endedAtUtc: stageRun.endedAtUtc,
            promptTemplate: stageRun.promptTemplate,
            transcriptPath: stageRun.transcriptPath,
            toolCalls: stageRun.toolCalls,
            rawOutput: stageRun.rawOutput,
            message: stageRun.message
        };
    }
    parseStageRunMarker(message) {
        if (!message) {
            return null;
        }
        const marker = message.match(/^\[([a-z_]+)\/([a-z-]+)\]/i);
        if (!marker) {
            return null;
        }
        const stage = marker[1];
        const role = marker[2];
        const validStage = [
            'queued',
            'planning',
            'plan_reviewing',
            'plan_revision',
            'awaiting_user_input',
            'building',
            'worker_discovery_review',
            'final_reviewing',
            'reworking',
            'approved',
            'needs_human_review',
            'failed',
            'canceled'
        ];
        const validRole = [
            'planner',
            'plan-reviewer',
            'worker',
            'final-reviewer'
        ];
        if (!validStage.includes(stage) || !validRole.includes(role)) {
            return null;
        }
        return { stage, role };
    }
    listBatchAnalysisStageRunsFromDb(db, workspaceId, batchId) {
        const rows = db.all(`SELECT id,
              workspace_id as workspaceId,
              batch_id as batchId,
              iteration_id as iterationId,
              iteration,
              stage,
              role,
              attempt,
              retry_type as retryType,
              session_reuse_policy as sessionReusePolicy,
              local_session_id as localSessionId,
              acp_session_id as acpSessionId,
              kb_access_mode as kbAccessMode,
              agent_model_id as agentModelId,
              status,
              prompt_template as promptTemplate,
              transcript_path as transcriptPath,
              tool_call_count as toolCallCount,
              tool_calls_json as toolCallsJson,
              raw_output_json as rawOutputJson,
              message,
              parseable,
              used_transcript_recovery as usedTranscriptRecovery,
              initial_candidate_count as initialCandidateCount,
              transcript_candidate_count as transcriptCandidateCount,
              text_length as textLength,
              result_text_preview as resultTextPreview,
              started_at as startedAtUtc,
              ended_at as endedAtUtc,
              created_at as createdAtUtc
         FROM batch_analysis_stage_runs
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY created_at DESC`, { workspaceId, batchId });
        return rows.map((row) => this.mapStageRunRow(row));
    }
    listBatchAnalysisRunsFromDb(db, workspaceId, batchId) {
        const rows = db.all(`SELECT id,
              workspace_id as workspaceId,
              batch_id as batchId,
              session_id as sessionId,
              kb_access_mode as kbAccessMode,
              agent_model_id as agentModelId,
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
        ORDER BY started_at DESC`, { workspaceId, batchId });
        return rows.flatMap((row) => {
            const mapped = this.mapLegacyRunRowToPersistedRun(row);
            return mapped ? [mapped] : [];
        });
    }
    listBatchAnalysisStageEventsFromDb(db, workspaceId, batchId, limit = 100) {
        const rows = db.all(`SELECT id,
              workspace_id as workspaceId,
              batch_id as batchId,
              iteration_id as iterationId,
              iteration,
              stage,
              role,
              event_type as eventType,
              status,
              summary,
              session_id as sessionId,
              agent_model_id as agentModelId,
              approved_plan_id as approvedPlanId,
              last_review_verdict as lastReviewVerdict,
              outstanding_discovered_work_count as outstandingDiscoveredWorkCount,
              execution_counts_json as executionCountsJson,
              details_json as detailsJson,
              created_at as createdAtUtc
         FROM batch_analysis_stage_events
        WHERE workspace_id = @workspaceId AND batch_id = @batchId
        ORDER BY created_at DESC
        LIMIT @limit`, { workspaceId, batchId, limit });
        return rows.map((row) => this.mapBatchAnalysisStageEventRow(row));
    }
    backfillLegacyBatchAnalysisIterations(db) {
        const batches = db.all(`SELECT ai_runs.workspace_id as workspaceId,
              ai_runs.batch_id as batchId,
              COUNT(*) as totalRuns
         FROM ai_runs
        WHERE ai_runs.batch_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
              FROM batch_analysis_iterations iterations
             WHERE iterations.workspace_id = ai_runs.workspace_id
               AND iterations.batch_id = ai_runs.batch_id
          )
        GROUP BY ai_runs.workspace_id, ai_runs.batch_id`);
        let inserted = 0;
        for (const batch of batches) {
            const runs = db.all(`SELECT id,
                workspace_id as workspaceId,
                batch_id as batchId,
                session_id as sessionId,
                agent_model_id as agentModelId,
                status,
                started_at as startedAtUtc,
                ended_at as endedAtUtc,
                message
           FROM ai_runs
          WHERE workspace_id = @workspaceId AND batch_id = @batchId
          ORDER BY started_at ASC, id ASC`, batch);
            runs.forEach((run, index) => {
                const stage = run.status === 'complete'
                    ? 'approved'
                    : run.status === 'canceled'
                        ? 'canceled'
                        : 'failed';
                const role = run.status === 'complete' ? 'final-reviewer' : 'worker';
                const status = run.status === 'complete'
                    ? 'completed'
                    : run.status === 'canceled'
                        ? 'canceled'
                        : 'failed';
                const summary = run.message?.trim() || 'Legacy single-run analysis imported into orchestration history.';
                db.run(`INSERT INTO batch_analysis_iterations (
            id, workspace_id, batch_id, iteration, status, stage, role, summary, agent_model_id, session_id,
            approved_plan_id, last_review_verdict, outstanding_discovered_work_count, execution_counts_json,
            started_at, ended_at, created_at, updated_at
          ) VALUES (
            @id, @workspaceId, @batchId, @iteration, @status, @stage, @role, @summary, @agentModelId, @sessionId,
            NULL, NULL, 0, @executionCountsJson, @startedAtUtc, @endedAtUtc, @createdAtUtc, @updatedAtUtc
          )`, {
                    id: (0, node_crypto_1.randomUUID)(),
                    workspaceId: run.workspaceId,
                    batchId: run.batchId,
                    iteration: index + 1,
                    status,
                    stage,
                    role,
                    summary,
                    agentModelId: run.agentModelId ?? null,
                    sessionId: run.sessionId ?? null,
                    executionCountsJson: JSON.stringify(this.normalizeBatchAnalysisExecutionCounts()),
                    startedAtUtc: run.startedAtUtc,
                    endedAtUtc: run.endedAtUtc ?? run.startedAtUtc,
                    createdAtUtc: run.startedAtUtc,
                    updatedAtUtc: run.endedAtUtc ?? run.startedAtUtc
                });
                inserted += 1;
            });
        }
        return inserted;
    }
    backfillLegacyBatchAnalysisStageRuns(db) {
        const aiRunColumns = new Set(db.all(`PRAGMA table_info(ai_runs)`).map((column) => column.name));
        const selectAgentModelId = aiRunColumns.has('agent_model_id')
            ? 'agent_model_id as agentModelId'
            : 'NULL as agentModelId';
        const runs = db.all(`SELECT id,
              workspace_id as workspaceId,
              batch_id as batchId,
              session_id as sessionId,
              kb_access_mode as kbAccessMode,
              ${selectAgentModelId},
              status,
              started_at as startedAtUtc,
              ended_at as endedAtUtc,
              prompt_template as promptTemplate,
              transcript_path as transcriptPath,
              tool_calls_json as toolCallsJson,
              raw_output_json as rawOutputJson,
              message
         FROM ai_runs
        WHERE batch_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
              FROM batch_analysis_stage_runs stage_runs
             WHERE stage_runs.workspace_id = ai_runs.workspace_id
               AND stage_runs.batch_id = ai_runs.batch_id
               AND stage_runs.started_at = ai_runs.started_at
               AND (
                 (stage_runs.local_session_id IS NULL AND ai_runs.session_id IS NULL)
                 OR stage_runs.local_session_id = ai_runs.session_id
               )
          )
        ORDER BY started_at ASC, id ASC`);
        let inserted = 0;
        for (const run of runs) {
            const explicitStage = this.parseStageRunMarker(run.message);
            const iteration = db.get(`SELECT id, iteration
             FROM batch_analysis_iterations
            WHERE workspace_id = @workspaceId
              AND batch_id = @batchId
              AND (
                (session_id IS NULL AND @sessionId IS NULL)
                OR session_id = @sessionId
              )
            ORDER BY updated_at DESC
            LIMIT 1`, {
                workspaceId: run.workspaceId,
                batchId: run.batchId,
                sessionId: run.sessionId
            }) ?? db.get(`SELECT id, iteration
             FROM batch_analysis_iterations
            WHERE workspace_id = @workspaceId AND batch_id = @batchId
            ORDER BY updated_at DESC
            LIMIT 1`, {
                workspaceId: run.workspaceId,
                batchId: run.batchId
            });
            const workerReport = db.get(`SELECT iteration_id as iterationId,
                iteration,
                stage,
                role
           FROM batch_analysis_worker_reports
          WHERE workspace_id = @workspaceId
            AND batch_id = @batchId
            AND (
              (session_id IS NULL AND @sessionId IS NULL)
              OR session_id = @sessionId
            )
          ORDER BY created_at DESC
          LIMIT 1`, {
                workspaceId: run.workspaceId,
                batchId: run.batchId,
                sessionId: run.sessionId
            });
            const fallbackStage = run.status === 'complete'
                ? 'approved'
                : run.status === 'canceled'
                    ? 'canceled'
                    : 'failed';
            const fallbackRole = run.status === 'complete' ? 'final-reviewer' : 'worker';
            const derivedStage = explicitStage?.stage ?? workerReport?.stage ?? fallbackStage;
            const derivedRole = explicitStage?.role ?? workerReport?.role ?? fallbackRole;
            const targetIterationId = iteration?.id ?? workerReport?.iterationId;
            const targetIteration = iteration?.iteration ?? workerReport?.iteration;
            if (!derivedStage || !derivedRole || !targetIterationId || !targetIteration) {
                continue;
            }
            const nextAttempt = db.get(`SELECT COALESCE(MAX(attempt), 0) + 1 as nextAttempt
           FROM batch_analysis_stage_runs
          WHERE iteration_id = @iterationId AND stage = @stage AND role = @role`, {
                iterationId: targetIterationId,
                stage: derivedStage,
                role: derivedRole
            })?.nextAttempt ?? 1;
            db.run(`INSERT INTO batch_analysis_stage_runs (
          id, workspace_id, batch_id, iteration_id, iteration, stage, role, attempt, retry_type,
          session_reuse_policy, local_session_id, acp_session_id, kb_access_mode, agent_model_id, status,
          prompt_template, transcript_path, tool_call_count, tool_calls_json, raw_output_json, message,
          parseable, used_transcript_recovery, initial_candidate_count, transcript_candidate_count, text_length,
          result_text_preview, started_at, ended_at, created_at
        ) VALUES (
          @id, @workspaceId, @batchId, @iterationId, @iteration, @stage, @role, @attempt, NULL,
          NULL, @localSessionId, NULL, @kbAccessMode, @agentModelId, @status,
          @promptTemplate, @transcriptPath, @toolCallCount, @toolCallsJson, @rawOutputJson, @message,
          NULL, NULL, NULL, NULL, NULL, NULL, @startedAtUtc, @endedAtUtc, @createdAtUtc
        )`, {
                id: (0, node_crypto_1.randomUUID)(),
                workspaceId: run.workspaceId,
                batchId: run.batchId,
                iterationId: targetIterationId,
                iteration: targetIteration,
                stage: derivedStage,
                role: derivedRole,
                attempt: nextAttempt,
                localSessionId: run.sessionId ?? null,
                kbAccessMode: run.kbAccessMode ?? null,
                agentModelId: run.agentModelId ?? null,
                status: run.status,
                promptTemplate: run.promptTemplate ?? null,
                transcriptPath: run.transcriptPath ?? null,
                toolCallCount: this.parseBatchAnalysisToolCalls(run.toolCallsJson).length,
                toolCallsJson: run.toolCallsJson ?? '[]',
                rawOutputJson: run.rawOutputJson ?? null,
                message: run.message ?? null,
                startedAtUtc: run.startedAtUtc,
                endedAtUtc: run.endedAtUtc ?? null,
                createdAtUtc: run.endedAtUtc ?? run.startedAtUtc
            });
            inserted += 1;
        }
        return inserted;
    }
    backfillLegacyBatchAnalysisWorkerReports(db) {
        const iterations = db.all(`SELECT iterations.id,
              iterations.workspace_id as workspaceId,
              iterations.batch_id as batchId,
              iterations.iteration,
              iterations.session_id as sessionId,
              iterations.agent_model_id as agentModelId,
              iterations.summary,
              iterations.ended_at as endedAtUtc,
              iterations.status
         FROM batch_analysis_iterations iterations
        WHERE NOT EXISTS (
          SELECT 1
            FROM batch_analysis_worker_reports reports
           WHERE reports.iteration_id = iterations.id
        )
          AND iterations.role IN ('worker', 'final-reviewer')
          AND EXISTS (
            SELECT 1
              FROM ai_runs runs
             WHERE runs.workspace_id = iterations.workspace_id
               AND runs.batch_id = iterations.batch_id
               AND ((runs.session_id IS NULL AND iterations.session_id IS NULL) OR runs.session_id = iterations.session_id)
          )
          AND NOT EXISTS (
            SELECT 1
              FROM batch_analysis_plans plans
             WHERE plans.iteration_id = iterations.id
          )
          AND NOT EXISTS (
            SELECT 1
              FROM batch_analysis_reviews reviews
             WHERE reviews.iteration_id = iterations.id
          )
          AND NOT EXISTS (
            SELECT 1
              FROM batch_analysis_final_reviews final_reviews
             WHERE final_reviews.iteration_id = iterations.id
          )
          AND NOT EXISTS (
            SELECT 1
              FROM batch_analysis_amendments amendments
             WHERE amendments.iteration_id = iterations.id
          )
          AND NOT EXISTS (
            SELECT 1
              FROM batch_analysis_discovered_work discovered
             WHERE discovered.iteration_id = iterations.id
          )`);
        let inserted = 0;
        for (const iteration of iterations) {
            db.run(`INSERT INTO batch_analysis_worker_reports (
          id, workspace_id, batch_id, iteration_id, iteration, stage, role, summary, status, plan_id,
          executed_items_json, blocker_notes_json, payload_json, agent_model_id, session_id, created_at
        ) VALUES (
          @id, @workspaceId, @batchId, @iterationId, @iteration, @stage, 'worker', @summary, @status, NULL,
          '[]', @blockerNotesJson, @payloadJson, @agentModelId, @sessionId, @createdAtUtc
        )`, {
                id: (0, node_crypto_1.randomUUID)(),
                workspaceId: iteration.workspaceId,
                batchId: iteration.batchId,
                iterationId: iteration.id,
                iteration: iteration.iteration,
                stage: 'building',
                summary: iteration.summary ?? 'Legacy single-run analysis imported into worker history.',
                status: iteration.status === 'completed' ? 'completed' : iteration.status === 'canceled' ? 'blocked' : 'failed',
                blockerNotesJson: JSON.stringify(iteration.status === 'completed' ? [] : [iteration.summary ?? 'Legacy run did not complete successfully.']),
                payloadJson: JSON.stringify({
                    id: `legacy-worker-report:${iteration.id}`,
                    workspaceId: iteration.workspaceId,
                    batchId: iteration.batchId,
                    iterationId: iteration.id,
                    iteration: iteration.iteration,
                    stage: 'building',
                    role: 'worker',
                    summary: iteration.summary ?? 'Legacy single-run analysis imported into worker history.',
                    status: iteration.status === 'completed' ? 'completed' : iteration.status === 'canceled' ? 'blocked' : 'failed',
                    executedItems: [],
                    discoveredWork: [],
                    blockerNotes: iteration.status === 'completed' ? [] : [iteration.summary ?? 'Legacy run did not complete successfully.'],
                    createdAtUtc: iteration.endedAtUtc ?? new Date().toISOString(),
                    agentModelId: iteration.agentModelId ?? undefined,
                    sessionId: iteration.sessionId ?? undefined
                }),
                agentModelId: iteration.agentModelId ?? null,
                sessionId: iteration.sessionId ?? null,
                createdAtUtc: iteration.endedAtUtc ?? new Date().toISOString()
            });
            inserted += 1;
        }
        return inserted;
    }
    normalizeBatchAnalysisIterations(db) {
        const iterations = db.all(`SELECT id,
              workspace_id as workspaceId,
              batch_id as batchId,
              execution_counts_json as executionCountsJson,
              approved_plan_id as approvedPlanId,
              last_review_verdict as lastReviewVerdict,
              outstanding_discovered_work_count as outstandingDiscoveredWorkCount,
              ended_at as endedAtUtc,
              status,
              updated_at as updatedAtUtc
         FROM batch_analysis_iterations`);
        let updated = 0;
        for (const iteration of iterations) {
            const nextApprovedPlanId = iteration.approvedPlanId ?? db.get(`SELECT id
           FROM batch_analysis_plans
          WHERE iteration_id = @iterationId AND verdict = 'approved'
          ORDER BY created_at DESC
          LIMIT 1`, { iterationId: iteration.id })?.id ?? null;
            const nextLastReviewVerdict = iteration.lastReviewVerdict ?? db.get(`SELECT verdict
           FROM batch_analysis_final_reviews
          WHERE iteration_id = @iterationId
          ORDER BY created_at DESC
          LIMIT 1`, { iterationId: iteration.id })?.verdict ?? db.get(`SELECT verdict
           FROM batch_analysis_reviews
          WHERE iteration_id = @iterationId
          ORDER BY created_at DESC
          LIMIT 1`, { iterationId: iteration.id })?.verdict ?? null;
            const unresolvedDiscoveries = db.get(`SELECT COUNT(*) as total
           FROM batch_analysis_discovered_work
          WHERE iteration_id = @iterationId
            AND COALESCE(status, 'pending_review') NOT IN ('approved', 'rejected')`, { iterationId: iteration.id })?.total ?? 0;
            const currentCounts = this.parseBatchAnalysisExecutionCounts(iteration.executionCountsJson);
            const hasZeroCounts = currentCounts.total === 0 && currentCounts.executed === 0 && currentCounts.blocked === 0;
            let nextCounts = currentCounts;
            if (hasZeroCounts) {
                const workerReport = this.getLatestBatchAnalysisWorkerReportForIterationFromDb(db, iteration.id);
                if (workerReport) {
                    nextCounts = this.buildExecutionCountsFromWorkerReport(workerReport);
                }
            }
            const nextEndedAtUtc = iteration.endedAtUtc ?? (iteration.status === 'completed' || iteration.status === 'failed' || iteration.status === 'canceled' || iteration.status === 'needs_human_review'
                ? iteration.updatedAtUtc
                : null);
            const needsUpdate = nextApprovedPlanId !== iteration.approvedPlanId
                || nextLastReviewVerdict !== iteration.lastReviewVerdict
                || unresolvedDiscoveries !== iteration.outstandingDiscoveredWorkCount
                || nextEndedAtUtc !== iteration.endedAtUtc
                || JSON.stringify(nextCounts) !== JSON.stringify(currentCounts);
            if (!needsUpdate) {
                continue;
            }
            db.run(`UPDATE batch_analysis_iterations
            SET approved_plan_id = COALESCE(@approvedPlanId, approved_plan_id),
                last_review_verdict = COALESCE(@lastReviewVerdict, last_review_verdict),
                outstanding_discovered_work_count = @outstandingDiscoveredWorkCount,
                execution_counts_json = @executionCountsJson,
                ended_at = COALESCE(@endedAtUtc, ended_at),
                updated_at = @updatedAtUtc
          WHERE id = @iterationId`, {
                iterationId: iteration.id,
                approvedPlanId: nextApprovedPlanId,
                lastReviewVerdict: nextLastReviewVerdict,
                outstandingDiscoveredWorkCount: unresolvedDiscoveries,
                executionCountsJson: JSON.stringify(nextCounts),
                endedAtUtc: nextEndedAtUtc,
                updatedAtUtc: new Date().toISOString()
            });
            updated += 1;
        }
        return updated;
    }
    backfillBatchAnalysisStageEvents(db) {
        const iterations = db.all(`SELECT id,
              workspace_id as workspaceId,
              batch_id as batchId,
              iteration,
              stage,
              role,
              status,
              summary,
              session_id as sessionId,
              agent_model_id as agentModelId,
              approved_plan_id as approvedPlanId,
              last_review_verdict as lastReviewVerdict,
              outstanding_discovered_work_count as outstandingDiscoveredWorkCount,
              execution_counts_json as executionCountsJson,
              started_at as startedAtUtc,
              ended_at as endedAtUtc,
              updated_at as updatedAtUtc
         FROM batch_analysis_iterations`);
        let inserted = 0;
        for (const iteration of iterations) {
            const existingCount = db.get(`SELECT COUNT(*) as total
           FROM batch_analysis_stage_events
          WHERE iteration_id = @iterationId`, { iterationId: iteration.id })?.total ?? 0;
            if (existingCount > 0) {
                continue;
            }
            const executionCounts = this.parseBatchAnalysisExecutionCounts(iteration.executionCountsJson);
            const completedEventCreatedAtUtc = (() => {
                const candidate = iteration.endedAtUtc ?? iteration.updatedAtUtc;
                if (!candidate) {
                    return new Date(new Date(iteration.startedAtUtc).getTime() + 1).toISOString();
                }
                const candidateMs = Date.parse(candidate);
                const startedMs = Date.parse(iteration.startedAtUtc);
                if (Number.isNaN(candidateMs) || Number.isNaN(startedMs) || candidateMs > startedMs) {
                    return candidate;
                }
                return new Date(startedMs + 1).toISOString();
            })();
            db.run(`INSERT INTO batch_analysis_stage_events (
          id, workspace_id, batch_id, iteration_id, iteration, stage, role, event_type, status, summary,
          session_id, agent_model_id, approved_plan_id, last_review_verdict, outstanding_discovered_work_count,
          execution_counts_json, created_at
        ) VALUES (
          @id, @workspaceId, @batchId, @iterationId, @iteration, @stage, @role, 'iteration_started', @status, @summary,
          @sessionId, @agentModelId, @approvedPlanId, @lastReviewVerdict, @outstandingDiscoveredWorkCount,
          @executionCountsJson, @createdAtUtc
        )`, {
                id: (0, node_crypto_1.randomUUID)(),
                workspaceId: iteration.workspaceId,
                batchId: iteration.batchId,
                iterationId: iteration.id,
                iteration: iteration.iteration,
                stage: 'planning',
                role: 'planner',
                status: 'running',
                summary: 'Backfilled iteration start event.',
                sessionId: iteration.sessionId ?? null,
                agentModelId: iteration.agentModelId ?? null,
                approvedPlanId: iteration.approvedPlanId ?? null,
                lastReviewVerdict: iteration.lastReviewVerdict ?? null,
                outstandingDiscoveredWorkCount: 0,
                executionCountsJson: JSON.stringify(this.normalizeBatchAnalysisExecutionCounts()),
                createdAtUtc: iteration.startedAtUtc
            });
            inserted += 1;
            db.run(`INSERT INTO batch_analysis_stage_events (
          id, workspace_id, batch_id, iteration_id, iteration, stage, role, event_type, status, summary,
          session_id, agent_model_id, approved_plan_id, last_review_verdict, outstanding_discovered_work_count,
          execution_counts_json, created_at
        ) VALUES (
          @id, @workspaceId, @batchId, @iterationId, @iteration, @stage, @role, @eventType, @status, @summary,
          @sessionId, @agentModelId, @approvedPlanId, @lastReviewVerdict, @outstandingDiscoveredWorkCount,
          @executionCountsJson, @createdAtUtc
        )`, {
                id: (0, node_crypto_1.randomUUID)(),
                workspaceId: iteration.workspaceId,
                batchId: iteration.batchId,
                iterationId: iteration.id,
                iteration: iteration.iteration,
                stage: iteration.stage,
                role: iteration.role,
                eventType: iteration.status === 'running'
                    ? 'stage_transition'
                    : 'iteration_completed',
                status: iteration.status,
                summary: iteration.summary ?? 'Backfilled iteration state event.',
                sessionId: iteration.sessionId ?? null,
                agentModelId: iteration.agentModelId ?? null,
                approvedPlanId: iteration.approvedPlanId ?? null,
                lastReviewVerdict: iteration.lastReviewVerdict ?? null,
                outstandingDiscoveredWorkCount: iteration.outstandingDiscoveredWorkCount,
                executionCountsJson: JSON.stringify(executionCounts),
                createdAtUtc: completedEventCreatedAtUtc
            });
            inserted += 1;
        }
        return inserted;
    }
    buildExecutionCountsFromWorkerReport(report) {
        const counts = this.normalizeBatchAnalysisExecutionCounts({
            total: report.executedItems.length
        });
        for (const item of report.executedItems) {
            if (item.action === 'create')
                counts.create += 1;
            else if (item.action === 'edit')
                counts.edit += 1;
            else if (item.action === 'retire')
                counts.retire += 1;
            else
                counts.noImpact += 1;
            if (item.status === 'executed' || item.status === 'skipped') {
                counts.executed += 1;
            }
            else if (item.status === 'blocked') {
                counts.blocked += 1;
            }
        }
        return counts;
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
    async persistProposalArtifacts(workspacePath, proposalId, payload) {
        const proposalDir = node_path_1.default.join(workspacePath, 'proposals', proposalId);
        await promises_1.default.mkdir(proposalDir, { recursive: true });
        const sourceHtml = payload.sourceHtml?.trim();
        const proposedHtml = payload.proposedHtml?.trim();
        const metadata = payload.metadata && Object.keys(payload.metadata).length > 0
            ? JSON.stringify(payload.metadata, null, 2)
            : '';
        let sourceHtmlPath;
        let proposedHtmlPath;
        if (sourceHtml) {
            sourceHtmlPath = node_path_1.default.join('proposals', proposalId, 'source.html');
            await promises_1.default.writeFile(node_path_1.default.join(workspacePath, sourceHtmlPath), sourceHtml, 'utf8');
        }
        if (proposedHtml) {
            proposedHtmlPath = node_path_1.default.join('proposals', proposalId, 'proposed.html');
            await promises_1.default.writeFile(node_path_1.default.join(workspacePath, proposedHtmlPath), proposedHtml, 'utf8');
        }
        if (metadata) {
            await promises_1.default.writeFile(node_path_1.default.join(proposalDir, 'metadata.json'), metadata, 'utf8');
        }
        return { sourceHtmlPath, proposedHtmlPath };
    }
    async applyProposalDecisionMutation(workspacePath, workspaceDb, proposal, input) {
        if (input.decision === shared_types_1.ProposalReviewDecision.ARCHIVE) {
            return {
                reviewStatus: shared_types_1.ProposalReviewStatus.ARCHIVED,
                legacyStatus: shared_types_1.ProposalDecision.DEFER
            };
        }
        if (input.decision === shared_types_1.ProposalReviewDecision.DENY) {
            return {
                reviewStatus: shared_types_1.ProposalReviewStatus.DENIED,
                legacyStatus: shared_types_1.ProposalDecision.DENY
            };
        }
        if (input.decision === shared_types_1.ProposalReviewDecision.DEFER) {
            return {
                reviewStatus: shared_types_1.ProposalReviewStatus.DEFERRED,
                legacyStatus: shared_types_1.ProposalDecision.DEFER
            };
        }
        if (proposal.action === shared_types_1.ProposalAction.NO_IMPACT && input.decision === shared_types_1.ProposalReviewDecision.ACCEPT) {
            return {
                reviewStatus: shared_types_1.ProposalReviewStatus.ARCHIVED,
                legacyStatus: shared_types_1.ProposalDecision.DEFER
            };
        }
        if (proposal.action === shared_types_1.ProposalAction.RETIRE && input.decision === shared_types_1.ProposalReviewDecision.ACCEPT) {
            return this.markProposalTargetRetired(workspaceDb, proposal);
        }
        if (proposal.action === shared_types_1.ProposalAction.CREATE || proposal.action === shared_types_1.ProposalAction.EDIT) {
            if (input.decision === shared_types_1.ProposalReviewDecision.APPLY_TO_BRANCH) {
                return this.applyProposalToExistingBranch(workspacePath, workspaceDb, proposal, input.branchId);
            }
            if (input.decision === shared_types_1.ProposalReviewDecision.ACCEPT) {
                return this.applyProposalToNewBranch(workspacePath, workspaceDb, proposal, input.placementOverride);
            }
        }
        return {};
    }
    async applyProposalToNewBranch(workspacePath, workspaceDb, proposal, placementOverride) {
        const now = new Date().toISOString();
        const ensuredIdentity = await this.ensureProposalTargetIdentity(workspacePath, workspaceDb, proposal, placementOverride);
        const latestRevision = ensuredIdentity.localeVariantId
            ? await this.getLatestRevisionForVariant(workspaceDb, ensuredIdentity.localeVariantId)
            : null;
        const nextRevisionNumber = latestRevision ? latestRevision.revisionNumber + 1 : 1;
        const branchId = (0, node_crypto_1.randomUUID)();
        const revisionId = (0, node_crypto_1.randomUUID)();
        const branchName = this.buildProposalBranchName(proposal, nextRevisionNumber);
        const html = await this.getProposalFinalHtml(workspacePath, workspaceDb, proposal);
        const filePath = await this.writeProposalDraftRevision(workspacePath, ensuredIdentity.localeVariantId, branchId, revisionId, nextRevisionNumber, html);
        workspaceDb.run(`INSERT INTO draft_branches (
        id, workspace_id, locale_variant_id, name, base_revision_id, state, created_at, updated_at, retired_at,
        head_revision_id, autosave_enabled, last_autosaved_at, last_manual_saved_at, change_summary, editor_state_json
      ) VALUES (
        @id, @workspaceId, @localeVariantId, @name, @baseRevisionId, @state, @createdAt, @updatedAt, NULL,
        @headRevisionId, 1, NULL, @lastManualSavedAt, @changeSummary, NULL
      )`, {
            id: branchId,
            workspaceId: proposal.workspaceId,
            localeVariantId: ensuredIdentity.localeVariantId,
            name: branchName,
            baseRevisionId: latestRevision?.id ?? revisionId,
            state: shared_types_1.DraftBranchStatus.ACTIVE,
            createdAt: now,
            updatedAt: now,
            headRevisionId: revisionId,
            lastManualSavedAt: now,
            changeSummary: summarizeDraftChanges((0, diff_engine_1.diffHtml)(latestRevision ? await this.readRevisionSource(resolveRevisionPath(workspacePath, latestRevision.filePath)) : '', html))
        });
        workspaceDb.run(`INSERT INTO revisions (
        id, locale_variant_id, revision_type, branch_id, workspace_id, file_path, content_hash, source_revision_id, revision_number, status, created_at, updated_at
      ) VALUES (
        @id, @localeVariantId, @revisionType, @branchId, @workspaceId, @filePath, @contentHash, @sourceRevisionId, @revisionNumber, @status, @createdAt, @updatedAt
      )`, {
            id: revisionId,
            localeVariantId: ensuredIdentity.localeVariantId,
            revisionType: shared_types_1.RevisionState.DRAFT_BRANCH,
            branchId,
            workspaceId: proposal.workspaceId,
            filePath,
            contentHash: createContentHash(html),
            sourceRevisionId: latestRevision?.id ?? proposal.sourceRevisionId ?? null,
            revisionNumber: nextRevisionNumber,
            status: shared_types_1.RevisionStatus.OPEN,
            createdAt: now,
            updatedAt: now
        });
        this.recordDraftRevisionCommit(workspaceDb, {
            revisionId,
            branchId,
            workspaceId: proposal.workspaceId,
            source: shared_types_1.DraftCommitSource.PROPOSAL,
            message: 'Created from accepted proposal'
        });
        if (latestRevision) {
            this.recordArticleLineage(workspaceDb, ensuredIdentity.localeVariantId, latestRevision.id, revisionId, 'system', now);
        }
        return {
            reviewStatus: shared_types_1.ProposalReviewStatus.ACCEPTED,
            legacyStatus: shared_types_1.ProposalDecision.ACCEPT,
            branchId,
            revisionId,
            familyId: ensuredIdentity.familyId,
            localeVariantId: ensuredIdentity.localeVariantId
        };
    }
    async applyProposalToExistingBranch(workspacePath, workspaceDb, proposal, branchId) {
        const normalizedBranchId = branchId?.trim();
        if (!normalizedBranchId) {
            throw new Error('branchId is required when applying a proposal to an existing branch');
        }
        const branch = workspaceDb.get(`SELECT id, locale_variant_id as localeVariantId, base_revision_id as baseRevisionId, state
       FROM draft_branches
       WHERE id = @branchId AND workspace_id = @workspaceId
       LIMIT 1`, { branchId: normalizedBranchId, workspaceId: proposal.workspaceId });
        if (!branch) {
            throw new Error('Draft branch not found');
        }
        if (branch.state === shared_types_1.RevisionState.OBSOLETE) {
            throw new Error('Cannot apply a proposal to an obsolete draft branch');
        }
        const variant = workspaceDb.get(`SELECT family_id as familyId
       FROM locale_variants
       WHERE id = @localeVariantId
       LIMIT 1`, { localeVariantId: branch.localeVariantId });
        if (!variant) {
            throw new Error('Locale variant not found');
        }
        const latestRevision = await this.getLatestRevisionForVariant(workspaceDb, branch.localeVariantId);
        const nextRevisionNumber = latestRevision ? latestRevision.revisionNumber + 1 : 1;
        const revisionId = (0, node_crypto_1.randomUUID)();
        const html = await this.getProposalFinalHtml(workspacePath, workspaceDb, proposal);
        const filePath = await this.writeProposalDraftRevision(workspacePath, branch.localeVariantId, normalizedBranchId, revisionId, nextRevisionNumber, html);
        const now = new Date().toISOString();
        workspaceDb.run(`INSERT INTO revisions (
        id, locale_variant_id, revision_type, branch_id, workspace_id, file_path, content_hash, source_revision_id, revision_number, status, created_at, updated_at
      ) VALUES (
        @id, @localeVariantId, @revisionType, @branchId, @workspaceId, @filePath, @contentHash, @sourceRevisionId, @revisionNumber, @status, @createdAt, @updatedAt
      )`, {
            id: revisionId,
            localeVariantId: branch.localeVariantId,
            revisionType: shared_types_1.RevisionState.DRAFT_BRANCH,
            branchId: normalizedBranchId,
            workspaceId: proposal.workspaceId,
            filePath,
            contentHash: createContentHash(html),
            sourceRevisionId: latestRevision?.id ?? branch.baseRevisionId,
            revisionNumber: nextRevisionNumber,
            status: shared_types_1.RevisionStatus.OPEN,
            createdAt: now,
            updatedAt: now
        });
        workspaceDb.run(`UPDATE draft_branches
       SET head_revision_id = @headRevisionId,
           state = @state,
           last_manual_saved_at = @updatedAt,
           change_summary = @changeSummary,
           updated_at = @updatedAt
       WHERE id = @branchId AND workspace_id = @workspaceId`, {
            branchId: normalizedBranchId,
            workspaceId: proposal.workspaceId,
            headRevisionId: revisionId,
            state: shared_types_1.DraftBranchStatus.ACTIVE,
            updatedAt: now,
            changeSummary: summarizeDraftChanges((0, diff_engine_1.diffHtml)(latestRevision ? await this.readRevisionSource(resolveRevisionPath(workspacePath, latestRevision.filePath)) : '', html))
        });
        this.recordDraftRevisionCommit(workspaceDb, {
            revisionId,
            branchId: normalizedBranchId,
            workspaceId: proposal.workspaceId,
            source: shared_types_1.DraftCommitSource.PROPOSAL,
            message: 'Applied proposal into existing draft branch'
        });
        if (latestRevision) {
            this.recordArticleLineage(workspaceDb, branch.localeVariantId, latestRevision.id, revisionId, 'system', now);
        }
        return {
            reviewStatus: shared_types_1.ProposalReviewStatus.APPLIED_TO_BRANCH,
            legacyStatus: shared_types_1.ProposalDecision.APPLY_TO_BRANCH,
            branchId: normalizedBranchId,
            revisionId,
            familyId: variant.familyId,
            localeVariantId: branch.localeVariantId
        };
    }
    markProposalTargetRetired(workspaceDb, proposal) {
        const retiredAtUtc = new Date().toISOString();
        if (proposal.localeVariantId) {
            workspaceDb.run(`UPDATE locale_variants
         SET status = @status,
             retired_at = @retiredAtUtc
         WHERE id = @variantId`, {
                variantId: proposal.localeVariantId,
                status: shared_types_1.RevisionState.RETIRED,
                retiredAtUtc
            });
            workspaceDb.run(`UPDATE draft_branches
         SET state = @state,
             updated_at = @updatedAt
         WHERE workspace_id = @workspaceId AND locale_variant_id = @localeVariantId AND state != @state`, {
                workspaceId: proposal.workspaceId,
                localeVariantId: proposal.localeVariantId,
                state: shared_types_1.RevisionState.OBSOLETE,
                updatedAt: retiredAtUtc
            });
            const family = workspaceDb.get(`SELECT family_id as familyId
         FROM locale_variants
         WHERE id = @variantId
         LIMIT 1`, { variantId: proposal.localeVariantId });
            if (family?.familyId) {
                try {
                    this.markArticleRelationFamiliesStale(workspaceDb, proposal.workspaceId, [family.familyId]);
                }
                catch (error) {
                    logger_1.logger.warn('workspace-repository.markProposalTargetRetired stale-mark failed', {
                        workspaceId: proposal.workspaceId,
                        familyId: family.familyId,
                        localeVariantId: proposal.localeVariantId,
                        message: error instanceof Error ? error.message : String(error)
                    });
                }
            }
            return {
                reviewStatus: shared_types_1.ProposalReviewStatus.ACCEPTED,
                legacyStatus: shared_types_1.ProposalDecision.ACCEPT,
                familyId: proposal.familyId ?? family?.familyId,
                localeVariantId: proposal.localeVariantId,
                retiredAtUtc
            };
        }
        if (!proposal.familyId) {
            throw new Error('Retire proposals must target a locale variant or article family');
        }
        workspaceDb.run(`UPDATE article_families
       SET retired_at = @retiredAtUtc
       WHERE id = @familyId AND workspace_id = @workspaceId`, {
            familyId: proposal.familyId,
            workspaceId: proposal.workspaceId,
            retiredAtUtc
        });
        workspaceDb.run(`UPDATE locale_variants
       SET status = @status,
           retired_at = @retiredAtUtc
       WHERE family_id = @familyId`, {
            familyId: proposal.familyId,
            status: shared_types_1.RevisionState.RETIRED,
            retiredAtUtc
        });
        workspaceDb.run(`UPDATE draft_branches
       SET state = @state,
           updated_at = @updatedAt
       WHERE workspace_id = @workspaceId
         AND locale_variant_id IN (
           SELECT id
           FROM locale_variants
           WHERE family_id = @familyId
         )
         AND state != @state`, {
            familyId: proposal.familyId,
            workspaceId: proposal.workspaceId,
            state: shared_types_1.RevisionState.OBSOLETE,
            updatedAt: retiredAtUtc
        });
        try {
            this.markArticleRelationFamiliesStale(workspaceDb, proposal.workspaceId, [proposal.familyId]);
        }
        catch (error) {
            logger_1.logger.warn('workspace-repository.markProposalTargetRetired stale-mark failed', {
                workspaceId: proposal.workspaceId,
                familyId: proposal.familyId,
                message: error instanceof Error ? error.message : String(error)
            });
        }
        return {
            reviewStatus: shared_types_1.ProposalReviewStatus.ACCEPTED,
            legacyStatus: shared_types_1.ProposalDecision.ACCEPT,
            familyId: proposal.familyId,
            retiredAtUtc
        };
    }
    async ensureProposalTargetIdentity(workspacePath, workspaceDb, proposal, placementOverride) {
        if (proposal.localeVariantId) {
            const variant = workspaceDb.get(`SELECT family_id as familyId
         FROM locale_variants
         WHERE id = @variantId
         LIMIT 1`, { variantId: proposal.localeVariantId });
            if (!variant) {
                throw new Error('Locale variant not found');
            }
            return {
                familyId: proposal.familyId ?? variant.familyId,
                localeVariantId: proposal.localeVariantId
            };
        }
        let familyId = proposal.familyId;
        const locale = proposal.targetLocale?.trim() || 'en-us';
        const placement = placementOverride ?? proposal.suggestedPlacement;
        if (!familyId) {
            const familyTitle = proposal.targetTitle?.trim() || deriveProposalArticleDescriptor(proposal).articleLabel;
            const family = await this.createArticleFamily({
                workspaceId: proposal.workspaceId,
                externalKey: `proposal-${proposal.id}`,
                title: familyTitle,
                categoryId: placement?.categoryId,
                sectionId: placement?.sectionId
            });
            familyId = family.id;
        }
        else if (placement?.categoryId || placement?.sectionId) {
            await this.updateArticleFamily({
                workspaceId: proposal.workspaceId,
                familyId,
                categoryId: placement.categoryId ?? undefined,
                sectionId: placement.sectionId ?? undefined
            });
        }
        let localeVariant = await this.getLocaleVariantByFamilyAndLocale(proposal.workspaceId, familyId, locale);
        if (!localeVariant) {
            localeVariant = await this.createLocaleVariant({
                workspaceId: proposal.workspaceId,
                familyId,
                locale,
                status: shared_types_1.RevisionState.DRAFT_BRANCH
            });
        }
        return {
            familyId,
            localeVariantId: localeVariant.id
        };
    }
    async getLatestRevisionForVariant(workspaceDb, localeVariantId, revisionType) {
        const row = workspaceDb.get(`SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
              workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
              revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
       FROM revisions
       WHERE locale_variant_id = @localeVariantId
         ${revisionType ? 'AND revision_type = @revisionType' : ''}
       ORDER BY revision_number DESC
       LIMIT 1`, { localeVariantId, revisionType });
        return row ?? null;
    }
    async getProposalFinalHtml(workspacePath, workspaceDb, proposal) {
        const relatedPbis = [];
        const hydrated = await this.ensureProposalReviewArtifacts(workspacePath, workspaceDb, proposal, relatedPbis);
        return hydrated.afterHtml || hydrated.beforeHtml;
    }
    buildProposalBranchName(proposal, revisionNumber) {
        const base = proposal.targetTitle?.trim() || deriveProposalArticleDescriptor(proposal).articleLabel;
        return `${base} Draft ${revisionNumber}`;
    }
    async writeProposalDraftRevision(workspacePath, localeVariantId, branchId, revisionId, revisionNumber, html) {
        const branchDir = node_path_1.default.join(workspacePath, 'drafts', localeVariantId, branchId);
        await promises_1.default.mkdir(branchDir, { recursive: true });
        const fileName = `${String(revisionNumber).padStart(4, '0')}-${revisionId}.html`;
        const absolutePath = node_path_1.default.join(branchDir, fileName);
        await promises_1.default.writeFile(absolutePath, html || '', 'utf8');
        return node_path_1.default.relative(workspacePath, absolutePath);
    }
    async ensureProposalReviewArtifacts(workspacePath, workspaceDb, proposal, relatedPbis) {
        let beforeHtml = await this.readProposalArtifact(workspacePath, proposal.sourceHtmlPath);
        let afterHtml = await this.readProposalArtifact(workspacePath, proposal.proposedHtmlPath);
        if (beforeHtml && afterHtml) {
            return { proposal, beforeHtml, afterHtml };
        }
        if (!beforeHtml) {
            beforeHtml = await this.resolveProposalSourceHtml(workspacePath, workspaceDb, proposal);
        }
        if (!afterHtml) {
            afterHtml = this.buildFallbackProposalHtml(proposal, relatedPbis, beforeHtml);
        }
        if (!beforeHtml && !afterHtml) {
            return { proposal, beforeHtml: '', afterHtml: '' };
        }
        const artifacts = await this.persistProposalArtifacts(workspacePath, proposal.id, {
            sourceHtml: beforeHtml,
            proposedHtml: afterHtml,
            metadata: normalizeProposalMetadata(proposal.metadata)
        });
        const nextSourceHtmlPath = artifacts.sourceHtmlPath ?? proposal.sourceHtmlPath ?? null;
        const nextProposedHtmlPath = artifacts.proposedHtmlPath ?? proposal.proposedHtmlPath ?? null;
        workspaceDb.run(`UPDATE proposals
       SET source_html_path = @sourceHtmlPath,
           proposed_html_path = @proposedHtmlPath,
           updated_at = @updatedAt
       WHERE id = @proposalId`, {
            proposalId: proposal.id,
            sourceHtmlPath: nextSourceHtmlPath,
            proposedHtmlPath: nextProposedHtmlPath,
            updatedAt: new Date().toISOString()
        });
        return {
            proposal: {
                ...proposal,
                targetTitle: proposal.targetTitle,
                sourceHtmlPath: nextSourceHtmlPath ?? undefined,
                proposedHtmlPath: nextProposedHtmlPath ?? undefined,
                updatedAtUtc: new Date().toISOString()
            },
            beforeHtml,
            afterHtml
        };
    }
    async resolveProposalSourceHtml(workspacePath, workspaceDb, proposal) {
        const revision = proposal.sourceRevisionId
            ? workspaceDb.get(`SELECT file_path as filePath
           FROM revisions
           WHERE id = @revisionId
           LIMIT 1`, { revisionId: proposal.sourceRevisionId }) ?? null
            : proposal.localeVariantId
                ? workspaceDb.get(`SELECT file_path as filePath
             FROM revisions
             WHERE locale_variant_id = @localeVariantId
               AND revision_type = 'live'
             ORDER BY revision_number DESC
             LIMIT 1`, { localeVariantId: proposal.localeVariantId }) ?? workspaceDb.get(`SELECT file_path as filePath
             FROM revisions
             WHERE locale_variant_id = @localeVariantId
             ORDER BY revision_number DESC
             LIMIT 1`, { localeVariantId: proposal.localeVariantId }) ?? null
                : null;
        if (!revision?.filePath) {
            return '';
        }
        return this.readRevisionSource(resolveRevisionPath(workspacePath, revision.filePath));
    }
    hydrateProposalDisplayFields(proposal, workspaceDb) {
        if (proposal.targetTitle && proposal.targetTitle.trim()) {
            return proposal;
        }
        let familyId = proposal.familyId;
        let targetLocale = proposal.targetLocale;
        let targetTitle = proposal.targetTitle;
        if (proposal.localeVariantId) {
            const localeVariant = workspaceDb.get(`SELECT lv.family_id as familyId,
                lv.locale as locale,
                af.title as familyTitle
         FROM locale_variants lv
         JOIN article_families af ON af.id = lv.family_id
         WHERE lv.id = @localeVariantId
         LIMIT 1`, { localeVariantId: proposal.localeVariantId });
            if (localeVariant) {
                familyId = familyId ?? localeVariant.familyId;
                targetLocale = targetLocale ?? localeVariant.locale;
                targetTitle = targetTitle ?? localeVariant.familyTitle;
            }
        }
        if (!targetTitle && familyId) {
            const family = workspaceDb.get(`SELECT title
         FROM article_families
         WHERE id = @familyId
         LIMIT 1`, { familyId });
            targetTitle = family?.title?.trim() || targetTitle;
        }
        if (!targetTitle) {
            targetTitle = inferProposalTitleFromText(proposal.action, proposal.rationaleSummary ?? proposal.aiNotes);
        }
        return {
            ...proposal,
            familyId,
            targetLocale,
            targetTitle: targetTitle || undefined
        };
    }
    async resolveProposalIdentity(workspaceDb, payload) {
        const localeVariantId = payload.localeVariantId?.trim() || undefined;
        let familyId = payload.familyId?.trim() || extractString(payload.metadata.familyId);
        let targetLocale = payload.targetLocale
            ?? extractString(payload.metadata.targetLocale)
            ?? extractString(payload.metadata.locale);
        let targetTitle = payload.targetTitle
            ?? extractString(payload.metadata.targetTitle)
            ?? extractString(payload.metadata.articleTitle)
            ?? extractString(payload.metadata.articleName)
            ?? extractString(payload.metadata.proposedTitle)
            ?? extractString(payload.metadata.title)
            ?? extractString(payload.metadata.name);
        if (localeVariantId) {
            const localeVariant = workspaceDb.get(`SELECT lv.family_id as familyId,
                lv.locale as locale,
                af.title as familyTitle
         FROM locale_variants lv
         JOIN article_families af ON af.id = lv.family_id
         WHERE lv.id = @localeVariantId
         LIMIT 1`, { localeVariantId });
            if (localeVariant) {
                familyId = familyId ?? localeVariant.familyId;
                targetLocale = targetLocale ?? localeVariant.locale;
                targetTitle = targetTitle ?? localeVariant.familyTitle;
            }
        }
        if (!targetTitle && familyId) {
            const family = workspaceDb.get(`SELECT title
         FROM article_families
         WHERE id = @familyId
         LIMIT 1`, { familyId });
            targetTitle = family?.title?.trim() || targetTitle;
        }
        targetTitle = targetTitle
            ?? inferProposalTitleFromText(payload.action, payload.note)
            ?? inferProposalTitleFromText(payload.action, payload.rationale);
        return {
            familyId: familyId || undefined,
            targetTitle: targetTitle || undefined,
            targetLocale: targetLocale || undefined
        };
    }
    findOpenMatchingProposal(workspaceDb, payload) {
        const normalizedTitle = payload.targetTitle?.trim().toLowerCase() ?? null;
        const normalizedLocale = payload.targetLocale?.trim().toLowerCase() ?? null;
        return workspaceDb.get(`
      SELECT id,
             queue_order as queueOrder
      FROM proposals
      WHERE workspace_id = @workspaceId
        AND batch_id = @batchId
        AND action = @action
        AND review_status IN ('staged_analysis', 'pending_review', 'deferred')
        AND (
          (@localeVariantId IS NOT NULL AND locale_variant_id = @localeVariantId)
          OR (@localeVariantId IS NULL AND @familyId IS NOT NULL AND family_id = @familyId)
          OR (
            @localeVariantId IS NULL
            AND @familyId IS NULL
            AND @normalizedTitle IS NOT NULL
            AND lower(coalesce(target_title, '')) = @normalizedTitle
            AND (
              @normalizedLocale IS NULL
              OR lower(coalesce(target_locale, '')) = @normalizedLocale
            )
          )
        )
      ORDER BY updated_at DESC, generated_at DESC
      LIMIT 1
    `, {
            workspaceId: payload.workspaceId,
            batchId: payload.batchId,
            action: payload.action,
            localeVariantId: payload.localeVariantId ?? null,
            familyId: payload.familyId ?? null,
            normalizedTitle,
            normalizedLocale
        }) ?? null;
    }
    findOpenProposalByIdempotencyKey(workspaceDb, payload) {
        const rows = workspaceDb.all(`
      SELECT id,
             queue_order as queueOrder,
             metadata_json as metadataJson
      FROM proposals
      WHERE workspace_id = @workspaceId
        AND batch_id = @batchId
        AND review_status IN ('staged_analysis', 'pending_review', 'deferred')
      ORDER BY updated_at DESC, generated_at DESC
      LIMIT 50
    `, {
            workspaceId: payload.workspaceId,
            batchId: payload.batchId
        });
        for (const row of rows) {
            if (!row.metadataJson) {
                continue;
            }
            try {
                const metadata = JSON.parse(row.metadataJson);
                if (extractString(metadata._agentCommandKey) === payload.idempotencyKey) {
                    return {
                        id: row.id,
                        queueOrder: row.queueOrder
                    };
                }
            }
            catch {
                // ignore malformed stored metadata
            }
        }
        return null;
    }
    getStoredProposalMetadata(workspaceDb, workspaceId, proposalId) {
        const row = workspaceDb.get(`SELECT metadata_json as metadataJson
         FROM proposals
        WHERE workspace_id = @workspaceId
          AND id = @proposalId
        LIMIT 1`, {
            workspaceId,
            proposalId
        });
        return safeParseJson(row?.metadataJson) ?? {};
    }
    buildFallbackProposalHtml(proposal, relatedPbis, sourceHtml) {
        const title = escapeHtml(proposal.targetTitle ?? deriveProposalArticleDescriptor(proposal).articleLabel);
        const action = escapeHtml(proposal.action.replace(/_/g, ' '));
        const rationale = escapeHtml(proposal.rationaleSummary ?? proposal.aiNotes ?? 'No proposal summary was provided.');
        const notes = proposal.aiNotes && proposal.aiNotes !== proposal.rationaleSummary
            ? `<p><strong>AI notes:</strong> ${escapeHtml(proposal.aiNotes)}</p>`
            : '';
        const pbiList = relatedPbis.length > 0
            ? `<ul>${relatedPbis
                .slice(0, 8)
                .map((pbi) => `<li>${escapeHtml(pbi.externalId ?? pbi.id)}: ${escapeHtml(pbi.title ?? 'Untitled PBI')}</li>`)
                .join('')}</ul>`
            : '<p>No linked PBIs were persisted for this proposal.</p>';
        const summaryBlock = [
            '<section data-kbv-fallback="proposal-summary" style="border:1px solid #d7dde5;border-radius:8px;padding:16px;margin-bottom:16px;background:#f8fafc;">',
            `<p style="margin:0 0 8px 0;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#51606f;">Fallback proposal preview</p>`,
            `<h1 style="margin:0 0 12px 0;font-size:24px;">${title}</h1>`,
            `<p><strong>Action:</strong> ${action}</p>`,
            `<p><strong>Summary:</strong> ${rationale}</p>`,
            notes,
            '<p><strong>Triggering PBIs</strong></p>',
            pbiList,
            '</section>'
        ].join('');
        if (proposal.action === shared_types_1.ProposalAction.EDIT && sourceHtml) {
            return `${summaryBlock}\n${sourceHtml}`;
        }
        if (proposal.action === shared_types_1.ProposalAction.RETIRE && sourceHtml) {
            return `${summaryBlock}\n${sourceHtml}`;
        }
        return summaryBlock;
    }
    async readProposalArtifact(workspacePath, artifactPath) {
        if (!artifactPath) {
            return '';
        }
        try {
            return await promises_1.default.readFile(resolveRevisionPath(workspacePath, artifactPath), 'utf8');
        }
        catch {
            return '';
        }
    }
    mapProposalRow(row) {
        return {
            id: row.id,
            workspaceId: row.workspaceId,
            batchId: row.batchId,
            sessionId: row.sessionId ?? undefined,
            action: row.action,
            reviewStatus: normalizeReviewStatus(row.reviewStatus),
            legacyStatus: row.status ?? undefined,
            familyId: row.familyId ?? undefined,
            localeVariantId: row.localeVariantId ?? undefined,
            sourceRevisionId: row.sourceRevisionId ?? undefined,
            branchId: row.branchId ?? undefined,
            targetTitle: row.targetTitle ?? undefined,
            targetLocale: row.targetLocale ?? undefined,
            confidenceScore: row.confidenceScore ?? undefined,
            rationaleSummary: row.rationaleSummary ?? row.rationale ?? undefined,
            aiNotes: row.aiNotes ?? undefined,
            suggestedPlacement: safeParseJson(row.suggestedPlacementJson) ?? undefined,
            sourceHtmlPath: row.sourceHtmlPath ?? undefined,
            proposedHtmlPath: row.proposedHtmlPath ?? undefined,
            metadata: safeParseJson(row.metadataJson) ?? undefined,
            queueOrder: row.queueOrder ?? 0,
            generatedAtUtc: row.generatedAtUtc,
            updatedAtUtc: row.updatedAtUtc,
            decidedAtUtc: row.decidedAtUtc ?? undefined
        };
    }
    getDraftBranchRow(workspaceDb, workspaceId, branchId) {
        const branch = workspaceDb.get(`SELECT id,
              workspace_id as workspaceId,
              locale_variant_id as localeVariantId,
              name,
              base_revision_id as baseRevisionId,
              state,
              head_revision_id as headRevisionId,
              autosave_enabled as autosaveEnabled,
              last_autosaved_at as lastAutosavedAtUtc,
              last_manual_saved_at as lastManualSavedAtUtc,
              change_summary as changeSummary,
              editor_state_json as editorStateJson,
              created_at as createdAtUtc,
              updated_at as updatedAtUtc,
              retired_at as retiredAtUtc
       FROM draft_branches
       WHERE id = @branchId AND workspace_id = @workspaceId
       LIMIT 1`, { branchId, workspaceId });
        if (!branch) {
            throw new Error('Draft branch not found');
        }
        return branch;
    }
    async buildDraftBranchSummary(workspacePath, workspaceDb, branch) {
        const variant = workspaceDb.get(`SELECT lv.family_id as familyId, lv.locale, af.title as familyTitle
       FROM locale_variants lv
       JOIN article_families af ON af.id = lv.family_id
       WHERE lv.id = @localeVariantId
       LIMIT 1`, { localeVariantId: branch.localeVariantId });
        if (!variant) {
            throw new Error('Locale variant not found');
        }
        const liveRevision = await this.getLatestRevisionForVariant(workspaceDb, branch.localeVariantId, shared_types_1.RevisionState.LIVE);
        const headRevision = await this.getDraftBranchHeadRevision(workspaceDb, branch);
        if (!headRevision) {
            throw new Error('Draft branch has no revision history');
        }
        const headHtml = await this.readRevisionSource(resolveRevisionPath(workspacePath, headRevision.filePath));
        const validationWarnings = await this.validateDraftBranchHtml(workspacePath, workspaceDb, branch, headHtml);
        return {
            id: branch.id,
            workspaceId: branch.workspaceId,
            familyId: variant.familyId,
            familyTitle: variant.familyTitle,
            localeVariantId: branch.localeVariantId,
            locale: variant.locale,
            name: branch.name,
            status: normalizeDraftBranchStatus(branch.state, Boolean(liveRevision && branch.baseRevisionId !== liveRevision.id)),
            legacyState: branch.state,
            baseRevisionId: branch.baseRevisionId,
            baseRevisionNumber: await this.getRevisionNumberById(workspaceDb, branch.baseRevisionId),
            headRevisionId: headRevision.id,
            headRevisionNumber: headRevision.revisionNumber,
            liveRevisionId: liveRevision?.id,
            liveRevisionNumber: liveRevision?.revisionNumber,
            createdAtUtc: branch.createdAtUtc,
            updatedAtUtc: branch.updatedAtUtc,
            lastAutosavedAtUtc: branch.lastAutosavedAtUtc ?? undefined,
            lastManualSaveAtUtc: branch.lastManualSavedAtUtc ?? undefined,
            changeSummary: branch.changeSummary ?? summarizeDraftChanges((0, diff_engine_1.diffHtml)(liveRevision ? await this.readRevisionSource(resolveRevisionPath(workspacePath, liveRevision.filePath)) : '', headHtml)),
            validationSummary: summarizeDraftValidationWarnings(validationWarnings)
        };
    }
    async buildDraftEditorPayload(workspacePath, workspaceDb, branch, summary) {
        const headRevision = await this.getDraftBranchHeadRevision(workspaceDb, branch);
        if (!headRevision) {
            throw new Error('Draft branch has no revision history');
        }
        const liveRevision = summary.liveRevisionId
            ? await this.getRevisionById(workspaceDb, summary.liveRevisionId)
            : null;
        const html = await this.readRevisionSource(resolveRevisionPath(workspacePath, headRevision.filePath));
        const liveHtml = liveRevision ? await this.readRevisionSource(resolveRevisionPath(workspacePath, liveRevision.filePath)) : '';
        const compareDiff = (0, diff_engine_1.diffHtml)(liveHtml, html);
        const validationWarnings = await this.validateDraftBranchHtml(workspacePath, workspaceDb, branch, html);
        const history = this.listDraftBranchHistory(workspaceDb, branch.id, headRevision.id);
        return {
            html,
            previewHtml: html,
            compare: {
                liveHtml,
                draftHtml: html,
                diff: mapDiffToProposalPayload(compareDiff)
            },
            validationWarnings,
            autosave: {
                enabled: branch.autosaveEnabled !== 0,
                status: 'saved',
                lastAutosavedAtUtc: branch.lastAutosavedAtUtc ?? undefined,
                lastManualSaveAtUtc: branch.lastManualSavedAtUtc ?? undefined,
                pendingChanges: false
            },
            history,
            capabilities: {
                preferredEditor: 'monaco',
                previewSync: true,
                compareAgainstLive: true,
                undoRedo: true
            },
            editorState: safeParseJson(branch.editorStateJson) ?? undefined
        };
    }
    mapTemplatePackSummary(row) {
        const analysis = safeParseJson(row.analysisJson);
        return {
            id: row.id,
            workspaceId: row.workspaceId,
            name: row.name,
            language: row.language,
            promptTemplate: row.promptTemplate,
            toneRules: row.toneRules,
            examples: row.examples,
            active: row.active,
            updatedAtUtc: row.updatedAtUtc,
            templateType: normalizeTemplatePackType(row.templateType),
            description: row.description ?? undefined,
            analysisSummary: analysis?.summary,
            analysis: analysis ?? undefined
        };
    }
    async ensureDefaultTemplatePacks(workspaceId, workspaceDb) {
        const count = workspaceDb.get(`SELECT COUNT(*) as total FROM template_packs WHERE workspace_id = @workspaceId`, { workspaceId })?.total ?? 0;
        if (count > 0) {
            return;
        }
        const now = new Date().toISOString();
        for (const template of buildDefaultTemplatePacks(workspaceId)) {
            workspaceDb.run(`INSERT INTO template_packs (
          id, workspace_id, name, language, prompt_template, tone_rules, examples, active, updated_at, template_type, description, analysis_json
        ) VALUES (
          @id, @workspaceId, @name, @language, @promptTemplate, @toneRules, @examples, @active, @updatedAt, @templateType, @description, NULL
        )`, {
                ...template,
                examples: template.examples ?? null,
                description: template.description ?? null,
                active: template.active ? 1 : 0,
                updatedAt: now
            });
        }
    }
    async resolveArticleAiTarget(workspacePath, workspaceDb, input) {
        if (!input.branchId && !input.localeVariantId) {
            throw new Error('Article AI session requires branchId or localeVariantId');
        }
        if (input.branchId) {
            const branch = this.getDraftBranchRow(workspaceDb, input.workspaceId, input.branchId);
            const summary = await this.buildDraftBranchSummary(workspacePath, workspaceDb, branch);
            const headRevision = await this.getDraftBranchHeadRevision(workspaceDb, branch);
            if (!headRevision) {
                throw new Error('Draft branch has no revision history');
            }
            return {
                workspaceId: input.workspaceId,
                localeVariantId: branch.localeVariantId,
                branchId: branch.id,
                targetType: 'draft_branch',
                familyId: summary.familyId,
                familyTitle: summary.familyTitle,
                locale: summary.locale,
                revisionId: headRevision.id,
                revisionNumber: headRevision.revisionNumber,
                currentHtml: await this.readRevisionSource(resolveRevisionPath(workspacePath, headRevision.filePath))
            };
        }
        const variant = await this.getLocaleVariant(input.workspaceId, input.localeVariantId);
        const familyRow = workspaceDb.get(`SELECT ${ARTICLE_FAMILY_SELECT_COLUMNS}
       FROM article_families
       WHERE id = @familyId`, { familyId: variant.familyId });
        const family = familyRow ? mapArticleFamilyRow(familyRow) : null;
        const revision = await this.getLatestRevision(input.workspaceId, input.localeVariantId, shared_types_1.RevisionState.LIVE)
            ?? await this.getLatestRevision(input.workspaceId, input.localeVariantId);
        if (!family || !revision) {
            throw new Error('Article not found');
        }
        return {
            workspaceId: input.workspaceId,
            localeVariantId: variant.id,
            targetType: 'live_article',
            familyId: family.id,
            familyTitle: family.title,
            locale: variant.locale,
            revisionId: revision.id,
            revisionNumber: revision.revisionNumber,
            currentHtml: await this.readRevisionSource(resolveRevisionPath(workspacePath, revision.filePath))
        };
    }
    async createArticleAiSessionRow(workspaceDb, target) {
        const now = new Date().toISOString();
        const id = (0, node_crypto_1.randomUUID)();
        workspaceDb.run(`INSERT INTO article_ai_sessions (
        id, workspace_id, locale_variant_id, branch_id, target_type, current_revision_id, current_html,
        pending_html, pending_summary, pending_rationale, pending_metadata_json, template_pack_id, runtime_session_id, status, created_at, updated_at
      ) VALUES (
        @id, @workspaceId, @localeVariantId, @branchId, @targetType, @currentRevisionId, @currentHtml,
        NULL, NULL, NULL, NULL, NULL, NULL, @status, @createdAt, @updatedAt
      )`, {
            id,
            workspaceId: target.workspaceId,
            localeVariantId: target.localeVariantId,
            branchId: target.branchId ?? null,
            targetType: target.targetType,
            currentRevisionId: target.revisionId,
            currentHtml: target.currentHtml,
            status: shared_types_1.ArticleAiSessionStatus.IDLE,
            createdAt: now,
            updatedAt: now
        });
        return this.requireArticleAiSession(workspaceDb, target.workspaceId, id);
    }
    requireArticleAiSession(workspaceDb, workspaceId, sessionId) {
        const session = workspaceDb.get(`SELECT id,
              workspace_id as workspaceId,
              locale_variant_id as localeVariantId,
              branch_id as branchId,
              target_type as targetType,
              current_revision_id as currentRevisionId,
              current_html as currentHtml,
              pending_html as pendingHtml,
              pending_summary as pendingSummary,
              pending_rationale as pendingRationale,
              pending_metadata_json as pendingMetadataJson,
              template_pack_id as templatePackId,
              runtime_session_id as runtimeSessionId,
              status,
              created_at as createdAtUtc,
              updated_at as updatedAtUtc
       FROM article_ai_sessions
       WHERE workspace_id = @workspaceId AND id = @sessionId`, { workspaceId, sessionId });
        if (!session) {
            throw new Error('Article AI session not found');
        }
        return session;
    }
    async insertArticleAiMessage(workspaceDb, row) {
        workspaceDb.run(`INSERT INTO article_ai_messages (
        id, session_id, workspace_id, role, message_kind, preset_action, content, metadata_json, created_at
      ) VALUES (
        @id, @sessionId, @workspaceId, @role, @messageKind, @presetAction, @content, @metadataJson, @createdAtUtc
      )`, {
            ...row,
            presetAction: row.presetAction ?? null,
            metadataJson: row.metadataJson ?? null
        });
    }
    async buildArticleAiSessionResponse(workspaceDb, target, sessionRow) {
        const messages = workspaceDb.all(`SELECT id,
              session_id as sessionId,
              workspace_id as workspaceId,
              role,
              message_kind as messageKind,
              preset_action as presetAction,
              content,
              metadata_json as metadataJson,
              created_at as createdAtUtc
       FROM article_ai_messages
       WHERE workspace_id = @workspaceId AND session_id = @sessionId
       ORDER BY created_at ASC`, {
            workspaceId: target.workspaceId,
            sessionId: sessionRow.id
        }).map((row) => ({
            id: row.id,
            sessionId: row.sessionId,
            role: row.role,
            kind: row.messageKind,
            content: row.content,
            presetAction: row.presetAction ? row.presetAction : undefined,
            metadata: safeParseJson(row.metadataJson) ?? undefined,
            createdAtUtc: row.createdAtUtc
        }));
        const pendingEdit = sessionRow.pendingHtml
            ? {
                basedOnRevisionId: sessionRow.currentRevisionId,
                currentHtml: sessionRow.currentHtml,
                proposedHtml: sessionRow.pendingHtml,
                previewHtml: sessionRow.pendingHtml,
                summary: sessionRow.pendingSummary ?? 'AI suggested update',
                rationale: sessionRow.pendingRationale ?? undefined,
                diff: mapDiffToProposalPayload((0, diff_engine_1.diffHtml)(sessionRow.currentHtml, sessionRow.pendingHtml)),
                updatedAtUtc: sessionRow.updatedAtUtc
            }
            : undefined;
        return {
            workspaceId: target.workspaceId,
            session: {
                id: sessionRow.id,
                workspaceId: target.workspaceId,
                localeVariantId: target.localeVariantId,
                branchId: sessionRow.branchId ?? undefined,
                targetType: sessionRow.targetType,
                familyId: target.familyId,
                familyTitle: target.familyTitle,
                locale: target.locale,
                currentRevisionId: sessionRow.currentRevisionId,
                currentRevisionNumber: target.revisionNumber,
                templatePackId: sessionRow.templatePackId ?? undefined,
                runtimeSessionId: sessionRow.runtimeSessionId ?? undefined,
                status: normalizeArticleAiSessionStatus(sessionRow.status),
                createdAtUtc: sessionRow.createdAtUtc,
                updatedAtUtc: sessionRow.updatedAtUtc
            },
            messages,
            pendingEdit,
            presets: [...ARTICLE_AI_PRESETS],
            templatePacks: (await this.listTemplatePackSummaries({ workspaceId: target.workspaceId, includeInactive: false })).templates
        };
    }
    async getDraftBranchHtml(workspacePath, workspaceDb, workspaceId, branchId) {
        const branch = this.getDraftBranchRow(workspaceDb, workspaceId, branchId);
        const headRevision = await this.getDraftBranchHeadRevision(workspaceDb, branch);
        if (!headRevision) {
            throw new Error('Draft branch has no revision history');
        }
        return this.readRevisionSource(resolveRevisionPath(workspacePath, headRevision.filePath));
    }
    async validateDraftBranchHtml(workspacePath, workspaceDb, branch, html) {
        const warnings = [];
        const variant = workspaceDb.get(`SELECT locale, family_id as familyId
       FROM locale_variants
       WHERE id = @localeVariantId
       LIMIT 1`, { localeVariantId: branch.localeVariantId });
        const family = variant
            ? workspaceDb.get(`SELECT section_id as sectionId, category_id as categoryId
           FROM article_families
           WHERE id = @familyId
           LIMIT 1`, { familyId: variant.familyId })
            : null;
        const enabledLocales = (await this.getWorkspaceSettings(branch.workspaceId)).enabledLocales;
        const unsupportedTags = ['script', 'iframe', 'style', 'object', 'embed'];
        for (const tag of unsupportedTags) {
            if (new RegExp(`<${tag}\\b`, 'i').test(html)) {
                warnings.push({
                    code: shared_types_1.DraftValidationCode.UNSUPPORTED_TAG,
                    severity: shared_types_1.DraftValidationSeverity.ERROR,
                    message: `Unsupported <${tag}> tag detected in draft HTML.`,
                    detail: tag
                });
            }
        }
        const placeholderMatches = [
            ...html.matchAll(/\{\{\s*([A-Za-z0-9._-]+)\s*\}\}/g),
            ...html.matchAll(/<image_placeholder\b[^>]*description="([^"]*)"[^>]*\/?>/gi)
        ];
        for (const match of placeholderMatches) {
            warnings.push({
                code: shared_types_1.DraftValidationCode.UNRESOLVED_PLACEHOLDER,
                severity: shared_types_1.DraftValidationSeverity.WARNING,
                message: 'Draft contains unresolved placeholder content.',
                detail: match[1] || match[0]
            });
        }
        const htmlIntegrityWarning = detectHtmlIntegrityWarning(html);
        if (htmlIntegrityWarning) {
            warnings.push(htmlIntegrityWarning);
        }
        if (!summaryPlacementExists(family) && !summaryHasLiveRevision(workspaceDb, branch.localeVariantId)) {
            warnings.push({
                code: shared_types_1.DraftValidationCode.MISSING_PLACEMENT,
                severity: shared_types_1.DraftValidationSeverity.WARNING,
                message: 'New draft target is missing category or section placement metadata.'
            });
        }
        if (variant?.locale && !enabledLocales.includes(variant.locale)) {
            warnings.push({
                code: shared_types_1.DraftValidationCode.LOCALE_ISSUE,
                severity: shared_types_1.DraftValidationSeverity.WARNING,
                message: `Locale ${variant.locale} is not currently enabled for this workspace.`,
                detail: variant.locale
            });
        }
        return warnings;
    }
    async getDraftBranchHeadRevision(workspaceDb, branch) {
        if (branch.headRevisionId) {
            const head = await this.getRevisionById(workspaceDb, branch.headRevisionId);
            if (head) {
                return head;
            }
        }
        return workspaceDb.get(`SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
              workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
              revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
       FROM revisions
       WHERE branch_id = @branchId
       ORDER BY revision_number DESC
       LIMIT 1`, { branchId: branch.id }) ?? null;
    }
    async getRevisionById(workspaceDb, revisionId) {
        return workspaceDb.get(`SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
              workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
              revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
       FROM revisions
       WHERE id = @revisionId
       LIMIT 1`, { revisionId }) ?? null;
    }
    async getRevisionNumberById(workspaceDb, revisionId) {
        const row = workspaceDb.get(`SELECT revision_number as revisionNumber
       FROM revisions
       WHERE id = @revisionId
       LIMIT 1`, { revisionId });
        return row?.revisionNumber;
    }
    listDraftBranchHistory(workspaceDb, branchId, headRevisionId) {
        const revisions = workspaceDb.all(`SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
              workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
              revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
       FROM revisions
       WHERE branch_id = @branchId
       ORDER BY revision_number DESC`, { branchId });
        const commits = workspaceDb.all(`SELECT revision_id as revisionId,
              branch_id as branchId,
              workspace_id as workspaceId,
              commit_kind as commitKind,
              commit_message as commitMessage,
              created_at as createdAtUtc
       FROM draft_revision_commits
       WHERE branch_id = @branchId
       ORDER BY created_at DESC`, { branchId });
        const commitByRevision = new Map(commits.map((commit) => [commit.revisionId, commit]));
        return revisions.map((revision) => {
            const commit = commitByRevision.get(revision.id);
            return {
                revisionId: revision.id,
                revisionNumber: revision.revisionNumber,
                sourceRevisionId: revision.sourceRevisionId,
                source: normalizeDraftCommitSource(commit?.commitKind),
                summary: commit?.commitMessage ?? undefined,
                createdAtUtc: revision.createdAtUtc,
                updatedAtUtc: revision.updatedAtUtc,
                isCurrent: revision.id === headRevisionId
            };
        });
    }
    recordDraftRevisionCommit(workspaceDb, payload) {
        workspaceDb.run(`INSERT OR REPLACE INTO draft_revision_commits (
        revision_id, branch_id, workspace_id, commit_kind, commit_message, created_at
      ) VALUES (
        @revisionId, @branchId, @workspaceId, @commitKind, @commitMessage, @createdAt
      )`, {
            revisionId: payload.revisionId,
            branchId: payload.branchId,
            workspaceId: payload.workspaceId,
            commitKind: payload.source,
            commitMessage: payload.message ?? null,
            createdAt: new Date().toISOString()
        });
    }
    recordArticleLineage(workspaceDb, localeVariantId, predecessorRevisionId, successorRevisionId, createdBy, createdAtUtc) {
        workspaceDb.run(`INSERT INTO article_lineage (
        id, locale_variant_id, predecessor_revision_id, successor_revision_id, created_by, created_at
      ) VALUES (
        @id, @localeVariantId, @predecessorRevisionId, @successorRevisionId, @createdBy, @createdAt
      )`, {
            id: (0, node_crypto_1.randomUUID)(),
            localeVariantId,
            predecessorRevisionId,
            successorRevisionId,
            createdBy,
            createdAt: createdAtUtc
        });
    }
    async stepDraftBranchHistory(workspaceId, branchId, offset) {
        const workspace = await this.getWorkspace(workspaceId);
        const workspaceDb = this.openWorkspaceDbWithRecovery(node_path_1.default.join(workspace.path, '.meta', DEFAULT_DB_FILE));
        try {
            const branch = this.getDraftBranchRow(workspaceDb, workspaceId, branchId);
            const revisions = workspaceDb.all(`SELECT id
         FROM revisions
         WHERE branch_id = @branchId
         ORDER BY revision_number ASC`, { branchId });
            const currentHeadId = (await this.getDraftBranchHeadRevision(workspaceDb, branch))?.id;
            const currentIndex = revisions.findIndex((revision) => revision.id === currentHeadId);
            const nextIndex = currentIndex + offset;
            if (currentIndex < 0 || nextIndex < 0 || nextIndex >= revisions.length) {
                return this.getDraftBranchEditor(workspaceId, branchId);
            }
            workspaceDb.run(`UPDATE draft_branches
         SET head_revision_id = @headRevisionId,
             updated_at = @updatedAt
         WHERE id = @branchId AND workspace_id = @workspaceId`, {
                branchId,
                workspaceId,
                headRevisionId: revisions[nextIndex].id,
                updatedAt: new Date().toISOString()
            });
            return this.getDraftBranchEditor(workspaceId, branchId);
        }
        finally {
            workspaceDb.close();
        }
    }
    async syncBatchReviewStatus(workspaceDb, workspaceId, batchId) {
        const rows = workspaceDb.all(`SELECT review_status as reviewStatus
       FROM proposals
       WHERE workspace_id = @workspaceId AND batch_id = @batchId`, { workspaceId, batchId });
        const normalized = rows
            .map((row) => normalizeReviewStatus(row.reviewStatus))
            .filter((status) => status !== shared_types_1.ProposalReviewStatus.STAGED_ANALYSIS);
        let nextStatus = shared_types_1.PBIBatchStatus.ANALYZED;
        if (normalized.length > 0) {
            nextStatus = normalized.some((status) => status === shared_types_1.ProposalReviewStatus.PENDING_REVIEW)
                ? shared_types_1.PBIBatchStatus.REVIEW_IN_PROGRESS
                : shared_types_1.PBIBatchStatus.REVIEW_COMPLETE;
        }
        workspaceDb.run(`UPDATE pbi_batches
       SET status = @status
       WHERE id = @batchId AND workspace_id = @workspaceId`, { status: nextStatus, batchId, workspaceId });
        return nextStatus;
    }
    promoteLatestHumanReviewWorkerProposals(workspaceDb, workspaceId, batchId) {
        const latestIteration = this.getLatestBatchAnalysisIterationFromDb(workspaceDb, workspaceId, batchId);
        if (!latestIteration || latestIteration.status !== 'needs_human_review') {
            return [];
        }
        const workerReport = this.getLatestBatchAnalysisWorkerReportForIterationFromDb(workspaceDb, latestIteration.id);
        if (!workerReport) {
            return [];
        }
        const proposalIds = Array.from(new Set(workerReport.executedItems.flatMap((item) => {
            if (item.status !== 'executed') {
                return [];
            }
            return [
                item.proposalId?.trim(),
                ...(item.artifactIds ?? []).map((artifactId) => artifactId.trim())
            ].filter((proposalId) => Boolean(proposalId));
        })));
        if (proposalIds.length === 0) {
            return [];
        }
        const updatedAt = new Date().toISOString();
        workspaceDb.run(`UPDATE proposals
       SET review_status = @nextStatus,
           updated_at = @updatedAt
       WHERE workspace_id = @workspaceId
         AND batch_id = @batchId
         AND review_status = @currentStatus
         AND id IN (${proposalIds.map((_, index) => `@proposalId${index}`).join(', ')})`, proposalIds.reduce((acc, proposalId, index) => {
            acc[`proposalId${index}`] = proposalId;
            return acc;
        }, {
            workspaceId,
            batchId,
            currentStatus: shared_types_1.ProposalReviewStatus.STAGED_ANALYSIS,
            nextStatus: shared_types_1.ProposalReviewStatus.PENDING_REVIEW,
            updatedAt
        }));
        return workspaceDb.all(`SELECT id
         FROM proposals
        WHERE workspace_id = @workspaceId
          AND batch_id = @batchId
          AND review_status = @reviewStatus
          AND id IN (${proposalIds.map((_, index) => `@proposalId${index}`).join(', ')})`, proposalIds.reduce((acc, proposalId, index) => {
            acc[`proposalId${index}`] = proposalId;
            return acc;
        }, {
            workspaceId,
            batchId,
            reviewStatus: shared_types_1.ProposalReviewStatus.PENDING_REVIEW
        })).map((row) => row.id);
    }
    async syncTerminalBatchAnalysisStatus(workspaceDb, workspaceId, batchId) {
        const batch = workspaceDb.get(`SELECT status
       FROM pbi_batches
       WHERE id = @batchId AND workspace_id = @workspaceId
       LIMIT 1`, { workspaceId, batchId });
        if (!batch) {
            return null;
        }
        if (batch.status === shared_types_1.PBIBatchStatus.IMPORTED
            || batch.status === shared_types_1.PBIBatchStatus.SCOPED
            || batch.status === shared_types_1.PBIBatchStatus.ARCHIVED) {
            return batch.status;
        }
        this.promoteLatestHumanReviewWorkerProposals(workspaceDb, workspaceId, batchId);
        return this.syncBatchReviewStatus(workspaceDb, workspaceId, batchId);
    }
}
exports.WorkspaceRepository = WorkspaceRepository;
function normalizeSearchScope(scope) {
    if (scope === 'live' || scope === 'drafts' || scope === 'retired' || scope === 'conflicted' || scope === 'all') {
        return scope;
    }
    return 'all';
}
function normalizeDraftBranchStatus(value, hasConflict = false) {
    switch (value) {
        case shared_types_1.DraftBranchStatus.READY_TO_PUBLISH:
        case shared_types_1.DraftBranchStatus.PUBLISHED:
        case shared_types_1.DraftBranchStatus.OBSOLETE:
        case shared_types_1.DraftBranchStatus.DISCARDED:
            return value;
        case shared_types_1.DraftBranchStatus.CONFLICTED:
            return shared_types_1.DraftBranchStatus.CONFLICTED;
        case shared_types_1.DraftBranchStatus.ACTIVE:
        case shared_types_1.RevisionState.DRAFT_BRANCH:
        default:
            return hasConflict ? shared_types_1.DraftBranchStatus.CONFLICTED : shared_types_1.DraftBranchStatus.ACTIVE;
    }
}
function normalizeDraftCommitSource(value) {
    switch (value) {
        case shared_types_1.DraftCommitSource.PROPOSAL:
        case shared_types_1.DraftCommitSource.MANUAL:
        case shared_types_1.DraftCommitSource.AUTOSAVE:
            return value;
        case shared_types_1.DraftCommitSource.SYSTEM:
        default:
            return shared_types_1.DraftCommitSource.SYSTEM;
    }
}
function normalizeArticleAiSessionStatus(value) {
    switch (value) {
        case shared_types_1.ArticleAiSessionStatus.RUNNING:
        case shared_types_1.ArticleAiSessionStatus.HAS_PENDING_EDIT:
            return value;
        case shared_types_1.ArticleAiSessionStatus.IDLE:
        default:
            return shared_types_1.ArticleAiSessionStatus.IDLE;
    }
}
function normalizeTemplatePackType(value) {
    switch (value) {
        case shared_types_1.TemplatePackType.FAQ:
        case shared_types_1.TemplatePackType.TROUBLESHOOTING:
        case shared_types_1.TemplatePackType.POLICY_NOTICE:
        case shared_types_1.TemplatePackType.FEATURE_OVERVIEW:
            return value;
        case shared_types_1.TemplatePackType.STANDARD_HOW_TO:
        default:
            return shared_types_1.TemplatePackType.STANDARD_HOW_TO;
    }
}
function summarizeDraftBranchStatuses(branches) {
    const summary = {
        total: branches.length,
        active: 0,
        readyToPublish: 0,
        conflicted: 0,
        obsolete: 0,
        discarded: 0
    };
    for (const branch of branches) {
        switch (branch.status) {
            case shared_types_1.DraftBranchStatus.READY_TO_PUBLISH:
                summary.readyToPublish += 1;
                break;
            case shared_types_1.DraftBranchStatus.CONFLICTED:
                summary.conflicted += 1;
                break;
            case shared_types_1.DraftBranchStatus.OBSOLETE:
                summary.obsolete += 1;
                break;
            case shared_types_1.DraftBranchStatus.DISCARDED:
                summary.discarded += 1;
                break;
            case shared_types_1.DraftBranchStatus.ACTIVE:
            case shared_types_1.DraftBranchStatus.PUBLISHED:
            default:
                summary.active += 1;
                break;
        }
    }
    return summary;
}
function summarizeDraftValidationWarnings(warnings) {
    const summary = {
        total: warnings.length,
        errors: 0,
        warnings: 0,
        infos: 0
    };
    for (const warning of warnings) {
        if (warning.severity === shared_types_1.DraftValidationSeverity.ERROR) {
            summary.errors += 1;
        }
        else if (warning.severity === shared_types_1.DraftValidationSeverity.WARNING) {
            summary.warnings += 1;
        }
        else {
            summary.infos += 1;
        }
    }
    return summary;
}
const ARTICLE_AI_PRESETS = [
    {
        action: shared_types_1.ArticleAiPresetAction.REWRITE_TONE,
        label: 'Rewrite for tone',
        description: 'Adjust voice and clarity without changing core meaning.'
    },
    {
        action: shared_types_1.ArticleAiPresetAction.SHORTEN,
        label: 'Shorten',
        description: 'Reduce length and tighten repetition.'
    },
    {
        action: shared_types_1.ArticleAiPresetAction.EXPAND,
        label: 'Expand',
        description: 'Add missing context, steps, or examples.'
    },
    {
        action: shared_types_1.ArticleAiPresetAction.RESTRUCTURE,
        label: 'Restructure',
        description: 'Reorganize sections for better flow.'
    },
    {
        action: shared_types_1.ArticleAiPresetAction.CONVERT_TO_TROUBLESHOOTING,
        label: 'Troubleshooting',
        description: 'Convert the content into a diagnosis-and-resolution format.'
    },
    {
        action: shared_types_1.ArticleAiPresetAction.ALIGN_TO_TEMPLATE,
        label: 'Align to template',
        description: 'Reshape the article to match a selected template pack.'
    },
    {
        action: shared_types_1.ArticleAiPresetAction.UPDATE_LOCALE,
        label: 'Update locale',
        description: 'Adapt language and locale expectations, including Spanish flows.'
    },
    {
        action: shared_types_1.ArticleAiPresetAction.INSERT_IMAGE_PLACEHOLDERS,
        label: 'Insert placeholders',
        description: 'Add image placeholder markers where screenshots would help.'
    }
];
function buildDefaultTemplatePacks(workspaceId) {
    return [
        {
            id: (0, node_crypto_1.randomUUID)(),
            workspaceId,
            name: 'Standard How-To',
            language: 'en-us',
            templateType: shared_types_1.TemplatePackType.STANDARD_HOW_TO,
            promptTemplate: 'Write a task-focused help article with a short introduction, prerequisites when needed, numbered steps, and a clear outcome.',
            toneRules: 'Use concise, direct instructions. Prefer active voice, plain language, and short paragraphs.',
            examples: '<h1>Update notification settings</h1><p>Use this article to change notification preferences.</p><ol><li>Open Settings.</li><li>Select Notifications.</li><li>Choose your preferences.</li></ol>',
            active: true,
            description: 'Default step-by-step article structure.'
        },
        {
            id: (0, node_crypto_1.randomUUID)(),
            workspaceId,
            name: 'FAQ',
            language: 'en-us',
            templateType: shared_types_1.TemplatePackType.FAQ,
            promptTemplate: 'Organize the article as common user questions with concise answers and only the context needed to resolve each question.',
            toneRules: 'Keep answers skimmable. Start with the direct answer, then add supporting detail.',
            active: true,
            description: 'Question-and-answer format for recurring support issues.'
        },
        {
            id: (0, node_crypto_1.randomUUID)(),
            workspaceId,
            name: 'Troubleshooting',
            language: 'en-us',
            templateType: shared_types_1.TemplatePackType.TROUBLESHOOTING,
            promptTemplate: 'Structure the article around symptoms, likely causes, and resolution steps. Call out prerequisites before risky actions.',
            toneRules: 'Lead with symptom recognition, then progress from least risky to most invasive fixes.',
            active: true,
            description: 'Diagnostic format for problem solving.'
        },
        {
            id: (0, node_crypto_1.randomUUID)(),
            workspaceId,
            name: 'Policy / Notice',
            language: 'en-us',
            templateType: shared_types_1.TemplatePackType.POLICY_NOTICE,
            promptTemplate: 'Write a factual policy or notice article with clear effective scope, impacted users, and any action required.',
            toneRules: 'Be precise and neutral. Avoid unnecessary marketing language.',
            active: true,
            description: 'For policy changes, deprecations, and operational notices.'
        },
        {
            id: (0, node_crypto_1.randomUUID)(),
            workspaceId,
            name: 'Feature Overview',
            language: 'en-us',
            templateType: shared_types_1.TemplatePackType.FEATURE_OVERVIEW,
            promptTemplate: 'Introduce the feature, who it is for, what it helps accomplish, and the primary workflows it unlocks.',
            toneRules: 'Use benefit-first framing without losing implementation accuracy.',
            active: true,
            description: 'High-level overview for new or changed features.'
        }
    ];
}
function buildTemplatePackAnalysis(template) {
    const suggestions = [];
    const strengths = [];
    const gaps = [];
    let score = 50;
    if (template.promptTemplate.trim().length >= 80) {
        strengths.push('Prompt template has enough structure to guide article generation.');
        score += 15;
    }
    else {
        gaps.push('Prompt template is brief and may not constrain structure strongly enough.');
        suggestions.push({
            title: 'Expand structural guidance',
            detail: 'Add required sections, ordering rules, and explicit output expectations.',
            priority: 'high'
        });
    }
    if (template.toneRules.trim().length >= 40) {
        strengths.push('Tone rules give the model concrete style guidance.');
        score += 15;
    }
    else {
        gaps.push('Tone guidance is sparse.');
        suggestions.push({
            title: 'Add tone rules',
            detail: 'Specify voice, reading level, and wording constraints for consistency.',
            priority: 'medium'
        });
    }
    if (template.examples?.trim()) {
        strengths.push('Examples are present to anchor formatting decisions.');
        score += 10;
    }
    else {
        gaps.push('No examples are attached.');
        suggestions.push({
            title: 'Provide a worked example',
            detail: 'Add one representative article excerpt so edits can better match expected output.',
            priority: 'medium'
        });
    }
    if (!/es|spanish/i.test(template.language) && template.language !== 'en-us') {
        suggestions.push({
            title: 'Review locale targeting',
            detail: 'Confirm the template includes locale-specific phrasing and formatting requirements.',
            priority: 'low'
        });
    }
    score = Math.max(0, Math.min(100, score));
    return {
        score,
        summary: score >= 75
            ? 'Strong template pack with clear generation guidance.'
            : score >= 60
                ? 'Usable template pack with a few guidance gaps.'
                : 'Template pack needs more structure before it will steer edits reliably.',
        strengths,
        gaps,
        suggestions,
        analyzedAtUtc: new Date().toISOString()
    };
}
function mapDiffToProposalPayload(diff) {
    return {
        beforeHtml: diff.beforeHtml,
        afterHtml: diff.afterHtml,
        sourceDiff: {
            lines: diff.sourceLines.map((line) => ({
                kind: line.kind,
                lineNumberBefore: line.beforeLineNumber,
                lineNumberAfter: line.afterLineNumber,
                content: line.content
            }))
        },
        renderedDiff: {
            blocks: diff.renderedBlocks.map((block) => ({
                kind: block.kind,
                beforeText: block.beforeText,
                afterText: block.afterText
            }))
        },
        changeRegions: diff.changeRegions.map((region) => ({
            id: region.id,
            kind: region.kind,
            label: region.label,
            beforeText: region.beforeText,
            afterText: region.afterText,
            beforeLineStart: region.beforeLineStart,
            beforeLineEnd: region.beforeLineEnd,
            afterLineStart: region.afterLineStart,
            afterLineEnd: region.afterLineEnd
        })),
        gutter: diff.gutter.map((item) => ({
            lineNumber: item.lineNumber,
            kind: item.kind,
            regionId: item.regionId,
            side: item.side
        }))
    };
}
function summarizeDraftChanges(diff) {
    const added = diff.changeRegions.filter((region) => region.kind === 'added').length;
    const removed = diff.changeRegions.filter((region) => region.kind === 'removed').length;
    const changed = diff.changeRegions.filter((region) => region.kind === 'changed').length;
    const parts = [
        changed > 0 ? `${changed} changed` : null,
        added > 0 ? `${added} added` : null,
        removed > 0 ? `${removed} removed` : null
    ].filter(Boolean);
    return parts.length > 0 ? `Live diff: ${parts.join(', ')} region${parts.length > 1 ? 's' : ''}` : 'No live diff detected.';
}
function detectHtmlIntegrityWarning(html) {
    const voidTags = new Set(['br', 'hr', 'img', 'meta', 'input', 'link', 'source']);
    const stack = [];
    const tagPattern = /<\/?([A-Za-z0-9:-]+)(?:\s[^>]*?)?>/g;
    let match = tagPattern.exec(html);
    while (match) {
        const raw = match[0];
        const tag = match[1].toLowerCase();
        if (voidTags.has(tag) || raw.endsWith('/>')) {
            match = tagPattern.exec(html);
            continue;
        }
        if (raw.startsWith('</')) {
            const open = stack.pop();
            if (open !== tag) {
                return {
                    code: shared_types_1.DraftValidationCode.INVALID_HTML,
                    severity: shared_types_1.DraftValidationSeverity.ERROR,
                    message: `HTML structure looks invalid near closing </${tag}>.`,
                    detail: tag
                };
            }
        }
        else {
            stack.push(tag);
        }
        match = tagPattern.exec(html);
    }
    if (stack.length > 0) {
        return {
            code: shared_types_1.DraftValidationCode.INVALID_HTML,
            severity: shared_types_1.DraftValidationSeverity.ERROR,
            message: `HTML structure looks invalid; unclosed <${stack[stack.length - 1]}> tag detected.`,
            detail: stack[stack.length - 1]
        };
    }
    return null;
}
function summaryPlacementExists(value) {
    return Boolean(value?.sectionId || value?.categoryId);
}
function summaryHasLiveRevision(workspaceDb, localeVariantId) {
    const row = workspaceDb.get(`SELECT COUNT(*) as total
     FROM revisions
     WHERE locale_variant_id = @localeVariantId
       AND revision_type = @revisionType`, { localeVariantId, revisionType: shared_types_1.RevisionState.LIVE });
    return (row?.total ?? 0) > 0;
}
function createContentHash(value) {
    return (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
}
function normalizeReviewStatus(value) {
    switch (value) {
        case shared_types_1.ProposalReviewStatus.STAGED_ANALYSIS:
        case shared_types_1.ProposalReviewStatus.ACCEPTED:
        case shared_types_1.ProposalReviewStatus.DENIED:
        case shared_types_1.ProposalReviewStatus.DEFERRED:
        case shared_types_1.ProposalReviewStatus.APPLIED_TO_BRANCH:
        case shared_types_1.ProposalReviewStatus.ARCHIVED:
        case shared_types_1.ProposalReviewStatus.PENDING_REVIEW:
            return value;
        default:
            return shared_types_1.ProposalReviewStatus.PENDING_REVIEW;
    }
}
function mapReviewDecisionToStatus(decision) {
    switch (decision) {
        case shared_types_1.ProposalReviewDecision.ACCEPT:
            return shared_types_1.ProposalReviewStatus.ACCEPTED;
        case shared_types_1.ProposalReviewDecision.DENY:
            return shared_types_1.ProposalReviewStatus.DENIED;
        case shared_types_1.ProposalReviewDecision.APPLY_TO_BRANCH:
            return shared_types_1.ProposalReviewStatus.APPLIED_TO_BRANCH;
        case shared_types_1.ProposalReviewDecision.ARCHIVE:
            return shared_types_1.ProposalReviewStatus.ARCHIVED;
        case shared_types_1.ProposalReviewDecision.DEFER:
        default:
            return shared_types_1.ProposalReviewStatus.DEFERRED;
    }
}
function mapReviewDecisionToLegacyStatus(decision) {
    switch (decision) {
        case shared_types_1.ProposalReviewDecision.ACCEPT:
            return shared_types_1.ProposalDecision.ACCEPT;
        case shared_types_1.ProposalReviewDecision.DENY:
            return shared_types_1.ProposalDecision.DENY;
        case shared_types_1.ProposalReviewDecision.APPLY_TO_BRANCH:
            return shared_types_1.ProposalDecision.APPLY_TO_BRANCH;
        case shared_types_1.ProposalReviewDecision.ARCHIVE:
            return shared_types_1.ProposalDecision.DEFER;
        case shared_types_1.ProposalReviewDecision.DEFER:
        default:
            return shared_types_1.ProposalDecision.DEFER;
    }
}
function summarizeProposalStatuses(records) {
    const summary = {
        total: records.length,
        pendingReview: 0,
        accepted: 0,
        denied: 0,
        deferred: 0,
        appliedToBranch: 0,
        archived: 0
    };
    for (const record of records) {
        switch (record.reviewStatus) {
            case shared_types_1.ProposalReviewStatus.STAGED_ANALYSIS:
                break;
            case shared_types_1.ProposalReviewStatus.ACCEPTED:
                summary.accepted += 1;
                break;
            case shared_types_1.ProposalReviewStatus.DENIED:
                summary.denied += 1;
                break;
            case shared_types_1.ProposalReviewStatus.DEFERRED:
                summary.deferred += 1;
                break;
            case shared_types_1.ProposalReviewStatus.APPLIED_TO_BRANCH:
                summary.appliedToBranch += 1;
                break;
            case shared_types_1.ProposalReviewStatus.ARCHIVED:
                summary.archived += 1;
                break;
            case shared_types_1.ProposalReviewStatus.PENDING_REVIEW:
            default:
                summary.pendingReview += 1;
                break;
        }
    }
    return summary;
}
function isProposalScopedExternalKey(value) {
    return (value?.trim().toLowerCase().startsWith(PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX) ?? false);
}
function deriveProposalArticleDescriptor(proposal) {
    const inferredLabel = proposal.targetTitle
        ?? inferProposalTitleFromText(proposal.action, proposal.rationaleSummary ?? proposal.aiNotes)
        ?? proposal.suggestedPlacement?.articleTitle
        ?? friendlyProposalLabel(proposal.action);
    if (proposal.localeVariantId) {
        return {
            articleKey: `locale:${proposal.localeVariantId}`,
            articleLabel: inferredLabel,
            locale: proposal.targetLocale
        };
    }
    if (proposal.familyId) {
        return {
            articleKey: `family:${proposal.familyId}:${proposal.targetLocale ?? 'default'}`,
            articleLabel: inferredLabel,
            locale: proposal.targetLocale
        };
    }
    return {
        articleKey: `new:${inferredLabel}:${proposal.targetLocale ?? 'default'}`,
        articleLabel: inferredLabel,
        locale: proposal.targetLocale
    };
}
function inferProposalTitleFromText(action, value) {
    const text = extractString(value);
    if (!text) {
        return undefined;
    }
    const prefixedPatterns = [
        /^(?:kb\s+)?(?:edit|update|revise)\s+(?:article\s+)?(.+?)(?::|\s+-\s+|\s+\(|$)/i,
        /^(?:kb\s+)?(?:create|new article|new kb article)\s+(?:article\s+)?(.+?)(?::|\s+-\s+|\s+\(|$)/i,
        /^(?:kb\s+)?(?:retire|remove|archive)\s+(?:article\s+)?(.+?)(?::|\s+-\s+|\s+\(|$)/i,
        /^(?:kb\s+)?(?:edit|update|revise)\s*:\s*(?:article\s+)?(.+?)(?::|\s+-\s+|\s+\(|$)/i,
        /^(?:kb\s+)?(?:create|new article|new kb article)\s*:\s*(?:article\s+)?(.+?)(?::|\s+-\s+|\s+\(|$)/i,
        /^(?:kb\s+)?(?:retire|remove|archive)\s*:\s*(?:article\s+)?(.+?)(?::|\s+-\s+|\s+\(|$)/i
    ];
    for (const pattern of prefixedPatterns) {
        const match = text.match(pattern);
        const candidate = match?.[1]?.trim();
        if (candidate) {
            return cleanProposalTitleCandidate(candidate);
        }
    }
    if (action === shared_types_1.ProposalAction.CREATE) {
        const quoted = text.match(/[“"']([^"”']{3,120})[”"']/);
        const candidate = quoted?.[1]?.trim();
        if (candidate) {
            return cleanProposalTitleCandidate(candidate);
        }
    }
    return undefined;
}
function cleanProposalTitleCandidate(value) {
    const cleaned = value
        .replace(/^[\s:;,.!-]+|[\s:;,.!-]+$/g, '')
        .replace(/\b(article|kb article|documentation)\b$/i, '')
        .trim();
    return cleaned || undefined;
}
function friendlyProposalLabel(action) {
    switch (action) {
        case shared_types_1.ProposalAction.CREATE:
            return 'New article proposal';
        case shared_types_1.ProposalAction.EDIT:
            return 'Article update proposal';
        case shared_types_1.ProposalAction.RETIRE:
            return 'Article retirement proposal';
        case shared_types_1.ProposalAction.NO_IMPACT:
        default:
            return 'No-impact proposal';
    }
}
function escapeHtml(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
function normalizeProposalMetadata(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value;
}
function normalizeProposalMetadataKbAccessMode(value) {
    return (0, shared_types_1.isKbAccessMode)(value) ? value : undefined;
}
function normalizeProposalOriginPath(value) {
    return typeof value === 'string' && value.trim()
        ? value.trim().toLowerCase()
        : undefined;
}
function mergePersistedProposalMetadata(existing, incoming, provenance) {
    const merged = {
        ...normalizeProposalMetadata(existing),
        ...normalizeProposalMetadata(incoming)
    };
    const runtimeSessionId = extractString(provenance?.runtimeSessionId)
        ?? extractString(merged.runtimeSessionId)
        ?? extractString(merged.sessionId)
        ?? extractString(merged.agentSessionId);
    const kbAccessMode = normalizeProposalMetadataKbAccessMode(provenance?.kbAccessMode
        ?? merged.kbAccessMode);
    const acpSessionId = extractString(provenance?.acpSessionId)
        ?? extractString(merged.acpSessionId);
    const originPath = normalizeProposalOriginPath(provenance?.originPath ?? merged.originPath);
    if (runtimeSessionId) {
        merged.runtimeSessionId = runtimeSessionId;
    }
    if (kbAccessMode) {
        merged.kbAccessMode = kbAccessMode;
    }
    if (acpSessionId) {
        merged.acpSessionId = acpSessionId;
    }
    if (originPath) {
        merged.originPath = originPath;
    }
    return merged;
}
function extractString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function normalizeConfidenceScore(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value > 1) {
            return Math.max(0, Math.min(1, value / 100));
        }
        return Math.max(0, Math.min(1, value));
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseFloat(value);
        if (!Number.isNaN(parsed)) {
            return normalizeConfidenceScore(parsed);
        }
    }
    return undefined;
}
function normalizePlacement(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const input = value;
    const placement = {
        categoryId: extractString(input.categoryId),
        sectionId: extractString(input.sectionId),
        articleTitle: extractString(input.articleTitle),
        parentArticleId: extractString(input.parentArticleId),
        notes: extractString(input.notes)
    };
    return Object.values(placement).some(Boolean) ? placement : undefined;
}
function safeParseJson(value) {
    if (!value) {
        return null;
    }
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function variantToDraftCount(map, localeVariantId) {
    return map.get(localeVariantId) ?? 0;
}
function normalizeSearchIdList(values) {
    return Array.from(new Set((values ?? [])
        .map((value) => value.trim())
        .filter(Boolean)));
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
function buildCorpusItemFromFamily(family, bodyHtml) {
    const titleTokens = tokenizeRelationText(`${family.title} ${family.externalKey}`).slice(0, 18);
    const contentTokens = tokenizeRelationText(stripHtml(bodyHtml)).slice(0, 36);
    return {
        familyId: family.id,
        title: family.title,
        externalKey: family.externalKey,
        sectionId: family.sectionId ?? undefined,
        categoryId: family.categoryId ?? undefined,
        titleTokens,
        contentTokens
    };
}
function buildInferredRelationCandidates(corpus, limitPerArticle) {
    // Legacy heuristic relation inference retained temporarily for deletion work.
    // Phase 3 cutover no longer routes production relation refresh through this path.
    const byId = new Map(corpus.map((item) => [item.familyId, item]));
    const tokenIndex = new Map();
    for (const item of corpus) {
        const uniqueTokens = new Set([...item.titleTokens, ...item.contentTokens.slice(0, 16)]);
        for (const token of uniqueTokens) {
            const bucket = tokenIndex.get(token) ?? [];
            bucket.push(item.familyId);
            tokenIndex.set(token, bucket);
        }
    }
    const scoresByPair = new Map();
    for (const item of corpus) {
        const candidateScores = new Map();
        for (const token of item.titleTokens) {
            const matches = tokenIndex.get(token) ?? [];
            if (matches.length < 2 || matches.length > 40) {
                continue;
            }
            for (const candidateId of matches) {
                if (candidateId === item.familyId) {
                    continue;
                }
                const current = candidateScores.get(candidateId) ?? { score: 0, titleOverlap: [], contentOverlap: [] };
                current.score += 1.35;
                if (!current.titleOverlap.includes(token)) {
                    current.titleOverlap.push(token);
                }
                candidateScores.set(candidateId, current);
            }
        }
        for (const token of item.contentTokens) {
            const matches = tokenIndex.get(token) ?? [];
            if (matches.length < 2 || matches.length > 24) {
                continue;
            }
            for (const candidateId of matches) {
                if (candidateId === item.familyId) {
                    continue;
                }
                const current = candidateScores.get(candidateId) ?? { score: 0, titleOverlap: [], contentOverlap: [] };
                current.score += 0.35;
                if (current.contentOverlap.length < 6 && !current.contentOverlap.includes(token)) {
                    current.contentOverlap.push(token);
                }
                candidateScores.set(candidateId, current);
            }
        }
        const ranked = Array.from(candidateScores.entries())
            .map(([candidateId, value]) => ({ candidateId, ...value }))
            .sort((left, right) => right.score - left.score)
            .slice(0, limitPerArticle);
        for (const candidate of ranked) {
            const other = byId.get(candidate.candidateId);
            if (!other) {
                continue;
            }
            const pair = normalizeFamilyPair(item.familyId, other.familyId);
            const key = `${pair.leftFamilyId}:${pair.rightFamilyId}`;
            const existing = scoresByPair.get(key) ?? {
                score: 0,
                titleOverlap: [],
                contentOverlap: [],
                sectionMatch: false,
                categoryMatch: false
            };
            existing.score = Math.max(existing.score, candidate.score);
            existing.titleOverlap = Array.from(new Set([...existing.titleOverlap, ...candidate.titleOverlap])).slice(0, 6);
            existing.contentOverlap = Array.from(new Set([...existing.contentOverlap, ...candidate.contentOverlap])).slice(0, 6);
            existing.sectionMatch = existing.sectionMatch || Boolean(item.sectionId && other.sectionId && item.sectionId === other.sectionId);
            existing.categoryMatch = existing.categoryMatch || Boolean(item.categoryId && other.categoryId && item.categoryId === other.categoryId);
            if (existing.sectionMatch) {
                existing.score += 0.75;
            }
            if (existing.categoryMatch) {
                existing.score += 0.3;
            }
            scoresByPair.set(key, existing);
        }
    }
    const relations = [];
    for (const [key, value] of scoresByPair.entries()) {
        if (value.score < 1.5) {
            continue;
        }
        const [leftFamilyId, rightFamilyId] = key.split(':');
        const evidence = [];
        if (value.titleOverlap.length > 0) {
            evidence.push({
                evidenceType: shared_types_1.ArticleRelationEvidenceType.TITLE_TOKEN,
                snippet: `Shared title tokens: ${value.titleOverlap.join(', ')}`,
                weight: Math.min(1, value.titleOverlap.length / 4)
            });
        }
        if (value.contentOverlap.length > 0) {
            evidence.push({
                evidenceType: shared_types_1.ArticleRelationEvidenceType.CONTENT_TOKEN,
                snippet: `Shared content terms: ${value.contentOverlap.join(', ')}`,
                weight: Math.min(0.9, value.contentOverlap.length / 8)
            });
        }
        if (value.sectionMatch) {
            evidence.push({
                evidenceType: shared_types_1.ArticleRelationEvidenceType.SECTION_MATCH,
                snippet: 'Articles are in the same section',
                weight: 0.85
            });
        }
        if (value.categoryMatch) {
            evidence.push({
                evidenceType: shared_types_1.ArticleRelationEvidenceType.CATEGORY_MATCH,
                snippet: 'Articles are in the same category',
                weight: 0.45
            });
        }
        relations.push({
            id: (0, node_crypto_1.randomUUID)(),
            leftFamilyId,
            rightFamilyId,
            relationType: value.sectionMatch ? shared_types_1.ArticleRelationType.SAME_WORKFLOW : shared_types_1.ArticleRelationType.SHARED_SURFACE,
            direction: shared_types_1.ArticleRelationDirection.BIDIRECTIONAL,
            strengthScore: Number(Math.min(1, value.score / 4.5).toFixed(3)),
            evidence
        });
    }
    relations.sort((left, right) => right.strengthScore - left.strengthScore);
    return {
        candidatePairs: scoresByPair.size,
        relations
    };
}
function tokenizeRelationText(input) {
    const normalized = input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
    if (!normalized) {
        return [];
    }
    const stopWords = new Set([
        'the', 'and', 'for', 'with', 'your', 'from', 'that', 'this', 'into', 'using', 'use',
        'how', 'what', 'when', 'where', 'why', 'are', 'can', 'not', 'all', 'you', 'our', 'but',
        'about', 'set', 'get', 'new', 'edit', 'article', 'articles', 'help', 'center'
    ]);
    return normalized
        .split(/\s+/)
        .filter((token) => token.length >= 3 && !stopWords.has(token));
}
const FEATURE_CLUSTER_MAX_PHRASE_LENGTH = 3;
const FEATURE_CLUSTER_GENERIC_STOPWORDS = new Set([
    'a',
    'add',
    'an',
    'and',
    'article',
    'basic',
    'center',
    'change',
    'configuration',
    'configure',
    'configuring',
    'create',
    'creating',
    'delete',
    'deleting',
    'disable',
    'edit',
    'editing',
    'enable',
    'faq',
    'faqs',
    'for',
    'from',
    'get',
    'getting',
    'guide',
    'guides',
    'help',
    'how',
    'intro',
    'introduction',
    'kb',
    'learn',
    'manage',
    'managing',
    'new',
    'of',
    'on',
    'overview',
    'remove',
    'reset',
    'set',
    'setup',
    'start',
    'started',
    'support',
    'the',
    'this',
    'to',
    'troubleshoot',
    'troubleshooting',
    'update',
    'updating',
    'use',
    'using',
    'view',
    'what',
    'when',
    'where',
    'why',
    'with',
    'your'
]);
function normalizeFamilyPair(sourceFamilyId, targetFamilyId) {
    return sourceFamilyId.localeCompare(targetFamilyId) <= 0
        ? { leftFamilyId: sourceFamilyId, rightFamilyId: targetFamilyId }
        : { leftFamilyId: targetFamilyId, rightFamilyId: sourceFamilyId };
}
function normalizeFeatureMapScopeId(value) {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}
function normalizeKbScopeType(value) {
    if (value === 'category' || value === 'section') {
        return value;
    }
    throw new Error(`Unsupported KB scope type: ${value}`);
}
function normalizeRequiredKbScopeId(value, fieldName) {
    const normalized = normalizeFeatureMapScopeId(value);
    if (!normalized) {
        throw new Error(`KB scope entry requires ${fieldName}`);
    }
    return normalized;
}
function normalizeRequiredKbScopeDisplayName(value) {
    const normalized = value?.trim();
    if (!normalized) {
        throw new Error('KB scope entry requires displayName');
    }
    return normalized;
}
function normalizeRequiredKbScopeSource(value) {
    const normalized = value?.trim();
    if (!normalized) {
        throw new Error('KB scope entry requires source');
    }
    return normalized;
}
function normalizeArticleTaxonomySource(value) {
    if (typeof value === 'string' && ARTICLE_TAXONOMY_SOURCE_VALUES.includes(value)) {
        return value;
    }
    return 'none';
}
function normalizeArticleTaxonomyConfidence(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}
function mapArticleFamilyRow(row) {
    return {
        id: row.id,
        workspaceId: row.workspaceId,
        externalKey: row.externalKey,
        title: row.title,
        sectionId: normalizeFeatureMapScopeId(row.sectionId),
        categoryId: normalizeFeatureMapScopeId(row.categoryId),
        sourceSectionId: normalizeFeatureMapScopeId(row.sourceSectionId),
        sourceCategoryId: normalizeFeatureMapScopeId(row.sourceCategoryId),
        sectionSource: normalizeArticleTaxonomySource(row.sectionSource),
        categorySource: normalizeArticleTaxonomySource(row.categorySource),
        taxonomyConfidence: normalizeArticleTaxonomyConfidence(row.taxonomyConfidence),
        taxonomyUpdatedAt: normalizeFeatureMapScopeId(row.taxonomyUpdatedAt),
        taxonomyNote: normalizeFeatureMapScopeId(row.taxonomyNote),
        retiredAtUtc: normalizeFeatureMapScopeId(row.retiredAtUtc)
    };
}
function buildFeatureMapBucketKey(scopeType, scopeId) {
    return `${scopeType}::${normalizeFeatureMapScopeId(scopeId) ?? '__none__'}`;
}
function extractFeatureMapBucketScopeId(bucketKey) {
    const [, rawScopeId = ''] = bucketKey.split('::');
    return rawScopeId === '__none__' ? undefined : rawScopeId;
}
function buildFallbackKbScopeDisplayName(scopeType, scopeId) {
    const normalizedScopeId = normalizeFeatureMapScopeId(scopeId);
    if (normalizedScopeId) {
        return `${normalizedScopeId} (fallback)`;
    }
    return scopeType === 'category' ? 'Uncategorized' : 'Unsectioned';
}
function deriveFeatureMapScopeName(scopeType, scopeId) {
    return buildFallbackKbScopeDisplayName(scopeType, scopeId);
}
function resolveFeatureMapScopeLabel(scopeLabelsByKey, scopeType, scopeId) {
    return scopeLabelsByKey.get(buildFeatureMapBucketKey(scopeType, scopeId)) ?? {
        scopeType,
        scopeId: normalizeFeatureMapScopeId(scopeId),
        displayName: deriveFeatureMapScopeName(scopeType, scopeId),
        labelSource: 'fallback',
        isHidden: false
    };
}
function doesFeatureMapFamilyMatchScope(family, scopeType, scopeId) {
    const familyScopeId = scopeType === 'section'
        ? normalizeFeatureMapScopeId(family.sectionId)
        : normalizeFeatureMapScopeId(family.categoryId);
    return familyScopeId === normalizeFeatureMapScopeId(scopeId);
}
function partitionFeatureMapRelationsByScope(relations, scopeFamilyIds) {
    const internalRelations = [];
    const bridgeRelations = [];
    for (const relation of relations) {
        const leftInside = scopeFamilyIds.has(relation.leftFamilyId);
        const rightInside = scopeFamilyIds.has(relation.rightFamilyId);
        if (leftInside && rightInside) {
            internalRelations.push(relation);
            continue;
        }
        if (leftInside || rightInside) {
            bridgeRelations.push(relation);
        }
    }
    return {
        internalRelations,
        bridgeRelations
    };
}
function buildFeatureMapScopeSummary(input) {
    const scopeFamilyIds = new Set(input.scopeFamilies.map((family) => family.familyId));
    const { internalRelations, bridgeRelations } = partitionFeatureMapRelationsByScope(input.relations, scopeFamilyIds);
    const visibleBridgeRelations = input.includeBridges ? bridgeRelations : [];
    const clusters = buildFeatureMapClusters({
        scopeFamilies: input.scopeFamilies,
        familiesById: input.familiesById,
        internalRelations: internalRelations.filter((relation) => relation.status === shared_types_1.ArticleRelationStatus.ACTIVE),
        bridgeRelations: visibleBridgeRelations
    });
    const visibleRelations = [...internalRelations, ...visibleBridgeRelations];
    return {
        articleCount: input.scopeFamilies.length,
        clusterCount: clusters.length,
        internalEdgeCount: internalRelations.length,
        bridgeEdgeCount: visibleBridgeRelations.length,
        staleDocumentCount: input.scopeFamilies.reduce((total, family) => total + (input.staleCountsByFamily.get(family.familyId) ?? 0), 0),
        manualEdgeCount: visibleRelations.filter((relation) => relation.origin === shared_types_1.ArticleRelationOrigin.MANUAL).length,
        inferredEdgeCount: visibleRelations.filter((relation) => relation.origin === shared_types_1.ArticleRelationOrigin.INFERRED).length
    };
}
function buildFeatureMapClusters(input) {
    if (input.scopeFamilies.length === 0) {
        return [];
    }
    const adjacency = new Map();
    for (const family of input.scopeFamilies) {
        adjacency.set(family.familyId, new Set());
    }
    for (const relation of input.internalRelations) {
        adjacency.get(relation.leftFamilyId)?.add(relation.rightFamilyId);
        adjacency.get(relation.rightFamilyId)?.add(relation.leftFamilyId);
    }
    const orderedFamilies = input.scopeFamilies
        .slice()
        .sort((left, right) => left.title.localeCompare(right.title));
    const visited = new Set();
    const clusters = [];
    for (const family of orderedFamilies) {
        if (visited.has(family.familyId)) {
            continue;
        }
        const stack = [family.familyId];
        const articleIds = [];
        visited.add(family.familyId);
        while (stack.length > 0) {
            const familyId = stack.pop();
            if (!familyId) {
                continue;
            }
            articleIds.push(familyId);
            const neighbors = adjacency.get(familyId) ?? new Set();
            for (const neighbor of neighbors) {
                if (visited.has(neighbor)) {
                    continue;
                }
                visited.add(neighbor);
                stack.push(neighbor);
            }
        }
        articleIds.sort((left, right) => {
            const leftTitle = input.familiesById.get(left)?.title ?? left;
            const rightTitle = input.familiesById.get(right)?.title ?? right;
            return leftTitle.localeCompare(rightTitle);
        });
        const articleIdSet = new Set(articleIds);
        const componentRelations = input.internalRelations.filter((relation) => (articleIdSet.has(relation.leftFamilyId)
            && articleIdSet.has(relation.rightFamilyId)));
        const degreeByFamilyId = new Map();
        for (const articleId of articleIds) {
            degreeByFamilyId.set(articleId, 0);
        }
        for (const relation of componentRelations) {
            degreeByFamilyId.set(relation.leftFamilyId, (degreeByFamilyId.get(relation.leftFamilyId) ?? 0) + 1);
            degreeByFamilyId.set(relation.rightFamilyId, (degreeByFamilyId.get(relation.rightFamilyId) ?? 0) + 1);
        }
        const representativeArticleIds = articleIds
            .slice()
            .sort((left, right) => ((degreeByFamilyId.get(right) ?? 0) - (degreeByFamilyId.get(left) ?? 0)
            || (input.familiesById.get(left)?.title ?? left).localeCompare(input.familiesById.get(right)?.title ?? right)))
            .slice(0, 3);
        const labelDetails = deriveFeatureClusterLabel({
            articleIds,
            representativeArticleIds,
            familiesById: input.familiesById
        });
        const bridgeEdgeCount = input.bridgeRelations.filter((relation) => (articleIdSet.has(relation.leftFamilyId) || articleIdSet.has(relation.rightFamilyId))).length;
        clusters.push({
            clusterId: `cluster-${(0, node_crypto_1.createHash)('sha1').update(articleIds.join(':')).digest('hex').slice(0, 12)}`,
            label: labelDetails.label,
            labelSource: labelDetails.labelSource,
            articleIds,
            articleCount: articleIds.length,
            internalEdgeCount: componentRelations.length,
            bridgeEdgeCount,
            representativeArticleIds
        });
    }
    return clusters.sort((left, right) => (right.articleCount - left.articleCount
        || right.internalEdgeCount - left.internalEdgeCount
        || left.label.localeCompare(right.label)));
}
function buildFeatureMapScopeArticles(input) {
    const statsByFamilyId = new Map();
    for (const family of input.scopeFamilies) {
        statsByFamilyId.set(family.familyId, {
            totalEdgeCount: 0,
            internalEdgeCount: 0,
            bridgeEdgeCount: 0
        });
    }
    for (const relation of input.internalRelations) {
        const left = statsByFamilyId.get(relation.leftFamilyId);
        const right = statsByFamilyId.get(relation.rightFamilyId);
        if (left) {
            left.totalEdgeCount += 1;
            left.internalEdgeCount += 1;
        }
        if (right) {
            right.totalEdgeCount += 1;
            right.internalEdgeCount += 1;
        }
    }
    for (const relation of input.bridgeRelations) {
        const left = statsByFamilyId.get(relation.leftFamilyId);
        const right = statsByFamilyId.get(relation.rightFamilyId);
        if (left && !right) {
            left.totalEdgeCount += 1;
            left.bridgeEdgeCount += 1;
        }
        else if (right && !left) {
            right.totalEdgeCount += 1;
            right.bridgeEdgeCount += 1;
        }
    }
    return input.scopeFamilies
        .map((family) => {
        const stats = statsByFamilyId.get(family.familyId);
        return {
            familyId: family.familyId,
            title: family.title,
            sectionId: family.sectionId ?? undefined,
            categoryId: family.categoryId ?? undefined,
            totalEdgeCount: stats?.totalEdgeCount ?? 0,
            internalEdgeCount: stats?.internalEdgeCount ?? 0,
            bridgeEdgeCount: stats?.bridgeEdgeCount ?? 0
        };
    })
        .sort((left, right) => (right.internalEdgeCount - left.internalEdgeCount
        || right.bridgeEdgeCount - left.bridgeEdgeCount
        || right.totalEdgeCount - left.totalEdgeCount
        || left.title.localeCompare(right.title)));
}
function buildFeatureMapBridges(input) {
    const bridges = new Map();
    for (const relation of input.bridgeRelations) {
        const leftClusterId = input.clusterByFamilyId.get(relation.leftFamilyId);
        const rightClusterId = input.clusterByFamilyId.get(relation.rightFamilyId);
        if (!leftClusterId && !rightClusterId) {
            continue;
        }
        const outsideFamilyId = leftClusterId ? relation.rightFamilyId : relation.leftFamilyId;
        const sourceClusterId = leftClusterId ?? rightClusterId;
        const outsideFamily = input.familiesById.get(outsideFamilyId);
        const targetScope = resolveFeatureMapBridgeTargetScope(input.scopeType, outsideFamily, input.scopeLabelsByKey);
        const sourceClusterLabel = input.clusterLabelsById.get(sourceClusterId) ?? 'This cluster';
        const bridgeKey = [
            sourceClusterId,
            targetScope.targetScopeType,
            targetScope.targetScopeId ?? '__none__',
            targetScope.targetScopeName
        ].join('::');
        const aggregate = bridges.get(bridgeKey) ?? {
            sourceClusterId,
            sourceClusterLabel,
            targetScopeType: targetScope.targetScopeType,
            targetScopeId: targetScope.targetScopeId,
            targetScopeName: targetScope.targetScopeName,
            targetScopeLabel: targetScope.targetScopeLabel,
            summary: buildFeatureMapBridgeSummary(sourceClusterLabel, targetScope.targetScopeName),
            edgeCount: 0,
            maxStrengthScore: 0,
            examples: new Map()
        };
        aggregate.edgeCount += 1;
        aggregate.maxStrengthScore = Math.max(aggregate.maxStrengthScore, relation.strengthScore);
        aggregate.examples.set(relation.id, {
            leftFamilyId: relation.leftFamilyId,
            leftTitle: input.familiesById.get(relation.leftFamilyId)?.title,
            rightFamilyId: relation.rightFamilyId,
            rightTitle: input.familiesById.get(relation.rightFamilyId)?.title,
            relationType: relation.relationType,
            strengthScore: relation.strengthScore
        });
        bridges.set(bridgeKey, aggregate);
    }
    return Array.from(bridges.values())
        .map((bridge) => ({
        sourceClusterId: bridge.sourceClusterId,
        sourceClusterLabel: bridge.sourceClusterLabel,
        targetScopeType: bridge.targetScopeType,
        targetScopeId: bridge.targetScopeId,
        targetScopeName: bridge.targetScopeName,
        targetScopeLabel: bridge.targetScopeLabel,
        summary: bridge.summary,
        edgeCount: bridge.edgeCount,
        maxStrengthScore: bridge.maxStrengthScore,
        examples: Array.from(bridge.examples.values())
            .sort((left, right) => (right.strengthScore - left.strengthScore
            || (left.leftTitle ?? left.leftFamilyId).localeCompare(right.leftTitle ?? right.leftFamilyId)
            || (left.rightTitle ?? left.rightFamilyId).localeCompare(right.rightTitle ?? right.rightFamilyId)))
            .slice(0, 3)
    }))
        .sort((left, right) => (right.edgeCount - left.edgeCount
        || right.maxStrengthScore - left.maxStrengthScore
        || left.targetScopeName.localeCompare(right.targetScopeName)));
}
function deriveFeatureClusterLabel(input) {
    const representativeLabel = input.familiesById.get(input.representativeArticleIds[0] ?? input.articleIds[0])?.title
        ?? input.familiesById.get(input.articleIds[0])?.title
        ?? 'Cluster';
    if (input.articleIds.length < 2) {
        return {
            label: representativeLabel,
            labelSource: 'representative_article'
        };
    }
    const derivedLabel = deriveFeatureClusterKeywordLabel(input.articleIds
        .map((articleId) => input.familiesById.get(articleId)?.title?.trim())
        .filter((title) => Boolean(title)));
    if (derivedLabel) {
        return {
            label: derivedLabel,
            labelSource: 'derived_keywords'
        };
    }
    return {
        label: representativeLabel,
        labelSource: 'representative_article'
    };
}
function deriveFeatureClusterKeywordLabel(titles) {
    const candidates = collectFeatureClusterPhraseCandidates(titles).filter((candidate) => candidate.docFreq >= 2);
    if (candidates.length === 0) {
        return null;
    }
    const maxDocFreq = Math.max(...candidates.map((candidate) => candidate.docFreq));
    const preferredMultiWordCandidates = candidates.filter((candidate) => (candidate.tokenCount > 1
        && candidate.docFreq >= Math.max(2, maxDocFreq - 1)));
    const candidatePool = preferredMultiWordCandidates.length > 0
        ? preferredMultiWordCandidates
        : candidates;
    candidatePool.sort(compareFeatureClusterPhraseCandidates);
    return selectFeatureClusterPhraseDisplay(candidatePool[0]);
}
function collectFeatureClusterPhraseCandidates(titles) {
    const candidates = new Map();
    titles.forEach((title) => {
        const tokens = extractFeatureClusterTitleTokens(title);
        if (tokens.length === 0) {
            return;
        }
        const seenInTitle = new Set();
        for (let tokenCount = 1; tokenCount <= Math.min(FEATURE_CLUSTER_MAX_PHRASE_LENGTH, tokens.length); tokenCount += 1) {
            for (let start = 0; start + tokenCount <= tokens.length; start += 1) {
                const phraseTokens = tokens.slice(start, start + tokenCount);
                const key = phraseTokens.map((token) => token.normalized).join(' ');
                const surface = phraseTokens.map((token) => token.surface).join(' ');
                const candidate = candidates.get(key) ?? {
                    key,
                    tokenCount,
                    docFreq: 0,
                    totalOccurrences: 0,
                    surfaces: new Map()
                };
                candidate.totalOccurrences += 1;
                candidate.surfaces.set(surface, (candidate.surfaces.get(surface) ?? 0) + 1);
                if (!seenInTitle.has(key)) {
                    candidate.docFreq += 1;
                    seenInTitle.add(key);
                }
                candidates.set(key, candidate);
            }
        }
    });
    return Array.from(candidates.values());
}
function compareFeatureClusterPhraseCandidates(left, right) {
    return right.docFreq - left.docFreq
        || right.tokenCount - left.tokenCount
        || right.totalOccurrences - left.totalOccurrences
        || right.key.length - left.key.length
        || left.key.localeCompare(right.key);
}
function extractFeatureClusterTitleTokens(title) {
    const rawTokens = title.match(/[A-Za-z0-9]+/g) ?? [];
    return rawTokens
        .map((surface) => ({
        normalized: normalizeFeatureClusterToken(surface),
        surface
    }))
        .filter((token) => isFeatureClusterKeywordToken(token.normalized));
}
function normalizeFeatureClusterToken(rawToken) {
    let normalized = rawToken.trim().toLowerCase();
    if (!normalized || /^\d+$/.test(normalized)) {
        return '';
    }
    if (normalized.length >= 5 && normalized.endsWith('ies')) {
        normalized = `${normalized.slice(0, -3)}y`;
    }
    else if (normalized.length >= 4
        && normalized.endsWith('s')
        && !normalized.endsWith('ss')
        && !normalized.endsWith('us')) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}
function isFeatureClusterKeywordToken(token) {
    return token.length >= 2
        && /[a-z]/.test(token)
        && !FEATURE_CLUSTER_GENERIC_STOPWORDS.has(token);
}
function selectFeatureClusterPhraseDisplay(candidate) {
    if (!candidate) {
        return null;
    }
    const preferredSurface = Array.from(candidate.surfaces.entries())
        .sort((left, right) => (right[1] - left[1]
        || left[0].length - right[0].length
        || left[0].localeCompare(right[0])))[0]?.[0]
        ?.trim();
    if (preferredSurface) {
        return preferredSurface;
    }
    return candidate.key
        .split(' ')
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ');
}
function buildFeatureMapBridgeSummary(sourceClusterLabel, targetScopeName) {
    return `${sourceClusterLabel} connects to ${targetScopeName}`;
}
function resolveFeatureMapBridgeTargetScope(scopeType, outsideFamily, scopeLabelsByKey) {
    if (scopeType === 'section') {
        const sectionId = normalizeFeatureMapScopeId(outsideFamily?.sectionId);
        if (sectionId) {
            const targetScopeLabel = resolveFeatureMapScopeLabel(scopeLabelsByKey, 'section', sectionId);
            return {
                targetScopeType: 'section',
                targetScopeId: sectionId,
                targetScopeName: targetScopeLabel.displayName,
                targetScopeLabel
            };
        }
        const categoryId = normalizeFeatureMapScopeId(outsideFamily?.categoryId);
        const targetScopeLabel = resolveFeatureMapScopeLabel(scopeLabelsByKey, 'category', categoryId);
        return {
            targetScopeType: 'category',
            targetScopeId: categoryId,
            targetScopeName: targetScopeLabel.displayName,
            targetScopeLabel
        };
    }
    const categoryId = normalizeFeatureMapScopeId(outsideFamily?.categoryId);
    if (categoryId) {
        const targetScopeLabel = resolveFeatureMapScopeLabel(scopeLabelsByKey, 'category', categoryId);
        return {
            targetScopeType: 'category',
            targetScopeId: categoryId,
            targetScopeName: targetScopeLabel.displayName,
            targetScopeLabel
        };
    }
    const sectionId = normalizeFeatureMapScopeId(outsideFamily?.sectionId);
    const targetScopeLabel = resolveFeatureMapScopeLabel(scopeLabelsByKey, 'section', sectionId);
    return {
        targetScopeType: 'section',
        targetScopeId: sectionId,
        targetScopeName: targetScopeLabel.displayName,
        targetScopeLabel
    };
}
function collectFeatureMapNeighborhoodFamilyIds(centerFamilyId, relations, hopCount) {
    const adjacency = new Map();
    for (const relation of relations) {
        const leftNeighbors = adjacency.get(relation.leftFamilyId) ?? new Set();
        leftNeighbors.add(relation.rightFamilyId);
        adjacency.set(relation.leftFamilyId, leftNeighbors);
        const rightNeighbors = adjacency.get(relation.rightFamilyId) ?? new Set();
        rightNeighbors.add(relation.leftFamilyId);
        adjacency.set(relation.rightFamilyId, rightNeighbors);
    }
    const visited = new Set([centerFamilyId]);
    const queue = [{ familyId: centerFamilyId, depth: 0 }];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || current.depth >= hopCount) {
            continue;
        }
        for (const neighbor of adjacency.get(current.familyId) ?? new Set()) {
            if (visited.has(neighbor)) {
                continue;
            }
            visited.add(neighbor);
            queue.push({
                familyId: neighbor,
                depth: current.depth + 1
            });
        }
    }
    return visited;
}
function normalizeRelationRunStatus(value) {
    if (value === 'running' || value === 'complete' || value === 'failed' || value === 'canceled') {
        return value;
    }
    return undefined;
}
function normalizeRelationRunSource(value) {
    if (value === 'post_sync' || value === 'post_import') {
        return value;
    }
    return 'manual_refresh';
}
function clampRelationLimit(value) {
    if (!Number.isFinite(value)) {
        return 24;
    }
    return Math.max(1, Math.min(100, Math.floor(value)));
}
function clampGraphLimit(value) {
    if (!Number.isFinite(value)) {
        return 36;
    }
    return Math.max(8, Math.min(120, Math.floor(value ?? 36)));
}
function limitArticleRelationGraphEdges(relations, limitNodes, seedFamilyId) {
    const selected = [];
    const nodeIds = new Set(seedFamilyId ? [seedFamilyId] : []);
    for (const relation of relations) {
        const nextNodeIds = new Set(nodeIds);
        nextNodeIds.add(relation.sourceFamily.id);
        nextNodeIds.add(relation.targetFamily.id);
        if (selected.length > 0 && nextNodeIds.size > limitNodes) {
            continue;
        }
        selected.push(relation);
        nextNodeIds.forEach((nodeId) => nodeIds.add(nodeId));
        if (nodeIds.size >= limitNodes) {
            break;
        }
    }
    return selected;
}
function shouldReevaluateFromRelationFeedback(feedbackType) {
    return feedbackType === shared_types_1.ArticleRelationFeedbackType.ADD
        || feedbackType === shared_types_1.ArticleRelationFeedbackType.REMOVE
        || feedbackType === shared_types_1.ArticleRelationFeedbackType.MISSED
        || feedbackType === shared_types_1.ArticleRelationFeedbackType.BAD_SUGGESTION;
}
function normalizeRelationCoverageLocaleKeys(locales) {
    const normalized = (locales ?? [])
        .map((locale) => locale.trim().toLowerCase())
        .filter(Boolean);
    return Array.from(new Set(normalized));
}
function buildRelationCoverageInClause(prefix, values, params) {
    return values.map((value, index) => {
        const key = `${prefix}${index}`;
        params[key] = value;
        return `@${key}`;
    }).join(', ');
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
    return (0, shared_types_1.isKbAccessMode)(value);
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
