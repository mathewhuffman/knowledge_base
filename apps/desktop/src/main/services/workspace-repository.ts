import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspect } from 'node:util';
import { safeStorage } from 'electron';
import {
  PBIBatchStatus,
  PBIBatchScopeMode,
  ProposalAction,
  ProposalDecision,
  ProposalReviewDecision,
  ProposalReviewStatus,
  type WorkspaceCreateRequest,
  type WorkspaceSettingsRecord,
  type WorkspaceSettingsUpdateRequest,
  type WorkspaceListItem,
  type WorkspaceRecord,
  WorkspaceState,
  type RepositoryStructurePayload,
  RevisionState,
  RevisionStatus,
  PBIValidationStatus,
  PBIImportFormat,
  type SearchPayload,
  type SearchResponse,
  type SearchResult,
  type RevisionHistoryResponse,
  type ArticleDetailRequest,
  type ArticleDetailResponse,
  type ArticleRelationDeleteRequest,
  ArticleRelationDirection,
  type ArticleRelationEvidence,
  ArticleRelationEvidenceType,
  type ArticleRelationRecord,
  type ArticleRelationRefreshRun,
  type ArticleRelationRefreshStatusResponse,
  type ArticleRelationRefreshSummary,
  type ArticleRelationSummary,
  type ArticleRelationsListRequest,
  type ArticleRelationsListResponse,
  ArticleRelationOrigin,
  ArticleRelationStatus,
  ArticleRelationType,
  type ArticleRelationUpsertRequest,
  type KbAccessMode,
  type AgentToolCallAudit,
  type PersistedAgentAnalysisRun,
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
  type ZendeskSyncCheckpoint,
  type ProposalPlacementSuggestion,
  type ProposalReviewDecisionRequest,
  type ProposalReviewBatchListResponse,
  type ProposalReviewBatchSummary,
  type ProposalReviewDecisionResponse,
  type ProposalReviewDetailResponse,
  type ProposalReviewGroup,
  type ProposalReviewListResponse,
  type ProposalReviewQueueItem,
  type ProposalReviewRecord,
  type ProposalReviewSummaryCounts,
  DraftBranchStatus,
  DraftCommitSource,
  DraftValidationCode,
  DraftValidationSeverity,
  type DraftAutosaveStatePayload,
  type DraftBranchCreateRequest,
  type DraftBranchDiscardRequest,
  type DraftBranchGetResponse,
  type DraftBranchHistoryEntry,
  type DraftBranchHistoryStepRequest,
  type DraftBranchListRequest,
  type DraftBranchListResponse,
  type DraftBranchSaveRequest,
  type DraftBranchSaveResponse,
  type DraftBranchStatusUpdateRequest,
  type DraftBranchSummary,
  type DraftBranchSummaryCounts,
  type DraftComparePayload,
  type DraftEditorPayload,
  type DraftValidationSummary,
  type DraftValidationWarning,
  ArticleAiMessageKind,
  ArticleAiMessageRole,
  ArticleAiPresetAction,
  ArticleAiSessionStatus,
  TemplatePackType,
  type ArticleAiChatMessage,
  type ArticleAiDecisionRequest,
  type ArticleAiDecisionResponse,
  type ArticleAiPendingEdit,
  type ArticleAiResetRequest,
  type ArticleAiSessionGetRequest,
  type ArticleAiSessionRecord,
  type ArticleAiSessionResponse,
  type ArticleAiSubmitRequest,
  type ArticleAiSubmitResponse,
  type TemplatePackAnalysis,
  type TemplatePackDeleteRequest,
  type TemplatePackDetail,
  type TemplatePackGetRequest,
  type TemplatePackListRequest,
  type TemplatePackListResponse,
  type TemplatePackSummary,
  type TemplatePackUpsertRequest
} from '@kb-vault/shared-types';
import { diffHtml } from '@kb-vault/diff-engine';
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
const DEFAULT_KB_ACCESS_MODE: KbAccessMode = 'mcp';
const CATALOG_DB_PATH = path.join('.meta', 'catalog.sqlite');
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
  'article_relation_overrides'
] as const;
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

interface ProposalDbRow {
  id: string;
  workspaceId: string;
  batchId: string;
  action: ProposalAction;
  localeVariantId: string | null;
  branchId: string | null;
  status: string | null;
  rationale: string | null;
  generatedAtUtc: string;
  updatedAtUtc: string;
  reviewStatus: string | null;
  queueOrder: number | null;
  familyId: string | null;
  sourceRevisionId: string | null;
  targetTitle: string | null;
  targetLocale: string | null;
  confidenceScore: number | null;
  rationaleSummary: string | null;
  aiNotes: string | null;
  suggestedPlacementJson: string | null;
  sourceHtmlPath: string | null;
  proposedHtmlPath: string | null;
  metadataJson: string | null;
  decisionPayloadJson: string | null;
  decidedAtUtc: string | null;
  sessionId: string | null;
}

interface ProposalDecisionMutationResult {
  reviewStatus?: ProposalReviewStatus;
  legacyStatus?: ProposalDecision;
  branchId?: string;
  revisionId?: string;
  familyId?: string;
  localeVariantId?: string;
  retiredAtUtc?: string;
}

interface DraftBranchDbRow {
  id: string;
  workspaceId: string;
  localeVariantId: string;
  name: string;
  baseRevisionId: string;
  state: string;
  headRevisionId: string | null;
  autosaveEnabled: number | null;
  lastAutosavedAtUtc: string | null;
  lastManualSavedAtUtc: string | null;
  changeSummary: string | null;
  editorStateJson: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  retiredAtUtc: string | null;
}

interface DraftRevisionCommitRow {
  revisionId: string;
  branchId: string;
  workspaceId: string;
  commitKind: string;
  commitMessage: string | null;
  createdAtUtc: string;
}

interface ArticleAiSessionDbRow {
  id: string;
  workspaceId: string;
  localeVariantId: string;
  branchId: string | null;
  targetType: 'live_article' | 'draft_branch';
  currentRevisionId: string;
  currentHtml: string;
  pendingHtml: string | null;
  pendingSummary: string | null;
  pendingRationale: string | null;
  pendingMetadataJson: string | null;
  templatePackId: string | null;
  runtimeSessionId: string | null;
  status: string;
  createdAtUtc: string;
  updatedAtUtc: string;
}

interface ArticleAiMessageDbRow {
  id: string;
  sessionId: string;
  workspaceId: string;
  role: string;
  messageKind: string;
  presetAction: string | null;
  content: string;
  metadataJson: string | null;
  createdAtUtc: string;
}

interface ArticleRelationDbRow {
  id: string;
  workspaceId: string;
  leftFamilyId: string;
  rightFamilyId: string;
  relationType: ArticleRelationType;
  direction: ArticleRelationDirection;
  strengthScore: number;
  status: ArticleRelationStatus;
  origin: ArticleRelationOrigin;
  runId: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  leftTitle: string;
  leftExternalKey: string | null;
  rightTitle: string;
  rightExternalKey: string | null;
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
          kb_access_mode: string | null;
        }>(
          `SELECT workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales
            , kb_access_mode
           FROM workspace_settings WHERE workspace_id = @workspaceId`,
          { workspaceId: id }
        );

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
        workspaceDb.run(
          `INSERT INTO workspace_settings (
            workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, kb_access_mode, updated_at
          ) VALUES (
            @workspaceId, @zendeskSubdomain, @zendeskBrandId, @defaultLocale, @enabledLocales, @kbAccessMode, @updatedAt
          )`,
          {
            workspaceId: id,
            zendeskSubdomain: row.zendesk_subdomain,
            zendeskBrandId: row.zendesk_brand_id,
            defaultLocale: row.default_locale,
            enabledLocales: JSON.stringify(enabledLocales),
            kbAccessMode: DEFAULT_KB_ACCESS_MODE,
            updatedAt: new Date().toISOString()
          }
        );

        return {
          workspaceId: id,
          zendeskSubdomain: row.zendesk_subdomain,
          zendeskBrandId: row.zendesk_brand_id ?? undefined,
          defaultLocale: row.default_locale,
          enabledLocales,
          kbAccessMode: DEFAULT_KB_ACCESS_MODE
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
          kb_access_mode: string | null;
        }>(
          `SELECT workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales
            , kb_access_mode
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
          payload.enabledLocales === undefined &&
          payload.kbAccessMode === undefined
        ) {
          throw new Error('No settings provided');
        }
        if (
          payload.kbAccessMode !== undefined &&
          !isValidKbAccessMode(payload.kbAccessMode)
        ) {
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

        workspaceDb.run(
          `INSERT OR REPLACE INTO workspace_settings (
            workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, kb_access_mode, updated_at
          ) VALUES (
            @workspaceId, @zendeskSubdomain, @zendeskBrandId, @defaultLocale, @enabledLocales, @kbAccessMode, @updatedAt
          )`,
          {
            workspaceId: payload.workspaceId,
            zendeskSubdomain: nextSubdomain,
            zendeskBrandId: nextBrand,
            defaultLocale: nextDefaultLocale,
            enabledLocales: JSON.stringify(normalizedEnabledLocales),
            kbAccessMode: nextKbAccessMode,
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
          enabledLocales: normalizedEnabledLocales,
          kbAccessMode: nextKbAccessMode
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
      const workspaceDbPath = await this.ensureWorkspaceDb(resolvedPath);
      this.normalizeWorkspaceDbIdentity(workspaceDbPath, id);

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

      const workspaceDb = this.openWorkspaceDbWithRecovery(workspaceDbPath);
      try {
        workspaceDb.run(
          `INSERT INTO workspace_settings (
            workspace_id, zendesk_subdomain, zendesk_brand_id, default_locale, enabled_locales, kb_access_mode, updated_at
          ) VALUES (
            @workspaceId, @zendeskSubdomain, @zendeskBrandId, @defaultLocale, @enabledLocales, @kbAccessMode, @updatedAt
          )`,
          {
            workspaceId: id,
            zendeskSubdomain: payload.zendeskSubdomain,
            zendeskBrandId: payload.zendeskBrandId ?? null,
            defaultLocale: payload.defaultLocale,
            enabledLocales: JSON.stringify(enabledLocales),
            kbAccessMode: DEFAULT_KB_ACCESS_MODE,
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
      const sectionId = payload.sectionId !== undefined
        ? (payload.sectionId ?? undefined)
        : (existing.sectionId ?? undefined);
      const categoryId = payload.categoryId !== undefined
        ? (payload.categoryId ?? undefined)
        : (existing.categoryId ?? undefined);
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
      await this.ensureDefaultTemplatePacks(workspaceId, workspaceDb);
      return workspaceDb.all<TemplatePackRecord>(
        `SELECT id, workspace_id as workspaceId, name, language, prompt_template as promptTemplate,
                tone_rules as toneRules, examples, active, updated_at as updatedAtUtc
         FROM template_packs
         WHERE workspace_id = @workspaceId
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
      await this.ensureDefaultTemplatePacks(workspaceId, workspaceDb);
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
      await this.ensureDefaultTemplatePacks(workspaceId, workspaceDb);
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

  async listTemplatePackSummaries(input: TemplatePackListRequest): Promise<TemplatePackListResponse> {
    const workspace = await this.getWorkspace(input.workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      await this.ensureDefaultTemplatePacks(input.workspaceId, workspaceDb);
      const rows = workspaceDb.all<Array<TemplatePackRecord & { templateType: string | null; description: string | null; analysisJson: string | null }>[number]>(
        `SELECT id,
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
         ORDER BY active DESC, updated_at DESC, name ASC`,
        {
          workspaceId: input.workspaceId,
          includeInactive: input.includeInactive ? 1 : 0
        }
      );

      return {
        workspaceId: input.workspaceId,
        templates: rows.map((row) => this.mapTemplatePackSummary(row))
      };
    } finally {
      workspaceDb.close();
    }
  }

  async getTemplatePackDetail(input: TemplatePackGetRequest): Promise<TemplatePackDetail | null> {
    const workspace = await this.getWorkspace(input.workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      await this.ensureDefaultTemplatePacks(input.workspaceId, workspaceDb);
      const row = workspaceDb.get<TemplatePackRecord & { templateType: string | null; description: string | null; analysisJson: string | null }>(
        `SELECT id,
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
         WHERE workspace_id = @workspaceId AND id = @templatePackId`,
        { workspaceId: input.workspaceId, templatePackId: input.templatePackId }
      );

      return row ? this.mapTemplatePackSummary(row) : null;
    } finally {
      workspaceDb.close();
    }
  }

  async upsertTemplatePack(input: TemplatePackUpsertRequest): Promise<TemplatePackDetail> {
    const workspace = await this.getWorkspace(input.workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      await this.ensureDefaultTemplatePacks(input.workspaceId, workspaceDb);
      const id = input.templatePackId ?? randomUUID();
      const now = new Date().toISOString();
      workspaceDb.run(
        `INSERT INTO template_packs (
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
          analysis_json = NULL`,
        {
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
        }
      );
      const detail = await this.getTemplatePackDetail({ workspaceId: input.workspaceId, templatePackId: id });
      if (!detail) {
        throw new Error('Template pack not found after save');
      }
      return detail;
    } finally {
      workspaceDb.close();
    }
  }

  async deleteTemplatePack(input: TemplatePackDeleteRequest): Promise<{ workspaceId: string; templatePackId: string }> {
    const workspace = await this.getWorkspace(input.workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const existing = workspaceDb.get<{ id: string }>(
        `SELECT id FROM template_packs WHERE workspace_id = @workspaceId AND id = @templatePackId`,
        { workspaceId: input.workspaceId, templatePackId: input.templatePackId }
      );
      if (!existing) {
        throw new Error('Template pack not found');
      }
      workspaceDb.run(
        `DELETE FROM template_packs WHERE workspace_id = @workspaceId AND id = @templatePackId`,
        { workspaceId: input.workspaceId, templatePackId: input.templatePackId }
      );
      return input;
    } finally {
      workspaceDb.close();
    }
  }

  async analyzeTemplatePack(input: TemplatePackGetRequest): Promise<TemplatePackDetail | null> {
    const workspace = await this.getWorkspace(input.workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const detail = await this.getTemplatePackDetail(input);
      if (!detail) {
        return null;
      }
      const analysis = buildTemplatePackAnalysis(detail);
      workspaceDb.run(
        `UPDATE template_packs
         SET analysis_json = @analysisJson, updated_at = @updatedAt
         WHERE workspace_id = @workspaceId AND id = @templatePackId`,
        {
          workspaceId: input.workspaceId,
          templatePackId: input.templatePackId,
          analysisJson: JSON.stringify(analysis),
          updatedAt: new Date().toISOString()
        }
      );
      return this.getTemplatePackDetail(input);
    } finally {
      workspaceDb.close();
    }
  }

  async getOrCreateArticleAiSession(input: ArticleAiSessionGetRequest): Promise<ArticleAiSessionResponse> {
    const workspace = await this.getWorkspace(input.workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      await this.ensureDefaultTemplatePacks(input.workspaceId, workspaceDb);
      const target = await this.resolveArticleAiTarget(workspace.path, workspaceDb, input);
      const existing = workspaceDb.get<ArticleAiSessionDbRow>(
        `SELECT id,
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
         LIMIT 1`,
        {
          workspaceId: input.workspaceId,
          localeVariantId: target.localeVariantId,
          branchId: target.branchId ?? null
        }
      );

      const sessionRow = existing ?? await this.createArticleAiSessionRow(workspaceDb, target);
      return this.buildArticleAiSessionResponse(workspaceDb, target, sessionRow);
    } finally {
      workspaceDb.close();
    }
  }

  async submitArticleAiMessage(
    input: ArticleAiSubmitRequest,
    aiResult: {
      runtimeSessionId?: string;
      templatePackId?: string;
      updatedHtml: string;
      summary: string;
      rationale?: string;
      rawResult?: unknown;
    }
  ): Promise<ArticleAiSubmitResponse> {
    const workspace = await this.getWorkspace(input.workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const response = await this.getOrCreateArticleAiSession({
        workspaceId: input.workspaceId,
        localeVariantId: input.localeVariantId,
        branchId: input.branchId
      });
      const now = new Date().toISOString();
      const sessionId = response.session.id;

      await this.insertArticleAiMessage(workspaceDb, {
        id: randomUUID(),
        sessionId,
        workspaceId: input.workspaceId,
        role: ArticleAiMessageRole.USER,
        messageKind: ArticleAiMessageKind.CHAT,
        presetAction: input.presetAction ?? ArticleAiPresetAction.FREEFORM,
        content: input.message.trim(),
        metadataJson: JSON.stringify({
          targetLocale: input.targetLocale,
          templatePackId: input.templatePackId
        }),
        createdAtUtc: now
      });

      await this.insertArticleAiMessage(workspaceDb, {
        id: randomUUID(),
        sessionId,
        workspaceId: input.workspaceId,
        role: ArticleAiMessageRole.ASSISTANT,
        messageKind: ArticleAiMessageKind.EDIT_RESULT,
        presetAction: input.presetAction ?? ArticleAiPresetAction.FREEFORM,
        content: aiResult.summary,
        metadataJson: JSON.stringify({
          rationale: aiResult.rationale,
          runtimeSessionId: aiResult.runtimeSessionId,
          rawResult: aiResult.rawResult
        }),
        createdAtUtc: now
      });

      workspaceDb.run(
        `UPDATE article_ai_sessions
         SET pending_html = @pendingHtml,
             pending_summary = @pendingSummary,
             pending_rationale = @pendingRationale,
             pending_metadata_json = @pendingMetadataJson,
             template_pack_id = COALESCE(@templatePackId, template_pack_id),
             runtime_session_id = COALESCE(@runtimeSessionId, runtime_session_id),
             status = @status,
             updated_at = @updatedAt
         WHERE id = @id`,
        {
          id: sessionId,
          pendingHtml: aiResult.updatedHtml,
          pendingSummary: aiResult.summary,
          pendingRationale: aiResult.rationale ?? null,
          pendingMetadataJson: JSON.stringify({
            targetLocale: input.targetLocale,
            presetAction: input.presetAction ?? ArticleAiPresetAction.FREEFORM
          }),
          templatePackId: aiResult.templatePackId ?? input.templatePackId ?? null,
          runtimeSessionId: aiResult.runtimeSessionId ?? null,
          status: ArticleAiSessionStatus.HAS_PENDING_EDIT,
          updatedAt: now
        }
      );

      const refreshed = await this.getOrCreateArticleAiSession({
        workspaceId: input.workspaceId,
        localeVariantId: input.localeVariantId,
        branchId: input.branchId
      });
      return {
        ...refreshed,
        acceptedRuntimeSessionId: aiResult.runtimeSessionId
      };
    } finally {
      workspaceDb.close();
    }
  }

  async resetArticleAiSession(input: ArticleAiResetRequest): Promise<ArticleAiSessionResponse> {
    const workspace = await this.getWorkspace(input.workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const session = workspaceDb.get<ArticleAiSessionDbRow>(
        `SELECT id,
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
         WHERE workspace_id = @workspaceId AND id = @sessionId`,
        { workspaceId: input.workspaceId, sessionId: input.sessionId }
      );
      if (!session) {
        throw new Error('Article AI session not found');
      }

      workspaceDb.run(`DELETE FROM article_ai_messages WHERE workspace_id = @workspaceId AND session_id = @sessionId`, {
        workspaceId: input.workspaceId,
        sessionId: input.sessionId
      });
      workspaceDb.run(
        `UPDATE article_ai_sessions
         SET pending_html = NULL,
             pending_summary = NULL,
             pending_rationale = NULL,
             pending_metadata_json = NULL,
             runtime_session_id = NULL,
             status = @status,
             updated_at = @updatedAt
         WHERE workspace_id = @workspaceId AND id = @sessionId`,
        {
          workspaceId: input.workspaceId,
          sessionId: input.sessionId,
          status: ArticleAiSessionStatus.IDLE,
          updatedAt: new Date().toISOString()
        }
      );

      return this.getOrCreateArticleAiSession({
        workspaceId: input.workspaceId,
        localeVariantId: session.localeVariantId,
        branchId: session.branchId ?? undefined
      });
    } finally {
      workspaceDb.close();
    }
  }

  async rejectArticleAiEdit(input: ArticleAiDecisionRequest): Promise<ArticleAiDecisionResponse> {
    const workspace = await this.getWorkspace(input.workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const session = this.requireArticleAiSession(workspaceDb, input.workspaceId, input.sessionId);
      const now = new Date().toISOString();
      await this.insertArticleAiMessage(workspaceDb, {
        id: randomUUID(),
        sessionId: session.id,
        workspaceId: input.workspaceId,
        role: ArticleAiMessageRole.SYSTEM,
        messageKind: ArticleAiMessageKind.DECISION,
        presetAction: null,
        content: 'Rejected pending AI edit.',
        metadataJson: null,
        createdAtUtc: now
      });
      workspaceDb.run(
        `UPDATE article_ai_sessions
         SET pending_html = NULL,
             pending_summary = NULL,
             pending_rationale = NULL,
             pending_metadata_json = NULL,
             status = @status,
             updated_at = @updatedAt
         WHERE id = @id`,
        {
          id: session.id,
          status: ArticleAiSessionStatus.IDLE,
          updatedAt: now
        }
      );

      return this.getOrCreateArticleAiSession({
        workspaceId: input.workspaceId,
        localeVariantId: session.localeVariantId,
        branchId: session.branchId ?? undefined
      });
    } finally {
      workspaceDb.close();
    }
  }

  async acceptArticleAiEdit(input: ArticleAiDecisionRequest): Promise<ArticleAiDecisionResponse> {
    const workspace = await this.getWorkspace(input.workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    let acceptedBranchId: string | undefined;
    let acceptedRevisionId: string | undefined;
    try {
      const session = this.requireArticleAiSession(workspaceDb, input.workspaceId, input.sessionId);
      if (!session.pendingHtml) {
        throw new Error('No pending AI edit to accept');
      }
      const metadata = safeParseJson<{ targetLocale?: string }>(session.pendingMetadataJson);
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
      } else {
        const family = workspaceDb.get<{ title: string }>(
          `SELECT af.title
           FROM article_families af
           JOIN locale_variants lv ON lv.family_id = af.id
           WHERE lv.id = @localeVariantId
           LIMIT 1`,
          { localeVariantId: session.localeVariantId }
        );
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
    } finally {
      workspaceDb.close();
    }

    const workspaceDb2 = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const session = this.requireArticleAiSession(workspaceDb2, input.workspaceId, input.sessionId);
      const acceptedHtml = acceptedBranchId
        ? await this.getDraftBranchHtml(workspace.path, workspaceDb2, input.workspaceId, acceptedBranchId)
        : session.currentHtml;
      const acceptedRevision = acceptedRevisionId
        ? workspaceDb2.get<RevisionRecord>(
            `SELECT id,
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
             FROM revisions WHERE id = @id`,
            { id: acceptedRevisionId }
          )
        : null;
      const now = new Date().toISOString();
      await this.insertArticleAiMessage(workspaceDb2, {
        id: randomUUID(),
        sessionId: session.id,
        workspaceId: input.workspaceId,
        role: ArticleAiMessageRole.SYSTEM,
        messageKind: ArticleAiMessageKind.DECISION,
        presetAction: null,
        content: acceptedBranchId ? 'Accepted AI edit into draft branch.' : 'Accepted AI edit.',
        metadataJson: JSON.stringify({
          branchId: acceptedBranchId,
          revisionId: acceptedRevisionId
        }),
        createdAtUtc: now
      });
      workspaceDb2.run(
        `UPDATE article_ai_sessions
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
         WHERE id = @id`,
        {
          id: session.id,
          branchId: acceptedBranchId ?? null,
          currentRevisionId: acceptedRevision?.id ?? null,
          currentHtml: acceptedHtml,
          status: ArticleAiSessionStatus.IDLE,
          updatedAt: now
        }
      );
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
    } finally {
      workspaceDb2.close();
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
      const syncCheckpoints = workspaceDb.all<{
        locale: string;
        lastSyncedAtUtc: string | null;
        updatedAtUtc: string;
      }>(
        `SELECT locale, last_synced_at as lastSyncedAtUtc, updated_at as updatedAtUtc
         FROM zendesk_sync_checkpoints
         WHERE workspace_id = @workspaceId`,
        { workspaceId }
      );
      const branchCounts = new Map(branches.map((row) => [row.locale_variant_id, row.total]));
      const syncTimestampByLocale = new Map(
        syncCheckpoints.map((checkpoint) => [
          checkpoint.locale,
          checkpoint.lastSyncedAtUtc ?? checkpoint.updatedAtUtc
        ])
      );
      const latestByVariant = getLatestRevisions(revisions);

      return families.map((family) => {
        const locales = variants
          .filter((variant) => variant.familyId === family.id)
          .map((variant) => {
            const latest = latestByVariant.get(variant.id);
            const syncUpdatedAtUtc = syncTimestampByLocale.get(variant.locale);
            const explorerUpdatedAtUtc = latestTimestamp(
              syncUpdatedAtUtc,
              latest?.updatedAtUtc
            ) ?? new Date().toISOString();
            return {
              locale: variant.locale,
              localeVariantId: variant.id,
              revision: {
                revisionId: latest?.revisionId ?? '',
                revisionNumber: latest?.revisionNumber ?? 0,
                state: latest?.revisionType ?? variant.status ?? RevisionState.LIVE,
                updatedAtUtc: explorerUpdatedAtUtc,
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
          sectionId: family.sectionId ?? undefined,
          sectionName: family.sectionId ?? undefined,
          categoryId: family.categoryId ?? undefined,
          categoryName: family.categoryId ?? undefined,
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

  async getArticleRelationsStatus(workspaceId: string): Promise<ArticleRelationRefreshStatusResponse> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));

    try {
      const latestRun = workspaceDb.get<{
        id: string;
        workspace_id: string;
        status: string;
        source: string;
        triggered_by: string | null;
        agent_session_id: string | null;
        started_at: string;
        ended_at: string | null;
        summary_json: string | null;
      }>(
        `SELECT id, workspace_id, status, source, triggered_by, agent_session_id, started_at, ended_at, summary_json
         FROM article_relation_runs
         WHERE workspace_id = @workspaceId
         ORDER BY started_at DESC
         LIMIT 1`,
        { workspaceId }
      );

      const counts = workspaceDb.get<{
        totalActive: number;
        inferred: number;
        manual: number;
      }>(
        `SELECT
           COUNT(*) as totalActive,
           SUM(CASE WHEN origin = 'inferred' THEN 1 ELSE 0 END) as inferred,
           SUM(CASE WHEN origin = 'manual' THEN 1 ELSE 0 END) as manual
         FROM article_relations
         WHERE workspace_id = @workspaceId
           AND status = @status`,
        {
          workspaceId,
          status: ArticleRelationStatus.ACTIVE
        }
      );

      const summary: ArticleRelationSummary = {
        totalActive: counts?.totalActive ?? 0,
        inferred: counts?.inferred ?? 0,
        manual: counts?.manual ?? 0,
        lastRefreshedAtUtc: latestRun?.ended_at ?? latestRun?.started_at,
        latestRunState: normalizeRelationRunStatus(latestRun?.status)
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
              summary: safeParseJson<ArticleRelationRefreshSummary>(latestRun.summary_json) ?? undefined
            }
          : null,
        summary
      };
    } finally {
      workspaceDb.close();
    }
  }

  async listArticleRelations(workspaceId: string, payload: ArticleRelationsListRequest): Promise<ArticleRelationsListResponse> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));

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
      const params: Record<string, string | number> = {
        workspaceId,
        activeStatus: ArticleRelationStatus.ACTIVE,
        minScore
      };
      const placeholders = seedFamilyIds.map((familyId, index) => {
        const key = `seed${index}`;
        params[key] = familyId;
        return `@${key}`;
      }).join(', ');

      const rows = workspaceDb.all<ArticleRelationDbRow>(
        `SELECT
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
           AND (r.left_family_id IN (${placeholders}) OR r.right_family_id IN (${placeholders}))
         ORDER BY r.strength_score DESC, r.updated_at DESC
         LIMIT ${limit}`
        ,
        params
      );

      const relations = rows.map((row) => this.mapArticleRelationRow(row, workspaceDb, includeEvidence));
      return {
        workspaceId,
        seedFamilyIds,
        total: relations.length,
        relations
      };
    } finally {
      workspaceDb.close();
    }
  }

  async upsertManualArticleRelation(payload: ArticleRelationUpsertRequest): Promise<ArticleRelationRecord> {
    const workspace = await this.getWorkspace(payload.workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));

    try {
      const now = new Date().toISOString();
      const pair = normalizeFamilyPair(payload.sourceFamilyId, payload.targetFamilyId);
      const direction = payload.direction ?? ArticleRelationDirection.BIDIRECTIONAL;
      const existing = workspaceDb.get<{ id: string }>(
        `SELECT id
         FROM article_relations
         WHERE workspace_id = @workspaceId
           AND left_family_id = @leftFamilyId
           AND right_family_id = @rightFamilyId
           AND relation_type = @relationType
           AND origin = @origin`,
        {
          workspaceId: payload.workspaceId,
          leftFamilyId: pair.leftFamilyId,
          rightFamilyId: pair.rightFamilyId,
          relationType: payload.relationType,
          origin: ArticleRelationOrigin.MANUAL
        }
      );
      const relationId = existing?.id ?? randomUUID();

      workspaceDb.exec('BEGIN IMMEDIATE');
      try {
        workspaceDb.run(
          `INSERT INTO article_relations (
             id, workspace_id, left_family_id, right_family_id, relation_type, direction, strength_score, status, origin, run_id, created_at, updated_at
           ) VALUES (
             @id, @workspaceId, @leftFamilyId, @rightFamilyId, @relationType, @direction, @strengthScore, @status, @origin, NULL, @createdAt, @updatedAt
           )
           ON CONFLICT(id) DO UPDATE SET
             relation_type = excluded.relation_type,
             direction = excluded.direction,
             strength_score = excluded.strength_score,
             status = excluded.status,
             updated_at = excluded.updated_at`,
          {
            id: relationId,
            workspaceId: payload.workspaceId,
            leftFamilyId: pair.leftFamilyId,
            rightFamilyId: pair.rightFamilyId,
            relationType: payload.relationType,
            direction,
            strengthScore: 1,
            status: ArticleRelationStatus.ACTIVE,
            origin: ArticleRelationOrigin.MANUAL,
            createdAt: now,
            updatedAt: now
          }
        );

        workspaceDb.run(
          `DELETE FROM article_relation_overrides
           WHERE workspace_id = @workspaceId
             AND left_family_id = @leftFamilyId
             AND right_family_id = @rightFamilyId
             AND override_type = 'force_remove'`,
          {
            workspaceId: payload.workspaceId,
            leftFamilyId: pair.leftFamilyId,
            rightFamilyId: pair.rightFamilyId
          }
        );

        if (payload.note?.trim()) {
          workspaceDb.run(
            `DELETE FROM article_relation_evidence
             WHERE relation_id = @relationId
               AND evidence_type = @evidenceType`,
            {
              relationId,
              evidenceType: ArticleRelationEvidenceType.MANUAL_NOTE
            }
          );

          workspaceDb.run(
            `INSERT INTO article_relation_evidence (
               id, relation_id, evidence_type, source_ref, snippet, weight, metadata_json
             ) VALUES (
               @id, @relationId, @evidenceType, NULL, @snippet, @weight, NULL
             )`,
            {
              id: randomUUID(),
              relationId,
              evidenceType: ArticleRelationEvidenceType.MANUAL_NOTE,
              snippet: payload.note.trim(),
              weight: 1
            }
          );
        }

        workspaceDb.exec('COMMIT');
      } catch (error) {
        workspaceDb.exec('ROLLBACK');
        throw error;
      }

      const row = workspaceDb.get<ArticleRelationDbRow>(
        `SELECT
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
         WHERE r.id = @id`,
        { id: relationId }
      );

      if (!row) {
        throw new Error('Article relation not found');
      }

      return this.mapArticleRelationRow(row, workspaceDb, true);
    } finally {
      workspaceDb.close();
    }
  }

  async deleteArticleRelation(payload: ArticleRelationDeleteRequest): Promise<{ workspaceId: string; relationId?: string }> {
    const workspace = await this.getWorkspace(payload.workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));

    try {
      let pair: { leftFamilyId: string; rightFamilyId: string } | null = null;
      let relationId = payload.relationId;
      let relationOrigin: ArticleRelationOrigin | null = null;

      if (payload.relationId) {
        const relation = workspaceDb.get<{
          id: string;
          leftFamilyId: string;
          rightFamilyId: string;
          origin: ArticleRelationOrigin;
        }>(
          `SELECT id, left_family_id as leftFamilyId, right_family_id as rightFamilyId, origin
           FROM article_relations
           WHERE id = @id AND workspace_id = @workspaceId`,
          {
            id: payload.relationId,
            workspaceId: payload.workspaceId
          }
        );
        if (relation) {
          pair = {
            leftFamilyId: relation.leftFamilyId,
            rightFamilyId: relation.rightFamilyId
          };
          relationOrigin = relation.origin;
        }
      } else if (payload.sourceFamilyId && payload.targetFamilyId) {
        pair = normalizeFamilyPair(payload.sourceFamilyId, payload.targetFamilyId);
      }

      if (!pair) {
        throw new Error('Article relation not found');
      }

      const now = new Date().toISOString();
      workspaceDb.exec('BEGIN IMMEDIATE');
      try {
        if (relationId && relationOrigin === ArticleRelationOrigin.MANUAL) {
          workspaceDb.run(`DELETE FROM article_relation_evidence WHERE relation_id = @relationId`, { relationId });
          workspaceDb.run(`DELETE FROM article_relations WHERE id = @relationId`, { relationId });
        } else if (relationId) {
          workspaceDb.run(
            `UPDATE article_relations
             SET status = @status, updated_at = @updatedAt
             WHERE id = @relationId`,
            {
              relationId,
              status: ArticleRelationStatus.SUPPRESSED,
              updatedAt: now
            }
          );
        }

        workspaceDb.run(
          `INSERT INTO article_relation_overrides (
             id, workspace_id, left_family_id, right_family_id, override_type, relation_type, note, created_by, created_at, updated_at
           ) VALUES (
             @id, @workspaceId, @leftFamilyId, @rightFamilyId, 'force_remove', '', NULL, 'user', @createdAt, @updatedAt
           )
           ON CONFLICT(workspace_id, left_family_id, right_family_id, override_type, relation_type) DO UPDATE SET
             updated_at = excluded.updated_at`,
          {
            id: randomUUID(),
            workspaceId: payload.workspaceId,
            leftFamilyId: pair.leftFamilyId,
            rightFamilyId: pair.rightFamilyId,
            createdAt: now,
            updatedAt: now
          }
        );
        workspaceDb.exec('COMMIT');
      } catch (error) {
        workspaceDb.exec('ROLLBACK');
        throw error;
      }

      return {
        workspaceId: payload.workspaceId,
        relationId
      };
    } finally {
      workspaceDb.close();
    }
  }

  async refreshArticleRelations(workspaceId: string, options?: { limitPerArticle?: number; source?: ArticleRelationRefreshRun['source']; triggeredBy?: string }): Promise<ArticleRelationRefreshRun> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));

    const runId = randomUUID();
    const startedAtUtc = new Date().toISOString();
    const source = options?.source ?? 'manual_refresh';
    const triggeredBy = options?.triggeredBy ?? 'user';

    try {
      workspaceDb.run(
        `INSERT INTO article_relation_runs (
           id, workspace_id, status, source, triggered_by, started_at
         ) VALUES (
           @id, @workspaceId, @status, @source, @triggeredBy, @startedAt
         )`,
        {
          id: runId,
          workspaceId,
          status: 'running',
          source,
          triggeredBy,
          startedAt: startedAtUtc
        }
      );

      const corpus = await this.buildArticleRelationCorpus(workspace.path, workspaceDb);
      const inferred = buildInferredRelationCandidates(corpus, clampRelationLimit(options?.limitPerArticle ?? 12));
      const summary: ArticleRelationRefreshSummary = {
        totalArticles: corpus.length,
        candidatePairs: inferred.candidatePairs,
        inferredRelations: inferred.relations.length,
        manualRelations: 0,
        suppressedRelations: 0
      };

      workspaceDb.exec('BEGIN IMMEDIATE');
      try {
        const previousInferredIds = workspaceDb.all<{ id: string }>(
          `SELECT id FROM article_relations WHERE workspace_id = @workspaceId AND origin = @origin`,
          {
            workspaceId,
            origin: ArticleRelationOrigin.INFERRED
          }
        );
        if (previousInferredIds.length > 0) {
          const params: Record<string, string> = {};
          const placeholders = previousInferredIds.map((row, index) => {
            const key = `id${index}`;
            params[key] = row.id;
            return `@${key}`;
          }).join(', ');
          workspaceDb.run(`DELETE FROM article_relation_evidence WHERE relation_id IN (${placeholders})`, params);
          workspaceDb.run(`DELETE FROM article_relations WHERE id IN (${placeholders})`, params);
        }

        const insertRelation = workspaceDb.prepare(
          `INSERT INTO article_relations (
             id, workspace_id, left_family_id, right_family_id, relation_type, direction, strength_score, status, origin, run_id, created_at, updated_at
           ) VALUES (
             @id, @workspaceId, @leftFamilyId, @rightFamilyId, @relationType, @direction, @strengthScore, @status, @origin, @runId, @createdAt, @updatedAt
           )`
        );
        const insertEvidence = workspaceDb.prepare(
          `INSERT INTO article_relation_evidence (
             id, relation_id, evidence_type, source_ref, snippet, weight, metadata_json
           ) VALUES (
             @id, @relationId, @evidenceType, @sourceRef, @snippet, @weight, @metadataJson
           )`
        );

        for (const relation of inferred.relations) {
          insertRelation.run({
            id: relation.id,
            workspaceId,
            leftFamilyId: relation.leftFamilyId,
            rightFamilyId: relation.rightFamilyId,
            relationType: relation.relationType,
            direction: relation.direction,
            strengthScore: relation.strengthScore,
            status: ArticleRelationStatus.ACTIVE,
            origin: ArticleRelationOrigin.INFERRED,
            runId,
            createdAt: startedAtUtc,
            updatedAt: startedAtUtc
          });
          for (const evidence of relation.evidence) {
            insertEvidence.run({
              id: randomUUID(),
              relationId: relation.id,
              evidenceType: evidence.evidenceType,
              sourceRef: evidence.sourceRef ?? null,
              snippet: evidence.snippet ?? null,
              weight: evidence.weight,
              metadataJson: evidence.metadata ? JSON.stringify(evidence.metadata) : null
            });
          }
        }

        const manualCounts = workspaceDb.get<{ total: number }>(
          `SELECT COUNT(*) as total
           FROM article_relations
           WHERE workspace_id = @workspaceId
             AND origin = @origin
             AND status = @status`,
          {
            workspaceId,
            origin: ArticleRelationOrigin.MANUAL,
            status: ArticleRelationStatus.ACTIVE
          }
        );
        summary.manualRelations = manualCounts?.total ?? 0;

        const suppressions = workspaceDb.all<{ leftFamilyId: string; rightFamilyId: string }>(
          `SELECT left_family_id as leftFamilyId, right_family_id as rightFamilyId
           FROM article_relation_overrides
           WHERE workspace_id = @workspaceId
             AND override_type = 'force_remove'`,
          { workspaceId }
        );
        summary.suppressedRelations = suppressions.length;
        for (const suppression of suppressions) {
          workspaceDb.run(
            `UPDATE article_relations
             SET status = @status, updated_at = @updatedAt
             WHERE workspace_id = @workspaceId
               AND left_family_id = @leftFamilyId
               AND right_family_id = @rightFamilyId`,
            {
              workspaceId,
              leftFamilyId: suppression.leftFamilyId,
              rightFamilyId: suppression.rightFamilyId,
              status: ArticleRelationStatus.SUPPRESSED,
              updatedAt: startedAtUtc
            }
          );
        }

        workspaceDb.run(
          `UPDATE article_relation_runs
           SET status = 'complete',
               ended_at = @endedAt,
               summary_json = @summaryJson
           WHERE id = @id`,
          {
            id: runId,
            endedAt: new Date().toISOString(),
            summaryJson: JSON.stringify(summary)
          }
        );
        workspaceDb.exec('COMMIT');
      } catch (error) {
        workspaceDb.exec('ROLLBACK');
        throw error;
      }

      return {
        id: runId,
        workspaceId,
        status: 'complete',
        source,
        triggeredBy,
        startedAtUtc,
        endedAtUtc: new Date().toISOString(),
        summary
      };
    } catch (error) {
      workspaceDb.run(
        `UPDATE article_relation_runs
         SET status = 'failed',
             ended_at = @endedAt,
             summary_json = @summaryJson
         WHERE id = @id`,
        {
          id: runId,
          endedAt: new Date().toISOString(),
          summaryJson: JSON.stringify({
            totalArticles: 0,
            candidatePairs: 0,
            inferredRelations: 0,
            manualRelations: 0,
            suppressedRelations: 0,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      );
      throw error;
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
          `DELETE FROM proposal_pbi_links
            WHERE proposal_id IN (SELECT id FROM proposals WHERE batch_id = @batchId)`,
          { batchId }
        );
        workspaceDb.run(
          `DELETE FROM proposals WHERE batch_id = @batchId`,
          { batchId }
        );
        workspaceDb.run(
          `DELETE FROM ai_runs WHERE batch_id = @batchId`,
          { batchId }
        );
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

  async listProposalReviewBatches(workspaceId: string): Promise<ProposalReviewBatchListResponse> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const rows = workspaceDb.all<Array<ProposalReviewBatchSummary & {
        totalCount: number;
        pendingCount: number;
        acceptedCount: number;
        deniedCount: number;
        deferredCount: number;
        appliedCount: number;
        archivedCount: number;
      }>[number]>(`
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
        GROUP BY b.id, b.name, b.source_file_name, b.imported_at, b.status
        ORDER BY b.imported_at DESC
      `, { workspaceId });

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

  async recordBatchAnalysisRun(params: {
    workspaceId: string;
    batchId: string;
    sessionId?: string;
    kbAccessMode?: KbAccessMode;
    status: PersistedAgentAnalysisRun['status'];
    startedAtUtc: string;
    endedAtUtc?: string;
    promptTemplate?: string;
    transcriptPath?: string;
    toolCalls?: AgentToolCallAudit[];
    rawOutput?: string[];
    message?: string;
  }): Promise<PersistedAgentAnalysisRun> {
    const workspace = await this.getWorkspace(params.workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const id = randomUUID();
      workspaceDb.run(
        `INSERT INTO ai_runs (
          id, workspace_id, batch_id, status, started_at, ended_at, prompt_template, transcript_path,
          session_id, kb_access_mode, tool_calls_json, raw_output_json, message
        ) VALUES (
          @id, @workspaceId, @batchId, @status, @startedAt, @endedAt, @promptTemplate, @transcriptPath,
          @sessionId, @kbAccessMode, @toolCallsJson, @rawOutputJson, @message
        )`,
        {
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
        }
      );

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
    } finally {
      workspaceDb.close();
    }
  }

  async getLatestBatchAnalysisRun(workspaceId: string, batchId: string): Promise<PersistedAgentAnalysisRun | null> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const row = workspaceDb.get<{
        id: string;
        workspaceId: string;
        batchId: string;
        sessionId: string | null;
        kbAccessMode: KbAccessMode | null;
        status: PersistedAgentAnalysisRun['status'];
        startedAtUtc: string;
        endedAtUtc: string | null;
        promptTemplate: string | null;
        transcriptPath: string | null;
        toolCallsJson: string | null;
        rawOutputJson: string | null;
        message: string | null;
      }>(
        `SELECT id,
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
          LIMIT 1`,
        { workspaceId, batchId }
      );

      if (!row) {
        return null;
      }

      let toolCalls: AgentToolCallAudit[] = [];
      if (row.toolCallsJson) {
        try {
          const parsed = JSON.parse(row.toolCallsJson) as unknown;
          if (Array.isArray(parsed)) {
            toolCalls = parsed as AgentToolCallAudit[];
          }
        } catch {
          toolCalls = [];
        }
      }
      let rawOutput: string[] = [];
      if (row.rawOutputJson) {
        try {
          const parsed = JSON.parse(row.rawOutputJson) as unknown;
          if (Array.isArray(parsed)) {
            rawOutput = parsed as string[];
          }
        } catch {
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
    } finally {
      workspaceDb.close();
    }
  }

  async createAgentProposal(params: {
    workspaceId: string;
    batchId: string;
    action: ProposalAction;
    _sessionId?: string;
    familyId?: string;
    localeVariantId?: string;
    sourceRevisionId?: string;
    targetTitle?: string;
    targetLocale?: string;
    confidenceScore?: number;
    note?: string;
    rationale?: string;
    rationaleSummary?: string;
    aiNotes?: string;
    suggestedPlacement?: ProposalPlacementSuggestion;
    sourceHtml?: string;
    proposedHtml?: string;
    relatedPbiIds?: string[];
    metadata?: unknown;
  }): Promise<ProposalReviewRecord> {
    const workspace = await this.getWorkspace(params.workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const proposalId = randomUUID();
      const now = new Date().toISOString();
      const metadata = normalizeProposalMetadata(params.metadata);
      const hasStructuredContent = Boolean(
        params.sourceHtml?.trim()
        || params.proposedHtml?.trim()
        || extractString(metadata.sourceHtml)
        || extractString(metadata.proposedHtml)
      );
      const hasMeaningfulContext = Boolean(
        params.note?.trim()
        || params.rationale?.trim()
        || params.rationaleSummary?.trim()
        || params.aiNotes?.trim()
        || Object.keys(metadata).length > 0
        || params.relatedPbiIds?.length
        || hasStructuredContent
      );
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
        metadata
      });
      const rationale = params.rationale ?? params.note ?? undefined;
      const rationaleSummary = params.rationaleSummary ?? extractString(metadata.rationaleSummary) ?? rationale;
      const aiNotes = params.aiNotes ?? params.note ?? extractString(metadata.aiNotes) ?? undefined;
      const targetTitle = identity.targetTitle;
      const targetLocale = identity.targetLocale;
      if (params.action === ProposalAction.CREATE && !targetTitle) {
        throw new Error('Create proposals must include a targetTitle or note/rationale text that clearly names the article');
      }
      const suggestedPlacement = params.suggestedPlacement ?? normalizePlacement(metadata.suggestedPlacement);
      const confidenceScore = normalizeConfidenceScore(params.confidenceScore ?? metadata.confidenceScore);
      const reviewStatus = ProposalReviewStatus.PENDING_REVIEW;
      const status: ProposalDecision = ProposalDecision.DEFER;
      const queueOrder = (
        workspaceDb.get<{ nextOrder: number }>(
          `SELECT COALESCE(MAX(queue_order), 0) + 1 as nextOrder
           FROM proposals
           WHERE batch_id = @batchId`,
          { batchId: params.batchId }
        )?.nextOrder ?? 1
      );
      const artifacts = await this.persistProposalArtifacts(workspace.path, proposalId, {
        sourceHtml: params.sourceHtml ?? extractString(metadata.sourceHtml) ?? '',
        proposedHtml: params.proposedHtml ?? extractString(metadata.proposedHtml) ?? '',
        metadata
      });
      workspaceDb.run(
        `INSERT INTO proposals (
          id, workspace_id, batch_id, action, locale_variant_id, branch_id, status, rationale, generated_at, updated_at,
          review_status, queue_order, family_id, source_revision_id, target_title, target_locale, confidence_score,
          rationale_summary, ai_notes, suggested_placement_json, source_html_path, proposed_html_path, metadata_json,
          decision_payload_json, decided_at, agent_session_id
        ) VALUES (
          @id, @workspaceId, @batchId, @action, @localeVariantId, @branchId, @status, @rationale, @generatedAt, @updatedAt,
          @reviewStatus, @queueOrder, @familyId, @sourceRevisionId, @targetTitle, @targetLocale, @confidenceScore,
          @rationaleSummary, @aiNotes, @suggestedPlacementJson, @sourceHtmlPath, @proposedHtmlPath, @metadataJson,
          @decisionPayloadJson, @decidedAt, @sessionId
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
          updatedAt: now,
          reviewStatus,
          queueOrder,
          familyId: identity.familyId ?? null,
          sourceRevisionId: params.sourceRevisionId ?? extractString(metadata.sourceRevisionId) ?? null,
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

      await this.syncBatchReviewStatus(workspaceDb, params.workspaceId, params.batchId);

      return this.mapProposalRow({
        id: proposalId,
        workspaceId: params.workspaceId,
        batchId: params.batchId,
        action: params.action,
        localeVariantId: params.localeVariantId ?? null,
        branchId: null,
        status,
        rationale: rationale ?? null,
        generatedAtUtc: now,
        updatedAtUtc: now,
        reviewStatus,
        queueOrder,
        familyId: identity.familyId ?? null,
        sourceRevisionId: params.sourceRevisionId ?? extractString(metadata.sourceRevisionId) ?? null,
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
        decidedAtUtc: null,
        sessionId: params._sessionId ?? null
      });
    } finally {
      workspaceDb.close();
    }
  }

  async listProposalReviewQueue(workspaceId: string, batchId: string): Promise<ProposalReviewListResponse> {
    const workspace = await this.getWorkspace(workspaceId);
    const batch = await this.getPBIBatch(workspaceId, batchId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const rows = workspaceDb.all<ProposalDbRow>(`
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

      const relatedCounts = workspaceDb.all<{ proposalId: string; count: number }>(`
        SELECT proposal_id as proposalId, COUNT(*) as count
        FROM proposal_pbi_links
        WHERE proposal_id IN (SELECT id FROM proposals WHERE batch_id = @batchId)
        GROUP BY proposal_id
      `, { batchId });
      const relatedCountMap = new Map(relatedCounts.map((entry) => [entry.proposalId, entry.count]));

      const records = rows.map((row) => this.hydrateProposalDisplayFields(this.mapProposalRow(row), workspaceDb));
      const queue = records.map<ProposalReviewQueueItem>((proposal) => {
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

      const groupMap = new Map<string, ProposalReviewGroup>();
      for (const item of queue) {
        const existing = groupMap.get(item.articleKey);
        if (existing) {
          existing.proposalIds.push(item.proposalId);
          existing.total += 1;
          if (!existing.actions.includes(item.action)) {
            existing.actions.push(item.action);
          }
        } else {
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
    } finally {
      workspaceDb.close();
    }
  }

  async getProposalReviewDetail(workspaceId: string, proposalId: string): Promise<ProposalReviewDetailResponse> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const row = workspaceDb.get<ProposalDbRow>(`
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
      const relatedPbis = workspaceDb.all<PBIRecord>(`
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

      const queueRows = workspaceDb.all<{ id: string }>(`
        SELECT id
        FROM proposals
        WHERE batch_id = @batchId
        ORDER BY queue_order ASC, generated_at ASC
      `, { batchId: proposal.batchId });
      const currentIndex = Math.max(0, queueRows.findIndex((entry) => entry.id === proposalId));
      const hydrated = await this.ensureProposalReviewArtifacts(
        workspace.path,
        workspaceDb,
        proposal,
        relatedPbis
      );
      const beforeHtml = hydrated.beforeHtml;
      const afterHtml = hydrated.afterHtml;
      const diff = diffHtml(beforeHtml, afterHtml);

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
    } finally {
      workspaceDb.close();
    }
  }

  async decideProposalReview(input: ProposalReviewDecisionRequest): Promise<ProposalReviewDecisionResponse> {
    const workspace = await this.getWorkspace(input.workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const existing = workspaceDb.get<ProposalDbRow>(`
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

      workspaceDb.run(
        `UPDATE proposals
         SET review_status = @reviewStatus,
             status = @status,
             branch_id = COALESCE(@branchId, branch_id),
             suggested_placement_json = @suggestedPlacementJson,
             decision_payload_json = @decisionPayloadJson,
             decided_at = @decidedAt,
             updated_at = @updatedAt
         WHERE id = @proposalId AND workspace_id = @workspaceId`,
        {
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
        }
      );

      const batchStatus = await this.syncBatchReviewStatus(workspaceDb, input.workspaceId, existing.batchId);
      const queueRows = workspaceDb.all<ProposalDbRow>(`
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
    return this.getLatestSyncRunWithFilter(workspaceId);
  }

  async getLatestSuccessfulSyncRun(workspaceId: string): Promise<{
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
    return this.getLatestSyncRunWithFilter(workspaceId, 'SUCCEEDED');
  }

  private async getLatestSyncRunWithFilter(
    workspaceId: string,
    state?: string
  ): Promise<{
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
           ${state ? 'AND state = @state' : ''}
         ORDER BY started_at DESC
         LIMIT 1`,
        state ? { workspaceId, state } : { workspaceId }
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

  async listDraftBranches(
    workspaceId: string,
    payload: DraftBranchListRequest
  ): Promise<DraftBranchListResponse> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const clauses = ['workspace_id = @workspaceId'];
      const params: Record<string, unknown> = { workspaceId };
      if (payload.localeVariantId) {
        clauses.push('locale_variant_id = @localeVariantId');
        params.localeVariantId = payload.localeVariantId;
      }
      if (!payload.includeDiscarded) {
        clauses.push(`state != '${DraftBranchStatus.DISCARDED}'`);
      }

      const branchRows = workspaceDb.all<DraftBranchDbRow>(`
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

      const branches = await Promise.all(
        branchRows.map((branch) => this.buildDraftBranchSummary(workspace.path, workspaceDb, branch))
      );

      return {
        workspaceId,
        summary: summarizeDraftBranchStatuses(branches),
        branches
      };
    } finally {
      workspaceDb.close();
    }
  }

  async getDraftBranchEditor(workspaceId: string, branchId: string): Promise<DraftBranchGetResponse> {
    const workspace = await this.getWorkspace(workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const branch = this.getDraftBranchRow(workspaceDb, workspaceId, branchId);
      const summary = await this.buildDraftBranchSummary(workspace.path, workspaceDb, branch);
      const editor = await this.buildDraftEditorPayload(workspace.path, workspaceDb, branch, summary);
      return {
        workspaceId,
        branch: summary,
        editor
      };
    } finally {
      workspaceDb.close();
    }
  }

  async createDraftBranch(payload: DraftBranchCreateRequest): Promise<DraftBranchGetResponse> {
    const workspace = await this.getWorkspace(payload.workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const variant = workspaceDb.get<{ familyId: string; locale: string }>(
        `SELECT family_id as familyId, locale
         FROM locale_variants
         WHERE id = @localeVariantId
         LIMIT 1`,
        { localeVariantId: payload.localeVariantId }
      );
      if (!variant) {
        throw new Error('Locale variant not found');
      }

      const baseRevision = payload.baseRevisionId
        ? workspaceDb.get<RevisionRecord>(
            `SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
                    workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
                    revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
             FROM revisions
             WHERE id = @revisionId AND workspace_id = @workspaceId
             LIMIT 1`,
            { revisionId: payload.baseRevisionId, workspaceId: payload.workspaceId }
          )
        : await this.getLatestRevisionForVariant(workspaceDb, payload.localeVariantId, RevisionState.LIVE);

      const headSourceHtml = payload.sourceHtml
        ?? (baseRevision ? await this.readRevisionSource(resolveRevisionPath(workspace.path, baseRevision.filePath)) : '');
      const branchId = randomUUID();
      const revisionId = randomUUID();
      const revisionNumber = (await this.getLatestRevisionForVariant(workspaceDb, payload.localeVariantId))?.revisionNumber ?? 0;
      const nextRevisionNumber = revisionNumber + 1;
      const now = new Date().toISOString();
      const branchName = payload.name?.trim() || `${variant.locale.toUpperCase()} Draft ${nextRevisionNumber}`;
      const filePath = await this.writeProposalDraftRevision(
        workspace.path,
        payload.localeVariantId,
        branchId,
        revisionId,
        nextRevisionNumber,
        headSourceHtml
      );
      const liveHtml = baseRevision ? await this.readRevisionSource(resolveRevisionPath(workspace.path, baseRevision.filePath)) : '';
      const changeSummary = summarizeDraftChanges(diffHtml(liveHtml, headSourceHtml));

      workspaceDb.run(
        `INSERT INTO draft_branches (
          id, workspace_id, locale_variant_id, name, base_revision_id, state, created_at, updated_at, retired_at,
          head_revision_id, autosave_enabled, last_autosaved_at, last_manual_saved_at, change_summary, editor_state_json
        ) VALUES (
          @id, @workspaceId, @localeVariantId, @name, @baseRevisionId, @state, @createdAt, @updatedAt, NULL,
          @headRevisionId, 1, NULL, @lastManualSavedAt, @changeSummary, @editorStateJson
        )`,
        {
          id: branchId,
          workspaceId: payload.workspaceId,
          localeVariantId: payload.localeVariantId,
          name: branchName,
          baseRevisionId: baseRevision?.id ?? revisionId,
          state: DraftBranchStatus.ACTIVE,
          createdAt: now,
          updatedAt: now,
          headRevisionId: revisionId,
          lastManualSavedAt: now,
          changeSummary,
          editorStateJson: payload.editorState ? JSON.stringify(payload.editorState) : null
        }
      );

      workspaceDb.run(
        `INSERT INTO revisions (
          id, locale_variant_id, revision_type, branch_id, workspace_id, file_path, content_hash, source_revision_id, revision_number, status, created_at, updated_at
        ) VALUES (
          @id, @localeVariantId, @revisionType, @branchId, @workspaceId, @filePath, @contentHash, @sourceRevisionId, @revisionNumber, @status, @createdAt, @updatedAt
        )`,
        {
          id: revisionId,
          localeVariantId: payload.localeVariantId,
          revisionType: RevisionState.DRAFT_BRANCH,
          branchId,
          workspaceId: payload.workspaceId,
          filePath,
          contentHash: createContentHash(headSourceHtml),
          sourceRevisionId: baseRevision?.id ?? null,
          revisionNumber: nextRevisionNumber,
          status: RevisionStatus.OPEN,
          createdAt: now,
          updatedAt: now
        }
      );
      this.recordDraftRevisionCommit(workspaceDb, {
        revisionId,
        branchId,
        workspaceId: payload.workspaceId,
        source: DraftCommitSource.MANUAL,
        message: 'Created draft branch'
      });
      if (baseRevision) {
        this.recordArticleLineage(workspaceDb, payload.localeVariantId, baseRevision.id, revisionId, 'manual', now);
      }

      return this.getDraftBranchEditor(payload.workspaceId, branchId);
    } finally {
      workspaceDb.close();
    }
  }

  async saveDraftBranch(payload: DraftBranchSaveRequest): Promise<DraftBranchSaveResponse> {
    const workspace = await this.getWorkspace(payload.workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const branch = this.getDraftBranchRow(workspaceDb, payload.workspaceId, payload.branchId);
      const currentHead = await this.getDraftBranchHeadRevision(workspaceDb, branch);
      if (payload.expectedHeadRevisionId && currentHead && payload.expectedHeadRevisionId !== currentHead.id) {
        throw new Error('Draft branch changed since the editor loaded');
      }
      if (normalizeDraftBranchStatus(branch.state) === DraftBranchStatus.OBSOLETE) {
        throw new Error('Cannot save an obsolete draft branch');
      }
      if (normalizeDraftBranchStatus(branch.state) === DraftBranchStatus.DISCARDED) {
        throw new Error('Cannot save a discarded draft branch');
      }

      const nextRevisionNumber = ((await this.getLatestRevisionForVariant(workspaceDb, branch.localeVariantId))?.revisionNumber ?? 0) + 1;
      const revisionId = randomUUID();
      const now = new Date().toISOString();
      const html = payload.html ?? '';
      const filePath = await this.writeProposalDraftRevision(
        workspace.path,
        branch.localeVariantId,
        branch.id,
        revisionId,
        nextRevisionNumber,
        html
      );
      const liveRevision = await this.getLatestRevisionForVariant(workspaceDb, branch.localeVariantId, RevisionState.LIVE);
      const liveHtml = liveRevision ? await this.readRevisionSource(resolveRevisionPath(workspace.path, liveRevision.filePath)) : '';
      const diff = diffHtml(liveHtml, html);
      const changeSummary = summarizeDraftChanges(diff);
      const status = normalizeDraftBranchStatus(branch.state, Boolean(liveRevision && branch.baseRevisionId !== liveRevision.id));

      workspaceDb.run(
        `INSERT INTO revisions (
          id, locale_variant_id, revision_type, branch_id, workspace_id, file_path, content_hash, source_revision_id, revision_number, status, created_at, updated_at
        ) VALUES (
          @id, @localeVariantId, @revisionType, @branchId, @workspaceId, @filePath, @contentHash, @sourceRevisionId, @revisionNumber, @status, @createdAt, @updatedAt
        )`,
        {
          id: revisionId,
          localeVariantId: branch.localeVariantId,
          revisionType: RevisionState.DRAFT_BRANCH,
          branchId: branch.id,
          workspaceId: payload.workspaceId,
          filePath,
          contentHash: createContentHash(html),
          sourceRevisionId: currentHead?.id ?? branch.baseRevisionId,
          revisionNumber: nextRevisionNumber,
          status: RevisionStatus.OPEN,
          createdAt: now,
          updatedAt: now
        }
      );
      this.recordDraftRevisionCommit(workspaceDb, {
        revisionId,
        branchId: branch.id,
        workspaceId: payload.workspaceId,
        source: payload.autosave ? DraftCommitSource.AUTOSAVE : DraftCommitSource.MANUAL,
        message: payload.commitMessage
      });
      if (currentHead) {
        this.recordArticleLineage(
          workspaceDb,
          branch.localeVariantId,
          currentHead.id,
          revisionId,
          payload.autosave ? 'system' : 'manual',
          now
        );
      }

      workspaceDb.run(
        `UPDATE draft_branches
         SET head_revision_id = @headRevisionId,
             state = @state,
             updated_at = @updatedAt,
             last_autosaved_at = CASE WHEN @isAutosave = 1 THEN @updatedAt ELSE last_autosaved_at END,
             last_manual_saved_at = CASE WHEN @isAutosave = 0 THEN @updatedAt ELSE last_manual_saved_at END,
             change_summary = @changeSummary,
             editor_state_json = COALESCE(@editorStateJson, editor_state_json)
         WHERE id = @branchId AND workspace_id = @workspaceId`,
        {
          branchId: branch.id,
          workspaceId: payload.workspaceId,
          headRevisionId: revisionId,
          state: status,
          updatedAt: now,
          isAutosave: payload.autosave ? 1 : 0,
          changeSummary,
          editorStateJson: payload.editorState ? JSON.stringify(payload.editorState) : null
        }
      );

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
    } finally {
      workspaceDb.close();
    }
  }

  async setDraftBranchStatus(payload: DraftBranchStatusUpdateRequest): Promise<DraftBranchGetResponse> {
    const workspace = await this.getWorkspace(payload.workspaceId);
    await this.ensureWorkspaceDb(workspace.path);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const branch = this.getDraftBranchRow(workspaceDb, payload.workspaceId, payload.branchId);
      const nextStatus = payload.status;
      workspaceDb.run(
        `UPDATE draft_branches
         SET state = @state,
             updated_at = @updatedAt
         WHERE id = @branchId AND workspace_id = @workspaceId`,
        {
          branchId: payload.branchId,
          workspaceId: payload.workspaceId,
          state: nextStatus,
          updatedAt: new Date().toISOString()
        }
      );
      return this.getDraftBranchEditor(payload.workspaceId, branch.id);
    } finally {
      workspaceDb.close();
    }
  }

  async discardDraftBranch(payload: DraftBranchDiscardRequest): Promise<DraftBranchGetResponse> {
    return this.setDraftBranchStatus({
      workspaceId: payload.workspaceId,
      branchId: payload.branchId,
      status: DraftBranchStatus.DISCARDED
    });
  }

  async undoDraftBranch(payload: DraftBranchHistoryStepRequest): Promise<DraftBranchGetResponse> {
    return this.stepDraftBranchHistory(payload.workspaceId, payload.branchId, -1);
  }

  async redoDraftBranch(payload: DraftBranchHistoryStepRequest): Promise<DraftBranchGetResponse> {
    return this.stepDraftBranchHistory(payload.workspaceId, payload.branchId, 1);
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

  private mapArticleRelationRow(
    row: ArticleRelationDbRow,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    includeEvidence: boolean
  ): ArticleRelationRecord {
    const evidence = includeEvidence
      ? workspaceDb.all<{
          id: string;
          relation_id: string;
          evidence_type: ArticleRelationEvidenceType;
          source_ref: string | null;
          snippet: string | null;
          weight: number;
          metadata_json: string | null;
        }>(
          `SELECT id, relation_id, evidence_type, source_ref, snippet, weight, metadata_json
           FROM article_relation_evidence
           WHERE relation_id = @relationId
           ORDER BY weight DESC, id ASC`,
          { relationId: row.id }
        ).map((evidenceRow): ArticleRelationEvidence => ({
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

  private async resolveRelationSeedFamilyIds(
    workspaceId: string,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    payload: ArticleRelationsListRequest
  ): Promise<string[]> {
    if (payload.familyId) {
      return [payload.familyId];
    }

    if (payload.localeVariantId) {
      const variant = workspaceDb.get<{ familyId: string }>(
        `SELECT family_id as familyId FROM locale_variants WHERE id = @id`,
        { id: payload.localeVariantId }
      );
      return variant ? [variant.familyId] : [];
    }

    if (!payload.batchId) {
      return [];
    }

    const proposalFamilies = workspaceDb.all<{ familyId: string }>(
      `SELECT DISTINCT COALESCE(p.family_id, lv.family_id) as familyId
       FROM proposals p
       LEFT JOIN locale_variants lv ON lv.id = p.locale_variant_id
       WHERE p.batch_id = @batchId
         AND COALESCE(p.family_id, lv.family_id) IS NOT NULL`,
      { batchId: payload.batchId }
    );
    if (proposalFamilies.length > 0) {
      return proposalFamilies.map((row) => row.familyId);
    }

    const pbiRows = workspaceDb.all<{ title: string }>(
      `SELECT title
       FROM pbi_records
       WHERE batch_id = @batchId
         AND validation_status = @candidateStatus
       ORDER BY source_row_number ASC
       LIMIT 8`,
      {
        batchId: payload.batchId,
        candidateStatus: PBIValidationStatus.CANDIDATE
      }
    );
    const seedFamilyIds = new Set<string>();
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

  private async buildArticleRelationCorpus(
    workspacePath: string,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>
  ): Promise<ArticleRelationCorpusItem[]> {
    const families = workspaceDb.all<{
      id: string;
      title: string;
      externalKey: string;
      sectionId: string | null;
      categoryId: string | null;
    }>(
      `SELECT id, title, external_key as externalKey, section_id as sectionId, category_id as categoryId
       FROM article_families
       WHERE retired_at IS NULL
       ORDER BY title COLLATE NOCASE`
    );
    const variants = workspaceDb.all<{
      id: string;
      familyId: string;
      locale: string;
      status: RevisionState;
    }>(
      `SELECT id, family_id as familyId, locale, status
       FROM locale_variants
       WHERE status != @retiredStatus`,
      { retiredStatus: RevisionState.RETIRED }
    );
    const revisions = workspaceDb.all<{
      id: string;
      locale_variant_id: string;
      revision_number: number;
      revision_type: RevisionState;
      file_path: string;
      updated_at: string;
    }>(
      `SELECT id, locale_variant_id, revision_number, revision_type, file_path, updated_at
       FROM revisions`
    );
    const latestByVariant = getLatestRevisions(revisions.map((revision) => ({
      id: revision.id,
      localeVariantId: revision.locale_variant_id,
      revisionNumber: revision.revision_number,
      revisionType: revision.revision_type,
      filePath: revision.file_path,
      updatedAtUtc: revision.updated_at
    })));
    const variantsByFamily = new Map<string, Array<{ id: string; locale: string }>>();
    for (const variant of variants) {
      const bucket = variantsByFamily.get(variant.familyId) ?? [];
      bucket.push({ id: variant.id, locale: variant.locale });
      variantsByFamily.set(variant.familyId, bucket);
    }

    const corpus: ArticleRelationCorpusItem[] = [];
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
    this.ensureKbAccessModeColumn(dbPath);
    return dbPath;
  }

  private normalizeWorkspaceDbIdentity(dbPath: string, workspaceId: string): void {
    const db = this.openWorkspaceDbWithRecovery(dbPath);
    try {
      const staleWorkspaceIds = new Set<string>();
      for (const tableName of WORKSPACE_SCOPED_DB_TABLES) {
        const rows = db.all<{ workspaceId: string }>(
          `SELECT DISTINCT workspace_id as workspaceId
           FROM ${tableName}
           WHERE workspace_id IS NOT NULL AND workspace_id != @workspaceId`,
          { workspaceId }
        );
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
          db.run(
            `UPDATE ${tableName}
             SET workspace_id = @workspaceId
             WHERE workspace_id = @staleWorkspaceId`,
            { workspaceId, staleWorkspaceId }
          );
        }
      }
      db.run(`DELETE FROM workspace_settings WHERE workspace_id != @workspaceId`, { workspaceId });
      db.run(`UPDATE draft_branches SET updated_at = @updatedAt WHERE workspace_id = @workspaceId`, { workspaceId, updatedAt: now });
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // no-op
      }
      throw error;
    } finally {
      db.close();
    }
  }

  private ensureKbAccessModeColumn(dbPath: string) {
    const db = openWorkspaceDatabase(dbPath);
    try {
      const columns = db.all<{ name: string }>(`PRAGMA table_info(workspace_settings)`).map((c) => c.name);
      if (!columns.includes('kb_access_mode')) {
        db.exec(`ALTER TABLE workspace_settings ADD COLUMN kb_access_mode TEXT NOT NULL DEFAULT 'mcp'`);
      }
    } finally {
      db.close();
    }
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

  private async persistProposalArtifacts(
    workspacePath: string,
    proposalId: string,
    payload: {
      sourceHtml?: string;
      proposedHtml?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<{ sourceHtmlPath?: string; proposedHtmlPath?: string }> {
    const proposalDir = path.join(workspacePath, 'proposals', proposalId);
    await fs.mkdir(proposalDir, { recursive: true });

    const sourceHtml = payload.sourceHtml?.trim();
    const proposedHtml = payload.proposedHtml?.trim();
    const metadata = payload.metadata && Object.keys(payload.metadata).length > 0
      ? JSON.stringify(payload.metadata, null, 2)
      : '';

    let sourceHtmlPath: string | undefined;
    let proposedHtmlPath: string | undefined;
    if (sourceHtml) {
      sourceHtmlPath = path.join('proposals', proposalId, 'source.html');
      await fs.writeFile(path.join(workspacePath, sourceHtmlPath), sourceHtml, 'utf8');
    }
    if (proposedHtml) {
      proposedHtmlPath = path.join('proposals', proposalId, 'proposed.html');
      await fs.writeFile(path.join(workspacePath, proposedHtmlPath), proposedHtml, 'utf8');
    }
    if (metadata) {
      await fs.writeFile(path.join(proposalDir, 'metadata.json'), metadata, 'utf8');
    }

    return { sourceHtmlPath, proposedHtmlPath };
  }

  private async applyProposalDecisionMutation(
    workspacePath: string,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    proposal: ProposalReviewRecord,
    input: ProposalReviewDecisionRequest
  ): Promise<ProposalDecisionMutationResult> {
    if (input.decision === ProposalReviewDecision.ARCHIVE) {
      return {
        reviewStatus: ProposalReviewStatus.ARCHIVED,
        legacyStatus: ProposalDecision.DEFER
      };
    }

    if (input.decision === ProposalReviewDecision.DENY) {
      return {
        reviewStatus: ProposalReviewStatus.DENIED,
        legacyStatus: ProposalDecision.DENY
      };
    }

    if (input.decision === ProposalReviewDecision.DEFER) {
      return {
        reviewStatus: ProposalReviewStatus.DEFERRED,
        legacyStatus: ProposalDecision.DEFER
      };
    }

    if (proposal.action === ProposalAction.NO_IMPACT && input.decision === ProposalReviewDecision.ACCEPT) {
      return {
        reviewStatus: ProposalReviewStatus.ARCHIVED,
        legacyStatus: ProposalDecision.DEFER
      };
    }

    if (proposal.action === ProposalAction.RETIRE && input.decision === ProposalReviewDecision.ACCEPT) {
      return this.markProposalTargetRetired(workspaceDb, proposal);
    }

    if (proposal.action === ProposalAction.CREATE || proposal.action === ProposalAction.EDIT) {
      if (input.decision === ProposalReviewDecision.APPLY_TO_BRANCH) {
        return this.applyProposalToExistingBranch(workspacePath, workspaceDb, proposal, input.branchId);
      }
      if (input.decision === ProposalReviewDecision.ACCEPT) {
        return this.applyProposalToNewBranch(workspacePath, workspaceDb, proposal, input.placementOverride);
      }
    }

    return {};
  }

  private async applyProposalToNewBranch(
    workspacePath: string,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    proposal: ProposalReviewRecord,
    placementOverride?: ProposalPlacementSuggestion
  ): Promise<ProposalDecisionMutationResult> {
    const now = new Date().toISOString();
    const ensuredIdentity = await this.ensureProposalTargetIdentity(workspacePath, workspaceDb, proposal, placementOverride);
    const latestRevision = ensuredIdentity.localeVariantId
      ? await this.getLatestRevisionForVariant(workspaceDb, ensuredIdentity.localeVariantId)
      : null;
    const nextRevisionNumber = latestRevision ? latestRevision.revisionNumber + 1 : 1;
    const branchId = randomUUID();
    const revisionId = randomUUID();
    const branchName = this.buildProposalBranchName(proposal, nextRevisionNumber);
    const html = await this.getProposalFinalHtml(workspacePath, workspaceDb, proposal);
    const filePath = await this.writeProposalDraftRevision(
      workspacePath,
      ensuredIdentity.localeVariantId,
      branchId,
      revisionId,
      nextRevisionNumber,
      html
    );

    workspaceDb.run(
      `INSERT INTO draft_branches (
        id, workspace_id, locale_variant_id, name, base_revision_id, state, created_at, updated_at, retired_at,
        head_revision_id, autosave_enabled, last_autosaved_at, last_manual_saved_at, change_summary, editor_state_json
      ) VALUES (
        @id, @workspaceId, @localeVariantId, @name, @baseRevisionId, @state, @createdAt, @updatedAt, NULL,
        @headRevisionId, 1, NULL, @lastManualSavedAt, @changeSummary, NULL
      )`,
      {
        id: branchId,
        workspaceId: proposal.workspaceId,
        localeVariantId: ensuredIdentity.localeVariantId,
        name: branchName,
        baseRevisionId: latestRevision?.id ?? revisionId,
        state: DraftBranchStatus.ACTIVE,
        createdAt: now,
        updatedAt: now,
        headRevisionId: revisionId,
        lastManualSavedAt: now,
        changeSummary: summarizeDraftChanges(diffHtml(latestRevision ? await this.readRevisionSource(resolveRevisionPath(workspacePath, latestRevision.filePath)) : '', html))
      }
    );

    workspaceDb.run(
      `INSERT INTO revisions (
        id, locale_variant_id, revision_type, branch_id, workspace_id, file_path, content_hash, source_revision_id, revision_number, status, created_at, updated_at
      ) VALUES (
        @id, @localeVariantId, @revisionType, @branchId, @workspaceId, @filePath, @contentHash, @sourceRevisionId, @revisionNumber, @status, @createdAt, @updatedAt
      )`,
      {
        id: revisionId,
        localeVariantId: ensuredIdentity.localeVariantId,
        revisionType: RevisionState.DRAFT_BRANCH,
        branchId,
        workspaceId: proposal.workspaceId,
        filePath,
        contentHash: createContentHash(html),
        sourceRevisionId: latestRevision?.id ?? proposal.sourceRevisionId ?? null,
        revisionNumber: nextRevisionNumber,
        status: RevisionStatus.OPEN,
        createdAt: now,
        updatedAt: now
      }
    );
    this.recordDraftRevisionCommit(workspaceDb, {
      revisionId,
      branchId,
      workspaceId: proposal.workspaceId,
      source: DraftCommitSource.PROPOSAL,
      message: 'Created from accepted proposal'
    });
    if (latestRevision) {
      this.recordArticleLineage(workspaceDb, ensuredIdentity.localeVariantId, latestRevision.id, revisionId, 'system', now);
    }

    return {
      reviewStatus: ProposalReviewStatus.ACCEPTED,
      legacyStatus: ProposalDecision.ACCEPT,
      branchId,
      revisionId,
      familyId: ensuredIdentity.familyId,
      localeVariantId: ensuredIdentity.localeVariantId
    };
  }

  private async applyProposalToExistingBranch(
    workspacePath: string,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    proposal: ProposalReviewRecord,
    branchId?: string
  ): Promise<ProposalDecisionMutationResult> {
    const normalizedBranchId = branchId?.trim();
    if (!normalizedBranchId) {
      throw new Error('branchId is required when applying a proposal to an existing branch');
    }

    const branch = workspaceDb.get<{
      id: string;
      localeVariantId: string;
      baseRevisionId: string;
      state: string;
    }>(
      `SELECT id, locale_variant_id as localeVariantId, base_revision_id as baseRevisionId, state
       FROM draft_branches
       WHERE id = @branchId AND workspace_id = @workspaceId
       LIMIT 1`,
      { branchId: normalizedBranchId, workspaceId: proposal.workspaceId }
    );
    if (!branch) {
      throw new Error('Draft branch not found');
    }
    if (branch.state === RevisionState.OBSOLETE) {
      throw new Error('Cannot apply a proposal to an obsolete draft branch');
    }

    const variant = workspaceDb.get<{ familyId: string }>(
      `SELECT family_id as familyId
       FROM locale_variants
       WHERE id = @localeVariantId
       LIMIT 1`,
      { localeVariantId: branch.localeVariantId }
    );
    if (!variant) {
      throw new Error('Locale variant not found');
    }

    const latestRevision = await this.getLatestRevisionForVariant(workspaceDb, branch.localeVariantId);
    const nextRevisionNumber = latestRevision ? latestRevision.revisionNumber + 1 : 1;
    const revisionId = randomUUID();
    const html = await this.getProposalFinalHtml(workspacePath, workspaceDb, proposal);
    const filePath = await this.writeProposalDraftRevision(
      workspacePath,
      branch.localeVariantId,
      normalizedBranchId,
      revisionId,
      nextRevisionNumber,
      html
    );
    const now = new Date().toISOString();

    workspaceDb.run(
      `INSERT INTO revisions (
        id, locale_variant_id, revision_type, branch_id, workspace_id, file_path, content_hash, source_revision_id, revision_number, status, created_at, updated_at
      ) VALUES (
        @id, @localeVariantId, @revisionType, @branchId, @workspaceId, @filePath, @contentHash, @sourceRevisionId, @revisionNumber, @status, @createdAt, @updatedAt
      )`,
      {
        id: revisionId,
        localeVariantId: branch.localeVariantId,
        revisionType: RevisionState.DRAFT_BRANCH,
        branchId: normalizedBranchId,
        workspaceId: proposal.workspaceId,
        filePath,
        contentHash: createContentHash(html),
        sourceRevisionId: latestRevision?.id ?? branch.baseRevisionId,
        revisionNumber: nextRevisionNumber,
        status: RevisionStatus.OPEN,
        createdAt: now,
        updatedAt: now
      }
    );

    workspaceDb.run(
      `UPDATE draft_branches
       SET head_revision_id = @headRevisionId,
           state = @state,
           last_manual_saved_at = @updatedAt,
           change_summary = @changeSummary,
           updated_at = @updatedAt
       WHERE id = @branchId AND workspace_id = @workspaceId`,
      {
        branchId: normalizedBranchId,
        workspaceId: proposal.workspaceId,
        headRevisionId: revisionId,
        state: DraftBranchStatus.ACTIVE,
        updatedAt: now,
        changeSummary: summarizeDraftChanges(diffHtml(latestRevision ? await this.readRevisionSource(resolveRevisionPath(workspacePath, latestRevision.filePath)) : '', html))
      }
    );
    this.recordDraftRevisionCommit(workspaceDb, {
      revisionId,
      branchId: normalizedBranchId,
      workspaceId: proposal.workspaceId,
      source: DraftCommitSource.PROPOSAL,
      message: 'Applied proposal into existing draft branch'
    });
    if (latestRevision) {
      this.recordArticleLineage(workspaceDb, branch.localeVariantId, latestRevision.id, revisionId, 'system', now);
    }

    return {
      reviewStatus: ProposalReviewStatus.APPLIED_TO_BRANCH,
      legacyStatus: ProposalDecision.APPLY_TO_BRANCH,
      branchId: normalizedBranchId,
      revisionId,
      familyId: variant.familyId,
      localeVariantId: branch.localeVariantId
    };
  }

  private markProposalTargetRetired(
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    proposal: ProposalReviewRecord
  ): ProposalDecisionMutationResult {
    const retiredAtUtc = new Date().toISOString();

    if (proposal.localeVariantId) {
      workspaceDb.run(
        `UPDATE locale_variants
         SET status = @status,
             retired_at = @retiredAtUtc
         WHERE id = @variantId`,
        {
          variantId: proposal.localeVariantId,
          status: RevisionState.RETIRED,
          retiredAtUtc
        }
      );
      workspaceDb.run(
        `UPDATE draft_branches
         SET state = @state,
             updated_at = @updatedAt
         WHERE workspace_id = @workspaceId AND locale_variant_id = @localeVariantId AND state != @state`,
        {
          workspaceId: proposal.workspaceId,
          localeVariantId: proposal.localeVariantId,
          state: RevisionState.OBSOLETE,
          updatedAt: retiredAtUtc
        }
      );

      const family = workspaceDb.get<{ familyId: string }>(
        `SELECT family_id as familyId
         FROM locale_variants
         WHERE id = @variantId
         LIMIT 1`,
        { variantId: proposal.localeVariantId }
      );

      return {
        reviewStatus: ProposalReviewStatus.ACCEPTED,
        legacyStatus: ProposalDecision.ACCEPT,
        familyId: proposal.familyId ?? family?.familyId,
        localeVariantId: proposal.localeVariantId,
        retiredAtUtc
      };
    }

    if (!proposal.familyId) {
      throw new Error('Retire proposals must target a locale variant or article family');
    }

    workspaceDb.run(
      `UPDATE article_families
       SET retired_at = @retiredAtUtc
       WHERE id = @familyId AND workspace_id = @workspaceId`,
      {
        familyId: proposal.familyId,
        workspaceId: proposal.workspaceId,
        retiredAtUtc
      }
    );
    workspaceDb.run(
      `UPDATE locale_variants
       SET status = @status,
           retired_at = @retiredAtUtc
       WHERE family_id = @familyId`,
      {
        familyId: proposal.familyId,
        status: RevisionState.RETIRED,
        retiredAtUtc
      }
    );
    workspaceDb.run(
      `UPDATE draft_branches
       SET state = @state,
           updated_at = @updatedAt
       WHERE workspace_id = @workspaceId
         AND locale_variant_id IN (
           SELECT id
           FROM locale_variants
           WHERE family_id = @familyId
         )
         AND state != @state`,
      {
        familyId: proposal.familyId,
        workspaceId: proposal.workspaceId,
        state: RevisionState.OBSOLETE,
        updatedAt: retiredAtUtc
      }
    );

    return {
      reviewStatus: ProposalReviewStatus.ACCEPTED,
      legacyStatus: ProposalDecision.ACCEPT,
      familyId: proposal.familyId,
      retiredAtUtc
    };
  }

  private async ensureProposalTargetIdentity(
    workspacePath: string,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    proposal: ProposalReviewRecord,
    placementOverride?: ProposalPlacementSuggestion
  ): Promise<{ familyId: string; localeVariantId: string }> {
    if (proposal.localeVariantId) {
      const variant = workspaceDb.get<{ familyId: string }>(
        `SELECT family_id as familyId
         FROM locale_variants
         WHERE id = @variantId
         LIMIT 1`,
        { variantId: proposal.localeVariantId }
      );
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
    } else if (placement?.categoryId || placement?.sectionId) {
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
        status: RevisionState.DRAFT_BRANCH
      });
    }

    return {
      familyId,
      localeVariantId: localeVariant.id
    };
  }

  private async getLatestRevisionForVariant(
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    localeVariantId: string,
    revisionType?: RevisionState
  ): Promise<RevisionRecord | null> {
    const row = workspaceDb.get<RevisionRecord>(
      `SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
              workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
              revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
       FROM revisions
       WHERE locale_variant_id = @localeVariantId
         ${revisionType ? 'AND revision_type = @revisionType' : ''}
       ORDER BY revision_number DESC
       LIMIT 1`,
      { localeVariantId, revisionType }
    );
    return row ?? null;
  }

  private async getProposalFinalHtml(
    workspacePath: string,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    proposal: ProposalReviewRecord
  ): Promise<string> {
    const relatedPbis = [] as PBIRecord[];
    const hydrated = await this.ensureProposalReviewArtifacts(
      workspacePath,
      workspaceDb,
      proposal,
      relatedPbis
    );
    return hydrated.afterHtml || hydrated.beforeHtml;
  }

  private buildProposalBranchName(proposal: ProposalReviewRecord, revisionNumber: number): string {
    const base = proposal.targetTitle?.trim() || deriveProposalArticleDescriptor(proposal).articleLabel;
    return `${base} Draft ${revisionNumber}`;
  }

  private async writeProposalDraftRevision(
    workspacePath: string,
    localeVariantId: string,
    branchId: string,
    revisionId: string,
    revisionNumber: number,
    html: string
  ): Promise<string> {
    const branchDir = path.join(workspacePath, 'drafts', localeVariantId, branchId);
    await fs.mkdir(branchDir, { recursive: true });
    const fileName = `${String(revisionNumber).padStart(4, '0')}-${revisionId}.html`;
    const absolutePath = path.join(branchDir, fileName);
    await fs.writeFile(absolutePath, html || '', 'utf8');
    return path.relative(workspacePath, absolutePath);
  }

  private async ensureProposalReviewArtifacts(
    workspacePath: string,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    proposal: ProposalReviewRecord,
    relatedPbis: PBIRecord[]
  ): Promise<{ proposal: ProposalReviewRecord; beforeHtml: string; afterHtml: string }> {
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

    workspaceDb.run(
      `UPDATE proposals
       SET source_html_path = @sourceHtmlPath,
           proposed_html_path = @proposedHtmlPath,
           updated_at = @updatedAt
       WHERE id = @proposalId`,
      {
        proposalId: proposal.id,
        sourceHtmlPath: nextSourceHtmlPath,
        proposedHtmlPath: nextProposedHtmlPath,
        updatedAt: new Date().toISOString()
      }
    );

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

  private async resolveProposalSourceHtml(
    workspacePath: string,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    proposal: ProposalReviewRecord
  ): Promise<string> {
    const revision = proposal.sourceRevisionId
      ? workspaceDb.get<{ filePath: string }>(
          `SELECT file_path as filePath
           FROM revisions
           WHERE id = @revisionId
           LIMIT 1`,
          { revisionId: proposal.sourceRevisionId }
        ) ?? null
      : proposal.localeVariantId
        ? workspaceDb.get<{ filePath: string }>(
            `SELECT file_path as filePath
             FROM revisions
             WHERE locale_variant_id = @localeVariantId
               AND revision_type = 'live'
             ORDER BY revision_number DESC
             LIMIT 1`,
            { localeVariantId: proposal.localeVariantId }
          ) ?? workspaceDb.get<{ filePath: string }>(
            `SELECT file_path as filePath
             FROM revisions
             WHERE locale_variant_id = @localeVariantId
             ORDER BY revision_number DESC
             LIMIT 1`,
            { localeVariantId: proposal.localeVariantId }
          ) ?? null
        : null;

    if (!revision?.filePath) {
      return '';
    }

    return this.readRevisionSource(resolveRevisionPath(workspacePath, revision.filePath));
  }

  private hydrateProposalDisplayFields(
    proposal: ProposalReviewRecord,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>
  ): ProposalReviewRecord {
    if (proposal.targetTitle && proposal.targetTitle.trim()) {
      return proposal;
    }

    let familyId = proposal.familyId;
    let targetLocale = proposal.targetLocale;
    let targetTitle = proposal.targetTitle;

    if (proposal.localeVariantId) {
      const localeVariant = workspaceDb.get<{ familyId: string; locale: string; familyTitle: string }>(
        `SELECT lv.family_id as familyId,
                lv.locale as locale,
                af.title as familyTitle
         FROM locale_variants lv
         JOIN article_families af ON af.id = lv.family_id
         WHERE lv.id = @localeVariantId
         LIMIT 1`,
        { localeVariantId: proposal.localeVariantId }
      );
      if (localeVariant) {
        familyId = familyId ?? localeVariant.familyId;
        targetLocale = targetLocale ?? localeVariant.locale;
        targetTitle = targetTitle ?? localeVariant.familyTitle;
      }
    }

    if (!targetTitle && familyId) {
      const family = workspaceDb.get<{ title: string }>(
        `SELECT title
         FROM article_families
         WHERE id = @familyId
         LIMIT 1`,
        { familyId }
      );
      targetTitle = family?.title?.trim() || targetTitle;
    }

    if (!targetTitle) {
      targetTitle = inferProposalTitleFromText(
        proposal.action,
        proposal.rationaleSummary ?? proposal.aiNotes
      );
    }

    return {
      ...proposal,
      familyId,
      targetLocale,
      targetTitle: targetTitle || undefined
    };
  }

  private async resolveProposalIdentity(
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    payload: {
      workspaceId: string;
      action: ProposalAction;
      localeVariantId?: string;
      familyId?: string;
      targetTitle?: string;
      targetLocale?: string;
      note?: string;
      rationale?: string;
      metadata: Record<string, unknown>;
    }
  ): Promise<{ familyId?: string; targetTitle?: string; targetLocale?: string }> {
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
      const localeVariant = workspaceDb.get<{ familyId: string; locale: string; familyTitle: string }>(
        `SELECT lv.family_id as familyId,
                lv.locale as locale,
                af.title as familyTitle
         FROM locale_variants lv
         JOIN article_families af ON af.id = lv.family_id
         WHERE lv.id = @localeVariantId
         LIMIT 1`,
        { localeVariantId }
      );
      if (localeVariant) {
        familyId = familyId ?? localeVariant.familyId;
        targetLocale = targetLocale ?? localeVariant.locale;
        targetTitle = targetTitle ?? localeVariant.familyTitle;
      }
    }

    if (!targetTitle && familyId) {
      const family = workspaceDb.get<{ title: string }>(
        `SELECT title
         FROM article_families
         WHERE id = @familyId
         LIMIT 1`,
        { familyId }
      );
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

  private buildFallbackProposalHtml(
    proposal: ProposalReviewRecord,
    relatedPbis: PBIRecord[],
    sourceHtml: string
  ): string {
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

    if (proposal.action === ProposalAction.EDIT && sourceHtml) {
      return `${summaryBlock}\n${sourceHtml}`;
    }

    if (proposal.action === ProposalAction.RETIRE && sourceHtml) {
      return `${summaryBlock}\n${sourceHtml}`;
    }

    return summaryBlock;
  }

  private async readProposalArtifact(workspacePath: string, artifactPath?: string): Promise<string> {
    if (!artifactPath) {
      return '';
    }
    try {
      return await fs.readFile(resolveRevisionPath(workspacePath, artifactPath), 'utf8');
    } catch {
      return '';
    }
  }

  private mapProposalRow(row: ProposalDbRow): ProposalReviewRecord {
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
      suggestedPlacement: safeParseJson<ProposalPlacementSuggestion>(row.suggestedPlacementJson) ?? undefined,
      sourceHtmlPath: row.sourceHtmlPath ?? undefined,
      proposedHtmlPath: row.proposedHtmlPath ?? undefined,
      metadata: safeParseJson(row.metadataJson) ?? undefined,
      queueOrder: row.queueOrder ?? 0,
      generatedAtUtc: row.generatedAtUtc,
      updatedAtUtc: row.updatedAtUtc,
      decidedAtUtc: row.decidedAtUtc ?? undefined
    };
  }

  private getDraftBranchRow(
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    workspaceId: string,
    branchId: string
  ): DraftBranchDbRow {
    const branch = workspaceDb.get<DraftBranchDbRow>(
      `SELECT id,
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
       LIMIT 1`,
      { branchId, workspaceId }
    );
    if (!branch) {
      throw new Error('Draft branch not found');
    }
    return branch;
  }

  private async buildDraftBranchSummary(
    workspacePath: string,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    branch: DraftBranchDbRow
  ): Promise<DraftBranchSummary> {
    const variant = workspaceDb.get<{ familyId: string; locale: string; familyTitle: string }>(
      `SELECT lv.family_id as familyId, lv.locale, af.title as familyTitle
       FROM locale_variants lv
       JOIN article_families af ON af.id = lv.family_id
       WHERE lv.id = @localeVariantId
       LIMIT 1`,
      { localeVariantId: branch.localeVariantId }
    );
    if (!variant) {
      throw new Error('Locale variant not found');
    }

    const liveRevision = await this.getLatestRevisionForVariant(workspaceDb, branch.localeVariantId, RevisionState.LIVE);
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
      changeSummary: branch.changeSummary ?? summarizeDraftChanges(diffHtml(liveRevision ? await this.readRevisionSource(resolveRevisionPath(workspacePath, liveRevision.filePath)) : '', headHtml)),
      validationSummary: summarizeDraftValidationWarnings(validationWarnings)
    };
  }

  private async buildDraftEditorPayload(
    workspacePath: string,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    branch: DraftBranchDbRow,
    summary: DraftBranchSummary
  ): Promise<DraftEditorPayload> {
    const headRevision = await this.getDraftBranchHeadRevision(workspaceDb, branch);
    if (!headRevision) {
      throw new Error('Draft branch has no revision history');
    }
    const liveRevision = summary.liveRevisionId
      ? await this.getRevisionById(workspaceDb, summary.liveRevisionId)
      : null;
    const html = await this.readRevisionSource(resolveRevisionPath(workspacePath, headRevision.filePath));
    const liveHtml = liveRevision ? await this.readRevisionSource(resolveRevisionPath(workspacePath, liveRevision.filePath)) : '';
    const compareDiff = diffHtml(liveHtml, html);
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
      editorState: safeParseJson<Record<string, unknown>>(branch.editorStateJson) ?? undefined
    };
  }

  private mapTemplatePackSummary(
    row: TemplatePackRecord & { templateType?: string | null; description?: string | null; analysisJson?: string | null }
  ): TemplatePackDetail {
    const analysis = safeParseJson<TemplatePackAnalysis>(row.analysisJson);
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

  private async ensureDefaultTemplatePacks(
    workspaceId: string,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>
  ): Promise<void> {
    const count = workspaceDb.get<{ total: number }>(
      `SELECT COUNT(*) as total FROM template_packs WHERE workspace_id = @workspaceId`,
      { workspaceId }
    )?.total ?? 0;
    if (count > 0) {
      return;
    }

    const now = new Date().toISOString();
    for (const template of buildDefaultTemplatePacks(workspaceId)) {
      workspaceDb.run(
        `INSERT INTO template_packs (
          id, workspace_id, name, language, prompt_template, tone_rules, examples, active, updated_at, template_type, description, analysis_json
        ) VALUES (
          @id, @workspaceId, @name, @language, @promptTemplate, @toneRules, @examples, @active, @updatedAt, @templateType, @description, NULL
        )`,
        {
          ...template,
          active: template.active ? 1 : 0,
          updatedAt: now
        }
      );
    }
  }

  private async resolveArticleAiTarget(
    workspacePath: string,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    input: ArticleAiSessionGetRequest
  ): Promise<{
    workspaceId: string;
    localeVariantId: string;
    branchId?: string;
    targetType: 'live_article' | 'draft_branch';
    familyId: string;
    familyTitle: string;
    locale: string;
    revisionId: string;
    revisionNumber: number;
    currentHtml: string;
  }> {
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

    const variant = await this.getLocaleVariant(input.workspaceId, input.localeVariantId!);
    const family = workspaceDb.get<ArticleFamilyRecord>(
      `SELECT id, workspace_id as workspaceId, external_key as externalKey, title, section_id as sectionId, category_id as categoryId, retired_at as retiredAtUtc
       FROM article_families
       WHERE id = @familyId`,
      { familyId: variant.familyId }
    );
    const revision = await this.getLatestRevision(input.workspaceId, input.localeVariantId!, RevisionState.LIVE)
      ?? await this.getLatestRevision(input.workspaceId, input.localeVariantId!);
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

  private async createArticleAiSessionRow(
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    target: Awaited<ReturnType<WorkspaceRepository['resolveArticleAiTarget']>>
  ): Promise<ArticleAiSessionDbRow> {
    const now = new Date().toISOString();
    const id = randomUUID();
    workspaceDb.run(
      `INSERT INTO article_ai_sessions (
        id, workspace_id, locale_variant_id, branch_id, target_type, current_revision_id, current_html,
        pending_html, pending_summary, pending_rationale, pending_metadata_json, template_pack_id, runtime_session_id, status, created_at, updated_at
      ) VALUES (
        @id, @workspaceId, @localeVariantId, @branchId, @targetType, @currentRevisionId, @currentHtml,
        NULL, NULL, NULL, NULL, NULL, NULL, @status, @createdAt, @updatedAt
      )`,
      {
        id,
        workspaceId: target.workspaceId,
        localeVariantId: target.localeVariantId,
        branchId: target.branchId ?? null,
        targetType: target.targetType,
        currentRevisionId: target.revisionId,
        currentHtml: target.currentHtml,
        status: ArticleAiSessionStatus.IDLE,
        createdAt: now,
        updatedAt: now
      }
    );
    return this.requireArticleAiSession(workspaceDb, target.workspaceId, id);
  }

  private requireArticleAiSession(
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    workspaceId: string,
    sessionId: string
  ): ArticleAiSessionDbRow {
    const session = workspaceDb.get<ArticleAiSessionDbRow>(
      `SELECT id,
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
       WHERE workspace_id = @workspaceId AND id = @sessionId`,
      { workspaceId, sessionId }
    );
    if (!session) {
      throw new Error('Article AI session not found');
    }
    return session;
  }

  private async insertArticleAiMessage(
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    row: ArticleAiMessageDbRow
  ): Promise<void> {
    workspaceDb.run(
      `INSERT INTO article_ai_messages (
        id, session_id, workspace_id, role, message_kind, preset_action, content, metadata_json, created_at
      ) VALUES (
        @id, @sessionId, @workspaceId, @role, @messageKind, @presetAction, @content, @metadataJson, @createdAtUtc
      )`,
      {
        ...row,
        presetAction: row.presetAction ?? null,
        metadataJson: row.metadataJson ?? null
      }
    );
  }

  private async buildArticleAiSessionResponse(
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    target: Awaited<ReturnType<WorkspaceRepository['resolveArticleAiTarget']>>,
    sessionRow: ArticleAiSessionDbRow
  ): Promise<ArticleAiSessionResponse> {
    const messages = workspaceDb.all<ArticleAiMessageDbRow>(
      `SELECT id,
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
       ORDER BY created_at ASC`,
      {
        workspaceId: target.workspaceId,
        sessionId: sessionRow.id
      }
    ).map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      role: row.role as ArticleAiMessageRole,
      kind: row.messageKind as ArticleAiMessageKind,
      content: row.content,
      presetAction: row.presetAction ? row.presetAction as ArticleAiPresetAction : undefined,
      metadata: safeParseJson<Record<string, unknown>>(row.metadataJson) ?? undefined,
      createdAtUtc: row.createdAtUtc
    })) as ArticleAiChatMessage[];

    const pendingEdit = sessionRow.pendingHtml
      ? {
          basedOnRevisionId: sessionRow.currentRevisionId,
          currentHtml: sessionRow.currentHtml,
          proposedHtml: sessionRow.pendingHtml,
          previewHtml: sessionRow.pendingHtml,
          summary: sessionRow.pendingSummary ?? 'AI suggested update',
          rationale: sessionRow.pendingRationale ?? undefined,
          diff: mapDiffToProposalPayload(diffHtml(sessionRow.currentHtml, sessionRow.pendingHtml)),
          updatedAtUtc: sessionRow.updatedAtUtc
        } satisfies ArticleAiPendingEdit
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

  private async getDraftBranchHtml(
    workspacePath: string,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    workspaceId: string,
    branchId: string
  ): Promise<string> {
    const branch = this.getDraftBranchRow(workspaceDb, workspaceId, branchId);
    const headRevision = await this.getDraftBranchHeadRevision(workspaceDb, branch);
    if (!headRevision) {
      throw new Error('Draft branch has no revision history');
    }
    return this.readRevisionSource(resolveRevisionPath(workspacePath, headRevision.filePath));
  }

  private async validateDraftBranchHtml(
    workspacePath: string,
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    branch: DraftBranchDbRow,
    html: string
  ): Promise<DraftValidationWarning[]> {
    const warnings: DraftValidationWarning[] = [];
    const variant = workspaceDb.get<{ locale: string; familyId: string }>(
      `SELECT locale, family_id as familyId
       FROM locale_variants
       WHERE id = @localeVariantId
       LIMIT 1`,
      { localeVariantId: branch.localeVariantId }
    );
    const family = variant
      ? workspaceDb.get<{ sectionId: string | null; categoryId: string | null }>(
          `SELECT section_id as sectionId, category_id as categoryId
           FROM article_families
           WHERE id = @familyId
           LIMIT 1`,
          { familyId: variant.familyId }
        )
      : null;
    const enabledLocales = (await this.getWorkspaceSettings(branch.workspaceId)).enabledLocales;

    const unsupportedTags = ['script', 'iframe', 'style', 'object', 'embed'];
    for (const tag of unsupportedTags) {
      if (new RegExp(`<${tag}\\b`, 'i').test(html)) {
        warnings.push({
          code: DraftValidationCode.UNSUPPORTED_TAG,
          severity: DraftValidationSeverity.ERROR,
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
        code: DraftValidationCode.UNRESOLVED_PLACEHOLDER,
        severity: DraftValidationSeverity.WARNING,
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
        code: DraftValidationCode.MISSING_PLACEMENT,
        severity: DraftValidationSeverity.WARNING,
        message: 'New draft target is missing category or section placement metadata.'
      });
    }

    if (variant?.locale && !enabledLocales.includes(variant.locale)) {
      warnings.push({
        code: DraftValidationCode.LOCALE_ISSUE,
        severity: DraftValidationSeverity.WARNING,
        message: `Locale ${variant.locale} is not currently enabled for this workspace.`,
        detail: variant.locale
      });
    }

    return warnings;
  }

  private async getDraftBranchHeadRevision(
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    branch: DraftBranchDbRow
  ): Promise<RevisionRecord | null> {
    if (branch.headRevisionId) {
      const head = await this.getRevisionById(workspaceDb, branch.headRevisionId);
      if (head) {
        return head;
      }
    }
    return workspaceDb.get<RevisionRecord>(
      `SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
              workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
              revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
       FROM revisions
       WHERE branch_id = @branchId
       ORDER BY revision_number DESC
       LIMIT 1`,
      { branchId: branch.id }
    ) ?? null;
  }

  private async getRevisionById(
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    revisionId: string
  ): Promise<RevisionRecord | null> {
    return workspaceDb.get<RevisionRecord>(
      `SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
              workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
              revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
       FROM revisions
       WHERE id = @revisionId
       LIMIT 1`,
      { revisionId }
    ) ?? null;
  }

  private async getRevisionNumberById(
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    revisionId: string
  ): Promise<number | undefined> {
    const row = workspaceDb.get<{ revisionNumber: number }>(
      `SELECT revision_number as revisionNumber
       FROM revisions
       WHERE id = @revisionId
       LIMIT 1`,
      { revisionId }
    );
    return row?.revisionNumber;
  }

  private listDraftBranchHistory(
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    branchId: string,
    headRevisionId: string
  ): DraftBranchHistoryEntry[] {
    const revisions = workspaceDb.all<RevisionRecord>(
      `SELECT id, locale_variant_id as localeVariantId, revision_type as revisionType, branch_id as branchId,
              workspace_id as workspaceId, file_path as filePath, content_hash as contentHash, source_revision_id as sourceRevisionId,
              revision_number as revisionNumber, status, created_at as createdAtUtc, updated_at as updatedAtUtc
       FROM revisions
       WHERE branch_id = @branchId
       ORDER BY revision_number DESC`,
      { branchId }
    );
    const commits = workspaceDb.all<DraftRevisionCommitRow>(
      `SELECT revision_id as revisionId,
              branch_id as branchId,
              workspace_id as workspaceId,
              commit_kind as commitKind,
              commit_message as commitMessage,
              created_at as createdAtUtc
       FROM draft_revision_commits
       WHERE branch_id = @branchId
       ORDER BY created_at DESC`,
      { branchId }
    );
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

  private recordDraftRevisionCommit(
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    payload: { revisionId: string; branchId: string; workspaceId: string; source: DraftCommitSource; message?: string }
  ): void {
    workspaceDb.run(
      `INSERT OR REPLACE INTO draft_revision_commits (
        revision_id, branch_id, workspace_id, commit_kind, commit_message, created_at
      ) VALUES (
        @revisionId, @branchId, @workspaceId, @commitKind, @commitMessage, @createdAt
      )`,
      {
        revisionId: payload.revisionId,
        branchId: payload.branchId,
        workspaceId: payload.workspaceId,
        commitKind: payload.source,
        commitMessage: payload.message ?? null,
        createdAt: new Date().toISOString()
      }
    );
  }

  private recordArticleLineage(
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    localeVariantId: string,
    predecessorRevisionId: string,
    successorRevisionId: string,
    createdBy: 'system' | 'manual',
    createdAtUtc: string
  ): void {
    workspaceDb.run(
      `INSERT INTO article_lineage (
        id, locale_variant_id, predecessor_revision_id, successor_revision_id, created_by, created_at
      ) VALUES (
        @id, @localeVariantId, @predecessorRevisionId, @successorRevisionId, @createdBy, @createdAt
      )`,
      {
        id: randomUUID(),
        localeVariantId,
        predecessorRevisionId,
        successorRevisionId,
        createdBy,
        createdAt: createdAtUtc
      }
    );
  }

  private async stepDraftBranchHistory(
    workspaceId: string,
    branchId: string,
    offset: -1 | 1
  ): Promise<DraftBranchGetResponse> {
    const workspace = await this.getWorkspace(workspaceId);
    const workspaceDb = this.openWorkspaceDbWithRecovery(path.join(workspace.path, '.meta', DEFAULT_DB_FILE));
    try {
      const branch = this.getDraftBranchRow(workspaceDb, workspaceId, branchId);
      const revisions = workspaceDb.all<{ id: string }>(
        `SELECT id
         FROM revisions
         WHERE branch_id = @branchId
         ORDER BY revision_number ASC`,
        { branchId }
      );
      const currentHeadId = (await this.getDraftBranchHeadRevision(workspaceDb, branch))?.id;
      const currentIndex = revisions.findIndex((revision) => revision.id === currentHeadId);
      const nextIndex = currentIndex + offset;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= revisions.length) {
        return this.getDraftBranchEditor(workspaceId, branchId);
      }
      workspaceDb.run(
        `UPDATE draft_branches
         SET head_revision_id = @headRevisionId,
             updated_at = @updatedAt
         WHERE id = @branchId AND workspace_id = @workspaceId`,
        {
          branchId,
          workspaceId,
          headRevisionId: revisions[nextIndex].id,
          updatedAt: new Date().toISOString()
        }
      );
      return this.getDraftBranchEditor(workspaceId, branchId);
    } finally {
      workspaceDb.close();
    }
  }

  private async syncBatchReviewStatus(
    workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
    workspaceId: string,
    batchId: string
  ): Promise<PBIBatchStatus> {
    const rows = workspaceDb.all<{ reviewStatus: string }>(
      `SELECT review_status as reviewStatus
       FROM proposals
       WHERE workspace_id = @workspaceId AND batch_id = @batchId`,
      { workspaceId, batchId }
    );

    const normalized = rows.map((row) => normalizeReviewStatus(row.reviewStatus));
    let nextStatus = PBIBatchStatus.ANALYZED;
    if (normalized.length > 0) {
      nextStatus = normalized.some((status) => status === ProposalReviewStatus.PENDING_REVIEW)
        ? PBIBatchStatus.REVIEW_IN_PROGRESS
        : PBIBatchStatus.REVIEW_COMPLETE;
    }

    workspaceDb.run(
      `UPDATE pbi_batches
       SET status = @status
       WHERE id = @batchId AND workspace_id = @workspaceId`,
      { status: nextStatus, batchId, workspaceId }
    );

    return nextStatus;
  }
}

function normalizeSearchScope(scope: SearchContext['scope'] | undefined): SearchContext['scope'] {
  if (scope === 'live' || scope === 'drafts' || scope === 'retired' || scope === 'conflicted' || scope === 'all') {
    return scope;
  }
  return 'all';
}

function normalizeDraftBranchStatus(value: string | null | undefined, hasConflict = false): DraftBranchStatus {
  switch (value) {
    case DraftBranchStatus.READY_TO_PUBLISH:
    case DraftBranchStatus.PUBLISHED:
    case DraftBranchStatus.OBSOLETE:
    case DraftBranchStatus.DISCARDED:
      return value;
    case DraftBranchStatus.CONFLICTED:
      return DraftBranchStatus.CONFLICTED;
    case DraftBranchStatus.ACTIVE:
    case RevisionState.DRAFT_BRANCH:
    default:
      return hasConflict ? DraftBranchStatus.CONFLICTED : DraftBranchStatus.ACTIVE;
  }
}

function normalizeDraftCommitSource(value: string | null | undefined): DraftCommitSource {
  switch (value) {
    case DraftCommitSource.PROPOSAL:
    case DraftCommitSource.MANUAL:
    case DraftCommitSource.AUTOSAVE:
      return value;
    case DraftCommitSource.SYSTEM:
    default:
      return DraftCommitSource.SYSTEM;
  }
}

function normalizeArticleAiSessionStatus(value: string | null | undefined): ArticleAiSessionStatus {
  switch (value) {
    case ArticleAiSessionStatus.RUNNING:
    case ArticleAiSessionStatus.HAS_PENDING_EDIT:
      return value;
    case ArticleAiSessionStatus.IDLE:
    default:
      return ArticleAiSessionStatus.IDLE;
  }
}

function normalizeTemplatePackType(value: string | null | undefined): TemplatePackType {
  switch (value) {
    case TemplatePackType.FAQ:
    case TemplatePackType.TROUBLESHOOTING:
    case TemplatePackType.POLICY_NOTICE:
    case TemplatePackType.FEATURE_OVERVIEW:
      return value;
    case TemplatePackType.STANDARD_HOW_TO:
    default:
      return TemplatePackType.STANDARD_HOW_TO;
  }
}

function summarizeDraftBranchStatuses(branches: DraftBranchSummary[]): DraftBranchSummaryCounts {
  const summary: DraftBranchSummaryCounts = {
    total: branches.length,
    active: 0,
    readyToPublish: 0,
    conflicted: 0,
    obsolete: 0,
    discarded: 0
  };
  for (const branch of branches) {
    switch (branch.status) {
      case DraftBranchStatus.READY_TO_PUBLISH:
        summary.readyToPublish += 1;
        break;
      case DraftBranchStatus.CONFLICTED:
        summary.conflicted += 1;
        break;
      case DraftBranchStatus.OBSOLETE:
        summary.obsolete += 1;
        break;
      case DraftBranchStatus.DISCARDED:
        summary.discarded += 1;
        break;
      case DraftBranchStatus.ACTIVE:
      case DraftBranchStatus.PUBLISHED:
      default:
        summary.active += 1;
        break;
    }
  }
  return summary;
}

function summarizeDraftValidationWarnings(warnings: DraftValidationWarning[]): DraftValidationSummary {
  const summary: DraftValidationSummary = {
    total: warnings.length,
    errors: 0,
    warnings: 0,
    infos: 0
  };
  for (const warning of warnings) {
    if (warning.severity === DraftValidationSeverity.ERROR) {
      summary.errors += 1;
    } else if (warning.severity === DraftValidationSeverity.WARNING) {
      summary.warnings += 1;
    } else {
      summary.infos += 1;
    }
  }
  return summary;
}

const ARTICLE_AI_PRESETS = [
  {
    action: ArticleAiPresetAction.REWRITE_TONE,
    label: 'Rewrite for tone',
    description: 'Adjust voice and clarity without changing core meaning.'
  },
  {
    action: ArticleAiPresetAction.SHORTEN,
    label: 'Shorten',
    description: 'Reduce length and tighten repetition.'
  },
  {
    action: ArticleAiPresetAction.EXPAND,
    label: 'Expand',
    description: 'Add missing context, steps, or examples.'
  },
  {
    action: ArticleAiPresetAction.RESTRUCTURE,
    label: 'Restructure',
    description: 'Reorganize sections for better flow.'
  },
  {
    action: ArticleAiPresetAction.CONVERT_TO_TROUBLESHOOTING,
    label: 'Troubleshooting',
    description: 'Convert the content into a diagnosis-and-resolution format.'
  },
  {
    action: ArticleAiPresetAction.ALIGN_TO_TEMPLATE,
    label: 'Align to template',
    description: 'Reshape the article to match a selected template pack.'
  },
  {
    action: ArticleAiPresetAction.UPDATE_LOCALE,
    label: 'Update locale',
    description: 'Adapt language and locale expectations, including Spanish flows.'
  },
  {
    action: ArticleAiPresetAction.INSERT_IMAGE_PLACEHOLDERS,
    label: 'Insert placeholders',
    description: 'Add image placeholder markers where screenshots would help.'
  }
] as const;

function buildDefaultTemplatePacks(workspaceId: string): Array<{
  id: string;
  workspaceId: string;
  name: string;
  language: string;
  promptTemplate: string;
  toneRules: string;
  examples?: string;
  active: boolean;
  templateType: TemplatePackType;
  description?: string;
}> {
  return [
    {
      id: randomUUID(),
      workspaceId,
      name: 'Standard How-To',
      language: 'en-us',
      templateType: TemplatePackType.STANDARD_HOW_TO,
      promptTemplate: 'Write a task-focused help article with a short introduction, prerequisites when needed, numbered steps, and a clear outcome.',
      toneRules: 'Use concise, direct instructions. Prefer active voice, plain language, and short paragraphs.',
      examples: '<h1>Update notification settings</h1><p>Use this article to change notification preferences.</p><ol><li>Open Settings.</li><li>Select Notifications.</li><li>Choose your preferences.</li></ol>',
      active: true,
      description: 'Default step-by-step article structure.'
    },
    {
      id: randomUUID(),
      workspaceId,
      name: 'FAQ',
      language: 'en-us',
      templateType: TemplatePackType.FAQ,
      promptTemplate: 'Organize the article as common user questions with concise answers and only the context needed to resolve each question.',
      toneRules: 'Keep answers skimmable. Start with the direct answer, then add supporting detail.',
      active: true,
      description: 'Question-and-answer format for recurring support issues.'
    },
    {
      id: randomUUID(),
      workspaceId,
      name: 'Troubleshooting',
      language: 'en-us',
      templateType: TemplatePackType.TROUBLESHOOTING,
      promptTemplate: 'Structure the article around symptoms, likely causes, and resolution steps. Call out prerequisites before risky actions.',
      toneRules: 'Lead with symptom recognition, then progress from least risky to most invasive fixes.',
      active: true,
      description: 'Diagnostic format for problem solving.'
    },
    {
      id: randomUUID(),
      workspaceId,
      name: 'Policy / Notice',
      language: 'en-us',
      templateType: TemplatePackType.POLICY_NOTICE,
      promptTemplate: 'Write a factual policy or notice article with clear effective scope, impacted users, and any action required.',
      toneRules: 'Be precise and neutral. Avoid unnecessary marketing language.',
      active: true,
      description: 'For policy changes, deprecations, and operational notices.'
    },
    {
      id: randomUUID(),
      workspaceId,
      name: 'Feature Overview',
      language: 'en-us',
      templateType: TemplatePackType.FEATURE_OVERVIEW,
      promptTemplate: 'Introduce the feature, who it is for, what it helps accomplish, and the primary workflows it unlocks.',
      toneRules: 'Use benefit-first framing without losing implementation accuracy.',
      active: true,
      description: 'High-level overview for new or changed features.'
    }
  ];
}

function buildTemplatePackAnalysis(template: TemplatePackDetail): TemplatePackAnalysis {
  const suggestions: TemplatePackAnalysis['suggestions'] = [];
  const strengths: string[] = [];
  const gaps: string[] = [];
  let score = 50;

  if (template.promptTemplate.trim().length >= 80) {
    strengths.push('Prompt template has enough structure to guide article generation.');
    score += 15;
  } else {
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
  } else {
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
  } else {
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

function mapDiffToProposalPayload(diff: ReturnType<typeof diffHtml>): DraftComparePayload['diff'] {
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

function summarizeDraftChanges(diff: ReturnType<typeof diffHtml>): string {
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

function detectHtmlIntegrityWarning(html: string): DraftValidationWarning | null {
  const voidTags = new Set(['br', 'hr', 'img', 'meta', 'input', 'link', 'source']);
  const stack: string[] = [];
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
          code: DraftValidationCode.INVALID_HTML,
          severity: DraftValidationSeverity.ERROR,
          message: `HTML structure looks invalid near closing </${tag}>.`,
          detail: tag
        };
      }
    } else {
      stack.push(tag);
    }
    match = tagPattern.exec(html);
  }
  if (stack.length > 0) {
    return {
      code: DraftValidationCode.INVALID_HTML,
      severity: DraftValidationSeverity.ERROR,
      message: `HTML structure looks invalid; unclosed <${stack[stack.length - 1]}> tag detected.`,
      detail: stack[stack.length - 1]
    };
  }
  return null;
}

function summaryPlacementExists(value: { sectionId: string | null; categoryId: string | null } | null | undefined): boolean {
  return Boolean(value?.sectionId || value?.categoryId);
}

function summaryHasLiveRevision(
  workspaceDb: ReturnType<WorkspaceRepository['openWorkspaceDbWithRecovery']>,
  localeVariantId: string
): boolean {
  const row = workspaceDb.get<{ total: number }>(
    `SELECT COUNT(*) as total
     FROM revisions
     WHERE locale_variant_id = @localeVariantId
       AND revision_type = @revisionType`,
    { localeVariantId, revisionType: RevisionState.LIVE }
  );
  return (row?.total ?? 0) > 0;
}

function createContentHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeReviewStatus(value: string | null | undefined): ProposalReviewStatus {
  switch (value) {
    case ProposalReviewStatus.ACCEPTED:
    case ProposalReviewStatus.DENIED:
    case ProposalReviewStatus.DEFERRED:
    case ProposalReviewStatus.APPLIED_TO_BRANCH:
    case ProposalReviewStatus.ARCHIVED:
    case ProposalReviewStatus.PENDING_REVIEW:
      return value;
    default:
      return ProposalReviewStatus.PENDING_REVIEW;
  }
}

function mapReviewDecisionToStatus(decision: ProposalReviewDecision): ProposalReviewStatus {
  switch (decision) {
    case ProposalReviewDecision.ACCEPT:
      return ProposalReviewStatus.ACCEPTED;
    case ProposalReviewDecision.DENY:
      return ProposalReviewStatus.DENIED;
    case ProposalReviewDecision.APPLY_TO_BRANCH:
      return ProposalReviewStatus.APPLIED_TO_BRANCH;
    case ProposalReviewDecision.ARCHIVE:
      return ProposalReviewStatus.ARCHIVED;
    case ProposalReviewDecision.DEFER:
    default:
      return ProposalReviewStatus.DEFERRED;
  }
}

function mapReviewDecisionToLegacyStatus(decision: ProposalReviewDecision): ProposalDecision {
  switch (decision) {
    case ProposalReviewDecision.ACCEPT:
      return ProposalDecision.ACCEPT;
    case ProposalReviewDecision.DENY:
      return ProposalDecision.DENY;
    case ProposalReviewDecision.APPLY_TO_BRANCH:
      return ProposalDecision.APPLY_TO_BRANCH;
    case ProposalReviewDecision.ARCHIVE:
      return ProposalDecision.DEFER;
    case ProposalReviewDecision.DEFER:
    default:
      return ProposalDecision.DEFER;
  }
}

function summarizeProposalStatuses(records: ProposalReviewRecord[]): ProposalReviewSummaryCounts {
  const summary: ProposalReviewSummaryCounts = {
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
      case ProposalReviewStatus.ACCEPTED:
        summary.accepted += 1;
        break;
      case ProposalReviewStatus.DENIED:
        summary.denied += 1;
        break;
      case ProposalReviewStatus.DEFERRED:
        summary.deferred += 1;
        break;
      case ProposalReviewStatus.APPLIED_TO_BRANCH:
        summary.appliedToBranch += 1;
        break;
      case ProposalReviewStatus.ARCHIVED:
        summary.archived += 1;
        break;
      case ProposalReviewStatus.PENDING_REVIEW:
      default:
        summary.pendingReview += 1;
        break;
    }
  }

  return summary;
}

function deriveProposalArticleDescriptor(proposal: ProposalReviewRecord): {
  articleKey: string;
  articleLabel: string;
  locale?: string;
} {
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

function inferProposalTitleFromText(action: ProposalAction, value?: string): string | undefined {
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

  if (action === ProposalAction.CREATE) {
    const quoted = text.match(/[“"']([^"”']{3,120})[”"']/);
    const candidate = quoted?.[1]?.trim();
    if (candidate) {
      return cleanProposalTitleCandidate(candidate);
    }
  }

  return undefined;
}

function cleanProposalTitleCandidate(value: string): string | undefined {
  const cleaned = value
    .replace(/^[\s:;,.!-]+|[\s:;,.!-]+$/g, '')
    .replace(/\b(article|kb article|documentation)\b$/i, '')
    .trim();
  return cleaned || undefined;
}

function friendlyProposalLabel(action: ProposalAction): string {
  switch (action) {
    case ProposalAction.CREATE:
      return 'New article proposal';
    case ProposalAction.EDIT:
      return 'Article update proposal';
    case ProposalAction.RETIRE:
      return 'Article retirement proposal';
    case ProposalAction.NO_IMPACT:
    default:
      return 'No-impact proposal';
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeProposalMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function extractString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeConfidenceScore(value: unknown): number | undefined {
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

function normalizePlacement(value: unknown): ProposalPlacementSuggestion | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  const placement: ProposalPlacementSuggestion = {
    categoryId: extractString(input.categoryId),
    sectionId: extractString(input.sectionId),
    articleTitle: extractString(input.articleTitle),
    parentArticleId: extractString(input.parentArticleId),
    notes: extractString(input.notes)
  };
  return Object.values(placement).some(Boolean) ? placement : undefined;
}

function safeParseJson<T = unknown>(value: string | null | undefined): T | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
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

interface ArticleRelationCorpusItem {
  familyId: string;
  title: string;
  externalKey: string;
  sectionId?: string;
  categoryId?: string;
  titleTokens: string[];
  contentTokens: string[];
}

interface InferredRelationCandidate {
  id: string;
  leftFamilyId: string;
  rightFamilyId: string;
  relationType: ArticleRelationType;
  direction: ArticleRelationDirection;
  strengthScore: number;
  evidence: Array<{
    evidenceType: ArticleRelationEvidenceType;
    sourceRef?: string;
    snippet?: string;
    weight: number;
    metadata?: unknown;
  }>;
}

function buildCorpusItemFromFamily(
  family: { id: string; title: string; externalKey: string; sectionId: string | null; categoryId: string | null },
  bodyHtml: string
): ArticleRelationCorpusItem {
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

function buildInferredRelationCandidates(
  corpus: ArticleRelationCorpusItem[],
  limitPerArticle: number
): { candidatePairs: number; relations: InferredRelationCandidate[] } {
  const byId = new Map(corpus.map((item) => [item.familyId, item]));
  const tokenIndex = new Map<string, string[]>();

  for (const item of corpus) {
    const uniqueTokens = new Set([...item.titleTokens, ...item.contentTokens.slice(0, 16)]);
    for (const token of uniqueTokens) {
      const bucket = tokenIndex.get(token) ?? [];
      bucket.push(item.familyId);
      tokenIndex.set(token, bucket);
    }
  }

  const scoresByPair = new Map<string, {
    score: number;
    titleOverlap: string[];
    contentOverlap: string[];
    sectionMatch: boolean;
    categoryMatch: boolean;
  }>();

  for (const item of corpus) {
    const candidateScores = new Map<string, { score: number; titleOverlap: string[]; contentOverlap: string[] }>();
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

  const relations: InferredRelationCandidate[] = [];
  for (const [key, value] of scoresByPair.entries()) {
    if (value.score < 1.5) {
      continue;
    }
    const [leftFamilyId, rightFamilyId] = key.split(':');
    const evidence: InferredRelationCandidate['evidence'] = [];
    if (value.titleOverlap.length > 0) {
      evidence.push({
        evidenceType: ArticleRelationEvidenceType.TITLE_TOKEN,
        snippet: `Shared title tokens: ${value.titleOverlap.join(', ')}`,
        weight: Math.min(1, value.titleOverlap.length / 4)
      });
    }
    if (value.contentOverlap.length > 0) {
      evidence.push({
        evidenceType: ArticleRelationEvidenceType.CONTENT_TOKEN,
        snippet: `Shared content terms: ${value.contentOverlap.join(', ')}`,
        weight: Math.min(0.9, value.contentOverlap.length / 8)
      });
    }
    if (value.sectionMatch) {
      evidence.push({
        evidenceType: ArticleRelationEvidenceType.SECTION_MATCH,
        snippet: 'Articles are in the same section',
        weight: 0.85
      });
    }
    if (value.categoryMatch) {
      evidence.push({
        evidenceType: ArticleRelationEvidenceType.CATEGORY_MATCH,
        snippet: 'Articles are in the same category',
        weight: 0.45
      });
    }

    relations.push({
      id: randomUUID(),
      leftFamilyId,
      rightFamilyId,
      relationType: value.sectionMatch ? ArticleRelationType.SAME_WORKFLOW : ArticleRelationType.SHARED_SURFACE,
      direction: ArticleRelationDirection.BIDIRECTIONAL,
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

function tokenizeRelationText(input: string): string[] {
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

function normalizeFamilyPair(sourceFamilyId: string, targetFamilyId: string): { leftFamilyId: string; rightFamilyId: string } {
  return sourceFamilyId.localeCompare(targetFamilyId) <= 0
    ? { leftFamilyId: sourceFamilyId, rightFamilyId: targetFamilyId }
    : { leftFamilyId: targetFamilyId, rightFamilyId: sourceFamilyId };
}

function normalizeRelationRunStatus(value?: string | null): ArticleRelationRefreshRun['status'] | undefined {
  if (value === 'running' || value === 'complete' || value === 'failed' || value === 'canceled') {
    return value;
  }
  return undefined;
}

function normalizeRelationRunSource(value?: string | null): ArticleRelationRefreshRun['source'] {
  if (value === 'post_sync' || value === 'post_import') {
    return value;
  }
  return 'manual_refresh';
}

function clampRelationLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return 24;
  }
  return Math.max(1, Math.min(100, Math.floor(value)));
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

function isValidKbAccessMode(value: string): value is KbAccessMode {
  return value === 'mcp' || value === 'cli';
}

function normalizeKbAccessMode(value?: string | null): KbAccessMode {
  return isValidKbAccessMode(value ?? '') ? (value as KbAccessMode) : DEFAULT_KB_ACCESS_MODE;
}

function latestTimestamp(...values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0];
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
