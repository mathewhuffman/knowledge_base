import { expect, test } from '@playwright/test';
import type { LocaleVariantRecord } from '@kb-vault/shared-types';
import type { BatchAnalysisPlan, BatchPlanReview, BatchPlannerPrefetch } from '@kb-vault/shared-types';
import { BatchAnalysisOrchestrator } from '../src/main/services/batch-analysis-orchestrator';

function createOrchestrator(overrides?: {
  getLocaleVariant?: (workspaceId: string, variantId: string) => Promise<LocaleVariantRecord>;
  getLocaleVariantsForFamily?: (workspaceId: string, familyId: string) => Promise<LocaleVariantRecord[]>;
  getArticleFamily?: (workspaceId: string, familyId: string) => Promise<{ externalKey?: string }>;
  listBatchProposalRecords?: () => Promise<Array<{
    id: string;
    action: 'create' | 'edit' | 'retire' | 'no_impact';
    reviewStatus: string;
    queueOrder: number;
    updatedAtUtc: string;
    targetTitle?: string;
    targetLocale?: string;
    sessionId?: string;
  }>>;
  updateBatchAnalysisPlanItemStatuses?: (payload: unknown) => Promise<void>;
  recordBatchWorkerExecutionReport?: (report: unknown) => Promise<void>;
}) {
  return new BatchAnalysisOrchestrator({
    getLocaleVariant: overrides?.getLocaleVariant ?? (async () => {
      throw new Error('Locale variant not found');
    }),
    getLocaleVariantsForFamily: overrides?.getLocaleVariantsForFamily ?? (async () => []),
    getArticleFamily: overrides?.getArticleFamily ?? (async () => ({ externalKey: 'kb-live-article' })),
    listBatchProposalRecords: overrides?.listBatchProposalRecords ?? (async () => []),
    updateBatchAnalysisPlanItemStatuses: overrides?.updateBatchAnalysisPlanItemStatuses ?? (async () => {}),
    recordBatchWorkerExecutionReport: overrides?.recordBatchWorkerExecutionReport ?? (async () => {})
  } as never);
}

function createPlan(overrides?: Partial<BatchAnalysisPlan>): BatchAnalysisPlan {
  return {
    id: 'plan-1',
    workspaceId: 'workspace-1',
    batchId: 'batch-1',
    iterationId: 'iteration-1',
    iteration: 1,
    stage: 'planning',
    role: 'planner',
    verdict: 'draft',
    planVersion: 1,
    summary: 'Initial draft plan.',
    coverage: [
      {
        pbiId: 'pbi-1',
        outcome: 'covered',
        planItemIds: ['item-1']
      }
    ],
    items: [
      {
        planItemId: 'item-1',
        pbiIds: ['pbi-1'],
        action: 'create',
        targetType: 'new_article',
        targetTitle: 'Brand New Article',
        reason: 'The feature appears new.',
        evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported PBI.' }],
        confidence: 0.84,
        executionStatus: 'pending'
      }
    ],
    openQuestions: [],
    createdAtUtc: new Date().toISOString(),
    ...overrides
  };
}

function createReview(overrides?: Partial<BatchPlanReview>): BatchPlanReview {
  return {
    id: 'review-1',
    workspaceId: 'workspace-1',
    batchId: 'batch-1',
    iterationId: 'iteration-1',
    iteration: 1,
    stage: 'plan_reviewing',
    role: 'plan-reviewer',
    verdict: 'approved',
    summary: 'Plan looks complete.',
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
    },
    createdAtUtc: new Date().toISOString(),
    planId: 'plan-1',
    sessionId: 'session-1',
    ...overrides
  };
}

function createPlannerPrefetch(overrides?: Partial<BatchPlannerPrefetch>): BatchPlannerPrefetch {
  return {
    priorAnalysis: null,
    topicClusters: [],
    articleMatches: [],
    relationMatches: [],
    ...overrides
  };
}

test.describe('batch analysis orchestrator deterministic review guard', () => {
  test('planner retry prompts carry the original planner context into fresh ACP sessions', () => {
    const orchestrator = createOrchestrator();
    const originalPrompt = 'Create a complete structured batch analysis plan.\n\nDeterministic planner prefetch:\n{"topicClusters":[{"clusterId":"cluster-1"}]}';
    const priorOutput = '{"summary":"partial"}';

    const repairPrompt = orchestrator.buildPlannerRepairPrompt({
      originalPrompt,
      priorOutput,
      parseError: 'Planner response was partial JSON.'
    });
    const jsonRetryPrompt = orchestrator.buildPlannerJsonRetryPrompt({
      originalPrompt,
      priorOutput,
      parseError: 'Planner response was empty.'
    });

    expect(repairPrompt).toContain('Original planner instructions and batch context:');
    expect(repairPrompt).toContain(originalPrompt);
    expect(jsonRetryPrompt).toContain('Original planner instructions and batch context:');
    expect(jsonRetryPrompt).toContain(originalPrompt);
  });

  test('repairs malformed plan PBI IDs and canonicalizes PBI evidence refs from uploaded batch rows', () => {
    const orchestrator = createOrchestrator();
    const result = orchestrator.normalizePlanBatchReferences({
      plan: createPlan({
        coverage: [
          {
            pbiId: 'pbi-11',
            outcome: 'covered',
            planItemIds: ['item-1']
          }
        ],
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-11'],
            action: 'edit',
            targetType: 'article',
            targetArticleId: 'variant-1',
            targetFamilyId: 'family-1',
            targetTitle: 'Create a Food Item',
            reason: 'Existing article should be updated.',
            evidence: [
              { kind: 'pbi', ref: 'externalId:10245', summary: 'Imported PBI.' }
            ],
            confidence: 0.84,
            executionStatus: 'pending'
          }
        ]
      }),
      uploadedPbis: {
        rows: [
          {
            id: 'pbi-1',
            externalId: '1024559',
            title: 'Create Food Item'
          }
        ]
      }
    });

    expect(result.plan.coverage[0]?.pbiId).toBe('pbi-1');
    expect(result.plan.items[0]?.pbiIds).toEqual(['pbi-1']);
    expect(result.plan.items[0]?.evidence[0]?.ref).toBe('pbiId:pbi-1|externalId:1024559');
    expect(result.repairs).toContain('Corrected Coverage row 1 PBI ID from pbi-11 to pbi-1.');
    expect(result.unresolvedReferenceIssues).toEqual([]);
  });

  test('preserves explicitly referenced uploaded PBIs instead of remapping evidence by pbiIds order', () => {
    const orchestrator = createOrchestrator();
    const result = orchestrator.normalizePlanBatchReferences({
      plan: createPlan({
        coverage: [
          {
            pbiId: 'pbi-1',
            outcome: 'covered',
            planItemIds: ['item-1']
          }
        ],
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1', 'pbi-2', 'pbi-3'],
            action: 'edit',
            targetType: 'article',
            targetArticleId: 'variant-1',
            targetFamilyId: 'family-1',
            targetTitle: 'Duplicate a Food Item',
            reason: 'Existing article should be updated.',
            evidence: [
              { kind: 'pbi', ref: 'pbiId:pbi-3|externalId:1069722', summary: 'Additional actions evidence.' },
              { kind: 'pbi', ref: 'pbiId:pbi-2|externalId:1024566', summary: 'Primary duplicate flow evidence.' },
              { kind: 'search', ref: 'search-1', summary: 'Existing article match.' }
            ],
            confidence: 0.88,
            executionStatus: 'pending'
          }
        ]
      }),
      uploadedPbis: {
        rows: [
          {
            id: 'pbi-1',
            externalId: '1024559',
            title: 'Create Food Item'
          },
          {
            id: 'pbi-2',
            externalId: '1024566',
            title: 'Duplicate Food Item'
          },
          {
            id: 'pbi-3',
            externalId: '1069722',
            title: 'Food Item Additional Actions'
          }
        ]
      }
    });

    expect(result.plan.items[0]?.evidence[0]?.ref).toBe('pbiId:pbi-3|externalId:1069722');
    expect(result.plan.items[0]?.evidence[1]?.ref).toBe('pbiId:pbi-2|externalId:1024566');
    expect(result.unresolvedReferenceIssues).toEqual([]);
  });

  test('repairs an invalid target article ID when the target family resolves to one live locale variant', async () => {
    const orchestrator = createOrchestrator({
      getLocaleVariant: async () => {
        throw new Error('Locale variant not found');
      },
      getLocaleVariantsForFamily: async (_workspaceId, familyId) => [{
        id: 'variant-correct',
        familyId,
        locale: 'en-us',
        status: 'live'
      }]
    });

    const result = await orchestrator.normalizePlanTargets({
      workspaceId: 'workspace-1',
      plan: createPlan({
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1'],
            action: 'no_impact',
            targetType: 'article',
            targetArticleId: 'variant-wrong',
            targetFamilyId: 'family-1',
            targetTitle: 'Create a Food Item',
            reason: 'Adjacent article should remain no-impact.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported PBI.' }],
            confidence: 0.8,
            executionStatus: 'pending'
          }
        ]
      })
    });

    expect(result.plan.items[0]?.targetArticleId).toBe('variant-correct');
    expect(result.repairs).toEqual([
      'Corrected invalid target article ID for Create a Food Item from variant-wrong to variant-correct.'
    ]);
    expect(result.unresolvedTargetIssues).toEqual([]);
  });

  test('rewrites repaired target article IDs inside plan summary, evidence refs, and open questions', async () => {
    const orchestrator = createOrchestrator({
      getLocaleVariant: async () => {
        throw new Error('Locale variant not found');
      },
      getLocaleVariantsForFamily: async (_workspaceId, familyId) => [{
        id: 'variant-correct',
        familyId,
        locale: 'en-us',
        status: 'live'
      }]
    });

    const result = await orchestrator.normalizePlanTargets({
      workspaceId: 'workspace-1',
      plan: createPlan({
        summary: 'The target article is variant-wrong.',
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1'],
            action: 'edit',
            targetType: 'article',
            targetArticleId: 'variant-wrong',
            targetFamilyId: 'family-1',
            targetTitle: 'Create a Food Item',
            reason: 'Update variant-wrong with the new behavior.',
            evidence: [{ kind: 'article', ref: 'variant-wrong', summary: 'variant-wrong is the live locale variant.' }],
            confidence: 0.8,
            executionStatus: 'pending'
          }
        ],
        openQuestions: ['Confirm variant-wrong is the canonical target.']
      })
    });

    expect(result.plan.summary).toContain('variant-correct');
    expect(result.plan.summary).not.toContain('variant-wrong');
    expect(result.plan.items[0]?.reason).toContain('variant-correct');
    expect(result.plan.items[0]?.evidence[0]?.ref).toBe('variant-correct');
    expect(result.plan.items[0]?.evidence[0]?.summary).toContain('variant-correct');
    expect(result.plan.openQuestions[0]).toContain('variant-correct');
  });

  test('forces revision when a target resolves to a proposal-scoped draft family', async () => {
    const orchestrator = createOrchestrator({
      getLocaleVariant: async (_workspaceId, variantId) => ({
        id: variantId,
        familyId: 'family-proposal',
        locale: 'en-us',
        status: 'live'
      }),
      getArticleFamily: async () => ({
        externalKey: 'proposal-123'
      })
    });

    const result = await orchestrator.normalizePlanTargets({
      workspaceId: 'workspace-1',
      plan: createPlan({
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1'],
            action: 'edit',
            targetType: 'article',
            targetArticleId: 'variant-proposal',
            targetFamilyId: 'family-proposal',
            targetTitle: 'Duplicate a Food Item',
            reason: 'Update the existing article.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported PBI.' }],
            confidence: 0.88,
            executionStatus: 'pending'
          }
        ]
      })
    });

    expect(result.unresolvedTargetIssues).toEqual([
      'Plan item item-1 (Duplicate a Food Item) points at proposal-scoped draft family proposal-123, which is generated draft output rather than live KB coverage.'
    ]);
  });

  test('forces revision when unresolved invalid KB targets remain after deterministic validation', () => {
    const orchestrator = createOrchestrator();
    const result = orchestrator.applyDeterministicPlanReviewGuard({
      plan: createPlan({
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1'],
            action: 'no_impact',
            targetType: 'article',
            targetArticleId: 'variant-missing',
            targetFamilyId: 'family-1',
            targetTitle: 'Create a Food Item',
            reason: 'Adjacent article should remain no-impact.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported PBI.' }],
            confidence: 0.8,
            executionStatus: 'pending'
          }
        ]
      }),
      review: createReview(),
      unresolvedTargetIssues: [
        'Plan item item-1 (Create a Food Item) references missing locale variant variant-missing, and family family-1 does not resolve to a single live locale variant.'
      ]
    });

    expect(result.forcedRevision).toBe(true);
    expect(result.review.verdict).toBe('needs_revision');
    expect(result.review.hasTargetIssues).toBe(true);
    expect(result.review.delta?.targetCorrections).toContain(
      'Plan item item-1 (Create a Food Item) references missing locale variant variant-missing, and family family-1 does not resolve to a single live locale variant.'
    );
  });

  test('forces revision when unresolved uploaded PBI references remain after deterministic validation', () => {
    const orchestrator = createOrchestrator();
    const result = orchestrator.applyDeterministicPlanReviewGuard({
      plan: createPlan(),
      review: createReview(),
      unresolvedReferenceIssues: [
        'Plan item item-1 evidence[0] references unknown uploaded PBI externalId:102456.'
      ]
    });

    expect(result.forcedRevision).toBe(true);
    expect(result.review.verdict).toBe('needs_revision');
    expect(result.unresolvedReferenceIssues).toEqual([
      'Plan item item-1 evidence[0] references unknown uploaded PBI external Id:102456.'
    ]);
    expect(result.review.delta?.missingPbiIds).toContain(
      'Plan item item-1 evidence[0] references unknown uploaded PBI external Id:102456.'
    );
    expect(result.review.delta?.requestedChanges).toContain(
      'Plan item item-1 evidence[0] references unknown uploaded PBI external Id:102456.'
    );
  });

  test('recordWorkerPass blocks stale rebinding when the current rework session creates a conflicting action', async () => {
    const statusUpdates: unknown[] = [];
    const recordedReports: unknown[] = [];
    const orchestrator = createOrchestrator({
      listBatchProposalRecords: async () => [
        {
          id: 'proposal-old-edit',
          action: 'edit',
          reviewStatus: 'staged_analysis',
          queueOrder: 1,
          updatedAtUtc: '2026-04-15T17:43:18.000Z',
          targetTitle: 'Duplicate a Food Item',
          sessionId: 'worker-session-old'
        },
        {
          id: 'proposal-new-create',
          action: 'create',
          reviewStatus: 'staged_analysis',
          queueOrder: 2,
          updatedAtUtc: '2026-04-15T17:44:33.000Z',
          targetTitle: 'Duplicate a Food Item',
          sessionId: 'worker-session-new'
        }
      ],
      updateBatchAnalysisPlanItemStatuses: async (payload) => {
        statusUpdates.push(payload);
      },
      recordBatchWorkerExecutionReport: async (report) => {
        recordedReports.push(report);
      }
    });

    const approvedPlan = createPlan({
      items: [
        {
          planItemId: 'item-1',
          pbiIds: ['pbi-1'],
          action: 'edit',
          targetType: 'article',
          targetArticleId: 'variant-live',
          targetFamilyId: 'family-live',
          targetTitle: 'Duplicate a Food Item',
          reason: 'Update the duplicate flow article.',
          evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported PBI.' }],
          confidence: 0.9,
          executionStatus: 'pending'
        }
      ]
    });

    const result = await orchestrator.recordWorkerPass({
      iteration: {
        id: 'iteration-1',
        workspaceId: 'workspace-1',
        batchId: 'batch-1',
        iteration: 1,
        stage: 'reworking',
        role: 'worker',
        status: 'running',
        summary: 'Rework pass running.',
        startedAtUtc: '2026-04-15T17:44:00.000Z',
        updatedAtUtc: '2026-04-15T17:44:33.000Z'
      },
      workspaceId: 'workspace-1',
      batchId: 'batch-1',
      approvedPlan,
      result: {
        sessionId: 'worker-session-new',
        kbAccessMode: 'cli',
        status: 'ok',
        startedAtUtc: '2026-04-15T17:44:00.000Z',
        endedAtUtc: '2026-04-15T17:44:33.000Z',
        transcriptPath: '',
        rawOutput: [],
        toolCalls: [],
        durationMs: 33000,
        message: 'Worker completed.'
      }
    });

    expect(result.workerReport.executedItems).toEqual([
      {
        planItemId: 'item-1',
        action: 'edit',
        targetTitle: 'Duplicate a Food Item',
        status: 'blocked',
        artifactIds: ['proposal-new-create'],
        note: 'Current worker session produced create proposal output for "Duplicate a Food Item", which conflicts with the approved edit action.'
      }
    ]);
    expect(statusUpdates).toEqual([
      {
        workspaceId: 'workspace-1',
        planId: approvedPlan.id,
        statuses: [
          {
            planItemId: 'item-1',
            executionStatus: 'blocked'
          }
        ]
      }
    ]);
    expect(recordedReports).toHaveLength(1);
  });

  test('forces revision when a create-only plan ignores strong existing article matches', () => {
    const orchestrator = createOrchestrator();
    const result = orchestrator.applyDeterministicPlanReviewGuard({
      plan: createPlan(),
      review: createReview(),
      plannerPrefetch: createPlannerPrefetch({
        articleMatches: [
          {
            clusterId: 'cluster-1',
            query: 'Team dashboard',
            total: 2,
            topResults: [
              {
                title: 'Edit Team Dashboard',
                familyId: 'family-1',
                localeVariantId: 'variant-1',
                score: 0.28,
                matchContext: 'title',
                snippet: 'Existing dashboard article.'
              }
            ]
          },
          {
            clusterId: 'cluster-2',
            query: 'Leadership tiles',
            total: 1,
            topResults: [
              {
                title: 'Leadership Tile Settings',
                familyId: 'family-2',
                localeVariantId: 'variant-2',
                score: 0.22,
                matchContext: 'content',
                snippet: 'Existing leadership settings article.'
              }
            ]
          }
        ],
        relationMatches: []
      })
    });

    expect(result.forcedRevision).toBe(true);
    expect(result.review.verdict).toBe('needs_revision');
    expect(result.review.hasMissingEdits).toBe(true);
    expect(result.review.underScopedKbImpact).toBe(true);
    expect(result.review.delta?.missingEdits).toEqual([
      'Edit Team Dashboard',
      'Leadership Tile Settings'
    ]);
  });

  test('does not force revision when the plan already includes the matched edit target', () => {
    const orchestrator = createOrchestrator();
    const result = orchestrator.applyDeterministicPlanReviewGuard({
      plan: createPlan({
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1'],
            action: 'edit',
            targetType: 'article',
            targetFamilyId: 'family-1',
            targetTitle: 'Edit Team Dashboard',
            reason: 'Existing article needs an update.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported PBI.' }],
            confidence: 0.9,
            executionStatus: 'pending'
          }
        ]
      }),
      review: createReview(),
      plannerPrefetch: createPlannerPrefetch({
        articleMatches: [
          {
            clusterId: 'cluster-1',
            query: 'Team dashboard',
            total: 1,
            topResults: [
              {
                title: 'Edit Team Dashboard',
                familyId: 'family-1',
                localeVariantId: 'variant-1',
                score: 0.28,
                matchContext: 'title',
                snippet: 'Existing dashboard article.'
              }
            ]
          }
        ],
        relationMatches: []
      })
    });

    expect(result.forcedRevision).toBe(false);
    expect(result.review.verdict).toBe('approved');
    expect(result.missingEditTargets).toEqual([]);
  });

  test('does not force missing edits from relation-only deterministic signals', () => {
    const orchestrator = createOrchestrator();
    const result = orchestrator.applyDeterministicPlanReviewGuard({
      plan: createPlan({
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1'],
            action: 'create',
            targetType: 'new_article',
            targetTitle: 'Duplicate a Food Item',
            reason: 'New duplicate workflow.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported PBI.' }],
            confidence: 0.92,
            executionStatus: 'pending'
          }
        ]
      }),
      review: createReview({
        verdict: 'approved'
      }),
      plannerPrefetch: createPlannerPrefetch({
        articleMatches: [],
        relationMatches: [
          {
            clusterId: 'cluster-1',
            title: 'Edit a Food Item',
            familyId: 'family-1',
            relationType: 'related',
            strengthScore: 0.62,
            snippet: 'Adjacent article only.'
          }
        ]
      })
    });

    expect(result.forcedRevision).toBe(false);
    expect(result.review.verdict).toBe('approved');
    expect(result.missingEditTargets).toEqual([]);
  });

  test('forces revision for an all-no-impact plan when deterministic prefetch shows likely edit targets', () => {
    const orchestrator = createOrchestrator();
    const result = orchestrator.applyDeterministicPlanReviewGuard({
      plan: createPlan({
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1'],
            action: 'no_impact',
            targetType: 'article',
            targetTitle: 'Dashboard Overview',
            reason: 'No documentation change needed.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported PBI.' }],
            confidence: 0.7,
            executionStatus: 'pending'
          }
        ]
      }),
      review: createReview(),
      plannerPrefetch: createPlannerPrefetch({
        articleMatches: [
          {
            clusterId: 'cluster-1',
            query: 'Team dashboard',
            total: 1,
            topResults: [
              {
                title: 'Edit Team Dashboard',
                familyId: 'family-1',
                localeVariantId: 'variant-1',
                score: 0.28,
                matchContext: 'title',
                snippet: 'Existing dashboard article.'
              }
            ]
          }
        ],
        relationMatches: []
      })
    });

    expect(result.forcedRevision).toBe(true);
    expect(result.review.verdict).toBe('needs_revision');
    expect(result.review.delta?.missingEdits).toEqual(['Edit Team Dashboard']);
  });

  test('forces revision when deterministic prefetch shows a searched cluster with no existing article match and the plan never creates it', () => {
    const orchestrator = createOrchestrator();
    const result = orchestrator.applyDeterministicPlanReviewGuard({
      plan: createPlan({
        coverage: [
          {
            pbiId: 'pbi-1',
            outcome: 'covered',
            planItemIds: ['item-1']
          },
          {
            pbiId: 'pbi-2',
            outcome: 'covered',
            planItemIds: ['item-1']
          }
        ],
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1', 'pbi-2'],
            action: 'edit',
            targetType: 'article',
            targetFamilyId: 'family-existing',
            targetTitle: 'Operations Overview',
            reason: 'Fold the work into an existing overview article.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported PBI.' }],
            confidence: 0.7,
            executionStatus: 'pending'
          }
        ]
      }),
      review: createReview(),
      plannerPrefetch: createPlannerPrefetch({
        topicClusters: [
          {
            clusterId: 'cluster-1',
            label: 'Checklist escalation workflow',
            pbiIds: ['pbi-1', 'pbi-2'],
            sampleTitles: ['Checklist escalation workflow', 'Escalation assignment rules'],
            queries: ['Checklist escalation workflow', 'Escalation assignment rules']
          }
        ],
        articleMatches: [
          {
            clusterId: 'cluster-1',
            query: 'Checklist escalation workflow',
            total: 0,
            topResults: []
          },
          {
            clusterId: 'cluster-1',
            query: 'Escalation assignment rules',
            total: 0,
            topResults: []
          }
        ],
        relationMatches: []
      })
    });

    expect(result.forcedRevision).toBe(true);
    expect(result.review.verdict).toBe('needs_revision');
    expect(result.review.hasMissingCreates).toBe(true);
    expect(result.review.underScopedKbImpact).toBe(true);
    expect(result.missingCreateTargets).toEqual(['Checklist escalation workflow']);
    expect(result.review.delta?.missingCreates).toEqual(['Checklist escalation workflow']);
  });

  test('does not force revision for a zero-match cluster when the plan already includes a create item', () => {
    const orchestrator = createOrchestrator();
    const result = orchestrator.applyDeterministicPlanReviewGuard({
      plan: createPlan({
        coverage: [
          {
            pbiId: 'pbi-1',
            outcome: 'covered',
            planItemIds: ['item-1']
          }
        ],
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1'],
            action: 'create',
            targetType: 'new_article',
            targetTitle: 'Checklist escalation workflow',
            reason: 'This topic appears net-new.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported PBI.' }],
            confidence: 0.85,
            executionStatus: 'pending'
          }
        ]
      }),
      review: createReview(),
      plannerPrefetch: createPlannerPrefetch({
        topicClusters: [
          {
            clusterId: 'cluster-1',
            label: 'Checklist escalation workflow',
            pbiIds: ['pbi-1'],
            sampleTitles: ['Checklist escalation workflow'],
            queries: ['Checklist escalation workflow']
          }
        ],
        articleMatches: [
          {
            clusterId: 'cluster-1',
            query: 'Checklist escalation workflow',
            total: 0,
            topResults: []
          }
        ],
        relationMatches: []
      })
    });

    expect(result.forcedRevision).toBe(false);
    expect(result.review.verdict).toBe('approved');
    expect(result.missingCreateTargets).toEqual([]);
  });

  test('includes deterministic prefetch evidence in the reviewer prompt', () => {
    const orchestrator = createOrchestrator();
    const prompt = orchestrator.buildPlanReviewerPrompt({
      batchContext: { batch: { id: 'batch-1' } },
      uploadedPbis: { rows: [{ id: 'pbi-1', title: 'Update dashboard' }] },
      plan: createPlan(),
      plannerPrefetch: createPlannerPrefetch({
        articleMatches: [
          {
            clusterId: 'cluster-1',
            query: 'Team dashboard',
            total: 1,
            topResults: [
              {
                title: 'Edit Team Dashboard',
                familyId: 'family-1',
                localeVariantId: 'variant-1',
                score: 0.28,
                matchContext: 'title',
                snippet: 'Existing dashboard article.'
              }
            ]
          }
        ]
      })
    });

    expect(prompt).toContain('Deterministic planner prefetch:');
    expect(prompt).toContain('Edit Team Dashboard');
    expect(prompt).toContain('Do not approve a create-only or create-heavy plan');
    expect(prompt).toContain('edit-only or edit-heavy plan');
  });

  test('forces revision when multiple plan items target the same existing article', () => {
    const orchestrator = createOrchestrator();
    const result = orchestrator.applyDeterministicPlanReviewGuard({
      plan: createPlan({
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1'],
            action: 'edit',
            targetType: 'article',
            targetFamilyId: 'family-1',
            targetTitle: 'Team Dashboard',
            reason: 'Update the dashboard overview.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported PBI.' }],
            confidence: 0.91,
            executionStatus: 'pending'
          },
          {
            planItemId: 'item-2',
            pbiIds: ['pbi-1'],
            action: 'retire',
            targetType: 'article',
            targetFamilyId: 'family-1',
            targetTitle: 'Team Dashboard',
            reason: 'Also retire the same target, which conflicts with the edit.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported PBI.' }],
            confidence: 0.76,
            executionStatus: 'pending'
          }
        ]
      }),
      review: createReview()
    });

    expect(result.forcedRevision).toBe(true);
    expect(result.conflictingTargets).toEqual(['Team Dashboard']);
    expect(result.review.verdict).toBe('needs_revision');
    expect(result.review.hasTargetIssues).toBe(true);
    expect(result.review.hasOverlapOrConflict).toBe(true);
    expect(result.review.delta?.targetCorrections).toEqual(['Team Dashboard']);
    expect(result.review.delta?.overlapConflicts).toEqual(['Multiple plan items target Team Dashboard']);
  });

  test('final reviewer prompt marks proposal-scoped artifacts as draft-only evidence', () => {
    const orchestrator = createOrchestrator();
    const prompt = orchestrator.buildFinalReviewerPrompt({
      batchContext: {
        batch: {
          id: 'batch-1',
          workspaceId: 'workspace-1',
          name: 'Food Lists',
          sourceFileName: 'Food Lists.csv',
          sourceFormat: 'csv',
          status: 'review_in_progress'
        }
      },
      uploadedPbis: {
        rows: [
          {
            id: 'pbi-1',
            externalId: '1024566',
            sourceRowNumber: 2,
            title: 'Duplicating Food Item'
          }
        ]
      },
      approvedPlan: createPlan({
        items: [
          {
            planItemId: 'item-1',
            pbiIds: ['pbi-1'],
            action: 'edit',
            targetType: 'article',
            targetArticleId: 'variant-live',
            targetFamilyId: 'family-live',
            targetTitle: 'Duplicate a Food Item',
            reason: 'Update the existing duplicate flow article.',
            evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Imported PBI.' }],
            confidence: 0.92,
            executionStatus: 'pending'
          }
        ]
      }),
      workerReport: {
        id: 'worker-report-1',
        workspaceId: 'workspace-1',
        batchId: 'batch-1',
        iterationId: 'iteration-1',
        iteration: 1,
        status: 'completed',
        summary: 'Worker created the warranted proposal set.',
        executedItems: [
          {
            planItemId: 'item-1',
            action: 'edit',
            targetTitle: 'Duplicate a Food Item',
            status: 'executed',
            proposalId: 'proposal-1',
            artifactIds: ['proposal-1'],
            note: 'Matched proposal review item for Duplicate a Food Item.'
          }
        ],
        blockerNotes: [],
        discoveredWork: [],
        createdAtUtc: new Date().toISOString(),
        planId: 'plan-1',
        sessionId: 'session-1'
      },
      discoveredWork: [],
      proposalContext: [
        {
          proposalId: 'proposal-1',
          action: 'edit',
          targetTitle: 'Duplicate a Food Item',
          reviewStatus: 'pending_review',
          familyId: 'family-proposal',
          localeVariantId: 'variant-proposal',
          locale: 'en-us',
          variantStatus: 'draft_branch',
          familyExternalKey: 'proposal-123',
          targetState: 'proposal_scoped_draft',
          targetStateReason: 'Family external key proposal-123 marks a generated proposal artifact, so it is not live KB coverage.',
          relatedPbiIds: ['pbi-1'],
          relatedExternalIds: ['1024566'],
          rationaleSummary: 'Covers the duplicate item modal and confirm flow.',
          aiNotes: 'Created from worker pass.',
          changeSummary: ['Duplicate item modal: Adds confirmation messaging.'],
          proposedContentPreview: 'This article now explains how to duplicate a food item.'
        }
      ]
    });

    expect(prompt).toContain('Proposal-scoped locale variants or article families whose external key starts with `proposal-` are generated draft artifacts, not live KB coverage.');
    expect(prompt).toContain('"targetState": "proposal_scoped_draft"');
    expect(prompt).toContain('"familyExternalKey": "proposal-123"');
  });
});
