import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { openWorkspaceDatabase } from '@kb-vault/db';
import { AppRoute, CliHealthFailure, TemplatePackType } from '@kb-vault/shared-types';
import { CursorAcpRuntime, type AgentRuntimeToolContext } from '@kb-vault/agent-runtime';
import { AppWorkingStateService } from '../src/main/services/app-working-state-service';
import { applyAppWorkingStatePatch } from '../src/main/services/proposal-working-state';
import { WorkspaceRepository } from '../src/main/services/workspace-repository';
import { KbCliLoopbackService } from '../src/main/services/kb-cli-loopback-service';
import { KbCliRuntimeService } from '../src/main/services/kb-cli-runtime-service';

const execFileAsync = promisify(execFile);

function buildMcpRuntime(
  workspaceRoot: string,
  repository: WorkspaceRepository,
  appWorkingStateService: AppWorkingStateService,
  overrides: Partial<AgentRuntimeToolContext> = {}
): CursorAcpRuntime {
  const toolContext: AgentRuntimeToolContext = {
    searchKb: async () => ({ ok: true, results: [] }),
    getExplorerTree: async () => [],
    getArticle: async () => ({ ok: true }),
    getArticleFamily: async () => ({ ok: true }),
    getLocaleVariant: async (input) => repository.getLocaleVariant(input.workspaceId, input.localeVariantId),
    getAppFormSchema: async (input) => appWorkingStateService.getFormSchema(input),
    patchAppForm: async (input) => applyAppWorkingStatePatch({
      workspaceRepository: repository,
      appWorkingStateService,
      request: input
    }),
    findRelatedArticles: async () => ({ ok: true, results: [] }),
    listCategories: async () => ({ ok: true, categories: [] }),
    listSections: async () => ({ ok: true, sections: [] }),
    listArticleTemplates: async () => ({ ok: true, templates: [] }),
    getTemplate: async () => ({ ok: true }),
    getBatchContext: async (input) => {
      const context = await repository.getBatchContext(input.workspaceId, input.batchId);
      if (!context) {
        throw new Error('batch not found');
      }
      return context;
    },
    getPBI: async (input) => {
      const pbi = await repository.getPBIRecord(input.workspaceId, input.pbiId);
      if (!pbi) {
        throw new Error('pbi not found');
      }
      return pbi;
    },
    getPBISubset: async (input) => repository.getPBISubset(input.workspaceId, input.batchId, input.rowNumbers),
    getArticleHistory: async () => ({ ok: true, revisions: [] }),
    recordAgentNotes: async (input) => repository.recordAgentNotes(input),
    proposeCreateKb: async (input, context) => {
      if (!context.workspaceId) {
        throw new Error('workspaceId is required');
      }
      const batchId = input.batchId || context.batchId || '';
      const sessionId = input.sessionId || context.sessionId || '';
      if (!batchId) {
        throw new Error('batchId is required for create proposal');
      }
      const createdProposal = await repository.createAgentProposal({
        workspaceId: context.workspaceId,
        batchId,
        action: 'create',
        reviewStatus: context.batchId ? 'staged_analysis' : 'pending_review',
        _sessionId: sessionId,
        originPath: 'batch_analysis',
        localeVariantId: input.localeVariantId,
        note: input.note,
        rationale: input.rationale,
        relatedPbiIds: input.pbiIds,
        metadata: input.metadata
      });
      return { ok: true, ...createdProposal };
    },
    proposeEditKb: async () => ({ ok: true }),
    proposeRetireKb: async () => ({ ok: true }),
    ...overrides
  };

  return new CursorAcpRuntime(workspaceRoot, toolContext);
}

async function listMcpTools(runtime: CursorAcpRuntime): Promise<Array<{ name: string; inputSchema?: unknown }>> {
  const raw = await runtime.handleMcpJsonMessage({
    jsonrpc: '2.0',
    id: 'tools-list',
    method: 'tools/list'
  });
  const response = JSON.parse(raw ?? '{}') as { result?: { tools?: Array<{ name: string; inputSchema?: unknown }> } };
  return response.result?.tools ?? [];
}

async function callMcpTool<T>(runtime: CursorAcpRuntime, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await callMcpToolResult<T>(runtime, name, args);
  if (!result.ok) {
    throw new Error(result.error ?? `MCP tool ${name} failed`);
  }
  return result.data as T;
}

async function callMcpToolResult<T>(
  runtime: CursorAcpRuntime,
  name: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const raw = await runtime.handleMcpJsonMessage({
    jsonrpc: '2.0',
    id: `call-${name}`,
    method: 'tools/call',
    params: {
      name,
      arguments: args
    }
  });
  const response = JSON.parse(raw ?? '{}') as { result?: { ok?: boolean; data?: T; error?: string } };
  return {
    ok: Boolean(response.result?.ok),
    data: response.result?.data,
    error: response.result?.error
  };
}

test.describe('kb cli desktop services', () => {
  let workspaceRoot: string;
  let repository: WorkspaceRepository;
  let appWorkingStateService: AppWorkingStateService;
  let loopbackService: KbCliLoopbackService;
  let cliRuntimeService: KbCliRuntimeService;

  test.beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-cli-services-'));
    await mkdir(workspaceRoot, { recursive: true });
    repository = new WorkspaceRepository(workspaceRoot);
    appWorkingStateService = new AppWorkingStateService(() => undefined);
    loopbackService = new KbCliLoopbackService(repository, appWorkingStateService);
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
    const relatedJson = await relatedResp.json() as { ok: boolean; total: number; results: unknown[] };
    expect(relatedJson.ok).toBe(true);
    expect(relatedJson.total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(relatedJson.results)).toBe(true);
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

  test('ignores stale KBV_KB_CLI_BINARY overrides and exposes a single shimmed kb command', async () => {
    const previousBinary = process.env.KBV_KB_CLI_BINARY;
    process.env.KBV_KB_CLI_BINARY = path.join(workspaceRoot, 'stale-kb-binary');

    try {
      cliRuntimeService.applyProcessEnv();
      expect(process.env.KBV_KB_CLI_BINARY).toBeUndefined();

      const binaryPath = cliRuntimeService.resolveBinaryPath();
      expect(binaryPath).toBeTruthy();
      expect(path.basename(binaryPath!)).toContain('kb');

      const env = cliRuntimeService.getEnvironment();
      const firstPathEntry = env.PATH.split(path.delimiter)[0];
      expect(firstPathEntry).toBe(path.dirname(binaryPath!));

      const help = await execFileAsync('kb', ['help', '--json'], {
        env: {
          ...process.env,
          ...env
        }
      });
      const helpJson = JSON.parse(help.stdout) as {
        ok?: boolean;
        command?: string;
        data?: { commands?: string[] };
      };
      expect(helpJson.ok).toBe(true);
      expect(helpJson.command).toBe('help');
      expect(helpJson.data?.commands).toContain('proposal create');
      expect(helpJson.data?.commands).toContain('app patch-form');

      const proposalHelp = await execFileAsync('kb', ['proposal', '--json'], {
        env: {
          ...process.env,
          ...env
        }
      });
      const proposalHelpJson = JSON.parse(proposalHelp.stdout) as {
        ok?: boolean;
        command?: string;
        data?: { subcommands?: string[]; options?: string[]; examples?: string[] };
      };
      expect(proposalHelpJson.ok).toBe(true);
      expect(proposalHelpJson.command).toBe('help');
      expect(proposalHelpJson.data?.subcommands).toContain('create');
      expect(proposalHelpJson.data?.options).toContain('--metadata');
      expect(proposalHelpJson.data?.examples?.[0]).toContain('--metadata');

      const appHelp = await execFileAsync('kb', ['app', '--json'], {
        env: {
          ...process.env,
          ...env
        }
      });
      const appHelpJson = JSON.parse(appHelp.stdout) as {
        ok?: boolean;
        command?: string;
        data?: { subcommands?: string[]; options?: string[] };
      };
      expect(appHelpJson.ok).toBe(true);
      expect(appHelpJson.command).toBe('help');
      expect(appHelpJson.data?.subcommands).toContain('get-form-schema');
      expect(appHelpJson.data?.subcommands).toContain('patch-form');
      expect(appHelpJson.data?.options).toContain('--patch-file');
    } finally {
      if (previousBinary === undefined) {
        delete process.env.KBV_KB_CLI_BINARY;
      } else {
        process.env.KBV_KB_CLI_BINARY = previousBinary;
      }
    }
  });

  test('restarts a stopped loopback service during health checks', async () => {
    await loopbackService.stop();
    expect(loopbackService.isRunning()).toBe(false);

    const health = await cliRuntimeService.checkHealth();
    expect(loopbackService.isRunning()).toBe(true);
    expect(health.ok).toBe(true);
    expect(health.failureCode).toBeUndefined();
    expect(health.message).toBe('CLI access ready');
    expect(health.issues).toEqual([]);

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
      'GET /workspaces/:workspaceId/app/form-schema',
      'GET /workspaces/:workspaceId/pbis/:pbiId',
      'POST /workspaces/:workspaceId/articles/related',
      'POST /workspaces/:workspaceId/app/patch-form',
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

  test('keeps batch context and PBI subset aligned between CLI loopback routes and MCP tools', async () => {
    const created = await repository.createWorkspace({
      name: 'Batch Parity Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'workspace-batch-parity')
    });
    const batch = await repository.createPBIBatch(
      created.id,
      'Batch Parity',
      'batch-parity.csv',
      '/tmp/batch-parity.csv',
      'csv',
      3,
      {
        candidateRowCount: 1,
        malformedRowCount: 1,
        duplicateRowCount: 0,
        ignoredRowCount: 1,
        scopedRowCount: 0
      }
    );
    await repository.insertPBIRecords(created.id, batch.id, [
      {
        sourceRowNumber: 1,
        externalId: 'PBI-201',
        title: 'First candidate',
        validationStatus: 'candidate'
      },
      {
        sourceRowNumber: 2,
        externalId: 'PBI-202',
        title: 'Second malformed',
        validationStatus: 'malformed'
      },
      {
        sourceRowNumber: 3,
        externalId: 'PBI-203',
        title: 'Third ignored',
        validationStatus: 'ignored'
      }
    ]);

    const baseUrl = loopbackService.getBaseUrl()!;
    const headers = { Authorization: `Bearer ${loopbackService.getAuthToken()}` };

    const cliContextResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/batches/${encodeURIComponent(batch.id)}/context`,
      { headers }
    );
    expect(cliContextResp.ok).toBe(true);
    const cliContext = await cliContextResp.json() as {
      ok: boolean;
      batch: { id: string };
      candidateRows: Array<{ sourceRowNumber: number }>;
      malformedRows: Array<{ sourceRowNumber: number }>;
      ignoredRows: Array<{ sourceRowNumber: number }>;
    };
    expect(cliContext.ok).toBe(true);

    const cliSubsetResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(created.id)}/batches/${encodeURIComponent(batch.id)}/pbis?rowNumbers=1,3`,
      { headers }
    );
    expect(cliSubsetResp.ok).toBe(true);
    const cliSubsetJson = await cliSubsetResp.json() as { ok: boolean } & Record<string, unknown>;
    const cliSubsetRows = Object.entries(cliSubsetJson)
      .filter(([key]) => /^\d+$/.test(key))
      .map(([, value]) => value as { sourceRowNumber: number })
      .map((row) => row.sourceRowNumber)
      .sort();

    const runtime = buildMcpRuntime(workspaceRoot, repository, appWorkingStateService);
    try {
      const mcpContext = await callMcpTool<{
        batch: { id: string };
        candidateRows: Array<{ sourceRowNumber: number }>;
        malformedRows: Array<{ sourceRowNumber: number }>;
        ignoredRows: Array<{ sourceRowNumber: number }>;
      }>(runtime, 'get_batch_context', {
        workspaceId: created.id,
        batchId: batch.id
      });

      const mcpSubset = await callMcpTool<Array<{ sourceRowNumber: number }>>(runtime, 'get_pbi_subset', {
        workspaceId: created.id,
        batchId: batch.id,
        rowNumbers: [1, 3]
      });

      expect(mcpContext.batch.id).toBe(cliContext.batch.id);
      expect(mcpContext.candidateRows.map((row) => row.sourceRowNumber)).toEqual(
        cliContext.candidateRows.map((row) => row.sourceRowNumber)
      );
      expect(mcpContext.malformedRows.map((row) => row.sourceRowNumber)).toEqual(
        cliContext.malformedRows.map((row) => row.sourceRowNumber)
      );
      expect(mcpContext.ignoredRows.map((row) => row.sourceRowNumber)).toEqual(
        cliContext.ignoredRows.map((row) => row.sourceRowNumber)
      );
      expect(mcpSubset.map((row) => row.sourceRowNumber).sort()).toEqual(cliSubsetRows);
    } finally {
      await runtime.stop();
    }
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

  test('installs a local kb shim that advertises proposal commands', async () => {
    cliRuntimeService.applyProcessEnv();
    const binaryPath = cliRuntimeService.resolveBinaryPath();
    expect(binaryPath).toBeTruthy();

    const { stdout } = await execFileAsync(binaryPath!, ['help', '--json'], {
      env: {
        ...process.env,
        ...cliRuntimeService.getEnvironment()
      }
    });

    const payload = JSON.parse(stdout) as {
      ok: boolean;
      command: string;
      data: { commands: string[] };
    };
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe('help');
    expect(payload.data.commands).toContain('proposal create');
    expect(payload.data.commands).toContain('proposal edit');
    expect(payload.data.commands).toContain('proposal retire');
    expect(payload.data.commands).toContain('app get-form-schema');
    expect(payload.data.commands).toContain('app patch-form');
  });

  test('builds CLI prompt guidance that pins the shim binary and proposal commands', () => {
    cliRuntimeService.applyProcessEnv();
    const binaryPath = cliRuntimeService.resolveBinaryPath();
    expect(binaryPath).toBeTruthy();

    const promptSuffix = cliRuntimeService.buildPromptSuffix();

    expect(promptSuffix).toContain(`Use this exact KB Vault CLI binary for every command: \`${binaryPath}\``);
    expect(promptSuffix).toContain(`${binaryPath} proposal create --workspace-id <workspace-id> --batch-id <batch-id>`);
    expect(promptSuffix).toContain(`${binaryPath} proposal edit --workspace-id <workspace-id> --batch-id <batch-id>`);
    expect(promptSuffix).toContain(`${binaryPath} proposal retire --workspace-id <workspace-id> --batch-id <batch-id>`);
    expect(promptSuffix).toContain(`${binaryPath} app get-form-schema --workspace-id <workspace-id> --route templates_and_prompts`);
    expect(promptSuffix).toContain(`${binaryPath} app patch-form --workspace-id <workspace-id> --route templates_and_prompts`);
  });

  test('serves form schema and applies validated form patches through loopback and kb shim', async () => {
    const workspaceId = 'workspace-template-patch';
    const templateId = 'template-pack-1';

    appWorkingStateService.register({
      workspaceId,
      route: AppRoute.TEMPLATES_AND_PROMPTS,
      entityType: 'template_pack',
      entityId: templateId,
      versionToken: `seed:${templateId}`,
      currentValues: {
        name: 'Standard How-To',
        language: 'en-us',
        templateType: TemplatePackType.STANDARD_HOW_TO,
        promptTemplate: 'Write a clear how-to.',
        toneRules: 'Be concise.',
        description: 'Base template',
        examples: 'Example body',
        active: true
      }
    });

    const baseUrl = loopbackService.getBaseUrl()!;
    const headers = { Authorization: `Bearer ${loopbackService.getAuthToken()}` };

    const schemaResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/app/form-schema?route=${encodeURIComponent(AppRoute.TEMPLATES_AND_PROMPTS)}&entityType=template_pack&entityId=${encodeURIComponent(templateId)}`,
      { headers }
    );
    expect(schemaResp.ok).toBe(true);
    const schemaJson = await schemaResp.json() as {
      ok: boolean;
      fields: Array<{ key: string }>;
      currentValues: { promptTemplate: string };
      versionToken: string;
    };
    expect(schemaJson.ok).toBe(true);
    expect(schemaJson.fields.some((field) => field.key === 'promptTemplate')).toBe(true);
    expect(schemaJson.currentValues.promptTemplate).toBe('Write a clear how-to.');

    const patchResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/app/patch-form`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          route: AppRoute.TEMPLATES_AND_PROMPTS,
          entityType: 'template_pack',
          entityId: templateId,
          versionToken: schemaJson.versionToken,
          patch: {
            promptTemplate: 'Write a clearer task-focused article.',
            active: false
          }
        })
      }
    );
    expect(patchResp.ok).toBe(true);
    const patchJson = await patchResp.json() as {
      ok: boolean;
      applied: boolean;
      appliedPatch: { promptTemplate: string; active: boolean };
      currentValues: { promptTemplate: string; active: boolean };
    };
    expect(patchJson.ok).toBe(true);
    expect(patchJson.applied).toBe(true);
    expect(patchJson.appliedPatch.promptTemplate).toBe('Write a clearer task-focused article.');
    expect(patchJson.appliedPatch.active).toBe(false);
    expect(patchJson.currentValues?.promptTemplate).toBe('Write a clearer task-focused article.');

    cliRuntimeService.applyProcessEnv();
    const env = {
      ...process.env,
      ...cliRuntimeService.getEnvironment()
    };
    const { stdout: schemaStdout } = await execFileAsync('kb', [
      'app',
      'get-form-schema',
      '--workspace-id',
      workspaceId,
      '--route',
      AppRoute.TEMPLATES_AND_PROMPTS,
      '--entity-type',
      'template_pack',
      '--entity-id',
      templateId,
      '--json'
    ], { env });
    const cliSchema = JSON.parse(schemaStdout) as { ok: boolean; data: { currentValues: { active: boolean } } };
    expect(cliSchema.ok).toBe(true);
    expect(cliSchema.data.currentValues.active).toBe(false);

    const { stdout: patchStdout } = await execFileAsync('kb', [
      'app',
      'patch-form',
      '--workspace-id',
      workspaceId,
      '--route',
      AppRoute.TEMPLATES_AND_PROMPTS,
      '--entity-type',
      'template_pack',
      '--entity-id',
      templateId,
      '--patch',
      JSON.stringify({ toneRules: 'Lead with the direct answer.' }),
      '--json'
    ], { env });
    const cliPatch = JSON.parse(patchStdout) as { ok: boolean; data: { applied: boolean; appliedPatch: { toneRules: string } } };
    expect(cliPatch.ok).toBe(true);
    expect(cliPatch.data.applied).toBe(true);
    expect(cliPatch.data.appliedPatch.toneRules).toBe('Lead with the direct answer.');
  });

  test('keeps template form editing aligned between CLI and MCP transports', async () => {
    const workspaceId = 'workspace-template-parity';
    const templateId = 'template-pack-parity';

    appWorkingStateService.register({
      workspaceId,
      route: AppRoute.TEMPLATES_AND_PROMPTS,
      entityType: 'template_pack',
      entityId: templateId,
      versionToken: `seed:${templateId}`,
      currentValues: {
        name: 'Parity Template',
        language: 'en-us',
        templateType: TemplatePackType.FEATURE_OVERVIEW,
        promptTemplate: 'Explain the feature.',
        toneRules: 'Be concrete.',
        description: 'Template parity baseline',
        examples: 'Example output',
        active: true
      }
    });

    cliRuntimeService.applyProcessEnv();
    const env = {
      ...process.env,
      ...cliRuntimeService.getEnvironment()
    };
    const runtime = buildMcpRuntime(workspaceRoot, repository, appWorkingStateService);

    try {
      const { stdout: cliSchemaStdout } = await execFileAsync('kb', [
        'app',
        'get-form-schema',
        '--workspace-id',
        workspaceId,
        '--route',
        AppRoute.TEMPLATES_AND_PROMPTS,
        '--entity-type',
        'template_pack',
        '--entity-id',
        templateId,
        '--json'
      ], { env });
      const cliSchema = JSON.parse(cliSchemaStdout) as {
        ok: boolean;
        data: { currentValues: { promptTemplate: string; toneRules: string; active: boolean } };
      };
      expect(cliSchema.ok).toBe(true);

      const mcpSchema = await callMcpTool<{
        ok: boolean;
        versionToken: string;
        currentValues: { promptTemplate: string; toneRules: string; active: boolean };
      }>(runtime, 'app_get_form_schema', {
        workspaceId,
        route: AppRoute.TEMPLATES_AND_PROMPTS,
        entityType: 'template_pack',
        entityId: templateId
      });

      expect(mcpSchema.currentValues).toEqual(cliSchema.data.currentValues);

      const { stdout: cliPatchStdout } = await execFileAsync('kb', [
        'app',
        'patch-form',
        '--workspace-id',
        workspaceId,
        '--route',
        AppRoute.TEMPLATES_AND_PROMPTS,
        '--entity-type',
        'template_pack',
        '--entity-id',
        templateId,
        '--patch',
        JSON.stringify({ promptTemplate: 'Lead with user impact.' }),
        '--json'
      ], { env });
      const cliPatch = JSON.parse(cliPatchStdout) as {
        ok: boolean;
        data: { applied: boolean };
      };
      expect(cliPatch.ok).toBe(true);
      expect(cliPatch.data.applied).toBe(true);

      const afterCliPatch = await callMcpTool<{
        ok: boolean;
        versionToken: string;
        currentValues: { promptTemplate: string; toneRules: string; active: boolean };
      }>(runtime, 'app_get_form_schema', {
        workspaceId,
        route: AppRoute.TEMPLATES_AND_PROMPTS,
        entityType: 'template_pack',
        entityId: templateId
      });
      expect(afterCliPatch.currentValues.promptTemplate).toBe('Lead with user impact.');

      const mcpPatch = await callMcpTool<{
        ok: boolean;
        applied: boolean;
        currentValues: { promptTemplate: string; toneRules: string; active: boolean };
      }>(runtime, 'app_patch_form', {
        workspaceId,
        route: AppRoute.TEMPLATES_AND_PROMPTS,
        entityType: 'template_pack',
        entityId: templateId,
        versionToken: afterCliPatch.versionToken,
        patch: {
          toneRules: 'Answer directly first.',
          active: false
        }
      });
      expect(mcpPatch.ok).toBe(true);
      expect(mcpPatch.applied).toBe(true);

      const { stdout: cliSchemaAfterStdout } = await execFileAsync('kb', [
        'app',
        'get-form-schema',
        '--workspace-id',
        workspaceId,
        '--route',
        AppRoute.TEMPLATES_AND_PROMPTS,
        '--entity-type',
        'template_pack',
        '--entity-id',
        templateId,
        '--json'
      ], { env });
      const cliSchemaAfter = JSON.parse(cliSchemaAfterStdout) as {
        ok: boolean;
        data: { currentValues: { promptTemplate: string; toneRules: string; active: boolean } };
      };

      expect(cliSchemaAfter.ok).toBe(true);
      expect(cliSchemaAfter.data.currentValues).toMatchObject({
        promptTemplate: 'Lead with user impact.',
        toneRules: 'Answer directly first.',
        active: false
      });
    } finally {
      await runtime.stop();
    }
  });

  test('persists proposal review form patches through loopback and the kb shim', async () => {
    const created = await repository.createWorkspace({
      name: 'Proposal Patch Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'workspace-proposal-patch')
    });
    const batch = await repository.createPBIBatch(
      created.id,
      'Proposal Patch Batch',
      'proposal-patch.csv',
      '/tmp/proposal-patch.csv',
      'csv',
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 0
      }
    );

    const proposal = await repository.createAgentProposal({
      workspaceId: created.id,
      batchId: batch.id,
      action: 'edit',
      targetTitle: 'Create & Edit Chat Channels',
      targetLocale: 'en-us',
      confidenceScore: 0.84,
      rationaleSummary: 'Update the assignment flow for the dashboard release.',
      aiNotes: 'Existing proposal notes.',
      sourceHtml: '<h1>Create & Edit Chat Channels</h1><p>Old assignment flow.</p>',
      proposedHtml: '<h1>Create & Edit Chat Channels</h1><p>Draft dashboard assignment flow.</p>'
    });
    const detail = await repository.getProposalReviewDetail(created.id, proposal.id);

    appWorkingStateService.register({
      workspaceId: created.id,
      route: AppRoute.PROPOSAL_REVIEW,
      entityType: 'proposal',
      entityId: proposal.id,
      versionToken: `seed:${proposal.id}`,
      currentValues: {
        html: detail.diff.afterHtml,
        title: detail.proposal.targetTitle ?? '',
        rationale: '',
        rationaleSummary: detail.proposal.rationaleSummary ?? '',
        aiNotes: detail.proposal.aiNotes ?? ''
      }
    });

    cliRuntimeService.applyProcessEnv();
    const env = {
      ...process.env,
      ...cliRuntimeService.getEnvironment()
    };

    const { stdout } = await execFileAsync('kb', [
      'app',
      'patch-form',
      '--workspace-id',
      created.id,
      '--route',
      AppRoute.PROPOSAL_REVIEW,
      '--entity-type',
      'proposal',
      '--entity-id',
      proposal.id,
      '--patch',
      JSON.stringify({
        title: 'Create & Edit Chat Channels (Dashboard Update)',
        rationaleSummary: 'Clarified the dashboard-specific assignment changes.',
        aiNotes: 'Assistant tightened the rationale and refreshed the proposed copy.',
        html: '<h1>Create & Edit Chat Channels (Dashboard Update)</h1><p>Updated dashboard assignment flow.</p>'
      }),
      '--json'
    ], { env });
    const cliPatch = JSON.parse(stdout) as {
      ok: boolean;
      data: {
        applied: boolean;
        currentValues?: { title?: string; rationaleSummary?: string; aiNotes?: string };
      };
    };

    expect(cliPatch.ok).toBe(true);
    expect(cliPatch.data.applied).toBe(true);
    expect(cliPatch.data.currentValues?.title).toBe('Create & Edit Chat Channels (Dashboard Update)');

    const refreshed = await repository.getProposalReviewDetail(created.id, proposal.id);
    expect(refreshed.proposal.targetTitle).toBe('Create & Edit Chat Channels (Dashboard Update)');
    expect(refreshed.proposal.rationaleSummary).toBe('Clarified the dashboard-specific assignment changes.');
    expect(refreshed.proposal.aiNotes).toBe('Assistant tightened the rationale and refreshed the proposed copy.');
    expect(refreshed.diff.afterHtml).toContain('Updated dashboard assignment flow.');
  });

  test('keeps proposal review editing aligned between CLI and MCP transports', async () => {
    const created = await repository.createWorkspace({
      name: 'Proposal Parity Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'workspace-proposal-parity')
    });
    const batch = await repository.createPBIBatch(
      created.id,
      'Proposal Parity Batch',
      'proposal-parity.csv',
      '/tmp/proposal-parity.csv',
      'csv',
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 0
      }
    );
    const proposal = await repository.createAgentProposal({
      workspaceId: created.id,
      batchId: batch.id,
      action: 'edit',
      targetTitle: 'Parity Proposal',
      rationaleSummary: 'Original summary.',
      aiNotes: 'Original notes.',
      sourceHtml: '<h1>Parity Proposal</h1><p>Before.</p>',
      proposedHtml: '<h1>Parity Proposal</h1><p>Initial draft.</p>'
    });
    const detail = await repository.getProposalReviewDetail(created.id, proposal.id);

    appWorkingStateService.register({
      workspaceId: created.id,
      route: AppRoute.PROPOSAL_REVIEW,
      entityType: 'proposal',
      entityId: proposal.id,
      versionToken: `seed:${proposal.id}`,
      currentValues: {
        html: detail.diff.afterHtml,
        title: detail.proposal.targetTitle ?? '',
        rationale: '',
        rationaleSummary: detail.proposal.rationaleSummary ?? '',
        aiNotes: detail.proposal.aiNotes ?? ''
      }
    });

    cliRuntimeService.applyProcessEnv();
    const env = {
      ...process.env,
      ...cliRuntimeService.getEnvironment()
    };
    const runtime = buildMcpRuntime(workspaceRoot, repository, appWorkingStateService);

    try {
      const { stdout: cliSchemaStdout } = await execFileAsync('kb', [
        'app',
        'get-form-schema',
        '--workspace-id',
        created.id,
        '--route',
        AppRoute.PROPOSAL_REVIEW,
        '--entity-type',
        'proposal',
        '--entity-id',
        proposal.id,
        '--json'
      ], { env });
      const cliSchema = JSON.parse(cliSchemaStdout) as {
        ok: boolean;
        data: { currentValues: { title: string; rationaleSummary: string; aiNotes: string } };
      };
      expect(cliSchema.ok).toBe(true);

      const mcpSchema = await callMcpTool<{
        ok: boolean;
        versionToken: string;
        currentValues: { title: string; rationaleSummary: string; aiNotes: string };
      }>(runtime, 'app_get_form_schema', {
        workspaceId: created.id,
        route: AppRoute.PROPOSAL_REVIEW,
        entityType: 'proposal',
        entityId: proposal.id
      });
      expect(mcpSchema.currentValues).toEqual(cliSchema.data.currentValues);

      const { stdout: cliPatchStdout } = await execFileAsync('kb', [
        'app',
        'patch-form',
        '--workspace-id',
        created.id,
        '--route',
        AppRoute.PROPOSAL_REVIEW,
        '--entity-type',
        'proposal',
        '--entity-id',
        proposal.id,
        '--patch',
        JSON.stringify({
          title: 'Parity Proposal (CLI)',
          rationaleSummary: 'CLI updated the summary.',
          aiNotes: 'CLI updated the notes.',
          html: '<h1>Parity Proposal (CLI)</h1><p>CLI updated draft.</p>'
        }),
        '--json'
      ], { env });
      const cliPatch = JSON.parse(cliPatchStdout) as {
        ok: boolean;
        data: { applied: boolean };
      };
      expect(cliPatch.ok).toBe(true);
      expect(cliPatch.data.applied).toBe(true);

      const afterCliPatch = await callMcpTool<{
        ok: boolean;
        versionToken: string;
        currentValues: { title: string; rationaleSummary: string; aiNotes: string };
      }>(runtime, 'app_get_form_schema', {
        workspaceId: created.id,
        route: AppRoute.PROPOSAL_REVIEW,
        entityType: 'proposal',
        entityId: proposal.id
      });
      expect(afterCliPatch.currentValues.title).toBe('Parity Proposal (CLI)');

      const mcpPatch = await callMcpTool<{
        ok: boolean;
        applied: boolean;
        currentValues: { title: string; rationaleSummary: string; aiNotes: string };
      }>(runtime, 'app_patch_form', {
        workspaceId: created.id,
        route: AppRoute.PROPOSAL_REVIEW,
        entityType: 'proposal',
        entityId: proposal.id,
        versionToken: afterCliPatch.versionToken,
        patch: {
          title: 'Parity Proposal (MCP)',
          rationaleSummary: 'MCP updated the summary.',
          aiNotes: 'MCP updated the notes.',
          html: '<h1>Parity Proposal (MCP)</h1><p>MCP updated draft.</p>'
        }
      });
      expect(mcpPatch.ok).toBe(true);
      expect(mcpPatch.applied).toBe(true);

      const { stdout: cliSchemaAfterStdout } = await execFileAsync('kb', [
        'app',
        'get-form-schema',
        '--workspace-id',
        created.id,
        '--route',
        AppRoute.PROPOSAL_REVIEW,
        '--entity-type',
        'proposal',
        '--entity-id',
        proposal.id,
        '--json'
      ], { env });
      const cliSchemaAfter = JSON.parse(cliSchemaAfterStdout) as {
        ok: boolean;
        data: { currentValues: { title: string; rationaleSummary: string; aiNotes: string } };
      };
      expect(cliSchemaAfter.ok).toBe(true);
      expect(cliSchemaAfter.data.currentValues).toMatchObject({
        title: 'Parity Proposal (MCP)',
        rationaleSummary: 'MCP updated the summary.',
        aiNotes: 'MCP updated the notes.'
      });

      const refreshed = await repository.getProposalReviewDetail(created.id, proposal.id);
      expect(refreshed.proposal.targetTitle).toBe('Parity Proposal (MCP)');
      expect(refreshed.proposal.rationaleSummary).toBe('MCP updated the summary.');
      expect(refreshed.proposal.aiNotes).toBe('MCP updated the notes.');
      expect(refreshed.diff.afterHtml).toContain('MCP updated draft.');
    } finally {
      await runtime.stop();
    }
  });

  test('discovers app working-state MCP tools through the direct bridge and can call them', async () => {
    const workspaceId = 'workspace-mcp-bridge';
    const templateId = 'template-pack-bridge';
    appWorkingStateService.register({
      workspaceId,
      route: AppRoute.TEMPLATES_AND_PROMPTS,
      entityType: 'template_pack',
      entityId: templateId,
      versionToken: `seed:${templateId}`,
      currentValues: {
        name: 'Bridge Template',
        language: 'en-us',
        templateType: TemplatePackType.STANDARD_HOW_TO,
        promptTemplate: 'Bridge prompt.',
        toneRules: 'Bridge tone.',
        description: '',
        examples: '',
        active: true
      }
    });

    const runtime = buildMcpRuntime(workspaceRoot, repository, appWorkingStateService);

    try {
      const tools = await listMcpTools(runtime);
      const schemaTool = tools.find((tool) => tool.name === 'app_get_form_schema');
      const patchTool = tools.find((tool) => tool.name === 'app_patch_form');

      expect(schemaTool).toBeTruthy();
      expect(schemaTool?.inputSchema).toMatchObject({
        type: 'object',
        required: ['workspaceId', 'route', 'entityType', 'entityId']
      });
      expect(patchTool).toBeTruthy();
      expect(patchTool?.inputSchema).toMatchObject({
        type: 'object',
        required: ['workspaceId', 'route', 'entityType', 'entityId', 'patch']
      });

      const schema = await callMcpTool<{
        ok: boolean;
        entityId: string;
        currentValues: { promptTemplate: string };
      }>(runtime, 'app_get_form_schema', {
        workspaceId,
        route: AppRoute.TEMPLATES_AND_PROMPTS,
        entityType: 'template_pack',
        entityId: templateId
      });
      expect(schema.ok).toBe(true);
      expect(schema.entityId).toBe(templateId);
      expect(schema.currentValues.promptTemplate).toBe('Bridge prompt.');
    } finally {
      await runtime.stop();
    }
  });

  test('speaks MCP lifecycle and returns spec-compatible tool payloads', async () => {
    const workspace = await repository.createWorkspace({
      name: 'MCP Lifecycle Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'mcp-lifecycle-workspace')
    });

    const runtime = buildMcpRuntime(workspaceRoot, repository, appWorkingStateService);

    try {
      const initializeRaw = await runtime.handleMcpJsonMessage({
        jsonrpc: '2.0',
        id: 'init-mcp',
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: {
            name: 'kb-vault-test-client',
            version: '1.0.0'
          }
        }
      });
      const initializeResponse = JSON.parse(initializeRaw ?? '{}') as {
        result?: {
          protocolVersion?: string;
          capabilities?: { tools?: { listChanged?: boolean } };
          serverInfo?: { name?: string; title?: string; version?: string };
          instructions?: string;
        };
      };

      expect(initializeResponse.result?.protocolVersion).toBe('2025-06-18');
      expect(initializeResponse.result?.capabilities?.tools?.listChanged).toBe(false);
      expect(initializeResponse.result?.serverInfo).toMatchObject({
        name: 'kb-vault-mcp',
        title: 'KB Vault MCP Bridge',
        version: '0.1.0'
      });
      expect(initializeResponse.result?.instructions).toContain('direct KB Vault tools');

      const initializedRaw = await runtime.handleMcpJsonMessage({
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      });
      expect(initializedRaw).toBeNull();

      const tools = await listMcpTools(runtime);
      expect(tools.find((tool) => tool.name === 'record_agent_notes')).toMatchObject({
        inputSchema: {
          type: 'object'
        }
      });

      const toolCallRaw = await runtime.handleMcpJsonMessage({
        jsonrpc: '2.0',
        id: 'call-record-agent-notes',
        method: 'tools/call',
        params: {
          name: 'record_agent_notes',
          arguments: {
            workspaceId: workspace.id,
            note: 'Lifecycle note for MCP bridge test.'
          }
        }
      });
      const toolCallResponse = JSON.parse(toolCallRaw ?? '{}') as {
        result?: {
          content?: Array<{ type?: string; text?: string }>;
          structuredContent?: {
            ok?: boolean;
            data?: { workspaceId?: string; recorded?: boolean; note?: string };
          };
          ok?: boolean;
          data?: { workspaceId?: string; recorded?: boolean; note?: string };
        };
      };

      expect(toolCallResponse.result?.content?.[0]).toMatchObject({
        type: 'text'
      });
      expect(toolCallResponse.result?.content?.[0]?.text).toContain('Lifecycle note for MCP bridge test.');
      expect(toolCallResponse.result?.structuredContent).toMatchObject({
        ok: true,
        data: {
          workspaceId: workspace.id,
          recorded: true,
          note: 'Lifecycle note for MCP bridge test.'
        }
      });
      expect(toolCallResponse.result?.ok).toBe(true);
      expect(toolCallResponse.result?.data).toMatchObject({
        workspaceId: workspace.id,
        recorded: true,
        note: 'Lifecycle note for MCP bridge test.'
      });
    } finally {
      await runtime.stop();
    }
  });

  test('publishes complete MCP schemas and rejects invalid inputs before handlers run', async () => {
    let getLocaleVariantCalls = 0;
    const runtime = buildMcpRuntime(workspaceRoot, repository, appWorkingStateService, {
      getLocaleVariant: async () => {
        getLocaleVariantCalls += 1;
        return { ok: true };
      }
    });

    try {
      const tools = await listMcpTools(runtime);
      expect(tools.find((tool) => tool.name === 'search_kb')?.inputSchema).toMatchObject({
        type: 'object',
        required: ['workspaceId']
      });
      expect(tools.find((tool) => tool.name === 'get_locale_variant')?.inputSchema).toMatchObject({
        type: 'object',
        required: ['workspaceId', 'localeVariantId']
      });
      expect(tools.find((tool) => tool.name === 'record_agent_notes')?.inputSchema).toMatchObject({
        type: 'object',
        required: ['workspaceId', 'note']
      });

      const invalidLocaleVariant = await callMcpToolResult(runtime, 'get_locale_variant', {
        workspaceId: 'workspace-schema-test'
      });
      expect(invalidLocaleVariant.ok).toBe(false);
      expect(invalidLocaleVariant.error).toContain('localeVariantId is required');
      expect(getLocaleVariantCalls).toBe(0);

      const invalidSearch = await callMcpToolResult(runtime, 'search_kb', {
        workspaceId: 'workspace-schema-test'
      });
      expect(invalidSearch.ok).toBe(false);
      expect(invalidSearch.error).toContain('allowed input shape');

      const invalidSubset = await callMcpToolResult(runtime, 'get_pbi_subset', {
        workspaceId: 'workspace-schema-test',
        batchId: 'batch-schema-test',
        rowNumbers: ['first-row']
      });
      expect(invalidSubset.ok).toBe(false);
      expect(invalidSubset.error).toContain('rowNumbers[0] must be integer');
    } finally {
      await runtime.stop();
    }
  });

  test('persists record_agent_notes through MCP', async () => {
    const workspace = await repository.createWorkspace({
      name: 'Agent Notes Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'agent-notes-workspace')
    });

    const runtime = buildMcpRuntime(workspaceRoot, repository, appWorkingStateService);

    try {
      const recorded = await callMcpTool<{
        ok: boolean;
        workspaceId: string;
        noteId: string;
        recorded: boolean;
        note: string;
        metadata?: { source: string };
        pbiIds: string[];
        createdAtUtc: string;
      }>(runtime, 'record_agent_notes', {
        workspaceId: workspace.id,
        sessionId: 'session-agent-notes',
        batchId: 'batch-agent-notes',
        note: 'Captured a bridge-readiness follow-up for later review.',
        rationale: 'Keep the MCP preflight details on the batch timeline.',
        metadata: { source: 'mcp-test' },
        pbiIds: ['pbi-1', 'pbi-2']
      });

      expect(recorded.ok).toBe(true);
      expect(recorded.recorded).toBe(true);
      expect(recorded.note).toContain('bridge-readiness');
      expect(recorded.pbiIds).toEqual(['pbi-1', 'pbi-2']);
      expect(recorded.metadata).toEqual({ source: 'mcp-test' });

      const db = openWorkspaceDatabase(path.join(workspace.path, '.meta', 'kb-vault.sqlite'));
      try {
        const row = db.get<{
          workspaceId: string;
          sessionId: string | null;
          batchId: string | null;
          note: string;
          rationale: string | null;
          metadataJson: string | null;
          pbiIdsJson: string | null;
        }>(
          `SELECT
             workspace_id as workspaceId,
             session_id as sessionId,
             batch_id as batchId,
             note,
             rationale,
             metadata_json as metadataJson,
             pbi_ids_json as pbiIdsJson
           FROM agent_notes
           WHERE id = @id`,
          { id: recorded.noteId }
        );

        expect(row?.workspaceId).toBe(workspace.id);
        expect(row?.sessionId).toBe('session-agent-notes');
        expect(row?.batchId).toBe('batch-agent-notes');
        expect(row?.note).toBe('Captured a bridge-readiness follow-up for later review.');
        expect(row?.rationale).toBe('Keep the MCP preflight details on the batch timeline.');
        expect(JSON.parse(row?.metadataJson ?? '{}')).toEqual({ source: 'mcp-test' });
        expect(JSON.parse(row?.pbiIdsJson ?? '[]')).toEqual(['pbi-1', 'pbi-2']);
      } finally {
        db.close();
      }
    } finally {
      await runtime.stop();
    }
  });

  test('reads template form schema through MCP', async () => {
    const workspaceId = 'workspace-template-mcp-schema';
    const templateId = 'template-pack-mcp-schema';
    appWorkingStateService.register({
      workspaceId,
      route: AppRoute.TEMPLATES_AND_PROMPTS,
      entityType: 'template_pack',
      entityId: templateId,
      versionToken: `seed:${templateId}`,
      currentValues: {
        name: 'Troubleshooting',
        language: 'en-us',
        templateType: TemplatePackType.TROUBLESHOOTING,
        promptTemplate: 'Start with the symptom.',
        toneRules: 'Be direct.',
        description: 'Troubleshooting template',
        examples: '',
        active: true
      }
    });

    const runtime = buildMcpRuntime(workspaceRoot, repository, appWorkingStateService);
    try {
      const schema = await callMcpTool<{
        ok: boolean;
        entityId: string;
        fields: Array<{ key: string }>;
        currentValues: { promptTemplate: string };
      }>(runtime, 'app_get_form_schema', {
        workspaceId,
        route: AppRoute.TEMPLATES_AND_PROMPTS,
        entityType: 'template_pack',
        entityId: templateId
      });

      expect(schema.ok).toBe(true);
      expect(schema.entityId).toBe(templateId);
      expect(schema.fields.some((field) => field.key === 'promptTemplate')).toBe(true);
      expect(schema.currentValues.promptTemplate).toBe('Start with the symptom.');
    } finally {
      await runtime.stop();
    }
  });

  test('applies template form patches through MCP', async () => {
    const workspaceId = 'workspace-template-mcp-patch';
    const templateId = 'template-pack-mcp-patch';
    appWorkingStateService.register({
      workspaceId,
      route: AppRoute.TEMPLATES_AND_PROMPTS,
      entityType: 'template_pack',
      entityId: templateId,
      versionToken: `seed:${templateId}`,
      currentValues: {
        name: 'Feature Overview',
        language: 'en-us',
        templateType: TemplatePackType.FEATURE_OVERVIEW,
        promptTemplate: 'Explain the feature.',
        toneRules: 'Helpful and concise.',
        description: '',
        examples: '',
        active: true
      }
    });

    const runtime = buildMcpRuntime(workspaceRoot, repository, appWorkingStateService);
    try {
      const schema = await callMcpTool<{ versionToken: string }>(runtime, 'app_get_form_schema', {
        workspaceId,
        route: AppRoute.TEMPLATES_AND_PROMPTS,
        entityType: 'template_pack',
        entityId: templateId
      });

      const patched = await callMcpTool<{
        ok: boolean;
        applied: boolean;
        appliedPatch: { promptTemplate: string; active: boolean };
        currentValues: { promptTemplate: string; active: boolean };
      }>(runtime, 'app_patch_form', {
        workspaceId,
        route: AppRoute.TEMPLATES_AND_PROMPTS,
        entityType: 'template_pack',
        entityId: templateId,
        versionToken: schema.versionToken,
        patch: {
          promptTemplate: 'Explain the feature with user impact first.',
          active: false
        }
      });

      expect(patched.ok).toBe(true);
      expect(patched.applied).toBe(true);
      expect(patched.appliedPatch.promptTemplate).toBe('Explain the feature with user impact first.');
      expect(patched.currentValues.active).toBe(false);
    } finally {
      await runtime.stop();
    }
  });

  test('reads proposal review form schema through MCP', async () => {
    const created = await repository.createWorkspace({
      name: 'Proposal MCP Schema Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'workspace-proposal-mcp-schema')
    });
    const batch = await repository.createPBIBatch(
      created.id,
      'Proposal MCP Schema Batch',
      'proposal-mcp-schema.csv',
      '/tmp/proposal-mcp-schema.csv',
      'csv',
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 0
      }
    );
    const proposal = await repository.createAgentProposal({
      workspaceId: created.id,
      batchId: batch.id,
      action: 'edit',
      targetTitle: 'Order Dashboard',
      proposedHtml: '<h1>Order Dashboard</h1><p>Current draft.</p>'
    });
    const detail = await repository.getProposalReviewDetail(created.id, proposal.id);

    appWorkingStateService.register({
      workspaceId: created.id,
      route: AppRoute.PROPOSAL_REVIEW,
      entityType: 'proposal',
      entityId: proposal.id,
      versionToken: `seed:${proposal.id}`,
      currentValues: {
        html: detail.diff.afterHtml,
        title: detail.proposal.targetTitle ?? '',
        rationale: '',
        rationaleSummary: detail.proposal.rationaleSummary ?? '',
        aiNotes: detail.proposal.aiNotes ?? ''
      }
    });

    const runtime = buildMcpRuntime(workspaceRoot, repository, appWorkingStateService);
    try {
      const schema = await callMcpTool<{
        ok: boolean;
        entityId: string;
        fields: Array<{ key: string }>;
        currentValues: { title: string };
      }>(runtime, 'app_get_form_schema', {
        workspaceId: created.id,
        route: AppRoute.PROPOSAL_REVIEW,
        entityType: 'proposal',
        entityId: proposal.id
      });

      expect(schema.ok).toBe(true);
      expect(schema.entityId).toBe(proposal.id);
      expect(schema.fields.some((field) => field.key === 'html')).toBe(true);
      expect(schema.currentValues.title).toBe('Order Dashboard');
    } finally {
      await runtime.stop();
    }
  });

  test('persists proposal review form patches through MCP', async () => {
    const created = await repository.createWorkspace({
      name: 'Proposal MCP Patch Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'workspace-proposal-mcp-patch')
    });
    const batch = await repository.createPBIBatch(
      created.id,
      'Proposal MCP Patch Batch',
      'proposal-mcp-patch.csv',
      '/tmp/proposal-mcp-patch.csv',
      'csv',
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 0
      }
    );

    const proposal = await repository.createAgentProposal({
      workspaceId: created.id,
      batchId: batch.id,
      action: 'edit',
      targetTitle: 'Agent Inbox',
      rationaleSummary: 'Initial summary.',
      aiNotes: 'Initial notes.',
      proposedHtml: '<h1>Agent Inbox</h1><p>Initial draft.</p>'
    });
    const detail = await repository.getProposalReviewDetail(created.id, proposal.id);

    appWorkingStateService.register({
      workspaceId: created.id,
      route: AppRoute.PROPOSAL_REVIEW,
      entityType: 'proposal',
      entityId: proposal.id,
      versionToken: `seed:${proposal.id}`,
      currentValues: {
        html: detail.diff.afterHtml,
        title: detail.proposal.targetTitle ?? '',
        rationale: '',
        rationaleSummary: detail.proposal.rationaleSummary ?? '',
        aiNotes: detail.proposal.aiNotes ?? ''
      }
    });

    const runtime = buildMcpRuntime(workspaceRoot, repository, appWorkingStateService);
    try {
      const schema = await callMcpTool<{ versionToken: string }>(runtime, 'app_get_form_schema', {
        workspaceId: created.id,
        route: AppRoute.PROPOSAL_REVIEW,
        entityType: 'proposal',
        entityId: proposal.id
      });

      const patched = await callMcpTool<{
        ok: boolean;
        applied: boolean;
        currentValues: { title: string; rationaleSummary: string; aiNotes: string };
      }>(runtime, 'app_patch_form', {
        workspaceId: created.id,
        route: AppRoute.PROPOSAL_REVIEW,
        entityType: 'proposal',
        entityId: proposal.id,
        versionToken: schema.versionToken,
        patch: {
          title: 'Agent Inbox (Updated)',
          rationaleSummary: 'Updated the inbox behavior summary.',
          aiNotes: 'Refined the proposal notes through MCP.',
          html: '<h1>Agent Inbox (Updated)</h1><p>MCP updated draft.</p>'
        }
      });

      expect(patched.ok).toBe(true);
      expect(patched.applied).toBe(true);
      expect(patched.currentValues.title).toBe('Agent Inbox (Updated)');

      const refreshed = await repository.getProposalReviewDetail(created.id, proposal.id);
      expect(refreshed.proposal.targetTitle).toBe('Agent Inbox (Updated)');
      expect(refreshed.proposal.rationaleSummary).toBe('Updated the inbox behavior summary.');
      expect(refreshed.proposal.aiNotes).toBe('Refined the proposal notes through MCP.');
      expect(refreshed.diff.afterHtml).toContain('MCP updated draft.');
    } finally {
      await runtime.stop();
    }
  });

  test('rejects stale versions and unknown keys for form patches', async () => {
    const workspaceId = 'workspace-template-validation';

    appWorkingStateService.register({
      workspaceId,
      route: AppRoute.TEMPLATES_AND_PROMPTS,
      entityType: 'template_pack',
      entityId: 'template-1',
      versionToken: 'current-token',
      currentValues: {
        name: 'Template One',
        language: 'en-us',
        templateType: TemplatePackType.STANDARD_HOW_TO,
        promptTemplate: 'Prompt',
        toneRules: 'Tone',
        description: '',
        examples: '',
        active: true
      }
    });

    const baseUrl = loopbackService.getBaseUrl()!;
    const headers = {
      Authorization: `Bearer ${loopbackService.getAuthToken()}`,
      'content-type': 'application/json'
    };

    const staleResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/app/patch-form`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          route: AppRoute.TEMPLATES_AND_PROMPTS,
          entityType: 'template_pack',
          entityId: 'template-1',
          versionToken: 'stale-token',
          patch: { promptTemplate: 'Updated prompt' }
        })
      }
    );
    expect(staleResp.status).toBe(409);
    const staleJson = await staleResp.json() as { ok: boolean; validationErrors: Array<{ key?: string }> };
    expect(staleJson.ok).toBe(false);
    expect(staleJson.validationErrors[0]?.key).toBe('versionToken');

    const invalidResp = await fetch(
      `${baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/app/patch-form`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          route: AppRoute.TEMPLATES_AND_PROMPTS,
          entityType: 'template_pack',
          entityId: 'template-1',
          patch: { unsupportedField: 'nope' }
        })
      }
    );
    expect(invalidResp.status).toBe(409);
    const invalidJson = await invalidResp.json() as { ok: boolean; validationErrors: Array<{ key?: string }> };
    expect(invalidJson.ok).toBe(false);
    expect(invalidJson.validationErrors[0]?.key).toBe('unsupportedField');
  });

  test('creates proposal review records through the local kb shim', async () => {
    const created = await repository.createWorkspace({
      name: 'Proposal CLI Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'workspace-cli-proposals')
    });
    const batch = await repository.createPBIBatch(
      created.id,
      'Proposal Batch',
      'proposal-batch.csv',
      '/tmp/proposal-batch.csv',
      'csv',
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 0
      }
    );

    cliRuntimeService.applyProcessEnv();
    const binaryPath = cliRuntimeService.resolveBinaryPath();
    expect(binaryPath).toBeTruthy();

    const { stdout } = await execFileAsync(
      binaryPath!,
      [
        'proposal',
        'create',
        '--workspace-id',
        created.id,
        '--batch-id',
        batch.id,
        '--session-id',
        'session-proposal-cli',
        '--note',
        'Create a dedicated food list duplicate article',
        '--rationale',
        'Food duplication is covered only conceptually today.',
        '--metadata',
        '{"targetTitle":"Duplicate Food Lists and Food Items (Portal)","confidenceScore":0.77}',
        '--json'
      ],
      {
        env: {
          ...process.env,
          ...cliRuntimeService.getEnvironment()
        }
      }
    );

    const payload = JSON.parse(stdout) as {
      ok: boolean;
      command: string;
      data: { ok: boolean; id: string; batchId: string; action: string; reviewStatus: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe('proposal create');
    expect(payload.data.ok).toBe(true);
    expect(payload.data.batchId).toBe(batch.id);
    expect(payload.data.action).toBe('create');
    expect(payload.data.reviewStatus).toBe('pending_review');

    const proposals = await repository.listProposalReviewQueue(created.id, batch.id);
    expect(proposals.queue).toHaveLength(1);
    expect(proposals.queue[0]?.action).toBe('create');
    expect(proposals.queue[0]?.reviewStatus).toBe('pending_review');

    const proposalDetail = await repository.getProposalReviewDetail(created.id, payload.data.id);
    expect(proposalDetail.proposal.action).toBe('create');
    expect(proposalDetail.proposal.reviewStatus).toBe('pending_review');
    expect(proposalDetail.proposal.confidenceScore).toBe(0.77);
    expect(proposalDetail.proposal.rationaleSummary).toContain('Food duplication');
  });

  test('creates article proposals with matching review records through CLI and MCP transports', async () => {
    const created = await repository.createWorkspace({
      name: 'Proposal Transport Parity Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us'],
      path: path.join(workspaceRoot, 'workspace-proposal-transport-parity')
    });
    const batch = await repository.createPBIBatch(
      created.id,
      'Proposal Transport Parity Batch',
      'proposal-transport-parity.csv',
      '/tmp/proposal-transport-parity.csv',
      'csv',
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 0
      }
    );

    cliRuntimeService.applyProcessEnv();
    const binaryPath = cliRuntimeService.resolveBinaryPath();
    expect(binaryPath).toBeTruthy();

    const { stdout } = await execFileAsync(
      binaryPath!,
      [
        'proposal',
        'create',
        '--workspace-id',
        created.id,
        '--batch-id',
        batch.id,
        '--session-id',
        'session-proposal-cli-parity',
        '--note',
        'Create a dedicated duplicate foods article',
        '--rationale',
        'Duplicate food guidance needs its own workflow article.',
        '--metadata',
        '{"targetTitle":"Duplicate Food Lists and Food Items (Portal)","confidenceScore":0.77}',
        '--json'
      ],
      {
        env: {
          ...process.env,
          ...cliRuntimeService.getEnvironment()
        }
      }
    );

    const cliPayload = JSON.parse(stdout) as {
      ok: boolean;
      data: { id: string; batchId: string; action: string; reviewStatus: string };
    };
    expect(cliPayload.ok).toBe(true);

    const runtime = buildMcpRuntime(workspaceRoot, repository, appWorkingStateService);

    try {
      const mcpPayload = await callMcpTool<{
        ok: boolean;
        id: string;
        batchId: string;
        action: string;
        reviewStatus: string;
      }>(runtime, 'propose_create_kb', {
        workspaceId: created.id,
        batchId: batch.id,
        sessionId: 'session-proposal-mcp-parity',
        note: 'Create a dedicated duplicate foods article',
        rationale: 'Duplicate food guidance needs its own workflow article.',
        metadata: {
          targetTitle: 'Duplicate Food Lists and Food Items (Portal)',
          confidenceScore: 0.77
        }
      });

      expect(mcpPayload.ok).toBe(true);
      expect(mcpPayload.batchId).toBe(batch.id);
      expect(mcpPayload.action).toBe('create');
      expect(mcpPayload.reviewStatus).toBe('pending_review');
      expect(mcpPayload.id).toBe(cliPayload.data.id);

      const proposals = await repository.listProposalReviewQueue(created.id, batch.id);
      expect(proposals.queue).toHaveLength(1);
      expect(proposals.queue[0]?.action).toBe('create');
      expect(proposals.queue[0]?.proposalId).toBe(cliPayload.data.id);

      const proposalDetail = await repository.getProposalReviewDetail(created.id, cliPayload.data.id);
      expect(proposalDetail.proposal.targetTitle).toBe('Duplicate Food Lists and Food Items (Portal)');
      expect(proposalDetail.proposal.reviewStatus).toBe('pending_review');
      expect(proposalDetail.proposal.confidenceScore).toBe(0.77);
      expect(proposalDetail.proposal.rationaleSummary).toContain('Duplicate food guidance');
    } finally {
      await runtime.stop();
    }
  });
});
