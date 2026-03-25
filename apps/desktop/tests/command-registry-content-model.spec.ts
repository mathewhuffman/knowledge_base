import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { CommandBus } from '../src/main/services/command-bus';
import { JobRegistry } from '../src/main/services/job-runner';
import { registerCoreCommands } from '../src/main/services/command-registry';
import { AppErrorCode, AppRoute } from '@kb-vault/shared-types';

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
    const promptText = (((message.params || {}).prompt || [])[0] || {}).text || '';
    let payload;
    if (promptText.includes('Route: drafts')) {
      payload = {
        artifactType: 'draft_patch',
        response: 'I tightened the draft copy.',
        summary: 'Refined the draft.',
        html: '<h1>Draft Commands</h1><p>AI refined draft.</p>'
      };
    } else if (promptText.includes('Route: templates_and_prompts')) {
      payload = {
        artifactType: 'template_patch',
        response: 'I strengthened the template guidance.',
        summary: 'Updated the template fields.',
        formPatch: {
          toneRules: 'Be concise, concrete, and action-oriented.',
          description: 'Template updated by the assistant.'
        }
      };
    } else if (promptText.includes('Route: article_explorer')) {
      payload = {
        artifactType: 'proposal_candidate',
        response: 'I prepared a proposal candidate from the live article.',
        summary: 'Created a proposal candidate.',
        title: 'Batch 9 Commands',
        confidenceScore: 0.81,
        rationale: 'The article needs a clearer opening.',
        html: '<h1>Batch 9 Commands</h1><p>Assistant proposal candidate.</p>',
        payload: {
          confidenceScore: 0.81,
          proposedHtml: '<h1>Batch 9 Commands</h1><p>Assistant proposal candidate.</p>'
        }
      };
    } else if (promptText.includes('Route: proposal_review')) {
      payload = {
        artifactType: 'proposal_patch',
        response: 'I refined the proposal working copy.',
        summary: 'Updated the proposal draft.',
        title: 'Batch 9 Commands Refined',
        rationale: 'Made the rationale more specific.',
        html: '<h1>Batch 9 Commands Refined</h1><p>AI refined proposal.</p>'
      };
    } else {
      payload = { updatedHtml: '<h1>Draft Commands</h1><p>AI refined draft.</p>', summary: 'AI tightened the article.' };
    }
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { text: JSON.stringify(payload) } }) + '\\n');
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;
  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createFakeBatchAnalysisAcpBinary(root: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-batch-analysis-agent');
  const source = `#!/usr/bin/env node
const readline = require('node:readline');
const sessionId = 'fake-batch-analysis-session';
let reviewCount = 0;
let workerCount = 0;
let finalReviewCount = 0;
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
    const promptText = (((message.params || {}).prompt || [])[0] || {}).text || '';
    let payload;

    if (promptText.includes('Create a complete structured batch analysis plan.')) {
      const revised = promptText.includes('Reviewer delta');
      const discoveredAmendment = promptText.includes('Worker discovered additional scope requiring amendment review.');
      payload = {
        summary: discoveredAmendment ? 'Amended plan.' : (revised ? 'Revised plan.' : 'Initial draft plan.'),
        coverage: [
          { pbiId: 'pbi-1', outcome: 'covered', planItemIds: discoveredAmendment ? ['item-1', 'item-2'] : ['item-1'] }
        ],
        items: discoveredAmendment ? [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1'],
            action: 'no_impact',
            targetType: 'article',
            targetTitle: 'Primary article',
            reason: 'Tracked for test coverage.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported test PBI.' }],
            confidence: 0.9,
            executionStatus: 'pending'
          },
          {
            planItemId: 'item-2',
            pbiIds: ['pbi-1'],
            action: 'no_impact',
            targetType: 'article',
            targetTitle: 'Discovered article',
            reason: 'Amendment added discovered scope for loop testing.',
            evidence: [{ kind: 'review', ref: 'discovery-1', summary: 'Worker discovered related article work.' }],
            confidence: 0.74,
            executionStatus: 'pending'
          }
        ] : [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1'],
            action: 'no_impact',
            targetType: 'article',
            targetTitle: 'Primary article',
            reason: revised ? 'Reviewer-approved test plan item.' : 'Initial test plan item.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported test PBI.' }],
            confidence: 0.9,
            executionStatus: 'pending'
          }
        ],
        openQuestions: []
      };
    } else if (promptText.includes('Review the submitted batch plan for completeness and correctness.')) {
      reviewCount += 1;
      if (reviewCount === 1) {
        const fence = String.fromCharCode(96).repeat(3);
        payload = fence + "json\\n" + JSON.stringify({
          summary: 'Missing one related article.',
          verdict: 'needs_revision',
          didAccountForEveryPbi: true,
          hasMissingCreates: false,
          hasMissingEdits: true,
          hasTargetIssues: false,
          hasOverlapOrConflict: false,
          foundAdditionalArticleWork: true,
          underScopedKbImpact: true,
          delta: {
            summary: 'Add the related article coverage.',
            requestedChanges: ['Cover the related article.'],
            missingPbiIds: [],
            missingCreates: [],
            missingEdits: ['Related article'],
            additionalArticleWork: ['Related article'],
            targetCorrections: [],
            overlapConflicts: []
          }
        }, null, 2) + "\\n" + fence + "\\nSummary repeated after the fence.";
      } else {
        payload = {
          summary: 'Plan is approved.',
          verdict: 'approved',
          didAccountForEveryPbi: true,
          hasMissingCreates: false,
          hasMissingEdits: false,
          hasTargetIssues: false,
          hasOverlapOrConflict: false,
          foundAdditionalArticleWork: false,
          underScopedKbImpact: false,
          delta: {
            summary: 'No changes requested.',
            requestedChanges: [],
            missingPbiIds: [],
            missingCreates: [],
            missingEdits: [],
            additionalArticleWork: [],
            targetCorrections: [],
            overlapConflicts: []
          }
        };
      }
    } else if (promptText.includes('Execute only the approved plan items below.')) {
      workerCount += 1;
      if (workerCount === 1) {
        payload = {
          summary: 'Executed approved items and found one discovered item.',
          discoveredWork: [
            {
              discoveryId: 'discovery-1',
              discoveredAction: 'edit',
              suspectedTarget: 'Discovered article',
              reason: 'Worker found adjacent scope.',
              evidence: [{ kind: 'article', ref: 'article-2', summary: 'Adjacent article references the same workflow.' }],
              linkedPbiIds: ['pbi-1'],
              confidence: 0.68,
              requiresPlanAmendment: true
            }
          ]
        };
      } else {
        payload = {
          summary: workerCount === 2 ? 'Resumed worker execution after amendment.' : 'Completed final-review rework pass.',
          discoveredWork: []
        };
      }
    } else if (promptText.includes('You are the final reviewer for the batch.')) {
      finalReviewCount += 1;
      if (finalReviewCount === 1) {
        payload = {
          summary: 'One final rework pass is still needed.',
          verdict: 'needs_rework',
          allPbisMapped: true,
          planExecutionComplete: true,
          hasMissingArticleChanges: false,
          hasUnresolvedDiscoveredWork: false,
          delta: {
            summary: 'Run one cleanup recheck.',
            requestedRework: ['Perform the final rework pass.'],
            uncoveredPbiIds: [],
            missingArticleChanges: [],
            duplicateRiskTitles: [],
            unnecessaryChanges: [],
            unresolvedAmbiguities: []
          }
        };
      } else {
        payload = {
          summary: 'Final review approved.',
          verdict: 'approved',
          allPbisMapped: true,
          planExecutionComplete: true,
          hasMissingArticleChanges: false,
          hasUnresolvedDiscoveredWork: false,
          delta: {
            summary: 'No further work required.',
            requestedRework: [],
            uncoveredPbiIds: [],
            missingArticleChanges: [],
            duplicateRiskTitles: [],
            unnecessaryChanges: [],
            unresolvedAmbiguities: []
          }
        };
      }
    } else {
      payload = { text: 'noop' };
    }

    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { text: JSON.stringify(payload) } }) + '\\n');
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;
  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createPlannerRepairAcpBinary(root: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-batch-analysis-planner-repair-agent');
  const source = `#!/usr/bin/env node
const readline = require('node:readline');
const sessionId = 'fake-batch-analysis-repair-session';
let reviewCount = 0;
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
    const promptText = (((message.params || {}).prompt || [])[0] || {}).text || '';
    let payload;

    if (promptText.includes('Your previous planner response was not valid planner JSON')) {
      payload = {
        summary: 'Recovered draft plan after repair prompt.',
        coverage: [
          { pbiId: 'pbi-1', outcome: 'covered', planItemIds: ['item-1'] }
        ],
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1'],
            action: 'no_impact',
            targetType: 'article',
            targetTitle: 'Recovered planner article',
            reason: 'Repair prompt converted the batch into valid plan JSON.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported test PBI.' }],
            confidence: 0.88,
            executionStatus: 'pending'
          }
        ],
        openQuestions: []
      };
    } else if (promptText.includes('Create a complete structured batch analysis plan.')) {
      payload = 'Gathering KB evidence via the kb CLI: batch context, related articles, and targeted searches for food-list coverage.';
    } else if (promptText.includes('Review the submitted batch plan for completeness and correctness.')) {
      reviewCount += 1;
      payload = {
        summary: 'Recovered plan is approved.',
        verdict: 'approved',
        didAccountForEveryPbi: true,
        hasMissingCreates: false,
        hasMissingEdits: false,
        hasTargetIssues: false,
        hasOverlapOrConflict: false,
        foundAdditionalArticleWork: false,
        underScopedKbImpact: false,
        delta: {
          summary: 'No changes requested.',
          requestedChanges: [],
          missingPbiIds: [],
          missingCreates: [],
          missingEdits: [],
          additionalArticleWork: [],
          targetCorrections: [],
          overlapConflicts: []
        }
      };
    } else if (promptText.includes('Execute only the approved plan items below.')) {
      payload = {
        summary: 'Executed recovered plan.',
        discoveredWork: []
      };
    } else if (promptText.includes('You are the final reviewer for the batch.')) {
      payload = {
        summary: 'Final review approved.',
        verdict: 'approved',
        allPbisMapped: true,
        planExecutionComplete: true,
        hasMissingArticleChanges: false,
        hasUnresolvedDiscoveredWork: false,
        delta: {
          summary: 'No further work required.',
          requestedRework: [],
          uncoveredPbiIds: [],
          missingArticleChanges: [],
          duplicateRiskTitles: [],
          unnecessaryChanges: [],
          unresolvedAmbiguities: []
        }
      };
    } else {
      payload = { text: 'noop' };
    }

    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { text } }) + '\\n');
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;
  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createTruncatedPlannerRepairAcpBinary(root: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-batch-analysis-truncated-planner-agent');
  const source = `#!/usr/bin/env node
const readline = require('node:readline');
const sessionId = 'fake-batch-analysis-truncated-session';
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
    const promptText = (((message.params || {}).prompt || [])[0] || {}).text || '';
    let text = '';

    if (promptText.includes('Your previous planner response was not valid planner JSON')) {
      text = '{"summary":"OnecandidatePBIwasfullyassessed.","coverage":[{"pbiId":"pbi-1","outcome":"covered","planItemIds":["item-1","item-2"],"notes":"Recoveredcoverage."}],"items":[{"planItemId":"item-1","pbiIds":["pbi-1"],"action":"edit","targetType":"article","targetArticleId":"locale-1","targetFamilyId":"family-1","targetTitle":"EditaFoodItem","reason":"Recoverededititem.","evidence":[{"kind":"pbi","ref":"pbi-1","summary":"Recoveredevidence."}],"confidence":0.88,"executionStatus":"pending"},{"planItemId":"item-2","pbiIds":["pbi-1"],"action":"no_impact","targetType":"article","targetArticleId":"locale-2","targetFamilyId":"family-2","targetTitle":"CreateaFoodItem","reason":"Recoveredlegacyarticledecision.","evidence":[{"kind":"article","ref":"locale-2","summary":"Legacyarticle."}],"confidence":0.7,"executionStatus":"pending"},{"planItemId":"item-3"';
    } else if (promptText.includes('Create a complete structured batch analysis plan.')) {
      text = '{"summary":"Initialplanneroutputwastruncated.","coverage":[{"pbiId":"pbi-1","outcome":"covered","planItemIds":["item-1"],"notes":"Initialcoverage."}],"items":[{"planItemId":"item-1","pbiIds":["pbi-1"],"action":"edit","targetType":"article","targetTitle":"EditaFoodItem","reason":"Initialedititem.","evidence":[{"kind":"pbi","ref":"pbi-1","summary":"Initialevidence."}],"confidence":0.8,"executionStatus":"pending"';
    } else if (promptText.includes('Review the submitted batch plan for completeness and correctness.')) {
      text = JSON.stringify({
        summary: 'Recovered plan is approved.',
        verdict: 'approved',
        didAccountForEveryPbi: true,
        hasMissingCreates: false,
        hasMissingEdits: false,
        hasTargetIssues: false,
        hasOverlapOrConflict: false,
        foundAdditionalArticleWork: false,
        underScopedKbImpact: false,
        delta: {
          summary: 'No changes requested.',
          requestedChanges: [],
          missingPbiIds: [],
          missingCreates: [],
          missingEdits: [],
          additionalArticleWork: [],
          targetCorrections: [],
          overlapConflicts: []
        }
      });
    } else if (promptText.includes('Execute only the approved plan items below.')) {
      text = JSON.stringify({
        summary: 'Executed recovered truncated plan.',
        discoveredWork: []
      });
    } else if (promptText.includes('You are the final reviewer for the batch.')) {
      text = JSON.stringify({
        summary: 'Final review approved.',
        verdict: 'approved',
        allPbisMapped: true,
        planExecutionComplete: true,
        hasMissingArticleChanges: false,
        hasUnresolvedDiscoveredWork: false,
        delta: {
          summary: 'No further work required.',
          requestedRework: [],
          uncoveredPbiIds: [],
          missingArticleChanges: [],
          duplicateRiskTitles: [],
          unnecessaryChanges: [],
          unresolvedAmbiguities: []
        }
      });
    } else {
      text = JSON.stringify({ text: 'noop' });
    }

    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { text } }) + '\\n');
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;
  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function createLoggedBatchAnalysisAcpBinary(root: string, logPath: string, releasePath: string): Promise<string> {
  const binaryPath = path.join(root, 'agent');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');

const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
const releasePath = process.env.KBV_TEST_ACP_RELEASE_PATH;
const sessionId = 'fake-batch-analysis-logged-session';
let plannerPromptBlocked = false;

const startupArgs = process.argv.slice(2);
if (startupArgs.includes('--list-models') || startupArgs.includes('models')) {
  process.stdout.write(JSON.stringify([
    'gpt-5.4-high',
    'gpt-5.4[reasoning=medium,context=272k,fast=false]'
  ]) + '\\n');
  process.exit(0);
}

function append(entry) {
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\\n', 'utf8');
}

function respond(message, payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { text } }) + '\\n');
}

function releasePlannerPrompt(message, payload) {
  const timer = setInterval(() => {
    if (!fs.existsSync(releasePath)) {
      return;
    }
    clearInterval(timer);
    respond(message, payload);
  }, 25);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
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
    const promptText = (((message.params || {}).prompt || [])[0] || {}).text || '';

    if (promptText.includes('Create a complete structured batch analysis plan.')) {
      const payload = {
        summary: 'Initial draft plan.',
        coverage: [
          { pbiId: 'pbi-1', outcome: 'covered', planItemIds: ['item-1'] }
        ],
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1'],
            action: 'no_impact',
            targetType: 'article',
            targetTitle: 'Logged article',
            reason: 'Tracked for cache-isolation coverage.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported test PBI.' }],
            confidence: 0.92,
            executionStatus: 'pending'
          }
        ],
        openQuestions: []
      };

      if (!plannerPromptBlocked) {
        plannerPromptBlocked = true;
        releasePlannerPrompt(message, payload);
        return;
      }

      respond(message, payload);
      return;
    }

    if (promptText.includes('Review the submitted batch plan for completeness and correctness.')) {
      respond(message, {
        summary: 'Plan is approved.',
        verdict: 'approved',
        didAccountForEveryPbi: true,
        hasMissingCreates: false,
        hasMissingEdits: false,
        hasTargetIssues: false,
        hasOverlapOrConflict: false,
        foundAdditionalArticleWork: false,
        underScopedKbImpact: false,
        delta: {
          summary: 'No changes requested.',
          requestedChanges: [],
          missingPbiIds: [],
          missingCreates: [],
          missingEdits: [],
          additionalArticleWork: [],
          targetCorrections: [],
          overlapConflicts: []
        }
      });
      return;
    }

    if (promptText.includes('Execute only the approved plan items below.')) {
      respond(message, {
        summary: 'Executed approved items.',
        discoveredWork: []
      });
      return;
    }

    if (promptText.includes('You are the final reviewer for the batch.')) {
      respond(message, {
        summary: 'Final review approved.',
        verdict: 'approved',
        allPbisMapped: true,
        planExecutionComplete: true,
        hasMissingArticleChanges: false,
        hasUnresolvedDiscoveredWork: false,
        delta: {
          summary: 'No further work required.',
          requestedRework: [],
          uncoveredPbiIds: [],
          missingArticleChanges: [],
          duplicateRiskTitles: [],
          unnecessaryChanges: [],
          unresolvedAmbiguities: []
        }
      });
      return;
    }

    respond(message, { text: 'noop' });
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;
  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

async function readLoggedRequests(logPath: string): Promise<Array<{ method?: string; params?: Record<string, unknown> }>> {
  try {
    const contents = await readFile(logPath, 'utf8');
    return contents
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> });
  } catch {
    return [];
  }
}

async function waitForLoggedMethod(logPath: string, method: string, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const entries = await readLoggedRequests(logPath);
    if (entries.some((entry) => entry.method === method)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${method}`);
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
  let jobs: JobRegistry;
  let cleanup: () => Promise<void>;
  let createWorkspace: () => Promise<{ id: string }>;
  let previousCursorBinary: string | undefined;

  test.beforeEach(async () => {
    previousCursorBinary = process.env.KBV_CURSOR_BINARY;
    const harness = await createTestHarness();
    bus = harness.bus;
    jobs = harness.jobs;
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

    const deleteResp = await bus.execute({
      method: 'proposal.review.delete',
      payload: {
        workspaceId: workspace.id,
        proposalId: proposal.id
      }
    });
    expect(deleteResp.ok).toBe(true);
    expect((deleteResp.data as { deletedProposalId: string }).deletedProposalId).toBe(proposal.id);

    const listAfterDeleteResp = await bus.execute({
      method: 'proposal.review.list',
      payload: {
        workspaceId: workspace.id,
        batchId: imported.batch.id
      }
    });
    expect(listAfterDeleteResp.ok).toBe(true);
    expect((listAfterDeleteResp.data as { summary: { total: number } }).summary.total).toBe(0);

    const replacementResp = await bus.execute({
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
    expect(replacementResp.ok).toBe(true);
    const replacementProposal = replacementResp.data as { id: string };

    const decideResp = await bus.execute({
      method: 'proposal.review.decide',
      payload: {
        workspaceId: workspace.id,
        proposalId: replacementProposal.id,
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

  test('runs batch analysis through revision, amendment, and final rework loops', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch-analysis-commands-'));
    process.env.KBV_CURSOR_BINARY = await createFakeBatchAnalysisAcpBinary(isolatedRoot);

    try {
      const workspace = await createWorkspace();
      const importResp = await bus.execute({
        method: 'pbiBatch.import',
        payload: {
          workspaceId: workspace.id,
          sourceFileName: 'batch-analysis.csv',
          sourceContent: 'Id,Title,Description\n1,Loop Coverage,Verify orchestration loop coverage'
        }
      });
      expect(importResp.ok).toBe(true);
      const batchId = (importResp.data as { batch: { id: string } }).batch.id;

      const jobEvents: Array<{ state: string; progress: number; message?: string; metadata?: Record<string, unknown> }> = [];
      jobs.setEmitter((event) => {
        if (event.command === 'agent.analysis.run') {
          jobEvents.push(event);
        }
      });

      const job = await jobs.start('agent.analysis.run', {
        workspaceId: workspace.id,
        batchId
      });
      expect(job.state).toBe('SUCCEEDED');

      const latestResp = await bus.execute({
        method: 'agent.analysis.latest',
        payload: { workspaceId: workspace.id, batchId, limit: 0 }
      });
      expect(latestResp.ok).toBe(true);
      const latestData = latestResp.data as {
        orchestration?: {
          latestIteration?: { stage: string; role: string };
          latestApprovedPlan?: { items: Array<{ executionStatus: string }> };
          latestFinalReview?: { verdict: string };
        } | null;
      };
      expect(latestData.orchestration?.latestIteration?.stage).toBe('approved');
      expect(latestData.orchestration?.latestIteration?.role).toBe('final-reviewer');
      expect(latestData.orchestration?.latestApprovedPlan?.items.every((item) => item.executionStatus === 'executed')).toBeTruthy();
      expect(latestData.orchestration?.latestFinalReview?.verdict).toBe('approved');

      const inspectionResp = await bus.execute({
        method: 'batch.analysis.inspection.get',
        payload: { workspaceId: workspace.id, batchId }
      });
      expect(inspectionResp.ok).toBe(true);
      const inspection = inspectionResp.data as {
        plans: Array<{ verdict: string }>;
        reviews: Array<{ verdict: string }>;
        amendments: Array<{ status: string }>;
        finalReviewReworkPlans: Array<{ summary: string }>;
      };
      expect(inspection.plans.length).toBeGreaterThanOrEqual(4);
      expect(inspection.reviews.some((review) => review.verdict === 'needs_revision')).toBeTruthy();
      expect(inspection.amendments.some((amendment) => amendment.status === 'approved')).toBeTruthy();
      expect(inspection.finalReviewReworkPlans).toHaveLength(1);

      const runtimeResp = await bus.execute({
        method: 'batch.analysis.runtime.get',
        payload: { workspaceId: workspace.id, batchId }
      });
      expect(runtimeResp.ok).toBe(true);
      const runtime = runtimeResp.data as {
        stage: string;
        role: string;
        latestEventType: string;
        executionCounts: { total: number; executed: number };
      } | null;
      expect(runtime?.stage).toBe('approved');
      expect(runtime?.role).toBe('final-reviewer');
      expect(runtime?.latestEventType).toBe('iteration_completed');
      expect(runtime?.executionCounts.executed).toBe(runtime?.executionCounts.total);

      const eventsResp = await bus.execute({
        method: 'batch.analysis.events.get',
        payload: { workspaceId: workspace.id, batchId, limit: 100 }
      });
      expect(eventsResp.ok).toBe(true);
      const eventStream = eventsResp.data as {
        events: Array<{ eventType: string; stage: string; role: string }>;
      };
      expect(eventStream.events.some((event) => event.eventType === 'iteration_started')).toBeTruthy();
      expect(eventStream.events.some((event) => event.stage === 'worker_discovery_review')).toBeTruthy();
      expect(eventStream.events.some((event) => event.stage === 'reworking')).toBeTruthy();
      expect(eventStream.events.some((event) => event.eventType === 'iteration_completed')).toBeTruthy();

      expect(jobEvents.some((event) => {
        const orchestration = event.metadata?.orchestration as { stage?: string } | undefined;
        return orchestration?.stage === 'worker_discovery_review';
      })).toBeTruthy();
      expect(jobEvents.some((event) => {
        const orchestration = event.metadata?.orchestration as { stage?: string } | undefined;
        return orchestration?.stage === 'final_reviewing';
      })).toBeTruthy();
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  test('repairs planner output when the first planning response is not valid JSON', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch-analysis-planner-repair-'));
    process.env.KBV_CURSOR_BINARY = await createPlannerRepairAcpBinary(isolatedRoot);

    try {
      const workspace = await createWorkspace();
      const importResp = await bus.execute({
        method: 'pbiBatch.import',
        payload: {
          workspaceId: workspace.id,
          sourceFileName: 'planner-repair.csv',
          sourceContent: 'Id,Title,Description\n1,Planner Repair,Verify planner JSON repair flow'
        }
      });
      expect(importResp.ok).toBe(true);
      const batchId = (importResp.data as { batch: { id: string } }).batch.id;

      const jobEvents: Array<{ state: string; progress: number; message?: string; metadata?: Record<string, unknown> }> = [];
      jobs.setEmitter((event) => {
        if (event.command === 'agent.analysis.run') {
          jobEvents.push(event);
        }
      });

      const job = await jobs.start('agent.analysis.run', {
        workspaceId: workspace.id,
        batchId
      });
      expect(job.state).toBe('SUCCEEDED');
      expect(jobEvents.some((event) => event.message?.includes('Planner returned non-JSON or incomplete output'))).toBeTruthy();

      const latestResp = await bus.execute({
        method: 'agent.analysis.latest',
        payload: { workspaceId: workspace.id, batchId, limit: 0 }
      });
      expect(latestResp.ok).toBe(true);
      const latestData = latestResp.data as {
        orchestration?: {
          latestIteration?: { stage: string; role: string };
          latestApprovedPlan?: { summary?: string; items: Array<{ targetTitle: string; executionStatus: string }> };
          latestFinalReview?: { verdict: string };
        } | null;
      };
      expect(latestData.orchestration?.latestIteration?.stage).toBe('approved');
      expect(latestData.orchestration?.latestApprovedPlan?.summary).toBe('Recovered draft plan after repair prompt.');
      expect(latestData.orchestration?.latestApprovedPlan?.items[0]?.targetTitle).toBe('Recovered planner article');
      expect(latestData.orchestration?.latestApprovedPlan?.items[0]?.executionStatus).toBe('executed');
      expect(latestData.orchestration?.latestFinalReview?.verdict).toBe('approved');
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  test('salvages truncated planner repair output into a registered plan instead of escalating', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch-analysis-truncated-planner-'));
    process.env.KBV_CURSOR_BINARY = await createTruncatedPlannerRepairAcpBinary(isolatedRoot);

    try {
      const workspace = await createWorkspace();
      const importResp = await bus.execute({
        method: 'pbiBatch.import',
        payload: {
          workspaceId: workspace.id,
          sourceFileName: 'truncated-planner.csv',
          sourceContent: 'Id,Title,Description\n1,Truncated Planner,Verify truncated planner recovery'
        }
      });
      expect(importResp.ok).toBe(true);
      const batchId = (importResp.data as { batch: { id: string } }).batch.id;

      const job = await jobs.start('agent.analysis.run', {
        workspaceId: workspace.id,
        batchId
      });
      expect(job.state).toBe('SUCCEEDED');

      const latestResp = await bus.execute({
        method: 'agent.analysis.latest',
        payload: { workspaceId: workspace.id, batchId, limit: 0 }
      });
      expect(latestResp.ok).toBe(true);
      const latestData = latestResp.data as {
        orchestration?: {
          latestIteration?: { stage: string; role: string };
          latestApprovedPlan?: { summary?: string; items: Array<{ targetTitle: string; executionStatus: string }> };
          latestFinalReview?: { verdict: string };
        } | null;
      };

      expect(latestData.orchestration?.latestIteration?.stage).toBe('approved');
      expect(latestData.orchestration?.latestApprovedPlan?.summary).toContain('One candidate PBI');
      expect(latestData.orchestration?.latestApprovedPlan?.items.length).toBeGreaterThanOrEqual(2);
      expect(latestData.orchestration?.latestApprovedPlan?.items[0]?.targetTitle).toBe('Edit a Food Item');
      expect(latestData.orchestration?.latestFinalReview?.verdict).toBe('approved');
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  test('runtime options lookup does not start a second ACP session during batch analysis', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch-analysis-runtime-options-'));
    const logPath = path.join(isolatedRoot, 'acp-log.jsonl');
    const releasePath = path.join(isolatedRoot, 'release-planner.txt');
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    process.env.KBV_TEST_ACP_RELEASE_PATH = releasePath;
    process.env.KBV_CURSOR_BINARY = await createLoggedBatchAnalysisAcpBinary(isolatedRoot, logPath, releasePath);

    try {
      const workspace = await createWorkspace();
      const settingsResp = await bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          agentModelId: 'gpt-5.4-high',
          acpModelId: 'gpt-5.4[reasoning=medium,context=272k,fast=false]'
        }
      });
      expect(settingsResp.ok).toBe(true);

      const importResp = await bus.execute({
        method: 'pbiBatch.import',
        payload: {
          workspaceId: workspace.id,
          sourceFileName: 'runtime-options-isolation.csv',
          sourceContent: 'Id,Title,Description\n1,Runtime Options Isolation,Verify runtime options reads do not restart ACP analysis sessions'
        }
      });
      expect(importResp.ok).toBe(true);
      const batchId = (importResp.data as { batch: { id: string } }).batch.id;

      const jobPromise = jobs.start('agent.analysis.run', {
        workspaceId: workspace.id,
        batchId
      });

      await waitForLoggedMethod(logPath, 'session/prompt');

      const runtimeOptionsResp = await bus.execute({
        method: 'agent.runtime.options.get',
        payload: { workspaceId: workspace.id }
      });
      expect(runtimeOptionsResp.ok).toBe(true);

      await writeFile(releasePath, 'release', 'utf8');

      const job = await jobPromise;
      expect(job.state).toBe('SUCCEEDED');

      const requests = await readLoggedRequests(logPath);
      const sessionNewRequests = requests.filter((entry) => entry.method === 'session/new');
      const setModelRequests = requests.filter((entry) => entry.method === 'session/set_model');

      expect(sessionNewRequests).toHaveLength(1);
      expect(setModelRequests).toHaveLength(1);
      expect(setModelRequests[0]?.params).toMatchObject({
        modelId: 'gpt-5.4[reasoning=medium,context=272k,fast=false]'
      });
    } finally {
      delete process.env.KBV_TEST_ACP_LOG_PATH;
      delete process.env.KBV_TEST_ACP_RELEASE_PATH;
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  test('supports the global AI assistant flows across article, draft, proposal, and template contexts', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-global-ai-commands-'));
    process.env.KBV_CURSOR_BINARY = await createFakeAcpBinary(isolatedRoot);
    const harness = await createTestHarness();

    try {
      const workspace = await harness.createWorkspace();

      const familyResp = await harness.bus.execute({
        method: 'articleFamily.create',
        payload: {
          workspaceId: workspace.id,
          externalKey: 'kb-global-ai',
          title: 'Global AI Commands'
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
          sourceHtml: '<h1>Draft Commands</h1><p>Original global draft.</p>'
        }
      });
      expect(branchResp.ok).toBe(true);
      const branch = branchResp.data as { branch: { id: string; headRevisionId: string } };

      const draftTurn = await harness.bus.execute({
        method: 'ai.assistant.message.send',
        payload: {
          workspaceId: workspace.id,
          context: {
            workspaceId: workspace.id,
            route: AppRoute.DRAFTS,
            routeLabel: 'Drafts',
            subject: {
              type: 'draft_branch',
              id: branch.branch.id,
              title: 'Global Draft',
              locale: 'en-us'
            },
            workingState: {
              kind: 'article_html',
              versionToken: branch.branch.headRevisionId,
              payload: { html: '<h1>Draft Commands</h1><p>Original global draft.</p>' }
            },
            capabilities: {
              canChat: true,
              canCreateProposal: false,
              canPatchProposal: false,
              canPatchDraft: true,
              canPatchTemplate: false,
              canUseUnsavedWorkingState: true
            },
            backingData: {
              branchId: branch.branch.id,
              localeVariantId: localeVariant.id
            }
          },
          message: 'Tighten this draft.'
        }
      });
      expect(draftTurn.ok).toBe(true);
      expect((draftTurn.data as { artifact?: { artifactType: string } }).artifact?.artifactType).toBe('draft_patch');
      expect((draftTurn.data as { uiActions: Array<{ type: string; html?: string }> }).uiActions[0]).toMatchObject({
        type: 'replace_working_html',
        html: '<h1>Draft Commands</h1><p>AI refined draft.</p>'
      });

      const templateTurn = await harness.bus.execute({
        method: 'ai.assistant.message.send',
        payload: {
          workspaceId: workspace.id,
          context: {
            workspaceId: workspace.id,
            route: AppRoute.TEMPLATES_AND_PROMPTS,
            routeLabel: 'Templates & Prompts',
            subject: {
              type: 'template_pack',
              id: 'new-template',
              title: 'New Template',
              locale: 'en-us'
            },
            workingState: {
              kind: 'template_pack',
              versionToken: 'new-template:1',
              payload: {
                name: 'New Template',
                language: 'en-us',
                templateType: 'faq',
                promptTemplate: 'Answer clearly.',
                toneRules: 'Be helpful.'
              }
            },
            capabilities: {
              canChat: true,
              canCreateProposal: false,
              canPatchProposal: false,
              canPatchDraft: false,
              canPatchTemplate: true,
              canUseUnsavedWorkingState: true
            },
            backingData: {}
          },
          message: 'Improve this template.'
        }
      });
      expect(templateTurn.ok).toBe(true);
      expect((templateTurn.data as { artifact?: { artifactType: string } }).artifact?.artifactType).toBe('template_patch');

      const articleTurn = await harness.bus.execute({
        method: 'ai.assistant.message.send',
        payload: {
          workspaceId: workspace.id,
          context: {
            workspaceId: workspace.id,
            route: AppRoute.ARTICLE_EXPLORER,
            routeLabel: 'Article Explorer',
            subject: {
              type: 'article',
              id: localeVariant.id,
              title: 'Global AI Commands',
              locale: 'en-us'
            },
            workingState: {
              kind: 'none',
              payload: null
            },
            capabilities: {
              canChat: true,
              canCreateProposal: true,
              canPatchProposal: false,
              canPatchDraft: false,
              canPatchTemplate: false,
              canUseUnsavedWorkingState: false
            },
            backingData: {
              familyId: family.id,
              localeVariantId: localeVariant.id,
              sourceRevisionId: 'source-revision-1',
              sourceHtml: '<h1>Global AI Commands</h1><p>Live article.</p>'
            }
          },
          message: 'Prepare an edit proposal for this live article.'
        }
      });
      expect(articleTurn.ok).toBe(true);
      const articleData = articleTurn.data as { session: { id: string }; artifact?: { id: string; artifactType: string; status: string } };
      expect(articleData.artifact?.artifactType).toBe('proposal_candidate');
      expect(articleData.artifact?.status).toBe('pending');

      const appliedCandidate = await harness.bus.execute({
        method: 'ai.assistant.artifact.apply',
        payload: {
          workspaceId: workspace.id,
          sessionId: articleData.session.id,
          artifactId: articleData.artifact?.id
        }
      });
      expect(appliedCandidate.ok).toBe(true);
      const proposalId = (appliedCandidate.data as { createdProposalId?: string }).createdProposalId;
      expect(proposalId).toBeTruthy();

      const proposalDetail = await harness.bus.execute({
        method: 'proposal.review.get',
        payload: {
          workspaceId: workspace.id,
          proposalId
        }
      });
      expect(proposalDetail.ok).toBe(true);
      const detail = proposalDetail.data as { diff: { afterHtml: string }; proposal: { id: string; updatedAtUtc: string; targetLocale?: string; confidenceScore?: number } };
      expect(detail.proposal.confidenceScore).toBe(0.81);

      const proposalTurn = await harness.bus.execute({
        method: 'ai.assistant.message.send',
        payload: {
          workspaceId: workspace.id,
          context: {
            workspaceId: workspace.id,
            route: AppRoute.PROPOSAL_REVIEW,
            routeLabel: 'Proposal Review',
            subject: {
              type: 'proposal',
              id: proposalId,
              title: 'Global AI Commands',
              locale: detail.proposal.targetLocale ?? 'en-us'
            },
            workingState: {
              kind: 'proposal_html',
              versionToken: `${detail.proposal.id}:${detail.proposal.updatedAtUtc}`,
              payload: {
                html: detail.diff.afterHtml
              }
            },
            capabilities: {
              canChat: true,
              canCreateProposal: false,
              canPatchProposal: true,
              canPatchDraft: false,
              canPatchTemplate: false,
              canUseUnsavedWorkingState: true
            },
            backingData: {
              proposalId,
              localeVariantId: localeVariant.id
            }
          },
          message: 'Refine this proposal.'
        }
      });
      expect(proposalTurn.ok).toBe(true);
      expect((proposalTurn.data as { artifact?: { artifactType: string; status: string } }).artifact?.artifactType).toBe('proposal_patch');
      expect((proposalTurn.data as { artifact?: { status: string } }).artifact?.status).toBe('applied');

      const refreshedProposal = await harness.bus.execute({
        method: 'proposal.review.get',
        payload: {
          workspaceId: workspace.id,
          proposalId
        }
      });
      expect(refreshedProposal.ok).toBe(true);
      expect((refreshedProposal.data as { diff: { afterHtml: string } }).diff.afterHtml).toContain('AI refined proposal');
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
