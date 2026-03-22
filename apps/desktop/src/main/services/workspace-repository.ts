import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspect } from 'node:util';
import { safeStorage } from 'electron';
import {
  PBIBatchStatus,
  PBIBatchScopeMode,
  ProposalAction,
  ProposalDecision,
  type WorkspaceCreateRequest,
  type WorkspaceSettingsRecord,
  type WorkspaceSettingsUpdateRequest,
  type WorkspaceListItem,
  type WorkspaceRecord,
  WorkspaceState,
  type RepositoryStructurePayload,
  RevisionState,
  PBIValidationStatus,
  PBIImportFormat,
  type SearchPayload,
  type SearchResponse,
  type SearchResult,
  type RevisionHistoryResponse,
  type ArticleDetailRequest,
  type ArticleDetailResponse,
  type PBIRecord,
  type PBIBatchRecord,
  type TemplatePackRecord,
  type LineageRecord,
  type PlaceholderToken,
  type WorkspaceRoutePayload,
  type ArticleFamilyRecord,
  type LocaleVariantRecord,
  type RevisionRecord,
  type ArticleFamilyCreateRequest,
  type ArticleFamilyUpdateRequest,
  type LocaleVariantCreateRequest,
  type LocaleVariantUpdateRequest,
  type RevisionCreateRequest,
  type RevisionUpdateRequest,
  type ExplorerNode,
  type ZendeskCredentialRecord,
  type ZendeskSyncCheckpoint
} from '@kb-vault/shared-types';
import {
  applyWorkspaceMigrations,
  ensureCatalogSchema,
  getCatalogMigrationVersion,
  getWorkspaceMigrationVersion,
  openWorkspaceDatabase,
  type CatalogWorkspaceRow
} from '@kb-vault/db';
import { logger } from './logger';

const DEFAULT_DB_FILE = 'kb-vault.sqlite';
const CATALOG_DB_PATH = path.join('.meta', 'catalog.sqlite');
const PBIBATCH_STATUS_SEQUENCE: Array<PBIBatchStatus> = [
  PBIBatchStatus.IMPORTED,
  PBIBatchStatus.SCOPED,
  PBIBatchStatus.SUBMITTED,
  PBIBatchStatus.ANALYZED,
  PBIBatchStatus.REVIEW_IN_PROGRESS,
  PBIBatchStatus.REVIEW_COMPLETE,
  PBIBatchStatus.ARCHIVED
];

interface RevisionLatestRecord {
  revisionId: string;
  localeVariantId: string;
  revisionNumber: number;
  revisionType: RevisionState;
  filePath: string;
  updatedAtUtc: string;
}

interface ExplorerFamilyRow extends ArticleFamilyRecord {
  retired_at?: string;
}

interface SearchContext {
  scope: 'all' | 'live' | 'drafts' | 'retired' | 'conflicted';
  includeArchived: boolean;
}

interface SearchSourceMatch {
  context: 'title' | 'body' | 'metadata';
  snippet: string;
  scoreBoost: number;
}

export interface WorkspaceMigrationHealth {
  workspaceId: string;
  workspacePath: string;
  catalogVersion: number;
  workspaceDbPath: string;
  workspaceDbVersion: number;
  repaired: boolean;
  exists: boolean;
}

export interface WorkspaceMigrationHealthReport {
  catalogVersion: number;
  workspaceId: string | null;
  workspaces: WorkspaceMigrationHealth[];
}

export class WorkspaceRepository {
  private readonly catalogDbPath: string;
  private lastCatalogFailureMs = 0;
  private lastCatalogFailureMessage: string | undefined;

  constructor(private readonly workspaceRoot: string) {
    this.catalogDbPath = path.join(this.workspaceRoot, CATALOG_DB_PATH);
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    const catalog = await this.openCatalogWithRecovery();
    try {
      const rows = catalog.all<CatalogWorkspaceRow>(`
        SELECT id, name, path, created_at, updated_at, last_opened_at, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, state, is_default
        FROM workspaces
        ORDER BY name COLLATE NOCASE
      `);
      return rows.map(mapWorkspaceRow);
    } finally {
      catalog.close();
    }
  }

  async getWorkspace(id: string): Promise<WorkspaceRecord> {
    const catalog = await this.openCatalogWithRecovery();
    try {
      const row = catalog.get<CatalogWorkspaceRow>(`SELECT * FROM workspaces WHERE id = @id`, { id });
      if (!row) {
        throw new Error('Workspace not found');
      }
      return mapWorkspaceRow(row);
    } finally {
      catalog.close();
    }
  }

  async getWorkspaceSettings(id: string): Promise<WorkspaceSettingsRecord> {
    const catalog = await this.openCatalogWithRecovery();
    try {
      const row = catalog.get<CatalogWorkspaceRow>(
        `SELECT * FROM workspaces WHERE id = @id`,
        { id }
      );
      if (!row) {
        throw new Error('Workspace not found');
      }

      const workspace = await this.getWorkspace(id);
      await this.ensureWorkspaceDb(workspace.path);
      const workspaceDbPath = path.join(workspace.path, '.meta', DEFAULT_DB_FILE);
      const workspaceDb = this.openWorkspaceDbWithRecovery(workspaceDbPath);
      try {
        const settings = workspaceDb.get<{
          workspace_id: string;
          zendesk_subdomain: string;
          zendesk_brand_id: string | null;
          default_locale: string;
          enabled_locales: string;
        }>(
          `SELECT workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales
           FROM workspace_settings WHERE workspace_id = @workspaceId`,
          { workspaceId: id }
        );

        if (settings) {
          return {
            workspaceId: settings.workspace_id,
            zendeskSubdomain: settings.zendesk_subdomain,
            zendeskBrandId: settings.zendesk_brand_id ?? undefined,
            defaultLocale: settings.default_locale,
            enabledLocales: safeParseLocales(settings.enabled_locales)
          };
        }

        const enabledLocales = safeParseLocales(row.enabled_locales);
        workspaceDb.run(
          `INSERT INTO workspace_settings (
            workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, updated_at
          ) VALUES (
            @workspaceId, @zendeskSubdomain, @zendeskBrandId, @defaultLocale, @enabledLocales, @updatedAt
          )`,
          {
            workspaceId: id,
            zendeskSubdomain: row.zendesk_subdomain,
            zendeskBrandId: row.zendesk_brand_id,
            defaultLocale: row.default_locale,
            enabledLocales: JSON.stringify(enabledLocales),
            updatedAt: new Date().toISOString()
          }
        );

        return {
          workspaceId: id,
          zendeskSubdomain: row.zendesk_subdomain,
          zendeskBrandId: row.zendesk_brand_id ?? undefined,
          defaultLocale: row.default_locale,
          enabledLocales
        };
      } finally {
        workspaceDb.close();
      }
    } finally {
      catalog.close();
    }
  }

  async updateWorkspaceSettings(payload: WorkspaceSettingsUpdateRequest): Promise<WorkspaceSettingsRecord> {
    const catalog = await this.openCatalogWithRecovery();
    try {
      const row = catalog.get<CatalogWorkspaceRow>(
        `SELECT * FROM workspaces WHERE id = @id`,
        { id: payload.workspaceId }
      );
      if (!row) {
        throw new Error('Workspace not found');
      }

      const workspace = await this.getWorkspace(payload.workspaceId);
      const workspaceDbPath = path.join(workspace.path, '.meta', DEFAULT_DB_FILE);
      const workspaceDb = this.openWorkspaceDbWithRecovery(workspaceDbPath);

      try {
        const existing = workspaceDb.get<{
          workspace_id: string;
          zendesk_subdomain: string;
          zendesk_brand_id: string | null;
          default_locale: string;
          enabled_locales: string;
        }>(
          `SELECT workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales
           FROM workspace_settings WHERE workspace_id = @workspaceId`,
          { workspaceId: payload.workspaceId }
        );

        const fallbackDefaultLocale = existing?.default_locale ?? row.default_locale;
        const fallbackSubdomain = existing?.zendesk_subdomain ?? row.zendesk_subdomain;
        const fallbackBrand = existing?.zendesk_brand_id ?? row.zendesk_brand_id;
        const fallbackEnabledLocales = safeParseLocales(existing?.enabled_locales ?? row.enabled_locales);

        if (
          payload.zendeskSubdomain === undefined &&
          payload.zendeskBrandId === undefined &&
          payload.defaultLocale === undefined &&
          payload.enabledLocales === undefined
        ) {
          throw new Error('No settings provided');
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

        workspaceDb.run(
          `INSERT OR REPLACE INTO workspace_settings (
            workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, updated_at
          ) VALUES (
            @workspaceId, @zendeskSubdomain, @zendeskBrandId, @defaultLocale, @enabledLocales, @updatedAt
          )`,
          {
            workspaceId: payload.workspaceId,
            zendeskSubdomain: nextSubdomain,
            zendeskBrandId: nextBrand,
            defaultLocale: nextDefaultLocale,
            enabledLocales: JSON.stringify(normalizedEnabledLocales),
            updatedAt: now
          }
        );

        catalog.run(
          `UPDATE workspaces
           SET zendesk_subdomain = @zendeskSubdomain,
               zendesk_brand_id = @zendeskBrandId,
               default_locale = @defaultLocale,
               enabled_locales = @enabledLocales,
               updated_at = @updatedAt
           WHERE id = @id`,
          {
            id: payload.workspaceId,
            zendeskSubdomain: nextSubdomain,
            zendeskBrandId: nextBrand,
            defaultLocale: nextDefaultLocale,
            enabledLocales: JSON.stringify(normalizedEnabledLocales),
            updatedAt: now
          }
        );

        return {
          workspaceId: payload.workspaceId,
          zendeskSubdomain: nextSubdomain,
          zendeskBrandId: nextBrand ?? undefined,
          defaultLocale: nextDefaultLocale,
          enabledLocales: normalizedEnabledLocales
        };
      } finally {
        workspaceDb.close();
      }
    } finally {
      catalog.close();
    }
  }

  async createWorkspace(payload: WorkspaceCreateRequest): Promise<WorkspaceRecord> {
    const startedAt = Date.now();
    logger.info('workspace-repository.createWorkspace start', {
      name: payload.name,
      defaultLocale: payload.defaultLocale,
      hasPathOverride: Boolean(payload.path),
      enabledLocalesCount: payload.enabledLocales?.length ?? 0
    });
    const catalog = await this.openCatalogWithRecovery();
    const now = new Date().toISOString();
    const resolvedPath = workspacePath(payload.path, this.workspaceRoot, payload.name);
    try {
      const existing = catalog.get<CatalogWorkspaceRow>(
        `SELECT id FROM workspaces WHERE name = @name OR path = @path`,
        { name: payload.name, path: resolvedPath }
      );
      if (existing) {
        throw new Error('Workspace with name or path already exists');
      }

      const id = randomUUID();
      const enabledLocales = normalizeLocales(payload.enabledLocales);
      const totalExisting = catalog.get<{ total: number }>('SELECT COUNT(*) AS total FROM workspaces');
      const shouldBeDefault = (totalExisting?.total ?? 0) === 0;
      await this.prepareWorkspaceFilesystem(resolvedPath);
      await this.ensureWorkspaceDb(resolvedPath);

      const workspaceRecord: WorkspaceRecord = {
        id,
        name: payload.name,
        createdAtUtc: now,
        updatedAtUtc: now,
        lastOpenedAtUtc: now,
        isDefaultWorkspace: shouldBeDefault,
        zendeskConnectionId: id,
        defaultLocale: payload.defaultLocale,
        enabledLocales,
        state: WorkspaceState.ACTIVE,
        path: resolvedPath
      };

      catalog.run(
        `INSERT INTO workspaces (
          id, name, path, created_at, updated_at, last_opened_at, zendesk_subdomain,
          zendesk_brand_id, default_locale, enabled_locales, state, is_default
        ) VALUES (
          @id, @name, @path, @createdAt, @updatedAt, @lastOpenedAt, @subdomain,
          @brand, @defaultLocale, @enabledLocales, @state, @isDefault
        )`,
        {
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
          state: WorkspaceState.ACTIVE,
          isDefault: shouldBeDefault ? 1 : 0
        }
      );

      const workspaceDbPath = path.join(resolvedPath, '.meta', DEFAULT_DB_FILE);
      const workspaceDb = this.openWorkspaceDbWithRecovery(workspaceDbPath);
      try {
        workspaceDb.run(
          `INSERT INTO workspace_settings (
            workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, updated_at
          ) VALUES (
            @workspaceId, @zendeskSubdomain, @zendeskBrandId, @defaultLocale, @enabledLocales, @updatedAt
          )`,
          {
            workspaceId: id,
            zendeskSubdomain: payload.zendeskSubdomain,
            zendeskBrandId: payload.zendeskBrandId ?? null,
            defaultLocale: payload.defaultLocale,
            enabledLocales: JSON.stringify(enabledLocales),
            updatedAt: now
          }
        );
      } finally {
        workspaceDb.close();
      }

      return workspaceRecord;
    } catch (error) {
      logger.error('workspace-repository.createWorkspace failed', {
        name: payload.name,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    } finally {
      const elapsedMs = Date.now() - startedAt;
      logger.info('workspace-repository.createWorkspace complete', {
        name: payload.name,
        workspacePath: resolvedPath,
        elapsedMs
      });
      catalog.close();
    }
  }

  async openWorkspace(id: string): Promise<WorkspaceRecord> {
    const catalog = await this.openCatalogWithRecovery();
    try {
      const row = catalog.get<CatalogWorkspaceRow>(`SELECT * FROM workspaces WHERE id = @id`, { id });
      if (!row) {
        throw new Error('Workspace not found');
      }

      const now = new Date().toISOString();
      catalog.run(
        `UPDATE workspaces SET last_opened_at = @now, updated_at = @now WHERE id = @id`,
        { now, id }
      );

      return { ...mapWorkspaceRow({ ...row, last_opened_at: now, updated_at: now }), lastOpenedAtUtc: now };
    } finally {
      catalog.close();
    }
  }

  async deleteWorkspace(id: string): Promise<void> {
    const catalog = await this.openCatalogWithRecovery();
    try {
      const row = catalog.get<CatalogWorkspaceRow>(`SELECT path FROM workspaces WHERE id = @id`, { id });
      if (!row) {
        throw new Error('Workspace not found');
      }

      await fs.rm(row.path, { recursive: true, force: true });
      catalog.run(`DELETE FROM workspaces WHERE id = @id`, { id });
    } finally {
      catalog.close();
    }
  }

  async getWorkspaceListWithCounts(): Promise<WorkspaceListItem[]> {
    const catalog = await this.openCatalogWithRecovery();
    try {
      const catalogRows = catalog.all<CatalogWorkspaceRow>(`
        SELECT id, name, path, created_at, updated_at, last_opened_at, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, state, is_default
        FROM workspaces
        ORDER BY name COLLATE NOCASE
      `);

      const workspaceItems: WorkspaceListItem[] = [];
      for (const row of catalogRows) {
        const workspaceDbPath = path.join(row.path, '.meta', DEFAULT_DB_FILE);
        const workspaceDb = this.openWorkspaceDbWithRecovery(workspaceDbPath);
        try {
          const articleCount = workspaceDb.get<{ total: number }>('SELECT COUNT(*) AS total FROM article_families', {})?.total ?? 0;
          const draftCount = workspaceDb.get<{ total: number }>(
            `SELECT COUNT(*) AS total FROM revisions WHERE revision_type = 'draft_branch'`,
            {}
          )?.total ?? 0;
          workspaceItems.push(buildWorkspaceItemFromCatalog(row, articleCount, draftCount));
        } finally {
          workspaceDb.close();
        }
      }
      return workspaceItems;
    } finally {
      catalog.close();
    }
  }

  async getWorkspaceList(): Promise<WorkspaceListItem[]> {
    const startedAt = Date.now();
    logger.info('workspace-repository.getWorkspaceList quick start');
    let catalog: ReturnType<typeof openWorkspaceDatabase>;
    try {
      catalog = await this.openCatalogWithRecovery();
    } catch (error) {
      logger.warn('workspace-repository.getWorkspaceList unable to open catalog', {
        elapsedMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
        code: (error as { code?: string })?.code
      });
      return [];
    }

    let itemCount = 0;
    try {
      const catalogRows = catalog.all<CatalogWorkspaceRow>(`
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
    } catch (error) {
      logger.error('workspace-repository.getWorkspaceList query failed', {
        elapsedMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return [];
    } finally {
      const elapsedMs = Date.now() - startedAt;
      logger.info('workspace-repository.getWorkspaceList quick path', {
        elapsedMs,
        count: itemCount
      });
      catalog.close();
    }
  }

  async setDefaultWorkspace(workspaceId: string): Promise<void> {
    const catalog = await this.openCatalogWithRecovery();
    try {
      const existing = catalog.get<CatalogWorkspaceRow>(`SELECT id FROM workspaces WHERE id = @id`, { id: workspaceId });
      if (!existing) {
        throw new Error('Workspace not found');
      }

      catalog.run('BEGIN IMMEDIATE');
      try {
        catalog.run('UPDATE workspaces SET is_default = 0');
        catalog.run(`UPDATE workspaces SET is_default = 1 WHERE id = @id`, { id: workspaceId });
        catalog.run('COMMIT');
      } catch (error) {
        catalog.run('ROLLBACK');
        throw error;
      }
    } finally {
      catalog.close();
    }
  }

  async listArticleFamilies(workspaceId: string): Promise<ArticleFamilyRecord[]> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      return workspaceDb.all<ArticleFamilyRecord>(
        `SELECT id, workspace_id as workspaceId, external_key as externalKey, title, section_id as sectionId, category_id as categoryId, retired_at as retiredAtUtc
         FROM article_families
         WHERE workspace_id = @workspaceId
         ORDER BY title`,
        { workspaceId }
      );
    } finally {
      workspaceDb.close();
    }
  }

  async getArticleFamily(workspaceId: string, familyId: string): Promise<ArticleFamilyRecord> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const family = workspaceDb.get<ArticleFamilyRecord>(
        `SELECT id, workspace_id as workspaceId, external_key as externalKey, title, section_id as sectionId, category_id as categoryId, retired_at as retiredAtUtc
         FROM article_families
         WHERE id = @familyId AND workspace_id = @workspaceId`,
        { familyId, workspaceId }
      );
      if (!family) {
        throw new Error('Article family not found');
      }
      return family;
    } finally {
      workspaceDb.close();
    }
  }

  async createArticleFamily(payload: ArticleFamilyCreateRequest): Promise<ArticleFamilyRecord> {
    const workspace = await this.getWorkspace(payload.workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    const now = new Date().toISOString();
    try {
      const existing = workspaceDb.get<{ id: string }>(
        `SELECT id FROM article_families WHERE external_key = @externalKey AND workspace_id = @workspaceId`,
        { externalKey: payload.externalKey, workspaceId: payload.workspaceId }
      );
      if (existing) {
        throw new Error('Article family already exists');
      }

      const id = randomUUID();
      const title = payload.title.trim();
      if (!title) {
        throw new Error('Article family title is required');
      }
      const externalKey = payload.externalKey.trim();
      if (!externalKey) {
        throw new Error('Article family externalKey is required');
      }

      workspaceDb.run(
        `INSERT INTO article_families (id, workspace_id, external_key, title, section_id, category_id, retired_at)
         VALUES (@id, @workspaceId, @externalKey, @title, @sectionId, @categoryId, @retiredAtUtc)`,
        {
          id,
          workspaceId: payload.workspaceId,
          externalKey,
          title,
          sectionId: payload.sectionId ?? null,
          categoryId: payload.categoryId ?? null,
          retiredAtUtc: payload.retiredAtUtc ?? null
        }
      );

      return {
        id,
        workspaceId: payload.workspaceId,
        externalKey,
        title,
        sectionId: payload.sectionId,
        categoryId: payload.categoryId,
        retiredAtUtc: payload.retiredAtUtc
      };
    } finally {
      workspaceDb.close();
    }
  }

  async updateArticleFamily(payload: ArticleFamilyUpdateRequest): Promise<ArticleFamilyRecord> {
    const workspace = await this.getWorkspace(payload.workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const existing = workspaceDb.get<ArticleFamilyRecord>(
        `SELECT id, workspace_id as workspaceId, external_key as externalKey, title, section_id as sectionId, category_id as categoryId, retired_at as retiredAtUtc
         FROM article_families
         WHERE id = @familyId AND workspace_id = @workspaceId`,
        { familyId: payload.familyId, workspaceId: payload.workspaceId }
      );
      if (!existing) {
        throw new Error('Article family not found');
      }

      if (
        payload.title === undefined &&
        payload.sectionId === undefined &&
        payload.categoryId === undefined &&
        payload.retiredAtUtc === undefined
      ) {
        throw new Error('Article family update requires at least one field');
      }

      const title = payload.title ?? existing.title;
      if (payload.title !== undefined && !title.trim()) {
        throw new Error('Article family title cannot be empty');
      }
      const sectionId = payload.sectionId ?? existing.sectionId ?? undefined;
      const categoryId = payload.categoryId ?? existing.categoryId ?? undefined;
      const retiredAt = payload.retiredAtUtc === null ? null : (payload.retiredAtUtc ?? existing.retiredAtUtc ?? null);
      workspaceDb.run(
        `UPDATE article_families
         SET title = @title,
             section_id = @sectionId,
             category_id = @categoryId,
             retired_at = @retiredAtUtc
         WHERE id = @familyId AND workspace_id = @workspaceId`,
        {
          familyId: payload.familyId,
          workspaceId: payload.workspaceId,
          title,
          sectionId,
          categoryId,
          retiredAtUtc: retiredAt
        }
      );

      return {
        ...existing,
        title,
        sectionId,
        categoryId,
        retiredAtUtc: retiredAt ?? undefined
      };
    } finally {
      workspaceDb.close();
    }
  }

  async deleteArticleFamily(workspaceId: string, familyId: string): Promise<void> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      workspaceDb.run(
        `DELETE FROM revisions
         WHERE locale_variant_id IN (SELECT id FROM locale_variants WHERE family_id = @familyId)`,
        { familyId }
      );
      workspaceDb.run(
        `DELETE FROM locale_variants WHERE family_id = @familyId`,
        { familyId }
      );
      const removed = workspaceDb.run(
        `DELETE FROM article_families WHERE id = @familyId AND workspace_id = @workspaceId`,
        { familyId, workspaceId }
      );
      if (removed.changes === 0) {
        throw new Error('Article family not found');
      }
    } finally {
      workspaceDb.close();
    }
  }

  async listLocaleVariants(workspaceId: string): Promise<LocaleVariantRecord[]> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      return workspaceDb.all<LocaleVariantRecord>(
        `SELECT lv.id, lv.family_id as familyId, lv.locale, lv.status, lv.retired_at as retiredAtUtc
         FROM locale_variants lv
         JOIN article_families af ON af.id = lv.family_id
         WHERE af.workspace_id = @workspaceId
         ORDER BY lv.locale`,
        { workspaceId }
      );
    } finally {
      workspaceDb.close();
    }
  }

  async getLocaleVariantsForFamily(workspaceId: string, familyId: string): Promise<LocaleVariantRecord[]> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      return workspaceDb.all<LocaleVariantRecord>(
        `SELECT lv.id, lv.family_id as familyId, lv.locale, lv.status, lv.retired_at as retiredAtUtc
         FROM locale_variants lv
         WHERE lv.family_id = @familyId AND lv.family_id IN (SELECT id FROM article_families WHERE workspace_id = @workspaceId)
         ORDER BY lv.locale`,
        { familyId, workspaceId }
      );
    } finally {
      workspaceDb.close();
    }
  }

  async listTemplatePacks(workspaceId: string): Promise<TemplatePackRecord[]> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      return workspaceDb.all<TemplatePackRecord>(
        `SELECT id, workspace_id as workspaceId, name, language, prompt_template as promptTemplate,
                tone_rules as toneRules, examples, active, updated_at as updatedAtUtc
         FROM template_packs
         ORDER BY updated_at DESC`,
        { workspaceId }
      );
    } finally {
      workspaceDb.close();
    }
  }

  async getTemplatePack(workspaceId: string, templatePackId: string): Promise<TemplatePackRecord | null> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const row = workspaceDb.get<TemplatePackRecord>(
        `SELECT id, workspace_id as workspaceId, name, language, prompt_template as promptTemplate,
                tone_rules as toneRules, examples, active, updated_at as updatedAtUtc
         FROM template_packs
         WHERE id = @templatePackId AND workspace_id = @workspaceId`,
        { templatePackId, workspaceId }
      );
      return row ?? null;
    } finally {
      workspaceDb.close();
    }
  }

  async getTemplatePackByLocale(workspaceId: string, locale: string): Promise<TemplatePackRecord | null> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const row = workspaceDb.get<TemplatePackRecord>(
        `SELECT id, workspace_id as workspaceId, name, language, prompt_template as promptTemplate,
                tone_rules as toneRules, examples, active, updated_at as updatedAtUtc
         FROM template_packs
         WHERE workspace_id = @workspaceId AND language = @locale
         ORDER BY updated_at DESC LIMIT 1`,
        { locale, workspaceId }
      );
      return row ?? null;
    } finally {
      workspaceDb.close();
    }
  }

  async getLocaleVariant(workspaceId: string, variantId: string): Promise<LocaleVariantRecord> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const variant = workspaceDb.get<LocaleVariantRecord>(
        `SELECT id, family_id as familyId, locale, status, retired_at as retiredAtUtc
         FROM locale_variants
         WHERE id = @variantId AND family_id IN (SELECT id FROM article_families WHERE workspace_id = @workspaceId)`,
        { variantId, workspaceId }
      );
      if (!variant) {
        throw new Error('Locale variant not found');
      }
      return variant;
    } finally {
      workspaceDb.close();
    }
  }

  async createLocaleVariant(payload: LocaleVariantCreateRequest): Promise<LocaleVariantRecord> {
    const workspace = await this.getWorkspace(payload.workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const family = workspaceDb.get<{ id: string }>(
        `SELECT id FROM article_families WHERE id = @familyId`,
        { familyId: payload.familyId }
      );
      if (!family) {
        throw new Error('Article family not found');
      }

      const locale = payload.locale.trim();
      if (!locale) {
        throw new Error('Locale is required');
      }

      const duplicate = workspaceDb.get<{ id: string }>(
        `SELECT id FROM locale_variants WHERE family_id = @familyId AND locale = @locale`,
        { familyId: payload.familyId, locale }
      );
      if (duplicate) {
        throw new Error('Locale variant already exists');
      }

      const status = payload.status ?? RevisionState.LIVE;
      const id = randomUUID();

      workspaceDb.run(
        `INSERT INTO locale_variants (id, family_id, locale, status, retired_at)
         VALUES (@id, @familyId, @locale, @status, @retiredAtUtc)`,
        {
          id,
          familyId: payload.familyId,
          locale,
          status,
          retiredAtUtc: payload.retiredAtUtc ?? null
        }
      );

      return {
        id,
        familyId: payload.familyId,
        locale,
        status,
        retiredAtUtc: payload.retiredAtUtc
      };
    } finally {
      workspaceDb.close();
    }
  }

  async updateLocaleVariant(payload: LocaleVariantUpdateRequest): Promise<LocaleVariantRecord> {
    const workspace = await this.getWorkspace(payload.workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const existing = workspaceDb.get<LocaleVariantRecord>(
        `SELECT id, family_id as familyId, locale, status, retired_at as retiredAtUtc
         FROM locale_variants
         WHERE id = @variantId AND family_id IN (SELECT id FROM article_families WHERE workspace_id = @workspaceId)`,
        { variantId: payload.variantId, workspaceId: payload.workspaceId }
      );
      if (!existing) {
        throw new Error('Locale variant not found');
      }

      if (
        payload.locale === undefined &&
        payload.status === undefined &&
        payload.retiredAtUtc === undefined
      ) {
        throw new Error('Locale variant update requires at least one field');
      }

      const locale = payload.locale !== undefined ? payload.locale.trim() : existing.locale;
      if (!locale) {
        throw new Error('Locale is required');
      }

      if (payload.locale !== undefined) {
        const duplicate = workspaceDb.get<{ id: string }>(
          `SELECT id FROM locale_variants WHERE family_id = @familyId AND locale = @locale AND id != @variantId`,
          { familyId: existing.familyId, locale, variantId: payload.variantId }
        );
        if (duplicate) {
          throw new Error('Locale variant already exists');
        }
      }
      const status = payload.status ?? existing.status;
      const retiredAt = payload.retiredAtUtc === null ? null : (payload.retiredAtUtc ?? existing.retiredAtUtc ?? null);

      workspaceDb.run(
        `UPDATE locale_variants
         SET locale = @locale,
             status = @status,
             retired_at = @retiredAtUtc
         WHERE id = @variantId`,
        {
          variantId: payload.variantId,
          locale,
          status,
          retiredAtUtc: retiredAt
        }
      );

      return {
        id: existing.id,
        familyId: existing.familyId,
        locale,
        status,
        retiredAtUtc: retiredAt ?? undefined
      };
    } finally {
      workspaceDb.close();
    }
  }

  async deleteLocaleVariant(workspaceId: string, variantId: string): Promise<void> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      workspaceDb.run(
        `DELETE FROM revisions WHERE locale_variant_id = @variantId`,
        { variantId }
      );
      const removed = workspaceDb.run(
        `DELETE FROM locale_variants
         WHERE id = @variantId
           AND family_id IN (SELECT id FROM article_families WHERE workspace_id = @workspaceId)`,
        { variantId, workspaceId }
      );
      if (removed.changes === 0) {
        throw new Error('Locale variant not found');
      }
    } finally {
      workspaceDb.close();
    }
  }

  async listRevisions(workspaceId: string, localeVariantId?: string): Promise<RevisionRecord[]> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      if (localeVariantId) {
        return workspaceDb.all<RevisionRecord>(
          `SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                  workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                  revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
           FROM revisions
           WHERE workspace_id = @workspaceId AND locale_variant_id = @localeVariantId
           ORDER BY revision_number DESC`,
          { workspaceId, localeVariantId }
        );
      }
      return workspaceDb.all<RevisionRecord>(
        `SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
         FROM revisions
         WHERE workspace_id = @workspaceId
         ORDER BY revision_number DESC`,
        { workspaceId }
      );
    } finally {
      workspaceDb.close();
    }
  }

  async listLocaleVariantsByLocale(workspaceId: string, locale: string): Promise<LocaleVariantRecord[]> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      return workspaceDb.all<LocaleVariantRecord>(
        `SELECT lv.id, lv.family_id as familyId, lv.locale, lv.status, lv.retired_at as retiredAtUtc
         FROM locale_variants lv
         JOIN article_families af ON af.id = lv.family_id
         WHERE af.workspace_id = @workspaceId AND lv.locale = @locale`,
        { workspaceId, locale }
      );
    } finally {
      workspaceDb.close();
    }
  }

  async reconcileSyncedLocaleVariants(
    workspaceId: string,
    locale: string,
    remoteFamilyExternalKeys: string[]
  ): Promise<void> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const now = new Date().toISOString();
      const retainedStatus = RevisionState.LIVE;
      const retiredStatus = RevisionState.RETIRED;
      const retiredAtUtc = now;

      if (!remoteFamilyExternalKeys.length) {
        workspaceDb.run(
          `UPDATE locale_variants
           SET status = @retiredStatus,
               retired_at = @retiredAtUtc
           WHERE id IN (
             SELECT lv.id
             FROM locale_variants lv
             JOIN article_families af ON af.id = lv.family_id
             WHERE af.workspace_id = @workspaceId AND lv.locale = @locale AND lv.status != @retiredStatus
           )`,
          { workspaceId, locale, retiredStatus, retiredAtUtc }
        );
        workspaceDb.run(
          `UPDATE draft_branches
           SET state = 'obsolete', updated_at = @retiredAtUtc
           WHERE workspace_id = @workspaceId
             AND state != 'obsolete'
             AND locale_variant_id IN (
               SELECT lv.id
               FROM locale_variants lv
               JOIN article_families af ON af.id = lv.family_id
               WHERE af.workspace_id = @workspaceId AND lv.locale = @locale
             )`,
          { workspaceId, locale, retiredAtUtc }
        );
        return;
      }

      const keys = Array.from(new Set(remoteFamilyExternalKeys.filter(Boolean)));
      const placeholders = keys.map((_, idx) => `@remoteKey${idx}`).join(',');
      const queryParams: Record<string, string> = {
        workspaceId,
        locale,
        retainedStatus,
        retiredStatus,
        retiredAtUtc
      };
      keys.forEach((key, index) => {
        queryParams[`remoteKey${index}`] = key;
      });

      workspaceDb.run(
        `UPDATE locale_variants
         SET status = @retainedStatus,
             retired_at = NULL
         WHERE id IN (
           SELECT lv.id
           FROM locale_variants lv
           JOIN article_families af ON af.id = lv.family_id
           WHERE af.workspace_id = @workspaceId
             AND lv.locale = @locale
             AND af.external_key IN (${placeholders})
         )`,
        queryParams
      );

      workspaceDb.run(
        `UPDATE locale_variants
         SET status = @retiredStatus,
             retired_at = @retiredAtUtc
         WHERE id IN (
           SELECT lv.id
           FROM locale_variants lv
           JOIN article_families af ON af.id = lv.family_id
           WHERE af.workspace_id = @workspaceId
             AND lv.locale = @locale
             AND af.external_key NOT IN (${placeholders})
         )`,
        queryParams
      );

      workspaceDb.run(
        `UPDATE draft_branches
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
           )`,
        queryParams
      );
    } finally {
      workspaceDb.close();
    }
  }

  async getRevision(workspaceId: string, revisionId: string): Promise<RevisionRecord> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const revision = workspaceDb.get<RevisionRecord>(
        `SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
         FROM revisions
         WHERE id = @revisionId AND workspace_id = @workspaceId`,
        { revisionId, workspaceId }
      );
      if (!revision) {
        throw new Error('Revision not found');
      }
      return revision;
    } finally {
      workspaceDb.close();
    }
  }

  async createRevision(payload: RevisionCreateRequest): Promise<RevisionRecord> {
    const workspace = await this.getWorkspace(payload.workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const variant = workspaceDb.get<{ id: string }>(
        `SELECT id FROM locale_variants WHERE id = @variantId`,
        { variantId: payload.localeVariantId }
      );
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

      const existingLatest = workspaceDb.get<{ maxRevision: number }>(
        `SELECT COALESCE(MAX(revision_number), 0) AS maxRevision FROM revisions WHERE locale_variant_id = @variantId`,
        { variantId: payload.localeVariantId }
      );
      if (payload.revisionNumber < (existingLatest?.maxRevision ?? 0)) {
        throw new Error('revisionNumber must not regress');
      }

      const now = new Date().toISOString();
      const id = randomUUID();
      workspaceDb.run(
        `INSERT INTO revisions (
          id, locale_variant_id, revision_type, branch_id, workspace_id, file_path, content_hash, source_revision_id, revision_number, status, created_at, updated_at
        ) VALUES (@id, @localeVariantId, @revisionType, @branchId, @workspaceId, @filePath, @contentHash, @sourceRevisionId, @revisionNumber, @status, @createdAt, @updatedAt)`,
        {
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
        }
      );

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
    } finally {
      workspaceDb.close();
    }
  }

  async updateRevision(payload: RevisionUpdateRequest): Promise<RevisionRecord> {
    const workspace = await this.getWorkspace(payload.workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const existing = workspaceDb.get<RevisionRecord>(
        `SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
         FROM revisions
         WHERE id = @revisionId AND workspace_id = @workspaceId`,
        { revisionId: payload.revisionId, workspaceId: payload.workspaceId }
      );
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

      workspaceDb.run(
        `UPDATE revisions
         SET revision_type = @revisionType,
             branch_id = @branchId,
             file_path = @filePath,
             content_hash = @contentHash,
             source_revision_id = @sourceRevisionId,
             revision_number = @revisionNumber,
             status = @status,
             updated_at = @updatedAt
         WHERE id = @revisionId AND workspace_id = @workspaceId`,
        {
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
        }
      );

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
    } finally {
      workspaceDb.close();
    }
  }

  async deleteRevision(workspaceId: string, revisionId: string): Promise<void> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const removed = workspaceDb.run(`DELETE FROM revisions WHERE id = @revisionId AND workspace_id = @workspaceId`, {
        revisionId,
        workspaceId
      });
      if (removed.changes === 0) {
        throw new Error('Revision not found');
      }
    } finally {
      workspaceDb.close();
    }
  }

  async getExplorerTree(workspaceId: string): Promise<ExplorerNode[]> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));

      try {
      const families = workspaceDb.all<ExplorerFamilyRow>(`SELECT * FROM article_families ORDER BY title`);
      const variants = workspaceDb.all<LocaleVariantRecord>(`SELECT id, family_id as familyId, locale, status FROM locale_variants`);
      const revisions = workspaceDb.all<{
        id: string;
        localeVariantId: string;
        revisionNumber: number;
        revisionType: RevisionState;
        filePath: string;
        updatedAtUtc: string;
      }>(`
        SELECT
          id,
          locale_variant_id as localeVariantId,
          revision_number as revisionNumber,
          revision_type as revisionType,
          file_path as filePath,
          updated_at as updatedAtUtc
        FROM revisions
      `);
      const branches = workspaceDb.all<{ locale_variant_id: string; total: number }>(
        `SELECT locale_variant_id, COUNT(*) AS total FROM draft_branches GROUP BY locale_variant_id`
      );
      const branchCounts = new Map(branches.map((row) => [row.locale_variant_id, row.total]));
      const latestByVariant = getLatestRevisions(revisions);

      return families.map((family) => {
        const locales = variants
          .filter((variant) => variant.familyId === family.id)
        .map((variant) => {
            const latest = latestByVariant.get(variant.id);
            return {
              locale: variant.locale,
              localeVariantId: variant.id,
              revision: {
                revisionId: latest?.revisionId ?? '',
                revisionNumber: latest?.revisionNumber ?? 0,
                state: latest?.revisionType ?? variant.status ?? RevisionState.LIVE,
                updatedAtUtc: latest?.updatedAtUtc ?? new Date().toISOString(),
                draftCount: branchCounts.get(variant.id) ?? 0
              },
              hasConflicts: variant.status === RevisionState.OBSOLETE
            };
          });

        return {
          familyId: family.id,
          title: family.title,
          familyStatus: locales.some((node) => node.revision.state === RevisionState.OBSOLETE)
            ? RevisionState.OBSOLETE
            : ((family as { retired_at?: string | null }).retired_at
              ? RevisionState.RETIRED
              : RevisionState.LIVE),
          locales
        };
      });
    } finally {
      workspaceDb.close();
    }
  }

  async searchArticles(workspaceId: string, payload: SearchPayload): Promise<SearchResponse> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const query = payload.query.trim().toLowerCase();
    if (!query) {
      return { workspaceId, total: 0, results: [] };
    }

    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const scope = normalizeSearchScope(payload.scope);
      const includeArchived = Boolean(payload.includeArchived);
      const familyQueryParams = {
        q: query,
        includeArchived: includeArchived ? 1 : 0
      };

      const families = workspaceDb.all<{
        id: string;
        title: string;
        external_key: string;
        section_id: string | null;
        category_id: string | null;
        retired_at: string | null;
      }>(
        includeArchived
          ? `SELECT id, title, external_key, section_id, category_id, retired_at
             FROM article_families
             WHERE lower(title) LIKE '%' || @q || '%' OR lower(external_key) LIKE '%' || @q || '%'`
          : `SELECT id, title, external_key, section_id, category_id, retired_at
             FROM article_families
             WHERE retired_at IS NULL
               AND (lower(title) LIKE '%' || @q || '%' OR lower(external_key) LIKE '%' || @q || '%')`,
        familyQueryParams
      );

      const variants = workspaceDb.all<{
        id: string;
        familyId: string;
        locale: string;
      }>(`SELECT id, family_id as familyId, locale FROM locale_variants`);
      const revisions = workspaceDb.all<{
        id: string;
        locale_variant_id: string;
        revision_number: number;
        revision_type: RevisionState;
        updated_at: string;
        file_path: string;
      }>(`SELECT id, locale_variant_id, revision_number, revision_type, file_path, updated_at FROM revisions`);
      const revisionByVariant = getLatestRevisions(revisions.map((revision) => ({
        id: revision.id,
        localeVariantId: revision.locale_variant_id,
        revisionNumber: revision.revision_number,
        revisionType: revision.revision_type,
        updatedAtUtc: revision.updated_at,
        filePath: revision.file_path
      })));

      const localeVariantToDraftCount = new Map<string, number>();
      const draftCounts = workspaceDb.all<{ locale_variant_id: string; total: number }>(
        `SELECT locale_variant_id, COUNT(*) AS total
         FROM draft_branches
         GROUP BY locale_variant_id`
      );
      draftCounts.forEach((row) => localeVariantToDraftCount.set(row.locale_variant_id, row.total));

      const variantRows = workspaceDb.all<{ id: string; status: RevisionState; retired_at: string | null }>(
        `SELECT id, status, retired_at FROM locale_variants`
      );
      const localeVariantStatus = new Map<string, { status: RevisionState; hasConflicts: boolean; retiredAt?: string }>();
      for (const row of variantRows) {
        localeVariantStatus.set(row.id, {
          status: row.status,
          hasConflicts: row.status === RevisionState.OBSOLETE,
          retiredAt: row.retired_at ?? undefined
        });
      }

      const variantFamilyMap = new Map<string, { familyId: string; locale: string }>(
        variants.map((variant) => [variant.id, { familyId: variant.familyId, locale: variant.locale }])
      );

      const results: SearchResult[] = [];

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

          if (!passSearchScope(
            statusState,
            scope,
            variantToDraftCount(localeVariantToDraftCount, variant.id),
            payload.hasDrafts,
            payload.includeConflicts,
            payload.changedWithinHours,
            revision.updatedAtUtc
          )) {
            continue;
          }

          const hasRevisionFile = await this.fileExists(resolveRevisionPath(workspace.path, revision.filePath));
          let matchSource: SearchSourceMatch = { context: 'title', snippet: family.title, scoreBoost: 1.5 };
          if (hasRevisionFile) {
            const sourceHtml = await this.readRevisionSource(
              resolveRevisionPath(workspace.path, revision.filePath)
            );
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
          } else if (!family.title.toLowerCase().includes(query)) {
            continue;
          }

          if (!revision) {
            continue;
          }
          const familyStatus = family.retired_at ? RevisionState.RETIRED : (statusState?.status ?? RevisionState.LIVE);

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
    } finally {
      workspaceDb.close();
    }
  }

  async createPBIBatch(
    workspaceId: string,
    batchName: string,
    sourceFileName: string,
    sourcePath: string,
    sourceFormat: PBIImportFormat,
    sourceRowCount: number,
    counts: {
      candidateRowCount: number;
      malformedRowCount: number;
      duplicateRowCount: number;
      ignoredRowCount: number;
      scopedRowCount: number;
    },
    scopeMode: PBIBatchScopeMode = PBIBatchScopeMode.ALL,
    scopePayload?: string,
    status: PBIBatchStatus = PBIBatchStatus.IMPORTED
  ): Promise<PBIBatchRecord> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const now = new Date().toISOString();
      const id = randomUUID();
      workspaceDb.run(
        `INSERT INTO pbi_batches (
          id, workspace_id, name, source_file_name, source_row_count, imported_at, status,
          source_path, source_format, candidate_row_count, ignored_row_count, malformed_row_count,
          duplicate_row_count, scoped_row_count, scope_mode, scope_payload
        ) VALUES (
          @id, @workspaceId, @name, @sourceFileName, @sourceRowCount, @importedAt, @status,
          @sourcePath, @sourceFormat, @candidateRowCount, @ignoredRowCount, @malformedRowCount,
          @duplicateRowCount, @scopedRowCount, @scopeMode, @scopePayload
        )`,
        {
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
        }
      );

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
    } finally {
      workspaceDb.close();
    }
  }

  async findDuplicatePBIBatch(
    workspaceId: string,
    sourceFileName: string,
    sourceRowCount: number,
    counts: {
      candidateRowCount: number;
      malformedRowCount: number;
      duplicateRowCount: number;
      ignoredRowCount: number;
    }
  ): Promise<PBIBatchRecord | null> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const duplicate = await workspaceDb.get<PBIBatchRecord>(`
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
        importedStatus: PBIBatchStatus.IMPORTED,
        scopedStatus: PBIBatchStatus.SCOPED,
        submittedStatus: PBIBatchStatus.SUBMITTED,
        analyzedStatus: PBIBatchStatus.ANALYZED,
        reviewInProgressStatus: PBIBatchStatus.REVIEW_IN_PROGRESS,
        reviewCompleteStatus: PBIBatchStatus.REVIEW_COMPLETE,
        archivedStatus: PBIBatchStatus.ARCHIVED
      });
      return duplicate ?? null;
    } finally {
      workspaceDb.close();
    }
  }

  async deletePBIBatch(workspaceId: string, batchId: string): Promise<void> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const batchExists = workspaceDb.get<{ id: string }>(
        `SELECT id FROM pbi_batches WHERE id = @batchId AND workspace_id = @workspaceId`,
        { batchId, workspaceId }
      );
      if (!batchExists) {
        throw new Error('PBI batch not found');
      }

      workspaceDb.exec('BEGIN IMMEDIATE');
      try {
        workspaceDb.run(
          `DELETE FROM pbi_records WHERE batch_id = @batchId`,
          { batchId }
        );
        workspaceDb.run(
          `DELETE FROM pbi_batches WHERE id = @batchId AND workspace_id = @workspaceId`,
          { batchId, workspaceId }
        );
        workspaceDb.exec('COMMIT');
      } catch (error) {
        workspaceDb.exec('ROLLBACK');
        throw error;
      }
    } finally {
      workspaceDb.close();
    }
  }

  async insertPBIRecords(
    workspaceId: string,
    batchId: string,
    records: Array<{
      sourceRowNumber: number;
      externalId: string;
      title: string;
      description?: string;
      priority?: string;
      state?: PBIValidationStatus;
      workItemType?: string;
      title1?: string;
      title2?: string;
      title3?: string;
      rawDescription?: string;
      rawAcceptanceCriteria?: string;
      descriptionText?: string;
      acceptanceCriteriaText?: string;
      parentExternalId?: string;
      parentRecordId?: string;
      validationStatus?: PBIValidationStatus;
      validationReason?: string;
    }>
  ): Promise<void> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
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
        id: randomUUID(),
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
        validationStatus: record.validationStatus ?? PBIValidationStatus.CANDIDATE,
        validationReason: record.validationReason ?? null,
        insertedAt,
      }));
      workspaceDb.exec('BEGIN IMMEDIATE');
      try {
        for (const value of values) {
          insert.run(value);
        }
        workspaceDb.exec('COMMIT');
      } catch (error) {
        workspaceDb.exec('ROLLBACK');
        throw error;
      }
    } finally {
      workspaceDb.close();
    }
  }

  async listPBIBatches(workspaceId: string): Promise<PBIBatchRecord[]> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      return workspaceDb.all<PBIBatchRecord>(`
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
    } finally {
      workspaceDb.close();
    }
  }

  async getPBIBatch(workspaceId: string, batchId: string): Promise<PBIBatchRecord> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const batch = workspaceDb.get<PBIBatchRecord>(`
        SELECT id, workspace_id as workspaceId, name, source_file_name as sourceFileName,
               source_row_count as sourceRowCount, source_path as sourcePath, source_format as sourceFormat,
               candidate_row_count as candidateRowCount, ignored_row_count as ignoredRowCount,
               malformed_row_count as malformedRowCount, duplicate_row_count as duplicateRowCount,
               scoped_row_count as scopedRowCount, scope_mode as scopeMode, scope_payload as scopePayload,
               imported_at as importedAtUtc, status
        FROM pbi_batches
        WHERE id = @batchId AND workspace_id = @workspaceId`,
        { batchId, workspaceId }
      );
      if (!batch) {
        throw new Error('PBI batch not found');
      }
      return batch;
    } finally {
      workspaceDb.close();
    }
  }

  async getPBIRecords(
    workspaceId: string,
    batchId: string,
    validationStatuses?: PBIValidationStatus[]
  ): Promise<PBIRecord[]> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const conditions = ['batch_id = @batchId'];
      const queryParams: Record<string, string | number | null> = { workspaceId, batchId };
      if (validationStatuses?.length) {
        const placeholders = validationStatuses.map((status, index) => `@validationStatus${index}`).join(', ');
        validationStatuses.forEach((status, index) => {
          queryParams[`validationStatus${index}`] = status;
        });
        conditions.push(`validation_status IN (${placeholders})`);
      }
      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      return workspaceDb.all<PBIRecord>(`
        SELECT id, batch_id as batchId, source_row_number as sourceRowNumber, external_id as externalId, title, description, priority,
               state, work_item_type as workItemType, title1, title2, title3, raw_description as rawDescription,
               raw_acceptance_criteria as rawAcceptanceCriteria, description_text as descriptionText,
               acceptance_criteria_text as acceptanceCriteriaText, parent_external_id as parentExternalId,
               parent_record_id as parentRecordId, validation_status as validationStatus, validation_reason as validationReason
        FROM pbi_records
        ${whereClause}
        ORDER BY source_row_number ASC`,
        queryParams
      );
    } finally {
      workspaceDb.close();
    }
  }

  async getPBIRecord(workspaceId: string, pbiId: string): Promise<PBIRecord | null> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const row = workspaceDb.get<PBIRecord>(
        `SELECT id, batch_id as batchId, source_row_number as sourceRowNumber, external_id as externalId, title,
                description, state, priority, work_item_type as workItemType, title1, title2, title3,
                raw_description as rawDescription, raw_acceptance_criteria as rawAcceptanceCriteria,
                description_text as descriptionText, acceptance_criteria_text as acceptanceCriteriaText,
                parent_external_id as parentExternalId, parent_record_id as parentRecordId,
                validation_status as validationStatus, validation_reason as validationReason
         FROM pbi_records
         WHERE id = @pbiId AND batch_id IN (SELECT id FROM pbi_batches WHERE workspace_id = @workspaceId)`,
        { pbiId, workspaceId }
      );
      return row ?? null;
    } finally {
      workspaceDb.close();
    }
  }

  async getPBISubset(
    workspaceId: string,
    batchId: string,
    sourceRowNumbers?: number[]
  ): Promise<PBIRecord[]> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      if (!sourceRowNumbers?.length) {
        return workspaceDb.all<PBIRecord>(
          `SELECT id, batch_id as batchId, source_row_number as sourceRowNumber, external_id as externalId, title,
                  description, state, priority, work_item_type as workItemType, title1, title2, title3,
                  raw_description as rawDescription, raw_acceptance_criteria as rawAcceptanceCriteria,
                  description_text as descriptionText, acceptance_criteria_text as acceptanceCriteriaText,
                  parent_external_id as parentExternalId, parent_record_id as parentRecordId,
                  validation_status as validationStatus, validation_reason as validationReason
           FROM pbi_records
           WHERE batch_id = @batchId`,
          { workspaceId, batchId }
        );
      }

      const uniqueRows = Array.from(new Set(sourceRowNumbers.filter(Number.isInteger)));
      const placeholders = uniqueRows.map((_, idx) => `@row${idx}`).join(',');
      const params = uniqueRows.reduce<Record<string, number | string>>((acc, row, idx) => {
        acc[`row${idx}`] = row;
        return acc;
      }, { workspaceId, batchId });
      return workspaceDb.all<PBIRecord>(
        `SELECT id, batch_id as batchId, source_row_number as sourceRowNumber, external_id as externalId, title,
                description, state, priority, work_item_type as workItemType, title1, title2, title3,
                raw_description as rawDescription, raw_acceptance_criteria as rawAcceptanceCriteria,
                description_text as descriptionText, acceptance_criteria_text as acceptanceCriteriaText,
                parent_external_id as parentExternalId, parent_record_id as parentRecordId,
                validation_status as validationStatus, validation_reason as validationReason
         FROM pbi_records
         WHERE batch_id = @batchId AND source_row_number IN (${placeholders})`,
        params as Record<string, unknown>
      );
    } finally {
      workspaceDb.close();
    }
  }

  async createAgentProposal(params: {
    workspaceId: string;
    batchId: string;
    action: ProposalAction;
    _sessionId?: string;
    localeVariantId?: string;
    note?: string;
    rationale?: string;
    relatedPbiIds?: string[];
    metadata?: unknown;
  }): Promise<{
    proposalId: string;
    workspaceId: string;
    batchId: string;
    action: ProposalAction;
    localeVariantId?: string;
    status: ProposalDecision;
  }> {
    const workspace = await this.getWorkspace(params.workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const proposalId = randomUUID();
      const now = new Date().toISOString();
      const rationale = params.rationale ?? params.note ?? (params.metadata ? JSON.stringify(params.metadata) : undefined);
      const status: ProposalDecision = ProposalDecision.DEFER;
      workspaceDb.run(
        `INSERT INTO proposals (
          id, workspace_id, batch_id, action, locale_variant_id, branch_id, status, rationale, generated_at, updated_at
        ) VALUES (
          @id, @workspaceId, @batchId, @action, @localeVariantId, @branchId, @status, @rationale, @generatedAt, @updatedAt
        )`,
        {
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
        }
      );

      if (params.relatedPbiIds?.length) {
        const uniquePbiIds = Array.from(new Set(params.relatedPbiIds.filter(Boolean)));
        for (const pbiId of uniquePbiIds) {
          workspaceDb.run(
            `INSERT OR IGNORE INTO proposal_pbi_links (proposal_id, pbi_id, relation)
             VALUES (@proposalId, @pbiId, @relation)`,
            {
              proposalId,
              pbiId,
              relation: 'primary'
            }
          );
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
    } finally {
      workspaceDb.close();
    }
  }

  async getBatchContext(workspaceId: string, batchId: string): Promise<{
    batch: PBIBatchRecord;
    candidateRows: PBIRecord[];
    malformedRows: PBIRecord[];
    duplicateRows: PBIRecord[];
    ignoredRows: PBIRecord[];
  } | null> {
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

  async setPBIBatchScope(
    workspaceId: string,
    batchId: string,
    scopeMode: PBIBatchScopeMode,
    selectedSourceRowNumbers: number[] = [],
    selectedExternalIds: string[] = []
  ): Promise<{ scopedRowCount: number; scopedSourceRows: number[] }> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const batchExists = workspaceDb.get<{ id: string }>(
        `SELECT id FROM pbi_batches WHERE id = @batchId AND workspace_id = @workspaceId`,
        { batchId, workspaceId }
      );
      if (!batchExists) {
        throw new Error('PBI batch not found');
      }

      const candidateRows = workspaceDb.all<{ sourceRowNumber: number; externalId: string }>(
        `SELECT source_row_number as sourceRowNumber, external_id as externalId
         FROM pbi_records
         WHERE batch_id = @batchId AND validation_status = @candidateStatus
         ORDER BY source_row_number ASC`,
        { batchId, candidateStatus: PBIValidationStatus.CANDIDATE }
      );

      const candidateSet = new Set<number>();
      const selectedByExternal = new Set(selectedExternalIds);
      const selectedRows = new Set(selectedSourceRowNumbers.map((row) => Number(row)));
      const scopedSet = new Set<number>();
      const selectedCandidateRows: number[] = [];

      for (const candidate of candidateRows) {
        candidateSet.add(candidate.sourceRowNumber);
        if (selectedByExternal.has(candidate.externalId) || selectedRows.has(candidate.sourceRowNumber)) {
          selectedCandidateRows.push(candidate.sourceRowNumber);
        }
      }

      if (scopeMode === PBIBatchScopeMode.SELECTED_ONLY) {
        selectedCandidateRows.forEach((row) => scopedSet.add(row));
      } else if (scopeMode === PBIBatchScopeMode.ALL_EXCEPT_SELECTED) {
        for (const row of candidateSet) {
          if (!selectedCandidateRows.includes(row)) {
            scopedSet.add(row);
          }
        }
      } else {
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
            candidateStatus: PBIValidationStatus.CANDIDATE
          });
        }
        workspaceDb.run(
          `UPDATE pbi_batches
           SET scope_mode = @scopeMode,
               scope_payload = @scopePayload,
               scoped_row_count = @scopedCount,
               status = @scopedStatus
           WHERE id = @batchId AND workspace_id = @workspaceId`,
          {
            scopeMode,
            scopePayload: JSON.stringify({
              selectedSourceRowNumbers: scopedRows,
              selectedExternalIds
            }),
            scopedCount: scopedRows.length,
            scopedStatus: PBIBatchStatus.SCOPED,
            batchId,
            workspaceId
          }
        );
        workspaceDb.exec('COMMIT');
      } catch (error) {
        workspaceDb.exec('ROLLBACK');
        throw error;
      }

      return {
        scopedRowCount: scopedRows.length,
        scopedSourceRows: scopedRows
      };
    } finally {
      workspaceDb.close();
    }
  }

  async setPBIBatchStatus(
    workspaceId: string,
    batchId: string,
    nextStatus: PBIBatchStatus,
    force = false
  ): Promise<PBIBatchRecord> {
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
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      workspaceDb.run(
        `UPDATE pbi_batches
         SET status = @status
         WHERE id = @batchId AND workspace_id = @workspaceId`,
        {
          status: nextStatus,
          batchId,
          workspaceId
        }
      );
      return { ...batch, status: nextStatus };
    } finally {
      workspaceDb.close();
    }
  }

  private isPBIBatchStatusTransitionAllowed(
    currentStatus: PBIBatchStatus | 'proposed',
    nextStatus: PBIBatchStatus,
    force: boolean
  ): boolean {
    if (currentStatus === nextStatus) {
      return true;
    }
    if (force) {
      return true;
    }

    const currentIndex = PBIBATCH_STATUS_SEQUENCE.indexOf(currentStatus as PBIBatchStatus);
    const nextIndex = PBIBATCH_STATUS_SEQUENCE.indexOf(nextStatus);
    if (currentIndex < 0 || nextIndex < 0) {
      return false;
    }
    return nextIndex === currentIndex + 1;
  }

  async linkPBIRecordParents(workspaceId: string, batchId: string): Promise<void> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const rows = workspaceDb.all<{ id: string; sourceRowNumber: number; parentExternalId: string | null }>(
        `SELECT id, source_row_number as sourceRowNumber, parent_external_id as parentExternalId
         FROM pbi_records
         WHERE batch_id = @batchId AND parent_external_id IS NOT NULL`,
        { batchId }
      );
      const index = workspaceDb.all<{ externalId: string; id: string; sourceRowNumber: number }>(`
        SELECT external_id as externalId, id, source_row_number as sourceRowNumber
        FROM pbi_records
        WHERE batch_id = @batchId
      `, { batchId });

      const parentByExternal = new Map<string, string>();
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
      } catch (error) {
        workspaceDb.exec('ROLLBACK');
        throw error;
      }
    } finally {
      workspaceDb.close();
    }
  }

  async getHistory(workspaceId: string, localeVariantId: string): Promise<RevisionHistoryResponse> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const rows = workspaceDb.all<RevisionRecord>(
        `SELECT * FROM revisions WHERE locale_variant_id = @id ORDER BY revision_number DESC`,
        { id: localeVariantId }
      );
      return { workspaceId, localeVariantId, revisions: rows };
    } finally {
      workspaceDb.close();
    }
  }

  async getArticleDetail(
    workspaceId: string,
    payload: ArticleDetailRequest
  ): Promise<ArticleDetailResponse> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const targetRevision = payload.revisionId
        ? workspaceDb.get<RevisionRecord>(
            `SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                    workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                    revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
             FROM revisions WHERE id = @revisionId AND workspace_id = @workspaceId`,
            { revisionId: payload.revisionId, workspaceId }
          )
        : null;

      let variantRow: { id: string; familyId: string; locale: string; status: RevisionState } | null = null;
      let revision: RevisionRecord | null = null;

      if (targetRevision) {
        revision = targetRevision;
        variantRow = workspaceDb.get<{
          id: string;
          familyId: string;
          locale: string;
          status: RevisionState;
        }>(`SELECT id, family_id as familyId, locale, status FROM locale_variants WHERE id = @localeVariantId`, {
          localeVariantId: targetRevision.localeVariantId
        }) ?? null;
      } else if (payload.localeVariantId) {
        revision = workspaceDb.get<RevisionRecord>(`
          SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                 workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                 revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
          FROM revisions
          WHERE locale_variant_id = @localeVariantId
            AND revision_type = @revisionType
          ORDER BY revision_number DESC LIMIT 1`,
          {
            localeVariantId: payload.localeVariantId,
            revisionType: payload.preferRevisionType ?? RevisionState.LIVE
          }
        ) ?? workspaceDb.get<RevisionRecord>(`
          SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                 workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                 revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
          FROM revisions
          WHERE locale_variant_id = @localeVariantId
          ORDER BY revision_number DESC LIMIT 1`,
          { localeVariantId: payload.localeVariantId }
        ) ?? null;
        variantRow = workspaceDb.get<{
          id: string;
          familyId: string;
          locale: string;
          status: RevisionState;
        }>(`SELECT id, family_id as familyId, locale, status FROM locale_variants WHERE id = @id`, {
          id: payload.localeVariantId
        }) ?? null;
      }

      if (!revision || !variantRow) {
        throw new Error('Revision or locale variant not found');
      }

      const family = workspaceDb.get<{
        id: string;
        title: string;
        external_key: string;
        retired_at: string | null;
        
      }>(`
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
        : workspaceDb.all<LineageRecord>(`
            SELECT id,
                   locale_variant_id as localeVariantId,
                   predecessor_revision_id as predecessorRevisionId,
                   successor_revision_id as successorRevisionId,
                   created_by as createdBy,
                   created_at as createdAtUtc
            FROM article_lineage
            WHERE locale_variant_id = @localeVariantId
            ORDER BY created_at DESC`,
          { localeVariantId: variantRow.id }
        );

      const relatedPbis = payload.includeLineage === false
        ? []
        : workspaceDb.all<PBIRecord>(`
            SELECT DISTINCT p.id, p.batch_id as batchId, p.source_row_number as sourceRowNumber,
                   p.external_id as externalId, p.title, p.description, p.priority
            FROM pbi_records p
            JOIN proposal_pbi_links l ON l.pbi_id = p.id
            JOIN proposals r ON r.id = l.proposal_id
            WHERE r.locale_variant_id = @localeVariantId`,
          { localeVariantId: variantRow.id }
        );

      const publishLog = payload.includePublishLog === false
        ? []
        : workspaceDb.all<{
            id: string;
            revision_id: string;
            zendesk_article_id: string | null;
            result: string | null;
            published_at: string;
          }>(
            `SELECT id, revision_id, zendesk_article_id, result, published_at
             FROM publish_records
             WHERE revision_id = @revisionId
             ORDER BY published_at DESC`,
            { revisionId: revision.id }
          );

      return {
        workspaceId,
        familyId: family.id,
        familyTitle: family.title,
        externalKey: family.external_key,
        familyStatus: family.retired_at ? RevisionState.RETIRED : revision.revisionType,
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
    } finally {
      workspaceDb.close();
    }
  }

  async getRepositoryStructure(workspaceId: string): Promise<RepositoryStructurePayload> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    return {
      workspaceId,
      rootPath: workspace.path,
      dbPath: path.join(workspace.path, '.meta', DEFAULT_DB_FILE),
      storage: {
        root: workspace.path,
        articles: path.join(workspace.path, 'articles'),
        drafts: path.join(workspace.path, 'drafts'),
        revisions: path.join(workspace.path, 'revisions'),
        imports: path.join(workspace.path, 'imports'),
        proposals: path.join(workspace.path, 'proposals'),
        runs: path.join(workspace.path, 'runs'),
        assets: path.join(workspace.path, 'assets'),
        cache: path.join(workspace.path, 'cache'),
        searchIndex: path.join(workspace.path, 'search-index')
      }
    };
  }

  async workspaceRoutePayload(id: string): Promise<WorkspaceRoutePayload> {
    const workspace = await this.getWorkspace(id);
    await this.ensureWorkspaceDb(workspace.path);
    return {
      workspaceId: id,
      workspaceRoot: this.workspaceRoot,
      workspacePath: workspace.path,
      dbPath: path.join(workspace.path, '.meta', DEFAULT_DB_FILE)
    };
  }

  async getZendeskCredentials(workspaceId: string): Promise<ZendeskCredentialRecord | null> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const row = workspaceDb.get<{ email: string; has_token: number }>(
        `SELECT email, CASE WHEN encrypted_api_token IS NOT NULL AND encrypted_api_token != '' THEN 1 ELSE 0 END AS has_token
         FROM zendesk_credentials WHERE workspace_id = @workspaceId`,
        { workspaceId }
      );
      if (!row) {
        return null;
      }
      return {
        workspaceId,
        email: row.email,
        hasApiToken: Boolean(row.has_token)
      };
    } finally {
      workspaceDb.close();
    }
  }

  async getZendeskCredentialsForSync(workspaceId: string): Promise<{ workspaceId: string; email: string; apiToken: string } | null> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const row = workspaceDb.get<{ email: string; encrypted_api_token: string }>(
        `SELECT email, encrypted_api_token FROM zendesk_credentials WHERE workspace_id = @workspaceId`,
        { workspaceId }
      );
      if (!row || !row.encrypted_api_token) {
        return null;
      }
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Encrypted credential storage is unavailable');
      }
      return {
        workspaceId,
        email: row.email,
        apiToken: safeStorage.decryptString(Buffer.from(row.encrypted_api_token, 'base64'))
      };
    } finally {
      workspaceDb.close();
    }
  }

  async saveZendeskCredentials(workspaceId: string, email: string, apiToken: string): Promise<ZendeskCredentialRecord> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Encrypted credential storage is unavailable');
      }
      const normalizedEmail = email.trim().toLowerCase();
      const token = apiToken.trim();
      const encryptedApiToken = safeStorage.encryptString(token).toString('base64');
      workspaceDb.run(
        `INSERT OR REPLACE INTO zendesk_credentials (workspace_id, email, encrypted_api_token, updated_at)
         VALUES (@workspaceId, @email, @token, @updatedAt)`,
        {
          workspaceId,
          email: normalizedEmail,
          token: encryptedApiToken,
          updatedAt: new Date().toISOString()
        }
      );
      return {
        workspaceId,
        email: normalizedEmail,
        hasApiToken: true
      };
    } finally {
      workspaceDb.close();
    }
  }

  async getSyncCheckpoint(workspaceId: string, locale: string): Promise<ZendeskSyncCheckpoint | null> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const row = workspaceDb.get<{
        locale: string;
        last_synced_at: string | null;
        cursor: string | null;
        synced_articles: number;
        updated_at: string;
      }>(
        `SELECT locale, last_synced_at, cursor, synced_articles, updated_at
         FROM zendesk_sync_checkpoints
         WHERE workspace_id = @workspaceId AND locale = @locale`,
        { workspaceId, locale }
      );
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
    } finally {
      workspaceDb.close();
    }
  }

  async upsertSyncCheckpoint(
    workspaceId: string,
    locale: string,
    syncedArticles: number,
    lastSyncedAt?: string,
    cursor?: string
  ): Promise<void> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      workspaceDb.run(
        `INSERT INTO zendesk_sync_checkpoints (workspace_id, locale, last_synced_at, cursor, synced_articles, updated_at)
         VALUES (@workspaceId, @locale, @lastSyncedAt, @cursor, @syncedArticles, @updatedAt)
         ON CONFLICT(workspace_id, locale) DO UPDATE SET
           last_synced_at = excluded.last_synced_at,
           cursor = excluded.cursor,
           synced_articles = excluded.synced_articles,
           updated_at = excluded.updated_at`,
        {
          workspaceId,
          locale,
          lastSyncedAt: lastSyncedAt ?? null,
          cursor: cursor ?? null,
          syncedArticles,
          updatedAt: new Date().toISOString()
        }
      );
    } finally {
      workspaceDb.close();
    }
  }

  async logSyncRunStart(workspaceId: string, runId: string, mode: string): Promise<void> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const now = new Date().toISOString();
      workspaceDb.run(
        `INSERT INTO zendesk_sync_runs (
          id, workspace_id, mode, state, started_at, updated_at
        ) VALUES (
          @id, @workspaceId, @mode, 'RUNNING', @startedAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          mode = excluded.mode,
          state = excluded.state,
          started_at = excluded.started_at,
          updated_at = excluded.updated_at`,
        {
          id: runId,
          workspaceId,
          mode,
          startedAt: now,
          updatedAt: now
        }
      );
    } finally {
      workspaceDb.close();
    }
  }

  async logSyncRunComplete(
    workspaceId: string,
    runId: string,
    state: string,
    syncedArticles: number,
    skippedArticles: number,
    createdFamilies: number,
    createdVariants: number,
    createdRevisions: number,
    remoteError?: string,
    cursorSummary?: string
  ): Promise<void> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      workspaceDb.run(
        `UPDATE zendesk_sync_runs SET
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
         WHERE id = @runId AND workspace_id = @workspaceId`,
        {
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
        }
      );
    } finally {
      workspaceDb.close();
    }
  }

  async getLatestSyncRun(workspaceId: string): Promise<{
    id: string;
    mode: string;
    state: string;
    startedAtUtc: string;
    endedAtUtc?: string;
    syncedArticles: number;
    skippedArticles: number;
    createdFamilies: number;
    createdVariants: number;
    createdRevisions: number;
    cursorSummary?: Record<string, string>;
    remoteError?: string;
  } | null> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const row = workspaceDb.get<{
        id: string;
        mode: string;
        state: string;
        started_at: string;
        ended_at: string | null;
        synced_articles: number;
        skipped_articles: number;
        created_families: number;
        created_variants: number;
        created_revisions: number;
        cursor_summary: string | null;
        remote_error: string | null;
      }>(
        `SELECT id, mode, state, started_at, ended_at, synced_articles, skipped_articles,
                created_families, created_variants, created_revisions, cursor_summary, remote_error
         FROM zendesk_sync_runs
         WHERE workspace_id = @workspaceId
         ORDER BY started_at DESC
         LIMIT 1`,
        { workspaceId }
      );

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
            const parsed = JSON.parse(row.cursor_summary) as Record<string, string>;
            return parsed;
          } catch {
            return undefined;
          }
        })(),
        remoteError: row.remote_error ?? undefined
      };
    } finally {
      workspaceDb.close();
    }
  }

  async getArticleFamilyByExternalKey(workspaceId: string, externalKey: string): Promise<ArticleFamilyRecord | null> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const row = workspaceDb.get<ArticleFamilyRecord>(
        `SELECT id, workspace_id as workspaceId, external_key as externalKey, title, section_id as sectionId, category_id as categoryId, retired_at as retiredAtUtc
         FROM article_families WHERE workspace_id = @workspaceId AND external_key = @externalKey`,
        { workspaceId, externalKey }
      );
      return row ?? null;
    } finally {
      workspaceDb.close();
    }
  }

  async getLocaleVariantByFamilyAndLocale(workspaceId: string, familyId: string, locale: string): Promise<LocaleVariantRecord | null> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const row = workspaceDb.get<LocaleVariantRecord>(
        `SELECT id, family_id as familyId, locale, status, retired_at as retiredAtUtc
         FROM locale_variants
         WHERE family_id = @familyId AND locale = @locale`,
        { familyId, locale, workspaceId }
      );
      return row ?? null;
    } finally {
      workspaceDb.close();
    }
  }

  async getLatestRevision(workspaceId: string, localeVariantId: string, revisionType?: RevisionState): Promise<RevisionRecord | null> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const row = workspaceDb.get<RevisionRecord>(`SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
         FROM revisions
         WHERE locale_variant_id = @localeVariantId
         ${revisionType ? 'AND revision_type = @revisionType' : ''}
         ORDER BY revision_number DESC LIMIT 1`,
        { localeVariantId, revisionType, workspaceId }
      );
      return row ?? null;
    } finally {
      workspaceDb.close();
    }
  }

  async markDraftBranchesAsObsolete(workspaceId: string, localeVariantId: string): Promise<void> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      workspaceDb.run(
        `UPDATE draft_branches
         SET state = 'obsolete', updated_at = @updatedAt
         WHERE workspace_id = @workspaceId AND locale_variant_id = @localeVariantId AND state != 'obsolete'`,
        {
          workspaceId,
          localeVariantId,
          updatedAt: new Date().toISOString()
        }
      );
    } finally {
      workspaceDb.close();
    }
  }

  async getMigrationHealth(workspaceId?: string): Promise<WorkspaceMigrationHealthReport> {
    const catalog = await this.openCatalogWithRecovery();
    try {
      const catalogVersion = getCatalogMigrationVersion(this.catalogDbPath);
      const rows = workspaceId
        ? catalog.all<CatalogWorkspaceRow>(`SELECT * FROM workspaces WHERE id = @id`, { id: workspaceId })
        : catalog.all<CatalogWorkspaceRow>(`SELECT * FROM workspaces`);

      if (workspaceId && rows.length === 0) {
        throw new Error('Workspace not found');
      }

      const workspaces: WorkspaceMigrationHealth[] = [];
      for (const row of rows) {
        const dbPath = path.join(row.path, '.meta', DEFAULT_DB_FILE);
        const existedBeforeCheck = await this.fileExists(dbPath);
        let repaired = false;
        let workspaceDbVersion = 0;

        if (existedBeforeCheck) {
          try {
            workspaceDbVersion = getWorkspaceMigrationVersion(dbPath);
          } catch {
            const repairedResult = this.repairWorkspaceDb(dbPath);
            workspaceDbVersion = repairedResult.appliedVersion;
            repaired = true;
          }
        } else {
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
    } finally {
      catalog.close();
    }
  }

  private async openCatalogWithRecovery() {
    const startedAt = Date.now();
    if (this.lastCatalogFailureMs && Date.now() - this.lastCatalogFailureMs < 1500) {
      logger.warn('workspace-repository.openCatalogWithRecovery skipped', {
        elapsedMs: Date.now() - startedAt,
        catalogFailureMessage: this.lastCatalogFailureMessage
      });
      throw new Error(this.lastCatalogFailureMessage ?? 'Maximum call stack size exceeded');
    }
    try {
      const catalogExists = await fs.access(this.catalogDbPath).then(() => true).catch(() => false);
      logger.info('workspace-repository.openCatalogWithRecovery start', {
        catalogDbPath: this.catalogDbPath,
        catalogExists
      });
      const catalog = ensureCatalogSchema(this.catalogDbPath);
      this.ensureCatalogDefaultWorkspaceColumn(catalog);
      logger.info('workspace-repository.openCatalogWithRecovery success', { elapsedMs: Date.now() - startedAt });
      this.lastCatalogFailureMs = 0;
      this.lastCatalogFailureMessage = undefined;
      return catalog;
    } catch (error) {
      console.error('[catalog-init] ensureCatalogSchema failed', {
        catalogDbPath: this.catalogDbPath,
        errorName: (error as { name?: string })?.name,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorDetails: inspect(error, { depth: 3, compact: false })
      });
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.lastCatalogFailureMs = Date.now();
      this.lastCatalogFailureMessage = errorMessage;
      logger.warn('workspace-repository.openCatalogWithRecovery repair', {
        elapsedMs: Date.now() - startedAt,
        catalogDbPath: this.catalogDbPath
      });
      try {
        await fs.rm(this.catalogDbPath, { force: true });
        const catalog = ensureCatalogSchema(this.catalogDbPath);
        this.ensureCatalogDefaultWorkspaceColumn(catalog);
        logger.info('workspace-repository.openCatalogWithRecovery repaired', { elapsedMs: Date.now() - startedAt });
        this.lastCatalogFailureMs = 0;
        this.lastCatalogFailureMessage = undefined;
        return catalog;
      } catch (repairError) {
        console.error('[catalog-init] ensureCatalogSchema repair failed', {
          catalogDbPath: this.catalogDbPath,
          repairErrorName: (repairError as { name?: string })?.name,
          repairErrorMessage: repairError instanceof Error ? repairError.message : String(repairError),
          repairErrorStack: repairError instanceof Error ? repairError.stack : undefined,
          repairErrorDetails: inspect(repairError, { depth: 3, compact: false })
        });
        logger.error('workspace-repository.openCatalogWithRecovery repair failed', {
          elapsedMs: Date.now() - startedAt,
          message: repairError instanceof Error ? repairError.message : String(repairError),
          stack: repairError instanceof Error ? repairError.stack : undefined
        });
        throw repairError;
      }
    }
  }

  private repairWorkspaceDb(dbPath: string) {
    return applyWorkspaceMigrations(dbPath);
  }

  private ensureCatalogDefaultWorkspaceColumn(catalog: ReturnType<typeof openWorkspaceDatabase>) {
    const columns = catalog.all<{ name: string }>(`PRAGMA table_info(workspaces)`).map((column) => column.name);
    if (!columns.includes('is_default')) {
      catalog.exec('ALTER TABLE workspaces ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0');
    }

    const row = catalog.get<{ id: string }>(`
      SELECT id FROM workspaces
      WHERE is_default = 1
      ORDER BY (last_opened_at IS NULL) ASC, last_opened_at DESC, created_at DESC
      LIMIT 1
    `);
    if (row) {
      const defaultCount = catalog.get<{ total: number }>(`SELECT COUNT(*) AS total FROM workspaces WHERE is_default = 1`);
      if ((defaultCount?.total ?? 0) !== 1) {
        catalog.run(`
          UPDATE workspaces
          SET is_default = CASE
            WHEN id = @defaultId THEN 1
            ELSE 0
          END`,
          { defaultId: row.id }
        );
      }
      return;
    }

    const fallback = catalog.get<{ id: string }>(`
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
        END`,
        { defaultId: fallback.id }
      );
    }
  }

  private openWorkspaceDbWithRecovery(dbPath: string) {
    try {
      return openWorkspaceDatabase(dbPath);
    } catch {
      console.error('[workspace-db] openWorkspaceDbWithRecovery failed, attempting repair', {
        workspaceDbPath: dbPath
      });
      this.repairWorkspaceDb(dbPath);
      return openWorkspaceDatabase(dbPath);
    }
  }

  private async ensureWorkspaceDb(workspacePath: string) {
    const dbPath = path.join(workspacePath, '.meta', DEFAULT_DB_FILE);
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    this.repairWorkspaceDb(dbPath);
    return dbPath;
  }

  private async prepareWorkspaceFilesystem(workspacePath: string) {
    const dirs = [
      workspacePath,
      path.join(workspacePath, '.meta'),
      path.join(workspacePath, 'articles'),
      path.join(workspacePath, 'revisions'),
      path.join(workspacePath, 'drafts'),
      path.join(workspacePath, 'runs'),
      path.join(workspacePath, 'assets'),
      path.join(workspacePath, 'imports'),
      path.join(workspacePath, 'proposals'),
      path.join(workspacePath, 'search-index'),
      path.join(workspacePath, 'cache')
    ];
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  private async fileExists(filePath: string) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async readRevisionSource(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return '';
    }
  }
}

function normalizeSearchScope(scope: SearchContext['scope'] | undefined): SearchContext['scope'] {
  if (scope === 'live' || scope === 'drafts' || scope === 'retired' || scope === 'conflicted' || scope === 'all') {
    return scope;
  }
  return 'all';
}

function variantToDraftCount(map: Map<string, number>, localeVariantId: string): number {
  return map.get(localeVariantId) ?? 0;
}

function passSearchScope(
  status: { status: RevisionState; hasConflicts: boolean },
  scope: SearchContext['scope'],
  draftCount: number,
  hasDrafts?: boolean,
  includeConflicts?: boolean,
  changedWithinHours?: number,
  updatedAt?: string | null
): boolean {
  if (scope === 'live' && status.status !== RevisionState.LIVE) {
    return false;
  }
  if (scope === 'retired' && status.status !== RevisionState.RETIRED) {
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

function resolveRevisionPath(workspacePath: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(workspacePath, filePath);
}

function buildSearchSnippet(value: string): string {
  const text = stripHtml(value);
  if (text.length <= 160) {
    return text;
  }
  return `${text.slice(0, 157)}...`;
}

function findTextMatch(source: string, query: string): SearchSourceMatch | null {
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

function sanitizePreviewHtml(html: string): string {
  return stripHtml(html).slice(0, 400);
}

function extractImagePlaceholders(source: string): PlaceholderToken[] {
  const placeholders: PlaceholderToken[] = [];
  const tokens = new Set<string>();
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

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

type LatestRevisionForMap = Pick<
  RevisionRecord,
  'id' | 'localeVariantId' | 'revisionNumber' | 'revisionType' | 'updatedAtUtc' | 'filePath'
>;

function getLatestRevisions(revisions: LatestRevisionForMap[]): Map<string, RevisionLatestRecord> {
  const latest = new Map<string, RevisionLatestRecord>();
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

function mapWorkspaceRow(row: CatalogWorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    createdAtUtc: row.created_at,
    updatedAtUtc: row.updated_at,
    lastOpenedAtUtc: row.last_opened_at ?? undefined,
    zendeskConnectionId: row.id,
    defaultLocale: row.default_locale,
    enabledLocales: safeParseLocales(row.enabled_locales),
    state: row.state as WorkspaceState,
    isDefaultWorkspace: Boolean(row.is_default),
    path: row.path
  };
}

function buildWorkspaceItemFromCatalog(row: CatalogWorkspaceRow, articleCount: number, draftCount: number): WorkspaceListItem {
  return {
    ...mapWorkspaceRow(row),
    articleCount,
    draftCount
  };
}

function workspacePath(inputPath: string | undefined, root: string, name: string): string {
  return path.resolve(inputPath ?? path.join(root, sanitizeName(name)));
}

function normalizeLocales(locales?: string[]) {
  return locales && locales.length > 0 ? locales : ['en-us'];
}

function safeParseLocales(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed;
    }
  } catch {
    // noop
  }
  return ['en-us'];
}

function sanitizeName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '') || randomUUID();
}
