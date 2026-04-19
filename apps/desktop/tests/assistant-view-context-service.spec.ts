import { expect, test } from '@playwright/test';
import { AppRoute } from '@kb-vault/shared-types';
import { AssistantViewContextService } from '../src/main/services/assistant-view-context-service';

test.describe('assistant view context service', () => {
  test('publishes the latest main-window route context for detached consumers', () => {
    const service = new AssistantViewContextService();
    const events: Array<ReturnType<AssistantViewContextService['getCurrent']>> = [];

    const unsubscribe = service.subscribe((event) => {
      events.push(event);
    });

    const published = service.publish({
      sourceWindowRole: 'main',
      context: {
        workspaceId: 'workspace-1',
        route: AppRoute.PROPOSAL_REVIEW,
        routeLabel: 'Proposal Review',
        subject: {
          type: 'proposal',
          id: 'proposal-42',
          label: 'Improve onboarding'
        }
      }
    });

    expect(published.sourceWindowRole).toBe('main');
    expect(published.publishedAtUtc).toBeTruthy();
    expect(published.context).toMatchObject({
      workspaceId: 'workspace-1',
      route: AppRoute.PROPOSAL_REVIEW,
      subject: {
        type: 'proposal',
        id: 'proposal-42'
      }
    });
    expect(service.getCurrent()).toMatchObject({
      sourceWindowRole: 'main',
      context: {
        workspaceId: 'workspace-1',
        route: AppRoute.PROPOSAL_REVIEW
      }
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sourceWindowRole: 'main',
      context: {
        workspaceId: 'workspace-1',
        route: AppRoute.PROPOSAL_REVIEW,
        subject: {
          type: 'proposal',
          id: 'proposal-42'
        }
      }
    });

    unsubscribe();
  });
});
