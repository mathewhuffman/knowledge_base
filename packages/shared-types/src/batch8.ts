import type { ArticlePlacementSummary, EntityId, RevisionState } from './batch2';
import type { ProposalDiffPayload } from './batch7';

export enum DraftBranchStatus {
  ACTIVE = 'active',
  READY_TO_PUBLISH = 'ready_to_publish',
  CONFLICTED = 'conflicted',
  PUBLISHED = 'published',
  OBSOLETE = 'obsolete',
  DISCARDED = 'discarded'
}

export enum DraftValidationSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error'
}

export enum DraftValidationCode {
  INVALID_HTML = 'invalid_html',
  UNSUPPORTED_TAG = 'unsupported_tag',
  UNRESOLVED_PLACEHOLDER = 'unresolved_placeholder',
  MISSING_PLACEMENT = 'missing_placement',
  LOCALE_ISSUE = 'locale_issue'
}

export enum DraftCommitSource {
  PROPOSAL = 'proposal',
  MANUAL = 'manual',
  AUTOSAVE = 'autosave',
  SYSTEM = 'system'
}

export interface DraftValidationWarning {
  code: DraftValidationCode;
  severity: DraftValidationSeverity;
  message: string;
  line?: number;
  detail?: string;
}

export interface DraftValidationSummary {
  total: number;
  errors: number;
  warnings: number;
  infos: number;
}

export interface DraftAutosaveStatePayload {
  enabled: boolean;
  status: 'idle' | 'saved';
  lastAutosavedAtUtc?: string;
  lastManualSaveAtUtc?: string;
  pendingChanges: boolean;
}

export interface DraftBranchSummary {
  id: EntityId;
  workspaceId: EntityId;
  familyId: EntityId;
  familyTitle: string;
  localeVariantId: EntityId;
  locale: string;
  name: string;
  status: DraftBranchStatus;
  legacyState?: RevisionState | string;
  baseRevisionId: EntityId;
  baseRevisionNumber?: number;
  headRevisionId: EntityId;
  headRevisionNumber: number;
  liveRevisionId?: EntityId;
  liveRevisionNumber?: number;
  createdAtUtc: string;
  updatedAtUtc: string;
  lastAutosavedAtUtc?: string;
  lastManualSaveAtUtc?: string;
  changeSummary?: string;
  placement?: ArticlePlacementSummary;
  validationSummary: DraftValidationSummary;
}

export interface DraftBranchSummaryCounts {
  total: number;
  active: number;
  readyToPublish: number;
  conflicted: number;
  obsolete: number;
  discarded: number;
}

export interface DraftBranchListRequest {
  workspaceId: EntityId;
  localeVariantId?: EntityId;
  includeDiscarded?: boolean;
}

export interface DraftBranchListResponse {
  workspaceId: EntityId;
  summary: DraftBranchSummaryCounts;
  branches: DraftBranchSummary[];
}

export interface DraftBranchHistoryEntry {
  revisionId: EntityId;
  revisionNumber: number;
  sourceRevisionId?: EntityId;
  source: DraftCommitSource;
  summary?: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  isCurrent: boolean;
}

export interface DraftComparePayload {
  liveHtml: string;
  draftHtml: string;
  diff: ProposalDiffPayload;
}

export interface DraftEditorCapabilities {
  preferredEditor: 'monaco';
  previewSync: boolean;
  compareAgainstLive: boolean;
  undoRedo: boolean;
}

export interface DraftEditorPayload {
  html: string;
  previewHtml: string;
  compare: DraftComparePayload;
  validationWarnings: DraftValidationWarning[];
  autosave: DraftAutosaveStatePayload;
  history: DraftBranchHistoryEntry[];
  capabilities: DraftEditorCapabilities;
  editorState?: Record<string, unknown>;
}

export interface DraftBranchGetRequest {
  workspaceId: EntityId;
  branchId: EntityId;
}

export interface DraftBranchGetResponse {
  workspaceId: EntityId;
  branch: DraftBranchSummary;
  editor: DraftEditorPayload;
}

export interface DraftBranchCreateRequest {
  workspaceId: EntityId;
  localeVariantId: EntityId;
  name?: string;
  sourceHtml?: string;
  baseRevisionId?: EntityId;
  editorState?: Record<string, unknown>;
}

export interface DraftBranchSaveRequest {
  workspaceId: EntityId;
  branchId: EntityId;
  html: string;
  autosave?: boolean;
  commitMessage?: string;
  expectedHeadRevisionId?: EntityId;
  editorState?: Record<string, unknown>;
}

export interface DraftBranchSaveResponse {
  workspaceId: EntityId;
  branch: DraftBranchSummary;
  editor: DraftEditorPayload;
}

export interface DraftBranchStatusUpdateRequest {
  workspaceId: EntityId;
  branchId: EntityId;
  status: DraftBranchStatus;
}

export interface DraftBranchDiscardRequest {
  workspaceId: EntityId;
  branchId: EntityId;
}

export interface DraftBranchHistoryStepRequest {
  workspaceId: EntityId;
  branchId: EntityId;
}
