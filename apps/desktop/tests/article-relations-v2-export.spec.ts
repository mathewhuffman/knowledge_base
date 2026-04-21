import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { openWorkspaceDatabase } from '@kb-vault/db';
import { RevisionState, RevisionStatus } from '@kb-vault/shared-types';
import { WorkspaceRepository } from '../src/main/services/workspace-repository';

async function writeWorkspaceFile(workspacePath: string, relativePath: string, contents: string): Promise<string> {
  const absolutePath = path.join(workspacePath, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, 'utf8');
  return relativePath;
}

test.describe('article relations v2 export', () => {
  let workspaceRoot: string;
  let repository: WorkspaceRepository;

  test.beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-relations-v2-'));
    repository = new WorkspaceRepository(workspaceRoot);
  });

  test.afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  test('exports a deterministic live-only multilingual relation corpus', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Export ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us', 'es-es', 'fr-fr']
    });

    const billingFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:1001',
      title: 'Billing Dashboard'
    });
    const billingEnVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: billingFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });
    const billingEsVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: billingFamily.id,
      locale: 'es-es',
      status: RevisionState.LIVE
    });

    const notificationsFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:2002',
      title: 'Manage Notifications'
    });
    const notificationsVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: notificationsFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const proposalFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'proposal-test-family',
      title: 'Synthetic Proposal Family'
    });
    const proposalVariant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: proposalFamily.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const billingLivePath = await writeWorkspaceFile(
      workspace.path,
      'revisions/billing-dashboard/en-live.html',
      [
        '<h1>Billing Dashboard</h1>',
        '<p>Track billing workflow changes and review export status.</p>',
        '<h2>Export Reports</h2>',
        '<p>Open the export drawer and review the queued report list.</p>',
        '<p><a href="/hc/en-us/articles/2002-manage-notifications">Manage notifications</a> when you need export alerts.</p>'
      ].join('')
    );
    const billingDraftPath = await writeWorkspaceFile(
      workspace.path,
      'drafts/billing-dashboard/en-draft.html',
      '<h1>Billing Dashboard Draft</h1><p>DRAFT ONLY TEXT SHOULD NOT APPEAR.</p>'
    );
    const billingEsLivePath = await writeWorkspaceFile(
      workspace.path,
      'revisions/billing-dashboard/es-live.html',
      [
        '<h1>Panel de Facturacion</h1>',
        '<p>Revise las exportaciones y el historial de cambios.</p>',
        '<h2>Informes</h2>',
        '<p>Abra el panel de exportacion y confirme las alertas.</p>'
      ].join('')
    );
    const notificationsLivePath = await writeWorkspaceFile(
      workspace.path,
      'revisions/notifications/en-live.html',
      '<h1>Manage Notifications</h1><p>Choose which alerts the billing team receives.</p>'
    );
    const proposalLivePath = await writeWorkspaceFile(
      workspace.path,
      'revisions/proposal/en-live.html',
      '<h1>Proposal Only</h1><p>This should be excluded from the canonical corpus.</p>'
    );

    const billingLiveRevision = await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: billingEnVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: billingLivePath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });
    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: billingEnVariant.id,
      revisionType: RevisionState.DRAFT_BRANCH,
      filePath: billingDraftPath,
      revisionNumber: 2,
      status: RevisionStatus.OPEN
    });
    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: billingEsVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: billingEsLivePath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });
    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: notificationsVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: notificationsLivePath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });
    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: proposalVariant.id,
      revisionType: RevisionState.LIVE,
      filePath: proposalLivePath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });

    const firstExport = await repository.exportArticleRelationCorpus(workspace.id);
    const secondExport = await repository.exportArticleRelationCorpus(workspace.id);

    expect(firstExport.engineVersion).toBe('article-relations-v2');
    expect(firstExport.documentCount).toBe(3);
    expect(secondExport.documents).toEqual(firstExport.documents);

    const exportedLocales = firstExport.documents.map((document) => `${document.externalKey}:${document.locale}`).sort();
    expect(exportedLocales).toEqual([
      'hc:1001:en-us',
      'hc:1001:es-es',
      'hc:2002:en-us'
    ]);

    const billingEnDocument = firstExport.documents.find((document) => document.localeVariantId === billingEnVariant.id);
    expect(billingEnDocument).toBeTruthy();
    expect(billingEnDocument?.revisionId).toBe(billingLiveRevision.id);
    expect(billingEnDocument?.title).toBe('Billing Dashboard');
    expect(billingEnDocument?.bodyText).toContain('Track billing workflow changes and review export status.');
    expect(billingEnDocument?.bodyText).not.toContain('DRAFT ONLY TEXT SHOULD NOT APPEAR');
    expect(billingEnDocument?.headings).toEqual([
      { level: 1, text: 'Billing Dashboard', path: 'Billing Dashboard' },
      { level: 2, text: 'Export Reports', path: 'Billing Dashboard > Export Reports' }
    ]);
    expect(billingEnDocument?.aliases).toContain('hc:1001');
    expect(billingEnDocument?.aliases.map((alias) => alias.toLowerCase())).toContain('billing dashboard');
    expect(billingEnDocument?.explicitLinks).toContainEqual({
      href: '/hc/en-us/articles/2002-manage-notifications',
      text: 'Manage notifications',
      targetFamilyId: notificationsFamily.id,
      targetExternalKey: 'hc:2002'
    });
    expect(billingEnDocument?.chunks.length).toBeGreaterThan(0);
    expect(billingEnDocument?.chunks.every((chunk) => chunk.chunkId && chunk.text.trim())).toBe(true);

    const billingEsDocument = firstExport.documents.find((document) => document.localeVariantId === billingEsVariant.id);
    expect(billingEsDocument?.title).toBe('Panel de Facturacion');
    expect(billingEsDocument?.bodyText).toContain('Revise las exportaciones y el historial de cambios.');

    expect(firstExport.documents.every((document) => document.externalKey !== 'proposal-test-family')).toBe(true);
  });

  test('dedupes repeated explicit links to the same target even when anchor text differs', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Link Dedup ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    const sourceFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:1101',
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
      externalKey: 'hc:2002',
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
      'revisions/link-dedup/source.html',
      [
        '<h1>Billing Alerts</h1>',
        '<p><a href="/hc/en-us/articles/2002-manage-notifications">Manage notifications</a></p>',
        '<p><a href="https://support.example.com/hc/en-us/articles/2002-manage-notifications?utm_source=kb">notification settings</a></p>'
      ].join('')
    );
    const targetPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/link-dedup/target.html',
      '<h1>Manage Notifications</h1><p>Choose which billing alerts your team receives.</p>'
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

    const exported = await repository.exportArticleRelationCorpus(workspace.id);
    const sourceDocument = exported.documents.find((document) => document.localeVariantId === sourceVariant.id);

    expect(sourceDocument?.explicitLinks).toEqual([
      {
        href: '/hc/en-us/articles/2002-manage-notifications',
        text: 'Manage notifications',
        targetFamilyId: targetFamily.id,
        targetExternalKey: 'hc:2002'
      }
    ]);
  });

  test('exports effective taxonomy names and provenance when catalog data exists', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Export Taxonomy ${randomUUID()}`,
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

    const family = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:7001',
      title: 'Billing Dashboard',
      sectionId: '201',
      categoryId: '200'
    });
    const variant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: family.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });

    const revisionPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/export-taxonomy/billing-dashboard.html',
      '<h1>Billing Dashboard</h1><p>Review invoices.</p>'
    );
    await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: variant.id,
      revisionType: RevisionState.LIVE,
      filePath: revisionPath,
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });

    const exported = await repository.exportArticleRelationCorpus(workspace.id);
    expect(exported.documents).toEqual([
      expect.objectContaining({
        familyId: family.id,
        categoryId: '200',
        categoryName: 'Operations',
        categorySource: 'manual_override',
        sectionId: '201',
        sectionName: 'Billing',
        sectionSource: 'manual_override'
      })
    ]);
  });

  test('keeps resolved-target explicit links and content hashes stable when duplicate link order reverses', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Link Canonicalization ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    const sourceFamily = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:1201',
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
      externalKey: 'hc:2202',
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
      'revisions/link-canonical/source.html',
      [
        '<h1>Billing Alerts</h1>',
        '<p><a href="/hc/en-us/articles/2202-manage-notifications">Manage notifications</a></p>',
        '<p><a href="https://support.example.com/hc/en-us/articles/2202-manage-notifications?utm_source=kb">notification settings</a></p>'
      ].join('')
    );
    const targetPath = await writeWorkspaceFile(
      workspace.path,
      'revisions/link-canonical/target.html',
      '<h1>Manage Notifications</h1><p>Choose which billing alerts your team receives.</p>'
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

    const firstExport = await repository.exportArticleRelationCorpus(workspace.id);
    const firstSourceDocument = firstExport.documents.find((document) => document.localeVariantId === sourceVariant.id);

    await writeFile(
      path.join(workspace.path, sourcePath),
      [
        '<h1>Billing Alerts</h1>',
        '<p><a href="https://support.example.com/hc/en-us/articles/2202-manage-notifications?utm_source=kb">Manage notifications</a></p>',
        '<p><a href="/hc/en-us/articles/2202-manage-notifications">notification settings</a></p>'
      ].join(''),
      'utf8'
    );

    const secondExport = await repository.exportArticleRelationCorpus(workspace.id);
    const secondSourceDocument = secondExport.documents.find((document) => document.localeVariantId === sourceVariant.id);

    expect(secondSourceDocument).toEqual(firstSourceDocument);
    expect(secondSourceDocument?.explicitLinks).toEqual([
      {
        href: '/hc/en-us/articles/2202-manage-notifications',
        text: 'Manage notifications',
        targetFamilyId: targetFamily.id,
        targetExternalKey: 'hc:2202'
      }
    ]);
  });

  test('fails export and records an error state when a live revision file is missing', async () => {
    const workspace = await repository.createWorkspace({
      name: `Relations V2 Missing File ${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    const family = await repository.createArticleFamily({
      workspaceId: workspace.id,
      externalKey: 'hc:4040',
      title: 'Missing Source Article'
    });
    const variant = await repository.createLocaleVariant({
      workspaceId: workspace.id,
      familyId: family.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });
    const revision = await repository.createRevision({
      workspaceId: workspace.id,
      localeVariantId: variant.id,
      revisionType: RevisionState.LIVE,
      filePath: 'revisions/missing-source/live.html',
      contentHash: 'expected-live-hash',
      revisionNumber: 1,
      status: RevisionStatus.PROMOTED
    });

    await expect(repository.exportArticleRelationCorpus(workspace.id)).rejects.toThrow(
      `Missing live revision file for locale variant ${variant.id} (revision ${revision.id})`
    );

    const db = openWorkspaceDatabase(path.join(workspace.path, '.meta', 'kb-vault.sqlite'));
    try {
      const indexState = db.get<{
        workspace_id: string;
        locale_variant_id: string;
        family_id: string;
        revision_id: string;
        content_hash: string;
        engine_version: string;
        status: string;
        last_error: string | null;
      }>(
        `SELECT workspace_id, locale_variant_id, family_id, revision_id, content_hash, engine_version, status, last_error
         FROM article_relation_index_state
         WHERE workspace_id = @workspaceId
           AND locale_variant_id = @localeVariantId`,
        {
          workspaceId: workspace.id,
          localeVariantId: variant.id
        }
      );

      expect(indexState).toBeTruthy();
      expect(indexState?.family_id).toBe(family.id);
      expect(indexState?.revision_id).toBe(revision.id);
      expect(indexState?.content_hash).toBe('expected-live-hash');
      expect(indexState?.engine_version).toBe('article-relations-v2');
      expect(indexState?.status).toBe('error');
      expect(indexState?.last_error).toContain('Missing live revision file');
    } finally {
      db.close();
    }
  });
});
