import { expect, test } from '@playwright/test';
import type {
  BatchAnalysisExecutionCounts,
  BatchAnalysisStageEventRecord,
  BatchAnalysisTimelineEntry,
} from '@kb-vault/shared-types';
import { buildTimelineEntriesWithSkippedStages } from '../src/renderer/src/components/batch-analysis/helpers';

const EMPTY_COUNTS: BatchAnalysisExecutionCounts = {
  total: 0,
  create: 0,
  edit: 0,
  retire: 0,
  noImpact: 0,
  executed: 0,
  blocked: 0,
  pending: 0,
};

function createTimelineEntry(
  overrides: Partial<BatchAnalysisTimelineEntry> & Pick<BatchAnalysisTimelineEntry, 'artifactType' | 'artifactId' | 'stage' | 'role' | 'createdAtUtc'>,
): BatchAnalysisTimelineEntry {
  return {
    iterationId: 'iter-1',
    iteration: 1,
    ...overrides,
  };
}

function createStageEvent(
  overrides: Partial<BatchAnalysisStageEventRecord> & Pick<BatchAnalysisStageEventRecord, 'id' | 'stage' | 'role' | 'eventType' | 'createdAtUtc'>,
): BatchAnalysisStageEventRecord {
  return {
    workspaceId: 'workspace-1',
    batchId: 'batch-1',
    iterationId: 'iter-1',
    iteration: 1,
    status: 'running',
    outstandingDiscoveredWorkCount: 0,
    executionCounts: EMPTY_COUNTS,
    ...overrides,
  };
}

test.describe('batch analysis timeline skipped-stage synthesis', () => {
  test('falls back to timeline entries when stage events are unavailable', () => {
    const entries: BatchAnalysisTimelineEntry[] = [
      createTimelineEntry({
        artifactType: 'iteration',
        artifactId: 'iter-1',
        stage: 'planning',
        role: 'planner',
        createdAtUtc: '2026-04-17T12:00:00.000Z',
      }),
      createTimelineEntry({
        artifactType: 'review',
        artifactId: 'review-1',
        stage: 'plan_reviewing',
        role: 'plan-reviewer',
        createdAtUtc: '2026-04-17T12:01:00.000Z',
      }),
      createTimelineEntry({
        artifactType: 'worker_report',
        artifactId: 'worker-1',
        stage: 'building',
        role: 'worker',
        createdAtUtc: '2026-04-17T12:02:00.000Z',
      }),
    ];

    const timeline = buildTimelineEntriesWithSkippedStages(entries, []);
    const skippedStages = timeline
      .filter((entry) => 'syntheticKind' in entry && entry.syntheticKind === 'skipped_stage')
      .map((entry) => entry.stage);

    expect(skippedStages).toEqual(['awaiting_user_input', 'plan_revision']);
  });

  test('inserts skipped waiting and revision stages before building starts', () => {
    const entries: BatchAnalysisTimelineEntry[] = [
      createTimelineEntry({
        artifactType: 'plan',
        artifactId: 'plan-1',
        stage: 'planning',
        role: 'planner',
        createdAtUtc: '2026-04-17T12:00:10.000Z',
      }),
      createTimelineEntry({
        artifactType: 'review',
        artifactId: 'review-1',
        stage: 'plan_reviewing',
        role: 'plan-reviewer',
        createdAtUtc: '2026-04-17T12:01:10.000Z',
      }),
      createTimelineEntry({
        artifactType: 'worker_report',
        artifactId: 'worker-1',
        stage: 'building',
        role: 'worker',
        createdAtUtc: '2026-04-17T12:02:10.000Z',
      }),
    ];
    const stageEvents: BatchAnalysisStageEventRecord[] = [
      createStageEvent({
        id: 'evt-1',
        stage: 'planning',
        role: 'planner',
        eventType: 'iteration_started',
        createdAtUtc: '2026-04-17T12:00:00.000Z',
      }),
      createStageEvent({
        id: 'evt-2',
        stage: 'plan_reviewing',
        role: 'plan-reviewer',
        eventType: 'stage_transition',
        createdAtUtc: '2026-04-17T12:01:00.000Z',
      }),
      createStageEvent({
        id: 'evt-3',
        stage: 'building',
        role: 'worker',
        eventType: 'stage_transition',
        createdAtUtc: '2026-04-17T12:02:00.000Z',
      }),
    ];

    const timeline = buildTimelineEntriesWithSkippedStages(entries, stageEvents);
    const skippedStages = timeline
      .filter((entry) => 'syntheticKind' in entry && entry.syntheticKind === 'skipped_stage')
      .map((entry) => entry.stage);

    expect(skippedStages).toEqual(['awaiting_user_input', 'plan_revision']);
  });

  test('inserts skipped rework before direct approval from final review', () => {
    const entries: BatchAnalysisTimelineEntry[] = [
      createTimelineEntry({
        artifactType: 'final_review',
        artifactId: 'final-1',
        stage: 'final_reviewing',
        role: 'final-reviewer',
        createdAtUtc: '2026-04-17T12:03:10.000Z',
      }),
      createTimelineEntry({
        artifactType: 'iteration',
        artifactId: 'iter-1',
        stage: 'approved',
        role: 'final-reviewer',
        createdAtUtc: '2026-04-17T12:04:10.000Z',
      }),
    ];
    const stageEvents: BatchAnalysisStageEventRecord[] = [
      createStageEvent({
        id: 'evt-1',
        stage: 'final_reviewing',
        role: 'final-reviewer',
        eventType: 'stage_transition',
        createdAtUtc: '2026-04-17T12:03:00.000Z',
      }),
      createStageEvent({
        id: 'evt-2',
        stage: 'approved',
        role: 'final-reviewer',
        eventType: 'iteration_completed',
        createdAtUtc: '2026-04-17T12:04:00.000Z',
      }),
    ];

    const timeline = buildTimelineEntriesWithSkippedStages(entries, stageEvents);
    const skippedStages = timeline
      .filter((entry) => 'syntheticKind' in entry && entry.syntheticKind === 'skipped_stage')
      .map((entry) => entry.stage);

    expect(skippedStages).toEqual(['reworking']);
  });

  test('does not invent skipped stages when the flow loops back through rework', () => {
    const entries: BatchAnalysisTimelineEntry[] = [
      createTimelineEntry({
        artifactType: 'final_review',
        artifactId: 'final-1',
        stage: 'final_reviewing',
        role: 'final-reviewer',
        createdAtUtc: '2026-04-17T12:03:10.000Z',
      }),
      createTimelineEntry({
        artifactType: 'worker_report',
        artifactId: 'worker-2',
        stage: 'reworking',
        role: 'worker',
        createdAtUtc: '2026-04-17T12:04:10.000Z',
      }),
      createTimelineEntry({
        artifactType: 'final_review',
        artifactId: 'final-2',
        stage: 'final_reviewing',
        role: 'final-reviewer',
        createdAtUtc: '2026-04-17T12:05:10.000Z',
      }),
    ];
    const stageEvents: BatchAnalysisStageEventRecord[] = [
      createStageEvent({
        id: 'evt-1',
        stage: 'final_reviewing',
        role: 'final-reviewer',
        eventType: 'stage_transition',
        createdAtUtc: '2026-04-17T12:03:00.000Z',
      }),
      createStageEvent({
        id: 'evt-2',
        stage: 'reworking',
        role: 'worker',
        eventType: 'stage_transition',
        createdAtUtc: '2026-04-17T12:04:00.000Z',
      }),
      createStageEvent({
        id: 'evt-3',
        stage: 'final_reviewing',
        role: 'final-reviewer',
        eventType: 'stage_transition',
        createdAtUtc: '2026-04-17T12:05:00.000Z',
      }),
    ];

    const timeline = buildTimelineEntriesWithSkippedStages(entries, stageEvents);
    const skippedEntries = timeline.filter((entry) => 'syntheticKind' in entry && entry.syntheticKind === 'skipped_stage');

    expect(skippedEntries).toEqual([]);
  });

  test('uses timeline entries to recover skipped stages when the event stream is truncated', () => {
    const entries: BatchAnalysisTimelineEntry[] = [
      createTimelineEntry({
        artifactType: 'iteration',
        artifactId: 'iter-1',
        stage: 'planning',
        role: 'planner',
        createdAtUtc: '2026-04-17T12:00:00.000Z',
      }),
      createTimelineEntry({
        artifactType: 'review',
        artifactId: 'review-1',
        stage: 'plan_reviewing',
        role: 'plan-reviewer',
        createdAtUtc: '2026-04-17T12:01:00.000Z',
      }),
      createTimelineEntry({
        artifactType: 'worker_report',
        artifactId: 'worker-1',
        stage: 'building',
        role: 'worker',
        createdAtUtc: '2026-04-17T12:02:00.000Z',
      }),
      createTimelineEntry({
        artifactType: 'final_review',
        artifactId: 'final-1',
        stage: 'final_reviewing',
        role: 'final-reviewer',
        createdAtUtc: '2026-04-17T12:03:00.000Z',
      }),
      createTimelineEntry({
        artifactType: 'iteration',
        artifactId: 'iter-1-complete',
        stage: 'approved',
        role: 'final-reviewer',
        createdAtUtc: '2026-04-17T12:04:00.000Z',
      }),
    ];
    const truncatedStageEvents: BatchAnalysisStageEventRecord[] = [
      createStageEvent({
        id: 'evt-final',
        stage: 'final_reviewing',
        role: 'final-reviewer',
        eventType: 'stage_transition',
        createdAtUtc: '2026-04-17T12:03:00.000Z',
      }),
      createStageEvent({
        id: 'evt-approved',
        stage: 'approved',
        role: 'final-reviewer',
        eventType: 'iteration_completed',
        createdAtUtc: '2026-04-17T12:04:00.000Z',
      }),
    ];

    const timeline = buildTimelineEntriesWithSkippedStages(entries, truncatedStageEvents);
    const skippedStages = timeline
      .filter((entry) => 'syntheticKind' in entry && entry.syntheticKind === 'skipped_stage')
      .map((entry) => entry.stage);

    expect(skippedStages).toEqual(['awaiting_user_input', 'plan_revision', 'reworking']);
  });
});
