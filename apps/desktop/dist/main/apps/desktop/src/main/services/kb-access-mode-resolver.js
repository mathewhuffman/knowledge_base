"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KbAccessModePreflightError = void 0;
exports.selectKbAccessMode = selectKbAccessMode;
exports.buildKbAccessModePreflightFailureMessage = buildKbAccessModePreflightFailureMessage;
exports.resolveKbAccessModeSelection = resolveKbAccessModeSelection;
exports.requireHealthyKbAccessModeSelection = requireHealthyKbAccessModeSelection;
class KbAccessModePreflightError extends Error {
    selection;
    name = 'KbAccessModePreflightError';
    constructor(selection) {
        super(buildKbAccessModePreflightFailureMessage(selection.selectedMode, selection.selectedProvider));
        this.selection = selection;
    }
}
exports.KbAccessModePreflightError = KbAccessModePreflightError;
function selectKbAccessMode(requestedMode, workspaceMode) {
    return requestedMode ?? workspaceMode;
}
function buildKbAccessModePreflightFailureMessage(selectedMode, selectedProvider) {
    return `Selected KB access mode ${selectedMode.toUpperCase()} is not ready: ${selectedProvider.message || 'not ready'}. KB Vault will not switch providers automatically.`;
}
async function resolveKbAccessModeSelection(input) {
    const workspaceMode = await input.resolveWorkspaceKbAccessMode(input.workspaceId);
    const selectedMode = selectKbAccessMode(input.requestedMode, workspaceMode);
    const health = await input.agentRuntime.checkHealth(input.workspaceId, selectedMode, workspaceMode);
    return {
        requestedMode: input.requestedMode,
        workspaceMode,
        selectedMode,
        health,
        selectedProvider: health.providers[selectedMode]
    };
}
async function requireHealthyKbAccessModeSelection(input) {
    const selection = await resolveKbAccessModeSelection(input);
    if (!selection.selectedProvider.ok) {
        throw new KbAccessModePreflightError(selection);
    }
    return selection;
}
