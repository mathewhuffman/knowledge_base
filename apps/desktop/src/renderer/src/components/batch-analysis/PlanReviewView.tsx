import type {
  BatchPlanReview,
  BatchAnalysisReviewDeltaRecord,
} from '@kb-vault/shared-types';
import { useState } from 'react';
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import { IconCheckCircle, IconAlertCircle, IconChevronRight } from '../icons';
import { verdictBadgeVariant, getVisibleStageLabel, STAGE_LABELS, formatTimestamp, humanizeAnalysisText } from './helpers';

interface PlanReviewViewProps {
  reviews: BatchPlanReview[];
  reviewDeltas: BatchAnalysisReviewDeltaRecord[];
}

interface ReviewCheckProps {
  label: string;
  passed: boolean;
}

function ReviewCheck({ label, passed }: ReviewCheckProps) {
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

function ReviewDeltaSection({ delta }: { delta: BatchAnalysisReviewDeltaRecord }) {
  const [expanded, setExpanded] = useState(delta.verdict === 'needs_revision');

  const hasContent =
    delta.delta.requestedChanges.length > 0 ||
    delta.delta.missingPbiIds.length > 0 ||
    delta.delta.missingCreates.length > 0 ||
    delta.delta.missingEdits.length > 0 ||
    delta.delta.additionalArticleWork.length > 0 ||
    delta.delta.targetCorrections.length > 0 ||
    delta.delta.overlapConflicts.length > 0;

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
        <span className="ba-review-delta-label">Review Delta</span>
        {delta.delta.summary && (
          <span className="ba-review-delta-summary">{humanizeAnalysisText(delta.delta.summary)}</span>
        )}
      </button>

      {expanded && (
        <div className="ba-review-delta-body">
          {delta.delta.requestedChanges.length > 0 && (
            <DeltaList label="Requested changes" items={delta.delta.requestedChanges} />
          )}
          {delta.delta.missingPbiIds.length > 0 && (
            <DeltaList label="Missing PBIs" items={delta.delta.missingPbiIds} />
          )}
          {delta.delta.missingCreates.length > 0 && (
            <DeltaList label="Missing creates" items={delta.delta.missingCreates} />
          )}
          {delta.delta.missingEdits.length > 0 && (
            <DeltaList label="Missing edits" items={delta.delta.missingEdits} />
          )}
          {delta.delta.additionalArticleWork.length > 0 && (
            <DeltaList label="Additional article work" items={delta.delta.additionalArticleWork} />
          )}
          {delta.delta.targetCorrections.length > 0 && (
            <DeltaList label="Target corrections" items={delta.delta.targetCorrections} />
          )}
          {delta.delta.overlapConflicts.length > 0 && (
            <DeltaList label="Overlap / conflicts" items={delta.delta.overlapConflicts} />
          )}
        </div>
      )}
    </div>
  );
}

function DeltaList({ label, items }: { label: string; items: string[] }) {
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

export function PlanReviewView({ reviews, reviewDeltas }: PlanReviewViewProps) {
  if (reviews.length === 0) {
    return (
      <EmptyState
        title="No plan reviews yet"
        description="Reviews will appear once the plan review stage runs."
      />
    );
  }

  return (
    <div className="ba-reviews">
      {reviews.map((review) => {
        const matchingDelta = reviewDeltas.find((d) => d.reviewId === review.id);

        return (
          <div key={review.id} className="ba-review-card card">
            <div className="ba-review-header">
              <span className="ba-review-title">Plan Review</span>
              <Badge variant={verdictBadgeVariant(review.verdict)}>
                {review.verdict}
              </Badge>
              <span className="ba-review-meta">
                {getVisibleStageLabel(review.stage) ?? STAGE_LABELS[review.stage]} &middot; Iter {review.iteration}
              </span>
              <span className="ba-review-time">{formatTimestamp(review.createdAtUtc)}</span>
            </div>

            {review.summary && (
              <div className="ba-review-summary">{humanizeAnalysisText(review.summary)}</div>
            )}

            <div className="ba-review-checklist">
              <ReviewCheck label="Accounted for every PBI" passed={review.didAccountForEveryPbi} />
              <ReviewCheck label="No missing creates" passed={!review.hasMissingCreates} />
              <ReviewCheck label="No missing edits" passed={!review.hasMissingEdits} />
              <ReviewCheck label="No target issues" passed={!review.hasTargetIssues} />
              <ReviewCheck label="No overlap / conflict" passed={!review.hasOverlapOrConflict} />
              <ReviewCheck label="No additional article work needed" passed={!review.foundAdditionalArticleWork} />
              <ReviewCheck label="KB scope adequate" passed={!review.underScopedKbImpact} />
            </div>

            {matchingDelta && <ReviewDeltaSection delta={matchingDelta} />}
          </div>
        );
      })}
    </div>
  );
}
