import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import { IconCheckCircle, IconAlertCircle, IconChevronRight } from '../icons';
import { verdictBadgeVariant, getVisibleStageLabel, STAGE_LABELS, formatTimestamp, humanizeAnalysisText } from './helpers';
function ReviewCheck({ label, passed }) {
    return (_jsxs("div", { className: `ba-review-check ${!passed ? 'ba-review-check--warn' : ''}`, children: [_jsx("span", { className: "ba-review-check-icon", "aria-hidden": "true", children: passed ? (_jsx(IconCheckCircle, { size: 14, className: "ba-check-pass" })) : (_jsx(IconAlertCircle, { size: 14, className: "ba-check-fail" })) }), _jsx("span", { children: label })] }));
}
function ReviewDeltaSection({ delta }) {
    const [expanded, setExpanded] = useState(delta.verdict === 'needs_revision');
    const hasContent = delta.delta.requestedChanges.length > 0 ||
        delta.delta.missingPbiIds.length > 0 ||
        delta.delta.missingCreates.length > 0 ||
        delta.delta.missingEdits.length > 0 ||
        delta.delta.additionalArticleWork.length > 0 ||
        delta.delta.targetCorrections.length > 0 ||
        delta.delta.overlapConflicts.length > 0;
    if (!hasContent)
        return null;
    return (_jsxs("div", { className: "ba-review-delta", children: [_jsxs("button", { className: "ba-review-delta-toggle", onClick: () => setExpanded(!expanded), "aria-expanded": expanded, children: [_jsx("span", { className: `ba-review-delta-chevron ${expanded ? 'ba-review-delta-chevron--open' : ''}`, children: _jsx(IconChevronRight, { size: 12 }) }), _jsx("span", { className: "ba-review-delta-label", children: "Review Delta" }), delta.delta.summary && (_jsx("span", { className: "ba-review-delta-summary", children: humanizeAnalysisText(delta.delta.summary) }))] }), expanded && (_jsxs("div", { className: "ba-review-delta-body", children: [delta.delta.requestedChanges.length > 0 && (_jsx(DeltaList, { label: "Requested changes", items: delta.delta.requestedChanges })), delta.delta.missingPbiIds.length > 0 && (_jsx(DeltaList, { label: "Missing PBIs", items: delta.delta.missingPbiIds })), delta.delta.missingCreates.length > 0 && (_jsx(DeltaList, { label: "Missing creates", items: delta.delta.missingCreates })), delta.delta.missingEdits.length > 0 && (_jsx(DeltaList, { label: "Missing edits", items: delta.delta.missingEdits })), delta.delta.additionalArticleWork.length > 0 && (_jsx(DeltaList, { label: "Additional article work", items: delta.delta.additionalArticleWork })), delta.delta.targetCorrections.length > 0 && (_jsx(DeltaList, { label: "Target corrections", items: delta.delta.targetCorrections })), delta.delta.overlapConflicts.length > 0 && (_jsx(DeltaList, { label: "Overlap / conflicts", items: delta.delta.overlapConflicts }))] }))] }));
}
function DeltaList({ label, items }) {
    return (_jsxs("div", { className: "ba-delta-group", children: [_jsxs("span", { className: "ba-detail-label", children: [label, " (", items.length, "):"] }), _jsx("ul", { className: "ba-delta-list", children: items.map((item, i) => (_jsx("li", { children: humanizeAnalysisText(item) }, i))) })] }));
}
export function PlanReviewView({ reviews, reviewDeltas }) {
    if (reviews.length === 0) {
        return (_jsx(EmptyState, { title: "No plan reviews yet", description: "Reviews will appear once the plan review stage runs." }));
    }
    return (_jsx("div", { className: "ba-reviews", children: reviews.map((review) => {
            const matchingDelta = reviewDeltas.find((d) => d.reviewId === review.id);
            return (_jsxs("div", { className: "ba-review-card card", children: [_jsxs("div", { className: "ba-review-header", children: [_jsx("span", { className: "ba-review-title", children: "Plan Review" }), _jsx(Badge, { variant: verdictBadgeVariant(review.verdict), children: review.verdict }), _jsxs("span", { className: "ba-review-meta", children: [getVisibleStageLabel(review.stage) ?? STAGE_LABELS[review.stage], " \u00B7 Iter ", review.iteration] }), _jsx("span", { className: "ba-review-time", children: formatTimestamp(review.createdAtUtc) })] }), review.summary && (_jsx("div", { className: "ba-review-summary", children: humanizeAnalysisText(review.summary) })), _jsxs("div", { className: "ba-review-checklist", children: [_jsx(ReviewCheck, { label: "Accounted for every PBI", passed: review.didAccountForEveryPbi }), _jsx(ReviewCheck, { label: "No missing creates", passed: !review.hasMissingCreates }), _jsx(ReviewCheck, { label: "No missing edits", passed: !review.hasMissingEdits }), _jsx(ReviewCheck, { label: "No target issues", passed: !review.hasTargetIssues }), _jsx(ReviewCheck, { label: "No overlap / conflict", passed: !review.hasOverlapOrConflict }), _jsx(ReviewCheck, { label: "No additional article work needed", passed: !review.foundAdditionalArticleWork }), _jsx(ReviewCheck, { label: "KB scope adequate", passed: !review.underScopedKbImpact })] }), matchingDelta && _jsx(ReviewDeltaSection, { delta: matchingDelta })] }, review.id));
        }) }));
}
