import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test, expect } from '@playwright/test';
import { WorkspaceRepository } from '../src/main/services/workspace-repository';
import { PBIImportFormat, PBIBatchScopeMode, ProposalReviewDecision, ProposalReviewStatus } from '@kb-vault/shared-types';

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
    expect(firstGet.kbAccessMode).toBe('mcp');

    const updated = await repository.updateWorkspaceSettings({
      workspaceId: created.id,
      defaultLocale: 'fr-fr',
      enabledLocales: ['fr-fr'],
      kbAccessMode: 'cli'
    });
    expect(updated.defaultLocale).toBe('fr-fr');
    expect(updated.enabledLocales).toEqual(['fr-fr']);
    expect(updated.kbAccessMode).toBe('cli');

    const secondGet = await repository.getWorkspaceSettings(created.id);
    expect(secondGet.defaultLocale).toBe('fr-fr');
    expect(secondGet.enabledLocales).toEqual(['fr-fr']);
    expect(secondGet.kbAccessMode).toBe('cli');
  });

  test('persists workspace settings updates across repository instances', async () => {
    const created = await repository.createWorkspace({
      name: 'Settings Persistence Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us', 'fr-fr'],
      path: path.join(workspaceRoot, 'settings-persistence')
    });

    await repository.updateWorkspaceSettings({
      workspaceId: created.id,
      defaultLocale: 'fr-fr',
      enabledLocales: ['fr-fr'],
      kbAccessMode: 'cli'
    });

    const reloadedRepository = new WorkspaceRepository(workspaceRoot);
    const reloadedSettings = await reloadedRepository.getWorkspaceSettings(created.id);
    expect(reloadedSettings.defaultLocale).toBe('fr-fr');
    expect(reloadedSettings.enabledLocales).toEqual(['fr-fr']);
    expect(reloadedSettings.kbAccessMode).toBe('cli');
  });

  test('repairs missing workspace database during migration health check', async () => {
    const created = await repository.createWorkspace({
      name: 'Migration Repair Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us', 'es-es'],
      path: path.join(workspaceRoot, 'migration-repair')
    });

    const before = await repository.getMigrationHealth(created.id);
    expect(before.workspaces[0].exists).toBe(true);
    expect(before.workspaces[0].repaired).toBe(false);

    const workspaceDbPath = before.workspaces[0].workspaceDbPath;
    await rm(workspaceDbPath, { force: true });

    const after = await repository.getMigrationHealth(created.id);
    const repairedEntry = after.workspaces.find((entry) => entry.workspaceId === created.id);
    expect(repairedEntry).toBeTruthy();
    expect(repairedEntry?.repaired).toBe(true);
    expect(repairedEntry?.exists).toBe(true);
    expect(repairedEntry?.workspaceDbVersion).toBeGreaterThanOrEqual(7);
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

    await expect(
      repository.updateWorkspaceSettings({
        workspaceId: created.id,
        kbAccessMode: 'broken' as 'mcp'
      })
    ).rejects.toThrow('kbAccessMode must be mcp or cli');
  });

  test('builds proposal review queue, detail payload, and persists decisions', async () => {
    const created = await repository.createWorkspace({
      name: `ProposalReview-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const batch = await repository.createPBIBatch(
      created.id,
      'Sprint 42',
      'sprint-42.csv',
      'imports/sprint-42.csv',
      PBIImportFormat.CSV,
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 1
      },
      PBIBatchScopeMode.ALL
    );

    await repository.insertPBIRecords(created.id, batch.id, [
      {
        batchId: batch.id,
        sourceRowNumber: 1,
        externalId: 'PBI-42',
        title: 'Add team dashboard assignment docs',
        description: 'Document the new team dashboard assignment flow'
      }
    ]);
    const insertedPbis = await repository.getPBIRecords(created.id, batch.id);
    const pbiId = insertedPbis[0]?.id;
    expect(pbiId).toBeTruthy();

    const proposal = await repository.createAgentProposal({
      workspaceId: created.id,
      batchId: batch.id,
      action: 'edit',
      targetTitle: 'Create & Edit Chat Channels',
      targetLocale: 'en-us',
      confidenceScore: 0.92,
      rationaleSummary: 'Update the assignment steps to match the new dashboard flow.',
      aiNotes: 'The title stays the same but steps 3-5 change.',
      suggestedPlacement: {
        sectionId: 'sec-dashboard',
        notes: 'Keep this in the admin workflows section.'
      },
      sourceHtml: '<h1>Create & Edit Chat Channels</h1>\n<p>Old flow.</p>',
      proposedHtml: '<h1>Create & Edit Chat Channels</h1>\n<p>New team dashboard flow.</p>',
      relatedPbiIds: [pbiId as string]
    });

    expect(proposal.reviewStatus).toBe(ProposalReviewStatus.PENDING_REVIEW);

    const queue = await repository.listProposalReviewQueue(created.id, batch.id);
    expect(queue.summary.total).toBe(1);
    expect(queue.summary.pendingReview).toBe(1);
    expect(queue.groups[0].articleLabel).toBe('Create & Edit Chat Channels');
    expect(queue.queue[0].relatedPbiCount).toBe(1);

    const detail = await repository.getProposalReviewDetail(created.id, proposal.id);
    expect(detail.relatedPbis).toHaveLength(1);
    expect(detail.diff.changeRegions.length).toBeGreaterThan(0);
    expect(detail.navigation.total).toBe(1);

    const decision = await repository.decideProposalReview({
      workspaceId: created.id,
      proposalId: proposal.id,
      decision: ProposalReviewDecision.ACCEPT,
      note: 'Looks good.'
    });

    expect(decision.reviewStatus).toBe(ProposalReviewStatus.ACCEPTED);
    expect(decision.batchStatus).toBe('review_complete');
    expect(decision.summary.accepted).toBe(1);
  });

  test('rejects empty create proposals and infers KB-prefixed article titles', async () => {
    const created = await repository.createWorkspace({
      name: `ProposalGuardrails-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const batch = await repository.createPBIBatch(
      created.id,
      'Sprint 43',
      'sprint-43.csv',
      'imports/sprint-43.csv',
      PBIImportFormat.CSV,
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 1
      },
      PBIBatchScopeMode.ALL
    );

    await expect(
      repository.createAgentProposal({
        workspaceId: created.id,
        batchId: batch.id,
        action: 'create'
      })
    ).rejects.toThrow('Proposal must include notes, rationale, metadata, linked PBIs, or HTML content');

    const createdProposal = await repository.createAgentProposal({
      workspaceId: created.id,
      batchId: batch.id,
      action: 'create',
      note: 'KB create: article Duplicate Food Lists and Food Items (Portal)',
      rationale: 'No duplicate article exists today.'
    });

    expect(createdProposal.targetTitle).toBe('Duplicate Food Lists and Food Items');
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

  test('uses the newest of the locale sync timestamp and revision timestamp in explorer tree rows', async () => {
    const created = await repository.createWorkspace({
      name: `ExplorerSync-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const family = await repository.createArticleFamily({
      workspaceId: created.id,
      externalKey: 'sync-guide',
      title: 'Sync Guide'
    });
    const variant = await repository.createLocaleVariant({
      workspaceId: created.id,
      familyId: family.id,
      locale: 'en-us'
    });

    const revision = await repository.createRevision({
      workspaceId: created.id,
      localeVariantId: variant.id,
      revisionType: 'live',
      filePath: '/tmp/sync-guide.html',
      revisionNumber: 1,
      status: 'promoted',
      updatedAtUtc: '2026-03-20T10:00:00.000Z'
    });

    await repository.upsertSyncCheckpoint(
      created.id,
      'en-us',
      1,
      '2026-03-22T15:30:00.000Z'
    );

    const tree = await repository.getExplorerTree(created.id);
    expect(tree).toHaveLength(1);
    expect(tree[0].familyId).toBe(family.id);
    expect(tree[0].locales).toHaveLength(1);
    expect(tree[0].locales[0].localeVariantId).toBe(variant.id);
    expect(tree[0].locales[0].revision.revisionId).toBe(revision.id);
    expect(tree[0].locales[0].revision.updatedAtUtc).toBe('2026-03-22T15:30:00.000Z');

    await repository.updateRevision({
      workspaceId: created.id,
      revisionId: revision.id,
      updatedAtUtc: '2026-03-22T16:45:00.000Z'
    });

    const refreshedTree = await repository.getExplorerTree(created.id);
    expect(refreshedTree[0].locales[0].revision.updatedAtUtc).toBe('2026-03-22T16:45:00.000Z');
  });
});
