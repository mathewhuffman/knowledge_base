"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCP_RECORD_AGENT_NOTES_INPUT_SCHEMA = exports.MCP_GET_ARTICLE_HISTORY_INPUT_SCHEMA = exports.MCP_GET_PBI_SUBSET_INPUT_SCHEMA = exports.MCP_GET_PBI_INPUT_SCHEMA = exports.MCP_GET_BATCH_CONTEXT_INPUT_SCHEMA = exports.MCP_GET_TEMPLATE_INPUT_SCHEMA = exports.MCP_LIST_ARTICLE_TEMPLATES_INPUT_SCHEMA = exports.MCP_LIST_SECTIONS_INPUT_SCHEMA = exports.MCP_LIST_CATEGORIES_INPUT_SCHEMA = exports.MCP_FIND_RELATED_ARTICLES_INPUT_SCHEMA = exports.MCP_GET_LOCALE_VARIANT_INPUT_SCHEMA = exports.MCP_GET_ARTICLE_FAMILY_INPUT_SCHEMA = exports.MCP_GET_ARTICLE_INPUT_SCHEMA = exports.MCP_SEARCH_KB_INPUT_SCHEMA = exports.CliHealthFailure = exports.AgentCommand = exports.DEFAULT_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES = exports.MAX_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES = exports.MIN_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES = void 0;
exports.normalizeBatchAnalysisWorkerStageBudgetMinutes = normalizeBatchAnalysisWorkerStageBudgetMinutes;
exports.MIN_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES = 5;
exports.MAX_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES = 180;
exports.DEFAULT_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES = 10;
function normalizeBatchAnalysisWorkerStageBudgetMinutes(value) {
    if (value === null || value === undefined || value === '') {
        return undefined;
    }
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return undefined;
    }
    return Math.min(exports.MAX_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES, Math.max(exports.MIN_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES, Math.round(parsed)));
}
var AgentCommand;
(function (AgentCommand) {
    AgentCommand["ANALYSIS_RUN"] = "agent.analysis.run";
    AgentCommand["ARTICLE_EDIT_RUN"] = "agent.article_edit.run";
})(AgentCommand || (exports.AgentCommand = AgentCommand = {}));
var CliHealthFailure;
(function (CliHealthFailure) {
    CliHealthFailure["BINARY_NOT_FOUND"] = "binary_not_found";
    CliHealthFailure["BINARY_NOT_EXECUTABLE"] = "binary_not_executable";
    CliHealthFailure["LOOPBACK_NOT_RUNNING"] = "loopback_not_running";
    CliHealthFailure["LOOPBACK_UNREACHABLE"] = "loopback_unreachable";
    CliHealthFailure["LOOPBACK_UNHEALTHY"] = "loopback_unhealthy";
    CliHealthFailure["AUTH_TOKEN_MISSING"] = "auth_token_missing";
    CliHealthFailure["HEALTH_PROBE_TIMEOUT"] = "health_probe_timeout";
    CliHealthFailure["HEALTH_PROBE_FAILED"] = "health_probe_failed";
    CliHealthFailure["HEALTH_PROBE_REJECTED"] = "health_probe_rejected";
})(CliHealthFailure || (exports.CliHealthFailure = CliHealthFailure = {}));
const MCP_NON_EMPTY_STRING_SCHEMA = { type: 'string', minLength: 1 };
const MCP_NON_EMPTY_STRING_ARRAY_SCHEMA = {
    type: 'array',
    minItems: 1,
    items: MCP_NON_EMPTY_STRING_SCHEMA
};
exports.MCP_SEARCH_KB_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId'],
    anyOf: [
        { required: ['query'] },
        { required: ['localeVariantIds'] },
        { required: ['familyIds'] },
        { required: ['revisionIds'] }
    ],
    properties: {
        workspaceId: MCP_NON_EMPTY_STRING_SCHEMA,
        query: MCP_NON_EMPTY_STRING_SCHEMA,
        localeVariantIds: MCP_NON_EMPTY_STRING_ARRAY_SCHEMA,
        familyIds: MCP_NON_EMPTY_STRING_ARRAY_SCHEMA,
        revisionIds: MCP_NON_EMPTY_STRING_ARRAY_SCHEMA,
        includeArchived: { type: 'boolean' }
    }
};
exports.MCP_GET_ARTICLE_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId'],
    anyOf: [
        { required: ['revisionId'] },
        { required: ['localeVariantId'] }
    ],
    properties: {
        workspaceId: MCP_NON_EMPTY_STRING_SCHEMA,
        revisionId: MCP_NON_EMPTY_STRING_SCHEMA,
        localeVariantId: MCP_NON_EMPTY_STRING_SCHEMA
    }
};
exports.MCP_GET_ARTICLE_FAMILY_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'familyId'],
    properties: {
        workspaceId: MCP_NON_EMPTY_STRING_SCHEMA,
        familyId: MCP_NON_EMPTY_STRING_SCHEMA
    }
};
exports.MCP_GET_LOCALE_VARIANT_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'localeVariantId'],
    properties: {
        workspaceId: MCP_NON_EMPTY_STRING_SCHEMA,
        localeVariantId: MCP_NON_EMPTY_STRING_SCHEMA
    }
};
exports.MCP_FIND_RELATED_ARTICLES_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId'],
    anyOf: [
        { required: ['query'] },
        { required: ['articleId'] },
        { required: ['familyId'] },
        { required: ['batchId'] }
    ],
    properties: {
        workspaceId: MCP_NON_EMPTY_STRING_SCHEMA,
        query: MCP_NON_EMPTY_STRING_SCHEMA,
        articleId: MCP_NON_EMPTY_STRING_SCHEMA,
        familyId: MCP_NON_EMPTY_STRING_SCHEMA,
        batchId: MCP_NON_EMPTY_STRING_SCHEMA,
        locale: MCP_NON_EMPTY_STRING_SCHEMA,
        max: { type: 'integer', minimum: 1, maximum: 100 },
        minScore: { type: 'number', minimum: 0, maximum: 1 },
        includeEvidence: { type: 'boolean' }
    }
};
exports.MCP_LIST_CATEGORIES_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'locale'],
    properties: {
        workspaceId: MCP_NON_EMPTY_STRING_SCHEMA,
        locale: MCP_NON_EMPTY_STRING_SCHEMA
    }
};
exports.MCP_LIST_SECTIONS_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'locale', 'categoryId'],
    properties: {
        workspaceId: MCP_NON_EMPTY_STRING_SCHEMA,
        locale: MCP_NON_EMPTY_STRING_SCHEMA,
        categoryId: { type: 'integer', minimum: 1 }
    }
};
exports.MCP_LIST_ARTICLE_TEMPLATES_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId'],
    properties: {
        workspaceId: MCP_NON_EMPTY_STRING_SCHEMA,
        locale: MCP_NON_EMPTY_STRING_SCHEMA,
        includeInactive: { type: 'boolean' }
    }
};
exports.MCP_GET_TEMPLATE_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'templatePackId'],
    properties: {
        workspaceId: MCP_NON_EMPTY_STRING_SCHEMA,
        templatePackId: MCP_NON_EMPTY_STRING_SCHEMA
    }
};
exports.MCP_GET_BATCH_CONTEXT_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'batchId'],
    properties: {
        workspaceId: MCP_NON_EMPTY_STRING_SCHEMA,
        batchId: MCP_NON_EMPTY_STRING_SCHEMA
    }
};
exports.MCP_GET_PBI_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'pbiId'],
    properties: {
        workspaceId: MCP_NON_EMPTY_STRING_SCHEMA,
        pbiId: MCP_NON_EMPTY_STRING_SCHEMA
    }
};
exports.MCP_GET_PBI_SUBSET_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'batchId'],
    properties: {
        workspaceId: MCP_NON_EMPTY_STRING_SCHEMA,
        batchId: MCP_NON_EMPTY_STRING_SCHEMA,
        rowNumbers: {
            type: 'array',
            items: { type: 'integer', minimum: 1 }
        }
    }
};
exports.MCP_GET_ARTICLE_HISTORY_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'localeVariantId'],
    properties: {
        workspaceId: MCP_NON_EMPTY_STRING_SCHEMA,
        localeVariantId: MCP_NON_EMPTY_STRING_SCHEMA
    }
};
exports.MCP_RECORD_AGENT_NOTES_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'note'],
    properties: {
        workspaceId: MCP_NON_EMPTY_STRING_SCHEMA,
        sessionId: MCP_NON_EMPTY_STRING_SCHEMA,
        note: MCP_NON_EMPTY_STRING_SCHEMA,
        metadata: {},
        batchId: MCP_NON_EMPTY_STRING_SCHEMA,
        localeVariantId: MCP_NON_EMPTY_STRING_SCHEMA,
        familyId: MCP_NON_EMPTY_STRING_SCHEMA,
        pbiIds: MCP_NON_EMPTY_STRING_ARRAY_SCHEMA,
        rationale: MCP_NON_EMPTY_STRING_SCHEMA
    }
};
