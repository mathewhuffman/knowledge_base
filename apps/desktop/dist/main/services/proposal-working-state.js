"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isProposalReviewWorkingStateTarget = isProposalReviewWorkingStateTarget;
exports.persistProposalReviewWorkingStatePatch = persistProposalReviewWorkingStatePatch;
exports.applyAppWorkingStatePatch = applyAppWorkingStatePatch;
const shared_types_1 = require("@kb-vault/shared-types");
function isProposalReviewWorkingStateTarget(input) {
    return input.route === shared_types_1.AppRoute.PROPOSAL_REVIEW && input.entityType === 'proposal';
}
async function persistProposalReviewWorkingStatePatch(input) {
    if (!isProposalReviewWorkingStateTarget(input.request) || !input.response.ok || !input.response.applied) {
        return;
    }
    try {
        await input.workspaceRepository.updateProposalReviewWorkingCopy(input.request.workspaceId, input.request.entityId, buildProposalWorkingCopyPatch(input.response.currentValues));
    }
    catch (error) {
        rollbackProposalWorkingState(input.appWorkingStateService, input.request, input.response, input.previousSchema);
        throw error;
    }
}
async function applyAppWorkingStatePatch(input) {
    const previousSchema = isProposalReviewWorkingStateTarget(input.request)
        ? input.appWorkingStateService.getFormSchema({
            workspaceId: input.request.workspaceId,
            route: input.request.route,
            entityType: input.request.entityType,
            entityId: input.request.entityId
        })
        : undefined;
    const response = input.appWorkingStateService.patchForm(input.request);
    if (response.ok && response.applied) {
        await persistProposalReviewWorkingStatePatch({
            workspaceRepository: input.workspaceRepository,
            appWorkingStateService: input.appWorkingStateService,
            request: input.request,
            response,
            previousSchema
        });
    }
    return response;
}
function rollbackProposalWorkingState(appWorkingStateService, request, response, previousSchema) {
    if (!response.nextVersionToken || !previousSchema?.currentValues) {
        return;
    }
    try {
        appWorkingStateService.patchForm({
            ...request,
            versionToken: response.nextVersionToken,
            patch: buildRollbackPatch(previousSchema.currentValues)
        });
    }
    catch {
        // If rollback also fails, preserve the original persistence error for callers.
    }
}
function buildProposalWorkingCopyPatch(currentValues) {
    const html = readProposalField(currentValues, 'html');
    if (html === undefined) {
        throw new Error('Proposal working state must include html before persisting.');
    }
    return {
        html,
        title: readProposalField(currentValues, 'title'),
        rationale: readProposalField(currentValues, 'rationale'),
        rationaleSummary: readProposalField(currentValues, 'rationaleSummary'),
        aiNotes: readProposalField(currentValues, 'aiNotes')
    };
}
function buildRollbackPatch(currentValues) {
    return {
        html: readProposalField(currentValues, 'html') ?? '',
        title: readProposalField(currentValues, 'title') ?? '',
        rationale: readProposalField(currentValues, 'rationale') ?? '',
        rationaleSummary: readProposalField(currentValues, 'rationaleSummary') ?? '',
        aiNotes: readProposalField(currentValues, 'aiNotes') ?? ''
    };
}
function readProposalField(currentValues, key) {
    const value = currentValues?.[key];
    return typeof value === 'string' ? value : undefined;
}
