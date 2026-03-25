import type { BatchAnalysisStageEventRecord, BatchAnalysisTimelineEntry } from '@kb-vault/shared-types';
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import {
  getVisibleStageLabel,
  STAGE_LABELS,
  ROLE_LABELS,
  TERMINAL_STAGES,
  verdictBadgeVariant,
  formatTimestamp,
  humanizeAnalysisText,
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
    case 'run':
      return 'Run';
    default:
      return type;
  }
}

function timelineDotClass(entry: BatchAnalysisTimelineEntry): string {
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

  return (
    <div className="ba-timeline" role="list" aria-label="Batch analysis timeline">
      {entries.map((entry, idx) => {
        const isTerminal = TERMINAL_STAGES.has(entry.stage);
        const isLast = idx === entries.length - 1;

        return (
          <div
            key={`${entry.artifactId}-${idx}`}
            className={`ba-timeline-entry ${isLast ? 'ba-timeline-entry--last' : ''}`}
            role="listitem"
          >
            <div className={`ba-timeline-dot ${timelineDotClass(entry)} ${isTerminal ? 'ba-timeline-dot--terminal' : ''}`} />

            <div className="ba-timeline-time">
              {formatTimestamp(entry.createdAtUtc)}
            </div>

            <div className="ba-timeline-content">
              <span className="ba-timeline-type">
                {artifactTypeLabel(entry.artifactType)}
              </span>
              {entry.summary && (
                <span className="ba-timeline-summary">{humanizeAnalysisText(entry.summary)}</span>
              )}
              {entry.verdict && (
                <Badge variant={verdictBadgeVariant(entry.verdict)}>
                  {entry.verdict}
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
