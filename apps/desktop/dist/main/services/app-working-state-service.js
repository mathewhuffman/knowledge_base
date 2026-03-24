"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppWorkingStateService = void 0;
const shared_types_1 = require("@kb-vault/shared-types");
const logger_1 = require("./logger");
const TEMPLATE_PACK_FIELDS = [
    { key: 'name', type: 'string', label: 'Name', required: true },
    { key: 'language', type: 'string', label: 'Language', required: true },
    { key: 'templateType', type: 'enum', label: 'Template Type', required: true, options: Object.values(shared_types_1.TemplatePackType) },
    { key: 'promptTemplate', type: 'string', label: 'Prompt Template', required: true },
    { key: 'toneRules', type: 'string', label: 'Tone Rules', required: true },
    { key: 'description', type: 'string', label: 'Description' },
    { key: 'examples', type: 'string', label: 'Examples' },
    { key: 'active', type: 'boolean', label: 'Active' }
];
class AppWorkingStateService {
    emitPatchApplied;
    registrations = new Map();
    constructor(emitPatchApplied) {
        this.emitPatchApplied = emitPatchApplied;
    }
    register(input) {
        const registration = {
            ...input,
            currentValues: { ...input.currentValues }
        };
        this.registrations.set(this.keyOf(registration), registration);
        logger_1.logger.info('app-working-state.register', {
            workspaceId: input.workspaceId,
            route: input.route,
            entityType: input.entityType,
            entityId: input.entityId,
            versionToken: input.versionToken
        });
    }
    unregister(input) {
        this.registrations.delete(this.keyOf(input));
        logger_1.logger.info('app-working-state.unregister', input);
    }
    getFormSchema(input) {
        const registration = this.requireRegistration(input);
        return {
            ok: true,
            schemaVersion: shared_types_1.APP_WORKING_STATE_SCHEMA_VERSION,
            workspaceId: registration.workspaceId,
            route: registration.route,
            entityType: registration.entityType,
            entityId: registration.entityId,
            versionToken: registration.versionToken,
            fields: this.getFieldSchema(registration.route, registration.entityType),
            currentValues: { ...registration.currentValues }
        };
    }
    patchForm(input) {
        const registration = this.requireRegistration(input);
        logger_1.logger.info('app-working-state.patch-form.request', {
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
        const nextVersionToken = (0, shared_types_1.buildAppWorkingStateVersionToken)({
            route: registration.route,
            entityType: registration.entityType,
            entityId: registration.entityId,
            currentValues: nextValues
        });
        const nextRegistration = {
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
        logger_1.logger.info('app-working-state.patch-form.applied', {
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
    buildResponse(registration, input) {
        return {
            ...input,
            schemaVersion: shared_types_1.APP_WORKING_STATE_SCHEMA_VERSION,
            workspaceId: registration.workspaceId,
            route: registration.route,
            entityType: registration.entityType,
            entityId: registration.entityId,
            nextVersionToken: registration.versionToken,
            currentValues: { ...registration.currentValues }
        };
    }
    requireRegistration(input) {
        const registration = this.registrations.get(this.keyOf(input));
        if (!registration) {
            throw new Error('No mutable working state is registered for the requested route/entity.');
        }
        return registration;
    }
    validatePatch(registration, patch) {
        if (registration.route === shared_types_1.AppRoute.TEMPLATES_AND_PROMPTS && registration.entityType === 'template_pack') {
            return this.validateTemplatePackPatch(registration.currentValues, patch);
        }
        return {
            appliedPatch: {},
            ignoredKeys: [],
            validationErrors: [{ message: `Unsupported form patch target: ${registration.route}/${registration.entityType}` }]
        };
    }
    getFieldSchema(route, entityType) {
        if (route === shared_types_1.AppRoute.TEMPLATES_AND_PROMPTS && entityType === 'template_pack') {
            return TEMPLATE_PACK_FIELDS;
        }
        throw new Error(`Unsupported form schema target: ${route}/${entityType}`);
    }
    validateTemplatePackPatch(currentValues, patch) {
        const appliedPatch = {};
        const ignoredKeys = [];
        const validationErrors = [];
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
    keyOf(input) {
        return [input.workspaceId, input.route, input.entityType, input.entityId].join('::');
    }
}
exports.AppWorkingStateService = AppWorkingStateService;
function normalizeTemplatePackTypeInput(value) {
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
            return shared_types_1.TemplatePackType.FAQ;
        case 'TROUBLESHOOTING':
            return shared_types_1.TemplatePackType.TROUBLESHOOTING;
        case 'POLICY_NOTICE':
            return shared_types_1.TemplatePackType.POLICY_NOTICE;
        case 'FEATURE_OVERVIEW':
            return shared_types_1.TemplatePackType.FEATURE_OVERVIEW;
        case 'STANDARD_HOW_TO':
        case 'STANDARD_HOWTO':
        case 'HOW_TO':
            return shared_types_1.TemplatePackType.STANDARD_HOW_TO;
        default:
            return null;
    }
}
