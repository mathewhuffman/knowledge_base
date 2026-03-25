import type {
  BatchFinalReview,
  BatchAnalysisFinalReviewDeltaRecord,
} from '@kb-vault/shared-types';
import { useState } from 'react';
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import { IconCheckCircle, IconAlertCircle, IconChevronRight } from '../icons';
import { verdictBadgeVariant, formatTimestamp, humanizeAnalysisText } from './helpers';

interface FinalReviewViewProps {
  finalReviews: BatchFinalReview[];
  finalReviewDeltas: BatchAnalysisFinalReviewDeltaRecord[];
}

function FinalReviewCheck({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div className={`ba-review-check ${!passed ? 'ba-review-check--warn' : ''}`}>
      <span className="ba-review-check-icon" aria-hidden="true">
        {passed ? (
          <IconCheckCircle size={14} className="ba-check-pass" />
        ) : (
          <IconAlertCircle size={14} className="ba-check-fail" />
        )}
      </span>
      <span>{label}</span>
    </div>
  );
}

function FinalDeltaSection({ delta }: { delta: BatchAnalysisFinalReviewDeltaRecord }) {
  const [expanded, setExpanded] = useState(
    delta.verdict === 'needs_rework' || delta.verdict === 'needs_revision',
  );

  const hasContent =
    delta.delta.requestedRework.length > 0 ||
    delta.delta.uncoveredPbiIds.length > 0 ||
    delta.delta.missingArticleChanges.length > 0 ||
    delta.delta.duplicateRiskTitles.length > 0 ||
    delta.delta.unnecessaryChanges.length > 0 ||
    delta.delta.unresolvedAmbiguities.length > 0;

  if (!hasContent) return null;

  return (
    <div className="ba-review-delta">
      <button
        className="ba-review-delta-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className={`ba-review-delta-chevron ${expanded ? 'ba-review-delta-chevron--open' : ''}`}>
          <IconChevronRight size={12} />
        </span>
        <span className="ba-review-delta-label">Rework Delta</span>
        {delta.delta.summary && (
          <span className="ba-review-delta-summary">{humanizeAnalysisText(delta.delta.summary)}</span>
        )}
      </button>

      {expanded && (
        <div className="ba-review-delta-body">
          {delta.delta.requestedRework.length > 0 && (
            <FinalDeltaList label="Requested rework" items={delta.delta.requestedRework} />
          )}
          {delta.delta.uncoveredPbiIds.length > 0 && (
            <FinalDeltaList label="Uncovered PBIs" items={delta.delta.uncoveredPbiIds} />
          )}
          {delta.delta.missingArticleChanges.length > 0 && (
            <FinalDeltaList label="Missing article changes" items={delta.delta.missingArticleChanges} />
          )}
          {delta.delta.duplicateRiskTitles.length > 0 && (
            <FinalDeltaList label="Duplicate risk" items={delta.delta.duplicateRiskTitles} />
          )}
          {delta.delta.unnecessaryChanges.length > 0 && (
            <FinalDeltaList label="Unnecessary changes" items={delta.delta.unnecessaryChanges} />
          )}
          {delta.delta.unresolvedAmbiguities.length > 0 && (
            <FinalDeltaList label="Unresolved ambiguities" items={delta.delta.unresolvedAmbiguities} />
          )}
        </div>
      )}
    </div>
  );
}

function FinalDeltaList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="ba-delta-group">
      <span className="ba-detail-label">{label} ({items.length}):</span>
      <ul className="ba-delta-list">
        {items.map((item, i) => (
          <li key={i}>{humanizeAnalysisText(item)}</li>
        ))}
      </ul>
    </div>
  );
}

export function FinalReviewView({ finalReviews, finalReviewDeltas }: FinalReviewViewProps) {
  if (finalReviews.length === 0) {
    return (
      <EmptyState
        title="No final reviews yet"
        description="Final reviews will appear after worker execution completes."
      />
    );
  }

  return (
    <div className="ba-reviews">
      {finalReviews.map((review) => {
        const matchingDelta = finalReviewDeltas.find((d) => d.finalReviewId === review.id);

        return (
          <div key={review.id} className="ba-review-card card">
            <div className="ba-review-header">
              <span className="ba-review-title">Final Review</span>
              <Badge variant={verdictBadgeVariant(review.verdict)}>
                {review.verdict}
              </Badge>
              <span className="ba-review-meta">
                Iter {review.iteration}
              </span>
              <span className="ba-review-time">{formatTimestamp(review.createdAtUtc)}</span>
            </div>

            {review.summary && (
              <div className="ba-review-summary">{humanizeAnalysisText(review.summary)}</div>
            )}

            <div className="ba-review-checklist">
              <FinalReviewCheck label="All PBIs mapped" passed={review.allPbisMapped} />
              <FinalReviewCheck label="Plan execution complete" passed={review.planExecutionComplete} />
              <FinalReviewCheck label="No missing article changes" passed={!review.hasMissingArticleChanges} />
              <FinalReviewCheck label="No unresolved discovered work" passed={!review.hasUnresolvedDiscoveredWork} />
            </div>

            {matchingDelta && <FinalDeltaSection delta={matchingDelta} />}
          </div>
        );
      })}
    </div>
  );
}
