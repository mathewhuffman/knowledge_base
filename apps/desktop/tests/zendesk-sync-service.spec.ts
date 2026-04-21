import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { DraftBranchStatus, JobState, type JobEvent } from '@kb-vault/shared-types';
import { ZendeskClient } from '@kb-vault/zendesk-client';
import { WorkspaceRepository } from '../src/main/services/workspace-repository';
import { ZendeskSyncService } from '../src/main/services/zendesk-sync-service';

type FakeZendeskClient = {
  testConnection: () => Promise<{ ok: boolean; status: number }>;
  listCategories: (locale: string) => Promise<Array<{ id: number; name: string }>>;
  listSections: (categoryId: number, locale: string) => Promise<Array<{ id: number; name: string; category_id?: number }>>;
  listArticles: (
    locale: string,
    page?: number,
    since?: string
  ) => Promise<{ items: Array<{
    id: number;
    title: string;
    body: string;
    locale?: string;
    source_id?: number;
    section_id?: number;
    category_id?: number;
    updated_at?: string;
  }>; hasMore: boolean; nextPage?: string | null }>;
};

const originalZendeskFromConfig = ZendeskClient.fromConfig;

function patchZendeskClient(fakeClient: FakeZendeskClient): void {
  (ZendeskClient as unknown as { fromConfig: typeof ZendeskClient.fromConfig }).fromConfig = ((
    _config,
    _credentials
  ) => fakeClient as unknown as ZendeskClient) as typeof ZendeskClient.fromConfig;
}

function patchZendeskCredentials(repository: WorkspaceRepository, workspaceId: string): void {
  (repository as WorkspaceRepository & {
    getZendeskCredentialsForSync: (workspaceId: string) => Promise<{ workspaceId: string; email: string; apiToken: string } | null>;
  }).getZendeskCredentialsForSync = async (requestedWorkspaceId: string) => ({
    workspaceId: requestedWorkspaceId,
    email: 'agent@example.com',
    apiToken: `token-for-${workspaceId}`
  });
}

test.describe('zendesk sync service', () => {
  let workspaceRoot: string;
  let repository: WorkspaceRepository;

  test.beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-zendesk-sync-'));
    repository = new WorkspaceRepository(workspaceRoot);
  });

  test.afterEach(async () => {
    (ZendeskClient as unknown as { fromConfig: typeof ZendeskClient.fromConfig }).fromConfig = originalZendeskFromConfig;
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  test('continues article sync when taxonomy refresh fails', async () => {
    const workspace = await repository.createWorkspace({
      name: 'Sync Keeps Going',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'sync-keeps-going')
    });
    patchZendeskCredentials(repository, workspace.id);

    patchZendeskClient({
      testConnection: async () => ({ ok: true, status: 200 }),
      listCategories: async () => {
        throw new Error('taxonomy unavailable');
      },
      listSections: async () => [],
      listArticles: async (locale, page = 1) => ({
        items: page === 1
          ? [{
              id: 1001,
              title: 'Billing Dashboard',
              body: '<h1>Billing Dashboard</h1><p>View invoice status.</p>',
              locale,
              section_id: 201,
              category_id: 200,
              updated_at: '2026-04-19T12:00:00.000Z'
            }]
          : [],
        hasMore: false,
        nextPage: null
      })
    });

    const service = new ZendeskSyncService(repository);
    const events: JobEvent[] = [];

    await service.runSync(
      {
        workspaceId: workspace.id,
        mode: 'full',
        maxRetries: 0
      },
      (event) => events.push(event),
      'zendesk.sync.run',
      'job-1'
    );

    expect(events.some((event) => (
      event.state === JobState.RUNNING
      && event.message?.includes('Category/section name refresh failed; continuing article sync')
    ))).toBe(true);
    expect(events.at(-1)?.state).toBe(JobState.SUCCEEDED);

    const family = await repository.getArticleFamilyByExternalKey(workspace.id, 'hc:1001');
    expect(family).toEqual(expect.objectContaining({
      title: 'Billing Dashboard',
      sectionId: '201',
      categoryId: '200'
    }));

    const variant = await repository.getLocaleVariantByFamilyAndLocale(workspace.id, family!.id, 'en-us');
    expect(variant).toBeTruthy();
    const latestRevision = await repository.getLatestRevision(workspace.id, variant!.id);
    expect(latestRevision).toEqual(expect.objectContaining({
      revisionType: 'live'
    }));

    const latestRun = await repository.getLatestSuccessfulSyncRun(workspace.id);
    expect(latestRun).toEqual(expect.objectContaining({
      state: 'SUCCEEDED',
      syncedArticles: 1,
      createdFamilies: 1,
      createdVariants: 1,
      createdRevisions: 1
    }));
    expect(await repository.listKbScopeCatalogEntries(workspace.id)).toEqual([]);
  });

  test('syncs KB scope catalog only from the default locale in multilingual workspaces', async () => {
    const workspace = await repository.createWorkspace({
      name: 'Sync Stable Labels',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us', 'es-es'],
      path: path.join(workspaceRoot, 'sync-stable-labels')
    });
    patchZendeskCredentials(repository, workspace.id);

    const taxonomyCalls: string[] = [];
    patchZendeskClient({
      testConnection: async () => ({ ok: true, status: 200 }),
      listCategories: async (locale) => {
        taxonomyCalls.push(`categories:${locale}`);
        return locale === 'en-us'
          ? [{ id: 200, name: 'Operations' }]
          : [{ id: 200, name: 'Operaciones' }];
      },
      listSections: async (_categoryId, locale) => {
        taxonomyCalls.push(`sections:${locale}`);
        return locale === 'en-us'
          ? [{ id: 201, name: 'Billing', category_id: 200 }]
          : [{ id: 201, name: 'Facturacion', category_id: 200 }];
      },
      listArticles: async (locale, page = 1) => ({
        items: page === 1
          ? [{
              id: locale === 'en-us' ? 1001 : 1002,
              source_id: 1001,
              title: locale === 'en-us' ? 'Billing Dashboard' : 'Panel de Facturacion',
              body: locale === 'en-us'
                ? '<h1>Billing Dashboard</h1><p>View invoice status.</p>'
                : '<h1>Panel de Facturacion</h1><p>Consulta el estado de facturas.</p>',
              locale,
              section_id: 201,
              category_id: 200,
              updated_at: locale === 'en-us'
                ? '2026-04-19T12:00:00.000Z'
                : '2026-04-19T12:05:00.000Z'
            }]
          : [],
        hasMore: false,
        nextPage: null
      })
    });

    const service = new ZendeskSyncService(repository);
    const events: JobEvent[] = [];

    await service.runSync(
      {
        workspaceId: workspace.id,
        mode: 'full',
        maxRetries: 0
      },
      (event) => events.push(event),
      'zendesk.sync.run',
      'job-2'
    );

    expect(events.at(-1)?.state).toBe(JobState.SUCCEEDED);
    expect(taxonomyCalls).toEqual([
      'categories:en-us',
      'sections:en-us'
    ]);

    const catalog = await repository.listKbScopeCatalogEntries(workspace.id);
    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scopeType: 'category',
        scopeId: '200',
        displayName: 'Operations',
        source: 'zendesk:en-us'
      }),
      expect.objectContaining({
        scopeType: 'section',
        scopeId: '201',
        parentScopeId: '200',
        displayName: 'Billing',
        source: 'zendesk:en-us'
      })
    ]));
    expect(catalog.some((record) => record.displayName === 'Operaciones' || record.displayName === 'Facturacion')).toBe(false);

    const family = await repository.getArticleFamilyByExternalKey(workspace.id, 'hc:1001');
    expect(family).toBeTruthy();
    const enVariant = await repository.getLocaleVariantByFamilyAndLocale(workspace.id, family!.id, 'en-us');
    const esVariant = await repository.getLocaleVariantByFamilyAndLocale(workspace.id, family!.id, 'es-es');
    expect(enVariant).toBeTruthy();
    expect(esVariant).toBeTruthy();
  });

  test('derives effective category from the synced section parent when Zendesk omits article category', async () => {
    const workspace = await repository.createWorkspace({
      name: 'Sync Derives Category From Section Parent',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'sync-derives-category-from-section-parent')
    });
    patchZendeskCredentials(repository, workspace.id);

    patchZendeskClient({
      testConnection: async () => ({ ok: true, status: 200 }),
      listCategories: async () => [{ id: 200, name: 'Operations' }],
      listSections: async () => [{ id: 201, name: 'Billing', category_id: 200 }],
      listArticles: async (locale, page = 1) => ({
        items: page === 1
          ? [{
              id: 1001,
              title: 'Billing Dashboard',
              body: '<h1>Billing Dashboard</h1><p>View invoice status.</p>',
              locale,
              section_id: 201,
              updated_at: '2026-04-19T12:00:00.000Z'
            }]
          : [],
        hasMore: false,
        nextPage: null
      })
    });

    const service = new ZendeskSyncService(repository);
    await service.runSync(
      {
        workspaceId: workspace.id,
        mode: 'full',
        maxRetries: 0
      },
      () => undefined,
      'zendesk.sync.run',
      'job-derive-parent-category'
    );

    const family = await repository.getArticleFamilyByExternalKey(workspace.id, 'hc:1001');
    expect(family).toEqual(expect.objectContaining({
      sectionId: '201',
      categoryId: '200',
      sourceSectionId: '201',
      sourceCategoryId: undefined,
      sectionSource: 'zendesk_article',
      categorySource: 'zendesk_section_parent'
    }));

    const summary = await repository.getArticleRelationFeatureMapSummary({ workspaceId: workspace.id });
    expect(summary.categories).toEqual([
      expect.objectContaining({
        categoryId: '200',
        categoryName: 'Operations',
        sections: [
          expect.objectContaining({
            sectionId: '201',
            sectionName: 'Billing',
            articleCount: 1
          })
        ]
      })
    ]);
  });

  test('prefers the section parent category when Zendesk article taxonomy conflicts', async () => {
    const workspace = await repository.createWorkspace({
      name: 'Sync Resolves Taxonomy Conflicts',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'sync-resolves-taxonomy-conflicts')
    });
    patchZendeskCredentials(repository, workspace.id);

    patchZendeskClient({
      testConnection: async () => ({ ok: true, status: 200 }),
      listCategories: async () => [{ id: 200, name: 'Operations' }],
      listSections: async () => [{ id: 201, name: 'Billing', category_id: 200 }],
      listArticles: async (locale, page = 1) => ({
        items: page === 1
          ? [{
              id: 1001,
              title: 'Billing Dashboard',
              body: '<h1>Billing Dashboard</h1><p>View invoice status.</p>',
              locale,
              section_id: 201,
              category_id: 999,
              updated_at: '2026-04-19T12:00:00.000Z'
            }]
          : [],
        hasMore: false,
        nextPage: null
      })
    });

    const service = new ZendeskSyncService(repository);
    await service.runSync(
      {
        workspaceId: workspace.id,
        mode: 'full',
        maxRetries: 0
      },
      () => undefined,
      'zendesk.sync.run',
      'job-taxonomy-conflict'
    );

    const family = await repository.getArticleFamilyByExternalKey(workspace.id, 'hc:1001');
    expect(family).toEqual(expect.objectContaining({
      sectionId: '201',
      categoryId: '200',
      sourceSectionId: '201',
      sourceCategoryId: '999',
      sectionSource: 'zendesk_article',
      categorySource: 'zendesk_section_parent',
      taxonomyNote: 'Zendesk category 999 conflicts with section 201 parent 200; effective category follows the section parent.'
    }));
  });

  test('marks local drafts conflicted when live Zendesk content changes instead of deleting them', async () => {
    const workspace = await repository.createWorkspace({
      name: 'Sync Conflicts Drafts',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'sync-conflicts-drafts')
    });
    patchZendeskCredentials(repository, workspace.id);

    patchZendeskClient({
      testConnection: async () => ({ ok: true, status: 200 }),
      listCategories: async () => [{ id: 200, name: 'Operations' }],
      listSections: async () => [{ id: 201, name: 'Billing', category_id: 200 }],
      listArticles: async (locale, page = 1) => ({
        items: page === 1
          ? [{
              id: 1001,
              title: 'Billing Dashboard',
              body: '<h1>Billing Dashboard</h1><p>Original live article.</p>',
              locale,
              section_id: 201,
              category_id: 200,
              updated_at: '2026-04-19T12:00:00.000Z'
            }]
          : [],
        hasMore: false,
        nextPage: null
      })
    });

    const service = new ZendeskSyncService(repository);
    await service.runSync(
      {
        workspaceId: workspace.id,
        mode: 'full',
        maxRetries: 0
      },
      () => undefined,
      'zendesk.sync.run',
      'job-conflict-baseline'
    );

    const family = await repository.getArticleFamilyByExternalKey(workspace.id, 'hc:1001');
    expect(family).toBeTruthy();
    const variant = await repository.getLocaleVariantByFamilyAndLocale(workspace.id, family!.id, 'en-us');
    expect(variant).toBeTruthy();

    const branch = await repository.createDraftBranch({
      workspaceId: workspace.id,
      localeVariantId: variant!.id,
      name: 'Ready before sync',
      sourceHtml: '<h1>Billing Dashboard</h1><p>Local draft edit.</p>'
    });
    await repository.setDraftBranchStatus({
      workspaceId: workspace.id,
      branchId: branch.branch.id,
      status: DraftBranchStatus.READY_TO_PUBLISH
    });

    patchZendeskClient({
      testConnection: async () => ({ ok: true, status: 200 }),
      listCategories: async () => [{ id: 200, name: 'Operations' }],
      listSections: async () => [{ id: 201, name: 'Billing', category_id: 200 }],
      listArticles: async (locale, page = 1) => ({
        items: page === 1
          ? [{
              id: 1001,
              title: 'Billing Dashboard',
              body: '<h1>Billing Dashboard</h1><p>Updated from Zendesk.</p>',
              locale,
              section_id: 201,
              category_id: 200,
              updated_at: '2026-04-20T12:00:00.000Z'
            }]
          : [],
        hasMore: false,
        nextPage: null
      })
    });

    await service.runSync(
      {
        workspaceId: workspace.id,
        mode: 'full',
        maxRetries: 0
      },
      () => undefined,
      'zendesk.sync.run',
      'job-conflict-refresh'
    );

    const drafts = await repository.listDraftBranches(workspace.id, { workspaceId: workspace.id });
    expect(drafts.branches).toHaveLength(1);
    expect(drafts.branches[0]?.id).toBe(branch.branch.id);
    expect(drafts.branches[0]?.status).toBe(DraftBranchStatus.CONFLICTED);

    const editor = await repository.getDraftBranchEditor(workspace.id, branch.branch.id);
    expect(editor.branch.status).toBe(DraftBranchStatus.CONFLICTED);
    expect(editor.editor.html).toContain('Local draft edit.');
  });

  test('preserves cancellation when taxonomy refresh is interrupted', async () => {
    const workspace = await repository.createWorkspace({
      name: 'Sync Cancel During Taxonomy',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'sync-cancel-during-taxonomy')
    });
    patchZendeskCredentials(repository, workspace.id);

    let shouldCancel = false;
    let articleCalls = 0;
    patchZendeskClient({
      testConnection: async () => ({ ok: true, status: 200 }),
      listCategories: async () => {
        shouldCancel = true;
        return [{ id: 200, name: 'Operations' }];
      },
      listSections: async () => {
        throw new Error('listSections should not run after cancellation');
      },
      listArticles: async () => {
        articleCalls += 1;
        return {
          items: [],
          hasMore: false,
          nextPage: null
        };
      }
    });

    const service = new ZendeskSyncService(repository);
    const events: JobEvent[] = [];

    await service.runSync(
      {
        workspaceId: workspace.id,
        mode: 'full',
        maxRetries: 0
      },
      (event) => events.push(event),
      'zendesk.sync.run',
      'job-3',
      () => shouldCancel
    );

    expect(events.at(-1)?.state).toBe(JobState.CANCELED);
    expect(events.at(-1)?.message).toBe('Sync canceled');
    expect(events.some((event) => (
      event.state === JobState.RUNNING
      && event.message?.includes('Category/section name refresh failed; continuing article sync')
    ))).toBe(false);
    expect(articleCalls).toBe(0);
    expect(await repository.getArticleFamilyByExternalKey(workspace.id, 'hc:1001')).toBeNull();
    expect(await repository.listKbScopeCatalogEntries(workspace.id)).toEqual([]);

    const latestRun = await repository.getLatestSyncRun(workspace.id);
    expect(latestRun).toEqual(expect.objectContaining({
      state: 'CANCELED',
      syncedArticles: 0,
      createdFamilies: 0,
      createdVariants: 0,
      createdRevisions: 0
    }));
  });
});
