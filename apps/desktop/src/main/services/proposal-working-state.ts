import {
  AppRoute,
  type AppWorkingStatePatchRequest,
  type AppWorkingStatePatchResponse,
  type AppWorkingStateSchemaResponse,
  type ProposalPatchPayload
} from '@kb-vault/shared-types';
import { AppWorkingStateService } from './app-working-state-service';
import { WorkspaceRepository } from './workspace-repository';

export function isProposalReviewWorkingStateTarget(input: Pick<AppWorkingStatePatchRequest, 'route' | 'entityType'>): boolean {
  return input.route === AppRoute.PROPOSAL_REVIEW && input.entityType === 'proposal';
}

export async function persistProposalReviewWorkingStatePatch(input: {
  workspaceRepository: WorkspaceRepository;
  appWorkingStateService: AppWorkingStateService;
  request: AppWorkingStatePatchRequest;
  response: AppWorkingStatePatchResponse;
  previousSchema?: AppWorkingStateSchemaResponse;
}): Promise<void> {
  if (!isProposalReviewWorkingStateTarget(input.request) || !input.response.ok || !input.response.applied) {
    return;
  }

  try {
    await input.workspaceRepository.updateProposalReviewWorkingCopy(
      input.request.workspaceId,
      input.request.entityId,
      buildProposalWorkingCopyPatch(input.response.currentValues)
    );
  } catch (error) {
    rollbackProposalWorkingState(input.appWorkingStateService, input.request, input.response, input.previousSchema);
    throw error;
  }
}

export async function applyAppWorkingStatePatch(input: {
  workspaceRepository: WorkspaceRepository;
  appWorkingStateService: AppWorkingStateService;
  request: AppWorkingStatePatchRequest;
}): Promise<AppWorkingStatePatchResponse> {
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

function rollbackProposalWorkingState(
  appWorkingStateService: AppWorkingStateService,
  request: AppWorkingStatePatchRequest,
  response: AppWorkingStatePatchResponse,
  previousSchema?: AppWorkingStateSchemaResponse
): void {
  if (!response.nextVersionToken || !previousSchema?.currentValues) {
    return;
  }

  try {
    appWorkingStateService.patchForm({
      ...request,
      versionToken: response.nextVersionToken,
      patch: buildRollbackPatch(previousSchema.currentValues)
    });
  } catch {
    // If rollback also fails, preserve the original persistence error for callers.
  }
}

function buildProposalWorkingCopyPatch(currentValues?: Record<string, unknown>): ProposalPatchPayload {
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

function buildRollbackPatch(currentValues: Record<string, unknown>): Record<string, string> {
  return {
    html: readProposalField(currentValues, 'html') ?? '',
    title: readProposalField(currentValues, 'title') ?? '',
    rationale: readProposalField(currentValues, 'rationale') ?? '',
    rationaleSummary: readProposalField(currentValues, 'rationaleSummary') ?? '',
    aiNotes: readProposalField(currentValues, 'aiNotes') ?? ''
  };
}

function readProposalField(currentValues: Record<string, unknown> | undefined, key: keyof ProposalPatchPayload): string | undefined {
  const value = currentValues?.[key];
  return typeof value === 'string' ? value : undefined;
}
