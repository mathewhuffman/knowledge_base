import { test, expect } from '@playwright/test';
import type { AgentTranscriptLine } from '@kb-vault/shared-types';
import { __commandRegistryTestables } from '../src/main/services/command-registry';

test.describe('command registry review recovery', () => {
  test('planner result selection rejects progress envelopes as valid planner output', () => {
    const best = __commandRegistryTestables.selectBestResultText([
      '{"status":"loading_batch_context_and_related_articles"}',
      '{"summary":"Planner draft","coverage":[{"pbiId":"pbi-1","outcome":"covered","planItemIds":["item-1"]}],"items":[{"planItemId":"item-1","pbiIds":["pbi-1"],"action":"create","targetType":"new_article","targetTitle":"Draft","reason":"test","evidence":[],"confidence":0.9}],"openQuestions":[]}'
    ], 'planner');

    expect(best).toContain('"coverage"');
    expect(__commandRegistryTestables.matchesExpectedBatchResultShape(JSON.parse(best), 'planner')).toBe(true);
    expect(
      __commandRegistryTestables.matchesExpectedBatchResultShape(
        JSON.parse('{"status":"loading_batch_context_and_related_articles"}'),
        'planner'
      )
    ).toBe(false);
  });

  test('extracts only the latest request segment from a shared session transcript', () => {
    const plannerText = JSON.stringify({
      summary: 'Planner draft',
      coverage: [{ pbiId: 'pbi-1', outcome: 'covered', planItemIds: ['item-1'] }],
      items: [{
        planItemId: 'item-1',
        pbiIds: ['pbi-1'],
        action: 'create',
        targetType: 'new_article',
        targetTitle: 'Planner item',
        reason: 'Planner output.',
        evidence: [],
        confidence: 0.9
      }],
      openQuestions: []
    });
    const reviewText = JSON.stringify({
      summary: 'Reviewer wants revisions.',
      verdict: 'needs_revision',
      didAccountForEveryPbi: true,
      hasMissingCreates: true,
      hasMissingEdits: false,
      hasTargetIssues: false,
      hasOverlapOrConflict: false,
      foundAdditionalArticleWork: true,
      underScopedKbImpact: true,
      delta: {
        summary: 'Missing one create.',
        requestedChanges: ['Add the missing net-new article.'],
        missingPbiIds: [],
        missingCreates: ['View Food Lists'],
        missingEdits: [],
        additionalArticleWork: ['View Food Lists'],
        targetCorrections: [],
        overlapConflicts: []
      }
    });

    const lines: AgentTranscriptLine[] = [
      {
        atUtc: '2026-03-29T22:00:00.000Z',
        direction: 'to_agent',
        event: 'request',
        payload: JSON.stringify({ method: 'session/prompt', params: { prompt: [{ type: 'text', text: 'planner prompt' }] } })
      },
      {
        atUtc: '2026-03-29T22:00:01.000Z',
        direction: 'from_agent',
        event: 'response',
        payload: JSON.stringify({ result: { text: plannerText } })
      },
      {
        atUtc: '2026-03-29T22:00:02.000Z',
        direction: 'to_agent',
        event: 'request',
        payload: JSON.stringify({ method: 'session/prompt', params: { prompt: [{ type: 'text', text: 'review prompt' }] } })
      },
      {
        atUtc: '2026-03-29T22:00:03.000Z',
        direction: 'from_agent',
        event: 'response',
        payload: JSON.stringify({ result: { text: reviewText } })
      },
      {
        atUtc: '2026-03-29T22:00:04.000Z',
        direction: 'to_agent',
        event: 'request',
        payload: JSON.stringify({ method: 'session/close', params: { sessionId: 'session-1' } })
      }
    ];

    const candidates = __commandRegistryTestables.extractTranscriptResultTextCandidates(lines);

    expect(candidates).toEqual([reviewText]);
  });

  test('prefers streamed plan review json over an early in-progress placeholder', () => {
    const reviewJson = JSON.stringify({
      summary: 'Reviewer found an existing delete article and wants a revision.',
      verdict: 'needs_revision',
      didAccountForEveryPbi: true,
      hasMissingCreates: false,
      hasMissingEdits: true,
      hasTargetIssues: true,
      hasOverlapOrConflict: true,
      foundAdditionalArticleWork: true,
      underScopedKbImpact: true,
      delta: {
        summary: 'Use the existing delete article as an edit target.',
        requestedChanges: ['Revise PI-5 to edit the existing delete article instead of treating it as net-new delete work.'],
        missingPbiIds: [],
        missingCreates: [],
        missingEdits: ['Delete a Food Item'],
        additionalArticleWork: ['Delete a Food Item'],
        targetCorrections: ['Point PI-5 at the existing delete article family.'],
        overlapConflicts: ['PI-5 overlaps an existing delete article.']
      }
    });

    const lines: AgentTranscriptLine[] = [
      {
        atUtc: '2026-03-29T22:00:00.000Z',
        direction: 'to_agent',
        event: 'request',
        payload: JSON.stringify({ method: 'session/prompt', params: { prompt: [{ type: 'text', text: 'review prompt' }] } })
      },
      {
        atUtc: '2026-03-29T22:00:01.000Z',
        direction: 'from_agent',
        event: 'response',
        payload: JSON.stringify({
          result: {
            text: 'Reviewing the submitted plan against KB evidence now, and I’m checking for missed edit targets with a few targeted `kb` searches.'
          }
        })
      },
      ...[
        'Reviewing the submitted plan against KB evidence now.',
        ' I found an existing delete article, so here is the structured review: ',
        reviewJson
      ].map((chunk, index) => ({
        atUtc: `2026-03-29T22:00:0${index + 2}.000Z`,
        direction: 'from_agent' as const,
        event: 'session_update' as const,
        payload: JSON.stringify({
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { text: chunk }
          }
        })
      }))
    ];

    const candidates = __commandRegistryTestables.extractTranscriptResultTextCandidates(lines);
    const best = __commandRegistryTestables.selectBestParseableResultText([
      'Reviewing the submitted plan against KB evidence now, and I’m checking for missed edit targets with a few targeted `kb` searches.',
      ...candidates
    ], 'plan_review');

    expect(best.trim().startsWith('{')).toBe(true);
    expect(JSON.parse(best)).toMatchObject({
      verdict: 'needs_revision',
      hasMissingEdits: true,
      delta: {
        missingEdits: ['Delete a Food Item']
      }
    });
  });

  test('worker result selection prefers final blocked direct envelopes over stale needs_action text', () => {
    const staleNeedsAction = JSON.stringify({
      completionState: 'needs_action',
      isFinal: false,
      action: {
        id: 'action-9',
        type: 'search_kb',
        args: {
          query: 'Assign Trainers'
        }
      }
    });
    const blockedTerminal = JSON.stringify({
      completionState: 'blocked',
      isFinal: true,
      message: 'Direct action loop exceeded 8 turns.'
    });

    const best = __commandRegistryTestables.selectBestResultText([
      staleNeedsAction,
      blockedTerminal
    ], 'worker');

    expect(best).toBe(blockedTerminal);
    expect(__commandRegistryTestables.inspectDirectBatchEnvelope(best)).toEqual({
      kind: 'terminal',
      completionState: 'blocked'
    });
    expect(__commandRegistryTestables.shouldAwaitMoreStructuredBatchResult({
      text: best,
      expectedShape: 'worker',
      parseable: false,
      initialCandidateCount: 2,
      transcriptCandidateCount: 1
    })).toBe(false);
  });

  test('salvages truncated plan review json into a parseable review payload', () => {
    const truncatedReview = [
      '{"summary":"Reviewer wants revisions.","verdict":"needs_revision","didAccountForEveryPbi":true,',
      '"hasMissingCreates":true,"hasMissingEdits":false,"foundAdditionalArticleWork":true,"underScopedKbImpact":true,',
      '"delta":{"summary":"Missing one create.","requestedChanges":["Add the missing net-new article."],',
      '"missingPbiIds":[],"missingCreates":["View Food Lists"],"missingEdits":[],',
      '"additionalArticleWork":["View Food Lists"],"targetCorrections":[],"overlapConflicts":[]'
    ].join('');

    const salvaged = __commandRegistryTestables.salvagePlanReviewJsonText(truncatedReview);

    expect(salvaged).not.toBeNull();
    expect(JSON.parse(salvaged ?? '{}')).toMatchObject({
      summary: 'Reviewer wants revisions.',
      verdict: 'needs_revision',
      hasMissingCreates: true,
      foundAdditionalArticleWork: true,
      delta: {
        requestedChanges: ['Add the missing net-new article.'],
        missingCreates: ['View Food Lists'],
        additionalArticleWork: ['View Food Lists']
      }
    });
  });

  test('salvages prose-prefixed plan review output into a parseable review payload', () => {
    const narratedReview = [
      'Reviewing the submitted plan against KB evidence now. ',
      '{"summary":"Reviewer found an existing delete article.","verdict":"needs_revision","didAccountForEveryPbi":true,',
      '"hasMissingCreates":false,"hasMissingEdits":true,"hasTargetIssues":true,"hasOverlapOrConflict":true,',
      '"foundAdditionalArticleWork":true,"underScopedKbImpact":true,"delta":{"summary":"Use the existing delete article.",',
      '"requestedChanges":["Revise PI-5 to edit the existing delete article."],"missingPbiIds":[],"missingCreates":[],',
      '"missingEdits":["Delete a Food Item"],"additionalArticleWork":["Delete a Food Item"],',
      '"targetCorrections":["Point PI-5 at the existing delete article family."],"overlapConflicts":["PI-5 overlaps an existing delete article."]}}'
    ].join('');

    const salvaged = __commandRegistryTestables.salvagePlanReviewJsonText(narratedReview);

    expect(salvaged).not.toBeNull();
    expect(JSON.parse(salvaged ?? '{}')).toMatchObject({
      summary: 'Reviewer found an existing delete article.',
      verdict: 'needs_revision',
      hasMissingEdits: true,
      delta: {
        missingEdits: ['Delete a Food Item'],
        targetCorrections: ['Point PI-5 at the existing delete article family.']
      }
    });
  });

  test('retries plan review once when only progress prose was captured instead of a parseable review', () => {
    expect(__commandRegistryTestables.shouldRetryReviewWithFreshSession({
      text: 'Reviewing the submitted plan against deterministic evidence now, and I’m running a few focused KB searches.',
      initialCandidateCount: 1,
      transcriptCandidateCount: 1,
      parseable: false
    })).toBe(true);

    expect(__commandRegistryTestables.shouldRetryReviewWithFreshSession({
      text: 'Error: S: [resource_exhausted] Error',
      initialCandidateCount: 1,
      transcriptCandidateCount: 0,
      parseable: false
    })).toBe(false);
  });

  test('salvages truncated planner json into deterministic-safe recovered items', () => {
    const truncatedPlanner = [
      '{"summary":"OnecandidatePBIwasfullyassessed.","coverage":[{"pbiId":"pbi-1","outcome":"covered","planItemIds":["item-1","item-2"]}],',
      '"items":[',
      '{"planItemId":"item-1","pbiIds":["pbi-1"],"action":"edit","targetType":"article","targetArticleId":"locale-1","targetFamilyId":"family-1","targetTitle":"EditaFoodItem","reason":"Recoverededititem.","evidence":[],"confidence":0.88},',
      '{"planItemId":"item-2","pbiIds":["pbi-1"],"action":"no_impact","targetType":"article","targetArticleId":"locale-2","targetFamilyId":"family-2","targetTitle":"CreateaFoodItem","reason":"Recoveredlegacyarticledecision.","evidence":[],"confidence":0.7},',
      '{"planItemId":"item-3"'
    ].join('');

    const salvaged = __commandRegistryTestables.salvagePlannerJsonText(truncatedPlanner);

    expect(salvaged).not.toBeNull();
    expect(JSON.parse(salvaged ?? '{}')).toMatchObject({
      summary: 'OnecandidatePBIwasfullyassessed.',
      coverage: [{ pbiId: 'pbi-1', outcome: 'covered', planItemIds: ['item-1', 'item-2'] }],
      items: [
        {
          planItemId: 'item-1',
          action: 'edit',
          targetType: 'unknown',
          targetTitle: 'EditaFoodItem'
        },
        {
          planItemId: 'item-2',
          action: 'create',
          targetType: 'new_article',
          targetTitle: 'CreateaFoodItem'
        }
      ]
    });
    expect(salvaged).not.toContain('"targetArticleId"');
    expect(salvaged).not.toContain('"targetFamilyId"');
  });

  test('preserves whitespace when transcript chunks are reassembled', () => {
    const reviewText = [
      '{"summary":"Planned 6 pending KB actions for batch 87dfa356-7541-4ce6-9c7b-231b70bdd88c: ',
      '2 edits to likely existing food-list creation articles and 4 net-new articles for food-list viewing/editing and duplication workflows. ',
      'All 17 candidate PBIs are accounted for in coverage.","verdict":"needs_revision","didAccountForEveryPbi":true,',
      '"hasMissingCreates":true,"hasMissingEdits":false,"hasTargetIssues":false,"hasOverlapOrConflict":false,',
      '"foundAdditionalArticleWork":true,"underScopedKbImpact":true,"delta":{"summary":"Add the missing creates.","requestedChanges":["Add the missing creates."],',
      '"missingPbiIds":[],"missingCreates":["View Food Lists"],"missingEdits":[],"additionalArticleWork":["View Food Lists"],"targetCorrections":[],"overlapConflicts":[]}}'
    ];

    const lines: AgentTranscriptLine[] = [
      {
        atUtc: '2026-03-29T22:00:00.000Z',
        direction: 'to_agent',
        event: 'request',
        payload: JSON.stringify({ method: 'session/prompt', params: { prompt: [{ type: 'text', text: 'review prompt' }] } })
      },
      ...reviewText.map((chunk, index) => ({
        atUtc: `2026-03-29T22:00:0${index + 1}.000Z`,
        direction: 'from_agent' as const,
        event: 'session_update' as const,
        payload: JSON.stringify({
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { text: chunk }
          }
        })
      }))
    ];

    const [candidate] = __commandRegistryTestables.extractTranscriptResultTextCandidates(lines);

    expect(candidate).toContain('Planned 6 pending KB actions');
    expect(candidate).toContain('batch 87dfa356-7541-4ce6-9c7b-231b70bdd88c');
    expect(candidate).toContain('All 17 candidate PBIs are accounted for in coverage.');
    expect(candidate).not.toContain('Planned6');
    expect(candidate).not.toContain('batch87dfa356');
    expect(candidate).not.toContain('PB Is');
  });

  test('retries review when the reviewer returned an empty result or structured-but-unparseable output', () => {
    expect(__commandRegistryTestables.shouldRetryReviewWithFreshSession({
      text: '',
      initialCandidateCount: 0,
      transcriptCandidateCount: 0,
      parseable: false
    })).toBe(true);

    expect(__commandRegistryTestables.shouldRetryReviewWithFreshSession({
      text: '{"verdict":"needs_revision"}',
      initialCandidateCount: 1,
      transcriptCandidateCount: 0,
      parseable: false
    })).toBe(true);

    expect(__commandRegistryTestables.shouldRetryReviewWithFreshSession({
      text: '',
      initialCandidateCount: 0,
      transcriptCandidateCount: 1,
      parseable: false
    })).toBe(false);
  });

  test('retries planner when output is empty or only a tiny unsalvageable fragment', () => {
    expect(__commandRegistryTestables.shouldRetryPlannerWithFreshSession({
      text: '',
      initialCandidateCount: 0,
      transcriptCandidateCount: 0,
      parseable: false
    })).toBe(true);

    expect(__commandRegistryTestables.shouldRetryPlannerWithFreshSession({
      text: '{"summary":"draft only"',
      initialCandidateCount: 1,
      transcriptCandidateCount: 0,
      parseable: false
    })).toBe(true);

    expect(__commandRegistryTestables.shouldRetryPlannerWithFreshSession({
      text: '{"summary":"Recovered","coverage":[{"pbiId":"pbi-1","outcome":"covered","planItemIds":["item-1"]}],"items":[{"planItemId":"item-1","pbiIds":["pbi-1"],"action":"create","targetType":"new_article","targetTitle":"Draft","reason":"test","evidence":[],"confidence":0.9}],"openQuestions":[]}',
      initialCandidateCount: 1,
      transcriptCandidateCount: 0,
      parseable: false
    })).toBe(false);
  });

  test('extracts planner transcript-recovery prompt_abort reasons', () => {
    const lines: AgentTranscriptLine[] = [
      {
        atUtc: '2026-04-15T16:04:19.155Z',
        direction: 'system',
        event: 'prompt_abort',
        payload: JSON.stringify({
          reason: 'Planner exceeded the tool-call budget (9 > 8). Reuse the evidence already gathered and recover the plan from the current transcript.'
        })
      }
    ];

    expect(__commandRegistryTestables.extractStructuredBatchRecoveryAbortReason(lines, 'planner')).toContain(
      'recover the plan from the current transcript'
    );
  });

  test('does not classify recovered planner json as infrastructure failure just because runtime status was error', () => {
    const narratedPlanner = [
      'Mapping the batch into topic-level plan items first. ',
      '{"summary":"Recovered planner draft","coverage":[{"pbiId":"pbi-1","outcome":"covered","planItemIds":["PI-1"]}],',
      '"items":[{"planItemId":"PI-1","pbiIds":["pbi-1"],"action":"create","targetType":"new_article","targetTitle":"View Food Lists","reason":"No existing match.","evidence":[],"confidence":0.9,"executionStatus":"pending"}],',
      '"openQuestions":[]}'
    ].join('');

    expect(
      __commandRegistryTestables.detectPlannerInfrastructureFailure('error', {
        text: narratedPlanner,
        parseable: false,
        recoveryAbortReason: 'Planner exceeded the tool-call budget (9 > 8). Reuse the evidence already gathered and recover the plan from the current transcript.'
      })
    ).toBeNull();
  });

  test('summarizes partial planner drafts for repair instead of passing an empty prior output', () => {
    const partial = [
      '{"summary":"Planner draft","coverage":[{"pbiId":"pbi-1","outcome":"covered","planItemIds":["item-1"]}],',
      '"items":[{"planItemId":"item-1","pbiIds":["pbi-1"],"action":"create","targetType":"new_article","targetTitle":"View Food Lists","reason":"No existing match yet","confidence":0.72}],',
      '"openQuestions":["Confirm whether details tab needs its own article"]'
    ].join('');

    const context = __commandRegistryTestables.summarizePlannerRecoveryContext(partial);

    expect(context).toContain('Planner draft');
    expect(context).toContain('View Food Lists');
    expect(context).toContain('pbi-1');
    expect(context).not.toEqual('');
  });
});
