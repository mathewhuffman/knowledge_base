import { expect, test } from '@playwright/test';
import { DirectKbExecutor } from '../src/main/services/direct-kb-executor';

test.describe('direct kb executor', () => {
  test('rejects malformed direct action args before dispatching the handler', async () => {
    let listSectionsCalls = 0;
    const executor = new DirectKbExecutor({
      kbActionService: {
        listSections: async () => {
          listSectionsCalls += 1;
          return { ok: true, sections: [] };
        }
      } as never
    });

    const result = await executor.execute({
      context: {
        workspaceId: 'workspace-1',
        sessionId: 'assistant-session-1',
        sessionType: 'assistant_chat'
      },
      action: {
        id: 'direct-action-1',
        type: 'list_sections',
        args: {
          categoryId: 42
        } as never
      }
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe('Invalid args for direct action list_sections: locale is required');
    expect(listSectionsCalls).toBe(0);
  });

  test('exposes explorer-tree reads as a direct action', async () => {
    let explorerTreeCalls = 0;
    const tree = [
      {
        familyId: 'family-1',
        title: 'Header Banner Example',
        familyStatus: 'live',
        locales: []
      }
    ];
    const executor = new DirectKbExecutor({
      kbActionService: {
        getExplorerTree: async (workspaceId: string) => {
          explorerTreeCalls += 1;
          expect(workspaceId).toBe('workspace-1');
          return tree;
        }
      } as never
    });

    const result = await executor.execute({
      context: {
        workspaceId: 'workspace-1',
        sessionId: 'assistant-session-1',
        sessionType: 'assistant_chat'
      },
      action: {
        id: 'direct-action-2',
        type: 'get_explorer_tree',
        args: {}
      }
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(tree);
    expect(explorerTreeCalls).toBe(1);
  });
});
