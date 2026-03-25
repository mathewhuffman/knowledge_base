import { randomUUID } from 'node:crypto';
import type {
  AgentRunResult,
  BatchAnalysisExecutionCounts,
  BatchAnalysisIterationRecord,
  BatchAnalysisPlan,
  BatchPlanAmendment,
  BatchPlanExecutionStatus,
  BatchPlanCoverage,
  BatchPlanReview,
  BatchPlanReviewDelta,
  BatchDiscoveredWorkItem,
  BatchFinalReview,
  BatchFinalReviewDelta,
  BatchPlanItem,
  BatchWorkerExecutionReport,
  KbAccessMode
} from '@kb-vault/shared-types';
import { WorkspaceRepository } from './workspace-repository';

export class BatchAnalysisOrchestrator {
  constructor(private readonly workspaceRepository: WorkspaceRepository) {}

  async startIteration(params: {
    workspaceId: string;
    batchId: string;
    agentModelId?: string;
    startedAtUtc: string;
  }): Promise<BatchAnalysisIterationRecord> {
    const iteration = await this.workspaceRepository.createBatchAnalysisIteration({
      workspaceId: params.workspaceId,
      batchId: params.batchId,
      stage: 'planning',
      role: 'planner',
      status: 'running',
      summary: 'Synthesizing initial batch plan.',
      agentModelId: params.agentModelId,
      startedAtUtc: params.startedAtUtc
    });
    await this.workspaceRepository.recordBatchAnalysisStageEvent({
      id: randomUUID(),
      workspaceId: iteration.workspaceId,
      batchId: iteration.batchId,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: iteration.stage,
      role: iteration.role,
      eventType: 'iteration_started',
      status: iteration.status,
      summary: iteration.summary,
      sessionId: iteration.sessionId,
      agentModelId: iteration.agentModelId,
      approvedPlanId: iteration.approvedPlanId,
      lastReviewVerdict: iteration.lastReviewVerdict,
      outstandingDiscoveredWorkCount: iteration.outstandingDiscoveredWorkCount,
      executionCounts: iteration.executionCounts,
      createdAtUtc: params.startedAtUtc
    });
    return iteration;
  }

  async recordPlan(plan: BatchAnalysisPlan): Promise<BatchAnalysisPlan> {
    return this.workspaceRepository.recordBatchAnalysisPlan(plan);
  }

  async recordReview(review: BatchPlanReview): Promise<BatchPlanReview> {
    return this.workspaceRepository.recordBatchPlanReview(review);
  }

  async recordAmendment(amendment: BatchPlanAmendment): Promise<BatchPlanAmendment> {
    return this.workspaceRepository.recordBatchPlanAmendment(amendment);
  }

  async recordFinalReview(review: BatchFinalReview): Promise<BatchFinalReview> {
    return this.workspaceRepository.recordBatchFinalReview(review);
  }

  async transitionIteration(params: {
    workspaceId: string;
    iterationId: string;
    stage: BatchAnalysisIterationRecord['stage'];
    role: BatchAnalysisIterationRecord['role'];
    summary?: string;
    agentModelId?: string;
    sessionId?: string;
    approvedPlanId?: string;
    lastReviewVerdict?: BatchPlanReview['verdict'];
  }): Promise<BatchAnalysisIterationRecord> {
    const iteration = await this.workspaceRepository.updateBatchAnalysisIteration({
      workspaceId: params.workspaceId,
      iterationId: params.iterationId,
      stage: params.stage,
      role: params.role,
      status: 'running',
      summary: params.summary,
      agentModelId: params.agentModelId,
      sessionId: params.sessionId,
      approvedPlanId: params.approvedPlanId,
      lastReviewVerdict: params.lastReviewVerdict
    });
    await this.workspaceRepository.recordBatchAnalysisStageEvent({
      id: randomUUID(),
      workspaceId: iteration.workspaceId,
      batchId: iteration.batchId,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: iteration.stage,
      role: iteration.role,
      eventType: 'stage_transition',
      status: iteration.status,
      summary: iteration.summary,
      sessionId: iteration.sessionId,
      agentModelId: iteration.agentModelId,
      approvedPlanId: iteration.approvedPlanId,
      lastReviewVerdict: iteration.lastReviewVerdict,
      outstandingDiscoveredWorkCount: iteration.outstandingDiscoveredWorkCount,
      executionCounts: iteration.executionCounts,
      createdAtUtc: iteration.updatedAtUtc
    });
    return iteration;
  }

  async finalizeLegacyExecution(params: {
    iteration: BatchAnalysisIterationRecord;
    workspaceId: string;
    batchId: string;
    kbAccessMode: KbAccessMode;
    agentModelId?: string;
    approvedPlan: BatchAnalysisPlan;
    summary?: string;
    discoveredWork?: BatchDiscoveredWorkItem[];
    result: AgentRunResult;
  }): Promise<{ iteration: BatchAnalysisIterationRecord; workerReport: BatchWorkerExecutionReport }> {
    const { workerReport, executionCounts } = await this.recordWorkerPass({
      iteration: params.iteration,
      workspaceId: params.workspaceId,
      batchId: params.batchId,
      agentModelId: params.agentModelId,
      approvedPlan: params.approvedPlan,
      result: params.result,
      summary: params.summary,
      discoveredWork: params.discoveredWork
    });
    const nextStage =
      params.result.status === 'ok'
        ? 'approved'
        : params.result.status === 'canceled'
          ? 'canceled'
          : 'failed';
    const nextStatus =
      params.result.status === 'ok'
        ? 'completed'
        : params.result.status === 'canceled'
          ? 'canceled'
          : 'failed';

    const updatedIteration = await this.workspaceRepository.updateBatchAnalysisIteration({
      workspaceId: params.workspaceId,
      iterationId: params.iteration.id,
      stage: nextStage,
      role: params.result.status === 'ok' ? 'final-reviewer' : 'worker',
      status: nextStatus,
      summary: workerReport.summary,
      agentModelId: params.agentModelId,
      sessionId: params.result.sessionId,
      outstandingDiscoveredWorkCount: workerReport.discoveredWork.length,
      executionCounts,
      endedAtUtc: params.result.endedAtUtc
    });

    return {
      iteration: updatedIteration,
      workerReport
    };
  }

  async recordWorkerPass(params: {
    iteration: BatchAnalysisIterationRecord;
    workspaceId: string;
    batchId: string;
    agentModelId?: string;
    approvedPlan: BatchAnalysisPlan;
    result: AgentRunResult;
    summary?: string;
    discoveredWork?: BatchDiscoveredWorkItem[];
  }): Promise<{ workerReport: BatchWorkerExecutionReport; executionCounts: BatchAnalysisExecutionCounts }> {
    const proposalQueue = await this.workspaceRepository.listProposalReviewQueue(params.workspaceId, params.batchId);
    const executedItems = this.buildExecutedItems(params.approvedPlan.items, proposalQueue.queue, params.result);
    await this.workspaceRepository.updateBatchAnalysisPlanItemStatuses({
      workspaceId: params.workspaceId,
      planId: params.approvedPlan.id,
      statuses: executedItems.map((item) => ({
        planItemId: item.planItemId,
        executionStatus: this.mapWorkerItemStatusToPlanStatus(item.status)
      }))
    });
    const executionCounts = this.buildExecutionCountsFromResults(executedItems);
    const discoveredWork = params.discoveredWork ?? [];
    const workerReport: BatchWorkerExecutionReport = {
      id: randomUUID(),
      workspaceId: params.workspaceId,
      batchId: params.batchId,
      iterationId: params.iteration.id,
      iteration: params.iteration.iteration,
      stage: params.result.status === 'ok' ? 'building' : 'reworking',
      role: 'worker',
      summary: params.summary ?? params.result.message ?? `Legacy worker execution finished with status ${params.result.status}.`,
      status:
        params.discoveredWork && params.discoveredWork.length > 0
          ? 'needs_amendment'
          : params.result.status === 'ok'
            ? 'completed'
            : params.result.status === 'canceled'
              ? 'blocked'
              : 'failed',
      planId: params.approvedPlan.id,
      executedItems,
      discoveredWork,
      blockerNotes: params.result.status === 'ok' ? [] : [params.result.message ?? `Worker exited with ${params.result.status}.`],
      createdAtUtc: params.result.endedAtUtc,
      agentModelId: params.agentModelId,
      sessionId: params.result.sessionId
    };
    await this.workspaceRepository.recordBatchWorkerExecutionReport(workerReport);
    return { workerReport, executionCounts };
  }

  private buildExecutionCounts(actions: string[]): BatchAnalysisExecutionCounts {
    const counts: BatchAnalysisExecutionCounts = {
      total: actions.length,
      create: 0,
      edit: 0,
      retire: 0,
      noImpact: 0,
      executed: actions.length,
      blocked: 0,
      rejected: 0
    };
    for (const action of actions) {
      if (action === 'create') {
        counts.create += 1;
      } else if (action === 'edit') {
        counts.edit += 1;
      } else if (action === 'retire') {
        counts.retire += 1;
      } else {
        counts.noImpact += 1;
      }
    }
    return counts;
  }

  private buildExecutionCountsFromResults(
    results: BatchWorkerExecutionReport['executedItems']
  ): BatchAnalysisExecutionCounts {
    const counts: BatchAnalysisExecutionCounts = {
      total: results.length,
      create: 0,
      edit: 0,
      retire: 0,
      noImpact: 0,
      executed: 0,
      blocked: 0,
      rejected: 0
    };
    for (const result of results) {
      if (result.action === 'create') counts.create += 1;
      else if (result.action === 'edit') counts.edit += 1;
      else if (result.action === 'retire') counts.retire += 1;
      else counts.noImpact += 1;

      if (result.status === 'executed') counts.executed += 1;
      if (result.status === 'blocked') counts.blocked += 1;
    }
    return counts;
  }

  private buildExecutedItems(
    planItems: BatchPlanItem[],
    queue: Array<{ proposalId: string; action: string; articleLabel: string }>,
    result: AgentRunResult
  ): BatchWorkerExecutionReport['executedItems'] {
    const remainingQueue = [...queue];
    return planItems.map((item) => {
      if (item.action === 'no_impact') {
        return {
          planItemId: item.planItemId,
          action: item.action,
          targetTitle: item.targetTitle,
          status: result.status === 'ok' ? 'executed' : 'skipped',
          note: 'No-impact item accounted for without proposal execution.'
        };
      }

      if (result.status !== 'ok') {
        return {
          planItemId: item.planItemId,
          action: item.action,
          targetTitle: item.targetTitle,
          status: 'blocked',
          note: result.message ?? `Worker ended with status ${result.status}.`
        };
      }

      const matchIndex = remainingQueue.findIndex((proposal) =>
        proposal.action === item.action && this.normalizeTitle(proposal.articleLabel) === this.normalizeTitle(item.targetTitle)
      );
      if (matchIndex >= 0) {
        const match = remainingQueue.splice(matchIndex, 1)[0];
        return {
          planItemId: item.planItemId,
          action: item.action,
          targetTitle: item.targetTitle,
          status: 'executed',
          proposalId: match.proposalId,
          artifactIds: [match.proposalId],
          note: `Matched proposal review item for ${match.articleLabel}.`
        };
      }

      return {
        planItemId: item.planItemId,
        action: item.action,
        targetTitle: item.targetTitle,
        status: 'blocked',
        note: `No proposal matched approved plan item "${item.targetTitle}".`
      };
    });
  }

  private mapWorkerItemStatusToPlanStatus(status: BatchWorkerExecutionReport['executedItems'][number]['status']): BatchPlanExecutionStatus {
    if (status === 'executed') {
      return 'executed';
    }
    if (status === 'blocked') {
      return 'blocked';
    }
    return 'pending';
  }

  private normalizeTitle(value: string): string {
    return humanizeReadableText(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  buildPlannerPrompt(params: {
    batchContext: unknown;
    uploadedPbis: unknown;
    priorPlan?: BatchAnalysisPlan;
    reviewDelta?: BatchPlanReviewDelta;
    plannerPrefetch?: unknown;
  }): string {
    return [
      'Return only valid JSON.',
      'Create a complete structured batch analysis plan.',
      'Each candidate PBI must be accounted for in coverage.',
      'Use plan items to represent create, edit, retire, or no_impact outcomes.',
      'Do not execute proposals or mutate KB content in this stage.',
      'Use the deterministic planner prefetch first before issuing any KB discovery commands.',
      'If the prefetch already provides enough evidence for a cluster, reuse it instead of repeating zero-result searches.',
      'JSON shape:',
      '{"summary":string,"coverage":[{"pbiId":string,"outcome":"covered"|"gap"|"no_impact"|"blocked","planItemIds":string[],"notes"?:string}],"items":[{"planItemId":string,"pbiIds":string[],"action":"create"|"edit"|"retire"|"no_impact","targetType":"article"|"article_family"|"article_set"|"new_article"|"unknown","targetArticleId"?:string,"targetFamilyId"?:string,"targetTitle":string,"reason":string,"evidence":[{"kind":"pbi"|"article"|"search"|"review"|"transcript"|"other","ref":string,"summary":string}],"confidence":number,"dependsOn"?:string[],"executionStatus":"pending"}],"openQuestions":string[]}',
      'Batch context summary:',
      JSON.stringify(compactBatchContextForPrompt(params.batchContext), null, 2),
      'Uploaded PBI summary:',
      JSON.stringify(compactUploadedPbisForPrompt(params.uploadedPbis), null, 2),
      params.plannerPrefetch ? `Deterministic planner prefetch:\n${JSON.stringify(compactPlannerPrefetchForPrompt(params.plannerPrefetch), null, 2)}` : '',
      params.priorPlan ? `Prior plan summary:\n${JSON.stringify(compactPlanForPrompt(params.priorPlan), null, 2)}` : '',
      params.reviewDelta ? `Reviewer delta summary:\n${JSON.stringify(compactReviewDeltaForPrompt(params.reviewDelta), null, 2)}` : ''
    ].filter(Boolean).join('\n\n');
  }

  buildPlannerRepairPrompt(params: {
    originalPrompt: string;
    priorOutput: string;
    parseError: string;
  }): string {
    return [
      'Return only valid JSON.',
      'Your previous planner response was not valid planner JSON and could not be parsed.',
      `Parser error: ${params.parseError}`,
      'Rewrite the planner answer as complete JSON for the same batch context and JSON shape from the prior message.',
      'Do not add narration, markdown fences, or explanation outside the JSON object.',
      'Previous invalid planner output:',
      params.priorOutput
    ].join('\n\n');
  }

  buildPlanReviewerPrompt(params: {
    batchContext: unknown;
    uploadedPbis: unknown;
    plan: BatchAnalysisPlan;
  }): string {
    return [
      'Return only valid JSON.',
      'Review the submitted batch plan for completeness and correctness.',
      'Actively search for missing article work beyond the submitted plan.',
      'Do not execute proposals or mutate KB content in this stage.',
      'JSON shape:',
      '{"summary":string,"verdict":"approved"|"needs_revision"|"needs_human_review","didAccountForEveryPbi":boolean,"hasMissingCreates":boolean,"hasMissingEdits":boolean,"hasTargetIssues":boolean,"hasOverlapOrConflict":boolean,"foundAdditionalArticleWork":boolean,"underScopedKbImpact":boolean,"delta":{"summary":string,"requestedChanges":string[],"missingPbiIds":string[],"missingCreates":string[],"missingEdits":string[],"additionalArticleWork":string[],"targetCorrections":string[],"overlapConflicts":string[]}}',
      'Batch context summary:',
      JSON.stringify(compactBatchContextForPrompt(params.batchContext), null, 2),
      'Uploaded PBI summary:',
      JSON.stringify(compactUploadedPbisForPrompt(params.uploadedPbis), null, 2),
      'Submitted plan summary:',
      JSON.stringify(compactPlanForPrompt(params.plan), null, 2)
    ].join('\n\n');
  }

  parsePlannerResult(params: {
    workspaceId: string;
    batchId: string;
    iteration: BatchAnalysisIterationRecord;
    resultText: string;
    agentModelId?: string;
    sessionId?: string;
    planVersion: number;
    supersedesPlanId?: string;
  }): BatchAnalysisPlan {
    const parsed = this.parseJsonObject(params.resultText);
    const items = Array.isArray(parsed.items) ? parsed.items as BatchPlanItem[] : [];
    const coverage = Array.isArray(parsed.coverage) ? parsed.coverage as BatchPlanCoverage[] : [];
    if (items.length === 0) {
      throw new Error('Planner returned no plan items');
    }
    if (coverage.length === 0) {
      throw new Error('Planner returned no coverage records');
    }
    return {
      id: randomUUID(),
      workspaceId: params.workspaceId,
      batchId: params.batchId,
      iterationId: params.iteration.id,
      iteration: params.iteration.iteration,
      stage: params.planVersion > 1 ? 'plan_revision' : 'planning',
      role: 'planner',
      verdict: 'draft',
      planVersion: params.planVersion,
      summary: typeof parsed.summary === 'string' ? humanizeReadableText(parsed.summary) : `Plan version ${params.planVersion}`,
      coverage: coverage.map((item) => ({
        ...item,
        notes: typeof item.notes === 'string' ? humanizeReadableText(item.notes) : item.notes
      })),
      items: items.map((item) => ({
        ...item,
        targetTitle: humanizeReadableText(item.targetTitle),
        reason: humanizeReadableText(item.reason),
        evidence: Array.isArray(item.evidence)
          ? item.evidence.map((evidence) => ({
              ...evidence,
              summary: humanizeReadableText(evidence.summary)
            }))
          : []
      })),
      openQuestions: Array.isArray(parsed.openQuestions)
        ? parsed.openQuestions
            .filter((x): x is string => typeof x === 'string')
            .map((question) => humanizeReadableText(question))
        : [],
      createdAtUtc: new Date().toISOString(),
      supersedesPlanId: params.supersedesPlanId,
      agentModelId: params.agentModelId,
      sessionId: params.sessionId
    };
  }

  parsePlanReviewResult(params: {
    workspaceId: string;
    batchId: string;
    iteration: BatchAnalysisIterationRecord;
    plan: BatchAnalysisPlan;
    resultText: string;
    agentModelId?: string;
    sessionId?: string;
  }): BatchPlanReview {
    const parsed = this.parseJsonObject(params.resultText);
    const verdict = parsed.verdict === 'approved' || parsed.verdict === 'needs_human_review' ? parsed.verdict : 'needs_revision';
    return {
      id: randomUUID(),
      workspaceId: params.workspaceId,
      batchId: params.batchId,
      iterationId: params.iteration.id,
      iteration: params.iteration.iteration,
      stage: 'plan_reviewing',
      role: 'plan-reviewer',
      verdict,
      summary: typeof parsed.summary === 'string' ? humanizeReadableText(parsed.summary) : 'Plan review completed.',
      didAccountForEveryPbi: Boolean(parsed.didAccountForEveryPbi),
      hasMissingCreates: Boolean(parsed.hasMissingCreates),
      hasMissingEdits: Boolean(parsed.hasMissingEdits),
      hasTargetIssues: Boolean(parsed.hasTargetIssues),
      hasOverlapOrConflict: Boolean(parsed.hasOverlapOrConflict),
      foundAdditionalArticleWork: Boolean(parsed.foundAdditionalArticleWork),
      underScopedKbImpact: Boolean(parsed.underScopedKbImpact),
      delta: parsed.delta && typeof parsed.delta === 'object'
        ? humanizePlanReviewDelta(parsed.delta as BatchPlanReviewDelta)
        : undefined,
      createdAtUtc: new Date().toISOString(),
      planId: params.plan.id,
      agentModelId: params.agentModelId,
      sessionId: params.sessionId
    };
  }

  buildWorkerPrompt(plan: BatchAnalysisPlan, extraInstructions?: string): string {
    return [
      extraInstructions?.trim() ?? '',
      'Execute only the approved plan items below.',
      'Persist proposal records for create/edit/retire work where warranted.',
      'Do not silently expand scope.',
      'If you discover new missing work, return it in the final JSON under `discoveredWork` and do not execute that new work yet.',
      'Return only JSON with this shape:',
      '{"summary":string,"discoveredWork":[{"discoveryId":string,"discoveredAction":"create"|"edit"|"retire","suspectedTarget":string,"reason":string,"evidence":[{"kind":"pbi"|"article"|"search"|"review"|"transcript"|"other","ref":string,"summary":string}],"linkedPbiIds":string[],"confidence":number,"requiresPlanAmendment":boolean}]}',
      JSON.stringify(compactPlanForPrompt(plan), null, 2)
    ].filter(Boolean).join('\n\n');
  }

  parseWorkerResult(
    resultText: string,
    fallbackSummary: string,
    sessionId: string
  ): { summary: string; discoveredWork: BatchDiscoveredWorkItem[] } {
    if (!resultText.trim()) {
      return { summary: fallbackSummary, discoveredWork: [] };
    }
    const parsed = this.parseJsonObject(resultText);
    const discoveredWork = Array.isArray(parsed.discoveredWork)
      ? (parsed.discoveredWork as Array<Record<string, unknown>>).map((item, index): BatchDiscoveredWorkItem => {
          const discoveredAction: BatchDiscoveredWorkItem['discoveredAction'] =
            item.discoveredAction === 'create' || item.discoveredAction === 'retire'
              ? item.discoveredAction
              : 'edit';
          return {
            discoveryId: typeof item.discoveryId === 'string' ? item.discoveryId : `discovery-${index + 1}`,
            sourceWorkerRunId: sessionId,
            discoveredAction,
            suspectedTarget: typeof item.suspectedTarget === 'string' ? humanizeReadableText(item.suspectedTarget) : 'Unknown target',
            reason: typeof item.reason === 'string' ? humanizeReadableText(item.reason) : 'Worker discovered related scope.',
            evidence: Array.isArray(item.evidence)
              ? (item.evidence as BatchDiscoveredWorkItem['evidence']).map((evidence) => ({
                  ...evidence,
                  summary: humanizeReadableText(evidence.summary)
                }))
              : [],
            linkedPbiIds: Array.isArray(item.linkedPbiIds) ? item.linkedPbiIds.filter((x): x is string => typeof x === 'string') : [],
            confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
            requiresPlanAmendment: item.requiresPlanAmendment !== false,
            status: 'pending_review'
          };
        })
      : [];
    return {
      summary: typeof parsed.summary === 'string' ? humanizeReadableText(parsed.summary) : fallbackSummary,
      discoveredWork
    };
  }

  buildAmendmentPlannerPrompt(params: {
    batchContext: unknown;
    uploadedPbis: unknown;
    approvedPlan: BatchAnalysisPlan;
    discoveredWork: BatchDiscoveredWorkItem[];
    plannerPrefetch?: unknown;
  }): string {
    return this.buildPlannerPrompt({
      batchContext: params.batchContext,
      uploadedPbis: params.uploadedPbis,
      plannerPrefetch: params.plannerPrefetch,
      priorPlan: params.approvedPlan,
      reviewDelta: {
        summary: 'Worker discovered additional scope requiring amendment review.',
        requestedChanges: params.discoveredWork.map((item) => item.reason),
        missingPbiIds: [],
        missingCreates: params.discoveredWork.filter((item) => item.discoveredAction === 'create').map((item) => item.suspectedTarget),
        missingEdits: params.discoveredWork.filter((item) => item.discoveredAction === 'edit').map((item) => item.suspectedTarget),
        additionalArticleWork: params.discoveredWork.map((item) => item.suspectedTarget),
        targetCorrections: [],
        overlapConflicts: []
      }
    });
  }

  buildFinalReviewerPrompt(params: {
    batchContext: unknown;
    uploadedPbis: unknown;
    approvedPlan: BatchAnalysisPlan;
    workerReport: BatchWorkerExecutionReport;
    discoveredWork: BatchDiscoveredWorkItem[];
  }): string {
    return [
      'Return only valid JSON.',
      'You are the final reviewer for the batch.',
      'Decide whether the resulting outputs fully satisfy the PBIs and approved plan.',
      'If rework is needed, return a structured rework delta and do not approve the batch.',
      'JSON shape:',
      '{"summary":string,"verdict":"approved"|"needs_rework"|"needs_human_review","allPbisMapped":boolean,"planExecutionComplete":boolean,"hasMissingArticleChanges":boolean,"hasUnresolvedDiscoveredWork":boolean,"delta":{"summary":string,"requestedRework":string[],"uncoveredPbiIds":string[],"missingArticleChanges":string[],"duplicateRiskTitles":string[],"unnecessaryChanges":string[],"unresolvedAmbiguities":string[]}}',
      'Batch context summary:',
      JSON.stringify(compactBatchContextForPrompt(params.batchContext), null, 2),
      'Uploaded PBI summary:',
      JSON.stringify(compactUploadedPbisForPrompt(params.uploadedPbis), null, 2),
      'Approved plan summary:',
      JSON.stringify(compactPlanForPrompt(params.approvedPlan), null, 2),
      'Worker report summary:',
      JSON.stringify(compactWorkerReportForPrompt(params.workerReport), null, 2),
      'Outstanding discovered work summary:',
      JSON.stringify(compactDiscoveredWorkForPrompt(params.discoveredWork), null, 2)
    ].join('\n\n');
  }

  parseFinalReviewResult(params: {
    workspaceId: string;
    batchId: string;
    iteration: BatchAnalysisIterationRecord;
    planId: string;
    workerReportId: string;
    resultText: string;
    agentModelId?: string;
    sessionId?: string;
  }): BatchFinalReview {
    const parsed = this.parseJsonObject(params.resultText);
    const verdict = parsed.verdict === 'approved' || parsed.verdict === 'needs_human_review' ? parsed.verdict : 'needs_rework';
    return {
      id: randomUUID(),
      workspaceId: params.workspaceId,
      batchId: params.batchId,
      iterationId: params.iteration.id,
      iteration: params.iteration.iteration,
      stage: 'final_reviewing',
      role: 'final-reviewer',
      verdict,
      summary: typeof parsed.summary === 'string' ? humanizeReadableText(parsed.summary) : 'Final review completed.',
      allPbisMapped: Boolean(parsed.allPbisMapped),
      planExecutionComplete: Boolean(parsed.planExecutionComplete),
      hasMissingArticleChanges: Boolean(parsed.hasMissingArticleChanges),
      hasUnresolvedDiscoveredWork: Boolean(parsed.hasUnresolvedDiscoveredWork),
      delta: parsed.delta && typeof parsed.delta === 'object'
        ? humanizeFinalReviewDelta(parsed.delta as BatchFinalReviewDelta)
        : undefined,
      createdAtUtc: new Date().toISOString(),
      planId: params.planId,
      workerReportId: params.workerReportId,
      agentModelId: params.agentModelId,
      sessionId: params.sessionId
    };
  }

  validateApprovedPlan(plan: BatchAnalysisPlan): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const planItemIds = new Set(plan.items.map((item) => item.planItemId));
    if (plan.coverage.length === 0) {
      reasons.push('Approved plan has no PBI coverage records.');
    }
    for (const coverage of plan.coverage) {
      if (!coverage.pbiId?.trim()) {
        reasons.push('Approved plan contains a coverage record without a PBI id.');
      }
      if (coverage.outcome === 'gap') {
        reasons.push(`PBI ${coverage.pbiId} is still marked as a gap.`);
      }
      for (const planItemId of coverage.planItemIds) {
        if (!planItemIds.has(planItemId)) {
          reasons.push(`Coverage for PBI ${coverage.pbiId} references missing plan item ${planItemId}.`);
        }
      }
    }
    return { ok: reasons.length === 0, reasons };
  }

  validateWorkerReport(plan: BatchAnalysisPlan, report: BatchWorkerExecutionReport): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const itemResults = new Map(report.executedItems.map((item) => [item.planItemId, item]));
    for (const planItem of plan.items) {
      const result = itemResults.get(planItem.planItemId);
      if (!result) {
        reasons.push(`Approved plan item ${planItem.planItemId} has no worker execution result.`);
        continue;
      }
      if (result.status === 'skipped' && planItem.action !== 'no_impact') {
        reasons.push(`Approved plan item ${planItem.planItemId} was skipped without being no-impact.`);
      }
    }
    if (report.executedItems.length !== plan.items.length) {
      reasons.push(`Worker report execution count ${report.executedItems.length} does not match approved plan item count ${plan.items.length}.`);
    }
    return { ok: reasons.length === 0, reasons };
  }

  validateFinalApproval(params: {
    plan: BatchAnalysisPlan;
    workerReport: BatchWorkerExecutionReport;
    finalReview: BatchFinalReview;
  }): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const planValidation = this.validateApprovedPlan(params.plan);
    const workerValidation = this.validateWorkerReport(params.plan, params.workerReport);
    reasons.push(...planValidation.reasons, ...workerValidation.reasons);

    if (!params.finalReview.allPbisMapped) {
      reasons.push('Final review cannot approve while PBIs remain unmapped.');
    }
    if (!params.finalReview.planExecutionComplete) {
      reasons.push('Final review cannot approve while plan execution is incomplete.');
    }
    if (params.finalReview.hasUnresolvedDiscoveredWork) {
      reasons.push('Final review cannot approve while unresolved discovered work remains.');
    }
    if (params.finalReview.hasMissingArticleChanges) {
      reasons.push('Final review cannot approve while missing article changes remain.');
    }

    const unresolvedDiscoveries = params.workerReport.discoveredWork.filter((item) => item.requiresPlanAmendment && item.status !== 'approved' && item.status !== 'rejected');
    if (unresolvedDiscoveries.length > 0) {
      reasons.push(`Final approval blocked by ${unresolvedDiscoveries.length} unresolved discovered work item(s).`);
    }

    const nonTerminalItems = params.workerReport.executedItems.filter((item) => item.status !== 'executed' && item.status !== 'blocked' && item.status !== 'skipped');
    if (nonTerminalItems.length > 0) {
      reasons.push('Final approval blocked by non-terminal worker item statuses.');
    }

    return { ok: reasons.length === 0, reasons };
  }

  async completeIteration(params: {
    workspaceId: string;
    iterationId: string;
    stage: BatchAnalysisIterationRecord['stage'];
    role: BatchAnalysisIterationRecord['role'];
    status: BatchAnalysisIterationRecord['status'];
    summary: string;
    agentModelId?: string;
    sessionId?: string;
    approvedPlanId?: string;
    lastReviewVerdict?: BatchPlanReview['verdict'];
    outstandingDiscoveredWorkCount?: number;
    executionCounts: BatchAnalysisExecutionCounts;
    endedAtUtc?: string;
  }): Promise<BatchAnalysisIterationRecord> {
    const iteration = await this.workspaceRepository.updateBatchAnalysisIteration({
      workspaceId: params.workspaceId,
      iterationId: params.iterationId,
      stage: params.stage,
      role: params.role,
      status: params.status,
      summary: params.summary,
      agentModelId: params.agentModelId,
      sessionId: params.sessionId,
      approvedPlanId: params.approvedPlanId,
      lastReviewVerdict: params.lastReviewVerdict,
      outstandingDiscoveredWorkCount: params.outstandingDiscoveredWorkCount,
      executionCounts: params.executionCounts,
      endedAtUtc: params.endedAtUtc
    });
    await this.workspaceRepository.recordBatchAnalysisStageEvent({
      id: randomUUID(),
      workspaceId: iteration.workspaceId,
      batchId: iteration.batchId,
      iterationId: iteration.id,
      iteration: iteration.iteration,
      stage: iteration.stage,
      role: iteration.role,
      eventType: 'iteration_completed',
      status: iteration.status,
      summary: iteration.summary,
      sessionId: iteration.sessionId,
      agentModelId: iteration.agentModelId,
      approvedPlanId: iteration.approvedPlanId,
      lastReviewVerdict: iteration.lastReviewVerdict,
      outstandingDiscoveredWorkCount: iteration.outstandingDiscoveredWorkCount,
      executionCounts: iteration.executionCounts,
      createdAtUtc: iteration.endedAtUtc ?? iteration.updatedAtUtc
    });
    return iteration;
  }

  private parseJsonObject(value: string): Record<string, unknown> {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error('Agent returned empty output');
    }

    const candidates = new Set<string>([trimmed]);
    for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
      const candidate = match[1]?.trim();
      if (candidate) {
        candidates.add(candidate);
      }
    }

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate) as Record<string, unknown>;
      } catch {
        const extracted = this.extractFirstJsonObject(candidate);
        if (!extracted) {
          continue;
        }
        try {
          return JSON.parse(extracted) as Record<string, unknown>;
        } catch {
          continue;
        }
      }
    }

    throw new Error('Agent did not return valid JSON');
  }

  private extractFirstJsonObject(value: string): string | null {
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{') {
        if (depth === 0) {
          start = index;
        }
        depth += 1;
        continue;
      }

      if (char !== '}' || depth === 0) {
        continue;
      }

      depth -= 1;
      if (depth === 0 && start >= 0) {
        return value.slice(start, index + 1);
      }
    }

    return null;
  }
}

function compactBatchContextForPrompt(batchContext: unknown): Record<string, unknown> {
  if (!batchContext || typeof batchContext !== 'object') {
    return { available: false };
  }

  const record = batchContext as Record<string, unknown>;
  const batch = record.batch && typeof record.batch === 'object'
    ? record.batch as Record<string, unknown>
    : record;

  return {
    batchId: batch.id ?? record.batchId ?? null,
    workspaceId: batch.workspaceId ?? record.workspaceId ?? null,
    name: batch.name ?? record.name ?? null,
    sourceFileName: batch.sourceFileName ?? null,
    sourceFormat: batch.sourceFormat ?? null,
    status: batch.status ?? record.status ?? null,
    sourceRowCount: batch.sourceRowCount ?? null,
    candidateRowCount: batch.candidateRowCount ?? countArray(record.candidateRows),
    scopedRowCount: batch.scopedRowCount ?? null,
    ignoredRowCount: batch.ignoredRowCount ?? countArray(record.ignoredRows),
    malformedRowCount: batch.malformedRowCount ?? countArray(record.malformedRows),
    duplicateRowCount: batch.duplicateRowCount ?? countArray(record.duplicateRows)
  };
}

function compactUploadedPbisForPrompt(uploadedPbis: unknown): Array<Record<string, unknown>> {
  const rows = Array.isArray(uploadedPbis)
    ? uploadedPbis
    : uploadedPbis && typeof uploadedPbis === 'object' && Array.isArray((uploadedPbis as { rows?: unknown[] }).rows)
      ? (uploadedPbis as { rows: unknown[] }).rows
      : [];

  return rows.map((row) => compactPbiForPrompt(row)).filter((row) => Object.keys(row).length > 0);
}

function compactPbiForPrompt(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== 'object') {
    return {};
  }

  const record = row as Record<string, unknown>;
  const titlePath = [record.title1, record.title2, record.title3]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return {
    pbiId: record.id ?? null,
    externalId: record.externalId ?? null,
    sourceRowNumber: record.sourceRowNumber ?? null,
    title: record.title ?? null,
    titlePath,
    description: truncatePromptText(record.descriptionText, 220),
    acceptanceCriteria: truncatePromptText(record.acceptanceCriteriaText, 320),
    parentExternalId: record.parentExternalId ?? null
  };
}

function compactPlanForPrompt(plan: BatchAnalysisPlan): Record<string, unknown> {
  return {
    planId: plan.id,
    verdict: plan.verdict,
    planVersion: plan.planVersion,
    summary: plan.summary,
    coverage: plan.coverage.map((item) => ({
      pbiId: item.pbiId,
      outcome: item.outcome,
      planItemIds: item.planItemIds,
      notes: truncatePromptText(item.notes, 160)
    })),
    items: plan.items.map((item) => ({
      planItemId: item.planItemId,
      pbiIds: item.pbiIds,
      action: item.action,
      targetType: item.targetType,
      targetArticleId: item.targetArticleId ?? null,
      targetFamilyId: item.targetFamilyId ?? null,
      targetTitle: item.targetTitle,
      reason: truncatePromptText(item.reason, 220),
      evidence: item.evidence.map((evidence) => ({
        kind: evidence.kind,
        ref: evidence.ref,
        summary: truncatePromptText(evidence.summary, 120)
      })),
      confidence: item.confidence,
      dependsOn: item.dependsOn ?? [],
      executionStatus: item.executionStatus
    })),
    openQuestions: plan.openQuestions
  };
}

function compactReviewDeltaForPrompt(delta: BatchPlanReviewDelta): Record<string, unknown> {
  return {
    summary: truncatePromptText(delta.summary, 220),
    requestedChanges: delta.requestedChanges.slice(0, 20).map((item) => truncatePromptText(item, 140)),
    missingPbiIds: delta.missingPbiIds,
    missingCreates: delta.missingCreates.slice(0, 20).map((item) => truncatePromptText(item, 140)),
    missingEdits: delta.missingEdits.slice(0, 20).map((item) => truncatePromptText(item, 140)),
    additionalArticleWork: delta.additionalArticleWork.slice(0, 20).map((item) => truncatePromptText(item, 140)),
    targetCorrections: delta.targetCorrections.slice(0, 20).map((item) => truncatePromptText(item, 140)),
    overlapConflicts: delta.overlapConflicts.slice(0, 20).map((item) => truncatePromptText(item, 140))
  };
}

function compactPlannerPrefetchForPrompt(prefetch: unknown): Record<string, unknown> {
  if (!prefetch || typeof prefetch !== 'object') {
    return { available: false };
  }

  const record = prefetch as {
    priorAnalysis?: {
      latestPlanSummary?: string;
      latestApprovedPlanSummary?: string;
      latestReviewVerdict?: string;
      latestFinalVerdict?: string;
    };
    topicClusters?: Array<{
      clusterId?: string;
      label?: string;
      pbiIds?: string[];
      sampleTitles?: string[];
      queries?: string[];
    }>;
    articleMatches?: Array<{
      clusterId?: string;
      query?: string;
      total?: number;
      topResults?: Array<{
        title?: string;
        familyId?: string;
        localeVariantId?: string;
        score?: number;
        matchContext?: string;
        snippet?: string;
      }>;
    }>;
    relationMatches?: Array<{
      title?: string;
      familyId?: string;
      strengthScore?: number;
      relationType?: string;
      evidence?: string[];
    }>;
  };

  return {
    priorAnalysis: record.priorAnalysis ?? null,
    topicClusters: Array.isArray(record.topicClusters)
      ? record.topicClusters.slice(0, 20).map((cluster) => ({
          clusterId: cluster.clusterId ?? null,
          label: cluster.label ?? null,
          pbiIds: Array.isArray(cluster.pbiIds) ? cluster.pbiIds : [],
          sampleTitles: Array.isArray(cluster.sampleTitles) ? cluster.sampleTitles.slice(0, 4) : [],
          queries: Array.isArray(cluster.queries) ? cluster.queries.slice(0, 4) : []
        }))
      : [],
    articleMatches: Array.isArray(record.articleMatches)
      ? record.articleMatches.slice(0, 40).map((match) => ({
          clusterId: match.clusterId ?? null,
          query: match.query ?? null,
          total: match.total ?? 0,
          topResults: Array.isArray(match.topResults)
            ? match.topResults.slice(0, 3).map((result) => ({
                title: result.title ?? null,
                familyId: result.familyId ?? null,
                localeVariantId: result.localeVariantId ?? null,
                score: result.score ?? null,
                matchContext: result.matchContext ?? null,
                snippet: truncatePromptText(result.snippet, 160)
              }))
            : []
        }))
      : [],
    relationMatches: Array.isArray(record.relationMatches)
      ? record.relationMatches.slice(0, 12).map((match) => ({
          title: match.title ?? null,
          familyId: match.familyId ?? null,
          strengthScore: match.strengthScore ?? null,
          relationType: match.relationType ?? null,
          evidence: Array.isArray(match.evidence) ? match.evidence.slice(0, 3).map((item) => truncatePromptText(item, 140)) : []
        }))
      : []
  };
}

function compactWorkerReportForPrompt(report: BatchWorkerExecutionReport): Record<string, unknown> {
  return {
    workerReportId: report.id,
    summary: report.summary,
    status: report.status,
    planId: report.planId ?? null,
    executedItems: report.executedItems.map((item) => ({
      planItemId: item.planItemId,
      action: item.action,
      targetTitle: item.targetTitle,
      status: item.status,
      proposalId: item.proposalId ?? null,
      note: truncatePromptText(item.note, 140)
    })),
    blockerNotes: report.blockerNotes.map((item) => truncatePromptText(item, 180)),
    discoveredWork: compactDiscoveredWorkForPrompt(report.discoveredWork)
  };
}

function compactDiscoveredWorkForPrompt(items: BatchDiscoveredWorkItem[]): Array<Record<string, unknown>> {
  return items.map((item) => ({
    discoveryId: item.discoveryId,
    discoveredAction: item.discoveredAction,
    suspectedTarget: item.suspectedTarget,
    reason: truncatePromptText(item.reason, 180),
    linkedPbiIds: item.linkedPbiIds,
    confidence: item.confidence,
    requiresPlanAmendment: item.requiresPlanAmendment,
    status: item.status,
    evidence: item.evidence.map((evidence) => ({
      kind: evidence.kind,
      ref: evidence.ref,
      summary: truncatePromptText(evidence.summary, 100)
    }))
  }));
}

const HUMANIZE_DICTIONARY = new Set([
  'a', 'about', 'accounted', 'action', 'adjacent', 'after', 'all', 'already', 'an', 'and', 'any', 'appears',
  'article', 'articles', 'assessed', 'at', 'authored', 'back', 'batch', 'behavior', 'broader', 'by', 'candidate',
  'change', 'changes', 'click', 'cluster', 'confirm', 'confirmed', 'content', 'context', 'coverage', 'covered',
  'create', 'created', 'creation', 'criteria', 'cross', 'current', 'currently', 'dedicated', 'delete', 'describe',
  'describes', 'deterministic', 'did', 'direct', 'discovery', 'distinct', 'documented', 'do', 'does', 'duplicate',
  'duplicated', 'duplicating', 'editing', 'edit', 'embedding', 'evidence', 'eventual', 'exact', 'existing',
  'expected',
  'execute', 'execution', 'family', 'feature', 'field', 'fields', 'file', 'final', 'find', 'flow', 'focused',
  'food', 'for', 'found', 'from', 'fully', 'grouped', 'has', 'have', 'if', 'impact', 'in', 'incomplete',
  'indicating', 'indexing', 'inside', 'insert', 'into', 'is', 'it', 'item', 'items', 'justification', 'kb', 'later',
  'legacy', 'likely', 'limit', 'limited', 'link', 'links', 'list', 'lists', 'load', 'lookup', 'main', 'manage',
  'management', 'manual', 'match', 'matched', 'matches', 'menu', 'mention', 'mode', 'name', 'named', 'nearby',
  'new', 'no', 'not', 'of', 'on', 'one', 'only', 'open', 'opens', 'option', 'or', 'outside', 'path', 'pending',
  'pbi', 'permission', 'plan', 'planner', 'portal', 'prefetch', 'prefilled', 'prefill', 'proposal', 'published',
  'queries', 'question', 'questions', 'reason', 'reference', 'related', 'relations', 'relevant', 'rename', 'reopen',
  'report', 'request', 'results', 'review', 'reviewed', 'returned', 'save', 'scope', 'search', 'seeded', 'select',
  'set', 'should', 'show', 'shows', 'side', 'single', 'space', 'sheet', 'stage', 'standalone', 'stay', 'strongest',
  'sufficient', 'summary', 'surfaced', 'table', 'target', 'task', 'text', 'that', 'the', 'their', 'there', 'this',
  'title', 'to', 'treat', 'two', 'ui', 'under', 'unless', 'user', 'using', 'variant', 'variants', 'versus', 'was',
  'were', 'while', 'with', 'work', 'worker', 'workflow', 'workflows', 'workspace'
]);

const HUMANIZE_ACRONYMS = new Map([
  ['api', 'API'],
  ['html', 'HTML'],
  ['id', 'ID'],
  ['json', 'JSON'],
  ['kb', 'KB'],
  ['pbi', 'PBI'],
  ['ui', 'UI']
]);

function humanizeReadableText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized || /<\/?[a-z][\s\S]*>/i.test(normalized) || normalized.includes('http://') || normalized.includes('https://')) {
    return normalized;
  }

  return normalized
    .split(/(`[^`]*`)/g)
    .map((part) => {
      if (!part || part.startsWith('`')) {
        return part;
      }
      return humanizeReadableSegment(part);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();
}

function humanizeReadableSegment(value: string): string {
  const aggressive = shouldAggressivelyHumanize(value);
  const withAcronymBoundaries = Array.from(HUMANIZE_ACRONYMS.values()).reduce(
    (text, acronym) => text
      .replace(new RegExp(`(${acronym}s)([A-Z][a-z])`, 'g'), '$1 $2')
      .replace(new RegExp(`(${acronym}s)([a-z]{2,})`, 'g'), '$1 $2')
      .replace(new RegExp(`(${acronym})([A-Z][a-z])`, 'g'), '$1 $2')
      .replace(new RegExp(`(${acronym})([a-z]{2,})`, 'g'), '$1 $2'),
    value
  );

  const withBoundaries = withAcronymBoundaries
    .replace(/([.?!,:;])([A-Za-z])/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2');

  return withBoundaries
    .split(/(\s+|[-/()"':;,.!?]+)/)
    .map((part) => humanizeReadableToken(part, aggressive))
    .join('');
}

function shouldAggressivelyHumanize(value: string): boolean {
  const collapsedTokens = value.match(/[A-Za-z]{12,}/g) ?? [];
  if (collapsedTokens.length === 0) {
    return false;
  }
  const whitespaceCount = (value.match(/\s/g) ?? []).length;
  return whitespaceCount <= Math.max(2, Math.floor(value.length * 0.12))
    || collapsedTokens.some((token) => token.length >= 16);
}

function humanizeReadableToken(token: string, aggressive: boolean): string {
  if (!token || !/[A-Za-z]/.test(token) || /\s+/.test(token) || /[-/()"':;,.!?]+/.test(token)) {
    return token;
  }
  if (!/^[A-Za-z]+$/.test(token)) {
    return token;
  }
  if (!aggressive || token.length < 12) {
    return token;
  }

  const lower = token.toLowerCase();
  const segmented = segmentCollapsedWord(lower);
  if (!segmented) {
    return token;
  }

  const words = segmented.split(' ').map((word, index) => {
    const acronym = HUMANIZE_ACRONYMS.get(word);
    if (acronym) {
      return acronym;
    }
    if (index === 0 && /^[A-Z]/.test(token)) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
    return word;
  });
  return words.join(' ');
}

function segmentCollapsedWord(value: string): string | null {
  if (value.length < 12 || !/^[a-z]+$/.test(value)) {
    return null;
  }

  const best: Array<{ score: number; words: string[] } | null> = Array(value.length + 1).fill(null);
  best[0] = { score: 0, words: [] };

  for (let start = 0; start < value.length; start += 1) {
    const current = best[start];
    if (!current) {
      continue;
    }
    for (let end = start + 1; end <= Math.min(value.length, start + 24); end += 1) {
      const part = value.slice(start, end);
      const isKnown = HUMANIZE_DICTIONARY.has(part);
      const partScore = isKnown
        ? (part.length * part.length) + 8
        : part.length <= 2
          ? -100
          : part.length === 3
            ? -24
            : -(part.length * 4);
      const nextScore = current.score + partScore;
      const existing = best[end];
      if (!existing || nextScore > existing.score) {
        best[end] = {
          score: nextScore,
          words: [...current.words, part]
        };
      }
    }
  }

  const result = best[value.length];
  if (!result || result.words.length < 2) {
    return null;
  }

  const knownChars = result.words.filter((word) => HUMANIZE_DICTIONARY.has(word)).join('').length;
  const unknownWords = result.words.filter((word) => !HUMANIZE_DICTIONARY.has(word));
  if (knownChars < Math.floor(value.length * 0.72)) {
    return null;
  }
  if (unknownWords.some((word) => word.length < 4)) {
    return null;
  }
  if (unknownWords.length > 1) {
    return null;
  }

  return result.words.join(' ');
}

function humanizePlanReviewDelta(delta: BatchPlanReviewDelta): BatchPlanReviewDelta {
  return {
    summary: humanizeReadableText(delta.summary),
    requestedChanges: delta.requestedChanges.map((item) => humanizeReadableText(item)),
    missingPbiIds: delta.missingPbiIds,
    missingCreates: delta.missingCreates.map((item) => humanizeReadableText(item)),
    missingEdits: delta.missingEdits.map((item) => humanizeReadableText(item)),
    additionalArticleWork: delta.additionalArticleWork.map((item) => humanizeReadableText(item)),
    targetCorrections: delta.targetCorrections.map((item) => humanizeReadableText(item)),
    overlapConflicts: delta.overlapConflicts.map((item) => humanizeReadableText(item))
  };
}

function humanizeFinalReviewDelta(delta: BatchFinalReviewDelta): BatchFinalReviewDelta {
  return {
    summary: humanizeReadableText(delta.summary),
    requestedRework: delta.requestedRework.map((item) => humanizeReadableText(item)),
    uncoveredPbiIds: delta.uncoveredPbiIds,
    missingArticleChanges: delta.missingArticleChanges.map((item) => humanizeReadableText(item)),
    duplicateRiskTitles: delta.duplicateRiskTitles.map((item) => humanizeReadableText(item)),
    unnecessaryChanges: delta.unnecessaryChanges.map((item) => humanizeReadableText(item)),
    unresolvedAmbiguities: delta.unresolvedAmbiguities.map((item) => humanizeReadableText(item))
  };
}

function truncatePromptText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}
