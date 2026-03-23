import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { CommandBus } from '../src/main/services/command-bus';
import { JobRegistry } from '../src/main/services/job-runner';
import { registerCoreCommands } from '../src/main/services/command-registry';
import { AppErrorCode } from '@kb-vault/shared-types';

async function createFakeAcpBinary(root: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-article-ai-agent');
  const source = `#!/usr/bin/env node
const readline = require('node:readline');
const sessionId = 'fake-acp-session';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  const message = JSON.parse(trimmed);
  if (message.method === 'initialize' || message.method === 'authenticate') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }
  if (message.method === 'session/new') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId } }) + '\\n');
    return;
  }
  if (message.method === 'session/prompt') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { text: JSON.stringify({ updatedHtml: '<h1>Draft Commands</h1><p>AI refined draft.</p>', summary: 'AI tightened the article.' }) } }) + '\\n');
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;
  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

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
  let previousCursorBinary: string | undefined;

  test.beforeEach(async () => {
    previousCursorBinary = process.env.KBV_CURSOR_BINARY;
    const harness = await createTestHarness();
    bus = harness.bus;
    createWorkspace = harness.createWorkspace;
    cleanup = harness.cleanup;
  });

  test.afterEach(async () => {
    if (previousCursorBinary === undefined) {
      delete process.env.KBV_CURSOR_BINARY;
    } else {
      process.env.KBV_CURSOR_BINARY = previousCursorBinary;
    }
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
        decision: 'accept',
        note: 'Ship it into a new draft.'
      }
    });
    expect(decideResp.ok).toBe(true);
    expect((decideResp.data as { reviewStatus: string }).reviewStatus).toBe('accepted');
    expect((decideResp.data as { branchId?: string }).branchId).toBeTruthy();
    expect((decideResp.data as { revisionId?: string }).revisionId).toBeTruthy();
  });

  test('supports batch 8 draft branch commands end to end', async () => {
    const workspace = await createWorkspace();

    const familyResp = await bus.execute({
      method: 'articleFamily.create',
      payload: {
        workspaceId: workspace.id,
        externalKey: 'kb-draft-commands',
        title: 'Draft Commands'
      }
    });
    expect(familyResp.ok).toBe(true);
    const family = familyResp.data as { id: string };

    const localeResp = await bus.execute({
      method: 'localeVariant.create',
      payload: {
        workspaceId: workspace.id,
        familyId: family.id,
        locale: 'en-us',
        status: 'live'
      }
    });
    expect(localeResp.ok).toBe(true);
    const localeVariant = localeResp.data as { id: string };

    const branchCreate = await bus.execute({
      method: 'draft.branch.create',
      payload: {
        workspaceId: workspace.id,
        localeVariantId: localeVariant.id,
        sourceHtml: '<h1>Draft Commands</h1><p>Initial.</p>'
      }
    });
    expect(branchCreate.ok).toBe(true);
    const created = branchCreate.data as { branch: { id: string; headRevisionId: string } };

    const listResp = await bus.execute({
      method: 'draft.branch.list',
      payload: { workspaceId: workspace.id }
    });
    expect(listResp.ok).toBe(true);
    expect((listResp.data as { branches: unknown[] }).branches.length).toBe(1);

    const saveResp = await bus.execute({
      method: 'draft.branch.save',
      payload: {
        workspaceId: workspace.id,
        branchId: created.branch.id,
        expectedHeadRevisionId: created.branch.headRevisionId,
        html: '<h1>Draft Commands</h1><script>alert(1)</script><p>Saved.</p>'
      }
    });
    expect(saveResp.ok).toBe(true);
    expect((saveResp.data as { editor: { validationWarnings: Array<{ code: string }> } }).editor.validationWarnings.some((warning) => warning.code === 'unsupported_tag')).toBe(true);

    const readyResp = await bus.execute({
      method: 'draft.branch.status.set',
      payload: {
        workspaceId: workspace.id,
        branchId: created.branch.id,
        status: 'ready_to_publish'
      }
    });
    expect(readyResp.ok).toBe(true);
    expect((readyResp.data as { branch: { status: string } }).branch.status).toBe('ready_to_publish');
  });

  test('supports batch 9 article ai and template pack commands end to end', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch9-commands-'));
    process.env.KBV_CURSOR_BINARY = await createFakeAcpBinary(isolatedRoot);
    const harness = await createTestHarness();

    try {
      const workspace = await harness.createWorkspace();

      const familyResp = await harness.bus.execute({
        method: 'articleFamily.create',
        payload: {
          workspaceId: workspace.id,
          externalKey: 'kb-batch9-commands',
          title: 'Batch 9 Commands'
        }
      });
      expect(familyResp.ok).toBe(true);
      const family = familyResp.data as { id: string };

      const localeResp = await harness.bus.execute({
        method: 'localeVariant.create',
        payload: {
          workspaceId: workspace.id,
          familyId: family.id,
          locale: 'en-us',
          status: 'live'
        }
      });
      expect(localeResp.ok).toBe(true);
      const localeVariant = localeResp.data as { id: string };

      const branchResp = await harness.bus.execute({
        method: 'draft.branch.create',
        payload: {
          workspaceId: workspace.id,
          localeVariantId: localeVariant.id,
          sourceHtml: '<h1>Draft Commands</h1><p>Initial draft.</p>'
        }
      });
      expect(branchResp.ok).toBe(true);
      const branch = branchResp.data as { branch: { id: string } };

      const aiGet = await harness.bus.execute({
        method: 'article.ai.get',
        payload: {
          workspaceId: workspace.id,
          branchId: branch.branch.id
        }
      });
      expect(aiGet.ok).toBe(true);

      const aiSubmit = await harness.bus.execute({
        method: 'article.ai.submit',
        payload: {
          workspaceId: workspace.id,
          branchId: branch.branch.id,
          message: 'Shorten and tighten this article.'
        }
      });
      expect(aiSubmit.ok).toBe(true);
      expect((aiSubmit.data as { pendingEdit?: { proposedHtml: string } }).pendingEdit?.proposedHtml).toContain('AI refined draft');

      const aiAccept = await harness.bus.execute({
        method: 'article.ai.accept',
        payload: {
          workspaceId: workspace.id,
          sessionId: (aiSubmit.data as { session: { id: string } }).session.id
        }
      });
      expect(aiAccept.ok).toBe(true);
      expect((aiAccept.data as { acceptedRevisionId?: string }).acceptedRevisionId).toBeTruthy();

      const templates = await harness.bus.execute({
        method: 'template.pack.list',
        payload: { workspaceId: workspace.id, includeInactive: true }
      });
      expect(templates.ok).toBe(true);
      expect((templates.data as { templates: unknown[] }).templates.length).toBeGreaterThan(0);

      const savedTemplate = await harness.bus.execute({
        method: 'template.pack.save',
        payload: {
          workspaceId: workspace.id,
          name: 'Batch 9 Custom Template',
          language: 'en-us',
          templateType: 'faq',
          promptTemplate: 'Answer questions directly.',
          toneRules: 'Be concise and helpful.',
          description: 'FAQ pack'
        }
      });
      expect(savedTemplate.ok).toBe(true);
      const templateId = (savedTemplate.data as { id: string }).id;

      const analyzed = await harness.bus.execute({
        method: 'template.pack.analyze',
        payload: {
          workspaceId: workspace.id,
          templatePackId: templateId
        }
      });
      expect(analyzed.ok).toBe(true);
      expect((analyzed.data as { analysis?: { score: number } }).analysis?.score).toBeGreaterThan(0);

      const deleted = await harness.bus.execute({
        method: 'template.pack.delete',
        payload: {
          workspaceId: workspace.id,
          templatePackId: templateId
        }
      });
      expect(deleted.ok).toBe(true);
    } finally {
      await harness.cleanup();
      await rm(isolatedRoot, { recursive: true, force: true });
    }
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
