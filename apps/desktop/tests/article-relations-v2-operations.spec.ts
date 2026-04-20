import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { openWorkspaceDatabase } from '@kb-vault/db';
import {
  ArticleRelationFeedbackType,
  ArticleRelationIndexStateStatus,
  ArticleRelationRefreshStatusResponse,
  ArticleRelationType,
  RevisionState,
  RevisionStatus
} from '@kb-vault/shared-types';
import { WorkspaceRepository } from '../src/main/services/workspace-repository';

async function writeWorkspaceFile(workspacePath: string, relativePath: string, contents: string): Promise<string> {
  const absolutePath = path.join(workspacePath, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, 'utf8');
  return relativePath;
}

test.describe('article relations v2 operations', () => {
  let workspaceRoot: string;
  let repository: WorkspaceRepository;

  test.beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-relations-v2-ops-'));
    repository = new WorkspaceRepository(workspaceRoot);
  });

  test.afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  test('returns persisted graph edges with saved evidence', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Graph ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    const billingFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:1001',
      title: 'Billing Dashboard',
      sectionId: 'section-billing',
      categoryId: 'category-operations'
    });
    const billingVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: billingFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const notificationsFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:2002',
      title: 'Manage Notifications',
      sectionId: 'section-notifications',
      categoryId: 'category-operations'
    });
    const notificationsVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: notificationsFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const billingPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/graph/billing-dashboard.html',
      [
        '<h1>Billing Dashboard</h1>',
        '<p>Open Manage Notifications to configure export alert emails.</p>',
        '<p><a href="/hc/en-us/articles/2002-manage-notifications">Manage Notifications</a></p>'
      ].join('')
    );
    const notificationsPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/graph/manage-notifications.html',
      [
        '<h1>Manage Notifications</h1>',
        '<p>Choose which billing alert emails your team receives.</p>'
      ].join('')
    );

    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: billingVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: billingPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });
    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: notificationsVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: notificationsPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });

    await repository.rebuildArticleRelationCoverageIndex(workspace.id, { forceFullRebuild: true });
    await repository.refreshArticleRelations(workspace.id, { limitPerArticle: 6 });

    const graph = await repository.queryArticleRelationGraph({
      workspaceId: workspace.id,
      familyId: billingFamily.id,
      minScore: 0,
      includeSuppressed: true,
      limitNodes: 8
    });

    expect(graph.nodes.map((node) => node.familyId)).toEqual(expect.arrayContaining([
      billingFamily.id,
      notificationsFamily.id
    ]));
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual(expect.objectContaining({
      origin: 'inferred'
    }));
    expect([graph.edges[0]?.leftFamilyId, graph.edges[0]?.rightFamilyId]).toEqual(expect.arrayContaining([
      billingFamily.id,
      notificationsFamily.id
    ]));
    expect(graph.edges[0]?.evidence.some((evidence) => evidence.evidenceType === 'explicit_link')).toBe(true);
  });

  test('records relation feedback and marks indexed families stale', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Feedback ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    const sourceFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:3003',
      title: 'Receipt History'
    });
    const sourceVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: sourceFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });
    const sourceFrenchVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: sourceFamily.id,
      locale: 'fr-fr',
      status: RevisionState.LIVE
    });

    const targetFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:4004',
      title: 'Export Reports'
    });
    const targetVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: targetFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const sourcePath = await writeWorkspaceFile(
      workspace.path,
      'revisions/feedback/receipt-history.html',
      '<h1>Receipt History</h1><p>Review completed receipts.</p>'
    );
    const sourceFrenchPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/feedback/receipt-history-fr.html',
      '<h1>Historique des recus</h1><p>Consultez les recus termines.</p>'
    );
    const targetPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/feedback/export-reports.html',
      '<h1>Export Reports</h1><p>Download billing reports.</p>'
    );

    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: sourceVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: sourcePath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });
    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: sourceFrenchVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: sourceFrenchPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });
    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: targetVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: targetPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });

    await repository.rebuildArticleRelationCoverageIndex(workspace.id, { forceFullRebuild: true });

    const indexedStatus = await repository.getArticleRelationsStatus(workspace.id);
    expect(indexedStatus.summary.staleDocumentCount).toBe(0);
    expect(indexedStatus.summary.indexedDocumentCount).toBe(2);

    const feedback = await repository.recordArticleRelationFeedback({
      workspaceId: workspace.id,
      leftFamilyId: sourceFamily.id,
      rightFamilyId: targetFamily.id,
      feedbackType: ArticleRelationFeedbackType.BAD_SUGGESTION
    });

    expect(feedback.feedbackType).toBe(ArticleRelationFeedbackType.BAD_SUGGESTION);

    const db = openWorkspaceDatabase(path.join(workspace.path, '.meta', 'kb-vault.sqlite'));
    try {
      const feedbackCount = db.get<{ total: number }>(
        `SELECT COUNT(*) as total
         FROM article_relation_feedback
         WHERE workspace_id = @workspaceId`,
        { workspaceId: workspace.id }
      );
      const states = db.all<{
        localeVariantId: string;
        status: ArticleRelationIndexStateStatus;
      }>(
        `SELECT locale_variant_id as localeVariantId, status
         FROM article_relation_index_state
         WHERE workspace_id = @workspaceId
         ORDER BY locale_variant_id ASC`,
        { workspaceId: workspace.id }
      );

      expect(feedbackCount?.total).toBe(1);
      expect(states).toHaveLength(2);
      expect(states).toEqual(expect.arrayContaining([
        { localeVariantId: sourceVariant.id, status: ArticleRelationIndexStateStatus.STALE },
        { localeVariantId: targetVariant.id, status: ArticleRelationIndexStateStatus.STALE }
      ]));
      expect(states.some((state) => state.localeVariantId === sourceFrenchVariant.id)).toBe(false);
    } finally {
      db.close();
    }

    const staleStatus = await repository.getArticleRelationsStatus(workspace.id) as ArticleRelationRefreshStatusResponse;
    expect(staleStatus.summary.staleDocumentCount).toBe(2);
  });

  test('builds feature-first scope summaries, singleton clusters, and article neighborhoods', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Feature Map ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    const billingFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:5101',
      title: 'Billing Dashboard',
      sectionId: 'section-billing',
      categoryId: 'category-operations'
    });
    const invoicesFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:5102',
      title: 'Manage Invoices',
      sectionId: 'section-billing',
      categoryId: 'category-operations'
    });
    const paymentsFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:5103',
      title: 'Payment Receipts',
      sectionId: 'section-payments',
      categoryId: 'category-operations'
    });
    const reportsFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:6101',
      title: 'Export Reports',
      sectionId: 'section-reports',
      categoryId: 'category-analytics'
    });

    const billingVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: billingFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });
    const invoicesVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: invoicesFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });
    const paymentsVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: paymentsFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });
    const reportsVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: reportsFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const billingPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/feature-map/billing-dashboard.html',
      [
        '<h1>Billing Dashboard</h1>',
        '<p>Review invoices and outbound exports.</p>',
        '<p><a href="/hc/en-us/articles/5102-manage-invoices">Manage invoices</a></p>',
        '<p><a href="/hc/en-us/articles/6101-export-reports">Export reports</a></p>'
      ].join('')
    );
    const invoicesPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/feature-map/manage-invoices.html',
      '<h1>Manage Invoices</h1><p>Review invoice status and payment follow-up tasks.</p>'
    );
    const paymentsPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/feature-map/payment-receipts.html',
      '<h1>Payment Receipts</h1><p>View completed payment receipts.</p>'
    );
    const reportsPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/feature-map/export-reports.html',
      '<h1>Export Reports</h1><p>Download operational exports.</p>'
    );

    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: billingVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: billingPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });
    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: invoicesVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: invoicesPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });
    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: paymentsVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: paymentsPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });
    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: reportsVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: reportsPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });

    await repository.rebuildArticleRelationCoverageIndex(workspace.id, { forceFullRebuild: true });
    await repository.refreshArticleRelations(workspace.id, { limitPerArticle: 6 });
    await repository.upsertManualArticleRelation({
      workspaceId: workspace.id,
      sourceFamilyId: invoicesFamily.id,
      targetFamilyId: paymentsFamily.id,
      relationType: ArticleRelationType.FOLLOW_UP
    });
    await repository.refreshArticleRelations(workspace.id, { limitPerArticle: 6 });

    const summary = await repository.getArticleRelationFeatureMapSummary({
      workspaceId: workspace.id
    });
    const operationsCategory = summary.categories.find((category) => category.categoryId === 'category-operations');
    const billingSection = operationsCategory?.sections.find((section) => section.sectionId === 'section-billing');
    const paymentsSection = operationsCategory?.sections.find((section) => section.sectionId === 'section-payments');

    expect(summary.taxonomyStatus).toEqual({
      status: 'missing',
      totalScopeCount: 5,
      catalogScopeCount: 0,
      overrideScopeCount: 0,
      fallbackScopeCount: 5
    });
    expect(summary.categories.map((category) => category.categoryId)).toEqual(expect.arrayContaining([
      'category-operations',
      'category-analytics'
    ]));
    expect(operationsCategory).toEqual(expect.objectContaining({
      categoryName: 'category-operations (fallback)',
      categoryLabel: expect.objectContaining({
        scopeType: 'category',
        scopeId: 'category-operations',
        displayName: 'category-operations (fallback)',
        labelSource: 'fallback'
      }),
      articleCount: 3,
      sectionCount: 2,
      clusterCount: 1,
      internalEdgeCount: 2,
      bridgeEdgeCount: 1
    }));
    expect(billingSection).toEqual(expect.objectContaining({
      sectionName: 'section-billing (fallback)',
      sectionLabel: expect.objectContaining({
        scopeType: 'section',
        scopeId: 'section-billing',
        displayName: 'section-billing (fallback)',
        labelSource: 'fallback'
      }),
      articleCount: 2,
      clusterCount: 1,
      internalEdgeCount: 1,
      bridgeEdgeCount: 2,
      manualEdgeCount: 1,
      inferredEdgeCount: 2
    }));
    expect(paymentsSection).toEqual(expect.objectContaining({
      articleCount: 1,
      clusterCount: 1,
      internalEdgeCount: 0,
      bridgeEdgeCount: 1
    }));

    const billingScope = await repository.getArticleRelationFeatureScope({
      workspaceId: workspace.id,
      scopeType: 'section',
      scopeId: 'section-billing',
      includeBridges: true,
      minScore: 0
    });

    expect(billingScope.summary).toEqual(expect.objectContaining({
      articleCount: 2,
      clusterCount: 1,
      internalEdgeCount: 1,
      bridgeEdgeCount: 2,
      manualEdgeCount: 1,
      inferredEdgeCount: 2
    }));
    expect(billingScope.scope).toEqual(expect.objectContaining({
      scopeType: 'section',
      scopeId: 'section-billing',
      scopeName: 'section-billing (fallback)',
      scopeLabel: expect.objectContaining({
        scopeType: 'section',
        scopeId: 'section-billing',
        displayName: 'section-billing (fallback)',
        labelSource: 'fallback'
      })
    }));
    expect(billingScope.articles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        familyId: billingFamily.id,
        internalEdgeCount: 1,
        bridgeEdgeCount: 1,
        totalEdgeCount: 2
      }),
      expect.objectContaining({
        familyId: invoicesFamily.id,
        internalEdgeCount: 1,
        bridgeEdgeCount: 1,
        totalEdgeCount: 2
      })
    ]));
    expect(billingScope.clusters).toEqual([
      expect.objectContaining({
        label: 'Billing Dashboard',
        labelSource: 'representative_article',
        articleCount: 2,
        internalEdgeCount: 1,
        bridgeEdgeCount: 2,
        articleIds: expect.arrayContaining([billingFamily.id, invoicesFamily.id])
      })
    ]);
    expect(billingScope.bridges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceClusterLabel: 'Billing Dashboard',
        targetScopeType: 'section',
        targetScopeId: 'section-payments',
        targetScopeName: 'section-payments (fallback)',
        targetScopeLabel: expect.objectContaining({
          scopeType: 'section',
          scopeId: 'section-payments',
          displayName: 'section-payments (fallback)',
          labelSource: 'fallback'
        }),
        summary: 'Billing Dashboard connects to section-payments (fallback)',
        edgeCount: 1
      }),
      expect.objectContaining({
        sourceClusterLabel: 'Billing Dashboard',
        targetScopeType: 'section',
        targetScopeId: 'section-reports',
        targetScopeName: 'section-reports (fallback)',
        targetScopeLabel: expect.objectContaining({
          scopeType: 'section',
          scopeId: 'section-reports',
          displayName: 'section-reports (fallback)',
          labelSource: 'fallback'
        }),
        summary: 'Billing Dashboard connects to section-reports (fallback)',
        edgeCount: 1
      })
    ]));

    const paymentsScope = await repository.getArticleRelationFeatureScope({
      workspaceId: workspace.id,
      scopeType: 'section',
      scopeId: 'section-payments',
      includeBridges: true,
      minScore: 0
    });

    expect(paymentsScope.clusters).toEqual([
      expect.objectContaining({
        labelSource: 'representative_article',
        articleIds: [paymentsFamily.id],
        articleCount: 1,
        internalEdgeCount: 0,
        bridgeEdgeCount: 1
      })
    ]);

    const neighborhood = await repository.getArticleRelationNeighborhood({
      workspaceId: workspace.id,
      familyId: billingFamily.id,
      minScore: 0,
      hopCount: 2
    });

    expect(neighborhood.centerArticle.familyId).toBe(billingFamily.id);
    expect(neighborhood.nodes.map((node) => node.familyId)).toEqual(expect.arrayContaining([
      billingFamily.id,
      invoicesFamily.id,
      paymentsFamily.id,
      reportsFamily.id
    ]));
    expect(neighborhood.edges.some((edge) => (
      [edge.leftFamilyId, edge.rightFamilyId].includes(billingFamily.id)
      && [edge.leftFamilyId, edge.rightFamilyId].includes(invoicesFamily.id)
    ))).toBe(true);
    expect(neighborhood.edges.some((edge) => (
      [edge.leftFamilyId, edge.rightFamilyId].includes(billingFamily.id)
      && [edge.leftFamilyId, edge.rightFamilyId].includes(reportsFamily.id)
    ))).toBe(true);
    const manualNeighborhoodEdge = neighborhood.edges.find((edge) => edge.origin === 'manual');
    expect(manualNeighborhoodEdge).toBeTruthy();
    expect([manualNeighborhoodEdge?.leftFamilyId, manualNeighborhoodEdge?.rightFamilyId]).toEqual(
      expect.arrayContaining([invoicesFamily.id, paymentsFamily.id])
    );
  });

  test('derives stable cluster labels from repeated title keywords and summarizes bridges by cluster', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Cluster Labels ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    const addMethodFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:9301',
      title: 'Add Payment Method',
      sectionId: 'section-payments',
      categoryId: 'category-finance'
    });
    const updateMethodFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:9302',
      title: 'Update Payment Methods',
      sectionId: 'section-payments',
      categoryId: 'category-finance'
    });
    const removeMethodFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:9303',
      title: 'Remove Payment Method',
      sectionId: 'section-payments',
      categoryId: 'category-finance'
    });
    const reportingFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:9304',
      title: 'Refund Reporting Overview',
      sectionId: 'section-reporting',
      categoryId: 'category-analytics'
    });

    await repository.upsertKbScopeCatalogEntries(workspace.id, [
      {
        workspaceId: workspace.id,
        scopeType: 'section',
        scopeId: 'section-payments',
        displayName: 'Payments',
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
      sourceFamilyId: addMethodFamily.id,
      targetFamilyId: updateMethodFamily.id,
      relationType: ArticleRelationType.SAME_WORKFLOW
    });
    await repository.upsertManualArticleRelation({
      workspaceId: workspace.id,
      sourceFamilyId: updateMethodFamily.id,
      targetFamilyId: removeMethodFamily.id,
      relationType: ArticleRelationType.SAME_WORKFLOW
    });
    await repository.upsertManualArticleRelation({
      workspaceId: workspace.id,
      sourceFamilyId: updateMethodFamily.id,
      targetFamilyId: reportingFamily.id,
      relationType: ArticleRelationType.SEE_ALSO
    });

    const firstScope = await repository.getArticleRelationFeatureScope({
      workspaceId: workspace.id,
      scopeType: 'section',
      scopeId: 'section-payments',
      includeBridges: true,
      minScore: 0
    });
    const secondScope = await repository.getArticleRelationFeatureScope({
      workspaceId: workspace.id,
      scopeType: 'section',
      scopeId: 'section-payments',
      includeBridges: true,
      minScore: 0
    });

    expect(firstScope.clusters).toEqual([
      expect.objectContaining({
        label: 'Payment Method',
        labelSource: 'derived_keywords',
        articleCount: 3,
        internalEdgeCount: 2,
        bridgeEdgeCount: 1,
        representativeArticleIds: [updateMethodFamily.id, addMethodFamily.id, removeMethodFamily.id]
      })
    ]);
    expect(secondScope.clusters).toEqual(firstScope.clusters);
    expect(firstScope.bridges).toEqual([
      expect.objectContaining({
        sourceClusterLabel: 'Payment Method',
        targetScopeType: 'section',
        targetScopeId: 'section-reporting',
        targetScopeName: 'Reporting',
        summary: 'Payment Method connects to Reporting',
        edgeCount: 1
      })
    ]);
    expect(firstScope.bridges[0]?.examples).toHaveLength(1);
    expect(firstScope.bridges[0]?.examples[0]?.relationType).toBe('see_also');
    expect(firstScope.bridges[0]?.examples[0]?.strengthScore).toBe(1);
    expect([
      firstScope.bridges[0]?.examples[0]?.leftFamilyId,
      firstScope.bridges[0]?.examples[0]?.rightFamilyId
    ]).toEqual(expect.arrayContaining([reportingFamily.id, updateMethodFamily.id]));
    expect([
      firstScope.bridges[0]?.examples[0]?.leftTitle,
      firstScope.bridges[0]?.examples[0]?.rightTitle
    ]).toEqual(expect.arrayContaining(['Refund Reporting Overview', 'Update Payment Methods']));
  });

  test('uses KB scope catalog names for feature map summary and scope detail when available', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Catalog Labels ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:9001',
      title: 'Billing Dashboard',
      sectionId: '201',
      categoryId: '200'
    });
    await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:9002',
      title: 'Manage Invoices',
      sectionId: '201',
      categoryId: '200'
    });

    await repository.upsertKbScopeCatalogEntries(workspace.id, [
      {
        workspaceId: workspace.id,
        scopeType: 'category',
        scopeId: '200',
        displayName: 'Operations',
        source: 'zendesk'
      },
      {
        workspaceId: workspace.id,
        scopeType: 'section',
        scopeId: '201',
        parentScopeId: '200',
        displayName: 'Billing',
        source: 'zendesk'
      }
    ]);

    const summary = await repository.getArticleRelationFeatureMapSummary({
      workspaceId: workspace.id
    });

    expect(summary.taxonomyStatus).toEqual({
      status: 'ready',
      totalScopeCount: 2,
      catalogScopeCount: 2,
      overrideScopeCount: 0,
      fallbackScopeCount: 0
    });
    expect(summary.categories).toEqual([
      expect.objectContaining({
        categoryId: '200',
        categoryName: 'Operations',
        categoryLabel: expect.objectContaining({
          scopeType: 'category',
          scopeId: '200',
          displayName: 'Operations',
          labelSource: 'catalog'
        }),
        sections: [
          expect.objectContaining({
            sectionId: '201',
            sectionName: 'Billing',
            sectionLabel: expect.objectContaining({
              scopeType: 'section',
              scopeId: '201',
              displayName: 'Billing',
              labelSource: 'catalog',
              parentScopeId: '200'
            })
          })
        ]
      })
    ]);

    const scope = await repository.getArticleRelationFeatureScope({
      workspaceId: workspace.id,
      scopeType: 'section',
      scopeId: '201',
      includeBridges: true,
      minScore: 0
    });

    expect(scope.scope).toEqual(expect.objectContaining({
      scopeType: 'section',
      scopeId: '201',
      scopeName: 'Billing',
      scopeLabel: expect.objectContaining({
        scopeType: 'section',
        scopeId: '201',
        displayName: 'Billing',
        labelSource: 'catalog',
        parentScopeId: '200'
      })
    }));
  });

  test('hides section override scopes from feature map summary and category detail', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Hidden Scope ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    const visibleFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:9201',
      title: 'Billing Dashboard',
      sectionId: 'section-visible',
      categoryId: 'category-operations'
    });
    const hiddenFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:9202',
      title: 'Deprecated Billing Flow',
      sectionId: 'section-hidden',
      categoryId: 'category-operations'
    });

    const db = openWorkspaceDatabase(path.join(workspace.path, '.meta', 'kb-vault.sqlite'));
    try {
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO kb_scope_overrides (
           id, workspace_id, scope_type, scope_id, display_name, parent_scope_id, is_hidden, created_at, updated_at
         ) VALUES (
           @id, @workspaceId, @scopeType, @scopeId, @displayName, @parentScopeId, @isHidden, @createdAt, @updatedAt
         )`,
        {
          id: randomUUID(),
          workspaceId: workspace.id,
          scopeType: 'section',
          scopeId: 'section-hidden',
          displayName: 'Deprecated Billing Flow',
          parentScopeId: 'category-operations',
          isHidden: 1,
          createdAt: now,
          updatedAt: now
        }
      );
    } finally {
      db.close();
    }

    const summary = await repository.getArticleRelationFeatureMapSummary({
      workspaceId: workspace.id
    });
    const operationsCategory = summary.categories.find((category) => category.categoryId === 'category-operations');

    expect(summary.taxonomyStatus).toEqual({
      status: 'partial',
      totalScopeCount: 3,
      catalogScopeCount: 0,
      overrideScopeCount: 1,
      fallbackScopeCount: 2
    });
    expect(operationsCategory).toEqual(expect.objectContaining({
      articleCount: 1,
      sectionCount: 1
    }));
    expect(operationsCategory?.sections).toEqual([
      expect.objectContaining({
        sectionId: 'section-visible',
        articleCount: 1
      })
    ]);
    expect(operationsCategory?.sections.some((section) => section.sectionId === 'section-hidden')).toBe(false);

    const categoryScope = await repository.getArticleRelationFeatureScope({
      workspaceId: workspace.id,
      scopeType: 'category',
      scopeId: 'category-operations',
      includeBridges: true,
      minScore: 0
    });

    expect(categoryScope.summary).toEqual(expect.objectContaining({
      articleCount: 1,
      clusterCount: 1
    }));
    expect(categoryScope.articles.map((article) => article.familyId)).toEqual([visibleFamily.id]);
    expect(categoryScope.articles.map((article) => article.familyId)).not.toContain(hiddenFamily.id);
  });

  test('refresh detects in-place article link changes and rebuilds explicit-link relations', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Refresh Drift ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    const billingFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:7101',
      title: 'Billing Dashboard'
    });
    const notificationsFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:7102',
      title: 'Manage Notifications'
    });
    const reportsFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:7103',
      title: 'Export Reports'
    });

    const billingVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: billingFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });
    const notificationsVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: notificationsFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });
    const reportsVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: reportsFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const billingPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/refresh-drift/billing-dashboard.html',
      '<h1>Billing Dashboard</h1><p><a href="/hc/en-us/articles/7102-manage-notifications">Manage notifications</a></p>'
    );
    const notificationsPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/refresh-drift/manage-notifications.html',
      '<h1>Manage Notifications</h1><p>Configure billing alert delivery.</p>'
    );
    const reportsPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/refresh-drift/export-reports.html',
      '<h1>Export Reports</h1><p>Download billing exports.</p>'
    );

    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: billingVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: billingPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });
    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: notificationsVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: notificationsPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });
    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: reportsVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: reportsPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });

    await repository.rebuildArticleRelationCoverageIndex(workspace.id, { forceFullRebuild: true });
    await repository.refreshArticleRelations(workspace.id, { limitPerArticle: 6 });

    let neighborhood = await repository.getArticleRelationNeighborhood({
      workspaceId: workspace.id,
      familyId: billingFamily.id,
      minScore: 0,
      hopCount: 1
    });
    expect(neighborhood.nodes.map((node) => node.familyId)).toEqual(expect.arrayContaining([
      billingFamily.id,
      notificationsFamily.id
    ]));
    expect(neighborhood.nodes.map((node) => node.familyId)).not.toContain(reportsFamily.id);

    await writeFile(
      path.join(workspace.path, billingPath),
      '<h1>Billing Dashboard</h1><p><a href="/hc/en-us/articles/7103-export-reports">Export reports</a></p>',
      'utf8'
    );

    await repository.refreshArticleRelations(workspace.id, { limitPerArticle: 6 });

    neighborhood = await repository.getArticleRelationNeighborhood({
      workspaceId: workspace.id,
      familyId: billingFamily.id,
      minScore: 0,
      hopCount: 1
    });
    expect(neighborhood.nodes.map((node) => node.familyId)).toEqual(expect.arrayContaining([
      billingFamily.id,
      reportsFamily.id
    ]));
    expect(neighborhood.nodes.map((node) => node.familyId)).not.toContain(notificationsFamily.id);
  });

  test('rejects retired articles as neighborhood centers', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Retired Center ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    const retiredFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:9301',
      title: 'Legacy Billing Dashboard'
    });

    await repository.updateArticleFamily({
      workspaceId: workspace.id,
      familyId: retiredFamily.id,
      retiredAtUtc: new Date().toISOString()
    });

    await expect(repository.getArticleRelationNeighborhood({
      workspaceId: workspace.id,
      familyId: retiredFamily.id,
      minScore: 0,
      hopCount: 1
    })).rejects.toThrow('Article family not found');
  });
});
