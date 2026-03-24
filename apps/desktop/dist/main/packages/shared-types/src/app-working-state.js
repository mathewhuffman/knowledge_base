"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.APP_WORKING_STATE_SCHEMA_VERSION = void 0;
exports.stableStringifyAppWorkingState = stableStringifyAppWorkingState;
exports.buildAppWorkingStateVersionToken = buildAppWorkingStateVersionToken;
exports.APP_WORKING_STATE_SCHEMA_VERSION = 1;
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
function stableStringifyAppWorkingState(value) {
    return JSON.stringify(sortValue(value));
}
function buildAppWorkingStateVersionToken(input) {
    return [
        input.route,
        input.entityType,
        input.entityId,
        stableStringifyAppWorkingState(input.currentValues)
    ].join(':');
}
