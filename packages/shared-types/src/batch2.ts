export type EntityId = string;

export enum WorkspaceState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  CONFLICTED = 'conflicted'
}

export enum RevisionState {
  LIVE = 'live',
  DRAFT_BRANCH = 'draft_branch',
  OBSOLETE = 'obsolete',
  RETIRED = 'retired'
}

export enum RevisionStatus {
  OPEN = 'open',
  PROMOTED = 'promoted',
  FAILED = 'failed',
  DELETED = 'deleted'
}

export enum ProposalAction {
  CREATE = 'create',
  EDIT = 'edit',
  RETIRE = 'retire',
  NO_IMPACT = 'no_impact'
}

export enum ProposalDecision {
  ACCEPT = 'accept',
  DENY = 'deny',
  DEFER = 'defer',
  APPLY_TO_BRANCH = 'apply_to_branch',
  CREATE_BRANCH = 'create_branch'
}

export enum PBIBatchStatus {
  IMPORTED = 'imported',
  SCOPED = 'scoped',
  SUBMITTED = 'submitted',
  ANALYZED = 'analyzed',
  REVIEW_IN_PROGRESS = 'review_in_progress',
  REVIEW_COMPLETE = 'review_complete',
  ARCHIVED = 'archived'
}

export enum PBIBatchScopeMode {
  ALL = 'all',
  ALL_EXCEPT_SELECTED = 'all_except_selected',
  SELECTED_ONLY = 'selected_only'
}

export enum PBIImportFormat {
  CSV = 'csv',
  HTML = 'html'
}

export enum PBIValidationStatus {
  CANDIDATE = 'candidate',
  MALFORMED = 'malformed',
  DUPLICATE = 'duplicate',
  IGNORED = 'ignored'
}

export enum PublishStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELED = 'canceled'
}

export type WorkspaceModelReasoningPreference = 'inherit' | 'low' | 'medium' | 'high';
export type WorkspaceModelThinkingPreference = 'inherit' | 'on' | 'off';

export interface WorkspaceRecord {
  id: EntityId;
  name: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  lastOpenedAtUtc?: string;
  isDefaultWorkspace: boolean;
  zendeskConnectionId: EntityId;
  defaultLocale: string;
  enabledLocales: string[];
  state: WorkspaceState;
  path: string;
}

export interface WorkspaceDefaultRequest {
  workspaceId: EntityId;
}

export interface WorkspaceCreateRequest {
  name: string;
  path?: string;
  zendeskSubdomain: string;
  zendeskBrandId?: string;
  defaultLocale: string;
  enabledLocales?: string[];
}

export interface WorkspaceSettingsRecord {
  workspaceId: EntityId;
  zendeskSubdomain: string;
  zendeskBrandId?: string;
  defaultLocale: string;
  enabledLocales: string[];
  agentRuntimeMode?: 'mcp_only' | 'app_runtime';
  agentModelId?: string;
  agentReasoning?: WorkspaceModelReasoningPreference;
  agentThinking?: WorkspaceModelThinkingPreference;
}

export interface WorkspaceSettingsUpdateRequest {
  workspaceId: EntityId;
  zendeskSubdomain?: string;
  zendeskBrandId?: string;
  defaultLocale?: string;
  enabledLocales?: string[];
  agentRuntimeMode?: 'mcp_only' | 'app_runtime';
  agentModelId?: string;
  agentReasoning?: WorkspaceModelReasoningPreference;
  agentThinking?: WorkspaceModelThinkingPreference;
}

export interface WorkspaceListItem extends WorkspaceRecord {
  isDefaultWorkspace: boolean;
  articleCount: number;
  draftCount: number;
}

export interface WorkspaceRoutePayload {
  workspaceId: EntityId;
  workspaceRoot: string;
  workspacePath: string;
  dbPath: string;
}

export interface ZendeskConnectionRecord {
  id: EntityId;
  workspaceId: EntityId;
  subdomain: string;
  brandId?: string;
  defaultLocale: string;
  localeMap: Record<string, string>;
  lastSyncAtUtc?: string;
}

export interface ArticleFamilyRecord {
  id: EntityId;
  workspaceId: EntityId;
  externalKey: string;
  title: string;
  sectionId?: string;
  categoryId?: string;
  retiredAtUtc?: string;
}

export interface LocaleVariantRecord {
  id: EntityId;
  familyId: EntityId;
  locale: string;
  status: RevisionState;
  retiredAtUtc?: string;
}

export interface RevisionRecord {
  id: EntityId;
  localeVariantId: EntityId;
  revisionType: RevisionState;
  branchId?: EntityId;
  workspaceId: EntityId;
  filePath: string;
  contentHash?: string;
  sourceRevisionId?: EntityId;
  revisionNumber: number;
  status: RevisionStatus;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface ArticleFamilyCreateRequest {
  workspaceId: EntityId;
  externalKey: string;
  title: string;
  sectionId?: string;
  categoryId?: string;
  retiredAtUtc?: string;
}

export interface ArticleFamilyUpdateRequest {
  workspaceId: EntityId;
  familyId: EntityId;
  title?: string;
  sectionId?: string;
  categoryId?: string;
  retiredAtUtc?: string | null;
}

export interface LocaleVariantCreateRequest {
  workspaceId: EntityId;
  familyId: EntityId;
  locale: string;
  status?: RevisionState;
  retiredAtUtc?: string;
}

export interface LocaleVariantUpdateRequest {
  workspaceId: EntityId;
  variantId: EntityId;
  locale?: string;
  status?: RevisionState;
  retiredAtUtc?: string | null;
}

export interface RevisionCreateRequest {
  workspaceId: EntityId;
  localeVariantId: EntityId;
  revisionType: RevisionState;
  branchId?: EntityId;
  filePath: string;
  contentHash?: string;
  sourceRevisionId?: EntityId;
  revisionNumber: number;
  status: RevisionStatus;
  createdAtUtc?: string;
  updatedAtUtc?: string;
}

export interface RevisionUpdateRequest {
  workspaceId: EntityId;
  revisionId: EntityId;
  revisionType?: RevisionState;
  branchId?: EntityId;
  filePath?: string;
  contentHash?: string;
  sourceRevisionId?: EntityId;
  revisionNumber?: number;
  status?: RevisionStatus;
  updatedAtUtc?: string;
}

export interface RevisionRecordQuery {
  workspaceId: EntityId;
  localeVariantId: EntityId;
  revisionType?: RevisionState;
  branchId?: EntityId;
}

export interface DraftBranchRecord {
  id: EntityId;
  workspaceId: EntityId;
  localeVariantId: EntityId;
  name: string;
  baseRevisionId: EntityId;
  state: RevisionState;
  createdAtUtc: string;
  updatedAtUtc: string;
  retiredAtUtc?: string;
}

export interface PBIBatchRecord {
  id: EntityId;
  workspaceId: EntityId;
  name: string;
  sourceFileName: string;
  sourceRowCount: number;
  sourcePath: string;
  sourceFormat: PBIImportFormat;
  candidateRowCount: number;
  ignoredRowCount: number;
  malformedRowCount: number;
  duplicateRowCount: number;
  scopedRowCount: number;
  scopeMode: PBIBatchScopeMode;
  scopePayload?: string;
  importedAtUtc: string;
  status: PBIBatchStatus | 'proposed';
}

export interface PBIRecord {
  id: EntityId;
  batchId: EntityId;
  sourceRowNumber: number;
  externalId: string;
  title: string;
  description?: string;
  state?: PBIValidationStatus;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
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
}

export interface PBIFieldMapping {
  externalId: string;
  title: string;
  description: string;
  acceptanceCriteria?: string;
  priority?: string;
  type?: string;
  parentExternalId?: string;
}

export interface PBIImportScope {
  mode?: PBIBatchScopeMode;
  selectedRows?: number[];
  selectedExternalIds?: string[];
}

export interface PBIBatchImportRequest {
  workspaceId: EntityId;
  batchName?: string;
  sourceFileName: string;
  sourcePath?: string;
  sourceContent?: string;
  sourceFormat?: PBIImportFormat;
  fieldMapping?: Partial<PBIFieldMapping>;
  scope?: PBIImportScope;
}

export interface PBIBatchScopePayload {
  batchId: EntityId;
  workspaceId: EntityId;
  mode: PBIBatchScopeMode;
  selectedRows?: number[];
  selectedExternalIds?: string[];
  scopedRowNumbers?: number[];
  scopedCount?: number;
  updatedAtUtc: string;
}

export interface PBIBatchRowsRequest {
  workspaceId: EntityId;
  batchId: EntityId;
  validationStatuses?: PBIValidationStatus[];
}

export interface PBIBatchDeleteRequest {
  workspaceId: EntityId;
  batchId: EntityId;
}

export interface PBIBatchStatusUpdateRequest {
  workspaceId: EntityId;
  batchId: EntityId;
  status: PBIBatchStatus | 'proposed';
  force?: boolean;
}

export interface PBIBatchImportSummary {
  batch: PBIBatchRecord;
  rows: PBIRecord[];
  summary: {
    totalRows: number;
    candidateRowCount: number;
    malformedRowCount: number;
    duplicateRowCount: number;
    ignoredRowCount: number;
    scopedRowCount: number;
  };
  invalidRows: PBIRecord[];
  duplicateRows: PBIRecord[];
  ignoredRows: PBIRecord[];
}

export interface AiRunRecord {
  id: EntityId;
  workspaceId: EntityId;
  batchId: EntityId;
  status: 'running' | 'complete' | 'failed';
  startedAtUtc: string;
  endedAtUtc?: string;
  promptTemplate?: string;
  transcriptPath?: string;
}

export interface ProposalRecord {
  id: EntityId;
  workspaceId: EntityId;
  batchId: EntityId;
  action: ProposalAction;
  localeVariantId?: EntityId;
  branchId?: EntityId;
  status: ProposalDecision;
  rationale?: string;
  generatedAtUtc: string;
  updatedAtUtc: string;
}

export interface ProposalPBI {
  proposalId: EntityId;
  pbiId: EntityId;
  relation?: 'primary' | 'secondary';
}

export interface PublishJobRecord {
  id: EntityId;
  workspaceId: EntityId;
  status: PublishStatus;
  requestedBy?: string;
  enqueuedAtUtc: string;
  startedAtUtc?: string;
  completedAtUtc?: string;
  branchIds: EntityId[];
}

export interface PublishRecord {
  id: EntityId;
  jobId: EntityId;
  revisionId: EntityId;
  zendeskArticleId?: string;
  result?: string;
  publishedAtUtc: string;
}

export interface AssetRecord {
  id: EntityId;
  workspaceId: EntityId;
  localeVariantId?: EntityId;
  originalName: string;
  filePath: string;
  fileSizeBytes: number;
  mimeType: string;
  checksum: string;
  createdAtUtc: string;
}

export interface PlaceholderRecord {
  id: EntityId;
  workspaceId: EntityId;
  revisionId: EntityId;
  marker: string;
  rawDescription: string;
  insertedAtUtc: string;
}

export interface TemplatePackRecord {
  id: EntityId;
  workspaceId: EntityId;
  name: string;
  language: string;
  promptTemplate: string;
  toneRules: string;
  examples?: string;
  active: boolean;
  updatedAtUtc: string;
}

export interface ArticleLineageRecord {
  id: EntityId;
  localeVariantId: EntityId;
  predecessorRevisionId: EntityId;
  successorRevisionId: EntityId;
  createdBy: 'system' | 'manual';
  createdAtUtc: string;
}

export interface FileStorageConvention {
  root: string;
  articles: string;
  drafts: string;
  revisions: string;
  imports: string;
  proposals: string;
  runs: string;
  assets: string;
  cache: string;
  searchIndex: string;
}

export interface ExplorerNode {
  familyId: EntityId;
  title: string;
  familyStatus: RevisionState;
  locales: {
    locale: string;
    localeVariantId: EntityId;
    revision: {
      revisionId: EntityId;
      revisionNumber: number;
      state: RevisionState;
      updatedAtUtc: string;
      draftCount: number;
    };
    hasConflicts: boolean;
  }[];
}

export type SearchScope = 'all' | 'live' | 'drafts' | 'retired' | 'conflicted';

export interface SearchFilterPayload {
  scope?: SearchScope;
  locales?: string[];
  includeArchived?: boolean;
  changedWithinHours?: number;
  hasDrafts?: boolean;
  includeConflicts?: boolean;
}

export interface SearchResult {
  revisionId: EntityId;
  familyId: EntityId;
  localeVariantId: EntityId;
  locale: string;
  title: string;
  snippet: string;
  familyExternalKey: string;
  matchContext?: 'title' | 'body' | 'metadata';
  score: number;
}

export interface SearchPayload {
  workspaceId: EntityId;
  query: string;
  locales?: string[];
  includeArchived?: boolean;
  scope?: SearchScope;
  changedWithinHours?: number;
  hasDrafts?: boolean;
  includeConflicts?: boolean;
}

export interface SearchResponse {
  workspaceId: EntityId;
  total: number;
  results: SearchResult[];
}

export interface WorkspaceQueryPayload {
  workspaceId: EntityId;
}

export interface RevisionHistoryResponse {
  workspaceId: EntityId;
  localeVariantId: EntityId;
  revisions: RevisionRecord[];
}

export interface PlaceholderToken {
  token: string;
  description?: string;
}

export interface LineageRecord {
  id: EntityId;
  localeVariantId: EntityId;
  predecessorRevisionId: EntityId;
  successorRevisionId: EntityId;
  createdBy: 'system' | 'manual';
  createdAtUtc: string;
}

export interface ArticlePublishRecord {
  id: EntityId;
  revisionId: EntityId;
  zendeskArticleId?: string;
  result?: string;
  publishedAtUtc: string;
}

export interface ArticleDetailRequest {
  workspaceId: EntityId;
  revisionId?: EntityId;
  localeVariantId?: EntityId;
  preferRevisionType?: RevisionState;
  includeSource?: boolean;
  includePreview?: boolean;
  includeLineage?: boolean;
  includePublishLog?: boolean;
}

export interface ArticleDetailResponse {
  workspaceId: EntityId;
  familyId: EntityId;
  familyTitle: string;
  familyStatus: RevisionState;
  externalKey?: string;
  localeVariant: {
    id: EntityId;
    locale: string;
    status: RevisionState;
  };
  revision: {
    id: EntityId;
    revisionType: RevisionState;
    revisionNumber: number;
    updatedAtUtc: string;
    contentHash?: string;
  };
  sourceHtml: string;
  previewHtml: string;
  placeholders: PlaceholderToken[];
  lineage: LineageRecord[];
  relatedPbis: PBIRecord[];
  publishLog: ArticlePublishRecord[];
  filePath: string;
}

export interface RepositoryStructurePayload {
  workspaceId: EntityId;
  rootPath: string;
  dbPath: string;
  storage: FileStorageConvention;
}

export interface WorkspaceMigrationHealth {
  workspaceId: EntityId;
  workspacePath: string;
  catalogVersion: number;
  workspaceDbPath: string;
  workspaceDbVersion: number;
  repaired: boolean;
  exists: boolean;
}

export interface WorkspaceMigrationHealthReport {
  catalogVersion: number;
  workspaceId: EntityId | null;
  workspaces: WorkspaceMigrationHealth[];
}
