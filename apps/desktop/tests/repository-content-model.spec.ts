import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test, expect } from '@playwright/test';
import { WorkspaceRepository } from '../src/main/services/workspace-repository';

test.describe('workspace repository content model', () => {
  let workspaceRoot: string;
  let repository: WorkspaceRepository;

  test.beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch2-repo-'));
    await mkdir(workspaceRoot, { recursive: true });
    repository = new WorkspaceRepository(workspaceRoot);
  });

  test.afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  test('manages workspace settings through catalog + workspace_settings table', async () => {
    const created = await repository.createWorkspace({
      name: 'Settings Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us', 'fr-fr'],
      path: path.join(workspaceRoot, 'workspace-one')
    });

    const firstGet = await repository.getWorkspaceSettings(created.id);
    expect(firstGet.workspaceId).toBe(created.id);
    expect(firstGet.defaultLocale).toBe('en-us');
    expect(firstGet.enabledLocales).toEqual(['en-us', 'fr-fr']);

    const updated = await repository.updateWorkspaceSettings({
      workspaceId: created.id,
      defaultLocale: 'fr-fr',
      enabledLocales: ['fr-fr']
    });
    expect(updated.defaultLocale).toBe('fr-fr');
    expect(updated.enabledLocales).toEqual(['fr-fr']);

    const secondGet = await repository.getWorkspaceSettings(created.id);
    expect(secondGet.defaultLocale).toBe('fr-fr');
    expect(secondGet.enabledLocales).toEqual(['fr-fr']);
  });

  test('rejects invalid workspace settings updates', async () => {
    const created = await repository.createWorkspace({
      name: 'Invalid Settings Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    await expect(
      repository.updateWorkspaceSettings({
        workspaceId: created.id,
        enabledLocales: []
      })
    ).rejects.toThrow('enabledLocales cannot be empty');

    await expect(
      repository.updateWorkspaceSettings({
        workspaceId: created.id,
        defaultLocale: 'de-de',
        enabledLocales: ['en-us']
      })
    ).rejects.toThrow('defaultLocale must be included in enabledLocales');

    await expect(
      repository.updateWorkspaceSettings({
        workspaceId: created.id,
        defaultLocale: ''
      })
    ).rejects.toThrow('defaultLocale cannot be empty');
  });

  test('manages article family CRUD and validation', async () => {
    const created = await repository.createWorkspace({
      name: `Families-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const listEmpty = await repository.listArticleFamilies(created.id);
    expect(listEmpty.length).toBe(0);

    const family = await repository.createArticleFamily({
      workspaceId: created.id,
      externalKey: 'getting-started',
      title: 'Getting Started',
      sectionId: 'section-a',
      categoryId: 'category-a'
    });

    const fetched = await repository.getArticleFamily(created.id, family.id);
    expect(fetched.externalKey).toBe('getting-started');

    const families = await repository.listArticleFamilies(created.id);
    expect(families.length).toBe(1);

    const updated = await repository.updateArticleFamily({
      workspaceId: created.id,
      familyId: family.id,
      title: 'Updated Family',
      retiredAtUtc: '2026-01-01T00:00:00.000Z'
    });
    expect(updated.title).toBe('Updated Family');
    expect(updated.retiredAtUtc).toBe('2026-01-01T00:00:00.000Z');

    await expect(
      repository.updateArticleFamily({
        workspaceId: created.id,
        familyId: family.id
      })
    ).rejects.toThrow('Article family update requires at least one field');

    await expect(
      repository.createArticleFamily({
        workspaceId: created.id,
        externalKey: 'getting-started',
        title: 'Duplicate Family'
      })
    ).rejects.toThrow('Article family already exists');

    await repository.deleteArticleFamily(created.id, family.id);
    await expect(repository.getArticleFamily(created.id, family.id)).rejects.toThrow('Article family not found');
  });

  test('manages locale variants and validates uniqueness', async () => {
    const created = await repository.createWorkspace({
      name: `Variants-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const family = await repository.createArticleFamily({
      workspaceId: created.id,
      externalKey: 'api',
      title: 'API Guide'
    });

    const variant = await repository.createLocaleVariant({
      workspaceId: created.id,
      familyId: family.id,
      locale: 'en-us'
    });

    const variants = await repository.listLocaleVariants(created.id);
    expect(variants.length).toBe(1);
    expect(variants[0].locale).toBe('en-us');

    const fetched = await repository.getLocaleVariant(created.id, variant.id);
    expect(fetched.id).toBe(variant.id);

    const updated = await repository.updateLocaleVariant({
      workspaceId: created.id,
      variantId: variant.id,
      locale: 'en-gb',
      status: 'draft_branch'
    });
    expect(updated.locale).toBe('en-gb');

    await expect(
      repository.createLocaleVariant({
        workspaceId: created.id,
        familyId: family.id,
        locale: 'en-gb'
      })
    ).rejects.toThrow('Locale variant already exists');

    await repository.deleteLocaleVariant(created.id, updated.id);
    await expect(repository.getLocaleVariant(created.id, updated.id)).rejects.toThrow('Locale variant not found');
  });

  test('manages revisions and enforces ordering/number constraints', async () => {
    const created = await repository.createWorkspace({
      name: `Revisions-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const family = await repository.createArticleFamily({
      workspaceId: created.id,
      externalKey: 'release-notes',
      title: 'Release Notes'
    });
    const variant = await repository.createLocaleVariant({
      workspaceId: created.id,
      familyId: family.id,
      locale: 'en-us'
    });

    const revisionOne = await repository.createRevision({
      workspaceId: created.id,
      localeVariantId: variant.id,
      revisionType: 'live',
      filePath: '/tmp/release-1.json',
      revisionNumber: 1,
      status: 'open'
    });

    const revisionTwo = await repository.createRevision({
      workspaceId: created.id,
      localeVariantId: variant.id,
      revisionType: 'live',
      filePath: '/tmp/release-2.json',
      revisionNumber: 2,
      status: 'promoted'
    });
    expect(revisionTwo.revisionNumber).toBe(2);

    const revisions = await repository.listRevisions(created.id, variant.id);
    expect(revisions[0].revisionNumber).toBeGreaterThanOrEqual(revisions[1].revisionNumber);

    const fetchedRevision = await repository.getRevision(created.id, revisionTwo.id);
    expect(fetchedRevision.id).toBe(revisionTwo.id);

    const updated = await repository.updateRevision({
      workspaceId: created.id,
      revisionId: revisionTwo.id,
      revisionNumber: 3,
      status: 'failed'
    });
    expect(updated.revisionNumber).toBe(3);

    await expect(
      repository.createRevision({
        workspaceId: created.id,
        localeVariantId: variant.id,
        revisionType: 'live',
        filePath: '/tmp/release-0.json',
        revisionNumber: 2,
        status: 'open'
      })
    ).rejects.toThrow('revisionNumber must not regress');

    await expect(
      repository.createRevision({
        workspaceId: created.id,
        localeVariantId: variant.id,
        revisionType: 'live',
        filePath: '/tmp/revision.json',
        revisionNumber: 3.25,
        status: 'open'
      })
    ).rejects.toThrow('revisionNumber must be an integer');

    const deleted = await repository.deleteRevision(created.id, revisionOne.id);
    expect(deleted).toBeUndefined();

    await expect(repository.getRevision(created.id, revisionOne.id)).rejects.toThrow('Revision not found');

    const afterDelete = await repository.listRevisions(created.id, variant.id);
    expect(afterDelete.some((revision) => revision.id === revisionOne.id)).toBe(false);
  });
});
