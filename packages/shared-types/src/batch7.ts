import type { EntityId, PBIRecord, PBIBatchStatus, ProposalAction } from './batch2';

export enum ProposalReviewStatus {
  PENDING_REVIEW = 'pending_review',
  ACCEPTED = 'accepted',
  DENIED = 'denied',
  DEFERRED = 'deferred',
  APPLIED_TO_BRANCH = 'applied_to_branch',
  ARCHIVED = 'archived'
}

export enum ProposalReviewDecision {
  ACCEPT = 'accept',
  DENY = 'deny',
  DEFER = 'defer',
  APPLY_TO_BRANCH = 'apply_to_branch',
  ARCHIVE = 'archive'
}

export interface ProposalPlacementSuggestion {
  categoryId?: string;
  sectionId?: string;
  articleTitle?: string;
  parentArticleId?: string;
  notes?: string;
}

export interface ProposalReviewRecord {
  id: EntityId;
  workspaceId: EntityId;
  batchId: EntityId;
  sessionId?: string;
  action: ProposalAction;
  reviewStatus: ProposalReviewStatus;
  legacyStatus?: string;
  familyId?: EntityId;
  localeVariantId?: EntityId;
  sourceRevisionId?: EntityId;
  branchId?: EntityId;
  targetTitle?: string;
  targetLocale?: string;
  confidenceScore?: number;
  rationaleSummary?: string;
  aiNotes?: string;
  suggestedPlacement?: ProposalPlacementSuggestion;
  sourceHtmlPath?: string;
  proposedHtmlPath?: string;
  metadata?: unknown;
  queueOrder: number;
  generatedAtUtc: string;
  updatedAtUtc: string;
  decidedAtUtc?: string;
}

export interface ProposalReviewQueueItem {
  proposalId: EntityId;
  queueOrder: number;
  action: ProposalAction;
  reviewStatus: ProposalReviewStatus;
  articleKey: string;
  articleLabel: string;
  locale?: string;
  confidenceScore?: number;
  rationaleSummary?: string;
  relatedPbiCount: number;
}

export interface ProposalReviewGroup {
  articleKey: string;
  articleLabel: string;
  locale?: string;
  proposalIds: EntityId[];
  total: number;
  actions: ProposalAction[];
}

export interface ProposalReviewSummaryCounts {
  total: number;
  pendingReview: number;
  accepted: number;
  denied: number;
  deferred: number;
  appliedToBranch: number;
  archived: number;
}

export interface ProposalReviewBatchListRequest {
  workspaceId: EntityId;
}

export interface ProposalReviewBatchSummary {
  batchId: EntityId;
  batchName: string;
  sourceFileName: string;
  importedAtUtc: string;
  batchStatus: PBIBatchStatus | 'proposed';
  proposalCount: number;
  pendingReviewCount: number;
  acceptedCount: number;
  deniedCount: number;
  deferredCount: number;
  appliedToBranchCount: number;
  archivedCount: number;
}

export interface ProposalReviewBatchListResponse {
  workspaceId: EntityId;
  batches: ProposalReviewBatchSummary[];
}

export interface ProposalReviewListRequest {
  workspaceId: EntityId;
  batchId: EntityId;
}

export interface ProposalReviewListResponse {
  workspaceId: EntityId;
  batchId: EntityId;
  batchStatus: PBIBatchStatus | 'proposed';
  summary: ProposalReviewSummaryCounts;
  queue: ProposalReviewQueueItem[];
  groups: ProposalReviewGroup[];
}

export interface ProposalSourceLineChange {
  kind: 'added' | 'removed' | 'unchanged';
  lineNumberBefore?: number;
  lineNumberAfter?: number;
  content: string;
}

export interface ProposalRenderedBlockChange {
  kind: 'added' | 'removed' | 'unchanged';
  beforeText?: string;
  afterText?: string;
}

export interface ProposalChangeRegion {
  id: string;
  kind: 'added' | 'removed' | 'changed';
  label: string;
  beforeText?: string;
  afterText?: string;
  beforeLineStart?: number;
  beforeLineEnd?: number;
  afterLineStart?: number;
  afterLineEnd?: number;
}

export interface ProposalChangeGutterItem {
  lineNumber: number;
  kind: 'added' | 'removed' | 'changed';
  regionId: string;
  side: 'before' | 'after';
}

export interface ProposalDiffPayload {
  beforeHtml: string;
  afterHtml: string;
  sourceDiff: {
    lines: ProposalSourceLineChange[];
  };
  renderedDiff: {
    blocks: ProposalRenderedBlockChange[];
  };
  changeRegions: ProposalChangeRegion[];
  gutter: ProposalChangeGutterItem[];
}

export interface ProposalReviewGetRequest {
  workspaceId: EntityId;
  proposalId: EntityId;
}

export interface ProposalReviewNavigation {
  currentIndex: number;
  total: number;
  previousProposalId?: EntityId;
  nextProposalId?: EntityId;
}

export interface ProposalReviewDetailResponse {
  workspaceId: EntityId;
  batchId: EntityId;
  batchStatus: PBIBatchStatus | 'proposed';
  proposal: ProposalReviewRecord;
  relatedPbis: PBIRecord[];
  diff: ProposalDiffPayload;
  navigation: ProposalReviewNavigation;
}

export interface ProposalReviewDecisionRequest {
  workspaceId: EntityId;
  proposalId: EntityId;
  decision: ProposalReviewDecision;
  branchId?: EntityId;
  note?: string;
  placementOverride?: ProposalPlacementSuggestion;
}

export interface ProposalReviewDecisionResponse {
  workspaceId: EntityId;
  batchId: EntityId;
  proposalId: EntityId;
  reviewStatus: ProposalReviewStatus;
  batchStatus: PBIBatchStatus | 'proposed';
  summary: ProposalReviewSummaryCounts;
}

export interface ProposalIngestRequest {
  workspaceId: EntityId;
  batchId: EntityId;
  action: ProposalAction;
  sessionId?: EntityId;
  localeVariantId?: EntityId;
  familyId?: EntityId;
  sourceRevisionId?: EntityId;
  targetTitle?: string;
  targetLocale?: string;
  confidenceScore?: number;
  rationaleSummary?: string;
  aiNotes?: string;
  suggestedPlacement?: ProposalPlacementSuggestion;
  sourceHtml?: string;
  proposedHtml?: string;
  relatedPbiIds?: EntityId[];
  metadata?: unknown;
}
