import { AppRoute } from './routes';
export const APP_WORKING_STATE_SCHEMA_VERSION = 1;
const APP_WORKING_STATE_ROUTE_ENUM = Object.values(AppRoute);
const APP_WORKING_STATE_ENTITY_TYPE_ENUM = ['template_pack', 'proposal', 'draft_branch', 'settings'];
export const MCP_APP_GET_FORM_SCHEMA_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'route', 'entityType', 'entityId'],
    properties: {
        workspaceId: { type: 'string', minLength: 1 },
        route: { type: 'string', enum: APP_WORKING_STATE_ROUTE_ENUM },
        entityType: { type: 'string', enum: [...APP_WORKING_STATE_ENTITY_TYPE_ENUM] },
        entityId: { type: 'string', minLength: 1 }
    }
};
export const MCP_APP_PATCH_FORM_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'route', 'entityType', 'entityId', 'patch'],
    properties: {
        workspaceId: { type: 'string', minLength: 1 },
        route: { type: 'string', enum: APP_WORKING_STATE_ROUTE_ENUM },
        entityType: { type: 'string', enum: [...APP_WORKING_STATE_ENTITY_TYPE_ENUM] },
        entityId: { type: 'string', minLength: 1 },
        versionToken: { type: 'string', minLength: 1 },
        patch: {
            type: 'object',
            minProperties: 1,
            additionalProperties: true
        }
    }
};
function sortValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => sortValue(item));
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    return Object.keys(value)
        .sort()
        .reduce((acc, key) => {
        acc[key] = sortValue(value[key]);
        return acc;
    }, {});
}
export function stableStringifyAppWorkingState(value) {
    return JSON.stringify(sortValue(value));
}
export function buildAppWorkingStateVersionToken(input) {
    return [
        input.route,
        input.entityType,
        input.entityId,
        stableStringifyAppWorkingState(input.currentValues)
    ].join(':');
}
