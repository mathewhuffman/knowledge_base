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
const fs = require('node:fs');
const readline = require('node:readline');
const sessionId = 'fake-acp-session';
const logPath = process.env.KBV_TEST_ACP_LOG_PATH;

function append(entry) {
  if (!logPath) {
    return;
  }
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\\n', 'utf8');
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
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId } }) + '\\n');
    return;
  }
    if (message.method === 'session/prompt') {
      const promptText = (((message.params || {}).prompt || [])[0] || {}).text || '';
      let payload;
      if (promptText.includes('Route: drafts')) {
        payload = {
          command: 'patch_draft',
          artifactType: 'draft_patch',
          completionState: 'completed',
          isFinal: true,
          response: 'I tightened the draft copy.',
          summary: 'Refined the draft.',
          html: '<h1>Draft Commands</h1><p>AI refined draft.</p>'
        };
      } else if (promptText.includes('Route: templates_and_prompts')) {
        payload = {
          command: 'patch_template',
          artifactType: 'template_patch',
          completionState: 'completed',
          isFinal: true,
          response: 'I strengthened the template guidance.',
          summary: 'Updated the template fields.',
          formPatch: {
            toneRules: 'Be concise, concrete, and action-oriented.',
            description: 'Template updated by the assistant.'
          }
        };
      } else if (promptText.includes('Route: article_explorer')) {
        payload = {
          command: 'create_proposal',
          artifactType: 'proposal_candidate',
          completionState: 'completed',
          isFinal: true,
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
          command: 'patch_proposal',
          artifactType: 'proposal_patch',
          completionState: 'completed',
          isFinal: true,
          response: 'I refined the proposal working copy.',
          summary: 'Updated the proposal draft.',
          title: 'Batch 9 Commands Refined',
          rationale: 'Made the rationale more specific.',
          html: '<h1>Batch 9 Commands Refined</h1><p>AI refined proposal.</p>'
        };
      } else {
        payload = {
          command: 'none',
          artifactType: 'informational_response',
          completionState: 'completed',
          isFinal: true,
          response: 'AI tightened the article.',
          summary: 'AI tightened the article.',
          updatedHtml: '<h1>Draft Commands</h1><p>AI refined draft.</p>'
        };
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

async function createAssistantChatCorruptStreamBinary(root: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-assistant-chat-corrupt-stream');
  const source = `#!/usr/bin/env node
const readline = require('node:readline');
const sessionId = 'fake-assistant-chat-corrupt-stream';
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
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        text: 'Areas are the main container. Schedules define when an area runs, and setups define how that area is organized.'
      }
    }) + '\\n');

    const corruptUpdate = {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: 'Areas are the main container. It represents a of operation section the where people work. =Area the section of the business'
          }
        }
      }
    };
    setTimeout(() => {
      process.stdout.write(JSON.stringify(corruptUpdate) + '\\n');
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

async function createFakeBatchAnalysisAcpBinary(root: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-batch-analysis-agent');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
let reviewCount = 0;
let workerCount = 0;
let finalReviewCount = 0;
let sessionCount = 0;

function append(entry) {
  if (!logPath) {
    return;
  }
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\\n', 'utf8');
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
    sessionCount += 1;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'fake-batch-analysis-session-' + sessionCount } }) + '\\n');
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
          { pbiId: '1', outcome: 'covered', planItemIds: discoveredAmendment ? ['item-1', 'item-2'] : ['item-1'] }
        ],
        items: discoveredAmendment ? [
          {
            planItemId: 'item-1',
            pbiIds: ['1'],
            action: 'create',
            targetType: 'new_article',
            targetTitle: 'Primary article',
            reason: 'Tracked for test coverage.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported test PBI.' }],
            confidence: 0.9,
            executionStatus: 'pending'
          },
          {
            planItemId: 'item-2',
            pbiIds: ['1'],
            action: 'create',
            targetType: 'new_article',
            targetTitle: 'Discovered article',
            reason: 'Amendment added discovered scope for loop testing.',
            evidence: [{ kind: 'review', ref: 'discovery-1', summary: 'Worker discovered related article work.' }],
            confidence: 0.74,
            executionStatus: 'pending'
          }
        ] : [
          {
            planItemId: 'item-1',
            pbiIds: ['1'],
            action: 'create',
            targetType: 'new_article',
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
              linkedPbiIds: ['1'],
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

async function createUserInputBatchAnalysisAcpBinary(root: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-batch-analysis-user-input-agent');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
let sessionCount = 0;

function append(entry) {
  if (!logPath) {
    return;
  }
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\\n', 'utf8');
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
    sessionCount += 1;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'fake-batch-analysis-user-input-session-' + sessionCount } }) + '\\n');
    return;
  }
  if (message.method === 'session/prompt') {
    const promptText = (((message.params || {}).prompt || [])[0] || {}).text || '';
    let payload;

    if (promptText.includes('Create a complete structured batch analysis plan.')) {
      const resumedWithAnswer = promptText.includes('resolvedUserAnswers') && promptText.includes('Include Delete a Food List');
      payload = resumedWithAnswer
        ? {
            summary: 'Revised plan now includes Delete a Food List before worker execution.',
            coverage: [
              { pbiId: '1', outcome: 'covered', planItemIds: ['item-1', 'item-2'] }
            ],
            items: [
              {
                planItemId: 'item-1',
                pbiIds: ['1'],
                action: 'create',
                targetType: 'new_article',
                targetTitle: 'Create a Food List',
                reason: 'The batch still needs the create flow article.',
                evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported test PBI.' }],
                confidence: 0.9,
                executionStatus: 'pending'
              },
              {
                planItemId: 'item-2',
                pbiIds: ['1'],
                action: 'create',
                targetType: 'new_article',
                targetTitle: 'Delete a Food List',
                reason: 'User confirmed Delete a Food List belongs in scope and should be covered before worker execution.',
                evidence: [{ kind: 'review', ref: 'question-delete-food-list', summary: 'User answered the scope question during batch analysis.' }],
                confidence: 0.84,
                executionStatus: 'pending'
              }
            ],
            questions: [],
            openQuestions: []
          }
        : {
            summary: 'Initial draft plan leaves Delete a Food List unresolved.',
            coverage: [
              { pbiId: '1', outcome: 'covered', planItemIds: ['item-1'] }
            ],
            items: [
              {
                planItemId: 'item-1',
                pbiIds: ['1'],
                action: 'create',
                targetType: 'new_article',
                targetTitle: 'Create a Food List',
                reason: 'Initial draft only covers create flow.',
                evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported test PBI.' }],
                confidence: 0.9,
                executionStatus: 'pending'
              }
            ],
            questions: [
              {
                id: 'question-delete-food-list',
                prompt: 'Should Delete a Food List be included in this batch or explicitly deferred?',
                reason: 'Planner found the Delete a Food List scope gap, and that product intent must be confirmed before approval.',
                requiresUserInput: true,
                linkedPbiIds: ['1'],
                linkedPlanItemIds: ['item-1'],
                linkedDiscoveryIds: []
              }
            ],
            openQuestions: ['Should Delete a Food List be included in this batch or explicitly deferred?']
          };
    } else if (promptText.includes('Review the submitted batch plan for completeness and correctness.')) {
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
    } else if (promptText.includes('Execute only the approved plan items below.')) {
      payload = {
        summary: 'Worker executed the approved user-resolved plan.',
        discoveredWork: []
      };
    } else if (promptText.includes('You are the final reviewer for the batch.')) {
      payload = {
        summary: 'Final review approved after the user-resolved plan ran.',
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

async function createUnresolvedGapBatchAnalysisAcpBinary(root: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-batch-analysis-unresolved-gap-agent');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const logPath = process.env.KBV_TEST_ACP_LOG_PATH;
let sessionCount = 0;

function append(entry) {
  if (!logPath) {
    return;
  }
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\\n', 'utf8');
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
    sessionCount += 1;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'fake-batch-analysis-unresolved-gap-session-' + sessionCount } }) + '\\n');
    return;
  }
  if (message.method === 'session/prompt') {
    const promptText = (((message.params || {}).prompt || [])[0] || {}).text || '';
    let payload;

    if (promptText.includes('Create a complete structured batch analysis plan.')) {
      payload = {
        summary: 'Draft plan still leaves one required PBI unresolved.',
        coverage: [
          { pbiId: '1', outcome: 'covered', planItemIds: ['item-1'] },
          { pbiId: '2', outcome: 'gap', planItemIds: [] }
        ],
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['1'],
            action: 'create',
            targetType: 'new_article',
            targetTitle: 'Covered article',
            reason: 'Only the first PBI is covered in this intentionally incomplete plan.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported test PBI.' }],
            confidence: 0.83,
            executionStatus: 'pending'
          }
        ],
        openQuestions: []
      };
    } else if (promptText.includes('Review the submitted batch plan for completeness and correctness.')) {
      payload = {
        summary: 'Reviewer incorrectly claims the plan is approved.',
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
        summary: 'Worker should never run for unresolved gap coverage.',
        discoveredWork: []
      };
    } else if (promptText.includes('You are the final reviewer for the batch.')) {
      payload = {
        summary: 'Final review should never run for unresolved gap coverage.',
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

async function createLoggedSuccessfulBatchAnalysisAcpBinary(root: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-batch-analysis-mode-parity-agent');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const sessionId = 'fake-batch-analysis-mode-parity-session';
const logPath = process.env.KBV_TEST_ACP_LOG_PATH;

function append(entry) {
  if (!logPath) {
    return;
  }
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\\n', 'utf8');
}

function inferTargetTitle(promptText) {
  if (promptText.includes('MCP analysis')) {
    return 'MCP analysis';
  }
  if (promptText.includes('CLI analysis')) {
    return 'CLI analysis';
  }
  return 'Batch parity article';
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
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId } }) + '\\n');
    return;
  }
  if (message.method === 'session/prompt') {
    const promptText = (((message.params || {}).prompt || [])[0] || {}).text || '';
    let payload;

    if (promptText.includes('Create a complete structured batch analysis plan.')) {
      const targetTitle = inferTargetTitle(promptText);
      payload = {
        summary: 'Parity plan creates the required KB article.',
        coverage: [
          { pbiId: '1', outcome: 'covered', planItemIds: ['item-1'] }
        ],
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['1'],
            action: 'create',
            targetType: 'new_article',
            targetTitle,
            reason: 'Create the KB article that the parity batch requests.',
            evidence: [{ kind: 'pbi', ref: '1', summary: 'Imported parity test PBI.' }],
            confidence: 0.94,
            executionStatus: 'pending'
          }
        ],
        openQuestions: []
      };
    } else if (promptText.includes('Review the submitted batch plan for completeness and correctness.')) {
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
    } else if (promptText.includes('Execute only the approved plan items below.')) {
      payload = {
        summary: 'Worker completed the approved parity plan.',
        discoveredWork: []
      };
    } else if (promptText.includes('You are the final reviewer for the batch.')) {
      payload = {
        summary: 'Final review approved the parity batch.',
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

async function createDeterministicPrefetchBatchAcpBinary(root: string): Promise<{ binaryPath: string; configPath: string }> {
  const binaryPath = path.join(root, 'fake-batch-analysis-deterministic-prefetch-agent');
  const configPath = path.join(root, 'deterministic-prefetch-config.json');
const source = `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
const sessionId = 'fake-batch-analysis-deterministic-prefetch-session';
const configPath = ${JSON.stringify(configPath)};
let reviewCount = 0;
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}
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
    const config = loadConfig();
    let payload;

    if (promptText.includes('Create a complete structured batch analysis plan.')) {
      const revised = promptText.includes('Reviewer delta summary:');
      const teamDashboard = config.teamDashboard || {};
      const leadershipTileSettings = config.leadershipTileSettings || {};
      payload = revised
        ? {
            summary: 'Revised plan now targets the existing KB articles.',
            coverage: [
              { pbiId: '101', outcome: 'covered', planItemIds: ['item-1'] },
              { pbiId: '102', outcome: 'covered', planItemIds: ['item-2'] }
            ],
            items: [
              {
                planItemId: 'item-1',
                pbiIds: ['101'],
                action: 'edit',
                targetType: 'article',
                ...(teamDashboard.localeVariantId ? { targetArticleId: teamDashboard.localeVariantId } : {}),
                ...(teamDashboard.familyId ? { targetFamilyId: teamDashboard.familyId } : {}),
                targetTitle: 'Team Dashboard',
                reason: 'Existing Team Dashboard article should be updated instead of creating a new article.',
                evidence: [{ kind: 'search', ref: 'cluster-1', summary: 'Deterministic prefetch found the existing Team Dashboard article.' }],
                confidence: 0.92,
                executionStatus: 'pending'
              },
              {
                planItemId: 'item-2',
                pbiIds: ['102'],
                action: 'edit',
                targetType: 'article',
                ...(leadershipTileSettings.localeVariantId ? { targetArticleId: leadershipTileSettings.localeVariantId } : {}),
                ...(leadershipTileSettings.familyId ? { targetFamilyId: leadershipTileSettings.familyId } : {}),
                targetTitle: 'Leadership Tile Settings',
                reason: 'Existing Leadership Tile Settings article should be updated.',
                evidence: [{ kind: 'search', ref: 'cluster-2', summary: 'Deterministic prefetch found the existing Leadership Tile Settings article.' }],
                confidence: 0.88,
                executionStatus: 'pending'
              }
            ],
            openQuestions: []
          }
        : {
            summary: 'Initial plan proposes one new article.',
            coverage: [
              { pbiId: '101', outcome: 'covered', planItemIds: ['item-1'] },
              { pbiId: '102', outcome: 'covered', planItemIds: ['item-1'] }
            ],
            items: [
              {
                planItemId: 'item-1',
                pbiIds: ['101', '102'],
                action: 'create',
                targetType: 'new_article',
                targetTitle: 'New dashboard leadership guide',
                reason: 'Bundle the work into a new article.',
                evidence: [{ kind: 'pbi', ref: '101', summary: 'Dashboard update request.' }],
                confidence: 0.73,
                executionStatus: 'pending'
              }
            ],
            openQuestions: []
          };
    } else if (promptText.includes('Review the submitted batch plan for completeness and correctness.')) {
      reviewCount += 1;
      payload = reviewCount === 1
        ? {
            summary: 'Plan looks acceptable.',
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
          }
        : {
            summary: 'Revised plan is approved.',
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
        summary: 'Worker executed the approved plan without discovering extra scope.',
        discoveredWork: []
      };
    } else if (promptText.includes('You are the final reviewer for the batch.')) {
      payload = {
        summary: 'Final review approved the batch.',
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

    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { text: JSON.stringify(payload) } }) + '\\n');
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;
  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return { binaryPath, configPath };
}

async function createInvalidTargetRepairBatchAcpBinary(root: string): Promise<{ binaryPath: string; configPath: string }> {
  const binaryPath = path.join(root, 'fake-batch-analysis-invalid-target-repair-agent');
  const configPath = path.join(root, 'invalid-target-config.json');
  const source = `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
const sessionId = 'fake-batch-analysis-invalid-target-repair-session';
const configPath = ${JSON.stringify(configPath)};
const rl = readline.createInterface({ input: process.stdin });
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}
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
    const config = loadConfig() || {};
    let payload;

    if (promptText.includes('Create a complete structured batch analysis plan.')) {
      payload = {
        summary: 'Planner returned one no-impact target with a malformed locale variant ID.',
        coverage: [
          { pbiId: config.invalidPbiId || '301', outcome: 'covered', planItemIds: ['item-1'] }
        ],
        items: [
          {
            planItemId: 'item-1',
            pbiIds: [config.invalidPbiId || '301'],
            action: 'no_impact',
            targetType: 'article',
            targetArticleId: config.invalidLocaleVariantId,
            targetFamilyId: config.familyId,
            targetTitle: config.targetTitle || 'Create a Food Item',
            reason: 'This adjacent article should remain no-impact after review.',
            evidence: [
              { kind: 'pbi', ref: 'externalId:' + (config.truncatedExternalId || '301'), summary: 'Imported batch evidence.' },
              { kind: 'search', ref: 'test-search', summary: 'Search surfaced the adjacent live article.' }
            ],
            confidence: 0.86,
            executionStatus: 'pending'
          }
        ],
        openQuestions: []
      };
    } else if (promptText.includes('Review the submitted batch plan for completeness and correctness.')) {
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
    } else if (promptText.includes('Execute only the approved plan items below.')) {
      payload = {
        summary: 'Worker executed the approved plan without discovering extra scope.',
        discoveredWork: []
      };
    } else if (promptText.includes('You are the final reviewer for the batch.')) {
      payload = {
        summary: 'Final review approved the batch.',
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

    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { text: JSON.stringify(payload) } }) + '\\n');
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
});
`;
  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return { binaryPath, configPath };
}

async function createCliPolicyFallbackBatchAnalysisAcpBinary(root: string): Promise<{ binaryPath: string; configPath: string }> {
  const binaryPath = path.join(root, 'fake-batch-analysis-cli-policy-fallback-agent');
  const configPath = path.join(root, 'cli-policy-fallback-config.json');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
let sessionCounter = 0;
let currentSessionId = '';
let currentTransport = 'cli';
let cliWorkerPromptCount = 0;
const rl = readline.createInterface({ input: process.stdin });
const configPath = ${JSON.stringify(configPath)};
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  const message = JSON.parse(trimmed);
  if (message.method === 'initialize' || message.method === 'authenticate') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
    return;
  }
  if (message.method === 'session/new') {
    sessionCounter += 1;
    currentTransport = Array.isArray(message.params?.mcpServers) && message.params.mcpServers.length > 0 ? 'mcp' : 'cli';
    currentSessionId = 'fake-batch-analysis-' + currentTransport + '-' + sessionCounter;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId: currentSessionId } }) + '\\n');
    return;
  }
  if (message.method === 'session/prompt') {
    const promptText = (((message.params || {}).prompt || [])[0] || {}).text || '';
    const config = loadConfig();
    let payload;

    if (promptText.includes('Create a complete structured batch analysis plan.')) {
      payload = {
        summary: 'Planner draft for fallback coverage.',
        coverage: [
          { pbiId: 'pbi-1', outcome: 'covered', planItemIds: ['item-1'] }
        ],
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1'],
            action: 'edit',
            targetType: 'article',
            targetArticleId: config.localeVariantId,
            targetFamilyId: config.familyId,
            targetTitle: config.targetTitle || 'Checklist Policy Retry',
            reason: 'Used to exercise CLI fallback handling.',
            evidence: [{ kind: 'pbi', ref: 'externalId:1', summary: 'Imported test PBI.' }],
            confidence: 0.88,
            executionStatus: 'pending'
          }
        ],
        openQuestions: []
      };
    } else if (promptText.includes('Review the submitted batch plan for completeness and correctness.')) {
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
    } else if (promptText.includes('Execute only the approved plan items below.')) {
      if (currentTransport === 'cli') {
        cliWorkerPromptCount += 1;
        payload = {
          summary: 'CLI worker finished but hit a blocked shell after research.',
          discoveredWork: []
        };
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { text: JSON.stringify(payload) } }) + '\\n');
        const illegalTool = {
          jsonrpc: '2.0',
          method: 'session/update',
          params: {
            sessionId: currentSessionId,
            update: {
              sessionUpdate: 'tool_call',
              toolCallId: 'cli-shell-tool',
              title: 'Shell',
              kind: 'terminal',
              rawInput: {
                command: 'pwd'
              }
            }
          }
        };
        setTimeout(() => {
          process.stdout.write(JSON.stringify(illegalTool) + '\\n');
        }, 10);
        return;
      }

      payload = {
        summary: 'MCP worker completed after the CLI policy violation.',
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
      payload = { summary: currentTransport + ' default payload' };
    }

    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { text: JSON.stringify(payload) } }) + '\\n');
    return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } }) + '\\n');
	});
	`;
  await writeFile(binaryPath, source, 'utf8');
  await chmod(binaryPath, 0o755);
  return { binaryPath, configPath };
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
          { pbiId: '1', outcome: 'covered', planItemIds: ['item-1'] }
        ],
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['1'],
            action: 'create',
            targetType: 'new_article',
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

async function createPlannerRuntimeRetryAcpBinary(root: string): Promise<string> {
  const binaryPath = path.join(root, 'fake-batch-analysis-planner-runtime-retry-agent');
  const source = `#!/usr/bin/env node
const readline = require('node:readline');
let sessionCounter = 0;
let plannerPromptCount = 0;
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
    sessionCounter += 1;
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: { sessionId: 'fake-batch-analysis-runtime-retry-session-' + String(sessionCounter) }
    }) + '\\n');
    return;
  }
  if (message.method === 'session/prompt') {
    const promptText = (((message.params || {}).prompt || [])[0] || {}).text || '';
    let payload;

    if (promptText.includes('Your previous planner answer did not arrive as a complete planner JSON object.')) {
      payload = 'Error: S: [resource_exhausted] Error';
    } else if (promptText.includes('Create a complete structured batch analysis plan.')) {
      plannerPromptCount += 1;
      if (plannerPromptCount === 1) {
        payload = 'Planner result malformed @@ incomplete planner payload @@';
      } else {
        payload = {
          summary: 'Recovered draft plan after a fresh-session retry.',
          coverage: [
            { pbiId: '1', outcome: 'covered', planItemIds: ['item-1'] }
          ],
          items: [
            {
              planItemId: 'item-1',
              pbiIds: ['1'],
              action: 'create',
              targetType: 'new_article',
              targetTitle: 'Recovered planner article',
              reason: 'A fresh local session recovered from the provider error.',
              evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported test PBI.' }],
              confidence: 0.86,
              executionStatus: 'pending'
            }
          ],
          openQuestions: []
        };
      }
    } else if (promptText.includes('Review the submitted batch plan for completeness and correctness.')) {
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
    } else if (promptText.includes('Execute only the approved plan items below.')) {
      payload = {
        summary: 'Worker completed the approved plan.',
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
      text = '{"summary":"OnecandidatePBIwasfullyassessed.","coverage":[{"pbiId":"1","outcome":"covered","planItemIds":["item-1","item-2"],"notes":"Recoveredcoverage."}],"items":[{"planItemId":"item-1","pbiIds":["1"],"action":"create","targetType":"new_article","targetTitle":"EditaFoodItem","reason":"Recoverededititem.","evidence":[{"kind":"pbi","ref":"1","summary":"Recoveredevidence."}],"confidence":0.88,"executionStatus":"pending"},{"planItemId":"item-2","pbiIds":["1"],"action":"create","targetType":"new_article","targetTitle":"CreateaFoodItem","reason":"Recoveredlegacyarticledecision.","evidence":[{"kind":"article","ref":"legacy","summary":"Legacyarticle."}],"confidence":0.7,"executionStatus":"pending"},{"planItemId":"item-3"';
    } else if (promptText.includes('Create a complete structured batch analysis plan.')) {
      text = '{"summary":"Initialplanneroutputwastruncated.","coverage":[{"pbiId":"1","outcome":"covered","planItemIds":["item-1"],"notes":"Initialcoverage."}],"items":[{"planItemId":"item-1","pbiIds":["1"],"action":"create","targetType":"new_article","targetTitle":"EditaFoodItem","reason":"Initialedititem.","evidence":[{"kind":"pbi","ref":"1","summary":"Initialevidence."}],"confidence":0.8,"executionStatus":"pending"';
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
          { pbiId: '1', outcome: 'covered', planItemIds: ['item-1'] }
        ],
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['1'],
            action: 'create',
            targetType: 'new_article',
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

async function waitForCondition<T>(
  load: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 8_000
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await load();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for condition');
}

function extractPromptText(entry: { params?: Record<string, unknown> } | undefined): string {
  const prompt = entry?.params?.prompt;
  if (!Array.isArray(prompt)) {
    return '';
  }
  const firstPart = prompt[0] as { text?: unknown } | undefined;
  return typeof firstPart?.text === 'string' ? firstPart.text : '';
}

async function createTestHarness() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch2-commands-'));
  await mkdir(workspaceRoot, { recursive: true });
  const bus = new CommandBus();
  const jobs = new JobRegistry();
  const services = registerCoreCommands(bus, jobs, workspaceRoot);

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
    return created.data as { id: string; path: string };
  };

  return {
    workspaceRoot,
    bus,
    jobs,
    services,
    createWorkspace,
    cleanup: () => rm(workspaceRoot, { recursive: true, force: true })
  };
}

async function createSearchableLiveArticle(params: {
  bus: CommandBus;
  workspaceId: string;
  workspacePath: string;
  externalKey: string;
  title: string;
  locale?: string;
  html: string;
}) {
  const familyResp = await params.bus.execute({
    method: 'articleFamily.create',
    payload: {
      workspaceId: params.workspaceId,
      externalKey: params.externalKey,
      title: params.title
    }
  });
  expect(familyResp.ok).toBe(true);
  const family = familyResp.data as { id: string };

  const variantResp = await params.bus.execute({
    method: 'localeVariant.create',
    payload: {
      workspaceId: params.workspaceId,
      familyId: family.id,
      locale: params.locale ?? 'en-us'
    }
  });
  expect(variantResp.ok).toBe(true);
  const variant = variantResp.data as { id: string };

  const articleFileName = `${params.externalKey}.html`;
  const articleFilePath = path.join(params.workspacePath, articleFileName);
  await writeFile(articleFilePath, params.html, 'utf8');

  const revisionResp = await params.bus.execute({
    method: 'revision.create',
    payload: {
      workspaceId: params.workspaceId,
      localeVariantId: variant.id,
      revisionType: 'live',
      branchId: null,
      filePath: articleFilePath,
      status: 'open',
      revisionNumber: 1
    }
  });
  expect(revisionResp.ok).toBe(true);

  return { familyId: family.id, localeVariantId: variant.id, filePath: articleFilePath };
}

async function runGlobalAssistantFlowForMode(kbAccessMode: 'cli' | 'mcp') {
  const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), `kb-vault-global-ai-commands-${kbAccessMode}-`));
  const logPath = path.join(isolatedRoot, `global-ai-${kbAccessMode}.jsonl`);
  process.env.KBV_TEST_ACP_LOG_PATH = logPath;
  process.env.KBV_CURSOR_BINARY = await createFakeAcpBinary(isolatedRoot);
  const harness = await createTestHarness();

  try {
    const workspace = await harness.createWorkspace();
    const settingsResp = await harness.bus.execute({
      method: 'workspace.settings.update',
      payload: {
        workspaceId: workspace.id,
        kbAccessMode
      }
    });
    expect(settingsResp.ok).toBe(true);

    const assistantRunRequests: string[] = [];
    const agentRuntime = harness.services.agentRuntime as any;
    agentRuntime.checkHealth = async (workspaceId, selectedMode, workspaceMode) => ({
      checkedAtUtc: new Date().toISOString(),
      workspaceId,
      workspaceKbAccessMode: workspaceMode ?? 'cli',
      selectedMode: selectedMode ?? workspaceMode ?? 'cli',
      providers: {
        direct: {
          mode: 'direct',
          provider: 'direct',
          ok: false,
          message: 'Direct access shell registered, but the executor path is not enabled yet'
        },
        mcp: {
          mode: 'mcp',
          provider: 'mcp',
          ok: true,
          message: 'MCP access ready'
        },
        cli: {
          mode: 'cli',
          provider: 'cli',
          ok: true,
          message: 'CLI access ready'
        }
      },
      issues: [],
      availableModes: ['mcp', 'cli']
    });
    const originalRunAssistantChat = agentRuntime.runAssistantChat.bind(agentRuntime);
    agentRuntime.runAssistantChat = async (request: { kbAccessMode?: string }, emit: any, isCancelled: any) => {
      assistantRunRequests.push(request.kbAccessMode ?? 'unknown');
      return originalRunAssistantChat(request, emit, isCancelled);
    };

    const familyResp = await harness.bus.execute({
      method: 'articleFamily.create',
      payload: {
        workspaceId: workspace.id,
        externalKey: `kb-global-ai-${kbAccessMode}`,
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
            id: `new-template-${kbAccessMode}`,
            title: 'New Template',
            locale: 'en-us'
          },
          workingState: {
            kind: 'template_pack',
            versionToken: `new-template-${kbAccessMode}:1`,
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
    const articleData = articleTurn.data as {
      session: { id: string; runtimeSessionId?: string };
      artifact?: { id: string; artifactType: string; status: string };
    };
    expect(articleData.artifact?.artifactType).toBe('proposal_candidate');
    expect(articleData.artifact?.status).toBe('pending');
    expect(articleData.session.runtimeSessionId).toBeTruthy();

    const articleSessionResp = await harness.bus.execute({
      method: 'ai.assistant.session.get',
      payload: {
        workspaceId: workspace.id,
        sessionId: articleData.session.id
      }
    });
    expect(articleSessionResp.ok).toBe(true);
    const articleSession = articleSessionResp.data as {
      artifact?: { payload?: { metadata?: { kbAccessMode?: string; runtimeSessionId?: string } } };
    };
    expect(articleSession.artifact?.payload?.metadata?.kbAccessMode).toBe(kbAccessMode);
    expect(articleSession.artifact?.payload?.metadata?.runtimeSessionId).toBe(articleData.session.runtimeSessionId);

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
    const detail = proposalDetail.data as {
      diff: { afterHtml: string };
      proposal: {
        id: string;
        updatedAtUtc: string;
        targetLocale?: string;
        confidenceScore?: number;
        sessionId?: string;
        metadata?: Record<string, unknown>;
      };
    };
    expect(detail.proposal.confidenceScore).toBe(0.81);
    expect(detail.proposal.sessionId).toBe(articleData.session.runtimeSessionId);
    expect(detail.proposal.metadata).toMatchObject({
      originPath: 'assistant_candidate',
      runtimeSessionId: articleData.session.runtimeSessionId,
      kbAccessMode,
      acpSessionId: 'fake-acp-session'
    });

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

    const sessionListResp = await harness.bus.execute({
      method: 'ai.assistant.session.list',
      payload: {
        workspaceId: workspace.id,
        includeArchived: true
      }
    });
    expect(sessionListResp.ok).toBe(true);
    const sessionList = sessionListResp.data as {
      activeSessionId?: string;
      sessions: Array<{ route: string }>;
    };
    expect(sessionList.activeSessionId).toBeTruthy();
    expect(sessionList.sessions.length).toBeGreaterThan(0);
    expect(sessionList.sessions.some((session) => session.route === AppRoute.PROPOSAL_REVIEW)).toBe(true);
    expect(sessionList.sessions.every((session) => [
      AppRoute.DRAFTS,
      AppRoute.TEMPLATES_AND_PROMPTS,
      AppRoute.ARTICLE_EXPLORER,
      AppRoute.PROPOSAL_REVIEW
    ].includes(session.route as AppRoute))).toBe(true);

    await waitForLoggedMethod(logPath, 'session/prompt');
    const requests = await readLoggedRequests(logPath);
    const promptTexts = requests
      .filter((entry) => entry.method === 'session/prompt')
      .map((entry) => extractPromptText(entry));
    const draftPrompt = promptTexts.find((text) => text.includes('Route: drafts')) ?? '';
    const templatePrompt = promptTexts.find((text) => text.includes('Route: templates_and_prompts')) ?? '';
    const articlePrompt = promptTexts.find((text) => text.includes('Route: article_explorer')) ?? '';
    const proposalPrompt = promptTexts.find((text) => text.includes('Route: proposal_review')) ?? '';

    expect(draftPrompt).toContain(`KB access mode: ${kbAccessMode}`);
    expect(templatePrompt).toContain(`KB access mode: ${kbAccessMode}`);
    expect(articlePrompt).toContain(`KB access mode: ${kbAccessMode}`);
    expect(proposalPrompt).toContain('`command="patch_proposal"` with `artifactType="proposal_patch"`');

    if (kbAccessMode === 'mcp') {
      expect(templatePrompt).toContain('`app_get_form_schema`');
      expect(templatePrompt).toContain('`app_patch_form`');
      expect(templatePrompt).not.toContain('`kb app get-form-schema`');
      expect(templatePrompt).not.toContain('`kb app patch-form`');
      expect(articlePrompt).toContain('fetch the current article with `get_article`');
      expect(articlePrompt).not.toContain('fetch the current article with `kb get-article`');
      expect(promptTexts.some((text) => text.includes('kb search-kb'))).toBe(false);
      expect(promptTexts.some((text) => text.includes('`kb app get-form-schema`'))).toBe(false);
      expect(promptTexts.some((text) => text.includes('`kb app patch-form`'))).toBe(false);
    } else {
      expect(templatePrompt).toContain('`kb app get-form-schema`');
      expect(templatePrompt).toContain('`kb app patch-form`');
      expect(templatePrompt).not.toContain('`app_get_form_schema`');
      expect(templatePrompt).not.toContain('`app_patch_form`');
      expect(articlePrompt).toContain('fetch the current article with `kb get-article`');
      expect(articlePrompt).not.toContain('fetch the current article with `get_article`');
      expect(promptTexts.some((text) =>
        text.includes('Do not call direct MCP tool names such as `search_kb` or `get_article` in CLI mode.')
      )).toBe(true);
      expect(promptTexts.some((text) => text.includes('`app_get_form_schema`'))).toBe(false);
      expect(promptTexts.some((text) => text.includes('`app_patch_form`'))).toBe(false);
    }

    expect(assistantRunRequests).toEqual([kbAccessMode, kbAccessMode, kbAccessMode, kbAccessMode]);
  } finally {
    delete process.env.KBV_TEST_ACP_LOG_PATH;
    await harness.cleanup();
    await rm(isolatedRoot, { recursive: true, force: true });
  }
}

async function runBatchAnalysisForMode(kbAccessMode: 'cli' | 'mcp') {
  const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), `kb-vault-batch-analysis-${kbAccessMode}-`));
  const logPath = path.join(isolatedRoot, `batch-analysis-${kbAccessMode}.jsonl`);
  process.env.KBV_TEST_ACP_LOG_PATH = logPath;
  process.env.KBV_CURSOR_BINARY = await createLoggedSuccessfulBatchAnalysisAcpBinary(isolatedRoot);
  const harness = await createTestHarness();

  try {
    const workspace = await harness.createWorkspace();
    const settingsResp = await harness.bus.execute({
      method: 'workspace.settings.update',
      payload: {
        workspaceId: workspace.id,
        kbAccessMode
      }
    });
    expect(settingsResp.ok).toBe(true);

    const agentRuntime = harness.services.agentRuntime as any;
    agentRuntime.checkHealth = async (workspaceId, selectedMode, workspaceMode) => ({
      checkedAtUtc: new Date().toISOString(),
      workspaceId,
      workspaceKbAccessMode: workspaceMode ?? 'cli',
      selectedMode: selectedMode ?? workspaceMode ?? 'cli',
      providers: {
        direct: {
          mode: 'direct',
          provider: 'direct',
          ok: false,
          message: 'Direct access shell registered, but the executor path is not enabled yet'
        },
        mcp: {
          mode: 'mcp',
          provider: 'mcp',
          ok: true,
          message: 'MCP access ready'
        },
        cli: {
          mode: 'cli',
          provider: 'cli',
          ok: true,
          message: 'CLI access ready'
        }
      },
      issues: [],
      availableModes: ['mcp', 'cli']
    });

    const importResp = await harness.bus.execute({
      method: 'pbiBatch.import',
      payload: {
        workspaceId: workspace.id,
        sourceFileName: `${kbAccessMode}-analysis.csv`,
        sourceContent: `Id,Title,Description\n1,${kbAccessMode.toUpperCase()} analysis,Verify ${kbAccessMode} batch analysis parity`
      }
    });
    expect(importResp.ok).toBe(true);
    const batchId = (importResp.data as { batch: { id: string } }).batch.id;

    const job = await harness.jobs.start('agent.analysis.run', {
      workspaceId: workspace.id,
      batchId
    });
    expect(job.state).toBe('SUCCEEDED');

    const latestResp = await harness.bus.execute({
      method: 'agent.analysis.latest',
      payload: { workspaceId: workspace.id, batchId, limit: 0 }
    });
    expect(latestResp.ok).toBe(true);
    const latest = latestResp.data as {
      run: { kbAccessMode?: string } | null;
    };
    expect(latest.run?.kbAccessMode).toBe(kbAccessMode);

    const inspectionResp = await harness.bus.execute({
      method: 'batch.analysis.inspection.get',
      payload: { workspaceId: workspace.id, batchId }
    });
    expect(inspectionResp.ok).toBe(true);
    const inspection = inspectionResp.data as {
      stageRuns: Array<{ kbAccessMode?: string }>;
    };
    expect(new Set(inspection.stageRuns.map((run) => run.kbAccessMode).filter(Boolean))).toEqual(new Set([kbAccessMode]));

    const sessionsResp = await harness.bus.execute({
      method: 'agent.session.list',
      payload: {
        workspaceId: workspace.id,
        includeClosed: true
      }
    });
    expect(sessionsResp.ok).toBe(true);
    const sessions = sessionsResp.data as {
      sessions: Array<{ type: string; batchId?: string; kbAccessMode: string }>;
    };
    const batchSession = sessions.sessions.find((session) => session.type === 'batch_analysis' && session.batchId === batchId);
    expect(batchSession?.kbAccessMode).toBe(kbAccessMode);

    await waitForLoggedMethod(logPath, 'session/prompt');
    const promptRequests = await readLoggedRequests(logPath);
    const promptText = extractPromptText(promptRequests.find((entry) => entry.method === 'session/prompt'));

    if (kbAccessMode === 'mcp') {
      expect(promptText).toContain('KB Vault MCP guidance');
      expect(promptText).toContain('get_batch_context');
      expect(promptText).not.toContain('Use only the `kb` CLI');
      expect(promptText).not.toContain('kb search-kb');
      expect(promptText).not.toContain('`kb app get-form-schema`');
      expect(promptText).not.toContain('`kb app patch-form`');
    } else {
      expect(promptText).toContain('Use only the `kb` CLI');
      expect(promptText).toContain('Do NOT use KB Vault MCP tools');
      expect(promptText).not.toContain('KB Vault MCP guidance');
      expect(promptText).not.toContain('get_batch_context');
      expect(promptText).not.toContain('`search_kb`');
      expect(promptText).not.toContain('`app_get_form_schema`');
      expect(promptText).not.toContain('`app_patch_form`');
    }
  } finally {
    delete process.env.KBV_TEST_ACP_LOG_PATH;
    await harness.cleanup();
    await rm(isolatedRoot, { recursive: true, force: true });
  }
}

test.describe('command registry content model transitions', () => {
  let bus: CommandBus;
  let jobs: JobRegistry;
  let services: any;
  let cleanup: () => Promise<void>;
  let createWorkspace: () => Promise<{ id: string }>;
  let previousCursorBinary: string | undefined;

  test.beforeEach(async () => {
    previousCursorBinary = process.env.KBV_CURSOR_BINARY;
    const harness = await createTestHarness();
    bus = harness.bus;
    jobs = harness.jobs;
    services = harness.services;
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
    expect((getResp.data as { kbAccessMode: string }).kbAccessMode).toBe('direct');

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

  test('returns provider-aware health payload for the selected workspace mode after mode switches', async () => {
    const workspace = await createWorkspace();

    const firstHealthResp = await bus.execute({
      method: 'agent.health.check',
      payload: { workspaceId: workspace.id }
    });
    expect(firstHealthResp.ok).toBe(true);
    expect((firstHealthResp.data as { selectedMode: string }).selectedMode).toBe('direct');

    const cliSettingsResp = await bus.execute({
      method: 'workspace.settings.update',
      payload: {
        workspaceId: workspace.id,
        kbAccessMode: 'cli'
      }
    });
    expect(cliSettingsResp.ok).toBe(true);

    const cliHealthResp = await bus.execute({
      method: 'agent.health.check',
      payload: { workspaceId: workspace.id }
    });

    expect(cliHealthResp.ok).toBe(true);
    expect((cliHealthResp.data as { selectedMode: string }).selectedMode).toBe('cli');
    expect((cliHealthResp.data as { providers: { cli: { mode: string }; mcp: { mode: string } } }).providers.cli.mode).toBe('cli');
    expect((cliHealthResp.data as { providers: { cli: { mode: string }; mcp: { mode: string } } }).providers.mcp.mode).toBe('mcp');

    const mcpSettingsResp = await bus.execute({
      method: 'workspace.settings.update',
      payload: {
        workspaceId: workspace.id,
        kbAccessMode: 'mcp'
      }
    });
    expect(mcpSettingsResp.ok).toBe(true);

    const mcpHealthResp = await bus.execute({
      method: 'agent.health.check',
      payload: { workspaceId: workspace.id }
    });
    expect(mcpHealthResp.ok).toBe(true);
    expect((mcpHealthResp.data as { selectedMode: string }).selectedMode).toBe('mcp');
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
        sessionId: 'proposal-ingest-runtime',
        action: 'edit',
        targetTitle: 'Create & Edit Chat Channels',
        targetLocale: 'en-us',
        confidenceScore: 0.88,
        rationaleSummary: 'Reflect the new dashboard assignment path.',
        aiNotes: 'Steps 2-4 need updates.',
        sourceHtml: '<p>Old assignment flow.</p>',
        proposedHtml: '<p>New assignment flow.</p>',
        relatedPbiIds: [rows[0].id],
        metadata: {
          kbAccessMode: 'cli',
          acpSessionId: 'proposal-ingest-acp'
        }
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
    const detail = detailResp.data as {
      diff: { changeRegions: unknown[] };
      proposal: { metadata?: Record<string, unknown> };
    };
    expect(detail.diff.changeRegions.length).toBeGreaterThan(0);
    expect(detail.proposal.metadata).toMatchObject({
      originPath: 'proposal_ingest',
      runtimeSessionId: 'proposal-ingest-runtime',
      kbAccessMode: 'cli',
      acpSessionId: 'proposal-ingest-acp'
    });

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

  test('validates and returns PBI library list responses', async () => {
    const workspace = await createWorkspace();

    const invalidResp = await bus.execute({
      method: 'pbiLibrary.list',
      payload: {}
    });
    expect(invalidResp.ok).toBe(false);
    expect(invalidResp.error?.code).toBe(AppErrorCode.INVALID_REQUEST);

    const importResp = await bus.execute({
      method: 'pbiBatch.import',
      payload: {
        workspaceId: workspace.id,
        sourceFileName: 'library-list.csv',
        sourceContent: 'Id,Title,Description\n301,Library Search,Search this PBI from the library'
      }
    });
    expect(importResp.ok).toBe(true);

    const listResp = await bus.execute({
      method: 'pbiLibrary.list',
      payload: {
        workspaceId: workspace.id,
        sortBy: 'externalId',
        sortDirection: 'asc'
      }
    });
    expect(listResp.ok).toBe(true);
    const listData = listResp.data as {
      workspaceId: string;
      items: Array<{ pbiId: string; externalId: string; batchName: string; proposalCount: number }>;
    };
    expect(listData.workspaceId).toBe(workspace.id);
    expect(listData.items).toHaveLength(1);
    expect(listData.items[0]?.externalId).toBe('301');
    expect(listData.items[0]?.proposalCount).toBe(0);
  });

  test('validates PBI library get requests and reports not-found items', async () => {
    const workspace = await createWorkspace();

    const invalidResp = await bus.execute({
      method: 'pbiLibrary.get',
      payload: { workspaceId: workspace.id }
    });
    expect(invalidResp.ok).toBe(false);
    expect(invalidResp.error?.code).toBe(AppErrorCode.INVALID_REQUEST);

    const importResp = await bus.execute({
      method: 'pbiBatch.import',
      payload: {
        workspaceId: workspace.id,
        sourceFileName: 'library-detail.csv',
        sourceContent: 'Id,Title,Description\n401,Viewer Detail,Open this record from the library viewer'
      }
    });
    expect(importResp.ok).toBe(true);

    const listResp = await bus.execute({
      method: 'pbiLibrary.list',
      payload: {
        workspaceId: workspace.id
      }
    });
    expect(listResp.ok).toBe(true);
    const pbiId = (listResp.data as { items: Array<{ pbiId: string }> }).items[0]?.pbiId;
    expect(pbiId).toBeTruthy();

    const getResp = await bus.execute({
      method: 'pbiLibrary.get',
      payload: {
        workspaceId: workspace.id,
        pbiId
      }
    });
    expect(getResp.ok).toBe(true);
    const detailData = getResp.data as {
      item: { pbiId: string; externalId: string };
      batch: { sourceFileName: string };
      linkedProposals: unknown[];
    };
    expect(detailData.item.pbiId).toBe(pbiId);
    expect(detailData.item.externalId).toBe('401');
    expect(detailData.batch.sourceFileName).toBe('library-detail.csv');
    expect(detailData.linkedProposals).toHaveLength(0);

    const missingResp = await bus.execute({
      method: 'pbiLibrary.get',
      payload: {
        workspaceId: workspace.id,
        pbiId: 'missing-pbi'
      }
    });
    expect(missingResp.ok).toBe(false);
    expect(missingResp.error?.code).toBe(AppErrorCode.NOT_FOUND);
  });

  test('persists proposal review app working state patches through the command bus', async () => {
    const workspace = await createWorkspace();

    const importResp = await bus.execute({
      method: 'pbiBatch.import',
      payload: {
        workspaceId: workspace.id,
        sourceFileName: 'proposal-patch.csv',
        sourceContent: 'Id,Title,Description\n201,Dashboard Assignment,Refresh the dashboard assignment flow'
      }
    });
    expect(importResp.ok).toBe(true);
    const imported = importResp.data as { batch: { id: string } };

    const ingestResp = await bus.execute({
      method: 'proposal.ingest',
      payload: {
        workspaceId: workspace.id,
        batchId: imported.batch.id,
        action: 'edit',
        targetTitle: 'Create & Edit Chat Channels',
        targetLocale: 'en-us',
        confidenceScore: 0.77,
        rationaleSummary: 'Refresh the assignment steps for the dashboard release.',
        aiNotes: 'Initial AI notes.',
        sourceHtml: '<h1>Create & Edit Chat Channels</h1><p>Old assignment flow.</p>',
        proposedHtml: '<h1>Create & Edit Chat Channels</h1><p>Draft updated assignment flow.</p>'
      }
    });
    expect(ingestResp.ok).toBe(true);
    const proposal = ingestResp.data as { id: string };

    const detailResp = await bus.execute({
      method: 'proposal.review.get',
      payload: {
        workspaceId: workspace.id,
        proposalId: proposal.id
      }
    });
    expect(detailResp.ok).toBe(true);
    const detailData = detailResp.data as {
      proposal: { targetTitle?: string; rationaleSummary?: string; aiNotes?: string };
      diff: { afterHtml: string };
    };

    const registerResp = await bus.execute({
      method: 'app.workingState.register',
      payload: {
        workspaceId: workspace.id,
        route: AppRoute.PROPOSAL_REVIEW,
        entityType: 'proposal',
        entityId: proposal.id,
        versionToken: `seed:${proposal.id}`,
        currentValues: {
          html: detailData.diff.afterHtml,
          title: detailData.proposal.targetTitle ?? '',
          rationale: '',
          rationaleSummary: detailData.proposal.rationaleSummary ?? '',
          aiNotes: detailData.proposal.aiNotes ?? ''
        }
      }
    });
    expect(registerResp.ok).toBe(true);

    const patchResp = await bus.execute({
      method: 'app.workingState.patchForm',
      payload: {
        workspaceId: workspace.id,
        route: AppRoute.PROPOSAL_REVIEW,
        entityType: 'proposal',
        entityId: proposal.id,
        patch: {
          title: 'Create & Edit Chat Channels (Patched)',
          rationaleSummary: 'Bus patch persisted the refined rationale.',
          aiNotes: 'Bus patch refined the proposal copy.',
          html: '<h1>Create & Edit Chat Channels (Patched)</h1><p>Patched from the proposal review working state.</p>'
        }
      }
    });
    expect(patchResp.ok).toBe(true);
    const patchData = patchResp.data as {
      applied: boolean;
      currentValues?: { title?: string };
    };
    expect(patchData.applied).toBe(true);
    expect(patchData.currentValues?.title).toBe('Create & Edit Chat Channels (Patched)');

    const refreshedResp = await bus.execute({
      method: 'proposal.review.get',
      payload: {
        workspaceId: workspace.id,
        proposalId: proposal.id
      }
    });
    expect(refreshedResp.ok).toBe(true);
    const refreshed = refreshedResp.data as {
      proposal: { targetTitle?: string; rationaleSummary?: string; aiNotes?: string };
      diff: { afterHtml: string };
    };
    expect(refreshed.proposal.targetTitle).toBe('Create & Edit Chat Channels (Patched)');
    expect(refreshed.proposal.rationaleSummary).toBe('Bus patch persisted the refined rationale.');
    expect(refreshed.proposal.aiNotes).toBe('Bus patch refined the proposal copy.');
    expect(refreshed.diff.afterHtml).toContain('Patched from the proposal review working state.');
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
      const settingsResp = await harness.bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'cli'
        }
      });
      expect(settingsResp.ok).toBe(true);

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

  test('article edit job honors the selected KB access mode', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-article-edit-mode-selection-'));
    process.env.KBV_CURSOR_BINARY = await createFakeAcpBinary(isolatedRoot);
    const harness = await createTestHarness();

    try {
      const workspace = await harness.createWorkspace();
      const settingsResp = await harness.bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'cli'
        }
      });
      expect(settingsResp.ok).toBe(true);

      const familyResp = await harness.bus.execute({
        method: 'articleFamily.create',
        payload: {
          workspaceId: workspace.id,
          externalKey: 'article-edit-mode-selection',
          title: 'Article Edit Mode Selection'
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

      const agentRuntime = harness.services.agentRuntime as any;
      agentRuntime.checkHealth = async (workspaceId, selectedMode, workspaceMode) => ({
        checkedAtUtc: new Date().toISOString(),
        workspaceId,
        workspaceKbAccessMode: workspaceMode ?? 'cli',
        selectedMode: selectedMode ?? workspaceMode ?? 'cli',
        providers: {
          direct: {
            mode: 'direct',
            provider: 'direct',
            ok: false,
            message: 'Direct access shell registered, but the executor path is not enabled yet'
          },
          mcp: {
            mode: 'mcp',
            provider: 'mcp',
            ok: true,
            message: 'MCP access ready'
          },
          cli: {
            mode: 'cli',
            provider: 'cli',
            ok: true,
            message: 'CLI access ready'
          }
        },
        issues: [],
        availableModes: ['mcp', 'cli']
      });
      const originalRunArticleEdit = agentRuntime.runArticleEdit.bind(agentRuntime);
      const articleEditRequests: string[] = [];
      agentRuntime.runArticleEdit = async (request: { kbAccessMode?: string }, emit: any, isCancelled: any) => {
        articleEditRequests.push(request.kbAccessMode ?? 'unknown');
        return originalRunArticleEdit(request, emit, isCancelled);
      };

      const jobEvents: Array<{ id: string; metadata?: Record<string, unknown>; state: string }> = [];
      harness.jobs.setEmitter((event) => {
        if (event.command === 'agent.article_edit.run') {
          jobEvents.push(event);
        }
      });

      const workspaceSelectedJob = await harness.jobs.start('agent.article_edit.run', {
        workspaceId: workspace.id,
        localeVariantId: localeVariant.id,
        prompt: 'Tighten this article.'
      });
      const explicitModeJob = await harness.jobs.start('agent.article_edit.run', {
        workspaceId: workspace.id,
        localeVariantId: localeVariant.id,
        kbAccessMode: 'mcp',
        prompt: 'Tighten this article again.'
      });

      expect(workspaceSelectedJob.state).toBe('SUCCEEDED');
      expect(explicitModeJob.state).toBe('SUCCEEDED');
      expect(articleEditRequests).toEqual(['cli', 'mcp']);

      const workspaceSelectedTracked = jobEvents.find((event) =>
        event.id === workspaceSelectedJob.jobId
        && event.metadata?.requestedKbAccessMode === 'cli'
        && event.metadata?.kbAccessMode === 'cli'
      );
      const explicitModeTracked = jobEvents.find((event) =>
        event.id === explicitModeJob.jobId
        && event.metadata?.requestedKbAccessMode === 'mcp'
        && event.metadata?.kbAccessMode === 'mcp'
      );
      expect(workspaceSelectedTracked).toBeTruthy();
      expect(explicitModeTracked).toBeTruthy();
    } finally {
      await harness.cleanup();
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  test('direct batch analysis keeps planner, worker, and review stages on direct', async () => {
    const workspace = await createWorkspace();
    const settingsResp = await bus.execute({
      method: 'workspace.settings.update',
      payload: {
        workspaceId: workspace.id,
        kbAccessMode: 'direct'
      }
    });
    expect(settingsResp.ok).toBe(true);

    const importResp = await bus.execute({
      method: 'pbiBatch.import',
      payload: {
        workspaceId: workspace.id,
        sourceFileName: 'direct-phase-2.csv',
        sourceContent: 'Id,Title,Description\n1,Direct Phase 3,Verify direct planner, worker, and review stages stay on direct'
      }
    });
    expect(importResp.ok).toBe(true);
    const batchId = (importResp.data as { batch: { id: string } }).batch.id;
    const rowsResp = await bus.execute({
      method: 'pbiBatch.rows.list',
      payload: {
        workspaceId: workspace.id,
        batchId
      }
    });
    expect(rowsResp.ok).toBe(true);
    const uploadedPbis = (rowsResp.data as { rows: Array<{ id: string }> }).rows;
    const firstPbiId = uploadedPbis[0]?.id;
    expect(firstPbiId).toBeTruthy();

    const agentRuntime = services.agentRuntime as any;
    const batchAnalysisOrchestrator = services.batchAnalysisOrchestrator as {
      applyDeterministicPlanReviewGuard: (params: {
        review: unknown;
      }) => {
        review: unknown;
        forcedRevision: boolean;
        missingEditTargets: string[];
        missingCreateTargets: string[];
        conflictingTargets: string[];
        unresolvedTargetIssues: string[];
        unresolvedReferenceIssues: string[];
      };
    };
    batchAnalysisOrchestrator.applyDeterministicPlanReviewGuard = ({ review }) => ({
      review,
      forcedRevision: false,
      missingEditTargets: [],
      missingCreateTargets: [],
      conflictingTargets: [],
      unresolvedTargetIssues: [],
      unresolvedReferenceIssues: []
    });
    agentRuntime.checkHealth = async (workspaceId, selectedMode, workspaceMode) => ({
      checkedAtUtc: new Date().toISOString(),
      workspaceId,
      workspaceKbAccessMode: workspaceMode ?? 'direct',
      selectedMode: selectedMode ?? workspaceMode ?? 'direct',
      providers: {
        direct: {
          mode: 'direct',
          provider: 'direct',
          ok: true,
          message: 'Direct executor ready for direct batch analysis stages'
        },
        mcp: {
          mode: 'mcp',
          provider: 'mcp',
          ok: true,
          message: 'MCP access available as a compatibility provider'
        },
        cli: {
          mode: 'cli',
          provider: 'cli',
          ok: false,
          message: 'CLI access disabled for this test'
        }
      },
      issues: [],
      availableModes: ['direct', 'mcp']
    });

    const runRequests: Array<{ role?: string; kbAccessMode?: string }> = [];
    agentRuntime.getTranscripts = async ({ workspaceId, sessionId }) => ({
      workspaceId,
      sessionId,
      lines: []
    });
    agentRuntime.runBatchAnalysis = async (request: {
      agentRole?: string;
      kbAccessMode?: string;
      workspaceId: string;
      batchId: string;
    }) => {
      runRequests.push({ role: request.agentRole, kbAccessMode: request.kbAccessMode });
      const startedAtUtc = new Date().toISOString();
      const payloadByRole: Record<string, unknown> = request.agentRole === 'planner'
        ? {
            text: JSON.stringify({
              summary: 'Direct planner completed.',
              coverage: [
                {
                  pbiId: firstPbiId,
                  outcome: 'no_impact',
                  planItemIds: ['plan-1']
                }
              ],
              items: [
                {
                  planItemId: 'plan-1',
                  pbiIds: [firstPbiId],
                  action: 'no_impact',
                  targetType: 'unknown',
                  targetTitle: 'Direct Phase 2',
                  reason: 'No KB change is required for this compatibility-path test.',
                  evidence: [
                    {
                      kind: 'pbi',
                      ref: `pbi:${firstPbiId}`,
                      summary: 'Imported PBI is covered without KB changes.'
                    }
                  ],
                  confidence: 0.88,
                  executionStatus: 'pending'
                }
              ],
              openQuestions: []
            })
          }
        : request.agentRole === 'plan-reviewer'
          ? {
              text: JSON.stringify({
                summary: 'Direct review approved the no-impact plan.',
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
              })
            }
          : request.agentRole === 'worker'
            ? {
                text: JSON.stringify({
                  summary: 'Compatibility worker completed.',
                  discoveredWork: []
                })
              }
            : {
                text: JSON.stringify({
                  summary: 'Direct final review approved the batch.',
                  verdict: 'approved',
                  allPbisMapped: true,
                  planExecutionComplete: true,
                  hasMissingArticleChanges: false,
                  hasUnresolvedDiscoveredWork: false,
                  delta: {
                    summary: 'No rework required.',
                    requestedRework: [],
                    uncoveredPbiIds: [],
                    missingArticleChanges: [],
                    duplicateRiskTitles: [],
                    unnecessaryChanges: [],
                    unresolvedAmbiguities: []
                  }
                })
              };

      return {
        sessionId: `${request.agentRole}-session`,
        kbAccessMode: request.kbAccessMode ?? 'unknown',
        status: 'ok',
        transcriptPath: '',
        rawOutput: [],
        resultPayload: payloadByRole,
        finalText: typeof (payloadByRole as { text?: string }).text === 'string' ? (payloadByRole as { text: string }).text : undefined,
        toolCalls: [],
        startedAtUtc,
        endedAtUtc: startedAtUtc,
        durationMs: 1,
        message: 'Completed'
      };
    };

    const job = await jobs.start('agent.analysis.run', {
      workspaceId: workspace.id,
      batchId
    });
    expect(job.state).toBe('SUCCEEDED');
    expect(runRequests).toEqual([
      { role: 'planner', kbAccessMode: 'direct' },
      { role: 'plan-reviewer', kbAccessMode: 'direct' },
      { role: 'worker', kbAccessMode: 'direct' },
      { role: 'final-reviewer', kbAccessMode: 'direct' }
    ]);

    const inspectionResp = await bus.execute({
      method: 'batch.analysis.inspection.get',
      payload: { workspaceId: workspace.id, batchId }
    });
    expect(inspectionResp.ok).toBe(true);
    const inspection = inspectionResp.data as {
      stageRuns: Array<{ role: string; kbAccessMode?: string }>;
    };
    expect(
      inspection.stageRuns.some((run) => run.role === 'worker' && run.kbAccessMode === 'direct')
    ).toBe(true);
    expect(
      inspection.stageRuns.some((run) => run.role === 'planner' && run.kbAccessMode === 'direct')
    ).toBe(true);
    expect(
      inspection.stageRuns.some((run) => run.role === 'final-reviewer' && run.kbAccessMode === 'direct')
    ).toBe(true);
  });

  test('worker watchdog fails a stuck building stage and preserves the in-flight stage run', async () => {
    const harness = await createTestHarness();
    const previousWorkerTimeout = process.env.KBV_WORKER_STAGE_TIMEOUT_MS;
    const previousWorkerWatchdog = process.env.KBV_WORKER_STAGE_WATCHDOG_MS;
    process.env.KBV_WORKER_STAGE_TIMEOUT_MS = '25';
    process.env.KBV_WORKER_STAGE_WATCHDOG_MS = '50';

    try {
      const workspace = await harness.createWorkspace();
      const settingsResp = await harness.bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'direct'
        }
      });
      expect(settingsResp.ok).toBe(true);

      const importResp = await harness.bus.execute({
        method: 'pbiBatch.import',
        payload: {
          workspaceId: workspace.id,
          sourceFileName: 'worker-watchdog.csv',
          sourceContent: 'Id,Title,Description\n1,Worker Watchdog,Ensure the worker stage fails fast when ACP stalls'
        }
      });
      expect(importResp.ok).toBe(true);
      const batchId = (importResp.data as { batch: { id: string } }).batch.id;

      const rowsResp = await harness.bus.execute({
        method: 'pbiBatch.rows.list',
        payload: {
          workspaceId: workspace.id,
          batchId
        }
      });
      expect(rowsResp.ok).toBe(true);
      const uploadedPbis = (rowsResp.data as { rows: Array<{ id: string }> }).rows;
      const firstPbiId = uploadedPbis[0]?.id;
      expect(firstPbiId).toBeTruthy();

      const agentRuntime = harness.services.agentRuntime as any;
      const batchAnalysisOrchestrator = harness.services.batchAnalysisOrchestrator as {
        applyDeterministicPlanReviewGuard: (params: { review: unknown }) => {
          review: unknown;
          forcedRevision: boolean;
          missingEditTargets: string[];
          missingCreateTargets: string[];
          conflictingTargets: string[];
          unresolvedTargetIssues: string[];
          unresolvedReferenceIssues: string[];
        };
      };
      batchAnalysisOrchestrator.applyDeterministicPlanReviewGuard = ({ review }) => ({
        review,
        forcedRevision: false,
        missingEditTargets: [],
        missingCreateTargets: [],
        conflictingTargets: [],
        unresolvedTargetIssues: [],
        unresolvedReferenceIssues: []
      });
      agentRuntime.checkHealth = async (workspaceId: string, selectedMode?: string, workspaceMode?: string) => ({
        checkedAtUtc: new Date().toISOString(),
        workspaceId,
        workspaceKbAccessMode: (workspaceMode ?? 'direct') as 'direct',
        selectedMode: (selectedMode ?? workspaceMode ?? 'direct') as 'direct',
        providers: {
          direct: {
            mode: 'direct',
            provider: 'direct',
            ok: true,
            message: 'Direct executor ready for worker watchdog coverage'
          },
          mcp: {
            mode: 'mcp',
            provider: 'mcp',
            ok: true,
            message: 'Compatibility MCP provider available'
          },
          cli: {
            mode: 'cli',
            provider: 'cli',
            ok: false,
            message: 'CLI disabled for worker watchdog coverage'
          }
        },
        issues: [],
        availableModes: ['direct', 'mcp']
      });
      agentRuntime.getTranscripts = async ({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) => ({
        workspaceId,
        sessionId,
        lines: []
      });
      agentRuntime.runBatchAnalysis = async (request: {
        sessionId?: string;
        agentRole?: string;
        kbAccessMode?: string;
      }) => {
        const startedAtUtc = new Date().toISOString();
        if (request.agentRole === 'worker') {
          return await new Promise<never>(() => undefined);
        }

        const payloadByRole: Record<string, unknown> = request.agentRole === 'planner'
          ? {
              text: JSON.stringify({
                summary: 'Watchdog planner completed.',
                coverage: [
                  {
                    pbiId: firstPbiId,
                    outcome: 'edit_required',
                    planItemIds: ['plan-watchdog-1']
                  }
                ],
                items: [
                  {
                    planItemId: 'plan-watchdog-1',
                    pbiIds: [firstPbiId],
                    action: 'edit',
                    targetType: 'article',
                    targetTitle: 'Worker Watchdog Article',
                    reason: 'The worker watchdog test needs one worker item.',
                    evidence: [
                      {
                        kind: 'pbi',
                        ref: `pbi:${firstPbiId}`,
                        summary: 'Imported watchdog PBI requires article work.'
                      }
                    ],
                    confidence: 0.9,
                    executionStatus: 'pending'
                  }
                ],
                openQuestions: []
              })
            }
          : {
              text: JSON.stringify({
                summary: 'Watchdog reviewer approved the worker plan.',
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
              })
            };

        return {
          sessionId: request.sessionId ?? `${request.agentRole}-watchdog-session`,
          kbAccessMode: request.kbAccessMode ?? 'direct',
          status: 'ok',
          transcriptPath: '',
          rawOutput: [],
          resultPayload: payloadByRole,
          finalText: (payloadByRole as { text: string }).text,
          toolCalls: [],
          startedAtUtc,
          endedAtUtc: startedAtUtc,
          durationMs: 1,
          message: 'Completed'
        };
      };

      const job = await harness.jobs.start('agent.analysis.run', {
        workspaceId: workspace.id,
        batchId
      });
      expect(job.state).toBe('FAILED');

      const inspectionResp = await harness.bus.execute({
        method: 'batch.analysis.inspection.get',
        payload: { workspaceId: workspace.id, batchId }
      });
      expect(inspectionResp.ok).toBe(true);
      const inspection = inspectionResp.data as {
        latestIteration?: { stage: string; role: string; status: string; summary?: string } | null;
        stageRuns: Array<{ stage: string; role: string; status: string; promptTemplate?: string; endedAtUtc?: string }>;
      };
      expect(inspection.latestIteration?.stage).toBe('building');
      expect(inspection.latestIteration?.role).toBe('worker');
      expect(inspection.latestIteration?.status).toBe('failed');
      expect(inspection.latestIteration?.summary).toContain('watchdog');

      const workerStageRun = inspection.stageRuns.find((run) => run.stage === 'building' && run.role === 'worker');
      expect(workerStageRun).toBeTruthy();
      expect(workerStageRun?.status).toBe('failed');
      expect(workerStageRun?.promptTemplate).toContain('Execute only the approved plan items below.');
      expect(workerStageRun?.endedAtUtc).toBeTruthy();
    } finally {
      if (previousWorkerTimeout === undefined) {
        delete process.env.KBV_WORKER_STAGE_TIMEOUT_MS;
      } else {
        process.env.KBV_WORKER_STAGE_TIMEOUT_MS = previousWorkerTimeout;
      }
      if (previousWorkerWatchdog === undefined) {
        delete process.env.KBV_WORKER_STAGE_WATCHDOG_MS;
      } else {
        process.env.KBV_WORKER_STAGE_WATCHDOG_MS = previousWorkerWatchdog;
      }
      await harness.cleanup();
    }
  });

  test('uses the batch worker budget minutes to size the worker timeout', async () => {
    const harness = await createTestHarness();

    try {
      const workspace = await harness.createWorkspace();
      const settingsResp = await harness.bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'direct'
        }
      });
      expect(settingsResp.ok).toBe(true);

      const importResp = await harness.bus.execute({
        method: 'pbiBatch.import',
        payload: {
          workspaceId: workspace.id,
          sourceFileName: 'worker-budget.csv',
          sourceContent: 'Id,Title,Description\n1,Worker Budget,Verify custom worker stage budgeting reaches the runtime'
        }
      });
      expect(importResp.ok).toBe(true);
      const batchId = (importResp.data as { batch: { id: string } }).batch.id;

      const submitResp = await harness.bus.execute({
        method: 'pbiBatch.setStatus',
        payload: {
          workspaceId: workspace.id,
          batchId,
          status: PBIBatchStatus.SUBMITTED,
          workerStageBudgetMinutes: 45
        }
      });
      expect(submitResp.ok).toBe(true);

      const rowsResp = await harness.bus.execute({
        method: 'pbiBatch.rows.list',
        payload: {
          workspaceId: workspace.id,
          batchId
        }
      });
      expect(rowsResp.ok).toBe(true);
      const uploadedPbis = (rowsResp.data as { rows: Array<{ id: string }> }).rows;
      const firstPbiId = uploadedPbis[0]?.id;
      expect(firstPbiId).toBeTruthy();

      const agentRuntime = harness.services.agentRuntime as any;
      let observedWorkerTimeoutMs: number | undefined;
      agentRuntime.checkHealth = async (workspaceId: string, selectedMode?: string, workspaceMode?: string) => ({
        checkedAtUtc: new Date().toISOString(),
        workspaceId,
        workspaceKbAccessMode: (workspaceMode ?? 'direct') as 'direct',
        selectedMode: (selectedMode ?? workspaceMode ?? 'direct') as 'direct',
        providers: {
          direct: {
            mode: 'direct',
            provider: 'direct',
            ok: true,
            message: 'Direct executor ready for worker budget coverage'
          },
          mcp: {
            mode: 'mcp',
            provider: 'mcp',
            ok: true,
            message: 'Compatibility MCP provider available'
          },
          cli: {
            mode: 'cli',
            provider: 'cli',
            ok: false,
            message: 'CLI disabled for worker budget coverage'
          }
        },
        issues: [],
        availableModes: ['direct', 'mcp']
      });
      agentRuntime.getTranscripts = async ({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) => ({
        workspaceId,
        sessionId,
        lines: []
      });
      agentRuntime.runBatchAnalysis = async (request: {
        sessionId?: string;
        agentRole?: string;
        kbAccessMode?: string;
        timeoutMs?: number;
      }) => {
        const startedAtUtc = new Date().toISOString();
        let text = JSON.stringify({
          summary: 'Budget test reviewer approved the no-impact plan.',
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

        if (request.agentRole === 'planner') {
          text = JSON.stringify({
            summary: 'Budget test planner completed.',
            coverage: [
              {
                pbiId: firstPbiId,
                outcome: 'no_impact',
                planItemIds: ['plan-budget-1']
              }
            ],
            items: [
              {
                planItemId: 'plan-budget-1',
                pbiIds: [firstPbiId],
                action: 'no_impact',
                targetType: 'unknown',
                targetTitle: 'No KB Changes Needed',
                reason: 'This item is only here to verify the worker timeout budget.',
                evidence: [
                  {
                    kind: 'pbi',
                    ref: `pbi:${firstPbiId}`,
                    summary: 'Imported PBI does not require KB updates.'
                  }
                ],
                confidence: 0.9,
                executionStatus: 'pending'
              }
            ],
            openQuestions: []
          });
        } else if (request.agentRole === 'worker') {
          observedWorkerTimeoutMs = request.timeoutMs;
          text = JSON.stringify({
            summary: 'Worker confirmed that no KB changes are required.',
            discoveredWork: []
          });
        } else if (request.agentRole === 'final-reviewer') {
          text = JSON.stringify({
            summary: 'Final review confirms there is nothing to propose for this no-impact batch.',
            verdict: 'approved',
            appliedAmendment: false,
            requiresRework: false,
            delta: {
              summary: 'No changes requested.',
              requestedChanges: [],
              missingPbiIds: [],
              additionalArticleWork: [],
              targetCorrections: [],
              overlapConflicts: []
            }
          });
        }

        return {
          sessionId: request.sessionId ?? `${request.agentRole}-budget-session`,
          kbAccessMode: request.kbAccessMode ?? 'direct',
          status: 'ok',
          transcriptPath: '',
          rawOutput: [],
          resultPayload: { text },
          finalText: text,
          toolCalls: [],
          startedAtUtc,
          endedAtUtc: startedAtUtc,
          durationMs: 1,
          message: 'Completed'
        };
      };

      const job = await harness.jobs.start('agent.analysis.run', {
        workspaceId: workspace.id,
        batchId
      });

      expect(job.state).toBe('SUCCEEDED');
      expect(observedWorkerTimeoutMs).toBe(45 * 60_000);
    } finally {
      await harness.cleanup();
    }
  });

  for (const kbAccessMode of ['mcp', 'cli'] as const) {
    test(`keeps batch analysis history and prompts pinned to ${kbAccessMode.toUpperCase()} mode`, async () => {
      await runBatchAnalysisForMode(kbAccessMode);
    });
  }

  test('pauses for required Delete a Food List user input and auto-resumes before worker execution', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch-analysis-user-input-'));
    const logPath = path.join(isolatedRoot, 'batch-analysis-user-input.jsonl');
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    process.env.KBV_CURSOR_BINARY = await createUserInputBatchAnalysisAcpBinary(isolatedRoot);

    try {
      const workspace = await createWorkspace();
      const settingsResp = await bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'cli'
        }
      });
      expect(settingsResp.ok).toBe(true);

      const agentRuntime = services.agentRuntime as any;
      agentRuntime.checkHealth = async (workspaceId: string, selectedMode?: string, workspaceMode?: string) => ({
        checkedAtUtc: new Date().toISOString(),
        workspaceId,
        workspaceKbAccessMode: workspaceMode ?? 'cli',
        selectedMode: selectedMode ?? workspaceMode ?? 'cli',
        providers: {
          direct: {
            mode: 'direct',
            provider: 'direct',
            ok: false,
            message: 'Direct access shell registered, but the executor path is not enabled yet'
          },
          mcp: {
            mode: 'mcp',
            provider: 'mcp',
            ok: true,
            message: 'MCP access ready'
          },
          cli: {
            mode: 'cli',
            provider: 'cli',
            ok: true,
            message: 'CLI access ready'
          }
        },
        issues: [],
        availableModes: ['mcp', 'cli']
      });

      const importResp = await bus.execute({
        method: 'pbiBatch.import',
        payload: {
          workspaceId: workspace.id,
          sourceFileName: 'delete-food-list.csv',
          sourceContent: 'Id,Title,Description\n1,Delete a Food List,Fix the batch-analysis scope gap for Delete a Food List before worker execution'
        }
      });
      expect(importResp.ok).toBe(true);
      const batchId = (importResp.data as { batch: { id: string } }).batch.id;

      const initialJob = await jobs.start('agent.analysis.run', {
        workspaceId: workspace.id,
        batchId
      });
      expect(initialJob.state).toBe('FAILED');

      const pausedInspectionResp = await bus.execute({
        method: 'batch.analysis.inspection.get',
        payload: { workspaceId: workspace.id, batchId }
      });
      expect(pausedInspectionResp.ok).toBe(true);
      const pausedInspection = pausedInspectionResp.data as {
        snapshot: {
          pausedForUserInput: boolean;
          unansweredRequiredQuestionCount: number;
          latestIteration?: { stage: string; status: string } | null;
        };
        reviews: Array<{ verdict: string }>;
        questionSets: Array<{ id: string; resumeStage: string; status: string }>;
        questions: Array<{ id: string; prompt: string; answer?: string }>;
        workerReports: Array<unknown>;
        stageRuns: Array<{ role: string }>;
      };
      expect(pausedInspection.snapshot.pausedForUserInput).toBe(true);
      expect(pausedInspection.snapshot.unansweredRequiredQuestionCount).toBe(1);
      expect(pausedInspection.snapshot.latestIteration?.stage).toBe('awaiting_user_input');
      expect(pausedInspection.snapshot.latestIteration?.status).toBe('needs_user_input');
      expect(pausedInspection.reviews.some((review) => review.verdict === 'needs_user_input')).toBe(true);
      expect(pausedInspection.questionSets[0]?.resumeStage).toBe('plan_revision');
      expect(pausedInspection.questionSets[0]?.status).toBe('waiting');
      expect(pausedInspection.workerReports).toHaveLength(0);
      expect(pausedInspection.stageRuns.some((run) => run.role === 'worker')).toBe(false);

      const question = pausedInspection.questions.find((entry) => entry.prompt.includes('Delete a Food List'));
      expect(question?.id).toBeTruthy();

      const answerResp = await bus.execute({
        method: 'batch.analysis.questions.answer',
        payload: {
          workspaceId: workspace.id,
          batchId,
          questionId: question?.id,
          answer: 'Include Delete a Food List in this batch as an edit to the existing article.'
        }
      });
      expect(answerResp.ok).toBe(true);
      const answerData = answerResp.data as {
        resumeTriggered: boolean;
        unansweredRequiredQuestionCount: number;
        questionSetStatus: string;
      };
      expect(answerData.resumeTriggered).toBe(true);
      expect(answerData.unansweredRequiredQuestionCount).toBe(0);
      expect(answerData.questionSetStatus).toBe('ready_to_resume');

      const resumedInspection = await waitForCondition(async () => {
        const inspectionResp = await bus.execute({
          method: 'batch.analysis.inspection.get',
          payload: { workspaceId: workspace.id, batchId }
        });
        expect(inspectionResp.ok).toBe(true);
        return inspectionResp.data as {
          snapshot: {
            pausedForUserInput: boolean;
            latestIteration?: { stage: string } | null;
            latestApprovedPlan?: { items: Array<{ targetTitle?: string }> } | null;
          };
          questions: Array<{ prompt: string; answer?: string }>;
          workerReports: Array<unknown>;
          stageRuns: Array<{ role: string }>;
          finalReviews: Array<{ verdict: string }>;
        };
      }, (inspection) =>
        inspection.snapshot.latestIteration?.stage === 'approved'
        && inspection.workerReports.length > 0
        && inspection.finalReviews.some((review) => review.verdict === 'approved')
      );

      expect(resumedInspection.snapshot.pausedForUserInput).toBe(false);
      expect(
        resumedInspection.snapshot.latestApprovedPlan?.items.some((item) => item.targetTitle === 'Delete a Food List')
      ).toBe(true);
      expect(
        resumedInspection.questions.some((entry) =>
          entry.prompt.includes('Delete a Food List')
          && entry.answer?.includes('Include Delete a Food List')
        )
      ).toBe(true);
      expect(resumedInspection.stageRuns.some((run) => run.role === 'worker')).toBe(true);

      const promptRequests = await readLoggedRequests(logPath);
      const plannerPrompts = promptRequests
        .filter((entry) => entry.method === 'session/prompt')
        .map((entry) => extractPromptText(entry))
        .filter((text) => text.includes('Create a complete structured batch analysis plan.'));
      expect(plannerPrompts.length).toBeGreaterThanOrEqual(2);
      expect(plannerPrompts.some((text) =>
        text.includes('resolvedUserAnswers')
        && text.includes('Include Delete a Food List in this batch as an edit to the existing article.')
      )).toBe(true);
    } finally {
      delete process.env.KBV_TEST_ACP_LOG_PATH;
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  test('uses needs_user_input instead of needs_human_review when the reviewer returns a concrete blocking question', async () => {
    const harness = await createTestHarness();

    try {
      const workspace = await harness.createWorkspace();
      const settingsResp = await harness.bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'cli'
        }
      });
      expect(settingsResp.ok).toBe(true);

      const importResp = await harness.bus.execute({
        method: 'pbiBatch.import',
        payload: {
          workspaceId: workspace.id,
          sourceFileName: 'reviewer-question.csv',
          sourceContent: 'Id,Title,Description\n1,Escalation workflow,Exercise reviewer-authored blocking question precedence'
        }
      });
      expect(importResp.ok).toBe(true);
      const batchId = (importResp.data as { batch: { id: string } }).batch.id;

      const rowsResp = await harness.bus.execute({
        method: 'pbiBatch.rows.list',
        payload: {
          workspaceId: workspace.id,
          batchId
        }
      });
      expect(rowsResp.ok).toBe(true);
      const uploadedPbis = (rowsResp.data as { rows: Array<{ id: string }> }).rows;
      const firstPbiId = uploadedPbis[0]?.id;
      expect(firstPbiId).toBeTruthy();

      const agentRuntime = harness.services.agentRuntime as any;
      agentRuntime.checkHealth = async (workspaceId: string, selectedMode?: string, workspaceMode?: string) => ({
        checkedAtUtc: new Date().toISOString(),
        workspaceId,
        workspaceKbAccessMode: workspaceMode ?? 'cli',
        selectedMode: selectedMode ?? workspaceMode ?? 'cli',
        providers: {
          direct: {
            mode: 'direct',
            provider: 'direct',
            ok: false,
            message: 'Direct executor disabled for this test'
          },
          mcp: {
            mode: 'mcp',
            provider: 'mcp',
            ok: true,
            message: 'MCP access ready'
          },
          cli: {
            mode: 'cli',
            provider: 'cli',
            ok: true,
            message: 'CLI access ready'
          }
        },
        issues: [],
        availableModes: ['mcp', 'cli']
      });
      agentRuntime.getTranscripts = async ({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) => ({
        workspaceId,
        sessionId,
        lines: []
      });

      const runRequests: Array<{ role?: string }> = [];
      agentRuntime.runBatchAnalysis = async (request: {
        agentRole?: string;
        kbAccessMode?: string;
      }) => {
        runRequests.push({ role: request.agentRole });
        const startedAtUtc = new Date().toISOString();
        const payloadByRole: Record<string, unknown> = request.agentRole === 'planner'
          ? {
              text: JSON.stringify({
                summary: 'Planner produced a draft plan without user-facing questions.',
                coverage: [
                  {
                    pbiId: firstPbiId,
                    outcome: 'covered',
                    planItemIds: ['item-1']
                  }
                ],
                items: [
                  {
                    planItemId: 'item-1',
                    pbiIds: [firstPbiId],
                    action: 'create',
                    targetType: 'new_article',
                    targetTitle: 'Escalation workflow article',
                    reason: 'The planner proposed a net-new article.',
                    evidence: [
                      {
                        kind: 'pbi',
                        ref: `pbi:${firstPbiId}`,
                        summary: 'Imported PBI is the main source of evidence.'
                      }
                    ],
                    confidence: 0.88,
                    executionStatus: 'pending'
                  }
                ],
                questions: [],
                openQuestions: []
              })
            }
          : request.agentRole === 'plan-reviewer'
            ? {
                text: JSON.stringify({
                  summary: 'Reviewer wants escalation, but only after one user scope answer.',
                  verdict: 'needs_human_review',
                  didAccountForEveryPbi: true,
                  hasMissingCreates: false,
                  hasMissingEdits: false,
                  hasTargetIssues: false,
                  hasOverlapOrConflict: false,
                  foundAdditionalArticleWork: false,
                  underScopedKbImpact: false,
                  questions: [
                    {
                      id: 'reviewer-question-1',
                      prompt: 'Should the escalation workflow article be included in this batch or explicitly deferred?',
                      reason: 'Reviewer found a concrete scope decision that the user can answer directly.',
                      requiresUserInput: true,
                      status: 'pending',
                      linkedPbiIds: [firstPbiId],
                      linkedPlanItemIds: ['item-1'],
                      linkedDiscoveryIds: []
                    }
                  ],
                  delta: {
                    summary: 'Waiting on a concrete scope decision.',
                    requestedChanges: [],
                    missingPbiIds: [],
                    missingCreates: [],
                    missingEdits: [],
                    additionalArticleWork: [],
                    targetCorrections: [],
                    overlapConflicts: []
                  }
                })
              }
            : {
                text: JSON.stringify({
                  summary: 'This stage should not run in the blocking-question test.'
                })
              };

        return {
          sessionId: `${request.agentRole}-session`,
          kbAccessMode: request.kbAccessMode ?? 'cli',
          status: 'ok',
          transcriptPath: '',
          rawOutput: [],
          resultPayload: payloadByRole,
          finalText: typeof (payloadByRole as { text?: string }).text === 'string' ? (payloadByRole as { text: string }).text : undefined,
          toolCalls: [],
          startedAtUtc,
          endedAtUtc: startedAtUtc,
          durationMs: 1,
          message: 'Completed'
        };
      };

      const job = await harness.jobs.start('agent.analysis.run', {
        workspaceId: workspace.id,
        batchId
      });
      expect(job.state).toBe('FAILED');

      const inspectionResp = await harness.bus.execute({
        method: 'batch.analysis.inspection.get',
        payload: { workspaceId: workspace.id, batchId }
      });
      expect(inspectionResp.ok).toBe(true);
      const inspection = inspectionResp.data as {
        snapshot: {
          pausedForUserInput: boolean;
          unansweredRequiredQuestionCount: number;
          latestIteration?: { stage: string; status: string } | null;
        };
        reviews: Array<{ verdict: string }>;
        questionSets: Array<{ resumeStage: string; status: string }>;
        questions: Array<{ prompt: string; status: string }>;
        stageRuns: Array<{ role: string }>;
      };

      expect(inspection.snapshot.pausedForUserInput).toBe(true);
      expect(inspection.snapshot.unansweredRequiredQuestionCount).toBe(1);
      expect(inspection.snapshot.latestIteration?.stage).toBe('awaiting_user_input');
      expect(inspection.snapshot.latestIteration?.status).toBe('needs_user_input');
      expect(inspection.reviews.some((review) => review.verdict === 'needs_user_input')).toBe(true);
      expect(inspection.questionSets[0]?.resumeStage).toBe('plan_revision');
      expect(inspection.questionSets[0]?.status).toBe('waiting');
      expect(inspection.questions).toEqual([
        expect.objectContaining({
          prompt: 'Should the escalation workflow article be included in this batch or explicitly deferred?',
          status: 'pending'
        })
      ]);
      expect(inspection.stageRuns.some((run) => run.role === 'worker')).toBe(false);
      expect(runRequests).toEqual([
        { role: 'planner' },
        { role: 'plan-reviewer' }
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  test('does not start worker when approved review still leaves unresolved PBI gap coverage', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch-analysis-unresolved-gap-'));
    const logPath = path.join(isolatedRoot, 'batch-analysis-unresolved-gap.jsonl');
    process.env.KBV_TEST_ACP_LOG_PATH = logPath;
    process.env.KBV_CURSOR_BINARY = await createUnresolvedGapBatchAnalysisAcpBinary(isolatedRoot);

    try {
      const workspace = await createWorkspace();
      const settingsResp = await bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'cli'
        }
      });
      expect(settingsResp.ok).toBe(true);

      const importResp = await bus.execute({
        method: 'pbiBatch.import',
        payload: {
          workspaceId: workspace.id,
          sourceFileName: 'unresolved-gap.csv',
          sourceContent: 'Id,Title,Description\n1,Covered article,Cover the first article\n2,Missing article,Leave this unresolved to exercise the approval guard'
        }
      });
      expect(importResp.ok).toBe(true);
      const batchId = (importResp.data as { batch: { id: string } }).batch.id;

      const job = await jobs.start('agent.analysis.run', {
        workspaceId: workspace.id,
        batchId
      });
      expect(job.state).toBe('FAILED');

      const inspectionResp = await bus.execute({
        method: 'batch.analysis.inspection.get',
        payload: { workspaceId: workspace.id, batchId }
      });
      expect(inspectionResp.ok).toBe(true);
      const inspection = inspectionResp.data as {
        snapshot: {
          latestIteration?: { stage: string; status: string } | null;
        };
        reviews: Array<{ verdict: string; delta?: { requestedChanges?: string[] } }>;
        workerReports: Array<unknown>;
        stageRuns: Array<{ role: string }>;
      };
      expect(inspection.snapshot.latestIteration?.stage).toBe('needs_human_review');
      expect(inspection.snapshot.latestIteration?.status).toBe('needs_human_review');
      expect(inspection.workerReports).toHaveLength(0);
      expect(inspection.stageRuns.some((run) => run.role === 'worker')).toBe(false);
      expect(
        inspection.reviews.some((review) =>
          review.verdict === 'needs_revision'
          && review.delta?.requestedChanges?.includes('PBI 2 is still marked as a gap.')
        )
      ).toBe(true);

      const promptRequests = await readLoggedRequests(logPath);
      expect(promptRequests.some((entry) => {
        const text = extractPromptText(entry);
        return text.includes('Execute only the approved plan items below.');
      })).toBe(false);
    } finally {
      delete process.env.KBV_TEST_ACP_LOG_PATH;
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  test('runs batch analysis through revision, amendment, and final rework loops', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch-analysis-commands-'));
    process.env.KBV_CURSOR_BINARY = await createFakeBatchAnalysisAcpBinary(isolatedRoot);

    try {
      const workspace = await createWorkspace();
      const settingsResp = await bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'cli'
        }
      });
      expect(settingsResp.ok).toBe(true);
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

      const seededProposalInputs = [
        {
          targetTitle: 'Team Dashboard',
          rationaleSummary: 'Seeded proposal for deterministic edit coverage.',
          aiNotes: 'Refresh the team dashboard workflow documentation.',
          sourceHtml: '<h1>Team Dashboard</h1><p>Current dashboard configuration help.</p>',
          proposedHtml: '<h1>Team Dashboard</h1><p>Updated dashboard workflow guidance.</p>',
          relatedPbiIds: ['101']
        },
        {
          targetTitle: 'Leadership Tile Settings',
          rationaleSummary: 'Seeded proposal for deterministic leadership settings coverage.',
          aiNotes: 'Refresh the leadership tile settings guidance.',
          sourceHtml: '<h1>Leadership Tile Settings</h1><p>Configure leadership tiles in the dashboard.</p>',
          proposedHtml: '<h1>Leadership Tile Settings</h1><p>Updated leadership tile settings guidance.</p>',
          relatedPbiIds: ['102']
        }
      ];

      for (const proposal of seededProposalInputs) {
        const proposalResp = await bus.execute({
          method: 'proposal.ingest',
          payload: {
            workspaceId: workspace.id,
            batchId,
            action: 'edit',
            targetTitle: proposal.targetTitle,
            targetLocale: 'en-us',
            confidenceScore: 0.88,
            rationaleSummary: proposal.rationaleSummary,
            aiNotes: proposal.aiNotes,
            sourceHtml: proposal.sourceHtml,
            proposedHtml: proposal.proposedHtml,
            relatedPbiIds: proposal.relatedPbiIds
          }
        });
        expect(proposalResp.ok).toBe(true);
      }

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
      expect(latestData.orchestration?.latestApprovedPlan?.items.length).toBeGreaterThanOrEqual(2);
      expect(latestData.orchestration?.latestFinalReview?.verdict).toBe('approved');

      const inspectionResp = await bus.execute({
        method: 'batch.analysis.inspection.get',
        payload: { workspaceId: workspace.id, batchId }
      });
      expect(inspectionResp.ok).toBe(true);
      const inspection = inspectionResp.data as {
        stageRuns: Array<{
          stage: string;
          role: string;
          localSessionId?: string;
          acpSessionId?: string;
          status: string;
        }>;
        plans: Array<{ verdict: string }>;
        reviews: Array<{ verdict: string }>;
        amendments: Array<{ status: string }>;
        finalReviewReworkPlans: Array<{ summary: string }>;
      };
      expect(inspection.plans.length).toBeGreaterThanOrEqual(4);
      expect(inspection.reviews.some((review) => review.verdict === 'needs_revision')).toBeTruthy();
      expect(inspection.amendments.some((amendment) => amendment.status === 'approved')).toBeTruthy();
      expect(inspection.finalReviewReworkPlans).toHaveLength(1);
      const buildingWorkerRuns = inspection.stageRuns.filter((run) => run.stage === 'building' && run.role === 'worker');
      expect(buildingWorkerRuns).toHaveLength(2);
      expect(new Set(buildingWorkerRuns.map((run) => run.localSessionId))).toEqual(new Set([buildingWorkerRuns[0]?.localSessionId]));
      expect(new Set(buildingWorkerRuns.map((run) => run.acpSessionId))).toEqual(new Set([buildingWorkerRuns[0]?.acpSessionId]));
      const planningStageRuns = inspection.stageRuns.filter((run) => run.role === 'planner' || run.role === 'plan-reviewer');
      expect(planningStageRuns.length).toBeGreaterThanOrEqual(4);
      expect(new Set(planningStageRuns.map((run) => run.localSessionId)).size).toBe(1);
      expect(planningStageRuns[0]?.localSessionId).not.toBe(buildingWorkerRuns[0]?.localSessionId);
      const reworkRuns = inspection.stageRuns.filter((run) => run.stage === 'reworking' && run.role === 'worker');
      expect(reworkRuns).toHaveLength(1);
      expect(reworkRuns[0]?.localSessionId).toBe(buildingWorkerRuns[0]?.localSessionId);

      const runtimeResp = await bus.execute({
        method: 'batch.analysis.runtime.get',
        payload: { workspaceId: workspace.id, batchId }
      });
      expect(runtimeResp.ok).toBe(true);
      const runtime = runtimeResp.data as {
        stage: string;
        role: string;
        latestEventType: string;
        executionCounts: { total: number; executed: number; blocked: number };
      } | null;
      expect(runtime?.stage).toBe('approved');
      expect(runtime?.role).toBe('final-reviewer');
      expect(runtime?.executionCounts.total).toBeGreaterThanOrEqual(2);
      expect((runtime?.executionCounts.executed ?? 0) + (runtime?.executionCounts.blocked ?? 0)).toBe(
        runtime?.executionCounts.total
      );

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
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  test('escalates to human review when planner output cannot be salvaged locally', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch-analysis-planner-repair-'));
    process.env.KBV_CURSOR_BINARY = await createPlannerRepairAcpBinary(isolatedRoot);

    try {
      const workspace = await createWorkspace();
      const settingsResp = await bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'cli'
        }
      });
      expect(settingsResp.ok).toBe(true);
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
      expect(job.state).toBe('FAILED');
      expect(jobEvents.some((event) => event.message?.includes('Planner returned incomplete output'))).toBeTruthy();

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
      expect(latestData.orchestration?.latestIteration?.stage).toBe('needs_human_review');
      expect(latestData.orchestration?.latestIteration?.role).toBe('planner');
      expect(latestData.orchestration?.latestApprovedPlan).toBeNull();
      expect(latestData.orchestration?.latestFinalReview).toBeNull();

      const inspectionResp = await bus.execute({
        method: 'batch.analysis.inspection.get',
        payload: { workspaceId: workspace.id, batchId }
      });
      expect(inspectionResp.ok).toBe(true);
      const inspection = inspectionResp.data as {
        stageRuns: Array<{ stage: string; role: string; retryType?: string }>;
        workerReports: unknown[];
      };
      expect(inspection.workerReports).toHaveLength(0);
      expect(inspection.stageRuns.some((run) => run.stage === 'planning' && run.role === 'planner')).toBeTruthy();
      expect(inspection.stageRuns.some((run) => run.retryType === 'planner_json_retry')).toBeTruthy();
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  test('retries the planner in a fresh local session when the JSON retry returns a provider error string', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch-analysis-planner-runtime-retry-'));
    process.env.KBV_CURSOR_BINARY = await createPlannerRuntimeRetryAcpBinary(isolatedRoot);

    try {
      const workspace = await createWorkspace();
      const settingsResp = await bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'cli'
        }
      });
      expect(settingsResp.ok).toBe(true);
      const importResp = await bus.execute({
        method: 'pbiBatch.import',
        payload: {
          workspaceId: workspace.id,
          sourceFileName: 'planner-runtime-retry.csv',
          sourceContent: 'Id,Title,Description\n1,Planner Runtime Retry,Verify planner provider errors retry in a fresh session'
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
          latestApprovedPlan?: { summary?: string };
        } | null;
      };
      expect(latestData.orchestration?.latestIteration?.stage).toBe('approved');
      expect(latestData.orchestration?.latestApprovedPlan?.summary).toContain('Recovered draft plan');

      const inspectionResp = await bus.execute({
        method: 'batch.analysis.inspection.get',
        payload: { workspaceId: workspace.id, batchId }
      });
      expect(inspectionResp.ok).toBe(true);
      const inspection = inspectionResp.data as {
        stageRuns: Array<{ retryType?: string; sessionReusePolicy?: string; localSessionId?: string }>;
      };
      expect(inspection.stageRuns.some((run) => run.retryType === 'planner_json_retry')).toBeTruthy();
      expect(inspection.stageRuns.some((run) =>
        run.retryType === 'planner_runtime_retry' && run.sessionReusePolicy === 'new_local_session'
      )).toBeTruthy();

      const plannerSessionIds = inspection.stageRuns
        .filter((run) => run.retryType === 'planner_runtime_retry' || run.retryType === 'planner_json_retry' || run.retryType === undefined)
        .map((run) => run.localSessionId)
        .filter((value): value is string => typeof value === 'string');
      expect(new Set(plannerSessionIds).size).toBeGreaterThan(1);
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  test('fails batch analysis before runtime start when selected CLI provider is unhealthy', async () => {
    const harness = await createTestHarness();

    try {
      const workspace = await harness.createWorkspace();
      const settingsResp = await harness.bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'cli'
        }
      });
      expect(settingsResp.ok).toBe(true);

      const importResp = await harness.bus.execute({
        method: 'pbiBatch.import',
        payload: {
          workspaceId: workspace.id,
          sourceFileName: 'unhealthy-cli-selected.csv',
          sourceContent: 'Id,Title,Description\n1,Selected CLI Unhealthy,Verify strict preflight failure when CLI is selected'
        }
      });
      expect(importResp.ok).toBe(true);
      const batchId = (importResp.data as { batch: { id: string } }).batch.id;

      const agentRuntime = harness.services.agentRuntime as any;
      const originalRunBatchAnalysis = agentRuntime.runBatchAnalysis.bind(agentRuntime);
      let runBatchCalled = false;
      agentRuntime.checkHealth = async (workspaceId, selectedMode, workspaceMode) => ({
        checkedAtUtc: new Date().toISOString(),
        workspaceId,
        workspaceKbAccessMode: workspaceMode ?? 'cli',
        selectedMode: selectedMode ?? 'cli',
        providers: {
          direct: {
            mode: 'direct',
            provider: 'direct',
            ok: false,
            message: 'Direct access shell registered, but the executor path is not enabled yet'
          },
          mcp: {
            mode: 'mcp',
            provider: 'mcp',
            ok: true,
            message: 'MCP access ready'
          },
          cli: {
            mode: 'cli',
            provider: 'cli',
            ok: false,
            message: 'CLI loopback probe failed'
          }
        },
        issues: ['CLI loopback probe failed'],
        availableModes: ['mcp']
      });
      agentRuntime.runBatchAnalysis = async (...args) => {
        runBatchCalled = true;
        return originalRunBatchAnalysis(...args);
      };

      const jobEvents: Array<{ message?: string; metadata?: Record<string, unknown> }> = [];
      harness.jobs.setEmitter((event) => {
        if (event.command === 'agent.analysis.run') {
          jobEvents.push(event);
        }
      });

      const job = await harness.jobs.start('agent.analysis.run', {
        workspaceId: workspace.id,
        batchId
      });
      const failedEvent = jobEvents.filter((event) => event.message).at(-1);

      expect(job.state).toBe('FAILED');
      expect(failedEvent?.message).toContain('Selected KB access mode CLI is not ready');
      expect(failedEvent?.message).toContain('will not switch providers automatically');
      expect(runBatchCalled).toBe(false);
      expect(jobEvents.some((event) => event.message?.includes('falling back'))).toBe(false);
      expect(jobEvents.some((event) => event.metadata?.kbAccessMode === 'mcp')).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });

  test('fails batch analysis before runtime start when selected MCP provider is unhealthy', async () => {
    const harness = await createTestHarness();

    try {
      const workspace = await harness.createWorkspace();
      const settingsResp = await harness.bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'mcp'
        }
      });
      expect(settingsResp.ok).toBe(true);

      const importResp = await harness.bus.execute({
        method: 'pbiBatch.import',
        payload: {
          workspaceId: workspace.id,
          sourceFileName: 'unhealthy-mcp-selected.csv',
          sourceContent: 'Id,Title,Description\n1,Selected MCP Unhealthy,Verify strict preflight failure when MCP is selected'
        }
      });
      expect(importResp.ok).toBe(true);
      const batchId = (importResp.data as { batch: { id: string } }).batch.id;

      const agentRuntime = harness.services.agentRuntime as any;
      const originalRunBatchAnalysis = agentRuntime.runBatchAnalysis.bind(agentRuntime);
      let runBatchCalled = false;
      agentRuntime.checkHealth = async (workspaceId, selectedMode, workspaceMode) => ({
        checkedAtUtc: new Date().toISOString(),
        workspaceId,
        workspaceKbAccessMode: workspaceMode ?? 'mcp',
        selectedMode: selectedMode ?? 'mcp',
        providers: {
          direct: {
            mode: 'direct',
            provider: 'direct',
            ok: false,
            message: 'Direct access shell registered, but the executor path is not enabled yet'
          },
          mcp: {
            mode: 'mcp',
            provider: 'mcp',
            ok: false,
            message: 'KB Vault MCP bridge is not reachable'
          },
          cli: {
            mode: 'cli',
            provider: 'cli',
            ok: true,
            message: 'CLI access ready'
          }
        },
        issues: ['KB Vault MCP bridge is not reachable'],
        availableModes: ['cli']
      });
      agentRuntime.runBatchAnalysis = async (...args) => {
        runBatchCalled = true;
        return originalRunBatchAnalysis(...args);
      };

      const jobEvents: Array<{ message?: string; metadata?: Record<string, unknown> }> = [];
      harness.jobs.setEmitter((event) => {
        if (event.command === 'agent.analysis.run') {
          jobEvents.push(event);
        }
      });

      const job = await harness.jobs.start('agent.analysis.run', {
        workspaceId: workspace.id,
        batchId
      });
      const failedEvent = jobEvents.filter((event) => event.message).at(-1);

      expect(job.state).toBe('FAILED');
      expect(failedEvent?.message).toContain('Selected KB access mode MCP is not ready');
      expect(failedEvent?.message).toContain('will not switch providers automatically');
      expect(runBatchCalled).toBe(false);
      expect(jobEvents.some((event) => event.message?.includes('falling back'))).toBe(false);
      expect(jobEvents.some((event) => event.metadata?.kbAccessMode === 'cli')).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });

  test('keeps batch analysis in CLI mode when a CLI worker hits a blocked shell after completing the turn', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch-analysis-cli-policy-fallback-'));
    const { binaryPath, configPath } = await createCliPolicyFallbackBatchAnalysisAcpBinary(isolatedRoot);
    process.env.KBV_CURSOR_BINARY = binaryPath;

    try {
      const workspace = await createWorkspace();
      const familyResp = await bus.execute({
        method: 'articleFamily.create',
        payload: {
          workspaceId: workspace.id,
          externalKey: 'cli-policy-retry-target',
          title: 'Checklist Policy Retry'
        }
      });
      expect(familyResp.ok).toBe(true);
      const familyId = (familyResp.data as { id: string }).id;

      const localeResp = await bus.execute({
        method: 'localeVariant.create',
        payload: {
          workspaceId: workspace.id,
          familyId,
          locale: 'en-us',
          status: 'live'
        }
      });
      expect(localeResp.ok).toBe(true);
      const localeVariantId = (localeResp.data as { id: string }).id;

      await writeFile(configPath, JSON.stringify({
        familyId,
        localeVariantId,
        targetTitle: 'Checklist Policy Retry'
      }), 'utf8');

      const agentRuntime = services.agentRuntime as any;
      agentRuntime.checkHealth = async (workspaceId, selectedMode, workspaceMode) => ({
        checkedAtUtc: new Date().toISOString(),
        workspaceId,
        workspaceKbAccessMode: workspaceMode ?? 'cli',
        selectedMode: selectedMode ?? workspaceMode ?? 'cli',
        providers: {
          direct: {
            mode: 'direct',
            provider: 'direct',
            ok: false,
            message: 'Direct access shell registered, but the executor path is not enabled yet'
          },
          mcp: {
            mode: 'mcp',
            provider: 'mcp',
            ok: false,
            message: 'MCP access unavailable for this test'
          },
          cli: {
            mode: 'cli',
            provider: 'cli',
            ok: true,
            message: 'CLI access ready'
          }
        },
        issues: [],
        availableModes: ['cli']
      });
      const batchAnalysisOrchestrator = services.batchAnalysisOrchestrator as {
        applyDeterministicPlanReviewGuard: (input: unknown) => unknown;
      };
      batchAnalysisOrchestrator.applyDeterministicPlanReviewGuard = (input: {
        review: unknown;
      }) => ({
        review: input.review,
        forcedRevision: false,
        missingEditTargets: [],
        missingCreateTargets: [],
        conflictingTargets: [],
        unresolvedTargetIssues: [],
        unresolvedReferenceIssues: []
      });

      const settingsResp = await bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'cli'
        }
      });
      expect(settingsResp.ok).toBe(true);

      const importResp = await bus.execute({
        method: 'pbiBatch.import',
        payload: {
          workspaceId: workspace.id,
          sourceFileName: 'cli-policy-fallback.csv',
          sourceContent: 'Id,Title,Description\n1,Checklist Policy Retry,Verify CLI worker retries in MCP when a blocked shell call happens after research'
        }
      });
      expect(importResp.ok).toBe(true);
      const batchId = (importResp.data as { batch: { id: string } }).batch.id;

      const jobEvents: Array<{ message?: string; metadata?: Record<string, unknown> }> = [];
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
      expect(jobEvents.some((event) => event.message?.includes('Retrying in MCP mode'))).toBe(false);
      expect(jobEvents.some((event) => event.metadata?.kbAccessMode === 'mcp')).toBe(false);

      const latestResp = await bus.execute({
        method: 'agent.analysis.latest',
        payload: { workspaceId: workspace.id, batchId, limit: 0 }
      });
      expect(latestResp.ok).toBe(true);
      const latestData = latestResp.data as {
        orchestration?: {
          latestIteration?: { stage: string; role: string };
          latestFinalReview?: { verdict: string };
        } | null;
      };
      expect(latestData.orchestration?.latestIteration?.stage).toBe('approved');
      expect(latestData.orchestration?.latestFinalReview?.verdict).toBe('approved');

      const inspectionResp = await bus.execute({
        method: 'batch.analysis.inspection.get',
        payload: { workspaceId: workspace.id, batchId }
      });
      expect(inspectionResp.ok).toBe(true);
      const inspection = inspectionResp.data as {
        stageRuns: Array<{ kbAccessMode?: string; retryType?: string }>;
      };
      expect(inspection.stageRuns.some((run) => run.retryType === 'cli_policy_retry')).toBe(false);
      expect(new Set(inspection.stageRuns.map((run) => run.kbAccessMode).filter(Boolean))).toEqual(new Set(['cli']));
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  test('salvages truncated planner output locally into a registered plan instead of escalating', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch-analysis-truncated-planner-'));
    process.env.KBV_CURSOR_BINARY = await createTruncatedPlannerRepairAcpBinary(isolatedRoot);

    try {
      const workspace = await createWorkspace();
      const settingsResp = await bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'cli'
        }
      });
      expect(settingsResp.ok).toBe(true);
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

  test('forces revision when deterministic prefetch shows existing edit targets for an under-scoped create-only plan', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch-analysis-deterministic-prefetch-'));
    const { binaryPath, configPath } = await createDeterministicPrefetchBatchAcpBinary(isolatedRoot);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    const harness = await createTestHarness();

    try {
      const workspace = await harness.createWorkspace();
      const settingsResp = await harness.bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'cli'
        }
      });
      expect(settingsResp.ok).toBe(true);

      const teamDashboard = await createSearchableLiveArticle({
        bus: harness.bus,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        externalKey: 'team-dashboard',
        title: 'Team Dashboard',
        html: '<h1>Team Dashboard</h1><p>Current dashboard configuration help.</p>'
      });
      const leadershipTileSettings = await createSearchableLiveArticle({
        bus: harness.bus,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        externalKey: 'leadership-tile-settings',
        title: 'Leadership Tile Settings',
        html: '<h1>Leadership Tile Settings</h1><p>Configure leadership tiles in the dashboard.</p>'
      });
      await writeFile(
        configPath,
        JSON.stringify({
          teamDashboard,
          leadershipTileSettings
        }),
        'utf8'
      );

      const importResp = await harness.bus.execute({
        method: 'pbiBatch.import',
        payload: {
          workspaceId: workspace.id,
          sourceFileName: 'deterministic-prefetch.csv',
          sourceContent: 'Id,Title,Description\n101,Team Dashboard,Update the team dashboard workflow\n102,Leadership Tile Settings,Update leadership tile behavior'
        }
      });
      expect(importResp.ok).toBe(true);
      const batchId = (importResp.data as { batch: { id: string } }).batch.id;

      const seededProposalInputs = [
        {
          targetTitle: 'Team Dashboard',
          rationaleSummary: 'Seeded proposal for deterministic edit coverage.',
          aiNotes: 'Refresh the team dashboard workflow documentation.',
          sourceHtml: '<h1>Team Dashboard</h1><p>Current dashboard configuration help.</p>',
          proposedHtml: '<h1>Team Dashboard</h1><p>Updated dashboard workflow guidance.</p>',
          relatedPbiIds: ['101']
        },
        {
          targetTitle: 'Leadership Tile Settings',
          rationaleSummary: 'Seeded proposal for deterministic leadership settings coverage.',
          aiNotes: 'Refresh the leadership tile settings guidance.',
          sourceHtml: '<h1>Leadership Tile Settings</h1><p>Configure leadership tiles in the dashboard.</p>',
          proposedHtml: '<h1>Leadership Tile Settings</h1><p>Updated leadership tile settings guidance.</p>',
          relatedPbiIds: ['102']
        }
      ];

      for (const proposal of seededProposalInputs) {
        const proposalResp = await harness.bus.execute({
          method: 'proposal.ingest',
          payload: {
            workspaceId: workspace.id,
            batchId,
            action: 'edit',
            targetTitle: proposal.targetTitle,
            targetLocale: 'en-us',
            confidenceScore: 0.88,
            rationaleSummary: proposal.rationaleSummary,
            aiNotes: proposal.aiNotes,
            sourceHtml: proposal.sourceHtml,
            proposedHtml: proposal.proposedHtml,
            relatedPbiIds: proposal.relatedPbiIds
          }
        });
        expect(proposalResp.ok).toBe(true);
      }

      const job = await harness.jobs.start('agent.analysis.run', {
        workspaceId: workspace.id,
        batchId
      });
      expect(job.state).toBe('SUCCEEDED');

      const inspectionResp = await harness.bus.execute({
        method: 'batch.analysis.inspection.get',
        payload: { workspaceId: workspace.id, batchId }
      });
      expect(inspectionResp.ok).toBe(true);
      const inspection = inspectionResp.data as {
        plans: Array<{ verdict: string; items: Array<{ action: string; targetTitle: string }> }>;
        reviews: Array<{ verdict: string; summary: string; delta?: { missingEdits?: string[] } }>;
      };

      expect(inspection.reviews.some((review) =>
        review.verdict === 'needs_revision'
        && review.delta?.missingEdits?.includes('Team Dashboard')
      )).toBeTruthy();

      const latestApprovedPlan = inspection.plans.find((plan) =>
        plan.verdict === 'approved'
        && plan.items.every((item) => item.action === 'edit')
      );
      expect(latestApprovedPlan).toBeTruthy();
      expect(latestApprovedPlan?.items.map((item) => item.targetTitle)).toEqual([
        'Team Dashboard',
        'Leadership Tile Settings'
      ]);

      const eventsResp = await harness.bus.execute({
        method: 'batch.analysis.events.get',
        payload: { workspaceId: workspace.id, batchId, limit: 100 }
      });
      expect(eventsResp.ok).toBe(true);
      const events = (eventsResp.data as {
        events: Array<{ details?: { transitionReason?: string; missingEditTargets?: string[] } }>;
      }).events;

      expect(events.some((event) =>
        event.details?.transitionReason === 'deterministic_prefetch_missing_edits'
        && event.details?.missingEditTargets?.includes('Team Dashboard')
      )).toBeTruthy();
    } finally {
      await harness.cleanup();
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  test('repairs a malformed planner target article ID before review approval and continues into building', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch-analysis-invalid-target-repair-'));
    const { binaryPath, configPath } = await createInvalidTargetRepairBatchAcpBinary(isolatedRoot);
    process.env.KBV_CURSOR_BINARY = binaryPath;
    const harness = await createTestHarness();

    try {
      const workspace = await harness.createWorkspace();
      const settingsResp = await harness.bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'cli'
        }
      });
      expect(settingsResp.ok).toBe(true);
      const article = await createSearchableLiveArticle({
        bus: harness.bus,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        externalKey: 'food-list-create-food-item',
        title: 'Create a Food Item',
        html: '<h1>Create a Food Item</h1><p>Create an item from a food list.</p>'
      });

      const invalidLocaleVariantId = `${article.localeVariantId.slice(0, -1)}${article.localeVariantId.endsWith('0') ? '1' : '0'}`;
      expect(invalidLocaleVariantId).not.toBe(article.localeVariantId);
      await writeFile(configPath, JSON.stringify({
        familyId: article.familyId,
        invalidLocaleVariantId,
        targetTitle: 'Create a Food Item'
      }), 'utf8');

      const importResp = await harness.bus.execute({
        method: 'pbiBatch.import',
        payload: {
          workspaceId: workspace.id,
          sourceFileName: 'invalid-target-repair.csv',
          sourceContent: 'Id,Title,Description\n301,Create a Food Item,Validate target repair before worker execution'
        }
      });
      expect(importResp.ok).toBe(true);
      const batchId = (importResp.data as { batch: { id: string } }).batch.id;

      const rowsResp = await harness.bus.execute({
        method: 'pbiBatch.rows.list',
        payload: {
          workspaceId: workspace.id,
          batchId
        }
      });
      expect(rowsResp.ok).toBe(true);
      const importedRow = (rowsResp.data as {
        rows: Array<{ id: string; externalId: string }>;
      }).rows[0];
      expect(importedRow).toBeTruthy();

      const invalidPbiId = `${importedRow.id.slice(0, 18)}${importedRow.id.slice(19)}`;
      expect(invalidPbiId).not.toBe(importedRow.id);
      const truncatedExternalId = importedRow.externalId.slice(0, Math.max(1, importedRow.externalId.length - 1));
      await writeFile(configPath, JSON.stringify({
        familyId: article.familyId,
        invalidLocaleVariantId,
        invalidPbiId,
        truncatedExternalId,
        targetTitle: 'Create a Food Item'
      }), 'utf8');

      const job = await harness.jobs.start('agent.analysis.run', {
        workspaceId: workspace.id,
        batchId
      });
      expect(job.state).toBe('SUCCEEDED');

      const latestResp = await harness.bus.execute({
        method: 'agent.analysis.latest',
        payload: { workspaceId: workspace.id, batchId, limit: 0 }
      });
      expect(latestResp.ok).toBe(true);
      const latestData = latestResp.data as {
        orchestration?: {
          latestIteration?: { stage: string };
          latestApprovedPlan?: { items: Array<{ targetArticleId?: string; targetFamilyId?: string }> };
        } | null;
      };

      expect(latestData.orchestration?.latestIteration?.stage).toBe('approved');
      expect(latestData.orchestration?.latestApprovedPlan?.items[0]?.pbiIds).toEqual([importedRow.id]);
      expect(latestData.orchestration?.latestApprovedPlan?.items[0]?.targetArticleId).toBe(article.localeVariantId);
      expect(latestData.orchestration?.latestApprovedPlan?.items[0]?.targetFamilyId).toBe(article.familyId);

      const eventsResp = await harness.bus.execute({
        method: 'batch.analysis.events.get',
        payload: { workspaceId: workspace.id, batchId, limit: 100 }
      });
      expect(eventsResp.ok).toBe(true);
      const events = (eventsResp.data as {
        events: Array<{ stage: string; details?: { transitionReason?: string; targetRepairs?: string[] } }>;
      }).events;

      expect(events.some((event) =>
        event.details?.transitionReason === 'deterministic_target_repair'
        && event.details?.targetRepairs?.some((repair) => repair.includes(article.localeVariantId))
      )).toBeTruthy();
      expect(events.some((event) =>
        event.details?.transitionReason === 'deterministic_batch_reference_repair'
      )).toBeTruthy();
      expect(events.some((event) => event.stage === 'building')).toBeTruthy();
    } finally {
      await harness.cleanup();
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
          kbAccessMode: 'cli',
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
      expect((runtimeOptionsResp.data as { currentModelId?: string }).currentModelId).toBe(
        'gpt-5.4[reasoning=medium,context=272k,fast=false]'
      );

      await writeFile(releasePath, 'release', 'utf8');

      const job = await jobPromise;
      expect(job.state).toBe('SUCCEEDED');

      const requests = await readLoggedRequests(logPath);
      const sessionNewRequests = requests.filter((entry) => entry.method === 'session/new');
      const setModelRequests = requests.filter((entry) => entry.method === 'session/set_model');

      expect(sessionNewRequests).toHaveLength(3);
      expect(sessionNewRequests.map((entry) => entry.params?.config?.mode)).toEqual([
        'plan',
        'agent',
        'plan'
      ]);
      expect(setModelRequests).toHaveLength(3);
      expect(setModelRequests.every((entry) =>
        entry.params?.modelId === 'gpt-5.4[reasoning=medium,context=272k,fast=false]'
      )).toBe(true);
    } finally {
      delete process.env.KBV_TEST_ACP_LOG_PATH;
      delete process.env.KBV_TEST_ACP_RELEASE_PATH;
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });

  for (const kbAccessMode of ['mcp', 'cli'] as const) {
    test(`supports the global AI assistant flows across article, draft, proposal, and template contexts in ${kbAccessMode.toUpperCase()} mode`, async () => {
      await runGlobalAssistantFlowForMode(kbAccessMode);
    });
  }

  test('prefers the clean assistant reply over corrupt streamed transcript chunks for chat responses', async () => {
    const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-ai-chat-corrupt-stream-'));
    process.env.KBV_CURSOR_BINARY = await createAssistantChatCorruptStreamBinary(isolatedRoot);
    const harness = await createTestHarness();

    try {
      const workspace = await harness.createWorkspace();
      const settingsResp = await harness.bus.execute({
        method: 'workspace.settings.update',
        payload: {
          workspaceId: workspace.id,
          kbAccessMode: 'cli'
        }
      });
      expect(settingsResp.ok).toBe(true);
      const turn = await harness.bus.execute({
        method: 'ai.assistant.message.send',
        payload: {
          workspaceId: workspace.id,
          context: {
            workspaceId: workspace.id,
            route: AppRoute.KB_VAULT_HOME,
            routeLabel: 'KB Vault Home',
            subject: {
              type: 'workspace',
              id: workspace.id
            },
            workingState: {
              kind: 'none',
              payload: null
            },
            capabilities: {
              canChat: true,
              canCreateProposal: false,
              canPatchProposal: false,
              canPatchDraft: false,
              canPatchTemplate: false,
              canUseUnsavedWorkingState: false
            },
            backingData: {
              route: AppRoute.KB_VAULT_HOME
            }
          },
          message: 'What is the relationship between areas, schedules, and setups?'
        }
      });

      expect(turn.ok).toBe(true);
      const data = turn.data as {
        artifact?: { artifactType: string };
        messages: Array<{ role: string; content: string }>;
      };
      expect(data.artifact?.artifactType).toBe('informational_response');
      const assistantMessage = [...data.messages].reverse().find((message) => message.role === 'assistant');
      expect(assistantMessage?.content).toBe(
        'Areas are the main container. Schedules define when an area runs, and setups define how that area is organized.'
      );
      expect(assistantMessage?.content).not.toContain('=Area');
      expect(assistantMessage?.content).not.toContain('a of operation section the where people work');
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
