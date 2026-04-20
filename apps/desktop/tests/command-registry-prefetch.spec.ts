import { test, expect } from '@playwright/test';
import { __commandRegistryTestables } from '../src/main/services/command-registry';

test.describe('command registry planner prefetch clustering', () => {
  test('splits food list PBIs into distinct workflow clusters instead of one giant generic cluster', () => {
    const uploadedPbis = {
      rows: [
        {
          id: 'pbi-1',
          title: 'Food List',
          title1: 'Food List',
          title2: 'Navigating to Food List',
          title3: ''
        },
        {
          id: 'pbi-2',
          title: 'Food List',
          title1: 'Food List',
          title2: 'Searching Food List Table',
          title3: ''
        },
        {
          id: 'pbi-3',
          title: 'Food List',
          title1: 'Food List',
          title2: 'Filters & Sorts',
          title3: ''
        },
        {
          id: 'pbi-4',
          title: 'Food Lists',
          title1: 'Food Lists',
          title2: 'Details Tab',
          title3: ''
        },
        {
          id: 'pbi-5',
          title: 'Edit Food List Title',
          title1: 'Edit Food List Title',
          title2: '',
          title3: ''
        },
        {
          id: 'pbi-6',
          title: 'Food Lists',
          title1: 'Food Lists',
          title2: 'Location Tab Visibility and Navigation',
          title3: ''
        },
        {
          id: 'pbi-7',
          title: 'Duplicating Food Item',
          title1: 'Duplicating Food Item',
          title2: '',
          title3: ''
        },
        {
          id: 'pbi-8',
          title: 'Duplicating Food List',
          title1: 'Duplicating Food List',
          title2: '',
          title3: ''
        }
      ]
    };

    const clusters = __commandRegistryTestables.buildPlannerTopicClusters(uploadedPbis);

    expect(clusters.map((cluster) => cluster.label)).toEqual(expect.arrayContaining([
      'View Food Lists',
      'View and Edit a Food List',
      'Duplicate a Food Item',
      'Duplicate a Food List'
    ]));

    expect(clusters.find((cluster) => cluster.label === 'View Food Lists')?.pbiIds).toEqual(
      expect.arrayContaining(['pbi-1', 'pbi-2', 'pbi-3'])
    );
    expect(clusters.find((cluster) => cluster.label === 'View and Edit a Food List')?.pbiIds).toEqual(
      expect.arrayContaining(['pbi-4', 'pbi-5', 'pbi-6'])
    );
  });

  test('keeps direct edit-surface queries for list index and detail workflows', () => {
    const uploadedPbis = {
      rows: [
        {
          id: 'pbi-1',
          title: 'Food List',
          title1: 'Food List',
          title2: 'Navigating to Food List',
          title3: ''
        },
        {
          id: 'pbi-2',
          title: 'Food List',
          title1: 'Food List',
          title2: 'Searching Food List Table',
          title3: ''
        },
        {
          id: 'pbi-3',
          title: 'Food Lists',
          title1: 'Food Lists',
          title2: 'Details Tab',
          title3: ''
        },
        {
          id: 'pbi-4',
          title: 'Edit Food List Title',
          title1: 'Edit Food List Title',
          title2: '',
          title3: ''
        }
      ]
    };

    const clusters = __commandRegistryTestables.buildPlannerTopicClusters(uploadedPbis);
    const listIndexCluster = clusters.find((cluster) => cluster.label === 'View Food Lists');
    const detailCluster = clusters.find((cluster) => cluster.label === 'View and Edit a Food List');

    expect(listIndexCluster?.queries).toEqual(expect.arrayContaining([
      'View Food Lists',
      'Navigating to Food List',
      'Searching Food List Table'
    ]));
    expect(detailCluster?.queries).toEqual(expect.arrayContaining([
      'View and Edit a Food List',
      'Edit Food List Title',
      'Details Tab'
    ]));
  });

  test('uses v2 coverage for planner article matches, resolves a preferred live locale, and maps relation counterparts relative to the seeded family', async () => {
    const uploadedPbis = {
      rows: [
        {
          id: 'pbi-1',
          title: 'Billing Alerts',
          title1: 'Billing Alerts',
          title2: 'Manage Notifications',
          title3: ''
        }
      ]
    };

    const coverageQueries: string[] = [];
    const relationFamilyIds: string[] = [];
    const mockRepository = {
      getBatchAnalysisInspection: async () => null,
      getWorkspaceSettings: async () => ({
        workspaceId: 'workspace-1',
        zendeskSubdomain: 'support',
        defaultLocale: 'en-us',
        enabledLocales: ['en-us', 'fr-fr'],
        kbAccessMode: 'cli'
      }),
      getArticleFamily: async () => ({
        title: 'Notification Settings'
      }),
      getLocaleVariantsForFamily: async () => ([
        {
          id: 'variant-en',
          familyId: 'family-match-1',
          locale: 'en-us',
          status: 'live',
          retiredAtUtc: undefined
        },
        {
          id: 'variant-fr',
          familyId: 'family-match-1',
          locale: 'fr-fr',
          status: 'live',
          retiredAtUtc: undefined
        }
      ]),
      queryArticleRelationCoverage: async (request: { query: string; workspaceId: string }) => {
        coverageQueries.push(request.query);
        return {
          workspaceId: request.workspaceId,
          engineVersion: 'article-relations-v2',
          results: [
            {
              familyId: 'family-match-1',
              localeVariantIds: ['variant-fr', 'variant-en'],
              title: 'Manage Notifications',
              externalKey: 'hc:2002',
              finalScore: 1.44,
              relationEligible: true,
              evidence: [
                {
                  evidenceType: 'title_fts',
                  snippet: 'Manage Notifications',
                  weight: 0.92
                }
              ]
            }
          ]
        };
      },
      listArticleRelations: async (_workspaceId: string, payload: { familyId?: string }) => {
        relationFamilyIds.push(payload.familyId ?? '');
        return {
          workspaceId: 'workspace-1',
          seedFamilyIds: payload.familyId ? [payload.familyId] : [],
          total: 1,
          relations: [
            {
              id: 'relation-1',
              workspaceId: 'workspace-1',
              relationType: 'see_also',
              direction: 'bidirectional',
              strengthScore: 0.77,
              status: 'active',
              origin: 'inferred',
              createdAtUtc: '2026-04-19T00:00:00.000Z',
              updatedAtUtc: '2026-04-19T00:00:00.000Z',
              sourceFamily: {
                id: 'family-related',
                title: 'Billing Alerts Overview'
              },
              targetFamily: {
                id: 'family-match-1',
                title: 'Manage Notifications'
              },
              evidence: [
                {
                  evidenceType: 'explicit_link',
                  snippet: 'Links from billing alerts',
                  weight: 1
                }
              ]
            }
          ]
        };
      }
    } as never;

    const prefetch = await __commandRegistryTestables.buildPlannerPrefetch(
      mockRepository,
      'workspace-1',
      'batch-1',
      uploadedPbis
    );

    expect(coverageQueries.length).toBeGreaterThan(0);
    expect(relationFamilyIds).toContain('family-match-1');
    expect(prefetch.articleMatches.some((match) =>
      match.topResults.some((result) => result.familyId === 'family-match-1')
    )).toBe(true);
    const matchedArticle = prefetch.articleMatches.flatMap((match) => match.topResults)
      .find((result) => result.familyId === 'family-match-1');
    expect(matchedArticle?.localeVariantId).toBe('variant-en');
    expect(matchedArticle?.title).toBe('Notification Settings');
    expect(matchedArticle?.matchContext).toBe('content');
    expect(matchedArticle?.snippet).toBe('Canonical KB title: Notification Settings');
    expect(prefetch.relationMatches[0]).toEqual(expect.objectContaining({
      familyId: 'family-related',
      title: 'Billing Alerts Overview',
      relationType: 'see_also'
    }));
    expect(prefetch.relationMatches[0]?.typedEvidence?.[0]?.evidenceType).toBe('explicit_link');
  });
});
