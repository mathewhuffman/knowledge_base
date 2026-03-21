"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
function parseFeatureFlags(env) {
    const flags = {
        reviewWorkbenchV2: env.KBV_FEATURE_REVIEW_WORKBENCH_V2 === 'true',
        mcpToolGuardrails: env.KBV_FEATURE_MCP_GUARDRAILS !== 'false',
        strictHtmlValidation: env.KBV_FEATURE_STRICT_HTML === 'true'
    };
    Object.entries(env).forEach(([key, value]) => {
        if (key.startsWith('KBV_FEATURE_') && value !== undefined) {
            const flag = key.replace('KBV_FEATURE_', '').toLowerCase();
            flags[flag] = value === 'true';
        }
    });
    return flags;
}
function loadConfig() {
    return {
        workspaces: {
            defaultRoot: process.env.KB_VAULT_WORKSPACE_ROOT || ''
        },
        featureFlags: parseFeatureFlags(process.env)
    };
}
