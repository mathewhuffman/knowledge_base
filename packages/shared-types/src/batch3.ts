import type { DraftBranchStatus, DraftValidationCode, DraftValidationSeverity } from './batch8';
import type { JobState } from './ipc';

export interface ZendeskCredentialRecord {
  workspaceId: string;
  email: string;
  hasApiToken: boolean;
}

export interface ZendeskCredentialsInput {
  workspaceId: string;
  email: string;
  apiToken: string;
}

export interface ZendeskConnectionTestRequest {
  workspaceId: string;
}

export type ZendeskSyncMode = 'full' | 'incremental';
export type ZendeskPublishMode = 'selected' | 'ready_queue';
export type ZendeskPublishTarget = 'draft' | 'live';

export interface ZendeskSyncRunRequest {
  workspaceId: string;
  mode: ZendeskSyncMode;
  locale?: string;
  force?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
  retryMaxDelayMs?: number;
}

export interface ZendeskSyncSummary {
  workspaceId: string;
  mode: ZendeskSyncMode;
  locales: string[];
  syncedArticles: number;
  skippedArticles: number;
  createdFamilies: number;
  createdVariants: number;
  createdRevisions: number;
  startedAtUtc: string;
  endedAtUtc: string;
  durationMs: number;
}

export interface ZendeskSyncRunRecord {
  id: string;
  workspaceId: string;
  mode: ZendeskSyncMode;
  startedAtUtc: string;
  endedAtUtc: string;
  state: JobState;
  cursorSummary?: Record<string, string>;
  syncedArticles: number;
  skippedArticles: number;
  createdFamilies: number;
  createdVariants: number;
  createdRevisions: number;
  remoteError?: string;
}

export interface ZendeskSyncCheckpoint {
  workspaceId: string;
  locale: string;
  lastSyncedAt?: string;
  cursor?: string;
  syncedArticles: number;
  updatedAtUtc: string;
}

export interface ZendeskSyncProgressPayload {
  command: string;
  mode: ZendeskSyncMode;
  workspaceId: string;
  locale?: string;
  state: JobState;
  progress: number;
  message?: string;
}

export enum ZendeskPublishValidationCode {
  BRANCH_NOT_READY = 'branch_not_ready',
  DRAFT_VALIDATION = 'draft_validation',
  PLACEHOLDER_BLOCKED = 'placeholder_blocked',
  MISSING_PLACEMENT = 'missing_placement',
  LOCALE_DISABLED = 'locale_disabled',
  ZENDESK_CONFIGURATION = 'zendesk_configuration',
  REMOTE_ARTICLE_MISSING = 'remote_article_missing',
  REMOTE_LOCALE_DISABLED = 'remote_locale_disabled',
  REMOTE_CONFLICT = 'remote_conflict'
}

export enum PublishJobItemState {
  QUEUED = 'queued',
  RUNNING = 'running',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  BLOCKED = 'blocked',
  CONFLICTED = 'conflicted',
  CANCELED = 'canceled'
}

export interface ZendeskPublishValidationIssue {
  code: ZendeskPublishValidationCode;
  severity: DraftValidationSeverity;
  message: string;
  detail?: string;
  sourceCode?: DraftValidationCode;
}

export interface ZendeskPublishValidationItem {
  workspaceId: string;
  branchId: string;
  branchName: string;
  branchStatus: DraftBranchStatus;
  familyId: string;
  familyTitle: string;
  localeVariantId: string;
  locale: string;
  externalKey?: string;
  zendeskArticleId?: string;
  headRevisionId: string;
  headRevisionNumber: number;
  liveRevisionId?: string;
  liveRevisionNumber?: number;
  placement?: {
    categoryId?: string;
    categoryName?: string;
    sectionId?: string;
    sectionName?: string;
  };
  canPublish: boolean;
  issues: ZendeskPublishValidationIssue[];
  remoteUpdatedAtUtc?: string;
}

export interface ZendeskPublishValidationSummary {
  total: number;
  publishable: number;
  blocked: number;
  conflicts: number;
  warnings: number;
}

export interface ZendeskPublishValidateRequest {
  workspaceId: string;
  branchIds?: string[];
}

export interface ZendeskPublishValidateResponse {
  workspaceId: string;
  summary: ZendeskPublishValidationSummary;
  items: ZendeskPublishValidationItem[];
  validatedAtUtc: string;
}

export interface ZendeskPublishRunRequest {
  workspaceId: string;
  branchIds?: string[];
  requestedBy?: string;
  mode?: ZendeskPublishMode;
  publishTarget?: ZendeskPublishTarget;
}

export interface ZendeskPublishJobItemRecord {
  id: string;
  jobId: string;
  workspaceId: string;
  branchId: string;
  branchName: string;
  familyId: string;
  familyTitle: string;
  localeVariantId: string;
  locale: string;
  status: PublishJobItemState;
  zendeskArticleId?: string;
  zendeskSourceArticleId?: string;
  publishedRevisionId?: string;
  resultCode?: string;
  resultMessage?: string;
  remoteUpdatedAtUtc?: string;
  issues: ZendeskPublishValidationIssue[];
  startedAtUtc?: string;
  completedAtUtc?: string;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface ZendeskPublishJobSummary {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  blocked: number;
  conflicted: number;
  canceled: number;
}

export interface ZendeskPublishJobGetRequest {
  workspaceId: string;
  jobId?: string;
}

export interface ZendeskPublishJobSnapshot {
  workspaceId: string;
  job: {
    id: string;
    workspaceId: string;
    status: string;
    requestedBy?: string;
    enqueuedAtUtc: string;
    startedAtUtc?: string;
    completedAtUtc?: string;
    branchIds: string[];
  } | null;
  items: ZendeskPublishJobItemRecord[];
  summary: ZendeskPublishJobSummary;
}

export type ZendeskRetireActionStatus =
  | 'pending'
  | 'running'
  | 'failed'
  | 'archived'
  | 'already_archived';

export interface ZendeskRetireQueueItem {
  workspaceId: string;
  proposalId: string;
  batchId: string;
  familyId?: string;
  localeVariantId?: string;
  familyTitle: string;
  locale?: string;
  externalKey?: string;
  zendeskArticleId?: string;
  canArchive: boolean;
  blockedReason?: string;
  localRetiredAtUtc?: string;
  remoteRetireStatus?: ZendeskRetireActionStatus;
  remoteAttemptedAtUtc?: string;
  remoteRetiredAtUtc?: string;
  remoteRetireMessage?: string;
}

export interface ZendeskRetireQueueSummary {
  total: number;
  ready: number;
  blocked: number;
  failed: number;
}

export interface ZendeskRetireQueueListRequest {
  workspaceId: string;
  proposalIds?: string[];
}

export interface ZendeskRetireQueueListResponse {
  workspaceId: string;
  summary: ZendeskRetireQueueSummary;
  items: ZendeskRetireQueueItem[];
  listedAtUtc: string;
}

export interface ZendeskRetireRunRequest {
  workspaceId: string;
  proposalIds?: string[];
  requestedBy?: string;
}

export interface ZendeskCategoryRecord {
  id: number;
  name: string;
  position?: number;
  outdated?: boolean;
  updatedAtUtc?: string;
}

export interface ZendeskSectionRecord {
  id: number;
  name: string;
  categoryId?: number;
  position?: number;
  outdated?: boolean;
  updatedAtUtc?: string;
}

export interface ZendeskSearchArticleRecord {
  id: number;
  title: string;
  locale: string;
  sourceId?: number;
  sectionId?: number;
  categoryId?: number;
  updatedAtUtc: string;
}

export interface ZendeskSearchArticlesRequest {
  workspaceId: string;
  locale: string;
  query: string;
}

export interface ZendeskCategoriesListRequest {
  workspaceId: string;
  locale: string;
}

export interface ZendeskSectionsListRequest {
  workspaceId: string;
  locale: string;
  categoryId: number;
}
