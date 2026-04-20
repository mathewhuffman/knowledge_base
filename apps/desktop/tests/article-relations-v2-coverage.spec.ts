import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { openWorkspaceDatabase } from '@kb-vault/db';
import { RevisionState, RevisionStatus } from '@kb-vault/shared-types';
import {
  ARTICLE_RELATIONS_V2_ENGINE_VERSION,
  ARTICLE_RELATIONS_V2_INDEX_DB_RELATIVE_PATH
} from '../src/main/services/article-relations-v2/types';
import { ArticleRelationsV2IndexDb } from '../src/main/services/article-relations-v2/index-db';
import { WorkspaceRepository } from '../src/main/services/workspace-repository';

async function writeWorkspaceFile(workspacePath: string, relativePath: string, contents: string): Promise<string> {
  const absolutePath = path.join(workspacePath, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, 'utf8');
  return relativePath;
}

test.describe('article relations v2 coverage query', () => {
  let workspaceRoot: string;
  let repository: WorkspaceRepository;

  test.beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-relations-v2-coverage-'));
    repository = new WorkspaceRepository(workspaceRoot);
  });

  test.afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  test('rebuilds the derived index and returns high-recall coverage candidates without persisted relations', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Coverage ${randomUUID()}`,
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

    const receiptsFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:3003',
      title: 'Receipt History',
      sectionId: 'section-billing',
      categoryId: 'category-operations'
    });
    const receiptsVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: receiptsFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const billingPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/billing-dashboard/en-live.html',
      [
        '<h1>Billing Dashboard</h1>',
        '<p>Track billing exports, invoices, and account status.</p>',
        '<h2>Export Alerts</h2>',
        '<p>Open Manage Notifications when you need email alerts for billing exports.</p>',
        '<p><a href="/hc/en-us/articles/2002-manage-notifications">Manage Notifications</a> controls export alert delivery.</p>'
      ].join('')
    );
    const notificationsPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/manage-notifications/en-live.html',
      [
        '<h1>Manage Notifications</h1>',
        '<p>Choose which billing export alerts and invoice notices your team receives.</p>',
        '<h2>Export Alerts</h2>',
        '<p>Enable or disable the export summary emails sent from the billing dashboard.</p>'
      ].join('')
    );
    const receiptsPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/receipt-history/en-live.html',
      [
        '<h1>Receipt History</h1>',
        '<p>Review downloaded receipts and invoice PDFs for completed orders.</p>',
        '<h2>Saved Receipts</h2>',
        '<p>Exporting receipts is handled separately from billing alert notifications.</p>'
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
    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: receiptsVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: receiptsPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });

    const rebuild = await repository.rebuildArticleRelationCoverageIndex(workspace.id, {
      forceFullRebuild: true
    });

    expect(rebuild.engineVersion).toBe('article-relations-v2');
    expect(rebuild.documentCount).toBe(3);
    expect(rebuild.chunkCount).toBeGreaterThan(0);
    expect(rebuild.aliasCount).toBeGreaterThan(0);

    await access(path.join(workspace.path, 'cache', 'search', 'article-relations-v2.sqlite'));

    const directQuery = await repository.queryArticleRelationCoverage({
      workspaceId: workspace.id,
      query: 'manage billing export alerts',
      includeEvidence: true,
      maxResults: 5
    });

    expect(directQuery.results.some((result) => result.familyId === notificationsFamily.id)).toBe(true);
    const directNotifications = directQuery.results.find((result) => result.familyId === notificationsFamily.id);
    expect(directNotifications?.evidence.some((entry) => entry.evidenceType === 'title_fts')).toBe(true);
    expect(directNotifications?.evidence.some((entry) => entry.evidenceType === 'body_chunk_fts')).toBe(true);

    const seedQuery = await repository.queryArticleRelationCoverage({
      workspaceId: workspace.id,
      seedFamilyIds: [billingFamily.id],
      includeEvidence: true,
      maxResults: 5
    });

    expect(seedQuery.results[0]?.familyId).toBe(notificationsFamily.id);
    expect(seedQuery.results[0]?.relationEligible).toBe(true);
    expect(seedQuery.results[0]?.evidence.some((entry) => entry.evidenceType === 'explicit_link')).toBe(true);
    expect(seedQuery.results.some((result) => result.familyId === receiptsFamily.id)).toBe(true);

    const seedReceipts = seedQuery.results.find((result) => result.familyId === receiptsFamily.id);
    expect(seedReceipts?.finalScore).toBeLessThan(seedQuery.results[0]?.finalScore ?? 999);
    expect(seedReceipts?.evidence.some((entry) => entry.evidenceType === 'same_section')).toBe(true);

    const batchClusterQuery = await repository.queryArticleRelationCoverage({
      workspaceId: workspace.id,
      batchQueries: ['billing export alerts', 'notification emails'],
      includeEvidence: true,
      maxResults: 5
    });

    expect(batchClusterQuery.results.some((result) => result.familyId === notificationsFamily.id)).toBe(true);
  });

  test('rebuild succeeds and counts duplicate explicit-link anchor variants only once', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Duplicate Links ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    const sourceFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:8101',
      title: 'Billing Alerts'
    });
    const sourceVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: sourceFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });
    const targetFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:8202',
      title: 'Manage Notifications'
    });
    const targetVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: targetFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const sourcePath = await writeWorkspaceFile(
      workspace.path,
      'revisions/duplicate-links/source.html',
      [
        '<h1>Billing Alerts</h1>',
        '<p>Use <a href="/hc/en-us/articles/8202-manage-notifications">Manage notifications</a> for alert routing.</p>',
        '<p>Open <a href="https://support.example.com/hc/en-us/articles/8202-manage-notifications?utm_source=kb">notification settings</a> to change delivery.</p>'
      ].join('')
    );
    const targetPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/duplicate-links/target.html',
      [
        '<h1>Manage Notifications</h1>',
        '<p>Configure billing alert delivery and notification preferences.</p>'
      ].join('')
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
      localeVariantId: targetVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: targetPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });

    const rebuild = await repository.rebuildArticleRelationCoverageIndex(workspace.id, {
      forceFullRebuild: true
    });

    expect(rebuild.documentCount).toBe(2);
    expect(rebuild.linkCount).toBe(1);

    const indexDb = new ArticleRelationsV2IndexDb(
      path.join(workspace.path, ARTICLE_RELATIONS_V2_INDEX_DB_RELATIVE_PATH)
    ).open();
    try {
      const links = indexDb.all<{ href: string; text: string | null }>(
        `SELECT href, text
         FROM document_links
         WHERE locale_variant_id = @localeVariantId`,
        { localeVariantId: sourceVariant.id }
      );

      expect(links).toEqual([
        {
          href: '/hc/en-us/articles/8202-manage-notifications',
          text: 'Manage notifications'
        }
      ]);
    } finally {
      indexDb.close();
    }

    const seedQuery = await repository.queryArticleRelationCoverage({
      workspaceId: workspace.id,
      seedFamilyIds: [sourceFamily.id],
      includeEvidence: true,
      maxResults: 5
    });
    const targetResult = seedQuery.results.find((result) => result.familyId === targetFamily.id);

    expect(targetResult).toBeTruthy();
    expect(targetResult?.evidence.filter((entry) => entry.evidenceType === 'explicit_link')).toHaveLength(1);
  });

  test('infers missing taxonomy into an existing catalog-backed scope when strong neighbors agree', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Taxonomy Inference ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    await repository.upsertKbScopeCatalogEntries(workspace.id, [
      {
        workspaceId: workspace.id,
        scopeType: 'category',
        scopeId: '200',
        displayName: 'Operations',
        source: 'zendesk:en-us'
      },
      {
        workspaceId: workspace.id,
        scopeType: 'section',
        scopeId: '201',
        parentScopeId: '200',
        displayName: 'Billing',
        source: 'zendesk:en-us'
      }
    ]);

    const billingFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:1001',
      title: 'Billing Dashboard',
      sectionId: '201',
      categoryId: '200'
    });
    const billingVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: billingFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const receiptsFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:1002',
      title: 'Receipt History',
      sectionId: '201',
      categoryId: '200'
    });
    const receiptsVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: receiptsFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const missingFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:1003',
      title: 'Export Billing Reports'
    });
    const missingVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: missingFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const billingPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/taxonomy-inference/billing-dashboard.html',
      [
        '<h1>Billing Dashboard</h1>',
        '<p>Open the billing dashboard to review invoices and exports.</p>'
      ].join('')
    );
    const receiptsPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/taxonomy-inference/receipt-history.html',
      [
        '<h1>Receipt History</h1>',
        '<p>Review receipt exports and invoice history for billing workflows.</p>'
      ].join('')
    );
    const missingPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/taxonomy-inference/export-billing-reports.html',
      [
        '<h1>Export Billing Reports</h1>',
        '<p>Use billing exports and receipt history to audit invoice issues.</p>',
        '<p><a href="/hc/en-us/articles/1001-billing-dashboard">Billing Dashboard</a></p>',
        '<p><a href="/hc/en-us/articles/1002-receipt-history">Receipt History</a></p>'
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
      localeVariantId: receiptsVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: receiptsPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });
    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: missingVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: missingPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });

    await repository.rebuildArticleRelationCoverageIndex(workspace.id, {
      forceFullRebuild: true
    });

    const inferredFamily = await repository.getArticleFamily(workspace.id, missingFamily.id);
    expect(inferredFamily).toEqual(expect.objectContaining({
      sectionId: '201',
      categoryId: '200',
      sectionSource: 'inferred_existing_scope',
      categorySource: 'inferred_existing_scope'
    }));
    expect(inferredFamily.taxonomyConfidence ?? 0).toBeGreaterThan(0.75);
  });

  test('leaves low-confidence missing taxonomy uncategorized and unsectioned', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Low Confidence Taxonomy ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    await repository.upsertKbScopeCatalogEntries(workspace.id, [
      {
        workspaceId: workspace.id,
        scopeType: 'category',
        scopeId: '200',
        displayName: 'Operations',
        source: 'zendesk:en-us'
      },
      {
        workspaceId: workspace.id,
        scopeType: 'section',
        scopeId: '201',
        parentScopeId: '200',
        displayName: 'Billing',
        source: 'zendesk:en-us'
      }
    ]);

    const billingFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:2001',
      title: 'Billing Dashboard',
      sectionId: '201',
      categoryId: '200'
    });
    const billingVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: billingFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const missingFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:2002',
      title: 'General Export Notes'
    });
    const missingVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: missingFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const billingPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/low-confidence-taxonomy/billing-dashboard.html',
      '<h1>Billing Dashboard</h1><p>Review invoices and exports.</p>'
    );
    const missingPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/low-confidence-taxonomy/general-export-notes.html',
      '<h1>General Export Notes</h1><p>This note mentions exports but does not link to multiple billing workflows.</p>'
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
      localeVariantId: missingVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: missingPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });

    await repository.rebuildArticleRelationCoverageIndex(workspace.id, {
      forceFullRebuild: true
    });

    const unresolvedFamily = await repository.getArticleFamily(workspace.id, missingFamily.id);
    expect(unresolvedFamily.sectionId).toBeUndefined();
    expect(unresolvedFamily.categoryId).toBeUndefined();
    expect(unresolvedFamily.sectionSource).toBe('none');
    expect(unresolvedFamily.categorySource).toBe('none');
  });

  test('repairs drifted main index state rows and ignores out-of-scope variants in status counts', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Index State Drift ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    const sourceFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:9101',
      title: 'Billing Alerts'
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
      externalKey: 'hc:9102',
      title: 'Manage Notifications'
    });
    const targetVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: targetFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const sourcePath = await writeWorkspaceFile(
      workspace.path,
      'revisions/index-state-drift/source-en.html',
      '<h1>Billing Alerts</h1><p><a href="/hc/en-us/articles/9102-manage-notifications">Manage notifications</a></p>'
    );
    const sourceFrenchPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/index-state-drift/source-fr.html',
      '<h1>Alertes de Facturation</h1><p>Version hors scope.</p>'
    );
    const targetPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/index-state-drift/target.html',
      '<h1>Manage Notifications</h1><p>Configure billing alert delivery.</p>'
    );

    const sourceRevision = await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: sourceVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: sourcePath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });
    const sourceFrenchRevision = await repository.createRevision({
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

    await repository.rebuildArticleRelationCoverageIndex(workspace.id, {
      forceFullRebuild: true
    });

    const db = openWorkspaceDatabase(path.join(workspace.path, '.meta', 'kb-vault.sqlite'));
    try {
      db.run(
        `DELETE FROM article_relation_index_state
         WHERE workspace_id = @workspaceId
           AND locale_variant_id = @localeVariantId`,
        {
          workspaceId: workspace.id,
          localeVariantId: sourceVariant.id
        }
      );
      db.run(
        `INSERT INTO article_relation_index_state (
           workspace_id, locale_variant_id, family_id, revision_id, content_hash, engine_version, status, last_indexed_at, last_error
         ) VALUES (
           @workspaceId, @localeVariantId, @familyId, @revisionId, @contentHash, @engineVersion, @status, NULL, NULL
         )`,
        {
          workspaceId: workspace.id,
          localeVariantId: sourceFrenchVariant.id,
          familyId: sourceFamily.id,
          revisionId: sourceFrenchRevision.id,
          contentHash: 'drifted-out-of-scope',
          engineVersion: ARTICLE_RELATIONS_V2_ENGINE_VERSION,
          status: 'stale'
        }
      );
    } finally {
      db.close();
    }

    const driftedStatus = await repository.getArticleRelationsStatus(workspace.id);
    expect(driftedStatus.summary.indexedDocumentCount).toBe(1);
    expect(driftedStatus.summary.staleDocumentCount).toBe(0);

    const seedQuery = await repository.queryArticleRelationCoverage({
      workspaceId: workspace.id,
      seedFamilyIds: [sourceFamily.id],
      includeEvidence: true,
      maxResults: 5
    });
    expect(seedQuery.results.some((result) => result.familyId === targetFamily.id)).toBe(true);

    const repairedStatus = await repository.getArticleRelationsStatus(workspace.id);
    expect(repairedStatus.summary.indexedDocumentCount).toBe(2);
    expect(repairedStatus.summary.staleDocumentCount).toBe(0);

    const repairedDb = openWorkspaceDatabase(path.join(workspace.path, '.meta', 'kb-vault.sqlite'));
    try {
      const repairedStates = repairedDb.all<{ localeVariantId: string }>(
        `SELECT locale_variant_id as localeVariantId
         FROM article_relation_index_state
         WHERE workspace_id = @workspaceId
         ORDER BY locale_variant_id ASC`,
        { workspaceId: workspace.id }
      );

      expect(repairedStates).toHaveLength(2);
      expect(repairedStates.map((state) => state.localeVariantId)).toEqual(
        expect.arrayContaining([sourceVariant.id, targetVariant.id])
      );
    } finally {
      repairedDb.close();
    }
  });

  test('uses the existing derived index on the hot path and falls back to it if rebuild freshness checks fail', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Hot Path ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    const sourceFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:4004',
      title: 'Billing Dashboard'
    });
    const sourceVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: sourceFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });
    const linkedFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:5005',
      title: 'Manage Notifications'
    });
    const linkedVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: linkedFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const sourcePath = await writeWorkspaceFile(
      workspace.path,
      'revisions/hot-path/billing-dashboard.html',
      [
        '<h1>Billing Dashboard</h1>',
        '<p>Open Manage Notifications to configure export alert emails.</p>',
        '<p><a href="/hc/en-us/articles/5005-manage-notifications">Manage Notifications</a></p>'
      ].join('')
    );
    const linkedPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/hot-path/manage-notifications.html',
      [
        '<h1>Manage Notifications</h1>',
        '<p>Enable or disable billing export alerts.</p>'
      ].join('')
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
      localeVariantId: linkedVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: linkedPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });

    await repository.rebuildArticleRelationCoverageIndex(workspace.id, {
      forceFullRebuild: true
    });

    await rm(path.join(workspace.path, sourcePath));

    const hotPathQuery = await repository.queryArticleRelationCoverage({
      workspaceId: workspace.id,
      seedFamilyIds: [sourceFamily.id],
      includeEvidence: true,
      maxResults: 5
    });

    expect(hotPathQuery.results.some((result) => result.familyId === linkedFamily.id)).toBe(true);

    const db = openWorkspaceDatabase(path.join(workspace.path, '.meta', 'kb-vault.sqlite'));
    try {
      db.run(
        `UPDATE article_relation_index_state
         SET status = 'stale'
         WHERE workspace_id = @workspaceId
           AND locale_variant_id = @localeVariantId`,
        {
          workspaceId: workspace.id,
          localeVariantId: sourceVariant.id
        }
      );
    } finally {
      db.close();
    }

    const staleFallbackQuery = await repository.queryArticleRelationCoverage({
      workspaceId: workspace.id,
      seedFamilyIds: [sourceFamily.id],
      includeEvidence: true,
      maxResults: 5
    });

    expect(staleFallbackQuery.results.some((result) => result.familyId === linkedFamily.id)).toBe(true);
  });

  test('does not fall back to a partial derived index when refresh cannot repair it', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Partial Index ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    const sourceFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:6006',
      title: 'Billing Dashboard'
    });
    const sourceVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: sourceFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });
    const linkedFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:7007',
      title: 'Manage Notifications'
    });
    const linkedVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: linkedFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const sourcePath = await writeWorkspaceFile(
      workspace.path,
      'revisions/partial-index/billing-dashboard.html',
      [
        '<h1>Billing Dashboard</h1>',
        '<p>Open Manage Notifications to configure export alert emails.</p>',
        '<p><a href="/hc/en-us/articles/7007-manage-notifications">Manage Notifications</a></p>'
      ].join('')
    );
    const linkedPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/partial-index/manage-notifications.html',
      [
        '<h1>Manage Notifications</h1>',
        '<p>Enable or disable billing export alerts.</p>'
      ].join('')
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
      localeVariantId: linkedVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: linkedPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });

    await repository.rebuildArticleRelationCoverageIndex(workspace.id, {
      forceFullRebuild: true
    });

    const indexDbRef = new ArticleRelationsV2IndexDb(
      path.join(workspace.path, ARTICLE_RELATIONS_V2_INDEX_DB_RELATIVE_PATH)
    );
    const indexDb = indexDbRef.open();
    try {
      indexDbRef.deleteDocuments(indexDb, [linkedVariant.id]);
    } finally {
      indexDb.close();
    }

    await rm(path.join(workspace.path, sourcePath));

    await expect(repository.queryArticleRelationCoverage({
      workspaceId: workspace.id,
      seedFamilyIds: [sourceFamily.id],
      includeEvidence: true,
      maxResults: 5
    })).rejects.toThrow(/Missing live revision file/);
  });
});
