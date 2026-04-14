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

async function createIncrementingSessionAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-agent-incrementing-sessions');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
let sessionCounter = 0;

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

  if (message.method === 'initialize' || message.method === 'authenticate') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'session/new') {
    sessionCounter += 1;
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: { sessionId: 'acp-session-' + String(sessionCounter) }
    }) + '\\n');
    return;
  }

  if (message.method === 'session/prompt') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: { text: '{"summary":"ok"}' }
    }) + '\\n');
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

async function createChunkFloodStreamingOnlyAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-agent-streaming-chunk-flood');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
const sessionId = 'acp-session-streaming-flood';

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
    const chunks = [
      '{"summary":"',
      'chunk-flood',
      '-streamed',
      '-only',
      '"}'
    ];
    for (const text of chunks) {
      const payload = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text
            }
          }
        }
      };
      process.stdout.write(JSON.stringify(payload) + '\\n');
    }
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;

  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createPlannerLongJsonCharStreamAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-agent-planner-long-json-char-stream');
  const plannerJson = JSON.stringify({
    summary: `Planner stream ${'evidence '.repeat(140)}`.trim(),
    coverage: [
      {
        pbiId: 'pbi-1',
        outcome: 'covered',
        planItemIds: ['plan-1']
      }
    ],
    items: [
      {
        planItemId: 'plan-1',
        pbiIds: ['pbi-1'],
        action: 'edit',
        targetType: 'article',
        targetArticleId: 'article-1',
        targetTitle: 'Edit Food List',
        reason: 'Deterministic prefetch found a strong existing article match.',
        evidence: [
          {
            kind: 'search',
            ref: 'search-1',
            summary: 'Existing article already covers the targeted workflow.'
          }
        ],
        confidence: 0.92,
        executionStatus: 'pending'
      }
    ],
    openQuestions: []
  });
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
const sessionId = 'acp-session-planner-long-json-char-stream';
const plannerJson = ${JSON.stringify(plannerJson)};

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

  if (message.method === 'initialize' || message.method === 'authenticate') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'session/new') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId } }) + '\\n');
    return;
  }

  if (message.method === 'session/prompt') {
    for (const text of plannerJson.split('')) {
      const payload = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text
            }
          }
        }
      };
      process.stdout.write(JSON.stringify(payload) + '\\n');
    }
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;

  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createPlannerDistinctZeroResultSearchAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-agent-planner-distinct-zero-result-searches');
  const plannerJson = JSON.stringify({
    summary: 'Planner completed after distinct zero-result search evidence.',
    coverage: [
      {
        pbiId: 'pbi-1',
        outcome: 'covered',
        planItemIds: ['plan-1']
      }
    ],
    items: [
      {
        planItemId: 'plan-1',
        pbiIds: ['pbi-1'],
        action: 'create',
        targetType: 'new_article',
        targetTitle: 'New Waste Article',
        reason: 'Distinct zero-result searches and deterministic prefetch support net-new coverage.',
        evidence: [
          {
            kind: 'search',
            ref: 'search-1',
            summary: 'Multiple materially different KB searches returned zero results.'
          }
        ],
        confidence: 0.83,
        executionStatus: 'pending'
      }
    ],
    openQuestions: []
  });
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
const sessionId = 'acp-session-planner-distinct-zero-result-searches';
const plannerJson = ${JSON.stringify(plannerJson)};
const queries = ['waste setup', 'waste checklist', 'waste reporting', 'waste inventory'];

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

  if (message.method === 'initialize' || message.method === 'authenticate') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'session/new') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId } }) + '\\n');
    return;
  }

  if (message.method === 'session/prompt') {
    for (let index = 0; index < queries.length; index += 1) {
      const query = queries[index];
      const toolCallId = 'tool-call-' + String(index + 1);
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId,
            title: 'Terminal',
            kind: 'execute',
            status: 'pending',
            rawInput: {}
          }
        }
      }) + '\\n');
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId,
            status: 'completed',
            rawInput: {
              command: '/var/folders/test/kb-vault-cli-shim/kb search-kb --workspace-id workspace-1 --query "' + query + '" --json'
            },
            rawOutput: {
              stdout: JSON.stringify({
                command: 'search-kb',
                data: {
                  total: 0,
                  results: []
                }
              })
            }
          }
        }
      }) + '\\n');
    }

    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        text: plannerJson
      }
    }) + '\\n');
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

async function createDelayedEarlyResponseThenStreamAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-agent-delayed-early-response-then-stream');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
const sessionId = 'acp-session-delayed-early-response';

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
        text: 'Reviewing the submitted plan against deterministic evidence now, and I’m running a few focused KB searches.'
      }
    }) + '\\n');

    setTimeout(() => {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'call-delayed-review',
            title: 'Terminal',
            kind: 'execute',
            status: 'pending',
            rawInput: {
              command: 'kb search-kb --workspace-id workspace-1 --query "Delete a Food Item" --json'
            }
          }
        }
      }) + '\\n');
    }, 4700);

    setTimeout(() => {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'call-delayed-review',
            title: 'Terminal',
            kind: 'execute',
            status: 'completed',
            rawInput: {
              command: 'kb search-kb --workspace-id workspace-1 --query "Delete a Food Item" --json'
            },
            rawOutput: {
              exitCode: 0,
              stdout: '{"ok":true,"command":"search-kb","data":{"ok":true,"total":1,"results":[{"title":"Delete a Food Item"}]}}',
              stderr: ''
            }
          }
        }
      }) + '\\n');
    }, 5200);

    setTimeout(() => {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: '{"summary":"delayed-post-response-json","verdict":"needs_revision","delta":{"summary":"Fix target selection.","requestedChanges":["Use the existing delete article."],"missingPbiIds":[],"missingCreates":[],"missingEdits":["Delete a Food Item"],"additionalArticleWork":["Delete a Food Item"],"targetCorrections":[],"overlapConflicts":[]}}'
            }
          }
        }
      }) + '\\n');
    }, 5600);
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;

  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createDelayedSessionReadyAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-agent-delayed-session-ready');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
const sessionId = 'acp-session-delayed-ready';
let sessionReady = false;
let promptAttempts = 0;

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
    sessionReady = false;
    setTimeout(() => {
      sessionReady = true;
      const payload = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'available_commands_update',
            availableCommands: [
              { name: 'shell', description: 'builtin skill' }
            ]
          }
        }
      };
      append({ emitted: 'session-ready', payload });
      process.stdout.write(JSON.stringify(payload) + '\\n');
    }, 120);
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId } }) + '\\n');
    return;
  }

  if (message.method === 'session/prompt') {
    promptAttempts += 1;
    if (!sessionReady) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: {
            details: 'Session ' + sessionId + ' not found'
          }
        }
      }) + '\\n');
      return;
    }

    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        text: '{"summary":"delayed-ready-final"}',
        promptAttempts
      }
    }) + '\\n');
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;

  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createAssistantChatProgressThenFinalAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-agent-assistant-chat-progress-then-final');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
const sessionId = 'acp-session-assistant-progress';
let promptCount = 0;

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

  if (message.method === 'initialize' || message.method === 'authenticate') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'session/new') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId } }) + '\\n');
    return;
  }

  if (message.method === 'session/prompt') {
    promptCount += 1;
    if (promptCount === 1) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          text: 'I found the main workspace articles for waste and I am pulling the core ones so I can explain the feature end to end.'
        }
      }) + '\\n');
      return;
    }

    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        text: '{"response":"Waste is the feature for recording product loss, submitting it, and using reporting to understand patterns and reduce cost."}'
      }
    }) + '\\n');
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;

  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createAssistantChatResetDuringContinuationAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-agent-assistant-chat-reset-during-continuation');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
let sessionCounter = 0;
let currentSessionId = '';
let firstPromptSeen = false;
let deadSessionId = null;

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

  if (message.method === 'initialize' || message.method === 'authenticate') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'session/new') {
    sessionCounter += 1;
    currentSessionId = 'acp-session-reset-' + sessionCounter;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId: currentSessionId } }) + '\\n');
    return;
  }

  if (message.method === 'session/prompt') {
    const promptText = Array.isArray(message.params?.prompt)
      ? message.params.prompt.map((entry) => entry?.text || '').join('\\n')
      : '';

    if (!firstPromptSeen) {
      firstPromptSeen = true;
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          text: '{"completionState":"researching","isFinal":false,"response":"Looking up accountability in the workspace KB."}'
        }
      }) + '\\n');
      return;
    }

    if (deadSessionId === null) {
      deadSessionId = currentSessionId;
    }

    if (message.params?.sessionId === deadSessionId) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: {
            details: 'Session ' + currentSessionId + ' not found'
          }
        }
      }) + '\\n');
      return;
    }

    if (promptText.includes('tell me about accountability, the feature in my app')) {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          text: '{"completionState":"completed","isFinal":true,"response":"Accountability is the feature for tracking follow-through, ownership, and whether required work was completed in your app."}'
        }
      }) + '\\n');
      return;
    }

    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        text: '{"completionState":"completed","isFinal":true,"response":"I am missing the actual user question from the carried-over session context."}'
      }
    }) + '\\n');
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;

  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createAssistantChatShellKbAllowedAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-agent-assistant-chat-shell-kb-allowed');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
const sessionId = 'acp-session-shell-kb-policy';
let promptCount = 0;

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

  if (message.method === 'initialize' || message.method === 'authenticate') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'session/new') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId } }) + '\\n');
    return;
  }

  if (message.method === 'session/prompt') {
    promptCount += 1;

    if (promptCount === 1) {
      const payload = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-call-1',
            title: '/var/folders/test/kb-vault-cli-shim/kb search-kb --workspace-id workspace-1 --query "waste" --json',
            kind: 'command',
            rawInput: {
              command: '/var/folders/test/kb-vault-cli-shim/kb search-kb --workspace-id workspace-1 --query "waste" --json'
            }
          }
        }
      };
      process.stdout.write(JSON.stringify(payload) + '\\n');
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          text: '{"completionState":"completed","isFinal":true,"response":"Waste is the feature for tracking product loss, reviewing it, and configuring how it is recorded in the app."}'
        }
      }) + '\\n');
      return;
    }

    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        text: '{"completionState":"completed","isFinal":true,"response":"Waste follow-up."}'
      }
    }) + '\\n');
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;

  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createAssistantChatShellPolicyRecoveryAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-agent-assistant-chat-shell-policy-recovery');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
const sessionId = 'acp-session-shell-policy-recovery';
let promptCount = 0;

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

  if (message.method === 'initialize' || message.method === 'authenticate') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'session/new') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId } }) + '\\n');
    return;
  }

  if (message.method === 'session/prompt') {
    promptCount += 1;

    if (promptCount === 1) {
      const searchTool = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-call-search',
            title: '/var/folders/test/kb-vault-cli-shim/kb search-kb --workspace-id workspace-1 --query "checklist" --json',
            kind: 'command',
            rawInput: {
              command: '/var/folders/test/kb-vault-cli-shim/kb search-kb --workspace-id workspace-1 --query "checklist" --json'
            }
          }
        }
      };
      const searchComplete = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'tool-call-search',
            title: '/var/folders/test/kb-vault-cli-shim/kb search-kb --workspace-id workspace-1 --query "checklist" --json',
            kind: 'command',
            status: 'completed',
            rawInput: {
              command: '/var/folders/test/kb-vault-cli-shim/kb search-kb --workspace-id workspace-1 --query "checklist" --json'
            },
            rawOutput: {
              stdout: JSON.stringify({
                command: 'search-kb',
                data: {
                  total: 1,
                  results: [
                    { localeVariantId: 'variant-checklist', title: 'Complete a Checklist' }
                  ]
                }
              })
            }
          }
        }
      };
      const articleTool = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-call-article',
            title: '/var/folders/test/kb-vault-cli-shim/kb get-article --workspace-id workspace-1 --locale-variant-id variant-checklist --json',
            kind: 'command',
            rawInput: {
              command: '/var/folders/test/kb-vault-cli-shim/kb get-article --workspace-id workspace-1 --locale-variant-id variant-checklist --json'
            }
          }
        }
      };
      const articleComplete = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'tool-call-article',
            title: '/var/folders/test/kb-vault-cli-shim/kb get-article --workspace-id workspace-1 --locale-variant-id variant-checklist --json',
            kind: 'command',
            status: 'completed',
            rawInput: {
              command: '/var/folders/test/kb-vault-cli-shim/kb get-article --workspace-id workspace-1 --locale-variant-id variant-checklist --json'
            }
          }
        }
      };
      const illegalShell = {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'tool-call-shell',
            title: 'Terminal',
            kind: 'terminal',
            rawInput: {
              command: 'pwd'
            }
          }
        }
      };

      process.stdout.write(JSON.stringify(searchTool) + '\\n');
      process.stdout.write(JSON.stringify(searchComplete) + '\\n');
      process.stdout.write(JSON.stringify(articleTool) + '\\n');
      process.stdout.write(JSON.stringify(articleComplete) + '\\n');
      process.stdout.write(JSON.stringify(illegalShell) + '\\n');
      return;
    }

    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        text: '{"completionState":"completed","isFinal":true,"response":"To use Checklist, create or assign the checklist, open it from the relevant workflow, complete each required item, and then submit or review the results based on the checklist article guidance."}'
      }
    }) + '\\n');
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;

  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createAssistantChatTerminalPlaceholderThenKbAcpBinary(root: string, logPath: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-agent-assistant-chat-terminal-placeholder-then-kb');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
const sessionId = 'acp-session-terminal-placeholder-then-kb';

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

  if (message.method === 'initialize' || message.method === 'authenticate') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }

  if (message.method === 'session/new') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId } }) + '\\n');
    return;
  }

  if (message.method === 'session/prompt') {
    const placeholderTool = {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tool-call-kb',
          title: 'Terminal',
          kind: 'execute',
          status: 'pending',
          rawInput: {}
        }
      }
    };
    const kbTool = {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tool-call-kb',
          title: '/var/folders/test/kb-vault-cli-shim/kb search-kb --workspace-id workspace-1 --query "checklist" --json',
          kind: 'execute',
          status: 'completed',
          rawInput: {
            command: '/var/folders/test/kb-vault-cli-shim/kb search-kb --workspace-id workspace-1 --query "checklist" --json'
          },
          rawOutput: {
            stdout: JSON.stringify({
              command: 'search-kb',
              data: {
                total: 1,
                results: [{ localeVariantId: 'variant-checklist', title: 'Complete a Checklist' }]
              }
            })
          }
        }
      }
    };

    process.stdout.write(JSON.stringify(placeholderTool) + '\\n');
    process.stdout.write(JSON.stringify(kbTool) + '\\n');
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        text: '{"completionState":"completed","isFinal":true,"response":"Checklist lookup completed through kb terminal command."}'
      }
    }) + '\\n');
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

  test('CLI mode omits MCP servers, keeps prompts kb-only, and does not request generic terminal access', async () => {
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
        terminal: false
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

  test('streamed prompt completion ignores slow local progress handling after chunk floods', async () => {
    const logPath = path.join(tempRoot, 'streaming-chunk-flood-log.jsonl');
    const binaryPath = await createChunkFloodStreamingOnlyAcpBinary(tempRoot, logPath);
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
          timeoutMs: 1_500
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 350));
        },
        () => false
      );

      expect(result.status).toBe('ok');
      expect(result.resultPayload).toMatchObject({
        text: '{"summary":"chunk-flood-streamed-only"}'
      });
    } finally {
      await runtime.stop();
    }
  });

  test('planner waits for long actively streaming JSON instead of aborting it as malformed', async () => {
    const logPath = path.join(tempRoot, 'planner-long-json-char-stream-log.jsonl');
    const binaryPath = await createPlannerLongJsonCharStreamAcpBinary(tempRoot, logPath);
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
          agentRole: 'planner',
          sessionMode: 'plan',
          timeoutMs: 8_000
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');
      expect(result.resultPayload).toMatchObject({
        text: expect.stringContaining('"coverage"')
      });

      const parsed = JSON.parse(((result.resultPayload as { text?: string } | undefined)?.text) ?? '');
      expect(parsed.summary).toContain('Planner');
      expect(parsed.items?.[0]?.planItemId).toBe('plan-1');
    } finally {
      await runtime.stop();
    }
  });

  test('CLI planner accepts distinct zero-result searches and still audits the completed kb commands', async () => {
    const logPath = path.join(tempRoot, 'planner-distinct-zero-result-searches-log.jsonl');
    const binaryPath = await createPlannerDistinctZeroResultSearchAcpBinary(tempRoot, logPath);
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
          agentRole: 'planner',
          sessionMode: 'plan',
          timeoutMs: 5_000
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');
      expect(result.toolCalls).toHaveLength(4);
      expect(result.toolCalls.map((toolCall) => toolCall.toolName)).toEqual([
        'search-kb',
        'search-kb',
        'search-kb',
        'search-kb'
      ]);

      const transcript = await runtime.getTranscripts({
        workspaceId: 'workspace-1',
        sessionId: result.sessionId,
        limit: 0
      });
      expect(transcript.lines.some((line) => line.event === 'planner_loop_breaker')).toBeFalsy();
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

  test('batch analysis waits for delayed post-response tool work before finalizing the result', async () => {
    const logPath = path.join(tempRoot, 'delayed-early-response-stream-log.jsonl');
    const binaryPath = await createDelayedEarlyResponseThenStreamAcpBinary(tempRoot, logPath);
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
          timeoutMs: 12_000
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');
      expect(result.finalText).toContain('"verdict":"needs_revision"');
      expect(result.resultPayload).toMatchObject({
        text: expect.stringContaining('"missingEdits":["Delete a Food Item"]')
      });
      expect(result.toolCalls.map((toolCall) => toolCall.toolName)).toEqual(['search-kb']);
    } finally {
      await runtime.stop();
    }
  });

  test('retries the same ACP session when prompt lands before the new session is ready', async () => {
    const logPath = path.join(tempRoot, 'delayed-session-ready-log.jsonl');
    const binaryPath = await createDelayedSessionReadyAcpBinary(tempRoot, logPath);
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
        text: '{"summary":"delayed-ready-final"}'
      });

      const requests = await readLoggedRequests(logPath);
      const sessionNewRequests = requests.filter((entry) => entry.method === 'session/new');
      const promptRequests = requests.filter((entry) => entry.method === 'session/prompt');

      expect(sessionNewRequests).toHaveLength(1);
      expect(promptRequests.length).toBeGreaterThanOrEqual(2);
      expect(promptRequests.every((entry) => entry.params?.sessionId === 'acp-session-delayed-ready')).toBeTruthy();
    } finally {
      await runtime.stop();
    }
  });

  test('assistant chat auto-continues on progress-only placeholder replies', async () => {
    const logPath = path.join(tempRoot, 'assistant-progress-then-final-log.jsonl');
    const binaryPath = await createAssistantChatProgressThenFinalAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    delete process.env.KBV_MCP_TOOLS;
    delete process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    delete process.env.KBV_MCP_BRIDGE_SCRIPT;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());

    try {
      const result = await runtime.runAssistantChat(
        {
          workspaceId: 'workspace-1',
          localeVariantId: 'workspace-1',
          kbAccessMode: 'cli',
          prompt: 'can you explain waste to me',
          timeoutMs: 10_000
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');
      expect(result.resultPayload).toMatchObject({
        text: '{"response":"Waste is the feature for recording product loss, submitting it, and using reporting to understand patterns and reduce cost."}'
      });

      const requests = await readLoggedRequests(logPath);
      const sessionNewRequests = requests.filter((entry) => entry.method === 'session/new');
      const promptRequests = requests.filter((entry) => entry.method === 'session/prompt');

      expect(sessionNewRequests).toHaveLength(1);
      expect(promptRequests).toHaveLength(2);
      expect(promptRequests.every((entry) => entry.params?.sessionId === 'acp-session-assistant-progress')).toBeTruthy();
    } finally {
      await runtime.stop();
    }
  });

  test('assistant chat sessions continue to request ACP ask mode', async () => {
    const logPath = path.join(tempRoot, 'assistant-ask-mode-log.jsonl');
    const binaryPath = await createAssistantChatProgressThenFinalAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    delete process.env.KBV_MCP_TOOLS;
    delete process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    delete process.env.KBV_MCP_BRIDGE_SCRIPT;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());

    try {
      const result = await runtime.runAssistantChat(
        {
          workspaceId: 'workspace-1',
          localeVariantId: 'workspace-1',
          kbAccessMode: 'cli',
          prompt: 'can you explain waste to me',
          timeoutMs: 10_000
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');

      const requests = await readLoggedRequests(logPath);
      const sessionNewRequest = requests.find((entry) => entry.method === 'session/new');
      expect(sessionNewRequest?.params).toMatchObject({
        config: {
          mode: 'ask'
        }
      });
    } finally {
      await runtime.stop();
    }
  });

  test('assistant chat replays the original request when continuation lands on a fresh ACP session', async () => {
    const logPath = path.join(tempRoot, 'assistant-reset-during-continuation-log.jsonl');
    const binaryPath = await createAssistantChatResetDuringContinuationAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    delete process.env.KBV_MCP_TOOLS;
    delete process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    delete process.env.KBV_MCP_BRIDGE_SCRIPT;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());

    try {
      const result = await runtime.runAssistantChat(
        {
          workspaceId: 'workspace-1',
          localeVariantId: 'workspace-1',
          kbAccessMode: 'cli',
          prompt: 'tell me about accountability, the feature in my app',
          timeoutMs: 10_000
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');
      expect(result.resultPayload).toMatchObject({
        text: '{"completionState":"completed","isFinal":true,"response":"Accountability is the feature for tracking follow-through, ownership, and whether required work was completed in your app."}'
      });

      const requests = await readLoggedRequests(logPath);
      const sessionNewRequests = requests.filter((entry) => entry.method === 'session/new');
      const promptRequests = requests.filter((entry) => entry.method === 'session/prompt');
      const finalPrompt = promptRequests[promptRequests.length - 1];
      const finalPromptText = Array.isArray(finalPrompt?.params?.prompt)
        ? finalPrompt.params.prompt
            .map((entry) => (entry && typeof entry === 'object' && 'text' in entry ? String((entry as { text?: unknown }).text ?? '') : ''))
            .join('\n')
        : '';

      expect(sessionNewRequests).toHaveLength(2);
      expect(promptRequests.length).toBeGreaterThanOrEqual(3);
      expect(finalPrompt?.params?.sessionId).toBe('acp-session-reset-2');
      expect(finalPromptText).toContain('tell me about accountability, the feature in my app');
      expect(finalPromptText).toContain('Continuation instructions:');
    } finally {
      await runtime.stop();
    }
  });

  test('assistant chat allows shell only for kb commands and records the kb command name', async () => {
    const logPath = path.join(tempRoot, 'assistant-shell-kb-allowed-log.jsonl');
    const binaryPath = await createAssistantChatShellKbAllowedAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    delete process.env.KBV_MCP_TOOLS;
    delete process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    delete process.env.KBV_MCP_BRIDGE_SCRIPT;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());

    try {
      const result = await runtime.runAssistantChat(
        {
          workspaceId: 'workspace-1',
          localeVariantId: 'workspace-1',
          kbAccessMode: 'cli',
          prompt: 'can you explain waste to me',
          timeoutMs: 10_000
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');
      expect(result.resultPayload).toMatchObject({
        text: '{"completionState":"completed","isFinal":true,"response":"Waste is the feature for tracking product loss, reviewing it, and configuring how it is recorded in the app."}'
      });

      const requests = await readLoggedRequests(logPath);
      const promptRequests = requests.filter((entry) => entry.method === 'session/prompt');
      expect(promptRequests).toHaveLength(1);
      expect(result.message).toBe('Completed');
      expect(result.toolCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolName: 'search-kb',
            allowed: true
          })
        ])
      );
    } finally {
      await runtime.stop();
    }
  });

  test('assistant chat recovers from a blocked terminal attempt, keeps the same turn, and finishes with the KB findings', async () => {
    const logPath = path.join(tempRoot, 'assistant-shell-policy-recovery-log.jsonl');
    const binaryPath = await createAssistantChatShellPolicyRecoveryAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    delete process.env.KBV_MCP_TOOLS;
    delete process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    delete process.env.KBV_MCP_BRIDGE_SCRIPT;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());

    try {
      const result = await runtime.runAssistantChat(
        {
          workspaceId: 'workspace-1',
          localeVariantId: 'workspace-1',
          kbAccessMode: 'cli',
          prompt: 'please go do research on our checklist feature and tell me how to use it',
          timeoutMs: 10_000
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');
      expect(result.resultPayload).toMatchObject({
        text: '{"completionState":"completed","isFinal":true,"response":"To use Checklist, create or assign the checklist, open it from the relevant workflow, complete each required item, and then submit or review the results based on the checklist article guidance."}'
      });
      expect(result.toolCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolName: 'search-kb',
            allowed: true
          }),
          expect.objectContaining({
            toolName: 'get-article',
            allowed: true
          }),
          expect.objectContaining({
            toolName: 'Terminal',
            allowed: false,
            reason: 'CLI mode forbids terminal usage outside of running kb commands'
          })
        ])
      );

      const requests = await readLoggedRequests(logPath);
      const promptRequests = requests.filter((entry) => entry.method === 'session/prompt');
      expect(promptRequests).toHaveLength(2);
      expect(promptRequests[0]?.params?.sessionId).toBe('acp-session-shell-policy-recovery');
      expect(promptRequests[1]?.params?.sessionId).toBe('acp-session-shell-policy-recovery');

      const secondPromptText = Array.isArray(promptRequests[1]?.params?.prompt)
        ? promptRequests[1]?.params?.prompt
            .map((entry) => (entry && typeof entry === 'object' && 'text' in entry ? String((entry as { text?: unknown }).text ?? '') : ''))
            .join('\n')
        : '';

      expect(secondPromptText).toContain('attempted an illegal operation in CLI mode');
      expect(secondPromptText).toContain('CLI mode blocked illegal tool call "Terminal"');
      expect(secondPromptText).toContain('Do not try that illegal operation again.');
      expect(secondPromptText).toContain('You may still use fresh direct KB tools or exact kb CLI commands in this recovered turn');
      expect(secondPromptText).toContain('Do not claim that KB commands are forbidden in this turn unless a direct KB command actually failed.');
      expect(secondPromptText).toContain('please go do research on our checklist feature and tell me how to use it');
    } finally {
      await runtime.stop();
    }
  });

  test('assistant chat allows a placeholder Terminal event to resolve into a kb command without triggering recovery', async () => {
    const logPath = path.join(tempRoot, 'assistant-terminal-placeholder-then-kb-log.jsonl');
    const binaryPath = await createAssistantChatTerminalPlaceholderThenKbAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    delete process.env.KBV_MCP_TOOLS;
    delete process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    delete process.env.KBV_MCP_BRIDGE_SCRIPT;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());

    try {
      const result = await runtime.runAssistantChat(
        {
          workspaceId: 'workspace-1',
          localeVariantId: 'workspace-1',
          kbAccessMode: 'cli',
          prompt: 'please go do research on our checklist feature and tell me how to use it',
          timeoutMs: 10_000
        },
        () => undefined,
        () => false
      );

      expect(result.status).toBe('ok');
      expect(result.resultPayload).toMatchObject({
        text: '{"completionState":"completed","isFinal":true,"response":"Checklist lookup completed through kb terminal command."}'
      });
      expect(result.toolCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolName: 'search-kb',
            allowed: true
          })
        ])
      );
      expect(result.toolCalls).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolName: 'Terminal',
            allowed: false
          })
        ])
      );

      const requests = await readLoggedRequests(logPath);
      const promptRequests = requests.filter((entry) => entry.method === 'session/prompt');
      expect(promptRequests).toHaveLength(1);
    } finally {
      await runtime.stop();
    }
  });

  test('batch analysis reset_acp reuse policy keeps the local session but opens a fresh ACP session', async () => {
    const logPath = path.join(tempRoot, 'batch-reset-acp-log.jsonl');
    const binaryPath = await createIncrementingSessionAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    delete process.env.KBV_MCP_TOOLS;
    delete process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    delete process.env.KBV_MCP_BRIDGE_SCRIPT;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());

    try {
      const first = await runtime.runBatchAnalysis(
        {
          workspaceId: 'workspace-1',
          batchId: 'batch-1',
          kbAccessMode: 'mcp',
          timeoutMs: 5_000
        },
        () => undefined,
        () => false
      );
      const second = await runtime.runBatchAnalysis(
        {
          workspaceId: 'workspace-1',
          batchId: 'batch-1',
          kbAccessMode: 'mcp',
          sessionId: first.sessionId,
          sessionReusePolicy: 'reset_acp',
          timeoutMs: 5_000
        },
        () => undefined,
        () => false
      );

      expect(first.status).toBe('ok');
      expect(second.status).toBe('ok');
      expect(second.sessionId).toBe(first.sessionId);
      expect(second.acpSessionId).not.toBe(first.acpSessionId);
      expect(first.acpSessionId).toBe('acp-session-1');
      expect(second.acpSessionId).toBe('acp-session-2');

      const requests = await readLoggedRequests(logPath);
      expect(requests.filter((entry) => entry.method === 'session/new')).toHaveLength(2);
      expect(requests.filter((entry) => entry.method === 'session/close')).toHaveLength(1);
    } finally {
      await runtime.stop();
    }
  });

  test('batch analysis new_local_session reuse policy creates a new local runtime session', async () => {
    const logPath = path.join(tempRoot, 'batch-new-local-session-log.jsonl');
    const binaryPath = await createIncrementingSessionAcpBinary(tempRoot, logPath);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    process.env.KBV_ACP_CWD = tempRoot;
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    delete process.env.KBV_MCP_TOOLS;
    delete process.env.KBV_MCP_BRIDGE_SOCKET_PATH;
    delete process.env.KBV_MCP_BRIDGE_SCRIPT;

    const runtime = new CursorAcpRuntime(tempRoot, buildToolContext());

    try {
      const first = await runtime.runBatchAnalysis(
        {
          workspaceId: 'workspace-1',
          batchId: 'batch-1',
          kbAccessMode: 'mcp',
          timeoutMs: 5_000
        },
        () => undefined,
        () => false
      );
      const second = await runtime.runBatchAnalysis(
        {
          workspaceId: 'workspace-1',
          batchId: 'batch-1',
          kbAccessMode: 'mcp',
          sessionReusePolicy: 'new_local_session',
          timeoutMs: 5_000
        },
        () => undefined,
        () => false
      );

      expect(first.status).toBe('ok');
      expect(second.status).toBe('ok');
      expect(second.sessionId).not.toBe(first.sessionId);
      expect(second.acpSessionId).toBe('acp-session-2');
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
