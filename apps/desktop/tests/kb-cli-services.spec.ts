import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { CliHealthFailure } from '@kb-vault/shared-types';
import { WorkspaceRepository } from '../src/main/services/workspace-repository';
import { KbCliLoopbackService } from '../src/main/services/kb-cli-loopback-service';
import { KbCliRuntimeService } from '../src/main/services/kb-cli-runtime-service';

test.describe('kb cli desktop services', () => {
  let workspaceRoot: string;
  let repository: WorkspaceRepository;
  let loopbackService: KbCliLoopbackService;
  let cliRuntimeService: KbCliRuntimeService;

  test.beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-cli-services-'));
    await mkdir(workspaceRoot, { recursive: true });
    repository = new WorkspaceRepository(workspaceRoot);
    loopbackService = new KbCliLoopbackService(repository);
    cliRuntimeService = new KbCliRuntimeService(loopbackService, repository);
    await loopbackService.start();
  });

  test.afterEach(async () => {
    await loopbackService.stop();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  test('serves the loopback health and article routes expected by CLI mode', async () => {
    const created = await repository.createWorkspace({
      name: 'CLI Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'workspace-one')
    });

    const family = await repository.createArticleFamily({
      workspaceId: created.id,
      externalKey: 'api-guide',
      title: 'API Guide'
    });
    const variant = await repository.createLocaleVariant({
      workspaceId: created.id,
      familyId: family.id,
      locale: 'en-us'
    });
    const articlePath = path.join(workspaceRoot, 'article.html');
    await writeFile(articlePath, '<h1>API Guide</h1><p>Loopback route test.</p>', 'utf8');
    await repository.createRevision({
      workspaceId: created.id,
      localeVariantId: variant.id,
      revisionType: 'live',
      filePath: articlePath,
      revisionNumber: 1,
      status: 'open'
    });

    const baseUrl = loopbackService.getBaseUrl();
    const authToken = loopbackService.getAuthToken();
    expect(baseUrl).toBeTruthy();

    const healthResp = await fetch(`${baseUrl}/health`);
    expect(healthResp.ok).toBe(true);
    expect((await healthResp.json() as { ok: boolean }).ok).toBe(true);

    const headers = {
      Authorization: `Bearer ${authToken}`
    };

    const searchResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/articles/search?query=${encodeURIComponent('API')}`,
      { headers }
    );
    expect(searchResp.ok).toBe(true);
    const searchJson = await searchResp.json() as { ok: boolean; total: number };
    expect(searchJson.ok).toBe(true);
    expect(searchJson.total).toBeGreaterThan(0);

    const familyResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/articles/families/${encodeURIComponent(family.id)}`,
      { headers }
    );
    expect(familyResp.ok).toBe(true);
    const familyJson = await familyResp.json() as { ok: boolean; family: { id: string } };
    expect(familyJson.ok).toBe(true);
    expect(familyJson.family.id).toBe(family.id);
    expect(Array.isArray(familyJson.variants)).toBe(true);
    expect(Array.isArray(familyJson.revisions)).toBe(true);

    const variantResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/articles/variants/${encodeURIComponent(variant.id)}`,
      { headers }
    );
    expect(variantResp.ok).toBe(true);
    const variantJson = await variantResp.json() as {
      ok: boolean;
      article: { familyId: string; sourceHtml: string };
    };
    expect(variantJson.ok).toBe(true);
    expect(variantJson.article.familyId).toBe(family.id);
    expect(variantJson.article.sourceHtml).toContain('Loopback route test.');

    const relatedResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/articles/related`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ articleId: variant.id, limit: 10 })
      }
    );
    expect(relatedResp.ok).toBe(true);
    const relatedJson = await relatedResp.json() as { ok: boolean; total: number };
    expect(relatedJson.ok).toBe(true);
    expect(relatedJson.total).toBeGreaterThan(0);
  });

  test('serves explorer-tree, history, templates, and PBI routes', async () => {
    const created = await repository.createWorkspace({
      name: 'Routes Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'workspace-routes')
    });

    const family = await repository.createArticleFamily({
      workspaceId: created.id,
      externalKey: 'routes-guide',
      title: 'Routes Guide'
    });
    const variant = await repository.createLocaleVariant({
      workspaceId: created.id,
      familyId: family.id,
      locale: 'en-us'
    });
    const articlePath = path.join(workspaceRoot, 'routes-article.html');
    await writeFile(articlePath, '<h1>Routes Guide</h1><p>Testing new routes.</p>', 'utf8');
    await repository.createRevision({
      workspaceId: created.id,
      localeVariantId: variant.id,
      revisionType: 'live',
      filePath: articlePath,
      revisionNumber: 1,
      status: 'open'
    });

    const baseUrl = loopbackService.getBaseUrl()!;
    const headers = { Authorization: `Bearer ${loopbackService.getAuthToken()}` };

    // explorer-tree
    const treeResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/explorer-tree`,
      { headers }
    );
    expect(treeResp.ok).toBe(true);
    const treeJson = await treeResp.json() as { ok: boolean; tree: unknown[] };
    expect(treeJson.ok).toBe(true);
    expect(Array.isArray(treeJson.tree)).toBe(true);

    // article history
    const historyResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/articles/history/${encodeURIComponent(variant.id)}`,
      { headers }
    );
    expect(historyResp.ok).toBe(true);
    const historyJson = await historyResp.json() as { ok: boolean };
    expect(historyJson.ok).toBe(true);

    // templates (empty list is valid)
    const templatesResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/templates`,
      { headers }
    );
    expect(templatesResp.ok).toBe(true);
    const templatesJson = await templatesResp.json() as { ok: boolean; templates: unknown[] };
    expect(templatesJson.ok).toBe(true);
    expect(Array.isArray(templatesJson.templates)).toBe(true);

    // template not found returns 404
    const templateResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/templates/nonexistent`,
      { headers }
    );
    expect(templateResp.status).toBe(404);

    // categories (returns local tree)
    const categoriesResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/categories`,
      { headers }
    );
    expect(categoriesResp.ok).toBe(true);
    const categoriesJson = await categoriesResp.json() as { ok: boolean; source: string };
    expect(categoriesJson.ok).toBe(true);
    expect(categoriesJson.source).toBe('local');

    // sections (returns local tree)
    const sectionsResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/sections`,
      { headers }
    );
    expect(sectionsResp.ok).toBe(true);
    const sectionsJson = await sectionsResp.json() as { ok: boolean; source: string };
    expect(sectionsJson.ok).toBe(true);
    expect(sectionsJson.source).toBe('local');

    // agent-notes POST
    const notesResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/agent-notes`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ note: 'Test note from CLI' })
      }
    );
    expect(notesResp.ok).toBe(true);
    const notesJson = await notesResp.json() as { ok: boolean; recorded: boolean; note: string };
    expect(notesJson.ok).toBe(true);
    expect(notesJson.recorded).toBe(true);
    expect(notesJson.note).toBe('Test note from CLI');
  });

  test('rejects requests without a valid auth token', async () => {
    const created = await repository.createWorkspace({
      name: 'Auth Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'workspace-auth')
    });

    const baseUrl = loopbackService.getBaseUrl()!;

    // No auth header
    const noAuthResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/articles/search?query=test`
    );
    expect(noAuthResp.status).toBe(401);
    const noAuthJson = await noAuthResp.json() as { ok: boolean; error: string };
    expect(noAuthJson.ok).toBe(false);
    expect(noAuthJson.error).toBe('Unauthorized');

    // Wrong token
    const badTokenResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/articles/search?query=test`,
      { headers: { Authorization: 'Bearer wrong-token' } }
    );
    expect(badTokenResp.status).toBe(401);

    // Valid token via query param
    const queryTokenResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/explorer-tree?token=${encodeURIComponent(loopbackService.getAuthToken())}`
    );
    expect(queryTokenResp.ok).toBe(true);

    // Valid token via X-KBV-Token header
    const headerTokenResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/explorer-tree`,
      { headers: { 'X-KBV-Token': loopbackService.getAuthToken() } }
    );
    expect(headerTokenResp.ok).toBe(true);
  });

  test('reports a clear CLI health failure when the kb binary is missing', async () => {
    const previousBinary = process.env.KBV_KB_CLI_BINARY;
    process.env.KBV_KB_CLI_BINARY = path.join(workspaceRoot, 'missing-kb-binary');

    try {
      cliRuntimeService.applyProcessEnv();
      const health = await cliRuntimeService.checkHealth();
      expect(health.mode).toBe('cli');
      expect(health.ok).toBe(false);
      expect(health.baseUrl).toBe(loopbackService.getBaseUrl());
      expect(health.issues?.some((issue) => issue.includes('binary'))).toBe(true);
      expect(health.failureCode).toBe(CliHealthFailure.BINARY_NOT_FOUND);
    } finally {
      if (previousBinary === undefined) {
        delete process.env.KBV_KB_CLI_BINARY;
      } else {
        process.env.KBV_KB_CLI_BINARY = previousBinary;
      }
    }
  });

  test('reports BINARY_NOT_EXECUTABLE when binary exists but lacks execute permission', async () => {
    if (process.platform === 'win32') {
      test.skip();
      return;
    }

    const fakeBinary = path.join(workspaceRoot, 'kb-no-exec');
    await writeFile(fakeBinary, '#!/bin/sh\necho ok', 'utf8');
    await chmod(fakeBinary, 0o644); // readable but not executable

    const previousBinary = process.env.KBV_KB_CLI_BINARY;
    process.env.KBV_KB_CLI_BINARY = fakeBinary;

    try {
      const health = await cliRuntimeService.checkHealth();
      expect(health.ok).toBe(false);
      expect(health.failureCode).toBe(CliHealthFailure.BINARY_NOT_EXECUTABLE);
      expect(health.issues?.some((issue) => issue.includes('executable'))).toBe(true);
    } finally {
      if (previousBinary === undefined) {
        delete process.env.KBV_KB_CLI_BINARY;
      } else {
        process.env.KBV_KB_CLI_BINARY = previousBinary;
      }
    }
  });

  test('runs the local health probe against the binary and reports probe failure', async () => {
    if (process.platform === 'win32') {
      test.skip();
      return;
    }

    const fakeBinary = path.join(workspaceRoot, 'kb-failing-probe');
    await writeFile(
      fakeBinary,
      '#!/usr/bin/env node\nconsole.error(\"cli probe failed\");\nprocess.exit(1);\n',
      'utf8'
    );
    await chmod(fakeBinary, 0o755);

    const previousBinary = process.env.KBV_KB_CLI_BINARY;
    process.env.KBV_KB_CLI_BINARY = fakeBinary;

    try {
      const health = await cliRuntimeService.checkHealth();
      expect(health.ok).toBe(false);
      expect(health.failureCode).toBe(CliHealthFailure.HEALTH_PROBE_FAILED);
      expect(health.issues?.some((issue) => issue.includes('cli probe failed'))).toBe(true);
    } finally {
      if (previousBinary === undefined) {
        delete process.env.KBV_KB_CLI_BINARY;
      } else {
        process.env.KBV_KB_CLI_BINARY = previousBinary;
      }
    }
  });

  test('reports LOOPBACK_NOT_RUNNING when loopback service is stopped', async () => {
    await loopbackService.stop();

    const health = await cliRuntimeService.checkHealth();
    expect(health.ok).toBe(false);
    expect(health.failureCode).toBe(
      health.issues?.some((i) => i.includes('binary'))
        ? CliHealthFailure.BINARY_NOT_FOUND
        : CliHealthFailure.LOOPBACK_NOT_RUNNING
    );
    expect(health.issues?.some((issue) =>
      issue.includes('not running') || issue.includes('binary')
    )).toBe(true);

    // Restart for afterEach cleanup
    await loopbackService.start();
  });

  test('health endpoint lists all available routes', async () => {
    const baseUrl = loopbackService.getBaseUrl()!;
    const healthResp = await fetch(`${baseUrl}/health`);
    const healthJson = await healthResp.json() as { ok: boolean; availableRoutes: string[] };
    expect(healthJson.ok).toBe(true);

    const expectedRoutes = [
      'GET /health',
      'GET /workspaces/:workspaceId/batches/:batchId/context',
      'GET /workspaces/:workspaceId/batches/:batchId/pbis',
      'GET /workspaces/:workspaceId/articles/search',
      'GET /workspaces/:workspaceId/articles/variants/:localeVariantId',
      'GET /workspaces/:workspaceId/articles/families/:articleFamilyId',
      'GET /workspaces/:workspaceId/articles/history/:localeVariantId',
      'GET /workspaces/:workspaceId/explorer-tree',
      'GET /workspaces/:workspaceId/categories',
      'GET /workspaces/:workspaceId/sections',
      'GET /workspaces/:workspaceId/templates',
      'GET /workspaces/:workspaceId/templates/:templatePackId',
      'GET /workspaces/:workspaceId/pbis/:pbiId',
      'POST /workspaces/:workspaceId/articles/related',
      'POST /workspaces/:workspaceId/proposals/create',
      'POST /workspaces/:workspaceId/proposals/edit',
      'POST /workspaces/:workspaceId/proposals/retire',
      'POST /workspaces/:workspaceId/agent-notes'
    ];

    for (const route of expectedRoutes) {
      expect(healthJson.availableRoutes).toContain(route);
    }
  });

  test('serves batch context and pbi subset routes for loopback batch APIs', async () => {
    const created = await repository.createWorkspace({
      name: 'Batch Loopback Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'workspace-loopback-batch')
    });
    const batch = await repository.createPBIBatch(
      created.id,
      'KB CLI Loopback Batch',
      'cli-batch.csv',
      '/tmp/cli-batch.csv',
      'csv',
      3,
      {
        candidateRowCount: 2,
        malformedRowCount: 1,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 0
      }
    );
    await repository.insertPBIRecords(created.id, batch.id, [
      {
        sourceRowNumber: 1,
        externalId: 'PBI-100',
        title: 'First pbi'
      },
      {
        sourceRowNumber: 2,
        externalId: 'PBI-200',
        title: 'Second pbi',
        validationStatus: 'malformed',
        validationReason: 'missing required field'
      },
      {
        sourceRowNumber: 3,
        externalId: 'PBI-300',
        title: 'Third pbi',
        validationStatus: 'ignored'
      }
    ]);

    const baseUrl = loopbackService.getBaseUrl()!;
    const authHeaders = { Authorization: `Bearer ${loopbackService.getAuthToken()}` };

    const contextResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/batches/${encodeURIComponent(batch.id)}/context`,
      { headers: authHeaders }
    );
    expect(contextResp.ok).toBe(true);
    const contextJson = await contextResp.json() as { ok: boolean; batch: { id: string }; candidateRows: unknown[]; malformedRows: unknown[]; ignoredRows: unknown[] };
    expect(contextJson.ok).toBe(true);
    expect(contextJson.batch.id).toBe(batch.id);
    expect(contextJson.candidateRows).toHaveLength(1);
    expect(contextJson.malformedRows).toHaveLength(1);
    expect(contextJson.ignoredRows).toHaveLength(1);

    const pbisResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/batches/${encodeURIComponent(batch.id)}/pbis?rowNumbers=1,3`,
      { headers: authHeaders }
    );
    expect(pbisResp.ok).toBe(true);
    const pbisJson = await pbisResp.json() as { ok: boolean } & Record<string, unknown>;
    expect(pbisJson.ok).toBe(true);
    const subset = Object.entries(pbisJson)
      .filter(([key]) => /^\d+$/.test(key))
      .map(([, value]) => value as { sourceRowNumber: number });
    expect(subset).toHaveLength(2);
    const rows = subset.map((row) => row.sourceRowNumber).sort();
    expect(rows).toEqual([1, 3]);
  });

  test('returns 404 for unknown routes', async () => {
    const baseUrl = loopbackService.getBaseUrl()!;
    const headers = { Authorization: `Bearer ${loopbackService.getAuthToken()}` };

    const resp = await fetch(
      `${baseUrl}/workspaces/some-id/nonexistent-resource`,
      { headers }
    );
    expect(resp.status).toBe(404);
    const json = await resp.json() as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toContain('No CLI route');
  });
});
