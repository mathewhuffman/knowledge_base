import { useState, useMemo } from 'react';
import type {
  BatchAnalysisInspectionResponse,
  BatchAnalysisRuntimeStatus,
  BatchAnalysisEventStreamResponse,
  BatchAnalysisExecutionCounts,
} from '@kb-vault/shared-types';
import { Badge } from '../Badge';
import { StagePipeline } from './StagePipeline';
import { PlanView } from './PlanView';
import { PlanReviewView } from './PlanReviewView';
import { FinalReviewView } from './FinalReviewView';
import { WorkerReportView } from './WorkerReportView';
import { DiscoveredWorkList } from './DiscoveredWorkList';
import { OpenQuestionsList } from './OpenQuestionsList';
import { TimelineView } from './TimelineView';
import { ArtifactTranscriptLink } from './ArtifactTranscriptLink';
import {
  buildTimelineEntriesWithSkippedStages,
  deriveCompletedStages,
  deriveSkippedStages,
  getVisibleStage,
  getVisibleStageLabel,
  STAGE_LABELS,
  ROLE_LABELS,
} from './helpers';

type InspectorTab = 'overview' | 'questions' | 'plan' | 'reviews' | 'execution' | 'timeline' | 'transcripts';

interface BatchAnalysisInspectorProps {
  inspection: BatchAnalysisInspectionResponse;
  runtimeStatus: BatchAnalysisRuntimeStatus | null;
  eventStream: BatchAnalysisEventStreamResponse | null;
  isRunning: boolean;
  onOpenSession?: (sessionId: string) => void;
  onRefresh?: () => void | Promise<void>;
}

function ExecCountsSummary({ counts }: { counts: BatchAnalysisExecutionCounts }) {
  return (
    <div className="ba-overview-counts">
      <div className="ba-overview-count">
        <span className="ba-overview-count-value">{counts.total}</span>
        <span className="ba-overview-count-label">Total</span>
      </div>
      <div className="ba-overview-count">
        <span className="ba-overview-count-value ba-overview-count--create">{counts.create}</span>
        <span className="ba-overview-count-label">Create</span>
      </div>
      <div className="ba-overview-count">
        <span className="ba-overview-count-value ba-overview-count--edit">{counts.edit}</span>
        <span className="ba-overview-count-label">Edit</span>
      </div>
      <div className="ba-overview-count">
        <span className="ba-overview-count-value ba-overview-count--retire">{counts.retire}</span>
        <span className="ba-overview-count-label">Retire</span>
      </div>
      <div className="ba-overview-count">
        <span className="ba-overview-count-value">{counts.executed}</span>
        <span className="ba-overview-count-label">Executed</span>
      </div>
      <div className="ba-overview-count">
        <span className="ba-overview-count-value ba-overview-count--blocked">{counts.blocked}</span>
        <span className="ba-overview-count-label">Blocked</span>
      </div>
    </div>
  );
}

export function BatchAnalysisInspector({
  inspection,
  runtimeStatus,
  eventStream,
  isRunning,
  onOpenSession,
  onRefresh,
}: BatchAnalysisInspectorProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('overview');

  const snapshot = inspection.snapshot;
  const currentStage = runtimeStatus?.stage ?? snapshot.latestIteration?.stage;
  const visibleCurrentStage = getVisibleStage(currentStage);
  const currentIteration = runtimeStatus?.iteration ?? snapshot.latestIteration?.iteration;
  const currentRole = runtimeStatus?.role ?? snapshot.latestIteration?.role;
  const executionCounts = runtimeStatus?.executionCounts ?? snapshot.latestIteration?.executionCounts;
  const outstandingDiscoveries = runtimeStatus?.outstandingDiscoveredWorkCount ?? snapshot.latestIteration?.outstandingDiscoveredWorkCount ?? 0;
  const pausedForUserInput = runtimeStatus?.pausedForUserInput ?? snapshot.pausedForUserInput;
  const unansweredRequiredQuestions = runtimeStatus?.unansweredRequiredQuestionCount ?? snapshot.unansweredRequiredQuestionCount ?? 0;
  const questionCount = inspection.questions.length;
  const stageEvents = eventStream?.events;

  const completedStages = useMemo(
    () => deriveCompletedStages(inspection.timeline),
    [inspection.timeline],
  );
  const skippedStages = useMemo(
    () => deriveSkippedStages(inspection.timeline, stageEvents ?? []),
    [inspection.timeline, stageEvents],
  );
  const renderableTimelineCount = useMemo(
    () => buildTimelineEntriesWithSkippedStages(inspection.timeline, stageEvents ?? []).length,
    [inspection.timeline, stageEvents],
  );

  const latestPlanReview = inspection.reviews[0] ?? null;
  const latestFinalReview = inspection.finalReviews[0] ?? null;
  const latestPlanReviewDelta = latestPlanReview
    ? inspection.reviewDeltas.find((delta) => delta.reviewId === latestPlanReview.id) ?? null
    : null;
  const latestFinalReviewDelta = latestFinalReview
    ? inspection.finalReviewReworkPlans.find((delta) => delta.finalReviewId === latestFinalReview.id) ?? null
    : null;
  const stageMetrics = useMemo(() => {
    const events = eventStream?.events ?? [];
    const grouped = new Map<string, {
      stage: string;
      role: string;
      toolCallCount: number;
      durationMs?: number;
      attempts: number;
      retries: number;
    }>();
    for (const event of events) {
      const toolCallCount = typeof event.details?.toolCallCount === 'number' ? event.details.toolCallCount : undefined;
      const durationMs = typeof event.details?.durationMs === 'number' ? event.details.durationMs : undefined;
      const attempt = typeof event.details?.attempt === 'number' ? event.details.attempt : undefined;
      const retryType = typeof event.details?.retryType === 'string' ? event.details.retryType : undefined;
      if (toolCallCount == null && durationMs == null && attempt == null && !retryType) {
        continue;
      }
      const key = `${event.stage}:${event.role}`;
      const existing = grouped.get(key) ?? {
        stage: event.stage,
        role: event.role,
        toolCallCount: 0,
        durationMs: undefined,
        attempts: 0,
        retries: 0
      };
      if (toolCallCount != null) {
        existing.toolCallCount = Math.max(existing.toolCallCount, toolCallCount);
      }
      if (durationMs != null) {
        existing.durationMs = Math.max(existing.durationMs ?? 0, durationMs);
      }
      if (attempt != null) {
        existing.attempts = Math.max(existing.attempts, attempt);
      }
      if (retryType) {
        existing.retries += 1;
      }
      grouped.set(key, existing);
    }
    return Array.from(grouped.values());
  }, [eventStream?.events]);

  const failedStage = useMemo(() => {
    if (currentStage === 'failed' || currentStage === 'canceled') {
      const lastNonTerminal = inspection.timeline
        .filter((e) => e.stage !== 'failed' && e.stage !== 'canceled' && e.stage !== 'approved' && e.stage !== 'needs_human_review')
        .pop();
      return lastNonTerminal?.stage;
    }
    return undefined;
  }, [currentStage, inspection.timeline]);

  const tabs: { key: InspectorTab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'questions', label: 'Questions', count: unansweredRequiredQuestions || questionCount },
    { key: 'plan', label: 'Plan', count: inspection.plans.length },
    { key: 'reviews', label: 'Reviews', count: inspection.reviews.length + inspection.finalReviews.length },
    { key: 'execution', label: 'Execution', count: inspection.workerReports.length },
    { key: 'timeline', label: 'Timeline', count: renderableTimelineCount },
    { key: 'transcripts', label: 'Transcripts', count: inspection.transcriptLinks.length },
  ];

  return (
    <div className="ba-inspector">
      {/* Stage pipeline */}
      <div className="ba-inspector-pipeline">
        <StagePipeline
          currentStage={currentStage}
          iteration={currentIteration}
          completedStages={completedStages}
          skippedStages={skippedStages}
          failedStage={failedStage}
          isRunning={isRunning}
        />
      </div>

      {/* Tab bar */}
      <div className="tab-bar ba-inspector-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`tab-item ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span className="ba-tab-count">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="ba-inspector-body">
        {activeTab === 'overview' && (
          <div className="ba-overview">
            {/* Summary metadata */}
            <div className="ba-overview-meta">
              {currentStage && (
                <div className="ba-overview-meta-item">
                  <span className="ba-detail-label">Stage</span>
                  <Badge variant={visibleCurrentStage === 'queued' ? 'success' : 'primary'}>
                    {getVisibleStageLabel(currentStage) ?? STAGE_LABELS[currentStage]}
                  </Badge>
                </div>
              )}
              {currentRole && (
                <div className="ba-overview-meta-item">
                  <span className="ba-detail-label">Role</span>
                  <Badge variant="neutral">{ROLE_LABELS[currentRole]}</Badge>
                </div>
              )}
              {currentIteration != null && (
                <div className="ba-overview-meta-item">
                  <span className="ba-detail-label">Iteration</span>
                  <span>{currentIteration}</span>
                </div>
              )}
              {outstandingDiscoveries > 0 && (
                <div className="ba-overview-meta-item">
                  <span className="ba-detail-label">Discoveries</span>
                  <Badge variant="warning">{outstandingDiscoveries}</Badge>
                </div>
              )}
              {(pausedForUserInput || questionCount > 0) && (
                <div className="ba-overview-meta-item">
                  <span className="ba-detail-label">Questions</span>
                  <Badge variant={pausedForUserInput || unansweredRequiredQuestions > 0 ? 'warning' : 'neutral'}>
                    {unansweredRequiredQuestions > 0 ? `${unansweredRequiredQuestions} pending` : `${questionCount} tracked`}
                  </Badge>
                </div>
              )}
              {runtimeStatus?.agentModelId && (
                <div className="ba-overview-meta-item">
                  <span className="ba-detail-label">Model</span>
                  <code>{runtimeStatus.agentModelId}</code>
                </div>
              )}
            </div>

            {/* Execution counts */}
            {executionCounts && executionCounts.total > 0 && (
              <ExecCountsSummary counts={executionCounts} />
            )}

            {stageMetrics.length > 0 && (
              <div className="ba-overview-section">
                <h4 className="ba-section-heading">Stage Metrics</h4>
                <div className="ba-detail-list">
                  {stageMetrics.map((metric) => (
                    <div key={`${metric.stage}:${metric.role}`} className="ba-detail-card">
                      <div className="ba-detail-card-header">
                        <div className="ba-detail-card-title">
                          {getVisibleStageLabel(metric.stage as typeof currentStage) ?? STAGE_LABELS[metric.stage as keyof typeof STAGE_LABELS]}
                        </div>
                        <div className="ba-detail-card-meta">
                          <Badge variant="neutral">{ROLE_LABELS[metric.role as keyof typeof ROLE_LABELS]}</Badge>
                          <span>{metric.toolCallCount} tools</span>
                          {metric.durationMs != null && <span>{Math.round(metric.durationMs / 1000)}s</span>}
                          {metric.attempts > 0 && <span>attempt {metric.attempts}</span>}
                          {metric.retries > 0 && <span>{metric.retries} retry</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Compact plan */}
            {inspection.plans.length > 0 && (
              <div className="ba-overview-section">
                <h4 className="ba-section-heading">Latest Plan</h4>
                <PlanView plans={inspection.plans} compact />
              </div>
            )}

            {inspection.questionSets.length > 0 && (
              <div className="ba-overview-section">
                <h4 className="ba-section-heading">
                  Questions
                  <Badge variant={pausedForUserInput || unansweredRequiredQuestions > 0 ? 'warning' : 'neutral'}>
                    {unansweredRequiredQuestions || questionCount}
                  </Badge>
                </h4>
                <OpenQuestionsList
                  workspaceId={inspection.workspaceId}
                  batchId={inspection.batchId}
                  questionSets={inspection.questionSets}
                  questions={inspection.questions}
                  pausedForUserInput={pausedForUserInput}
                  unansweredRequiredQuestionCount={unansweredRequiredQuestions}
                  compact
                  onRefresh={onRefresh}
                />
              </div>
            )}

            {latestPlanReview && (
              <div className="ba-overview-section">
                <h4 className="ba-section-heading">Latest Plan Review</h4>
                <PlanReviewView
                  reviews={[latestPlanReview]}
                  reviewDeltas={latestPlanReviewDelta ? [latestPlanReviewDelta] : []}
                />
              </div>
            )}

            {latestFinalReview && (
              <div className="ba-overview-section">
                <h4 className="ba-section-heading">Latest Final Review</h4>
                <FinalReviewView
                  finalReviews={[latestFinalReview]}
                  finalReviewDeltas={latestFinalReviewDelta ? [latestFinalReviewDelta] : []}
                />
              </div>
            )}

            {/* Discovered work */}
            {inspection.discoveredWork.length > 0 && (
              <div className="ba-overview-section">
                <h4 className="ba-section-heading">
                  Discovered Work
                  <Badge variant="warning">{inspection.discoveredWork.length}</Badge>
                </h4>
                <DiscoveredWorkList items={inspection.discoveredWork} compact />
              </div>
            )}
          </div>
        )}

        {activeTab === 'plan' && (
          <PlanView
            plans={inspection.plans}
            supersededPlans={inspection.supersededPlans}
          />
        )}

        {activeTab === 'questions' && (
          <OpenQuestionsList
            workspaceId={inspection.workspaceId}
            batchId={inspection.batchId}
            questionSets={inspection.questionSets}
            questions={inspection.questions}
            pausedForUserInput={pausedForUserInput}
            unansweredRequiredQuestionCount={unansweredRequiredQuestions}
            onRefresh={onRefresh}
          />
        )}

        {activeTab === 'reviews' && (
          <div className="ba-reviews-combined">
            <div className="ba-overview-section">
              <h4 className="ba-section-heading">Plan Reviews</h4>
              <PlanReviewView
                reviews={inspection.reviews}
                reviewDeltas={inspection.reviewDeltas}
              />
            </div>
            {inspection.finalReviews.length > 0 && (
              <div className="ba-overview-section">
                <h4 className="ba-section-heading">Final Reviews</h4>
                <FinalReviewView
                  finalReviews={inspection.finalReviews}
                  finalReviewDeltas={inspection.finalReviewReworkPlans}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === 'execution' && (
          <div className="ba-execution-combined">
            <WorkerReportView reports={inspection.workerReports} />
            {inspection.discoveredWork.length > 0 && (
              <div className="ba-overview-section">
                <h4 className="ba-section-heading">
                  Discovered Work
                  <Badge variant="warning">{inspection.discoveredWork.length}</Badge>
                </h4>
                <DiscoveredWorkList items={inspection.discoveredWork} />
              </div>
            )}
          </div>
        )}

        {activeTab === 'timeline' && (
          <TimelineView entries={inspection.timeline} stageEvents={eventStream?.events ?? []} />
        )}

        {activeTab === 'transcripts' && (
          <ArtifactTranscriptLink
            links={inspection.transcriptLinks}
            onOpenSession={onOpenSession}
          />
        )}
      </div>
    </div>
  );
}
