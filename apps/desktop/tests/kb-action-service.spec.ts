import { expect, test } from '@playwright/test';
import { KbActionService } from '../src/main/services/kb-action-service';

test.describe('kb action service article relation routing', () => {
  test('findRelatedArticles uses the v2 coverage engine directly for free-text queries', async () => {
    let coverageCalls = 0;
    let searchCalls = 0;
    let relationListCalls = 0;

    const service = new KbActionService({
      workspaceRepository: {
        queryArticleRelationCoverage: async (request: { workspaceId: string; query: string }) => {
          coverageCalls += 1;
          return {
            workspaceId: request.workspaceId,
            engineVersion: 'article-relations-v2',
            results: [
              {
                familyId: 'family-1',
                localeVariantIds: ['variant-1'],
                title: 'Manage Notifications',
                finalScore: 1.24,
                relationEligible: true,
                evidence: []
              }
            ]
          };
        },
        searchArticles: async () => {
          searchCalls += 1;
          return {
            workspaceId: 'workspace-1',
            total: 0,
            results: []
          };
        },
        listArticleRelations: async () => {
          relationListCalls += 1;
          return {
            workspaceId: 'workspace-1',
            seedFamilyIds: [],
            total: 0,
            relations: []
          };
        }
      } as never,
      appWorkingStateService: {
        getFormSchema: async () => ({})
      } as never,
      buildZendeskClient: async () => {
        throw new Error('Zendesk client should not be requested for relation coverage queries');
      }
    });

    const response = await service.findRelatedArticles({
      workspaceId: 'workspace-1',
      query: 'billing alert emails',
      max: 5,
      includeEvidence: true
    });

    expect(coverageCalls).toBe(1);
    expect(searchCalls).toBe(0);
    expect(relationListCalls).toBe(0);
    expect(response).toEqual(expect.objectContaining({
      workspaceId: 'workspace-1',
      engineVersion: 'article-relations-v2'
    }));
  });

  test('findRelatedArticles keeps relation-list precedence for mixed query and seeded relation inputs', async () => {
    let coverageCalls = 0;
    let relationListCalls = 0;

    const service = new KbActionService({
      workspaceRepository: {
        queryArticleRelationCoverage: async () => {
          coverageCalls += 1;
          return {
            workspaceId: 'workspace-1',
            engineVersion: 'article-relations-v2',
            results: []
          };
        },
        listArticleRelations: async (_workspaceId: string, request: {
          workspaceId: string;
          localeVariantId?: string;
          familyId?: string;
          batchId?: string;
          limit?: number;
          minScore?: number;
          includeEvidence?: boolean;
        }) => {
          relationListCalls += 1;
          return {
            workspaceId: request.workspaceId,
            seedFamilyIds: request.familyId ? [request.familyId] : [],
            total: 0,
            relations: []
          };
        }
      } as never,
      appWorkingStateService: {
        getFormSchema: async () => ({})
      } as never,
      buildZendeskClient: async () => {
        throw new Error('Zendesk client should not be requested for relation lookups');
      }
    });

    const response = await service.findRelatedArticles({
      workspaceId: 'workspace-1',
      query: 'billing alert emails',
      familyId: 'family-1',
      max: 5,
      includeEvidence: true
    });

    expect(coverageCalls).toBe(0);
    expect(relationListCalls).toBe(1);
    expect(response).toEqual(expect.objectContaining({
      workspaceId: 'workspace-1',
      total: 0
    }));
  });
});
