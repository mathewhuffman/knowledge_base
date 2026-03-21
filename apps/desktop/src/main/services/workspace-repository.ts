import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspect } from 'node:util';
import {
  type WorkspaceCreateRequest,
  type WorkspaceSettingsRecord,
  type WorkspaceSettingsUpdateRequest,
  type WorkspaceListItem,
  type WorkspaceRecord,
  WorkspaceState,
  type RepositoryStructurePayload,
  RevisionState,
  type SearchPayload,
  type SearchResponse,
  type SearchResult,
  type RevisionHistoryResponse,
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
  type ExplorerNode
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

interface RevisionLatestRecord {
  revision_id: string;
  locale_variant_id: string;
  revision_number: number;
  revision_type: RevisionState;
  updated_at: string;
}

interface ExplorerFamilyRow extends ArticleFamilyRecord {
  retired_at?: string;
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
        SELECT id, name, path, created_at, updated_at, last_opened_at, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, state
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
      await this.prepareWorkspaceFilesystem(resolvedPath);
      await this.ensureWorkspaceDb(resolvedPath);

      const workspaceRecord: WorkspaceRecord = {
        id,
        name: payload.name,
        createdAtUtc: now,
        updatedAtUtc: now,
        lastOpenedAtUtc: now,
        zendeskConnectionId: id,
        defaultLocale: payload.defaultLocale,
        enabledLocales,
        state: WorkspaceState.ACTIVE,
        path: resolvedPath
      };

      catalog.run(
        `INSERT INTO workspaces (
          id, name, path, created_at, updated_at, last_opened_at, zendesk_subdomain,
          zendesk_brand_id, default_locale, enabled_locales, state
        ) VALUES (
          @id, @name, @path, @createdAt, @updatedAt, @lastOpenedAt, @subdomain,
          @brand, @defaultLocale, @enabledLocales, @state
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
          state: WorkspaceState.ACTIVE
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
        SELECT id, name, path, created_at, updated_at, last_opened_at, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, state
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
        SELECT id, name, path, created_at, updated_at, last_opened_at, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, state
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
      const variants = workspaceDb.all<LocaleVariantRecord>(`SELECT * FROM locale_variants`);
      const revisions = workspaceDb.all<RevisionRecord>(`SELECT * FROM revisions`);
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
              revision: {
                revisionId: latest?.revision_id ?? '',
                revisionNumber: latest?.revision_number ?? 0,
                state: latest?.revision_type ?? RevisionState.LIVE,
                updatedAtUtc: latest?.updated_at ?? new Date().toISOString(),
                draftCount: branchCounts.get(variant.id) ?? 0
              },
              hasConflicts: false
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
      const families = workspaceDb.all<{ id: string; title: string }>(
        `SELECT id, title FROM article_families WHERE lower(title) LIKE '%' || @q || '%'`,
        { q: query }
      );
      const results: SearchResult[] = [];

      for (const family of families) {
        const variants = workspaceDb.all<{ id: string; locale: string }>(
          `SELECT id, locale FROM locale_variants WHERE family_id = @id`,
          { id: family.id }
        );
        for (const variant of variants) {
          if (payload.locales?.length && !payload.locales.includes(variant.locale)) {
            continue;
          }

          const revision = workspaceDb.get<{ id: string }>(
            `SELECT id FROM revisions WHERE locale_variant_id = @id ORDER BY revision_number DESC LIMIT 1`,
            { id: variant.id }
          );
          if (!revision) {
            continue;
          }

          results.push({
            revisionId: revision.id,
            familyId: family.id,
            locale: variant.locale,
            title: family.title,
            snippet: `${family.title} · ${payload.query}`,
            score: 1
          });
        }
      }

      return { workspaceId, total: results.length, results };
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
}

function getLatestRevisions(revisions: RevisionRecord[]): Map<string, RevisionLatestRecord> {
  const latest = new Map<string, RevisionLatestRecord>();
  revisions.forEach((revision) => {
    const current = latest.get(revision.localeVariantId);
    if (!current || revision.revisionNumber > current.revision_number) {
      latest.set(revision.localeVariantId, {
        revision_id: revision.id,
        locale_variant_id: revision.localeVariantId,
        revision_number: revision.revisionNumber,
        revision_type: revision.revisionType,
        updated_at: revision.updatedAtUtc
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
