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
