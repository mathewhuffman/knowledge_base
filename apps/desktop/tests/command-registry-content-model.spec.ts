import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { CommandBus } from '../src/main/services/command-bus';
import { JobRegistry } from '../src/main/services/job-runner';
import { registerCoreCommands } from '../src/main/services/command-registry';
import { AppErrorCode } from '@kb-vault/shared-types';

async function createTestHarness() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch2-commands-'));
  await mkdir(workspaceRoot, { recursive: true });
  const bus = new CommandBus();
  const jobs = new JobRegistry();
  registerCoreCommands(bus, jobs, workspaceRoot);

  const createWorkspace = async () => {
    const workspaceName = `ws-${randomUUID()}`;
    const created = await bus.execute({
      method: 'workspace.create',
      payload: {
        name: workspaceName,
        zendeskSubdomain: 'support',
        defaultLocale: 'en-us',
        enabledLocales: ['en-us', 'es-es']
      }
    });
    expect(created.ok).toBe(true);
    return created.data as { id: string };
  };

  return { workspaceRoot, bus, jobs, createWorkspace, cleanup: () => rm(workspaceRoot, { recursive: true, force: true }) };
}

test.describe('command registry content model transitions', () => {
  let bus: CommandBus;
  let cleanup: () => Promise<void>;
  let createWorkspace: () => Promise<{ id: string }>;

  test.beforeEach(async () => {
    const harness = await createTestHarness();
    bus = harness.bus;
    createWorkspace = harness.createWorkspace;
    cleanup = harness.cleanup;
  });

  test.afterEach(async () => {
    await cleanup();
  });

  test('handles workspace settings command read/write + validation', async () => {
    const workspace = await createWorkspace();

    const getResp = await bus.execute({
      method: 'workspace.settings.get',
      payload: { workspaceId: workspace.id }
    });
    expect(getResp.ok).toBe(true);
    expect((getResp.data as { zendeskSubdomain: string; kbAccessMode: string }).zendeskSubdomain).toBe('support');
    expect((getResp.data as { kbAccessMode: string }).kbAccessMode).toBe('mcp');

    const updateResp = await bus.execute({
      method: 'workspace.settings.update',
      payload: {
        workspaceId: workspace.id,
        defaultLocale: 'es-es',
        enabledLocales: ['es-es'],
        kbAccessMode: 'cli'
      }
    });
    expect(updateResp.ok).toBe(true);
    expect((updateResp.data as { enabledLocales: string[]; kbAccessMode: string }).enabledLocales).toEqual(['es-es']);
    expect((updateResp.data as { kbAccessMode: string }).kbAccessMode).toBe('cli');

    const invalidNoPayload = await bus.execute({
      method: 'workspace.settings.update',
      payload: { workspaceId: workspace.id }
    });
    expect(invalidNoPayload.ok).toBe(false);
    expect(invalidNoPayload.error?.code).toBe(AppErrorCode.INVALID_REQUEST);
  });

  test('returns provider-aware health payload for the selected workspace mode', async () => {
    const workspace = await createWorkspace();

    const settingsResp = await bus.execute({
      method: 'workspace.settings.update',
      payload: {
        workspaceId: workspace.id,
        kbAccessMode: 'cli'
      }
    });
    expect(settingsResp.ok).toBe(true);

    const healthResp = await bus.execute({
      method: 'agent.health.check',
      payload: { workspaceId: workspace.id }
    });

    expect(healthResp.ok).toBe(true);
    expect((healthResp.data as { selectedMode: string }).selectedMode).toBe('cli');
    expect((healthResp.data as { providers: { cli: { mode: string }; mcp: { mode: string } } }).providers.cli.mode).toBe('cli');
    expect((healthResp.data as { providers: { cli: { mode: string }; mcp: { mode: string } } }).providers.mcp.mode).toBe('mcp');
  });

  test('reports migration health and repair status for workspace DBs', async () => {
    const workspace = await createWorkspace();

    const first = await bus.execute({ method: 'system.migrations.health', payload: { workspaceId: workspace.id } });
    expect(first.ok).toBe(true);
    const firstData = first.data as {
      workspaces: Array<{ workspaceId: string; workspaceDbPath: string; exists: boolean; repaired: boolean }>;
    };
    expect(firstData.workspaces).toHaveLength(1);
    expect(firstData.workspaces[0].exists).toBe(true);
    expect(firstData.workspaces[0].repaired).toBe(false);

    const dbPath = firstData.workspaces[0].workspaceDbPath;
    await rm(dbPath, { force: true });

    const second = await bus.execute({ method: 'system.migrations.health', payload: { workspaceId: workspace.id } });
    expect(second.ok).toBe(true);
    const secondData = second.data as {
      workspaceId: string | null;
      catalogVersion: number;
      workspaces: Array<{ workspaceId: string; exists: boolean; repaired: boolean; workspaceDbVersion: number }>;
    };
    expect(secondData.workspaceId).toBe(workspace.id);
    expect(secondData.workspaces[0].repaired).toBe(true);
    expect(secondData.workspaces[0].exists).toBe(true);
    expect(secondData.workspaces[0].workspaceDbVersion).toBeGreaterThan(0);
  });

  test('supports batch 7 proposal review commands end to end', async () => {
    const workspace = await createWorkspace();

    const importResp = await bus.execute({
      method: 'pbiBatch.import',
      payload: {
        workspaceId: workspace.id,
        sourceFileName: 'batch-7.csv',
        sourceContent: 'Id,Title,Description\n101,Dashboard Assignment,Document the new dashboard assignment flow'
      }
    });
    expect(importResp.ok).toBe(true);
    const imported = importResp.data as { batch: { id: string } };

    const rowsResp = await bus.execute({
      method: 'pbiBatch.rows.list',
      payload: {
        workspaceId: workspace.id,
        batchId: imported.batch.id
      }
    });
    expect(rowsResp.ok).toBe(true);
    const rows = (rowsResp.data as { rows: Array<{ id: string }> }).rows;
    expect(rows.length).toBeGreaterThan(0);

    const ingestResp = await bus.execute({
      method: 'proposal.ingest',
      payload: {
        workspaceId: workspace.id,
        batchId: imported.batch.id,
        action: 'edit',
        targetTitle: 'Create & Edit Chat Channels',
        targetLocale: 'en-us',
        confidenceScore: 0.88,
        rationaleSummary: 'Reflect the new dashboard assignment path.',
        aiNotes: 'Steps 2-4 need updates.',
        sourceHtml: '<p>Old assignment flow.</p>',
        proposedHtml: '<p>New assignment flow.</p>',
        relatedPbiIds: [rows[0].id]
      }
    });
    expect(ingestResp.ok).toBe(true);
    const proposal = ingestResp.data as { id: string };

    const listResp = await bus.execute({
      method: 'proposal.review.list',
      payload: {
        workspaceId: workspace.id,
        batchId: imported.batch.id
      }
    });
    expect(listResp.ok).toBe(true);
    expect((listResp.data as { summary: { pendingReview: number } }).summary.pendingReview).toBe(1);

    const detailResp = await bus.execute({
      method: 'proposal.review.get',
      payload: {
        workspaceId: workspace.id,
        proposalId: proposal.id
      }
    });
    expect(detailResp.ok).toBe(true);
    expect((detailResp.data as { diff: { changeRegions: unknown[] } }).diff.changeRegions.length).toBeGreaterThan(0);

    const decideResp = await bus.execute({
      method: 'proposal.review.decide',
      payload: {
        workspaceId: workspace.id,
        proposalId: proposal.id,
        decision: 'deny',
        note: 'Not needed.'
      }
    });
    expect(decideResp.ok).toBe(true);
    expect((decideResp.data as { reviewStatus: string }).reviewStatus).toBe('denied');
  });

  test('handles articleFamily command lifecycle', async () => {
    const workspace = await createWorkspace();

    const createResp = await bus.execute({
      method: 'articleFamily.create',
      payload: {
        workspaceId: workspace.id,
        externalKey: 'kb-start',
        title: 'KB Start'
      }
    });
    expect(createResp.ok).toBe(true);
    const family = createResp.data as { id: string };

    const listResp = await bus.execute({
      method: 'articleFamily.list',
      payload: { workspaceId: workspace.id }
    });
    expect(listResp.ok).toBe(true);
    expect((listResp.data as { families: Array<{ id: string }>}).families.length).toBe(1);

    const getResp = await bus.execute({
      method: 'articleFamily.get',
      payload: { workspaceId: workspace.id, familyId: family.id }
    });
    expect(getResp.ok).toBe(true);
    expect((getResp.data as { title: string }).title).toBe('KB Start');

    const updateResp = await bus.execute({
      method: 'articleFamily.update',
      payload: {
        workspaceId: workspace.id,
        familyId: family.id,
        title: 'KB Start Updated'
      }
    });
    expect(updateResp.ok).toBe(true);

    const invalidUpdateResp = await bus.execute({
      method: 'articleFamily.update',
      payload: {
        workspaceId: workspace.id,
        familyId: family.id
      }
    });
    expect(invalidUpdateResp.ok).toBe(false);
    expect(invalidUpdateResp.error?.code).toBe(AppErrorCode.INVALID_REQUEST);

    const deleteResp = await bus.execute({
      method: 'articleFamily.delete',
      payload: { workspaceId: workspace.id, familyId: family.id }
    });
    expect(deleteResp.ok).toBe(true);

    const getAfterDelete = await bus.execute({
      method: 'articleFamily.get',
      payload: { workspaceId: workspace.id, familyId: family.id }
    });
    expect(getAfterDelete.ok).toBe(false);
    expect(getAfterDelete.error?.code).toBe(AppErrorCode.NOT_FOUND);
  });

  test('handles localeVariant transitions and validation', async () => {
    const workspace = await createWorkspace();
    const familyResp = await bus.execute({
      method: 'articleFamily.create',
      payload: {
        workspaceId: workspace.id,
        externalKey: 'variant-family',
        title: 'Variant Family'
      }
    });
    const family = familyResp.data as { id: string };

    const createVariantResp = await bus.execute({
      method: 'localeVariant.create',
      payload: {
        workspaceId: workspace.id,
        familyId: family.id,
        locale: 'en-us',
        status: 'live'
      }
    });
    expect(createVariantResp.ok).toBe(true);
    const variant = createVariantResp.data as { id: string };

    const listResp = await bus.execute({
      method: 'localeVariant.list',
      payload: { workspaceId: workspace.id }
    });
    expect(listResp.ok).toBe(true);
    expect((listResp.data as { variants: Array<{ id: string }>}).variants.length).toBe(1);

    const getResp = await bus.execute({
      method: 'localeVariant.get',
      payload: { workspaceId: workspace.id, variantId: variant.id }
    });
    expect(getResp.ok).toBe(true);

    const duplicateResp = await bus.execute({
      method: 'localeVariant.create',
      payload: {
        workspaceId: workspace.id,
        familyId: family.id,
        locale: 'en-us'
      }
    });
    expect(duplicateResp.ok).toBe(false);
    expect(duplicateResp.error?.code).toBe(AppErrorCode.INVALID_REQUEST);

    const updateResp = await bus.execute({
      method: 'localeVariant.update',
      payload: {
        workspaceId: workspace.id,
        variantId: variant.id,
        locale: 'en-gb'
      }
    });
    expect(updateResp.ok).toBe(true);

    const updateInvalid = await bus.execute({
      method: 'localeVariant.update',
      payload: {
        workspaceId: workspace.id,
        variantId: variant.id
      }
    });
    expect(updateInvalid.ok).toBe(false);
    expect(updateInvalid.error?.code).toBe(AppErrorCode.INVALID_REQUEST);

    const deleteResp = await bus.execute({
      method: 'localeVariant.delete',
      payload: { workspaceId: workspace.id, variantId: variant.id }
    });
    expect(deleteResp.ok).toBe(true);

    const getAfterDelete = await bus.execute({
      method: 'localeVariant.get',
      payload: { workspaceId: workspace.id, variantId: variant.id }
    });
    expect(getAfterDelete.ok).toBe(false);
    expect(getAfterDelete.error?.code).toBe(AppErrorCode.NOT_FOUND);
  });

  test('handles revision transitions and numeric validation', async () => {
    const workspace = await createWorkspace();
    const familyResp = await bus.execute({
      method: 'articleFamily.create',
      payload: {
        workspaceId: workspace.id,
        externalKey: 'revision-family',
        title: 'Revision Family'
      }
    });
    const family = familyResp.data as { id: string };

    const variantResp = await bus.execute({
      method: 'localeVariant.create',
      payload: { workspaceId: workspace.id, familyId: family.id, locale: 'en-us' }
    });
    const variant = variantResp.data as { id: string };

    const createResp = await bus.execute({
      method: 'revision.create',
      payload: {
        workspaceId: workspace.id,
        localeVariantId: variant.id,
        revisionType: 'live',
        branchId: null,
        filePath: '/tmp/revision-one.json',
        status: 'open',
        revisionNumber: 1
      }
    });
    expect(createResp.ok).toBe(true);
    const revision = createResp.data as { id: string };

    const listResp = await bus.execute({
      method: 'revision.list',
      payload: { workspaceId: workspace.id, localeVariantId: variant.id }
    });
    expect(listResp.ok).toBe(true);
    expect((listResp.data as { revisions: Array<{ id: string; revisionNumber: number }>}).revisions.length).toBe(1);

    const getResp = await bus.execute({
      method: 'revision.get',
      payload: { workspaceId: workspace.id, revisionId: revision.id }
    });
    expect(getResp.ok).toBe(true);

    const updateResp = await bus.execute({
      method: 'revision.update',
      payload: {
        workspaceId: workspace.id,
        revisionId: revision.id,
        status: 'promoted',
        revisionNumber: 2
      }
    });
    expect(updateResp.ok).toBe(true);

    const invalidUpdate = await bus.execute({
      method: 'revision.update',
      payload: {
        workspaceId: workspace.id,
        revisionId: revision.id
      }
    });
    expect(invalidUpdate.ok).toBe(false);
    expect(invalidUpdate.error?.code).toBe(AppErrorCode.INVALID_REQUEST);

    const invalidNumberResp = await bus.execute({
      method: 'revision.create',
      payload: {
        workspaceId: workspace.id,
        localeVariantId: variant.id,
        revisionType: 'live',
        filePath: '/tmp/revision-two.json',
        status: 'open',
        revisionNumber: 1
      }
    });
    expect(invalidNumberResp.ok).toBe(false);
    expect(invalidNumberResp.error?.code).toBe(AppErrorCode.INVALID_REQUEST);

    const deleteResp = await bus.execute({
      method: 'revision.delete',
      payload: { workspaceId: workspace.id, revisionId: revision.id }
    });
    expect(deleteResp.ok).toBe(true);

    const getAfterDelete = await bus.execute({
      method: 'revision.get',
      payload: { workspaceId: workspace.id, revisionId: revision.id }
    });
    expect(getAfterDelete.ok).toBe(false);
    expect(getAfterDelete.error?.code).toBe(AppErrorCode.NOT_FOUND);
  });
});
