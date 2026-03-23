export type EntityId = string;
export declare enum WorkspaceState {
    ACTIVE = "active",
    INACTIVE = "inactive",
    CONFLICTED = "conflicted"
}
export declare enum RevisionState {
    LIVE = "live",
    DRAFT_BRANCH = "draft_branch",
    OBSOLETE = "obsolete",
    RETIRED = "retired"
}
export declare enum RevisionStatus {
    OPEN = "open",
    PROMOTED = "promoted",
    FAILED = "failed",
    DELETED = "deleted"
}
export declare enum ProposalAction {
    CREATE = "create",
    EDIT = "edit",
    RETIRE = "retire",
    NO_IMPACT = "no_impact"
}
export declare enum ProposalDecision {
    ACCEPT = "accept",
    DENY = "deny",
    DEFER = "defer",
    APPLY_TO_BRANCH = "apply_to_branch",
    CREATE_BRANCH = "create_branch"
}
export declare enum PBIBatchStatus {
    IMPORTED = "imported",
    SCOPED = "scoped",
    SUBMITTED = "submitted",
    ANALYZED = "analyzed",
    REVIEW_IN_PROGRESS = "review_in_progress",
    REVIEW_COMPLETE = "review_complete",
    ARCHIVED = "archived"
}
export declare enum PBIBatchScopeMode {
    ALL = "all",
    ALL_EXCEPT_SELECTED = "all_except_selected",
    SELECTED_ONLY = "selected_only"
}
export declare enum PBIImportFormat {
    CSV = "csv",
    HTML = "html"
}
export declare enum PBIValidationStatus {
    CANDIDATE = "candidate",
    MALFORMED = "malformed",
    DUPLICATE = "duplicate",
    IGNORED = "ignored"
}
export declare enum PublishStatus {
    QUEUED = "queued",
    RUNNING = "running",
    COMPLETED = "completed",
    FAILED = "failed",
    CANCELED = "canceled"
}
export declare enum ArticleRelationType {
    SAME_WORKFLOW = "same_workflow",
    PREREQUISITE = "prerequisite",
    FOLLOW_UP = "follow_up",
    PARENT_TOPIC = "parent_topic",
    CHILD_TOPIC = "child_topic",
    SHARED_SURFACE = "shared_surface",
    REPLACES = "replaces",
    SEE_ALSO = "see_also"
}
export declare enum ArticleRelationDirection {
    BIDIRECTIONAL = "bidirectional",
    LEFT_TO_RIGHT = "left_to_right",
    RIGHT_TO_LEFT = "right_to_left"
}
export declare enum ArticleRelationOrigin {
    INFERRED = "inferred",
    MANUAL = "manual"
}
export declare enum ArticleRelationStatus {
    ACTIVE = "active",
    SUPPRESSED = "suppressed"
}
export declare enum ArticleRelationEvidenceType {
    TITLE_TOKEN = "title_token",
    SECTION_MATCH = "section_match",
    CATEGORY_MATCH = "category_match",
    CONTENT_TOKEN = "content_token",
    EXTERNAL_KEY = "external_key",
    PBI_LINK = "pbi_link",
    MANUAL_NOTE = "manual_note",
    HEURISTIC = "heuristic"
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
export type KbAccessMode = 'mcp' | 'cli';
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
}
export interface WorkspaceSettingsUpdateRequest {
    workspaceId: EntityId;
    zendeskSubdomain?: string;
    zendeskBrandId?: string;
    defaultLocale?: string;
    enabledLocales?: string[];
    kbAccessMode?: KbAccessMode;
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
    sectionId?: string | null;
    categoryId?: string | null;
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
export interface ArticleRelationSummary {
    totalActive: number;
    inferred: number;
    manual: number;
    lastRefreshedAtUtc?: string;
    latestRunState?: 'running' | 'complete' | 'failed' | 'canceled';
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
}
export interface WorkspaceMigrationHealthReport {
    catalogVersion: number;
    workspaceId: EntityId | null;
    workspaces: WorkspaceMigrationHealth[];
}
