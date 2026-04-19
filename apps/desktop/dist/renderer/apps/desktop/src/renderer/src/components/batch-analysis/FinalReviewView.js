import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import { IconCheckCircle, IconAlertCircle, IconChevronRight } from '../icons';
import { verdictBadgeVariant, formatTimestamp, humanizeAnalysisText } from './helpers';
function FinalReviewCheck({ label, passed }) {
    return (_jsxs("div", { className: `ba-review-check ${!passed ? 'ba-review-check--warn' : ''}`, children: [_jsx("span", { className: "ba-review-check-icon", "aria-hidden": "true", children: passed ? (_jsx(IconCheckCircle, { size: 14, className: "ba-check-pass" })) : (_jsx(IconAlertCircle, { size: 14, className: "ba-check-fail" })) }), _jsx("span", { children: label })] }));
}
function FinalDeltaSection({ delta }) {
    const [expanded, setExpanded] = useState(delta.verdict === 'needs_rework' || delta.verdict === 'needs_revision');
    const hasContent = delta.delta.requestedRework.length > 0 ||
        delta.delta.uncoveredPbiIds.length > 0 ||
        delta.delta.missingArticleChanges.length > 0 ||
        delta.delta.duplicateRiskTitles.length > 0 ||
        delta.delta.unnecessaryChanges.length > 0 ||
        delta.delta.unresolvedAmbiguities.length > 0;
    if (!hasContent)
        return null;
    return (_jsxs("div", { className: "ba-review-delta", children: [_jsxs("button", { className: "ba-review-delta-toggle", onClick: () => setExpanded(!expanded), "aria-expanded": expanded, children: [_jsx("span", { className: `ba-review-delta-chevron ${expanded ? 'ba-review-delta-chevron--open' : ''}`, children: _jsx(IconChevronRight, { size: 12 }) }), _jsx("span", { className: "ba-review-delta-label", children: "Rework Delta" }), delta.delta.summary && (_jsx("span", { className: "ba-review-delta-summary", children: humanizeAnalysisText(delta.delta.summary) }))] }), expanded && (_jsxs("div", { className: "ba-review-delta-body", children: [delta.delta.requestedRework.length > 0 && (_jsx(FinalDeltaList, { label: "Requested rework", items: delta.delta.requestedRework })), delta.delta.uncoveredPbiIds.length > 0 && (_jsx(FinalDeltaList, { label: "Uncovered PBIs", items: delta.delta.uncoveredPbiIds })), delta.delta.missingArticleChanges.length > 0 && (_jsx(FinalDeltaList, { label: "Missing article changes", items: delta.delta.missingArticleChanges })), delta.delta.duplicateRiskTitles.length > 0 && (_jsx(FinalDeltaList, { label: "Duplicate risk", items: delta.delta.duplicateRiskTitles })), delta.delta.unnecessaryChanges.length > 0 && (_jsx(FinalDeltaList, { label: "Unnecessary changes", items: delta.delta.unnecessaryChanges })), delta.delta.unresolvedAmbiguities.length > 0 && (_jsx(FinalDeltaList, { label: "Unresolved ambiguities", items: delta.delta.unresolvedAmbiguities }))] }))] }));
}
function FinalDeltaList({ label, items }) {
    return (_jsxs("div", { className: "ba-delta-group", children: [_jsxs("span", { className: "ba-detail-label", children: [label, " (", items.length, "):"] }), _jsx("ul", { className: "ba-delta-list", children: items.map((item, i) => (_jsx("li", { children: humanizeAnalysisText(item) }, i))) })] }));
}
export function FinalReviewView({ finalReviews, finalReviewDeltas }) {
    if (finalReviews.length === 0) {
        return (_jsx(EmptyState, { title: "No final reviews yet", description: "Final reviews will appear after worker execution completes." }));
    }
    return (_jsx("div", { className: "ba-reviews", children: finalReviews.map((review) => {
            const matchingDelta = finalReviewDeltas.find((d) => d.finalReviewId === review.id);
            return (_jsxs("div", { className: "ba-review-card card", children: [_jsxs("div", { className: "ba-review-header", children: [_jsx("span", { className: "ba-review-title", children: "Final Review" }), _jsx(Badge, { variant: verdictBadgeVariant(review.verdict), children: review.verdict }), _jsxs("span", { className: "ba-review-meta", children: ["Iter ", review.iteration] }), _jsx("span", { className: "ba-review-time", children: formatTimestamp(review.createdAtUtc) })] }), review.summary && (_jsx("div", { className: "ba-review-summary", children: humanizeAnalysisText(review.summary) })), _jsxs("div", { className: "ba-review-checklist", children: [_jsx(FinalReviewCheck, { label: "All PBIs mapped", passed: review.allPbisMapped }), _jsx(FinalReviewCheck, { label: "Plan execution complete", passed: review.planExecutionComplete }), _jsx(FinalReviewCheck, { label: "No missing article changes", passed: !review.hasMissingArticleChanges }), _jsx(FinalReviewCheck, { label: "No unresolved discovered work", passed: !review.hasUnresolvedDiscoveredWork })] }), matchingDelta && _jsx(FinalDeltaSection, { delta: matchingDelta })] }, review.id));
        }) }));
}
