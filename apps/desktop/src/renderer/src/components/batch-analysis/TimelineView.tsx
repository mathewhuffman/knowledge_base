import type { BatchAnalysisStageEventRecord, BatchAnalysisTimelineEntry } from '@kb-vault/shared-types';
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import {
  buildTimelineEntriesWithSkippedStages,
  getVisibleStageLabel,
  STAGE_LABELS,
  ROLE_LABELS,
  TERMINAL_STAGES,
  verdictBadgeVariant,
  formatTimestamp,
  humanizeAnalysisText,
  type RenderableTimelineEntry,
} from './helpers';

interface TimelineViewProps {
  entries: BatchAnalysisTimelineEntry[];
  stageEvents?: BatchAnalysisStageEventRecord[];
}

function artifactTypeLabel(type: BatchAnalysisTimelineEntry['artifactType']): string {
  switch (type) {
    case 'iteration':
      return 'Iteration';
    case 'plan':
      return 'Plan';
    case 'review':
      return 'Review';
    case 'worker_report':
      return 'Worker Report';
    case 'amendment':
      return 'Amendment';
    case 'final_review':
      return 'Final Review';
    case 'stage_run':
      return 'Stage Run';
    default:
      return type;
  }
}

function isSkippedStageEntry(entry: RenderableTimelineEntry): entry is Extract<RenderableTimelineEntry, { syntheticKind: 'skipped_stage' }> {
  return 'syntheticKind' in entry && entry.syntheticKind === 'skipped_stage';
}

function renderableArtifactTypeLabel(entry: RenderableTimelineEntry): string {
  if (isSkippedStageEntry(entry)) {
    return 'Skipped Stage';
  }

  return artifactTypeLabel(entry.artifactType);
}

function timelineDotClass(entry: RenderableTimelineEntry): string {
  if (isSkippedStageEntry(entry)) {
    return 'ba-timeline-dot--neutral';
  }

  if (TERMINAL_STAGES.has(entry.stage)) {
    if (entry.stage === 'approved') return 'ba-timeline-dot--success';
    if (entry.stage === 'failed' || entry.stage === 'canceled') return 'ba-timeline-dot--danger';
    return 'ba-timeline-dot--warning';
  }

  if (entry.verdict === 'approved') return 'ba-timeline-dot--success';
  if (entry.verdict === 'needs_revision' || entry.verdict === 'needs_rework') return 'ba-timeline-dot--warning';
  if (entry.verdict === 'rejected' || entry.verdict === 'blocked') return 'ba-timeline-dot--danger';

  return 'ba-timeline-dot--neutral';
}

export function TimelineView({ entries, stageEvents = [] }: TimelineViewProps) {
  if (entries.length === 0 && stageEvents.length === 0) {
    return (
      <EmptyState
        title="No timeline entries"
        description="Timeline events will appear as the analysis progresses through stages."
      />
    );
  }

  const renderableEntries = buildTimelineEntriesWithSkippedStages(entries, stageEvents);

  return (
    <div className="ba-timeline" role="list" aria-label="Batch analysis timeline">
      {renderableEntries.map((entry, idx) => {
        const isTerminal = TERMINAL_STAGES.has(entry.stage);
        const isLast = idx === renderableEntries.length - 1;
        const isSkippedStage = isSkippedStageEntry(entry);

        return (
          <div
            key={`${entry.artifactId}-${idx}`}
            className={`ba-timeline-entry ${isLast ? 'ba-timeline-entry--last' : ''}${isSkippedStage ? ' ba-timeline-entry--skipped' : ''}`}
            role="listitem"
          >
            <div className={`ba-timeline-dot ${timelineDotClass(entry)} ${isTerminal ? 'ba-timeline-dot--terminal' : ''}`} />

            <div className="ba-timeline-time">
              {formatTimestamp(entry.createdAtUtc)}
            </div>

            <div className="ba-timeline-content">
              <span className="ba-timeline-type">
                {renderableArtifactTypeLabel(entry)}
              </span>
              {entry.summary && (
                <span className={`ba-timeline-summary${isSkippedStage ? ' ba-timeline-summary--multiline' : ''}`}>
                  {humanizeAnalysisText(entry.summary)}
                </span>
              )}
              {!isSkippedStage && entry.verdict && (
                <Badge variant={verdictBadgeVariant(entry.verdict)}>
                  {entry.verdict}
                </Badge>
              )}
              {isSkippedStage && (
                <Badge variant="warning">
                  skipped
                </Badge>
              )}
            </div>

            <div className="ba-timeline-tags">
              <Badge variant="neutral">
                {getVisibleStageLabel(entry.stage) ?? STAGE_LABELS[entry.stage]}
              </Badge>
              <Badge variant="neutral">
                {ROLE_LABELS[entry.role]}
              </Badge>
              {entry.iteration != null && (
                <span className="ba-timeline-iter">#{entry.iteration}</span>
              )}
            </div>
          </div>
        );
      })}

      {stageEvents.length > 0 && (
        <div className="ba-overview-section" style={{ marginTop: 'var(--space-4)' }}>
          <h4 className="ba-section-heading">Stage Event Log</h4>
          <div className="ba-detail-list">
            {stageEvents.map((event) => (
              <div key={event.id} className="ba-detail-card">
                <div className="ba-detail-card-header">
                  <div className="ba-detail-card-title">
                    {event.summary ? humanizeAnalysisText(event.summary) : event.eventType}
                  </div>
                  <div className="ba-detail-card-meta">
                    <Badge variant="neutral">{getVisibleStageLabel(event.stage) ?? STAGE_LABELS[event.stage]}</Badge>
                    <Badge variant="neutral">{ROLE_LABELS[event.role]}</Badge>
                    {typeof event.details?.toolCallCount === 'number' && (
                      <Badge variant="neutral">{event.details.toolCallCount} tools</Badge>
                    )}
                    {typeof event.details?.durationMs === 'number' && (
                      <Badge variant="neutral">{Math.round(event.details.durationMs / 1000)}s</Badge>
                    )}
                    {typeof event.details?.attempt === 'number' && (
                      <Badge variant="neutral">attempt {event.details.attempt}</Badge>
                    )}
                    {event.lastReviewVerdict && (
                      <Badge variant={verdictBadgeVariant(event.lastReviewVerdict)}>
                        {event.lastReviewVerdict}
                      </Badge>
                    )}
                    <span className="ba-detail-created">{formatTimestamp(event.createdAtUtc)}</span>
                  </div>
                </div>
                {event.details && (
                  <details>
                    <summary>Debug details</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', marginTop: 'var(--space-2)' }}>
                      {JSON.stringify(event.details, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
