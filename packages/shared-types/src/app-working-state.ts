import { AppRoute } from './routes';

export const APP_WORKING_STATE_SCHEMA_VERSION = 1 as const;

export type AppWorkingStateEntityType = 'template_pack' | 'proposal' | 'draft_branch' | 'settings';

export type AppWorkingStateFieldType = 'string' | 'boolean' | 'number' | 'enum' | 'json';

export interface AppWorkingStateFieldSchema {
  key: string;
  type: AppWorkingStateFieldType;
  label?: string;
  required?: boolean;
  options?: string[];
}

export interface AppWorkingStateSchemaRequest {
  workspaceId: string;
  route: AppRoute;
  entityType: AppWorkingStateEntityType;
  entityId: string;
}

export interface AppWorkingStateSchemaResponse {
  ok: boolean;
  schemaVersion: typeof APP_WORKING_STATE_SCHEMA_VERSION;
  workspaceId: string;
  route: AppRoute;
  entityType: AppWorkingStateEntityType;
  entityId: string;
  versionToken: string;
  fields: AppWorkingStateFieldSchema[];
  currentValues: Record<string, unknown>;
}

export interface AppWorkingStatePatchRequest {
  schemaVersion?: typeof APP_WORKING_STATE_SCHEMA_VERSION;
  workspaceId: string;
  route: AppRoute;
  entityType: AppWorkingStateEntityType;
  entityId: string;
  versionToken?: string;
  patch: Record<string, unknown>;
}

export interface AppWorkingStatePatchValidationError {
  key?: string;
  message: string;
}

export interface AppWorkingStatePatchResponse {
  ok: boolean;
  applied: boolean;
  schemaVersion: typeof APP_WORKING_STATE_SCHEMA_VERSION;
  workspaceId: string;
  route: AppRoute;
  entityType: AppWorkingStateEntityType;
  entityId: string;
  appliedPatch: Record<string, unknown>;
  ignoredKeys: string[];
  validationErrors: AppWorkingStatePatchValidationError[];
  nextVersionToken?: string;
  currentValues?: Record<string, unknown>;
}

export interface AppWorkingStateRegistration {
  workspaceId: string;
  route: AppRoute;
  entityType: AppWorkingStateEntityType;
  entityId: string;
  versionToken: string;
  currentValues: Record<string, unknown>;
}

export interface AppWorkingStatePatchAppliedEvent {
  workspaceId: string;
  route: AppRoute;
  entityType: AppWorkingStateEntityType;
  entityId: string;
  appliedPatch: Record<string, unknown>;
  nextVersionToken: string;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortValue((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
}

export function stableStringifyAppWorkingState(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function buildAppWorkingStateVersionToken(input: {
  route: AppRoute;
  entityType: AppWorkingStateEntityType;
  entityId: string;
  currentValues: Record<string, unknown>;
}): string {
  return [
    input.route,
    input.entityType,
    input.entityId,
    stableStringifyAppWorkingState(input.currentValues)
  ].join(':');
}
