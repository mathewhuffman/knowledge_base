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
    findRelatedArticles: async () => ({ ok: true, results: [] }),
    listCategories: async () => ({ ok: true, categories: [] }),
    listSections: async () => ({ ok: true, sections: [] }),
    listArticleTemplates: async () => ({ ok: true, templates: [] }),
    getTemplate: async () => ({ ok: true }),
    getBatchContext: async () => ({ id: 'batch-1', status: 'submitted' }),
    getPBI: async () => ({ id: 'pbi-1' }),
    getPBISubset: async () => ({ rows: [{ id: 'pbi-1', title: 'CLI provider test' }] }),
    getArticleHistory: async () => ({ revisions: [] }),
    recordAgentNotes: async () => ({ ok: true }),
    proposeCreateKb: async () => ({ ok: true }),
    proposeEditKb: async () => ({ ok: true }),
    proposeRetireKb: async () => ({ ok: true })
  };
}

async function createFakeAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-agent');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
const sessionId = 'acp-session-test';

function append(entry) {
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\\n', 'utf8');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  const message = JSON.parse(trimmed);
  append({ method: message.method, params: message.params });

  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'authenticate') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'session/new') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId } }) + '\\n');
    return;
  }

  if (message.method === 'session/prompt') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { status: 'ok' } }) + '\\n');
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;

  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createStreamingOnlyAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-agent-streaming-only');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
const sessionId = 'acp-session-streaming';

function append(entry) {
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\\n', 'utf8');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  const message = JSON.parse(trimmed);
  append({ method: message.method, params: message.params });

  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'authenticate') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'session/new') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId } }) + '\\n');
    return;
  }

  if (message.method === 'session/prompt') {
    const payload = {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: '{"summary":"streamed-only"}'
          }
        }
      }
    };
    process.stdout.write(JSON.stringify(payload) + '\\n');
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;

  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createEarlyResponseThenStreamAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-agent-early-response-then-stream');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
const sessionId = 'acp-session-early-response';

function append(entry) {
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\\n', 'utf8');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  const message = JSON.parse(trimmed);
  append({ method: message.method, params: message.params });

  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'authenticate') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'session/new') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId } }) + '\\n');
    return;
  }

  if (message.method === 'session/prompt') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        text: 'Gathering KB evidence via the CLI and then returning only the structured JSON plan.'
      }
    }) + '\\n');

    const payload = {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: '{"summary":"late-streamed-json"}'
          }
        }
      }
    };
    append({ emitted: 'late-session-update', payload });
    process.stdout.write(JSON.stringify(payload) + '\\n');
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;

  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createValidResponseWithCorruptStreamAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-agent-valid-response-corrupt-stream');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
const sessionId = 'acp-session-valid-response-corrupt-stream';

function append(entry) {
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\\n', 'utf8');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  const message = JSON.parse(trimmed);
  append({ method: message.method, params: message.params });

  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'authenticate') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'session/new') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId } }) + '\\n');
    return;
  }

  if (message.method === 'session/prompt') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        text: '{"summary":"final-json-from-response"}'
      }
    }) + '\\n');

    const payload = {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: '{"summary":"final-json-from-response"}{"summary":"garbled-duplicate'
          }
        }
      }
    };
    append({ emitted: 'corrupt-session-update', payload });
    setTimeout(() => {
      process.stdout.write(JSON.stringify(payload) + '\\n');
    }, 20);
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

test.describe('agent runtime provider modes', () => {
  let tempRoot: string;
  let previousCursorBinary: string | undefined;
  let previousAcpCwd: string | undefined;
  let previousLogPath: string | undefined;
  let previousMcpTools: string | undefined;
  let previousBridgeSocket: string | undefined;
  let previousBridgeScript: string | undefined;

  test.beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-agent-runtime-'));
    previousCursorBinary = process.env.KBV_CURSOR_BINARY;
    previousAcpCwd = process.env.KBV_ACP_CWD;
    previousLogPath = process.env.KBV_TEST_ACP_LOG_PATH;
    previousMcpTools = process.env.KBV_MCP_TOOLS;
    previousBridgeSocket = process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    previousBridgeScript = process.env.KBV_MCP_BRIDGE_SCRIPT;
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
    if (previousMcpTools === undefined) {
      delete process.env.KBV_MCP_TOOLS;
    } else {
      process.env.KBV_MCP_TOOLS = previousMcpTools;
    }
    if (previousBridgeSocket === undefined) {
      delete process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    } else {
      process.env.KBV_MCP_BRIDGE_SOCKET_PATH = previousBridgeSocket;
    }
    if (previousBridgeScript === undefined) {
      delete process.env.KBV_MCP_BRIDGE_SCRIPT;
    } else {
      process.env.KBV_MCP_BRIDGE_SCRIPT = previousBridgeScript;
    }

    await rm(tempRoot, { recursive: true, force: true });
  });

  test('CLI mode enables terminal access, omits MCP servers, and keeps prompts kb-only', async () => {
    const logPath = path.join(tempRoot, 'cli-log.jsonl');
    const binaryPath = await createFakeAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    delete process.env.KBV_MCP_TOOLS;
    delete process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    delete process.env.KBV_MCP_BRIDGE_SCRIPT;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());
    runtime.setMcpServerConfigs([
      {
        type: 'stdio',
        name: 'kb-vault',
        command: 'node',
        args: ['bridge.js']
      }
    ]);

    try {
      const result = await runtime.runBatchAnalysis(
        {
          workspaceId: 'workspace-1',
          batchId: 'batch-1',
          kbAccessMode: 'cli'
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');

      const requests = await readLoggedRequests(logPath);
      const initializeRequest = requests.find((entry) => entry.method === 'initialize');
      const sessionNewRequest = requests.find((entry) => entry.method === 'session/new');
      const promptRequest = requests.find((entry) => entry.method === 'session/prompt');

      expect(initializeRequest?.params?.clientCapabilities).toMatchObject({
        terminal: true
      });
      expect(sessionNewRequest?.params).toMatchObject({
        mcpServers: []
      });

      const promptText = ((promptRequest?.params?.prompt as Array<{ text?: string }> | undefined) ?? [])[0]?.text ?? '';
      expect(promptText).toContain('Use only the `kb` CLI');
      expect(promptText).not.toContain('MCP');
      expect(promptText).toContain('Use as many `kb` commands as needed to complete the task.');
      expect(promptText).not.toContain('KB Vault MCP guidance');
      expect(promptText).not.toContain('get_batch_context');
      expect(promptText).not.toContain('list_mcp_resources');
      expect(promptText).not.toContain('mcpServers');
    } finally {
      await runtime.stop();
    }
  });

  test('MCP mode keeps terminal disabled and attaches configured MCP servers', async () => {
    const logPath = path.join(tempRoot, 'mcp-log.jsonl');
    const binaryPath = await createFakeAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    delete process.env.KBV_MCP_TOOLS;
    delete process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    delete process.env.KBV_MCP_BRIDGE_SCRIPT;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());
    runtime.setMcpServerConfigs([
      {
        type: 'stdio',
        name: 'kb-vault',
        command: 'node',
        args: ['bridge.js'],
        env: [{ name: 'KBV_MCP_BRIDGE_SOCKET_PATH', value: '/tmp/kb.sock' }]
      }
    ]);

    try {
      const result = await runtime.runBatchAnalysis(
        {
          workspaceId: 'workspace-1',
          batchId: 'batch-1',
          kbAccessMode: 'mcp'
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');

      const requests = await readLoggedRequests(logPath);
      const initializeRequest = requests.find((entry) => entry.method === 'initialize');
      const sessionNewRequest = requests.find((entry) => entry.method === 'session/new');
      const promptRequest = requests.find((entry) => entry.method === 'session/prompt');

      expect(initializeRequest?.params?.clientCapabilities).toMatchObject({
        terminal: false
      });
      expect(sessionNewRequest?.params).toMatchObject({
        mcpServers: [
          {
            type: 'stdio',
            name: 'kb-vault',
            command: 'node',
            args: ['bridge.js']
          }
        ]
      });

      const promptText = ((promptRequest?.params?.prompt as Array<{ text?: string }> | undefined) ?? [])[0]?.text ?? '';
      expect(promptText).toContain('KB Vault MCP guidance');
      expect(promptText).toContain('get_batch_context');
      expect(promptText).toContain('list_mcp_resources');
      expect(promptText).not.toContain('Use only the `kb` CLI');
    } finally {
      await runtime.stop();
    }
  });

  test('MCP mode still uses MCP-only prompt guidance and tool names', async () => {
    const logPath = path.join(tempRoot, 'mcp-preserve-log.jsonl');
    const binaryPath = await createFakeAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    process.env.KBV_MCP_TOOLS = JSON.stringify([
      {
        type: 'stdio',
        name: 'kb-vault',
        command: 'node',
        args: ['bridge.js']
      }
    ]);
    delete process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    delete process.env.KBV_MCP_BRIDGE_SCRIPT;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());

    try {
      const result = await runtime.runBatchAnalysis(
        {
          workspaceId: 'workspace-1',
          batchId: 'batch-1',
          kbAccessMode: 'mcp'
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');

      const promptRequests = await readLoggedRequests(logPath);
      const promptRequest = promptRequests.find((entry) => entry.method === 'session/prompt');
      const promptText = ((promptRequest?.params?.prompt as Array<{ text?: string }> | undefined) ?? [])[0]?.text ?? '';
      expect(promptText).toContain('KB Vault MCP guidance');
      expect(promptText).toContain('get_batch_context');
      expect(promptText).toContain('get_pbi_subset');
      expect(promptText).not.toContain('`kb` CLI and data returned by its JSON output');
    } finally {
      await runtime.stop();
    }
  });

  test('batch planner sessions request ACP plan mode', async () => {
    const logPath = path.join(tempRoot, 'plan-log.jsonl');
    const binaryPath = await createFakeAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    delete process.env.KBV_MCP_TOOLS;
    delete process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    delete process.env.KBV_MCP_BRIDGE_SCRIPT;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());

    try {
      const result = await runtime.runBatchAnalysis(
        {
          workspaceId: 'workspace-1',
          batchId: 'batch-1',
          kbAccessMode: 'mcp',
          agentRole: 'planner',
          sessionMode: 'plan'
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');

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

  test('streamed prompt output can complete a run even when ACP never returns a prompt response', async () => {
    const logPath = path.join(tempRoot, 'streaming-log.jsonl');
    const binaryPath = await createStreamingOnlyAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    delete process.env.KBV_MCP_TOOLS;
    delete process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    delete process.env.KBV_MCP_BRIDGE_SCRIPT;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());

    try {
      const result = await runtime.runBatchAnalysis(
        {
          workspaceId: 'workspace-1',
          batchId: 'batch-1',
          kbAccessMode: 'cli',
          timeoutMs: 5_000
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');
      expect(result.resultPayload).toMatchObject({
        text: '{"summary":"streamed-only"}'
      });
    } finally {
      await runtime.stop();
    }
  });

  test('late streamed output wins when session/prompt responds before the real answer is finished', async () => {
    const logPath = path.join(tempRoot, 'early-response-stream-log.jsonl');
    const binaryPath = await createEarlyResponseThenStreamAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    delete process.env.KBV_MCP_TOOLS;
    delete process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    delete process.env.KBV_MCP_BRIDGE_SCRIPT;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());

    try {
      const result = await runtime.runBatchAnalysis(
        {
          workspaceId: 'workspace-1',
          batchId: 'batch-1',
          kbAccessMode: 'cli',
          timeoutMs: 5_000
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');
      expect(result.resultPayload).toMatchObject({
        text: '{"summary":"late-streamed-json"}'
      });
    } finally {
      await runtime.stop();
    }
  });

  test('explicit ACP result beats corrupt streamed chunk assembly when the response already contains valid JSON', async () => {
    const logPath = path.join(tempRoot, 'valid-response-corrupt-stream-log.jsonl');
    const binaryPath = await createValidResponseWithCorruptStreamAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    delete process.env.KBV_MCP_TOOLS;
    delete process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    delete process.env.KBV_MCP_BRIDGE_SCRIPT;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());

    try {
      const result = await runtime.runBatchAnalysis(
        {
          workspaceId: 'workspace-1',
          batchId: 'batch-1',
          kbAccessMode: 'cli',
          timeoutMs: 5_000
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');
      expect(result.resultPayload).toMatchObject({
        text: '{"summary":"final-json-from-response"}',
        streamedText: '{"summary":"final-json-from-response"}{"summary":"garbled-duplicate'
      });
    } finally {
      await runtime.stop();
    }
  });
});
