import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { CursorAcpRuntime, type AgentRuntimeToolContext } from '@kb-vault/agent-runtime';

type LoggedRequest = {
  method: string;
  params?: Record<string, unknown>;
};

function buildToolContext(): AgentRuntimeToolContext {
  return {
    searchKb: async () => ({ ok: true, results: [] }),
    getExplorerTree: async () => [],
    getArticle: async () => ({ ok: true }),
    getArticleFamily: async () => ({ ok: true }),
    getLocaleVariant: async () => ({ ok: true }),
    getAppFormSchema: async () => ({ ok: true, fields: [], currentValues: {} }),
    patchAppForm: async () => ({ ok: true, applied: false, currentValues: {} }),
    findRelatedArticles: async () => ({ ok: true, results: [] }),
    listCategories: async () => ({ ok: true, categories: [] }),
    listSections: async () => ({ ok: true, sections: [] }),
    listArticleTemplates: async () => ({ ok: true, templates: [] }),
    getTemplate: async () => ({ ok: true }),
    getBatchContext: async () => ({ id: 'batch-1', status: 'submitted' }),
    getPBI: async () => ({ id: 'pbi-1' }),
    getPBISubset: async () => ({ rows: [{ id: 'pbi-1', title: 'CLI planner fallback test' }] }),
    getArticleHistory: async () => ({ revisions: [] }),
    recordAgentNotes: async () => ({ ok: true }),
    proposeCreateKb: async () => ({ ok: true }),
    proposeEditKb: async () => ({ ok: true }),
    proposeRetireKb: async () => ({ ok: true })
  };
}

async function createFakeAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-cli-plan-agent');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
const sessionId = 'cli-plan-fallback-session';

function append(entry) {
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\\n', 'utf8');
}

append({ startupArgv: process.argv.slice(2) });

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  const message = JSON.parse(trimmed);
  append({ method: message.method, params: message.params });

  if (message.method === 'initialize' || message.method === 'authenticate') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'session/new') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        sessionId,
        models: {
          currentModelId: 'default[]',
          availableModels: [
            { modelId: 'default[]', name: 'Auto' },
            { modelId: 'gpt-5.4[reasoning=medium,context=272k,fast=false]', name: 'GPT-5.4' }
          ]
        }
      }
    }) + '\\n');
    return;
  }

  if (message.method === 'session/set_model') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'session/prompt') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { text: '{"summary":"ok"}' } }) + '\\n');
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;

  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createInvalidModelAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-cli-invalid-model-agent');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
const sessionId = 'cli-invalid-model-session';

function append(entry) {
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\\n', 'utf8');
}

append({ startupArgv: process.argv.slice(2) });

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  const message = JSON.parse(trimmed);
  append({ method: message.method, params: message.params });

  if (message.method === 'initialize' || message.method === 'authenticate') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'session/new') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        sessionId,
        models: {
          currentModelId: 'default[]',
          availableModels: [
            { modelId: 'default[]', name: 'Auto' },
            { modelId: 'gpt-5.4[reasoning=medium,context=272k,fast=false]', name: 'GPT-5.4' }
          ]
        }
      }
    }) + '\\n');
    return;
  }

  if (message.method === 'session/set_model') {
    const modelId = message.params && typeof message.params === 'object' ? message.params.modelId : undefined;
    if (modelId === 'gpt-5.4[reasoning=medium,context=272k,fast=false]') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
      return;
    }
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: -32602,
        message: 'Invalid params',
        data: {
          message: 'Invalid model value: ' + String(modelId)
        }
      }
    }) + '\\n');
    return;
  }

  if (message.method === 'session/prompt') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { text: '{"summary":"ok"}' } }) + '\\n');
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;

  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}


async function readLoggedRequests(logPath: string): Promise<LoggedRequest[]> {
  const contents = await readFile(logPath, 'utf8');
  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LoggedRequest);
}

test.describe('agent runtime CLI planner mode', () => {
  let tempRoot: string;
  let previousCursorBinary: string | undefined;
  let previousAcpCwd: string | undefined;
  let previousLogPath: string | undefined;

  test.beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-cli-plan-fallback-'));
    previousCursorBinary = process.env.KBV_CURSOR_BINARY;
    previousAcpCwd = process.env.KBV_ACP_CWD;
    previousLogPath = process.env.KBV_TEST_ACP_LOG_PATH;
  });

  test.afterEach(async () => {
    if (previousCursorBinary === undefined) {
      delete process.env.KBV_CURSOR_BINARY;
    } else {
      process.env.KBV_CURSOR_BINARY = previousCursorBinary;
    }
    if (previousAcpCwd === undefined) {
      delete process.env.KBV_ACP_CWD;
    } else {
      process.env.KBV_ACP_CWD = previousAcpCwd;
    }
    if (previousLogPath === undefined) {
      delete process.env.KBV_TEST_ACP_LOG_PATH;
    } else {
      process.env.KBV_TEST_ACP_LOG_PATH = previousLogPath;
    }

    await rm(tempRoot, { recursive: true, force: true });
  });

  test('CLI planner sessions request ACP plan mode', async () => {
    const logPath = path.join(tempRoot, 'cli-plan-fallback-log.jsonl');
    const binaryPath = await createFakeAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());

    try {
      const result = await runtime.runBatchAnalysis(
        {
          workspaceId: 'workspace-1',
          batchId: 'batch-1',
          kbAccessMode: 'cli',
          agentRole: 'planner',
          sessionMode: 'plan'
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');
      expect(runtime.getSession(result.sessionId)?.mode).toBe('plan');

      const requests = await readLoggedRequests(logPath);
      const sessionNewRequest = requests.find((entry) => entry.method === 'session/new');
      expect(sessionNewRequest?.params).toMatchObject({
        config: {
          mode: 'plan'
        }
      });
    } finally {
      await runtime.stop();
    }
  });

  test('stale non-chat sessions are closed before starting a new batch run', async () => {
    const logPath = path.join(tempRoot, 'cli-plan-stale-session-log.jsonl');
    const binaryPath = await createFakeAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());
    const staleSession = runtime.createSession({
      workspaceId: 'workspace-1',
      kbAccessMode: 'cli',
      type: 'batch_analysis',
      mode: 'plan',
      role: 'planner',
      batchId: 'stale-batch'
    });
    staleSession.updatedAtUtc = new Date(Date.now() - (16 * 60 * 1_000)).toISOString();

    try {
      const result = await runtime.runBatchAnalysis(
        {
          workspaceId: 'workspace-1',
          batchId: 'batch-1',
          kbAccessMode: 'cli',
          agentRole: 'planner',
          sessionMode: 'plan'
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');
      const sessions = runtime.listSessions('workspace-1', true);
      expect(sessions.find((session) => session.id === staleSession.id)?.status).toBe('closed');
    } finally {
      await runtime.stop();
    }
  });

  test('selected model is applied through session/set_model instead of startup args', async () => {
    const logPath = path.join(tempRoot, 'cli-plan-model-log.jsonl');
    const binaryPath = await createFakeAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());
    await runtime.setWorkspaceAgentModel('workspace-1', 'gpt-5.4[reasoning=medium,context=272k,fast=false]');

    try {
      const result = await runtime.runBatchAnalysis(
        {
          workspaceId: 'workspace-1',
          batchId: 'batch-1',
          kbAccessMode: 'cli',
          agentRole: 'planner',
          sessionMode: 'plan'
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');

      const requests = await readLoggedRequests(logPath);
      const startup = requests.find((entry) => Object.prototype.hasOwnProperty.call(entry, 'startupArgv')) as { startupArgv?: string[] } | undefined;
      const setModelRequest = requests.find((entry) => entry.method === 'session/set_model');

      expect(startup?.startupArgv ?? []).not.toContain('--model');
      expect(setModelRequest?.params).toMatchObject({
        modelId: 'gpt-5.4[reasoning=medium,context=272k,fast=false]'
      });
    } finally {
      await runtime.stop();
    }
  });

  test('invalid ACP models do not trigger repeated session/new retries', async () => {
    const logPath = path.join(tempRoot, 'cli-invalid-model-log.jsonl');
    const binaryPath = await createInvalidModelAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());
    await runtime.setWorkspaceAgentModel('workspace-1', 'gpt-5.4-high');

    try {
      const result = await runtime.runBatchAnalysis(
        {
          workspaceId: 'workspace-1',
          batchId: 'batch-1',
          kbAccessMode: 'cli',
          agentRole: 'planner',
          sessionMode: 'plan'
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('error');
      expect(result.message).toContain('Cursor ACP rejected selected model "gpt-5.4-high"');

      const requests = await readLoggedRequests(logPath);
      const sessionNewRequests = requests.filter((entry) => entry.method === 'session/new');
      const setModelRequests = requests.filter((entry) => entry.method === 'session/set_model');

      expect(sessionNewRequests).toHaveLength(1);
      expect(setModelRequests).toHaveLength(1);
      expect(setModelRequests[0]?.params).toMatchObject({
        modelId: 'gpt-5.4-high'
      });
    } finally {
      await runtime.stop();
    }
  });
});
