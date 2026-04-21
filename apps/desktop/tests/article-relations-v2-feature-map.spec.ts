import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type {
  ArticleNeighborhoodResponse,
  FeatureMapSummaryResponse,
  FeatureScopeResponse
} from '@kb-vault/shared-types';
import { ArticleRelationType } from '@kb-vault/shared-types';
import { CommandBus } from '../src/main/services/command-bus';
import { registerCoreCommands } from '../src/main/services/command-registry';
import { JobRegistry } from '../src/main/services/job-runner';
import { WorkspaceRepository } from '../src/main/services/workspace-repository';

async function createFeatureMapWorkspace(
  repository: WorkspaceRepository,
  name: string
): Promise<{ id: string; path: string }> {
  return repository.createWorkspace({
    name,
    zendeskSubdomain: 'support',
    defaultLocale: 'en-us',
    enabledLocales: ['en-us']
  });
}

test.describe('article relations v2 feature map regressions', () => {
  let workspaceRoot: string;
  let repository: WorkspaceRepository;

  test.beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-relations-v2-feature-map-'));
    repository = new WorkspaceRepository(workspaceRoot);
  });

  test.afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  test('feature-map IPC routes work without imported PBIs and keep unrelated scope articles as singleton clusters', async () => {
    const bus = new CommandBus();
    const jobs = new JobRegistry();
    registerCoreCommands(bus, jobs, workspaceRoot);

    const workspaceResponse = await bus.execute({
      method: 'workspace.create',
      payload: {
        name: `Feature Map IPC ${randomUUID()}`,
        zendeskSubdomain: 'support',
        defaultLocale: 'en-us',
        enabledLocales: ['en-us']
      }
    });
    expect(workspaceResponse.ok).toBe(true);
    const workspace = workspaceResponse.data as { id: string };

    const billingResponse = await bus.execute({
      method: 'articleFamily.create',
      payload: {
        workspaceId: workspace.id,
        externalKey: 'hc:feature-1001',
        title: 'Billing Dashboard',
        sectionId: 'section-billing',
        categoryId: 'category-operations'
      }
    });
    expect(billingResponse.ok).toBe(true);
    const billingFamilyId = (billingResponse.data as { id: string }).id;

    const invoicesResponse = await bus.execute({
      method: 'articleFamily.create',
      payload: {
        workspaceId: workspace.id,
        externalKey: 'hc:feature-1002',
        title: 'Invoice CSV Exports',
        sectionId: 'section-billing',
        categoryId: 'category-operations'
      }
    });
    expect(invoicesResponse.ok).toBe(true);
    const invoicesFamilyId = (invoicesResponse.data as { id: string }).id;

    const summaryResponse = await bus.execute({
      method: 'article.relations.feature-map.summary',
      payload: {
        workspaceId: workspace.id
      }
    });
    expect(summaryResponse.ok).toBe(true);
    const summary = summaryResponse.data as FeatureMapSummaryResponse;

    expect(summary.taxonomyStatus).toEqual({
      status: 'missing',
      totalScopeCount: 2,
      catalogScopeCount: 0,
      overrideScopeCount: 0,
      fallbackScopeCount: 2
    });
    expect(summary.categories).toEqual([
      expect.objectContaining({
        categoryId: 'category-operations',
        categoryName: 'category-operations (fallback)',
        articleCount: 2,
        sectionCount: 1,
        clusterCount: 2,
        categoryLabel: expect.objectContaining({
          labelSource: 'fallback'
        }),
        sections: [
          expect.objectContaining({
            sectionId: 'section-billing',
            sectionName: 'section-billing (fallback)',
            articleCount: 2,
            clusterCount: 2,
            sectionLabel: expect.objectContaining({
              labelSource: 'fallback'
            })
          })
        ]
      })
    ]);

    const scopeResponse = await bus.execute({
      method: 'article.relations.feature-map.scope',
      payload: {
        workspaceId: workspace.id,
        scopeType: 'section',
        scopeId: 'section-billing',
        includeBridges: true,
        minScore: 0
      }
    });
    expect(scopeResponse.ok).toBe(true);
    const scope = scopeResponse.data as FeatureScopeResponse;

    expect(scope.summary).toEqual(expect.objectContaining({
      articleCount: 2,
      clusterCount: 2,
      internalEdgeCount: 0,
      bridgeEdgeCount: 0
    }));
    expect(scope.articles.map((article) => article.familyId).sort()).toEqual([
      billingFamilyId,
      invoicesFamilyId
    ].sort());
    expect(scope.clusters).toHaveLength(2);
    expect(scope.clusters).toEqual(expect.arrayContaining([
      expect.objectContaining({
        articleIds: [billingFamilyId],
        articleCount: 1,
        internalEdgeCount: 0,
        bridgeEdgeCount: 0,
        label: 'Billing Dashboard',
        labelSource: 'representative_article'
      }),
      expect.objectContaining({
        articleIds: [invoicesFamilyId],
        articleCount: 1,
        internalEdgeCount: 0,
        bridgeEdgeCount: 0,
        label: 'Invoice CSV Exports',
        labelSource: 'representative_article'
      })
    ]));

    const neighborhoodResponse = await bus.execute({
      method: 'article.relations.neighborhood',
      payload: {
        workspaceId: workspace.id,
        familyId: billingFamilyId,
        minScore: 0,
        hopCount: 2
      }
    });
    expect(neighborhoodResponse.ok).toBe(true);
    const neighborhood = neighborhoodResponse.data as ArticleNeighborhoodResponse;

    expect(neighborhood.centerArticle).toEqual(expect.objectContaining({
      familyId: billingFamilyId,
      title: 'Billing Dashboard',
      sectionId: 'section-billing',
      categoryId: 'category-operations'
    }));
    expect(neighborhood.nodes).toEqual([
      expect.objectContaining({
        familyId: billingFamilyId,
        title: 'Billing Dashboard',
        degree: 0
      })
    ]);
    expect(neighborhood.edges).toEqual([]);
  });

  test('aggregates multiple bridge relations into one bridge card per target scope', async () => {
    const workspace = await createFeatureMapWorkspace(
      repository,
      `Feature Map Bridge Aggregation ${randomUUID()}`
    );

    const billingFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:bridge-2001',
      title: 'Billing Dashboard',
      sectionId: 'section-billing',
      categoryId: 'category-operations'
    });
    const invoicesFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:bridge-2002',
      title: 'Manage Billing Alerts',
      sectionId: 'section-billing',
      categoryId: 'category-operations'
    });
    const exportsFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:bridge-3001',
      title: 'Export Reports',
      sectionId: 'section-reporting',
      categoryId: 'category-analytics'
    });
    const refundsFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:bridge-3002',
      title: 'Refund Reporting',
      sectionId: 'section-reporting',
      categoryId: 'category-analytics'
    });

    await repository.upsertKbScopeCatalogEntries(workspace.id, [
      {
        workspaceId: workspace.id,
        scopeType: 'section',
        scopeId: 'section-billing',
        displayName: 'Billing',
        source: 'zendesk'
      },
      {
        workspaceId: workspace.id,
        scopeType: 'section',
        scopeId: 'section-reporting',
        displayName: 'Reporting',
        source: 'zendesk'
      }
    ]);

    await repository.upsertManualArticleRelation({
      workspaceId: workspace.id,
      sourceFamilyId: billingFamily.id,
      targetFamilyId: invoicesFamily.id,
      relationType: ArticleRelationType.SAME_WORKFLOW
    });
    await repository.upsertManualArticleRelation({
      workspaceId: workspace.id,
      sourceFamilyId: billingFamily.id,
      targetFamilyId: exportsFamily.id,
      relationType: ArticleRelationType.SEE_ALSO
    });
    await repository.upsertManualArticleRelation({
      workspaceId: workspace.id,
      sourceFamilyId: invoicesFamily.id,
      targetFamilyId: refundsFamily.id,
      relationType: ArticleRelationType.FOLLOW_UP
    });

    const scope = await repository.getArticleRelationFeatureScope({
      workspaceId: workspace.id,
      scopeType: 'section',
      scopeId: 'section-billing',
      includeBridges: true,
      minScore: 0
    });

    expect(scope.summary).toEqual(expect.objectContaining({
      articleCount: 2,
      clusterCount: 1,
      internalEdgeCount: 1,
      bridgeEdgeCount: 2
    }));
    expect(scope.clusters).toEqual([
      expect.objectContaining({
        articleCount: 2,
        internalEdgeCount: 1,
        bridgeEdgeCount: 2
      })
    ]);
    expect(scope.bridges).toHaveLength(1);
    expect(scope.bridges[0]).toEqual(expect.objectContaining({
      targetScopeType: 'section',
      targetScopeId: 'section-reporting',
      targetScopeName: 'Reporting',
      targetScopeLabel: expect.objectContaining({
        labelSource: 'catalog'
      }),
      edgeCount: 2,
      maxStrengthScore: 1
    }));
    expect(scope.bridges[0]?.summary).toContain('connects to Reporting');
    expect(scope.bridges[0]?.examples).toHaveLength(2);
    expect(scope.bridges[0]?.examples.map((example) => example.relationType).sort()).toEqual([
      ArticleRelationType.FOLLOW_UP,
      ArticleRelationType.SEE_ALSO
    ].sort());
    expect(
      new Set(
        scope.bridges[0]?.examples.map((example) => (
          [example.leftFamilyId, example.rightFamilyId].sort().join(':')
        )) ?? []
      )
    ).toEqual(new Set([
      [billingFamily.id, exportsFamily.id].sort().join(':'),
      [invoicesFamily.id, refundsFamily.id].sort().join(':')
    ]));
  });

  test('feature-map relation analysis copy stays explicit that taxonomy naming is separate', async () => {
    const graphPageSource = await readFile(
      path.resolve(__dirname, '../src/renderer/src/pages/ArticleRelationsGraph.tsx'),
      'utf8'
    );
    const homePageSource = await readFile(
      path.resolve(__dirname, '../src/renderer/src/pages/KBVaultHome.tsx'),
      'utf8'
    );

    expect(graphPageSource).toContain(
      'Relation analysis rebuilds the derived index and refreshes inferred relations. It does not repair taxonomy names; missing names will stay marked as fallback labels until sync data or overrides exist.'
    );
    expect(graphPageSource).toContain(
      'Taxonomy names come from KB sync data and overrides, not from relation analysis.'
    );
    expect(homePageSource).toContain(
      '`Run Full Relation Analysis` rebuilds the derived search index and refreshes inferred relations. It does not repair category or section naming.'
    );
  });
});
