import type { ProposalReviewStatus } from './batch7';

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

export enum ArticleRelationType {
  SAME_WORKFLOW = 'same_workflow',
  PREREQUISITE = 'prerequisite',
  FOLLOW_UP = 'follow_up',
  PARENT_TOPIC = 'parent_topic',
  CHILD_TOPIC = 'child_topic',
  SHARED_SURFACE = 'shared_surface',
  REPLACES = 'replaces',
  SEE_ALSO = 'see_also'
}

export enum ArticleRelationDirection {
  BIDIRECTIONAL = 'bidirectional',
  LEFT_TO_RIGHT = 'left_to_right',
  RIGHT_TO_LEFT = 'right_to_left'
}

export enum ArticleRelationOrigin {
  INFERRED = 'inferred',
  MANUAL = 'manual'
}

export enum ArticleRelationStatus {
  ACTIVE = 'active',
  SUPPRESSED = 'suppressed'
}

export enum ArticleRelationEvidenceType {
  TITLE_TOKEN = 'title_token',
  SECTION_MATCH = 'section_match',
  CATEGORY_MATCH = 'category_match',
  CONTENT_TOKEN = 'content_token',
  EXTERNAL_KEY = 'external_key',
  PBI_LINK = 'pbi_link',
  MANUAL_NOTE = 'manual_note',
  HEURISTIC = 'heuristic'
}

export enum ArticleRelationIndexStateStatus {
  INDEXED = 'indexed',
  STALE = 'stale',
  ERROR = 'error'
}

export enum ArticleRelationFeedbackType {
  ADD = 'add',
  REMOVE = 'remove',
  MISSED = 'missed',
  BAD_SUGGESTION = 'bad_suggestion',
  GOOD_SUGGESTION = 'good_suggestion'
}

export enum ArticleRelationFeedbackSource {
  MANUAL_RELATION = 'manual_relation',
  UI = 'ui',
  SYSTEM = 'system'
}

export type KBScopeType = 'category' | 'section';

export type KBScopeLabelSource = 'catalog' | 'override' | 'fallback';

export type ArticleTaxonomySource =
  | 'zendesk_article'
  | 'zendesk_section_parent'
  | 'inferred_existing_scope'
  | 'inferred_local_scope'
  | 'manual_override'
  | 'none';

export interface KBScopeCatalogRecord {
  workspaceId: EntityId;
  scopeType: KBScopeType;
  scopeId: string;
  parentScopeId?: string;
  displayName: string;
  source: string;
  updatedAtUtc: string;
}

export interface KBScopeCatalogUpsertInput {
  workspaceId: EntityId;
  scopeType: KBScopeType;
  scopeId: string;
  parentScopeId?: string | null;
  displayName: string;
  source: string;
}

export interface KBScopeCatalogQuery {
  scopeType?: KBScopeType;
  scopeIds?: string[];
}

export interface KBScopeOverrideRecord {
  id: EntityId;
  workspaceId: EntityId;
  scopeType: KBScopeType;
  scopeId: string;
  displayName?: string;
  parentScopeId?: string;
  isHidden: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface KBScopeOverrideQuery {
  scopeType?: KBScopeType;
  scopeIds?: string[];
}

export interface KBScopeDisplayNameInput {
  scopeType: KBScopeType;
  scopeId?: string;
}

export interface KBScopeDisplayNameRecord {
  scopeType: KBScopeType;
  scopeId?: string;
  displayName: string;
  labelSource: KBScopeLabelSource;
  parentScopeId?: string;
  isHidden: boolean;
}

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

export const KB_ACCESS_MODES = ['direct', 'mcp', 'cli'] as const;

export type KbAccessMode = (typeof KB_ACCESS_MODES)[number];

export function isKbAccessMode(value: unknown): value is KbAccessMode {
  return typeof value === 'string' && (KB_ACCESS_MODES as readonly string[]).includes(value);
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
  kbAccessMode: KbAccessMode;
  agentModelId?: string;
  acpModelId?: string;
}

export interface WorkspaceSettingsUpdateRequest {
  workspaceId: EntityId;
  zendeskSubdomain?: string;
  zendeskBrandId?: string;
  defaultLocale?: string;
  enabledLocales?: string[];
  kbAccessMode?: KbAccessMode;
  agentModelId?: string;
  acpModelId?: string;
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
  sourceSectionId?: string;
  sourceCategoryId?: string;
  sectionSource?: ArticleTaxonomySource;
  categorySource?: ArticleTaxonomySource;
  taxonomyConfidence?: number;
  taxonomyUpdatedAt?: string;
  taxonomyNote?: string;
  retiredAtUtc?: string;
}

export interface ArticlePlacementSummary {
  categoryId?: string;
  categoryName?: string;
  sectionId?: string;
  sectionName?: string;
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
  sourceSectionId?: string;
  sourceCategoryId?: string;
  sectionSource?: ArticleTaxonomySource;
  categorySource?: ArticleTaxonomySource;
  taxonomyConfidence?: number | null;
  taxonomyUpdatedAt?: string | null;
  taxonomyNote?: string | null;
  retiredAtUtc?: string;
}

export interface ArticleFamilyUpdateRequest {
  workspaceId: EntityId;
  familyId: EntityId;
  title?: string;
  sectionId?: string | null;
  categoryId?: string | null;
  sourceSectionId?: string | null;
  sourceCategoryId?: string | null;
  sectionSource?: ArticleTaxonomySource;
  categorySource?: ArticleTaxonomySource;
  taxonomyConfidence?: number | null;
  taxonomyUpdatedAt?: string | null;
  taxonomyNote?: string | null;
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
  workerStageBudgetMinutes?: number;
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

export interface PBIBatchGuaranteedEditLocaleVariant {
  localeVariantId: EntityId;
  locale: string;
  revisionId?: EntityId;
  revisionState?: RevisionState;
  updatedAtUtc?: string;
  snippet?: string;
}

export interface PBIBatchGuaranteedEditFamily {
  familyId: EntityId;
  familyTitle: string;
  selectedFromLocaleVariantId?: EntityId;
  mode: 'all_live_locales';
  resolvedLocaleVariants: PBIBatchGuaranteedEditLocaleVariant[];
  sectionId?: EntityId;
  sectionName?: string;
  categoryId?: EntityId;
  categoryName?: string;
}

export interface PBIBatchGuaranteedCreateArticle extends ArticlePlacementSummary {
  clientId: EntityId;
  title: string;
  targetLocale: string;
  source: 'manual';
}

export interface PBIBatchGuaranteedCreateConflictMatch {
  familyId: EntityId;
  localeVariantId: EntityId;
  locale: string;
  title: string;
  score: number;
  matchContext?: SearchResult['matchContext'];
  snippet?: string;
}

export interface PBIBatchGuaranteedCreateConflict {
  clientId: EntityId;
  title: string;
  targetLocale: string;
  reason: string;
  matches: PBIBatchGuaranteedCreateConflictMatch[];
}

export interface PBIBatchAnalysisConfig {
  version: number;
  updatedAtUtc: string;
  guaranteedEditFamilies: PBIBatchGuaranteedEditFamily[];
  guaranteedCreateArticles: PBIBatchGuaranteedCreateArticle[];
  analysisGuidancePrompt?: string;
}

export interface PBIBatchAnalysisEditSelectionInput {
  familyId?: EntityId;
  localeVariantId?: EntityId;
}

export interface PBIBatchAnalysisCreateArticleInput extends ArticlePlacementSummary {
  clientId?: EntityId;
  title: string;
  targetLocale?: string;
}

export interface PBIBatchAnalysisConfigInput {
  guaranteedEditSelections?: PBIBatchAnalysisEditSelectionInput[];
  guaranteedCreateArticles?: PBIBatchAnalysisCreateArticleInput[];
  analysisGuidancePrompt?: string;
}

export interface PBIBatchAnalysisConfigRequest {
  workspaceId: EntityId;
  batchId: EntityId;
}

export interface PBIBatchAnalysisConfigSetRequest extends PBIBatchAnalysisConfigRequest {
  analysisConfig: PBIBatchAnalysisConfigInput;
}

export interface PBIBatchAnalysisConfigResponse extends PBIBatchAnalysisConfigRequest {
  analysisConfig: PBIBatchAnalysisConfig;
  guaranteedCreateConflicts: PBIBatchGuaranteedCreateConflict[];
}

export interface PBIBatchPreflightResponse {
  batch: PBIBatchRecord;
  candidateRows: PBIRecord[];
  invalidRows: PBIRecord[];
  duplicateRows: PBIRecord[];
  ignoredRows: PBIRecord[];
  scopePayload: PBIBatchScopePayload;
  candidateTitles: string[];
  analysisConfig: PBIBatchAnalysisConfig;
  guaranteedCreateConflicts: PBIBatchGuaranteedCreateConflict[];
}

export interface PBIBatchContextResponse {
  batch: PBIBatchRecord;
  candidateRows: PBIRecord[];
  malformedRows: PBIRecord[];
  duplicateRows: PBIRecord[];
  ignoredRows: PBIRecord[];
  analysisConfig: PBIBatchAnalysisConfig;
  guaranteedCreateConflicts: PBIBatchGuaranteedCreateConflict[];
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

export type PBILibraryScopeState = 'in_scope' | 'out_of_scope' | 'not_eligible';

export type PBILibrarySortField =
  | 'importedAtUtc'
  | 'externalId'
  | 'title'
  | 'workItemType'
  | 'priority'
  | 'validationStatus'
  | 'scopeState'
  | 'batchName'
  | 'proposalCount';

export interface PBILibraryListRequest {
  workspaceId: string;
  query?: string;
  validationStatuses?: PBIValidationStatus[];
  scopeStates?: PBILibraryScopeState[];
  batchId?: string;
  sortBy?: PBILibrarySortField;
  sortDirection?: 'asc' | 'desc';
}

export interface PBILibraryListItem {
  pbiId: string;
  batchId: string;
  externalId: string;
  title: string;
  workItemType?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  validationStatus: PBIValidationStatus;
  scopeState: PBILibraryScopeState;
  batchName: string;
  sourceFileName: string;
  importedAtUtc: string;
  proposalCount: number;
}

export interface PBILibraryListResponse {
  workspaceId: string;
  items: PBILibraryListItem[];
}

export interface PBILibraryGetRequest {
  workspaceId: string;
  pbiId: string;
}

export interface PBILibraryLinkedProposalSummary {
  proposalId: string;
  batchId: string;
  action: ProposalAction;
  reviewStatus: ProposalReviewStatus;
  generatedAtUtc: string;
}

export interface PBILibraryRecordSummary {
  pbiId: string;
  externalId: string;
  title: string;
}

export interface PBILibraryDetailResponse {
  workspaceId: string;
  item: PBILibraryListItem;
  record: PBIRecord;
  batch: PBIBatchRecord;
  titlePath: string[];
  parent?: PBILibraryRecordSummary;
  children: PBILibraryRecordSummary[];
  linkedProposals: PBILibraryLinkedProposalSummary[];
}

export interface PBIBatchStatusUpdateRequest {
  workspaceId: EntityId;
  batchId: EntityId;
  status: PBIBatchStatus | 'proposed';
  force?: boolean;
  workerStageBudgetMinutes?: number | null;
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
  sectionId?: string;
  sectionName?: string;
  categoryId?: string;
  categoryName?: string;
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
  query?: string;
  locales?: string[];
  includeArchived?: boolean;
  scope?: SearchScope;
  changedWithinHours?: number;
  hasDrafts?: boolean;
  includeConflicts?: boolean;
  localeVariantIds?: EntityId[];
  familyIds?: EntityId[];
  revisionIds?: EntityId[];
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

export interface ArticleRelationEvidence {
  id: EntityId;
  relationId: EntityId;
  evidenceType: ArticleRelationEvidenceType;
  sourceRef?: string;
  snippet?: string;
  weight: number;
  metadata?: unknown;
}

export interface ArticleRelationRecord {
  id: EntityId;
  workspaceId: EntityId;
  relationType: ArticleRelationType;
  direction: ArticleRelationDirection;
  strengthScore: number;
  status: ArticleRelationStatus;
  origin: ArticleRelationOrigin;
  runId?: EntityId;
  createdAtUtc: string;
  updatedAtUtc: string;
  sourceFamily: {
    id: EntityId;
    title: string;
    externalKey?: string;
  };
  targetFamily: {
    id: EntityId;
    title: string;
    externalKey?: string;
  };
  evidence: ArticleRelationEvidence[];
}

export interface ArticleRelationIndexStateRecord {
  workspaceId: EntityId;
  localeVariantId: EntityId;
  familyId: EntityId;
  revisionId: EntityId;
  contentHash: string;
  engineVersion: string;
  status: ArticleRelationIndexStateStatus;
  lastIndexedAtUtc?: string;
  lastError?: string;
}

export interface ArticleRelationFeedbackRecord {
  id: EntityId;
  workspaceId: EntityId;
  leftFamilyId: EntityId;
  rightFamilyId: EntityId;
  feedbackType: ArticleRelationFeedbackType;
  source: ArticleRelationFeedbackSource;
  note?: string;
  createdAtUtc: string;
}

export interface ArticleRelationFeedbackRecordRequest {
  workspaceId: EntityId;
  leftFamilyId: EntityId;
  rightFamilyId: EntityId;
  feedbackType: ArticleRelationFeedbackType;
  source?: ArticleRelationFeedbackSource;
  note?: string;
}

export interface ArticleRelationIndexStats {
  engineVersion?: string;
  documentCount: number;
  chunkCount: number;
  aliasCount: number;
  linkCount: number;
  lastBuiltAtUtc?: string;
}

export interface RelationDocumentHeading {
  level: number;
  text: string;
  path: string;
}

export interface RelationDocumentLink {
  href: string;
  text?: string;
  targetFamilyId?: string;
  targetExternalKey?: string;
}

export interface RelationDocumentChunk {
  chunkId: string;
  ordinal: number;
  headingPath?: string;
  text: string;
}

export interface RelationDocument {
  workspaceId: EntityId;
  familyId: EntityId;
  localeVariantId: EntityId;
  locale: string;
  revisionId: EntityId;
  contentHash: string;
  title: string;
  externalKey: string;
  categoryId?: string;
  categoryName?: string;
  categorySource?: ArticleTaxonomySource;
  sectionId?: string;
  sectionName?: string;
  sectionSource?: ArticleTaxonomySource;
  taxonomyConfidence?: number;
  headings: RelationDocumentHeading[];
  aliases: string[];
  explicitLinks: RelationDocumentLink[];
  bodyText: string;
  chunks: RelationDocumentChunk[];
}

export interface ArticleRelationCorpusExportRequest {
  workspaceId: EntityId;
  familyIds?: EntityId[];
  localeVariantIds?: EntityId[];
  locales?: string[];
}

export interface ArticleRelationCorpusExportResponse {
  workspaceId: EntityId;
  engineVersion: string;
  exportedAtUtc: string;
  documentCount: number;
  documents: RelationDocument[];
}

export interface CoverageQueryRequest {
  workspaceId: EntityId;
  query?: string;
  seedFamilyIds?: EntityId[];
  batchQueries?: string[];
  maxResults?: number;
  minScore?: number;
  includeEvidence?: boolean;
}

export interface CoverageQueryEvidence {
  evidenceType: string;
  sourceRef?: string;
  snippet?: string;
  weight: number;
  metadata?: unknown;
}

export interface CoverageQueryResult {
  familyId: EntityId;
  localeVariantIds: EntityId[];
  title: string;
  externalKey?: string;
  finalScore: number;
  relationEligible: boolean;
  evidence: CoverageQueryEvidence[];
}

export interface CoverageQueryResponse {
  workspaceId: EntityId;
  engineVersion: string;
  results: CoverageQueryResult[];
}

export interface GraphQueryRequest {
  workspaceId: EntityId;
  familyId?: EntityId;
  sectionId?: string;
  categoryId?: string;
  minScore?: number;
  includeSuppressed?: boolean;
  limitNodes?: number;
}

export interface GraphQueryResponse {
  workspaceId: EntityId;
  nodes: Array<{
    familyId: EntityId;
    title: string;
    externalKey?: string;
    sectionId?: string;
    categoryId?: string;
    sectionSource?: ArticleTaxonomySource;
    categorySource?: ArticleTaxonomySource;
    taxonomyConfidence?: number;
  }>;
  edges: Array<{
    relationId: EntityId;
    leftFamilyId: EntityId;
    rightFamilyId: EntityId;
    relationType: string;
    origin: string;
    status: string;
    strengthScore: number;
    evidence: ArticleRelationEvidence[];
  }>;
}

export interface FeatureMapSummaryRequest {
  workspaceId: EntityId;
}

export interface FeatureMapScopeSummary {
  articleCount: number;
  clusterCount: number;
  internalEdgeCount: number;
  bridgeEdgeCount: number;
  staleDocumentCount: number;
  manualEdgeCount: number;
  inferredEdgeCount: number;
}

export interface FeatureMapTaxonomyStatus {
  status: 'missing' | 'partial' | 'ready';
  totalScopeCount: number;
  catalogScopeCount: number;
  overrideScopeCount: number;
  fallbackScopeCount: number;
}

export interface FeatureMapSummaryResponse {
  workspaceId: EntityId;
  generatedAtUtc: string;
  taxonomyStatus: FeatureMapTaxonomyStatus;
  categories: Array<{
    categoryId?: string;
    categoryName: string;
    categoryLabel: KBScopeDisplayNameRecord;
    articleCount: number;
    sectionCount: number;
    clusterCount: number;
    internalEdgeCount: number;
    bridgeEdgeCount: number;
    staleDocumentCount: number;
    manualEdgeCount: number;
    inferredEdgeCount: number;
    sections: Array<{
      sectionId?: string;
      sectionName: string;
      sectionLabel: KBScopeDisplayNameRecord;
      articleCount: number;
      clusterCount: number;
      internalEdgeCount: number;
      bridgeEdgeCount: number;
      staleDocumentCount: number;
      manualEdgeCount: number;
      inferredEdgeCount: number;
    }>;
  }>;
}

export interface FeatureScopeRequest {
  workspaceId: EntityId;
  scopeType: 'section' | 'category';
  scopeId?: string;
  includeBridges?: boolean;
  includeSuppressed?: boolean;
  minScore?: number;
}

export type FeatureClusterLabelSource = 'derived_keywords' | 'representative_article' | 'manual';

export interface FeatureScopeResponse {
  workspaceId: EntityId;
  scope: {
    scopeType: KBScopeType;
    scopeId?: string;
    scopeName: string;
    scopeLabel: KBScopeDisplayNameRecord;
  };
  summary: FeatureMapScopeSummary;
  articles: Array<{
    familyId: string;
    title: string;
    sectionId?: string;
    categoryId?: string;
    sectionSource?: ArticleTaxonomySource;
    categorySource?: ArticleTaxonomySource;
    taxonomyConfidence?: number;
    totalEdgeCount: number;
    internalEdgeCount: number;
    bridgeEdgeCount: number;
  }>;
  relations: Array<{
    relationId: string;
    leftFamilyId: string;
    rightFamilyId: string;
    relationType: string;
    origin: string;
    status: string;
    strengthScore: number;
    evidence: ArticleRelationEvidence[];
  }>;
  clusters: Array<{
    clusterId: string;
    label: string;
    labelSource: FeatureClusterLabelSource;
    articleIds: string[];
    articleCount: number;
    internalEdgeCount: number;
    bridgeEdgeCount: number;
    representativeArticleIds: string[];
  }>;
  bridges: Array<{
    sourceClusterId: string;
    sourceClusterLabel: string;
    targetScopeType: KBScopeType;
    targetScopeId?: string;
    targetScopeName: string;
    targetScopeLabel: KBScopeDisplayNameRecord;
    summary: string;
    edgeCount: number;
    maxStrengthScore: number;
    examples: Array<{
      leftFamilyId: string;
      leftTitle?: string;
      rightFamilyId: string;
      rightTitle?: string;
      relationType: string;
      strengthScore: number;
    }>;
  }>;
}

export interface ArticleNeighborhoodRequest {
  workspaceId: EntityId;
  familyId: EntityId;
  includeSuppressed?: boolean;
  minScore?: number;
  hopCount?: 1 | 2;
}

export interface ArticleNeighborhoodResponse {
  workspaceId: EntityId;
  centerArticle: {
    familyId: string;
    title: string;
    sectionId?: string;
    categoryId?: string;
    sectionSource?: ArticleTaxonomySource;
    categorySource?: ArticleTaxonomySource;
    taxonomyConfidence?: number;
  };
  nodes: Array<{
    familyId: string;
    title: string;
    sectionId?: string;
    categoryId?: string;
    sectionSource?: ArticleTaxonomySource;
    categorySource?: ArticleTaxonomySource;
    taxonomyConfidence?: number;
    degree: number;
  }>;
  edges: Array<{
    relationId: string;
    leftFamilyId: string;
    rightFamilyId: string;
    relationType: string;
    origin: string;
    status: string;
    strengthScore: number;
    evidence: ArticleRelationEvidence[];
  }>;
}

export interface ArticleRelationSummary {
  totalActive: number;
  inferred: number;
  manual: number;
  lastRefreshedAtUtc?: string;
  latestRunState?: 'running' | 'complete' | 'failed' | 'canceled';
  engineVersion?: string;
  indexedDocumentCount?: number;
  staleDocumentCount?: number;
  degradedMode?: boolean;
  indexStats?: ArticleRelationIndexStats;
}

export interface ArticleRelationsListRequest {
  workspaceId: EntityId;
  familyId?: EntityId;
  localeVariantId?: EntityId;
  batchId?: EntityId;
  minScore?: number;
  limit?: number;
  includeEvidence?: boolean;
}

export interface ArticleRelationsListResponse {
  workspaceId: EntityId;
  seedFamilyIds: EntityId[];
  total: number;
  relations: ArticleRelationRecord[];
}

export interface ArticleRelationUpsertRequest {
  workspaceId: EntityId;
  sourceFamilyId: EntityId;
  targetFamilyId: EntityId;
  relationType: ArticleRelationType;
  direction?: ArticleRelationDirection;
  note?: string;
}

export interface ArticleRelationDeleteRequest {
  workspaceId: EntityId;
  relationId?: EntityId;
  sourceFamilyId?: EntityId;
  targetFamilyId?: EntityId;
}

export interface ArticleRelationRefreshRequest {
  workspaceId: EntityId;
  limitPerArticle?: number;
}

export interface ArticleRelationRefreshSummary {
  totalArticles: number;
  candidatePairs: number;
  inferredRelations: number;
  manualRelations: number;
  suppressedRelations: number;
  engineVersion?: string;
  indexedDocumentCount?: number;
  staleDocumentCount?: number;
  degradedMode?: boolean;
  thresholdsUsed?: Record<string, number>;
  error?: string;
}

export interface ArticleRelationRefreshRun {
  id: EntityId;
  workspaceId: EntityId;
  status: 'running' | 'complete' | 'failed' | 'canceled';
  source: 'manual_refresh' | 'post_sync' | 'post_import';
  triggeredBy?: string;
  startedAtUtc: string;
  endedAtUtc?: string;
  agentSessionId?: string;
  engineVersion?: string;
  indexedDocumentCount?: number;
  staleDocumentCount?: number;
  degradedMode?: boolean;
  thresholdsUsed?: Record<string, number>;
  summary?: ArticleRelationRefreshSummary;
}

export interface ArticleRelationRefreshStatusResponse {
  workspaceId: EntityId;
  latestRun: ArticleRelationRefreshRun | null;
  summary: ArticleRelationSummary;
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
  relations: ArticleRelationRecord[];
  relationSummary: ArticleRelationSummary;
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
  batchAnalysisRepair?: WorkspaceBatchAnalysisRepairSummary;
}

export interface WorkspaceMigrationHealthReport {
  catalogVersion: number;
  workspaceId: EntityId | null;
  workspaces: WorkspaceMigrationHealth[];
}

export interface WorkspaceBatchAnalysisRepairSummary {
  backfilledLegacyIterations: number;
  backfilledLegacyStageRuns: number;
  backfilledLegacyWorkerReports: number;
  backfilledStageEvents: number;
  normalizedIterations: number;
}
