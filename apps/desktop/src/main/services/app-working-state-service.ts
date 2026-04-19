import {
  APP_WORKING_STATE_SCHEMA_VERSION,
  AppRoute,
  TemplatePackType,
  buildAppWorkingStateVersionToken,
  type AppWorkingStateEntityType,
  type AppWorkingStateFieldSchema,
  type AppWorkingStatePatchAppliedEvent,
  type AppWorkingStatePatchRequest,
  type AppWorkingStatePatchResponse,
  type AppWorkingStateRegistration,
  type AppWorkingStateSchemaRequest,
  type AppWorkingStateSchemaResponse
} from '@kb-vault/shared-types';
import { logger } from './logger';

type SupportedRegistration = AppWorkingStateRegistration & {
  currentValues: Record<string, unknown>;
};

type PatchValidationResult = {
  appliedPatch: Record<string, unknown>;
  ignoredKeys: string[];
  validationErrors: AppWorkingStatePatchResponse['validationErrors'];
};

const TEMPLATE_PACK_FIELDS: AppWorkingStateFieldSchema[] = [
  { key: 'name', type: 'string', label: 'Name', required: true },
  { key: 'language', type: 'string', label: 'Language', required: true },
  { key: 'templateType', type: 'enum', label: 'Template Type', required: true, options: Object.values(TemplatePackType) },
  { key: 'promptTemplate', type: 'string', label: 'Prompt Template', required: true },
  { key: 'toneRules', type: 'string', label: 'Tone Rules', required: true },
  { key: 'description', type: 'string', label: 'Description' },
  { key: 'examples', type: 'string', label: 'Examples' },
  { key: 'active', type: 'boolean', label: 'Active' }
];

const PROPOSAL_FIELDS: AppWorkingStateFieldSchema[] = [
  { key: 'html', type: 'string', label: 'HTML', required: true },
  { key: 'title', type: 'string', label: 'Title' },
  { key: 'rationale', type: 'string', label: 'Rationale' },
  { key: 'rationaleSummary', type: 'string', label: 'Rationale Summary' },
  { key: 'aiNotes', type: 'string', label: 'AI Notes' }
];

const DRAFT_BRANCH_FIELDS: AppWorkingStateFieldSchema[] = [
  { key: 'html', type: 'string', label: 'HTML', required: true }
];

export class AppWorkingStateService {
  private readonly registrations = new Map<string, SupportedRegistration>();

  constructor(private readonly emitPatchApplied: (event: AppWorkingStatePatchAppliedEvent) => void) {}

  register(input: AppWorkingStateRegistration): void {
    const registration: SupportedRegistration = {
      ...input,
      currentValues: { ...input.currentValues }
    };
    this.registrations.set(this.keyOf(registration), registration);
    logger.info('app-working-state.register', {
      workspaceId: input.workspaceId,
      route: input.route,
      entityType: input.entityType,
      entityId: input.entityId,
      versionToken: input.versionToken
    });
  }

  unregister(input: Pick<AppWorkingStateRegistration, 'workspaceId' | 'route' | 'entityType' | 'entityId'>): void {
    this.registrations.delete(this.keyOf(input));
    logger.info('app-working-state.unregister', input);
  }

  getFormSchema(input: AppWorkingStateSchemaRequest): AppWorkingStateSchemaResponse {
    const registration = this.requireRegistration(input);
    return {
      ok: true,
      schemaVersion: APP_WORKING_STATE_SCHEMA_VERSION,
      workspaceId: registration.workspaceId,
      route: registration.route,
      entityType: registration.entityType,
      entityId: registration.entityId,
      versionToken: registration.versionToken,
      fields: this.getFieldSchema(registration.route, registration.entityType),
      currentValues: { ...registration.currentValues }
    };
  }

  patchForm(input: AppWorkingStatePatchRequest): AppWorkingStatePatchResponse {
    const registration = this.requireRegistration(input);
    logger.info('app-working-state.patch-form.request', {
      workspaceId: input.workspaceId,
      route: input.route,
      entityType: input.entityType,
      entityId: input.entityId,
      versionToken: input.versionToken,
      patchKeys: Object.keys(input.patch ?? {})
    });

    if (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)) {
      return this.buildResponse(registration, {
        ok: false,
        applied: false,
        appliedPatch: {},
        ignoredKeys: [],
        validationErrors: [{ message: 'patch must be an object' }]
      });
    }

    if (input.versionToken && input.versionToken !== registration.versionToken) {
      return this.buildResponse(registration, {
        ok: false,
        applied: false,
        appliedPatch: {},
        ignoredKeys: [],
        validationErrors: [{
          key: 'versionToken',
          message: `Version token mismatch. Expected ${registration.versionToken}.`
        }]
      });
    }

    const validation = this.validatePatch(registration, input.patch);
    if (validation.validationErrors.length > 0) {
      return this.buildResponse(registration, {
        ok: false,
        applied: false,
        appliedPatch: validation.appliedPatch,
        ignoredKeys: validation.ignoredKeys,
        validationErrors: validation.validationErrors
      });
    }

    if (Object.keys(validation.appliedPatch).length === 0) {
      return this.buildResponse(registration, {
        ok: true,
        applied: false,
        appliedPatch: {},
        ignoredKeys: validation.ignoredKeys,
        validationErrors: []
      });
    }

    const nextValues = {
      ...registration.currentValues,
      ...validation.appliedPatch
    };
    const nextVersionToken = buildAppWorkingStateVersionToken({
      route: registration.route,
      entityType: registration.entityType,
      entityId: registration.entityId,
      currentValues: nextValues
    });

    const nextRegistration: SupportedRegistration = {
      ...registration,
      currentValues: nextValues,
      versionToken: nextVersionToken
    };
    this.registrations.set(this.keyOf(nextRegistration), nextRegistration);

    const response = this.buildResponse(nextRegistration, {
      ok: true,
      applied: true,
      appliedPatch: validation.appliedPatch,
      ignoredKeys: validation.ignoredKeys,
      validationErrors: []
    });

    logger.info('app-working-state.patch-form.applied', {
      workspaceId: input.workspaceId,
      route: input.route,
      entityType: input.entityType,
      entityId: input.entityId,
      appliedPatch: validation.appliedPatch,
      nextVersionToken
    });

    this.emitPatchApplied({
      workspaceId: nextRegistration.workspaceId,
      route: nextRegistration.route,
      entityType: nextRegistration.entityType,
      entityId: nextRegistration.entityId,
      appliedPatch: validation.appliedPatch,
      nextVersionToken
    });

    return response;
  }

  private buildResponse(
    registration: SupportedRegistration,
    input: Omit<AppWorkingStatePatchResponse, 'schemaVersion' | 'workspaceId' | 'route' | 'entityType' | 'entityId' | 'nextVersionToken' | 'currentValues'>
  ): AppWorkingStatePatchResponse {
    return {
      ...input,
      schemaVersion: APP_WORKING_STATE_SCHEMA_VERSION,
      workspaceId: registration.workspaceId,
      route: registration.route,
      entityType: registration.entityType,
      entityId: registration.entityId,
      nextVersionToken: registration.versionToken,
      currentValues: { ...registration.currentValues }
    };
  }

  private requireRegistration(input: {
    workspaceId: string;
    route: AppRoute;
    entityType: AppWorkingStateEntityType;
    entityId: string;
  }): SupportedRegistration {
    const registration = this.registrations.get(this.keyOf(input));
    if (!registration) {
      throw new Error('No mutable working state is registered for the requested route/entity.');
    }
    return registration;
  }

  private validatePatch(registration: SupportedRegistration, patch: Record<string, unknown>): PatchValidationResult {
    if (registration.route === AppRoute.TEMPLATES_AND_PROMPTS && registration.entityType === 'template_pack') {
      return this.validateTemplatePackPatch(registration.currentValues, patch);
    }
    if (registration.route === AppRoute.PROPOSAL_REVIEW && registration.entityType === 'proposal') {
      return this.validateStringFieldPatch(registration.currentValues, patch, PROPOSAL_FIELDS);
    }
    if (registration.route === AppRoute.DRAFTS && registration.entityType === 'draft_branch') {
      return this.validateStringFieldPatch(registration.currentValues, patch, DRAFT_BRANCH_FIELDS);
    }
    return {
      appliedPatch: {},
      ignoredKeys: [],
      validationErrors: [{ message: `Unsupported form patch target: ${registration.route}/${registration.entityType}` }]
    };
  }

  private getFieldSchema(route: AppRoute, entityType: AppWorkingStateEntityType): AppWorkingStateFieldSchema[] {
    if (route === AppRoute.TEMPLATES_AND_PROMPTS && entityType === 'template_pack') {
      return TEMPLATE_PACK_FIELDS;
    }
    if (route === AppRoute.PROPOSAL_REVIEW && entityType === 'proposal') {
      return PROPOSAL_FIELDS;
    }
    if (route === AppRoute.DRAFTS && entityType === 'draft_branch') {
      return DRAFT_BRANCH_FIELDS;
    }
    throw new Error(`Unsupported form schema target: ${route}/${entityType}`);
  }

  private validateTemplatePackPatch(currentValues: Record<string, unknown>, patch: Record<string, unknown>): PatchValidationResult {
    const appliedPatch: Record<string, unknown> = {};
    const ignoredKeys: string[] = [];
    const validationErrors: PatchValidationResult['validationErrors'] = [];
    const allowedKeys = new Set(TEMPLATE_PACK_FIELDS.map((field) => field.key));

    for (const [key, value] of Object.entries(patch)) {
      if (!allowedKeys.has(key)) {
        validationErrors.push({ key, message: `Unknown template field: ${key}` });
        continue;
      }

      if (key === 'active') {
        if (typeof value !== 'boolean') {
          validationErrors.push({ key, message: 'active must be a boolean' });
          continue;
        }
        if (currentValues[key] === value) {
          ignoredKeys.push(key);
          continue;
        }
        appliedPatch[key] = value;
        continue;
      }

      if (key === 'templateType') {
        const normalizedType = normalizeTemplatePackTypeInput(value);
        if (!normalizedType) {
          validationErrors.push({ key, message: `Invalid templateType: ${String(value)}` });
          continue;
        }
        if (currentValues[key] === normalizedType) {
          ignoredKeys.push(key);
          continue;
        }
        appliedPatch[key] = normalizedType;
        continue;
      }

      if (typeof value !== 'string') {
        validationErrors.push({ key, message: `${key} must be a string` });
        continue;
      }

      if (currentValues[key] === value) {
        ignoredKeys.push(key);
        continue;
      }

      appliedPatch[key] = value;
    }

    return {
      appliedPatch,
      ignoredKeys,
      validationErrors
    };
  }

  private validateStringFieldPatch(
    currentValues: Record<string, unknown>,
    patch: Record<string, unknown>,
    fields: AppWorkingStateFieldSchema[]
  ): PatchValidationResult {
    const appliedPatch: Record<string, unknown> = {};
    const ignoredKeys: string[] = [];
    const validationErrors: PatchValidationResult['validationErrors'] = [];
    const allowedKeys = new Set(fields.map((field) => field.key));

    for (const [key, value] of Object.entries(patch)) {
      if (!allowedKeys.has(key)) {
        validationErrors.push({ key, message: `Unknown field: ${key}` });
        continue;
      }

      if (typeof value !== 'string') {
        validationErrors.push({ key, message: `${key} must be a string` });
        continue;
      }

      if ((currentValues[key] ?? '') === value) {
        ignoredKeys.push(key);
        continue;
      }

      appliedPatch[key] = value;
    }

    return {
      appliedPatch,
      ignoredKeys,
      validationErrors
    };
  }

  private keyOf(input: {
    workspaceId: string;
    route: AppRoute;
    entityType: AppWorkingStateEntityType;
    entityId: string;
  }): string {
    return [input.workspaceId, input.route, input.entityType, input.entityId].join('::');
  }
}

function normalizeTemplatePackTypeInput(value: unknown): TemplatePackType | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  const canonical = normalized
    .replace(/[\/\s-]+/g, '_')
    .replace(/__+/g, '_')
    .toUpperCase();

  switch (canonical) {
    case 'FAQ':
      return TemplatePackType.FAQ;
    case 'TROUBLESHOOTING':
      return TemplatePackType.TROUBLESHOOTING;
    case 'POLICY_NOTICE':
      return TemplatePackType.POLICY_NOTICE;
    case 'FEATURE_OVERVIEW':
      return TemplatePackType.FEATURE_OVERVIEW;
    case 'STANDARD_HOW_TO':
    case 'STANDARD_HOWTO':
    case 'HOW_TO':
      return TemplatePackType.STANDARD_HOW_TO;
    default:
      return null;
  }
}
