import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test, expect } from '@playwright/test';
import { WorkspaceRepository } from '../src/main/services/workspace-repository';
import { BatchAnalysisOrchestrator } from '../src/main/services/batch-analysis-orchestrator';
import {
  ArticleAiPresetAction,
  DraftBranchStatus,
  PBIImportFormat,
  PBIBatchStatus,
  PBIBatchScopeMode,
  ProposalReviewDecision,
  ProposalReviewStatus,
  RevisionState,
  RevisionStatus,
  TemplatePackType
} from '@kb-vault/shared-types';

test.describe('workspace repository content model', () => {
  let workspaceRoot: string;
  let repository: WorkspaceRepository;
  let orchestrator: BatchAnalysisOrchestrator;

  test.beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-batch2-repo-'));
    await mkdir(workspaceRoot, { recursive: true });
    repository = new WorkspaceRepository(workspaceRoot);
    orchestrator = new BatchAnalysisOrchestrator(repository);
  });

  test.afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  test('manages workspace settings through catalog + workspace_settings table', async () => {
    const created = await repository.createWorkspace({
      name: 'Settings Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us', 'fr-fr'],
      path: path.join(workspaceRoot, 'workspace-one')
    });

    const firstGet = await repository.getWorkspaceSettings(created.id);
    expect(firstGet.workspaceId).toBe(created.id);
    expect(firstGet.defaultLocale).toBe('en-us');
    expect(firstGet.enabledLocales).toEqual(['en-us', 'fr-fr']);
    expect(firstGet.kbAccessMode).toBe('mcp');

    const updated = await repository.updateWorkspaceSettings({
      workspaceId: created.id,
      defaultLocale: 'fr-fr',
      enabledLocales: ['fr-fr'],
      kbAccessMode: 'cli'
    });
    expect(updated.defaultLocale).toBe('fr-fr');
    expect(updated.enabledLocales).toEqual(['fr-fr']);
    expect(updated.kbAccessMode).toBe('cli');

    const secondGet = await repository.getWorkspaceSettings(created.id);
    expect(secondGet.defaultLocale).toBe('fr-fr');
    expect(secondGet.enabledLocales).toEqual(['fr-fr']);
    expect(secondGet.kbAccessMode).toBe('cli');
  });

  test('persists workspace settings updates across repository instances', async () => {
    const created = await repository.createWorkspace({
      name: 'Settings Persistence Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us', 'fr-fr'],
      path: path.join(workspaceRoot, 'settings-persistence')
    });

    await repository.updateWorkspaceSettings({
      workspaceId: created.id,
      defaultLocale: 'fr-fr',
      enabledLocales: ['fr-fr'],
      kbAccessMode: 'cli'
    });

    const reloadedRepository = new WorkspaceRepository(workspaceRoot);
    const reloadedSettings = await reloadedRepository.getWorkspaceSettings(created.id);
    expect(reloadedSettings.defaultLocale).toBe('fr-fr');
    expect(reloadedSettings.enabledLocales).toEqual(['fr-fr']);
    expect(reloadedSettings.kbAccessMode).toBe('cli');
  });

  test('repairs missing workspace database during migration health check', async () => {
    const created = await repository.createWorkspace({
      name: 'Migration Repair Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us', 'es-es'],
      path: path.join(workspaceRoot, 'migration-repair')
    });

    const before = await repository.getMigrationHealth(created.id);
    expect(before.workspaces[0].exists).toBe(true);
    expect(before.workspaces[0].repaired).toBe(false);

    const workspaceDbPath = before.workspaces[0].workspaceDbPath;
    await rm(workspaceDbPath, { force: true });

    const after = await repository.getMigrationHealth(created.id);
    const repairedEntry = after.workspaces.find((entry) => entry.workspaceId === created.id);
    expect(repairedEntry).toBeTruthy();
    expect(repairedEntry?.repaired).toBe(true);
    expect(repairedEntry?.exists).toBe(true);
    expect(repairedEntry?.workspaceDbVersion).toBeGreaterThanOrEqual(7);
  });

  test('rejects invalid workspace settings updates', async () => {
    const created = await repository.createWorkspace({
      name: 'Invalid Settings Workspace',
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us',
      enabledLocales: ['en-us']
    });

    await expect(
      repository.updateWorkspaceSettings({
        workspaceId: created.id,
        enabledLocales: []
      })
    ).rejects.toThrow('enabledLocales cannot be empty');

    await expect(
      repository.updateWorkspaceSettings({
        workspaceId: created.id,
        defaultLocale: 'de-de',
        enabledLocales: ['en-us']
      })
    ).rejects.toThrow('defaultLocale must be included in enabledLocales');

    await expect(
      repository.updateWorkspaceSettings({
        workspaceId: created.id,
        defaultLocale: ''
      })
    ).rejects.toThrow('defaultLocale cannot be empty');

    await expect(
      repository.updateWorkspaceSettings({
        workspaceId: created.id,
        kbAccessMode: 'broken' as 'mcp'
      })
    ).rejects.toThrow('kbAccessMode must be mcp or cli');
  });

  test('persists batch analysis orchestration iterations and worker reports', async () => {
    const created = await repository.createWorkspace({
      name: `BatchOrchestration-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const batch = await repository.createPBIBatch(
      created.id,
      'Sprint 88',
      'sprint-88.csv',
      'imports/sprint-88.csv',
      PBIImportFormat.CSV,
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 1
      },
      PBIBatchScopeMode.ALL
    );

    const iteration = await repository.createBatchAnalysisIteration({
      workspaceId: created.id,
      batchId: batch.id,
      stage: 'planning',
      role: 'planner',
      status: 'running',
      summary: 'Synthesizing the approved plan.',
      agentModelId: 'gpt-5.4',
      sessionId: 'session-1'
    });
    await repository.recordBatchAnalysisStageEvent({
      id: randomUUID(),
      workspaceId: created.id,
      batchId: batch.id,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: 'planning',
      role: 'planner',
      eventType: 'iteration_started',
      status: 'running',
      summary: 'Synthesizing the approved plan.',
      sessionId: 'session-1',
      agentModelId: 'gpt-5.4',
      outstandingDiscoveredWorkCount: 0,
      executionCounts: {
        total: 0,
        create: 0,
        edit: 0,
        retire: 0,
        noImpact: 0,
        executed: 0,
        blocked: 0,
        rejected: 0
      },
      createdAtUtc: new Date().toISOString()
    });

    await repository.recordBatchAnalysisPlan({
      id: randomUUID(),
      workspaceId: created.id,
      batchId: batch.id,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: 'planning',
      role: 'planner',
      verdict: 'draft',
      planVersion: 1,
      summary: 'Draft plan covering one edit.',
      coverage: [
        {
          pbiId: 'pbi-88',
          outcome: 'covered',
          planItemIds: ['plan-item-1']
        }
      ],
      items: [
        {
          planItemId: 'plan-item-1',
          pbiIds: ['pbi-88'],
          action: 'edit',
          targetType: 'article',
          targetTitle: 'Existing article',
          reason: 'The workflow changed.',
          evidence: [{ kind: 'pbi', ref: 'PBI-88', summary: 'The PBI describes an updated workflow.' }],
          confidence: 0.84,
          executionStatus: 'pending'
        }
      ],
      openQuestions: [],
      createdAtUtc: new Date().toISOString(),
      agentModelId: 'gpt-5.4',
      sessionId: 'session-1'
    });

    const approvedPlanId = randomUUID();
    await repository.recordBatchAnalysisPlan({
      id: approvedPlanId,
      workspaceId: created.id,
      batchId: batch.id,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: 'planning',
      role: 'planner',
      verdict: 'approved',
      planVersion: 1,
      summary: 'Approved plan covering one edit.',
      coverage: [
        {
          pbiId: 'pbi-88',
          outcome: 'covered',
          planItemIds: ['plan-item-1']
        }
      ],
      items: [
        {
          planItemId: 'plan-item-1',
          pbiIds: ['pbi-88'],
          action: 'edit',
          targetType: 'article',
          targetTitle: 'Existing article',
          reason: 'The workflow changed.',
          evidence: [{ kind: 'pbi', ref: 'PBI-88', summary: 'The PBI describes an updated workflow.' }],
          confidence: 0.84,
          executionStatus: 'approved'
        }
      ],
      openQuestions: [],
      createdAtUtc: new Date().toISOString(),
      agentModelId: 'gpt-5.4',
      sessionId: 'session-2'
    });

    await repository.recordBatchPlanReview({
      id: randomUUID(),
      workspaceId: created.id,
      batchId: batch.id,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: 'plan_reviewing',
      role: 'plan-reviewer',
      verdict: 'approved',
      summary: 'The plan covers the batch and has no missed article work.',
      didAccountForEveryPbi: true,
      hasMissingCreates: false,
      hasMissingEdits: false,
      hasTargetIssues: false,
      hasOverlapOrConflict: false,
      foundAdditionalArticleWork: false,
      underScopedKbImpact: false,
      createdAtUtc: new Date().toISOString(),
      planId: approvedPlanId,
      agentModelId: 'gpt-5.4',
      sessionId: 'session-3'
    });

    await repository.updateBatchAnalysisPlanItemStatuses({
      workspaceId: created.id,
      planId: approvedPlanId,
      statuses: [{ planItemId: 'plan-item-1', executionStatus: 'executed' }]
    });

    await repository.recordBatchWorkerExecutionReport({
      id: randomUUID(),
      workspaceId: created.id,
      batchId: batch.id,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: 'building',
      role: 'worker',
      summary: 'Executed one approved edit.',
      status: 'completed',
      executedItems: [
        {
          planItemId: 'plan-item-1',
          action: 'edit',
          status: 'executed',
          artifactIds: ['proposal-1']
        }
      ],
      discoveredWork: [
        {
          discoveryId: 'discovery-1',
          sourceWorkerRunId: 'worker-run-1',
          discoveredAction: 'create',
          suspectedTarget: 'New onboarding article',
          reason: 'A related workflow had no existing article.',
          evidence: [{ kind: 'pbi', ref: 'PBI-88', summary: 'Mentions a new onboarding branch.' }],
          linkedPbiIds: ['pbi-88'],
          confidence: 0.73,
          requiresPlanAmendment: true,
          status: 'pending_review'
        }
      ],
      blockerNotes: [],
      createdAtUtc: new Date().toISOString(),
      agentModelId: 'gpt-5.4',
      sessionId: 'session-1'
    });

    await repository.recordBatchFinalReview({
      id: randomUUID(),
      workspaceId: created.id,
      batchId: batch.id,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: 'final_reviewing',
      role: 'final-reviewer',
      verdict: 'approved',
      summary: 'Final review approved the batch outputs.',
      allPbisMapped: true,
      planExecutionComplete: true,
      hasMissingArticleChanges: false,
      hasUnresolvedDiscoveredWork: false,
      createdAtUtc: new Date().toISOString(),
      planId: approvedPlanId,
      workerReportId: 'worker-report-final',
      agentModelId: 'gpt-5.4',
      sessionId: 'session-4'
    });

    await repository.updateBatchAnalysisIteration({
      workspaceId: created.id,
      iterationId: iteration.id,
      stage: 'approved',
      role: 'final-reviewer',
      status: 'completed',
      approvedPlanId,
      lastReviewVerdict: 'approved',
      outstandingDiscoveredWorkCount: 1,
      executionCounts: {
        total: 1,
        create: 0,
        edit: 1,
        retire: 0,
        noImpact: 0,
        executed: 1,
        blocked: 0,
        rejected: 0
      },
      endedAtUtc: new Date().toISOString()
    });
    await repository.recordBatchAnalysisStageEvent({
      id: randomUUID(),
      workspaceId: created.id,
      batchId: batch.id,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: 'approved',
      role: 'final-reviewer',
      eventType: 'iteration_completed',
      status: 'completed',
      summary: 'Final review approved the batch outputs.',
      sessionId: 'session-4',
      agentModelId: 'gpt-5.4',
      approvedPlanId,
      lastReviewVerdict: 'approved',
      outstandingDiscoveredWorkCount: 1,
      executionCounts: {
        total: 1,
        create: 0,
        edit: 1,
        retire: 0,
        noImpact: 0,
        executed: 1,
        blocked: 0,
        rejected: 0
      },
      createdAtUtc: new Date().toISOString()
    });

    const snapshot = await repository.getBatchAnalysisSnapshot(created.id, batch.id);
    expect(snapshot.latestIteration?.stage).toBe('approved');
    expect(snapshot.latestIteration?.role).toBe('final-reviewer');
    expect(snapshot.latestIteration?.executionCounts.edit).toBe(1);
    expect(snapshot.latestApprovedPlan?.id).toBe(approvedPlanId);
    expect(snapshot.latestPlanReview?.verdict).toBe('approved');
    expect(snapshot.latestApprovedPlan?.items[0]?.executionStatus).toBe('executed');
    expect(snapshot.latestWorkerReport?.summary).toContain('Executed one approved edit');
    expect(snapshot.latestFinalReview?.verdict).toBe('approved');
    expect(snapshot.discoveredWork).toHaveLength(1);
    expect(snapshot.discoveredWork[0]?.suspectedTarget).toBe('New onboarding article');

    const runtimeStatus = await repository.getBatchAnalysisRuntimeStatus(created.id, batch.id);
    expect(runtimeStatus?.stage).toBe('approved');
    expect(runtimeStatus?.role).toBe('final-reviewer');
    expect(runtimeStatus?.latestEventType).toBe('iteration_completed');

    const eventStream = await repository.getBatchAnalysisEventStream(created.id, batch.id, 10);
    expect(eventStream.events.length).toBeGreaterThan(0);
    expect(eventStream.events.some((event) => event.eventType === 'iteration_started')).toBeTruthy();
    expect(eventStream.events.some((event) => event.eventType === 'iteration_completed')).toBeTruthy();
  });

  test('resolves batch context from a unique batch id prefix', async () => {
    const created = await repository.createWorkspace({
      name: `BatchPrefix-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const batch = await repository.createPBIBatch(
      created.id,
      'Sprint Prefix',
      'sprint-prefix.csv',
      'imports/sprint-prefix.csv',
      PBIImportFormat.CSV,
      2,
      {
        candidateRowCount: 2,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 2
      },
      PBIBatchScopeMode.ALL
    );

    await repository.createPBIRecord({
      batchId: batch.id,
      workspaceId: created.id,
      sourceRowNumber: 1,
      externalId: 'PI-1',
      title: 'First row',
      body: 'Body',
      validationStatus: 'candidate'
    });
    await repository.createPBIRecord({
      batchId: batch.id,
      workspaceId: created.id,
      sourceRowNumber: 2,
      externalId: 'PI-2',
      title: 'Second row',
      body: 'Body',
      validationStatus: 'candidate'
    });

    const context = await repository.getBatchContext(created.id, batch.id.slice(0, 8));

    expect(context?.batch.id).toBe(batch.id);
    expect(context?.candidateRows).toHaveLength(2);
  });

  test('preserves latest approved plan when a newer revision draft exists and returns plans newest-first', async () => {
    const created = await repository.createWorkspace({
      name: `BatchPlanSnapshot-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const batch = await repository.createPBIBatch(
      created.id,
      'Sprint 89',
      'imports/sprint-89.csv',
      'imports/sprint-89.csv',
      PBIImportFormat.CSV,
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 1
      },
      PBIBatchScopeMode.ALL
    );

    const iteration = await repository.createBatchAnalysisIteration({
      workspaceId: created.id,
      batchId: batch.id,
      stage: 'plan_revision',
      role: 'planner',
      status: 'running',
      summary: 'Revising the plan after review feedback.',
      agentModelId: 'gpt-5.4',
      sessionId: 'planner-session'
    });

    const approvedPlanId = randomUUID();
    await repository.recordBatchAnalysisPlan({
      id: approvedPlanId,
      workspaceId: created.id,
      batchId: batch.id,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: 'planning',
      role: 'planner',
      verdict: 'approved',
      planVersion: 1,
      summary: 'Approved plan with one edit.',
      coverage: [
        {
          pbiId: 'pbi-89',
          outcome: 'covered',
          planItemIds: ['plan-item-1']
        }
      ],
      items: [
        {
          planItemId: 'plan-item-1',
          pbiIds: ['pbi-89'],
          action: 'edit',
          targetType: 'article',
          targetTitle: 'Existing article',
          reason: 'Initial approved edit.',
          evidence: [],
          confidence: 0.9,
          executionStatus: 'approved'
        }
      ],
      openQuestions: [],
      createdAtUtc: new Date(Date.now() - 10_000).toISOString(),
      agentModelId: 'gpt-5.4',
      sessionId: 'planner-session'
    });

    const revisedDraftPlanId = randomUUID();
    await repository.recordBatchAnalysisPlan({
      id: revisedDraftPlanId,
      workspaceId: created.id,
      batchId: batch.id,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: 'plan_revision',
      role: 'planner',
      verdict: 'draft',
      planVersion: 2,
      summary: 'Revised draft adds a create.',
      coverage: [
        {
          pbiId: 'pbi-89',
          outcome: 'covered',
          planItemIds: ['plan-item-2']
        }
      ],
      items: [
        {
          planItemId: 'plan-item-2',
          pbiIds: ['pbi-89'],
          action: 'create',
          targetType: 'article',
          targetTitle: 'New article',
          reason: 'Revision draft expands the scope.',
          evidence: [],
          confidence: 0.88,
          executionStatus: 'pending'
        }
      ],
      openQuestions: [],
      createdAtUtc: new Date().toISOString(),
      agentModelId: 'gpt-5.4',
      sessionId: 'planner-session'
    });

    const snapshot = await repository.getBatchAnalysisSnapshot(created.id, batch.id);
    expect(snapshot.latestApprovedPlan?.id).toBe(approvedPlanId);

    const inspection = await repository.getBatchAnalysisInspection(created.id, batch.id);
    expect(inspection.plans.map((plan) => plan.id)).toEqual([revisedDraftPlanId, approvedPlanId]);
    expect(inspection.supersededPlans.map((plan) => plan.id)).toEqual([approvedPlanId]);
  });

  test('humanizes collapsed planner text when parsing plan results', async () => {
    const iteration = {
      id: randomUUID(),
      workspaceId: 'workspace-1',
      batchId: 'batch-1',
      iteration: 1,
    } as Awaited<ReturnType<WorkspaceRepository['createBatchAnalysisIteration']>>;

    const plan = orchestrator.parsePlannerResult({
      workspaceId: 'workspace-1',
      batchId: 'batch-1',
      iteration,
      planVersion: 1,
      resultText: JSON.stringify({
        summary: 'OnecandidatePBIwasfullyassessed.Thestrongestplanistocreateanewstandalonearticle.',
        coverage: [
          {
            pbiId: 'pbi-1',
            outcome: 'covered',
            planItemIds: ['plan-1'],
            notes: 'Existingnearbycoverageappearsadjacentratherthansufficient.'
          }
        ],
        items: [
          {
            planItemId: 'plan-1',
            pbiIds: ['pbi-1'],
            action: 'create',
            targetType: 'new_article',
            targetTitle: 'DuplicateaFoodItem',
            reason: 'ThePBIdescribesadistinctduplicatefooditemworkflow.',
            evidence: [
              {
                kind: 'pbi',
                ref: 'pbi-1',
                summary: 'Acceptancecriteriarequireaprefilledcreatemodesidesheet.'
              }
            ],
            confidence: 0.9,
            executionStatus: 'pending'
          }
        ],
        openQuestions: ['Shouldthisbeastandalonearticleoracross-link?']
      })
    });

    expect(plan.summary).toContain('One candidate PBI');
    expect(plan.coverage[0]?.notes).toContain('Existing nearby coverage');
    expect(plan.items[0]?.targetTitle).toBe('Duplicate a Food Item');
    expect(plan.items[0]?.reason).toContain('distinct duplicate food item workflow');
    expect(plan.items[0]?.evidence[0]?.summary).toContain('prefilled create mode side sheet');
    expect(plan.openQuestions[0]).toContain('Should this be a standalone article');
  });

  test('matches collapsed plan titles to spaced proposal titles during worker execution', async () => {
    const executedItems = (orchestrator as any).buildExecutedItems(
      [
        {
          planItemId: 'plan-1',
          pbiIds: ['pbi-1'],
          action: 'create',
          targetType: 'new_article',
          targetTitle: 'DuplicateaFoodItem',
          reason: 'Distinct duplicate workflow.',
          evidence: [{ kind: 'pbi', ref: 'pbi-1', summary: 'Duplicate flow.' }],
          confidence: 0.9,
          executionStatus: 'pending'
        }
      ],
      [
        {
          proposalId: 'proposal-1',
          action: 'create',
          articleLabel: 'Duplicate a Food Item'
        }
      ],
      {
        status: 'ok',
        sessionId: 'session-1',
        startedAtUtc: new Date().toISOString(),
        endedAtUtc: new Date().toISOString(),
        message: 'Worker execution completed successfully.'
      }
    );

    expect(executedItems).toHaveLength(1);
    expect(executedItems[0]?.status).toBe('executed');
    expect(executedItems[0]?.proposalId).toBe('proposal-1');
  });

  test('returns inspection history for superseded plans, deltas, and transcript linkage', async () => {
    const created = await repository.createWorkspace({
      name: `BatchInspection-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const batch = await repository.createPBIBatch(
      created.id,
      'Sprint 89',
      'sprint-89.csv',
      'imports/sprint-89.csv',
      PBIImportFormat.CSV,
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 1
      },
      PBIBatchScopeMode.ALL
    );

    const iteration = await repository.createBatchAnalysisIteration({
      workspaceId: created.id,
      batchId: batch.id,
      stage: 'planning',
      role: 'planner',
      status: 'running',
      summary: 'Inspection test iteration.',
      agentModelId: 'gpt-5.4',
      sessionId: 'planner-session'
    });

    const initialPlanId = randomUUID();
    await repository.recordBatchAnalysisPlan({
      id: initialPlanId,
      workspaceId: created.id,
      batchId: batch.id,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: 'planning',
      role: 'planner',
      verdict: 'draft',
      planVersion: 1,
      summary: 'Initial draft plan.',
      coverage: [{ pbiId: 'pbi-89', outcome: 'covered', planItemIds: ['plan-item-89'] }],
      items: [{
        planItemId: 'plan-item-89',
        pbiIds: ['pbi-89'],
        action: 'edit',
        targetType: 'article',
        targetTitle: 'Policy article',
        reason: 'Process changed.',
        evidence: [{ kind: 'pbi', ref: 'PBI-89', summary: 'Describes a new process.' }],
        confidence: 0.8,
        executionStatus: 'pending'
      }],
      openQuestions: ['Verify adjacent article impact'],
      createdAtUtc: new Date().toISOString(),
      agentModelId: 'gpt-5.4',
      sessionId: 'planner-session'
    });

    const revisedPlanId = randomUUID();
    await repository.recordBatchAnalysisPlan({
      id: revisedPlanId,
      workspaceId: created.id,
      batchId: batch.id,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: 'plan_revision',
      role: 'planner',
      verdict: 'approved',
      planVersion: 2,
      summary: 'Revised approved plan.',
      coverage: [{ pbiId: 'pbi-89', outcome: 'covered', planItemIds: ['plan-item-89', 'plan-item-90'] }],
      items: [
        {
          planItemId: 'plan-item-89',
          pbiIds: ['pbi-89'],
          action: 'edit',
          targetType: 'article',
          targetTitle: 'Policy article',
          reason: 'Process changed.',
          evidence: [{ kind: 'pbi', ref: 'PBI-89', summary: 'Describes a new process.' }],
          confidence: 0.8,
          executionStatus: 'approved'
        },
        {
          planItemId: 'plan-item-90',
          pbiIds: ['pbi-89'],
          action: 'create',
          targetType: 'new_article',
          targetTitle: 'Escalation article',
          reason: 'Related guidance is missing.',
          evidence: [{ kind: 'review', ref: 'review-1', summary: 'Reviewer found missing article work.' }],
          confidence: 0.72,
          executionStatus: 'approved'
        }
      ],
      openQuestions: [],
      createdAtUtc: new Date().toISOString(),
      supersedesPlanId: initialPlanId,
      agentModelId: 'gpt-5.4',
      sessionId: 'planner-session-2'
    });

    await repository.recordBatchPlanReview({
      id: 'review-1',
      workspaceId: created.id,
      batchId: batch.id,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: 'plan_reviewing',
      role: 'plan-reviewer',
      verdict: 'needs_revision',
      summary: 'Plan missed a related article.',
      didAccountForEveryPbi: true,
      hasMissingCreates: true,
      hasMissingEdits: false,
      hasTargetIssues: false,
      hasOverlapOrConflict: false,
      foundAdditionalArticleWork: true,
      underScopedKbImpact: true,
      delta: {
        summary: 'Add the missing escalation article.',
        requestedChanges: ['Create the escalation article.'],
        missingPbiIds: [],
        missingCreates: ['Escalation article'],
        missingEdits: [],
        additionalArticleWork: ['Escalation article'],
        targetCorrections: [],
        overlapConflicts: []
      },
      createdAtUtc: new Date().toISOString(),
      planId: initialPlanId,
      agentModelId: 'gpt-5.4',
      sessionId: 'review-session'
    });

    await repository.recordBatchAnalysisStageRun({
      workspaceId: created.id,
      batchId: batch.id,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: 'building',
      role: 'worker',
      localSessionId: 'worker-session',
      acpSessionId: 'worker-acp-session',
      kbAccessMode: 'mcp',
      agentModelId: 'gpt-5.4',
      status: 'complete',
      startedAtUtc: new Date().toISOString(),
      endedAtUtc: new Date().toISOString(),
      transcriptPath: 'transcripts/worker-session.jsonl',
      toolCalls: [],
      rawOutput: ['done']
    });

    await repository.recordBatchWorkerExecutionReport({
      id: 'worker-report-1',
      workspaceId: created.id,
      batchId: batch.id,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: 'building',
      role: 'worker',
      summary: 'Executed the revised plan.',
      status: 'needs_amendment',
      planId: revisedPlanId,
      executedItems: [{
        planItemId: 'plan-item-89',
        action: 'edit',
        status: 'executed'
      }],
      discoveredWork: [{
        discoveryId: 'discovery-89',
        sourceWorkerRunId: 'worker-report-1',
        discoveredAction: 'edit',
        suspectedTarget: 'Support checklist article',
        reason: 'Neighboring checklist also changed.',
        evidence: [{ kind: 'article', ref: 'article-2', summary: 'Checklist references outdated process.' }],
        linkedPbiIds: ['pbi-89'],
        confidence: 0.67,
        requiresPlanAmendment: true,
        status: 'pending_review'
      }],
      blockerNotes: [],
      createdAtUtc: new Date().toISOString(),
      agentModelId: 'gpt-5.4',
      sessionId: 'worker-session'
    });

    await repository.recordBatchPlanAmendment({
      id: 'amendment-1',
      workspaceId: created.id,
      batchId: batch.id,
      iterationId: iteration.id,
      approvedPlanId: revisedPlanId,
      sourceWorkerReportId: 'worker-report-1',
      sourceDiscoveryIds: ['discovery-89'],
      proposedPlanId: revisedPlanId,
      reviewId: 'review-2',
      status: 'approved',
      summary: 'Approved the worker discovery amendment.',
      createdAtUtc: new Date().toISOString(),
      updatedAtUtc: new Date().toISOString()
    });

    await repository.recordBatchFinalReview({
      id: 'final-review-1',
      workspaceId: created.id,
      batchId: batch.id,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: 'final_reviewing',
      role: 'final-reviewer',
      verdict: 'needs_rework',
      summary: 'One checklist update is still missing.',
      allPbisMapped: true,
      planExecutionComplete: false,
      hasMissingArticleChanges: true,
      hasUnresolvedDiscoveredWork: false,
      delta: {
        summary: 'Update the support checklist article.',
        requestedRework: ['Edit the support checklist article.'],
        uncoveredPbiIds: [],
        missingArticleChanges: ['Support checklist article'],
        duplicateRiskTitles: [],
        unnecessaryChanges: [],
        unresolvedAmbiguities: []
      },
      createdAtUtc: new Date().toISOString(),
      planId: revisedPlanId,
      workerReportId: 'worker-report-1',
      agentModelId: 'gpt-5.4',
      sessionId: 'final-session'
    });

    const inspection = await repository.getBatchAnalysisInspection(created.id, batch.id);
    expect(inspection.snapshot.latestApprovedPlan?.id).toBe(revisedPlanId);
    expect(inspection.plans).toHaveLength(2);
    expect(inspection.stageRuns.length).toBeGreaterThanOrEqual(1);
    expect(inspection.supersededPlans.map((plan) => plan.id)).toContain(initialPlanId);
    expect(inspection.reviewDeltas).toHaveLength(1);
    expect(inspection.reviewDeltas[0]?.delta.additionalArticleWork).toContain('Escalation article');
    expect(inspection.amendments).toHaveLength(1);
    expect(inspection.finalReviewReworkPlans).toHaveLength(1);
    expect(inspection.finalReviewReworkPlans[0]?.delta.missingArticleChanges).toContain('Support checklist article');
    expect(inspection.timeline.some((entry) => entry.artifactType === 'amendment')).toBeTruthy();
    expect(inspection.transcriptLinks.some((entry) => entry.sessionId === 'planner-session')).toBeTruthy();
    expect(inspection.transcriptLinks.some((entry) => entry.transcriptPath === 'transcripts/worker-session.jsonl')).toBeTruthy();
  });

  test('blocks final approval when hard correctness gates fail', async () => {
    const plan = {
      id: 'plan-1',
      workspaceId: 'ws-1',
      batchId: 'batch-1',
      iterationId: 'iter-1',
      iteration: 1,
      stage: 'planning' as const,
      role: 'planner' as const,
      verdict: 'approved' as const,
      planVersion: 1,
      summary: 'Approved plan',
      coverage: [{ pbiId: 'pbi-1', outcome: 'covered' as const, planItemIds: ['item-1'] }],
      items: [{
        planItemId: 'item-1',
        pbiIds: ['pbi-1'],
        action: 'edit' as const,
        targetType: 'article' as const,
        targetTitle: 'Article A',
        reason: 'Needs update',
        evidence: [],
        confidence: 0.9,
        executionStatus: 'approved' as const
      }],
      openQuestions: [],
      createdAtUtc: new Date().toISOString()
    };
    const workerReport = {
      id: 'worker-1',
      workspaceId: 'ws-1',
      batchId: 'batch-1',
      iterationId: 'iter-1',
      iteration: 1,
      stage: 'building' as const,
      role: 'worker' as const,
      summary: 'Worker said it finished.',
      status: 'completed' as const,
      planId: 'plan-1',
      executedItems: [],
      discoveredWork: [{
        discoveryId: 'disc-1',
        sourceWorkerRunId: 'worker-1',
        discoveredAction: 'edit' as const,
        suspectedTarget: 'Article B',
        reason: 'Found missed related article.',
        evidence: [],
        linkedPbiIds: ['pbi-1'],
        confidence: 0.7,
        requiresPlanAmendment: true,
        status: 'pending_review' as const
      }],
      blockerNotes: [],
      createdAtUtc: new Date().toISOString()
    };
    const finalReview = {
      id: 'final-1',
      workspaceId: 'ws-1',
      batchId: 'batch-1',
      iterationId: 'iter-1',
      iteration: 1,
      stage: 'final_reviewing' as const,
      role: 'final-reviewer' as const,
      verdict: 'approved' as const,
      summary: 'Looks good.',
      allPbisMapped: true,
      planExecutionComplete: true,
      hasMissingArticleChanges: false,
      hasUnresolvedDiscoveredWork: false,
      createdAtUtc: new Date().toISOString(),
      planId: 'plan-1',
      workerReportId: 'worker-1'
    };

    const validation = orchestrator.validateFinalApproval({ plan, workerReport, finalReview });
    expect(validation.ok).toBe(false);
    expect(validation.reasons.join(' ')).toContain('unresolved discovered work');
    expect(validation.reasons.join(' ')).toContain('no worker execution result');
  });

  test('builds proposal review queue, detail payload, and persists decisions', async () => {
    const created = await repository.createWorkspace({
      name: `ProposalReview-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const batch = await repository.createPBIBatch(
      created.id,
      'Sprint 42',
      'sprint-42.csv',
      'imports/sprint-42.csv',
      PBIImportFormat.CSV,
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 1
      },
      PBIBatchScopeMode.ALL
    );

    await repository.insertPBIRecords(created.id, batch.id, [
      {
        batchId: batch.id,
        sourceRowNumber: 1,
        externalId: 'PBI-42',
        title: 'Add team dashboard assignment docs',
        description: 'Document the new team dashboard assignment flow'
      }
    ]);
    const insertedPbis = await repository.getPBIRecords(created.id, batch.id);
    const pbiId = insertedPbis[0]?.id;
    expect(pbiId).toBeTruthy();

    const proposal = await repository.createAgentProposal({
      workspaceId: created.id,
      batchId: batch.id,
      action: 'edit',
      targetTitle: 'Create & Edit Chat Channels',
      targetLocale: 'en-us',
      confidenceScore: 0.92,
      rationaleSummary: 'Update the assignment steps to match the new dashboard flow.',
      aiNotes: 'The title stays the same but steps 3-5 change.',
      suggestedPlacement: {
        sectionId: 'sec-dashboard',
        notes: 'Keep this in the admin workflows section.'
      },
      sourceHtml: '<h1>Create & Edit Chat Channels</h1>\n<p>Old flow.</p>',
      proposedHtml: '<h1>Create & Edit Chat Channels</h1>\n<p>New team dashboard flow.</p>',
      relatedPbiIds: [pbiId as string]
    });

    expect(proposal.reviewStatus).toBe(ProposalReviewStatus.PENDING_REVIEW);

    const queue = await repository.listProposalReviewQueue(created.id, batch.id);
    expect(queue.summary.total).toBe(1);
    expect(queue.summary.pendingReview).toBe(1);
    expect(queue.groups[0].articleLabel).toBe('Create & Edit Chat Channels');
    expect(queue.queue[0].relatedPbiCount).toBe(1);

    const detail = await repository.getProposalReviewDetail(created.id, proposal.id);
    expect(detail.relatedPbis).toHaveLength(1);
    expect(detail.diff.changeRegions.length).toBeGreaterThan(0);
    expect(detail.navigation.total).toBe(1);

    const deleted = await repository.deleteProposalReview(created.id, proposal.id);
    expect(deleted.deletedProposalId).toBe(proposal.id);
    expect(deleted.summary.total).toBe(0);
    await expect(repository.getProposalReviewDetail(created.id, proposal.id)).rejects.toThrow('Proposal not found');

    const queueAfterDelete = await repository.listProposalReviewQueue(created.id, batch.id);
    expect(queueAfterDelete.summary.total).toBe(0);
    expect(queueAfterDelete.queue).toHaveLength(0);

    const proposalDir = path.join(created.path, 'proposals', proposal.id);
    await expect(rm(proposalDir, { recursive: true })).rejects.toThrow();

    const replacement = await repository.createAgentProposal({
      workspaceId: created.id,
      batchId: batch.id,
      action: 'edit',
      targetTitle: 'Create & Edit Chat Channels',
      targetLocale: 'en-us',
      confidenceScore: 0.92,
      rationaleSummary: 'Update the assignment steps to match the new dashboard flow.',
      aiNotes: 'The title stays the same but steps 3-5 change.',
      sourceHtml: '<h1>Create & Edit Chat Channels</h1>\n<p>Old flow.</p>',
      proposedHtml: '<h1>Create & Edit Chat Channels</h1>\n<p>New team dashboard flow.</p>',
      relatedPbiIds: [pbiId as string]
    });

    const decision = await repository.decideProposalReview({
      workspaceId: created.id,
      proposalId: replacement.id,
      decision: ProposalReviewDecision.ACCEPT,
      note: 'Looks good.'
    });

    expect(decision.reviewStatus).toBe(ProposalReviewStatus.ACCEPTED);
    expect(decision.batchStatus).toBe('review_complete');
    expect(decision.summary.accepted).toBe(1);
    expect(decision.branchId).toBeTruthy();
    expect(decision.revisionId).toBeTruthy();

    const revisions = await repository.listRevisions(created.id);
    const draftRevision = revisions.find((revision) => revision.id === decision.revisionId);
    expect(draftRevision?.branchId).toBe(decision.branchId);
    expect(draftRevision?.revisionType).toBe(RevisionState.DRAFT_BRANCH);
  });

  test('keeps staged batch-analysis proposals hidden until final approval promotes them', async () => {
    const created = await repository.createWorkspace({
      name: `ProposalStaging-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const batch = await repository.createPBIBatch(
      created.id,
      'Sprint 43',
      'sprint-43.csv',
      'imports/sprint-43.csv',
      PBIImportFormat.CSV,
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 1
      },
      PBIBatchScopeMode.ALL
    );

    const stagedProposal = await repository.createAgentProposal({
      workspaceId: created.id,
      batchId: batch.id,
      action: 'create',
      reviewStatus: ProposalReviewStatus.STAGED_ANALYSIS,
      targetTitle: 'Duplicate a Food Item',
      targetLocale: 'en-us',
      rationaleSummary: 'Drafted by batch worker before final approval.',
      aiNotes: 'Internal batch draft.',
      proposedHtml: '<h1>Duplicate a Food Item</h1><p>Draft content.</p>'
    });

    expect(stagedProposal.reviewStatus).toBe(ProposalReviewStatus.STAGED_ANALYSIS);

    const hiddenQueue = await repository.listProposalReviewQueue(created.id, batch.id);
    expect(hiddenQueue.summary.total).toBe(0);
    expect(hiddenQueue.queue).toHaveLength(0);

    const hiddenBatchList = await repository.listProposalReviewBatches(created.id);
    expect(hiddenBatchList.batches).toHaveLength(0);

    const promotion = await repository.promoteBatchProposalsToPendingReview({
      workspaceId: created.id,
      batchId: batch.id,
      proposalIds: [stagedProposal.id]
    });

    expect(promotion.promotedProposalIds).toEqual([stagedProposal.id]);
    expect(promotion.batchStatus).toBe(PBIBatchStatus.REVIEW_IN_PROGRESS);

    const visibleQueue = await repository.listProposalReviewQueue(created.id, batch.id);
    expect(visibleQueue.summary.total).toBe(1);
    expect(visibleQueue.summary.pendingReview).toBe(1);
    expect(visibleQueue.queue[0]?.proposalId).toBe(stagedProposal.id);

    const visibleBatchList = await repository.listProposalReviewBatches(created.id);
    expect(visibleBatchList.batches).toHaveLength(1);
    expect(visibleBatchList.batches[0]?.pendingReviewCount).toBe(1);
  });

  test('marks terminal non-approved batch analysis attempts as analyzed instead of leaving the batch submitted', async () => {
    const created = await repository.createWorkspace({
      name: `TerminalBatchStatus-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const batch = await repository.createPBIBatch(
      created.id,
      'Sprint 46',
      'sprint-46.csv',
      'imports/sprint-46.csv',
      PBIImportFormat.CSV,
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 1
      },
      PBIBatchScopeMode.ALL
    );

    await repository.setPBIBatchStatus(created.id, batch.id, PBIBatchStatus.SUBMITTED);

    const iteration = await repository.createBatchAnalysisIteration({
      workspaceId: created.id,
      batchId: batch.id,
      stage: 'building',
      role: 'worker',
      status: 'running',
      summary: 'Executing worker pass.',
      agentModelId: 'gpt-5.4',
      sessionId: 'session-terminal-status'
    });

    await repository.updateBatchAnalysisIteration({
      workspaceId: created.id,
      iterationId: iteration.id,
      stage: 'needs_human_review',
      role: 'final-reviewer',
      status: 'needs_human_review',
      summary: 'Worker attempted illegal MCP tools before creating proposals.',
      agentModelId: 'gpt-5.4',
      sessionId: 'session-terminal-status',
      endedAtUtc: new Date().toISOString()
    });

    const refreshedBatch = await repository.getPBIBatch(created.id, batch.id);
    expect(refreshedBatch.status).toBe(PBIBatchStatus.ANALYZED);
  });

  test('annotates batch-analysis proposal provenance without changing local proposal ownership', async () => {
    const created = await repository.createWorkspace({
      name: `ProposalProvenance-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const batch = await repository.createPBIBatch(
      created.id,
      'Sprint 45',
      'sprint-45.csv',
      'imports/sprint-45.csv',
      PBIImportFormat.CSV,
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 1
      },
      PBIBatchScopeMode.ALL
    );

    const proposal = await repository.createAgentProposal({
      workspaceId: created.id,
      batchId: batch.id,
      action: 'edit',
      reviewStatus: ProposalReviewStatus.STAGED_ANALYSIS,
      _sessionId: 'batch-runtime-session-1',
      originPath: 'batch_analysis',
      targetTitle: 'Proposal Provenance',
      targetLocale: 'en-us',
      rationaleSummary: 'Track provider provenance for batch-created proposals.',
      proposedHtml: '<h1>Proposal Provenance</h1><p>Updated content.</p>'
    });

    expect((proposal.metadata as Record<string, unknown> | undefined)).toMatchObject({
      originPath: 'batch_analysis',
      runtimeSessionId: 'batch-runtime-session-1'
    });

    const annotation = await repository.annotateProposalProvenanceForSession({
      workspaceId: created.id,
      batchId: batch.id,
      sessionId: 'batch-runtime-session-1',
      kbAccessMode: 'cli',
      acpSessionId: 'batch-acp-session-1',
      originPath: 'batch_analysis'
    });
    expect(annotation.updatedProposalIds).toEqual([proposal.id]);

    const detail = await repository.getProposalReviewDetail(created.id, proposal.id);
    expect(detail.proposal.sessionId).toBe('batch-runtime-session-1');
    expect(detail.proposal.metadata as Record<string, unknown> | undefined).toMatchObject({
      originPath: 'batch_analysis',
      runtimeSessionId: 'batch-runtime-session-1',
      kbAccessMode: 'cli',
      acpSessionId: 'batch-acp-session-1'
    });
  });

  test('applies proposals to an existing draft branch, archives no-impact proposals, and retires locale variants', async () => {
    const created = await repository.createWorkspace({
      name: `ProposalDecisionHooks-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const family = await repository.createArticleFamily({
      workspaceId: created.id,
      externalKey: 'kb-food-lists',
      title: 'Manage Food Lists'
    });
    const variant = await repository.createLocaleVariant({
      workspaceId: created.id,
      familyId: family.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });
    const liveRevision = await repository.createRevision({
      workspaceId: created.id,
      localeVariantId: variant.id,
      revisionType: RevisionState.LIVE,
      filePath: 'articles/manage-food-lists/live.html',
      revisionNumber: 1,
      status: RevisionStatus.OPEN
    });

    const batch = await repository.createPBIBatch(
      created.id,
      'Sprint 44',
      'sprint-44.csv',
      'imports/sprint-44.csv',
      PBIImportFormat.CSV,
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 1
      },
      PBIBatchScopeMode.ALL
    );

    const editProposal = await repository.createAgentProposal({
      workspaceId: created.id,
      batchId: batch.id,
      action: 'edit',
      familyId: family.id,
      localeVariantId: variant.id,
      sourceRevisionId: liveRevision.id,
      targetTitle: 'Manage Food Lists',
      targetLocale: 'en-us',
      proposedHtml: '<h1>Manage Food Lists</h1><p>Updated branch content.</p>'
    });

    const accepted = await repository.decideProposalReview({
      workspaceId: created.id,
      proposalId: editProposal.id,
      decision: ProposalReviewDecision.ACCEPT
    });

    expect(accepted.branchId).toBeTruthy();

    const secondProposal = await repository.createAgentProposal({
      workspaceId: created.id,
      batchId: batch.id,
      action: 'edit',
      familyId: family.id,
      localeVariantId: variant.id,
      sourceRevisionId: liveRevision.id,
      targetTitle: 'Manage Food Lists',
      targetLocale: 'en-us',
      proposedHtml: '<h1>Manage Food Lists</h1><p>Applied into the same draft branch.</p>'
    });

    const applied = await repository.decideProposalReview({
      workspaceId: created.id,
      proposalId: secondProposal.id,
      decision: ProposalReviewDecision.APPLY_TO_BRANCH,
      branchId: accepted.branchId
    });

    expect(applied.reviewStatus).toBe(ProposalReviewStatus.APPLIED_TO_BRANCH);
    expect(applied.branchId).toBe(accepted.branchId);
    expect(applied.revisionId).toBeTruthy();

    const noImpact = await repository.createAgentProposal({
      workspaceId: created.id,
      batchId: batch.id,
      action: 'no_impact',
      targetTitle: 'Manage Food Lists',
      aiNotes: 'No KB action is required for this batch.'
    });
    const archived = await repository.decideProposalReview({
      workspaceId: created.id,
      proposalId: noImpact.id,
      decision: ProposalReviewDecision.ACCEPT
    });
    expect(archived.reviewStatus).toBe(ProposalReviewStatus.ARCHIVED);

    const retireProposal = await repository.createAgentProposal({
      workspaceId: created.id,
      batchId: batch.id,
      action: 'retire',
      familyId: family.id,
      localeVariantId: variant.id,
      targetTitle: 'Manage Food Lists',
      rationaleSummary: 'This article is obsolete after the new workflow launch.'
    });
    const retired = await repository.decideProposalReview({
      workspaceId: created.id,
      proposalId: retireProposal.id,
      decision: ProposalReviewDecision.ACCEPT
    });

    expect(retired.reviewStatus).toBe(ProposalReviewStatus.ACCEPTED);
    expect(retired.localeVariantId).toBe(variant.id);
    expect(retired.retiredAtUtc).toBeTruthy();

    const refreshedVariant = await repository.getLocaleVariantByFamilyAndLocale(created.id, family.id, 'en-us');
    expect(refreshedVariant?.status).toBe(RevisionState.RETIRED);
    expect(refreshedVariant?.retiredAtUtc).toBeTruthy();
  });

  test('rejects empty create proposals and infers KB-prefixed article titles', async () => {
    const created = await repository.createWorkspace({
      name: `ProposalGuardrails-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const batch = await repository.createPBIBatch(
      created.id,
      'Sprint 43',
      'sprint-43.csv',
      'imports/sprint-43.csv',
      PBIImportFormat.CSV,
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 1
      },
      PBIBatchScopeMode.ALL
    );

    await expect(
      repository.createAgentProposal({
        workspaceId: created.id,
        batchId: batch.id,
        action: 'create'
      })
    ).rejects.toThrow('Proposal must include notes, rationale, metadata, linked PBIs, or HTML content');

    const createdProposal = await repository.createAgentProposal({
      workspaceId: created.id,
      batchId: batch.id,
      action: 'create',
      note: 'KB create: article Duplicate Food Lists and Food Items (Portal)',
      rationale: 'No duplicate article exists today.'
    });

    expect(createdProposal.targetTitle).toBe('Duplicate Food Lists and Food Items');
  });

  test('supports batch 8 draft branch editing, validation, and undo redo history', async () => {
    const created = await repository.createWorkspace({
      name: `DraftBatch8-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const family = await repository.createArticleFamily({
      workspaceId: created.id,
      externalKey: 'kb-draft-editing',
      title: 'Draft Editing'
    });
    const variant = await repository.createLocaleVariant({
      workspaceId: created.id,
      familyId: family.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });
    await repository.createRevision({
      workspaceId: created.id,
      localeVariantId: variant.id,
      revisionType: RevisionState.LIVE,
      filePath: 'articles/draft-editing/live.html',
      revisionNumber: 1,
      status: RevisionStatus.OPEN
    });

    const createdBranch = await repository.createDraftBranch({
      workspaceId: created.id,
      localeVariantId: variant.id,
      name: 'Manual editor branch',
      sourceHtml: '<h1>Draft Editing</h1><p>Starting point.</p>'
    });

    expect(createdBranch.branch.status).toBe(DraftBranchStatus.ACTIVE);
    expect(createdBranch.editor.history.length).toBeGreaterThan(0);

    const saved = await repository.saveDraftBranch({
      workspaceId: created.id,
      branchId: createdBranch.branch.id,
      html: '<h1>Draft Editing</h1><script>alert(1)</script><p>Manual save.</p>',
      commitMessage: 'Manual update'
    });

    expect(saved.branch.headRevisionNumber).toBeGreaterThan(createdBranch.branch.headRevisionNumber);
    expect(saved.editor.validationWarnings.some((warning) => warning.code === 'unsupported_tag')).toBe(true);

    const ready = await repository.setDraftBranchStatus({
      workspaceId: created.id,
      branchId: createdBranch.branch.id,
      status: DraftBranchStatus.READY_TO_PUBLISH
    });
    expect(ready.branch.status).toBe(DraftBranchStatus.READY_TO_PUBLISH);

    const undone = await repository.undoDraftBranch({
      workspaceId: created.id,
      branchId: createdBranch.branch.id
    });
    expect(undone.branch.headRevisionId).toBe(createdBranch.branch.headRevisionId);

    const redone = await repository.redoDraftBranch({
      workspaceId: created.id,
      branchId: createdBranch.branch.id
    });
    expect(redone.branch.headRevisionId).toBe(saved.branch.headRevisionId);
  });

  test('supports batch 9 article ai persistence and template CRUD', async () => {
    const created = await repository.createWorkspace({
      name: `ArticleAi-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const family = await repository.createArticleFamily({
      workspaceId: created.id,
      externalKey: 'batch9-ai',
      title: 'Batch 9 AI'
    });
    const variant = await repository.createLocaleVariant({
      workspaceId: created.id,
      familyId: family.id,
      locale: 'en-us',
      status: RevisionState.LIVE
    });
    await repository.createRevision({
      workspaceId: created.id,
      localeVariantId: variant.id,
      revisionType: RevisionState.LIVE,
      filePath: 'articles/batch9/live.html',
      revisionNumber: 1,
      status: RevisionStatus.OPEN
    });

    const branch = await repository.createDraftBranch({
      workspaceId: created.id,
      localeVariantId: variant.id,
      sourceHtml: '<h1>Batch 9 AI</h1><p>Original draft.</p>'
    });

    const initialSession = await repository.getOrCreateArticleAiSession({
      workspaceId: created.id,
      branchId: branch.branch.id
    });
    expect(initialSession.messages).toHaveLength(0);
    expect(initialSession.presets.length).toBeGreaterThan(0);

    const templateList = await repository.listTemplatePackSummaries({ workspaceId: created.id, includeInactive: true });
    expect(templateList.templates.length).toBeGreaterThan(0);

    const submitted = await repository.submitArticleAiMessage(
      {
        workspaceId: created.id,
        branchId: branch.branch.id,
        message: 'Shorten the article and make it sharper.',
        presetAction: ArticleAiPresetAction.SHORTEN
      },
      {
        runtimeSessionId: 'session-local',
        updatedHtml: '<h1>Batch 9 AI</h1><p>Sharper draft.</p>',
        summary: 'Tightened the opening and simplified wording.',
        rationale: 'Removed repetition.'
      }
    );
    expect(submitted.messages).toHaveLength(2);
    expect(submitted.pendingEdit?.proposedHtml).toContain('Sharper draft');

    const rejected = await repository.rejectArticleAiEdit({
      workspaceId: created.id,
      sessionId: submitted.session.id
    });
    expect(rejected.pendingEdit).toBeUndefined();

    await repository.submitArticleAiMessage(
      {
        workspaceId: created.id,
        branchId: branch.branch.id,
        message: 'Convert this into a troubleshooting flow.',
        presetAction: ArticleAiPresetAction.CONVERT_TO_TROUBLESHOOTING
      },
      {
        runtimeSessionId: 'session-local',
        updatedHtml: '<h1>Batch 9 AI</h1><h2>Symptoms</h2><p>Something is wrong.</p>',
        summary: 'Converted the draft into troubleshooting sections.'
      }
    );

    const accepted = await repository.acceptArticleAiEdit({
      workspaceId: created.id,
      sessionId: submitted.session.id
    });
    expect(accepted.acceptedBranchId).toBe(branch.branch.id);
    expect(accepted.acceptedRevisionId).toBeTruthy();

    const editor = await repository.getDraftBranchEditor(created.id, branch.branch.id);
    expect(editor.editor.html).toContain('Symptoms');
    expect(editor.editor.history.some((entry) => entry.summary?.includes('Converted'))).toBe(true);

    const reset = await repository.resetArticleAiSession({
      workspaceId: created.id,
      sessionId: submitted.session.id
    });
    expect(reset.messages).toHaveLength(0);

    const savedTemplate = await repository.upsertTemplatePack({
      workspaceId: created.id,
      name: 'Spanish Troubleshooting',
      language: 'es-es',
      templateType: TemplatePackType.TROUBLESHOOTING,
      promptTemplate: 'Estructura el articulo como sintomas, causas y resolucion.',
      toneRules: 'Usa espanol claro y orientado a tareas.',
      description: 'Plantilla para articulos de diagnostico.',
      examples: '<h1>Resolver un error</h1>'
    });
    expect(savedTemplate.templateType).toBe(TemplatePackType.TROUBLESHOOTING);

    const analyzed = await repository.analyzeTemplatePack({
      workspaceId: created.id,
      templatePackId: savedTemplate.id
    });
    expect(analyzed?.analysis?.score).toBeGreaterThan(0);

    await repository.deleteTemplatePack({
      workspaceId: created.id,
      templatePackId: savedTemplate.id
    });
    expect(await repository.getTemplatePackDetail({ workspaceId: created.id, templatePackId: savedTemplate.id })).toBeNull();
  });

  test('manages article family CRUD and validation', async () => {
    const created = await repository.createWorkspace({
      name: `Families-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const listEmpty = await repository.listArticleFamilies(created.id);
    expect(listEmpty.length).toBe(0);

    const family = await repository.createArticleFamily({
      workspaceId: created.id,
      externalKey: 'getting-started',
      title: 'Getting Started',
      sectionId: 'section-a',
      categoryId: 'category-a'
    });

    const fetched = await repository.getArticleFamily(created.id, family.id);
    expect(fetched.externalKey).toBe('getting-started');

    const families = await repository.listArticleFamilies(created.id);
    expect(families.length).toBe(1);

    const updated = await repository.updateArticleFamily({
      workspaceId: created.id,
      familyId: family.id,
      title: 'Updated Family',
      retiredAtUtc: '2026-01-01T00:00:00.000Z'
    });
    expect(updated.title).toBe('Updated Family');
    expect(updated.retiredAtUtc).toBe('2026-01-01T00:00:00.000Z');

    await expect(
      repository.updateArticleFamily({
        workspaceId: created.id,
        familyId: family.id
      })
    ).rejects.toThrow('Article family update requires at least one field');

    await expect(
      repository.createArticleFamily({
        workspaceId: created.id,
        externalKey: 'getting-started',
        title: 'Duplicate Family'
      })
    ).rejects.toThrow('Article family already exists');

    await repository.deleteArticleFamily(created.id, family.id);
    await expect(repository.getArticleFamily(created.id, family.id)).rejects.toThrow('Article family not found');
  });

  test('manages locale variants and validates uniqueness', async () => {
    const created = await repository.createWorkspace({
      name: `Variants-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const family = await repository.createArticleFamily({
      workspaceId: created.id,
      externalKey: 'api',
      title: 'API Guide'
    });

    const variant = await repository.createLocaleVariant({
      workspaceId: created.id,
      familyId: family.id,
      locale: 'en-us'
    });

    const variants = await repository.listLocaleVariants(created.id);
    expect(variants.length).toBe(1);
    expect(variants[0].locale).toBe('en-us');

    const fetched = await repository.getLocaleVariant(created.id, variant.id);
    expect(fetched.id).toBe(variant.id);

    const updated = await repository.updateLocaleVariant({
      workspaceId: created.id,
      variantId: variant.id,
      locale: 'en-gb',
      status: 'draft_branch'
    });
    expect(updated.locale).toBe('en-gb');

    await expect(
      repository.createLocaleVariant({
        workspaceId: created.id,
        familyId: family.id,
        locale: 'en-gb'
      })
    ).rejects.toThrow('Locale variant already exists');

    await repository.deleteLocaleVariant(created.id, updated.id);
    await expect(repository.getLocaleVariant(created.id, updated.id)).rejects.toThrow('Locale variant not found');
  });

  test('manages revisions and enforces ordering/number constraints', async () => {
    const created = await repository.createWorkspace({
      name: `Revisions-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const family = await repository.createArticleFamily({
      workspaceId: created.id,
      externalKey: 'release-notes',
      title: 'Release Notes'
    });
    const variant = await repository.createLocaleVariant({
      workspaceId: created.id,
      familyId: family.id,
      locale: 'en-us'
    });

    const revisionOne = await repository.createRevision({
      workspaceId: created.id,
      localeVariantId: variant.id,
      revisionType: 'live',
      filePath: '/tmp/release-1.json',
      revisionNumber: 1,
      status: 'open'
    });

    const revisionTwo = await repository.createRevision({
      workspaceId: created.id,
      localeVariantId: variant.id,
      revisionType: 'live',
      filePath: '/tmp/release-2.json',
      revisionNumber: 2,
      status: 'promoted'
    });
    expect(revisionTwo.revisionNumber).toBe(2);

    const revisions = await repository.listRevisions(created.id, variant.id);
    expect(revisions[0].revisionNumber).toBeGreaterThanOrEqual(revisions[1].revisionNumber);

    const fetchedRevision = await repository.getRevision(created.id, revisionTwo.id);
    expect(fetchedRevision.id).toBe(revisionTwo.id);

    const updated = await repository.updateRevision({
      workspaceId: created.id,
      revisionId: revisionTwo.id,
      revisionNumber: 3,
      status: 'failed'
    });
    expect(updated.revisionNumber).toBe(3);

    await expect(
      repository.createRevision({
        workspaceId: created.id,
        localeVariantId: variant.id,
        revisionType: 'live',
        filePath: '/tmp/release-0.json',
        revisionNumber: 2,
        status: 'open'
      })
    ).rejects.toThrow('revisionNumber must not regress');

    await expect(
      repository.createRevision({
        workspaceId: created.id,
        localeVariantId: variant.id,
        revisionType: 'live',
        filePath: '/tmp/revision.json',
        revisionNumber: 3.25,
        status: 'open'
      })
    ).rejects.toThrow('revisionNumber must be an integer');

    const deleted = await repository.deleteRevision(created.id, revisionOne.id);
    expect(deleted).toBeUndefined();

    await expect(repository.getRevision(created.id, revisionOne.id)).rejects.toThrow('Revision not found');

    const afterDelete = await repository.listRevisions(created.id, variant.id);
    expect(afterDelete.some((revision) => revision.id === revisionOne.id)).toBe(false);
  });

  test('uses the newest of the locale sync timestamp and revision timestamp in explorer tree rows', async () => {
    const created = await repository.createWorkspace({
      name: `ExplorerSync-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const family = await repository.createArticleFamily({
      workspaceId: created.id,
      externalKey: 'sync-guide',
      title: 'Sync Guide'
    });
    const variant = await repository.createLocaleVariant({
      workspaceId: created.id,
      familyId: family.id,
      locale: 'en-us'
    });

    const revision = await repository.createRevision({
      workspaceId: created.id,
      localeVariantId: variant.id,
      revisionType: 'live',
      filePath: '/tmp/sync-guide.html',
      revisionNumber: 1,
      status: 'promoted',
      updatedAtUtc: '2026-03-20T10:00:00.000Z'
    });

    await repository.upsertSyncCheckpoint(
      created.id,
      'en-us',
      1,
      '2026-03-22T15:30:00.000Z'
    );

    const tree = await repository.getExplorerTree(created.id);
    expect(tree).toHaveLength(1);
    expect(tree[0].familyId).toBe(family.id);
    expect(tree[0].locales).toHaveLength(1);
    expect(tree[0].locales[0].localeVariantId).toBe(variant.id);
    expect(tree[0].locales[0].revision.revisionId).toBe(revision.id);
    expect(tree[0].locales[0].revision.updatedAtUtc).toBe('2026-03-22T15:30:00.000Z');

    await repository.updateRevision({
      workspaceId: created.id,
      revisionId: revision.id,
      updatedAtUtc: '2026-03-22T16:45:00.000Z'
    });

    const refreshedTree = await repository.getExplorerTree(created.id);
    expect(refreshedTree[0].locales[0].revision.updatedAtUtc).toBe('2026-03-22T16:45:00.000Z');
  });

  test('backfills legacy ai_runs into orchestration history during migration repair', async () => {
    const created = await repository.createWorkspace({
      name: `LegacyBatchRepair-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const batch = await repository.createPBIBatch(
      created.id,
      'Legacy Sprint',
      'legacy.csv',
      'imports/legacy.csv',
      PBIImportFormat.CSV,
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 1
      },
      PBIBatchScopeMode.ALL
    );

    await repository.recordBatchAnalysisRun({
      workspaceId: created.id,
      batchId: batch.id,
      sessionId: 'legacy-session-1',
      kbAccessMode: 'mcp',
      agentModelId: 'gpt-5.4',
      status: 'complete',
      startedAtUtc: new Date().toISOString(),
      endedAtUtc: new Date().toISOString(),
      promptTemplate: 'Legacy single-run prompt.',
      transcriptPath: 'transcripts/legacy-session-1.jsonl',
      toolCalls: [],
      rawOutput: ['legacy ok'],
      message: 'Legacy batch analysis completed before orchestration rollout.'
    });

    const health = await repository.getMigrationHealth(created.id);
    expect(health.workspaces).toHaveLength(1);
    expect(health.workspaces[0]?.batchAnalysisRepair?.backfilledLegacyIterations).toBeGreaterThan(0);
    expect(health.workspaces[0]?.batchAnalysisRepair?.backfilledLegacyStageRuns).toBeGreaterThan(0);
    expect(health.workspaces[0]?.batchAnalysisRepair?.backfilledLegacyWorkerReports).toBeGreaterThan(0);
    expect(health.workspaces[0]?.batchAnalysisRepair?.backfilledStageEvents).toBeGreaterThan(0);

    const snapshot = await repository.getBatchAnalysisSnapshot(created.id, batch.id);
    expect(snapshot.latestIteration?.stage).toBe('approved');
    expect(snapshot.latestWorkerReport?.summary).toContain('Legacy batch analysis completed');

    const runtimeStatus = await repository.getBatchAnalysisRuntimeStatus(created.id, batch.id);
    expect(runtimeStatus?.stage).toBe('approved');
    expect(runtimeStatus?.latestEventType).toBe('iteration_completed');

    const eventStream = await repository.getBatchAnalysisEventStream(created.id, batch.id, 10);
    expect(eventStream.events.some((event) => event.eventType === 'iteration_started')).toBeTruthy();
    expect(eventStream.events.some((event) => event.eventType === 'iteration_completed')).toBeTruthy();
  });

  test('does not synthesize a worker report for planner-only failures during repair', async () => {
    const created = await repository.createWorkspace({
      name: `PlannerOnlyRepair-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const batch = await repository.createPBIBatch(
      created.id,
      'Planner Failure Sprint',
      'planner-failure.csv',
      'imports/planner-failure.csv',
      PBIImportFormat.CSV,
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 1
      },
      PBIBatchScopeMode.ALL
    );

    await repository.createBatchAnalysisIteration({
      workspaceId: created.id,
      batchId: batch.id,
      stage: 'planning',
      role: 'planner',
      status: 'failed',
      summary: 'Planner failed before producing a plan.',
      agentModelId: 'gpt-5.4',
      sessionId: 'planner-failure-session',
      startedAtUtc: new Date().toISOString(),
      endedAtUtc: new Date().toISOString()
    });

    await repository.recordBatchAnalysisRun({
      workspaceId: created.id,
      batchId: batch.id,
      sessionId: 'planner-failure-session',
      kbAccessMode: 'mcp',
      agentModelId: 'gpt-5.4',
      status: 'failed',
      startedAtUtc: new Date().toISOString(),
      endedAtUtc: new Date().toISOString(),
      transcriptPath: 'transcripts/planner-failure.jsonl',
      toolCalls: [],
      rawOutput: ['planner failed'],
      message: '[planning/planner] Planner failed before producing a plan.'
    });

    const health = await repository.getMigrationHealth(created.id);
    expect(health.workspaces[0]?.batchAnalysisRepair?.backfilledLegacyWorkerReports).toBe(0);

    const snapshot = await repository.getBatchAnalysisSnapshot(created.id, batch.id);
    expect(snapshot.latestIteration?.stage).toBe('planning');
    expect(snapshot.latestWorkerReport).toBeNull();

    const inspection = await repository.getBatchAnalysisInspection(created.id, batch.id);
    expect(inspection.workerReports).toHaveLength(0);
    expect(inspection.stageRuns.some((run) => run.stage === 'planning' && run.role === 'planner')).toBeTruthy();
  });

  test('latest persisted batch run can reflect planner tool usage even when no worker run exists yet', async () => {
    const created = await repository.createWorkspace({
      name: `PlannerRunAudit-${randomUUID()}`,
      zendeskSubdomain: 'support',
      defaultLocale: 'en-us'
    });

    const batch = await repository.createPBIBatch(
      created.id,
      'Planner Audit Sprint',
      'planner-audit.csv',
      'imports/planner-audit.csv',
      PBIImportFormat.CSV,
      1,
      {
        candidateRowCount: 1,
        malformedRowCount: 0,
        duplicateRowCount: 0,
        ignoredRowCount: 0,
        scopedRowCount: 1
      },
      PBIBatchScopeMode.ALL
    );

    await repository.recordBatchAnalysisRun({
      workspaceId: created.id,
      batchId: batch.id,
      sessionId: 'planner-stage-session',
      kbAccessMode: 'cli',
      agentModelId: 'gpt-5.4',
      status: 'failed',
      startedAtUtc: new Date().toISOString(),
      endedAtUtc: new Date().toISOString(),
      transcriptPath: 'transcripts/planner-stage-session.jsonl',
      toolCalls: [{
        workspaceId: created.id,
        sessionId: 'planner-stage-session',
        toolName: 'search-kb',
        args: { query: 'View Food Lists' },
        calledAtUtc: new Date().toISOString(),
        allowed: true
      }],
      rawOutput: ['planner incomplete'],
      message: '[planning/planner] Planner returned incomplete output.'
    });

    const latestRun = await repository.getLatestBatchAnalysisRun(created.id, batch.id);
    expect(latestRun).not.toBeNull();
    expect(latestRun?.toolCalls).toHaveLength(1);
    expect(latestRun?.toolCalls[0]?.toolName).toBe('search-kb');
  });
});
