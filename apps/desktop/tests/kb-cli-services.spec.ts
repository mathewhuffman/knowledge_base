import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { AppRoute, CliHealthFailure, TemplatePackType } from '@kb-vault/shared-types';
import { AppWorkingStateService } from '../src/main/services/app-working-state-service';
import { WorkspaceRepository } from '../src/main/services/workspace-repository';
import { KbCliLoopbackService } from '../src/main/services/kb-cli-loopback-service';
import { KbCliRuntimeService } from '../src/main/services/kb-cli-runtime-service';

const execFileAsync = promisify(execFile);

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
    expect(proposalDetail.proposal.rationaleSummary).toContain('Food duplication');
  });
});
