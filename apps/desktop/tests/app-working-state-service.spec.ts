import { expect, test } from '@playwright/test';
import { AppRoute, buildAppWorkingStateVersionToken, type AppWorkingStatePatchAppliedEvent } from '@kb-vault/shared-types';
import { AppWorkingStateService } from '../src/main/services/app-working-state-service';

test.describe('app working state service', () => {
  test('supports draft branch patches through the shared mutation flow', () => {
    const emittedEvents: AppWorkingStatePatchAppliedEvent[] = [];
    const service = new AppWorkingStateService((event) => {
      emittedEvents.push(event);
    });

    const workspaceId = 'workspace-1';
    const entityId = 'draft-1';
    const initialHtml = '<p>Original draft</p>';
    const registrationVersionToken = buildAppWorkingStateVersionToken({
      route: AppRoute.DRAFTS,
      entityType: 'draft_branch',
      entityId,
      currentValues: {
        html: initialHtml
      }
    });

    service.register({
      workspaceId,
      route: AppRoute.DRAFTS,
      entityType: 'draft_branch',
      entityId,
      versionToken: registrationVersionToken,
      currentValues: {
        html: initialHtml
      }
    });

    const patchResponse = service.patchForm({
      workspaceId,
      route: AppRoute.DRAFTS,
      entityType: 'draft_branch',
      entityId,
      versionToken: registrationVersionToken,
      patch: {
        html: '<p>Updated draft from shared working state</p>'
      }
    });

    expect(patchResponse.ok).toBe(true);
    expect(patchResponse.applied).toBe(true);
    expect(patchResponse.currentValues).toEqual({
      html: '<p>Updated draft from shared working state</p>'
    });
    expect(patchResponse.nextVersionToken).toBeTruthy();
    expect(patchResponse.nextVersionToken).not.toBe(registrationVersionToken);
    expect(emittedEvents).toEqual([
      expect.objectContaining({
        workspaceId,
        route: AppRoute.DRAFTS,
        entityType: 'draft_branch',
        entityId,
        appliedPatch: {
          html: '<p>Updated draft from shared working state</p>'
        }
      })
    ]);
  });
});
