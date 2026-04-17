import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import { getVisibleStageLabel, STAGE_LABELS, ROLE_LABELS, TERMINAL_STAGES, verdictBadgeVariant, formatTimestamp, humanizeAnalysisText, } from './helpers';
function artifactTypeLabel(type) {
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
function timelineDotClass(entry) {
    if (TERMINAL_STAGES.has(entry.stage)) {
        if (entry.stage === 'approved')
            return 'ba-timeline-dot--success';
        if (entry.stage === 'failed' || entry.stage === 'canceled')
            return 'ba-timeline-dot--danger';
        return 'ba-timeline-dot--warning';
    }
    if (entry.verdict === 'approved')
        return 'ba-timeline-dot--success';
    if (entry.verdict === 'needs_revision' || entry.verdict === 'needs_rework')
        return 'ba-timeline-dot--warning';
    if (entry.verdict === 'rejected' || entry.verdict === 'blocked')
        return 'ba-timeline-dot--danger';
    return 'ba-timeline-dot--neutral';
}
export function TimelineView({ entries, stageEvents = [] }) {
    if (entries.length === 0 && stageEvents.length === 0) {
        return (_jsx(EmptyState, { title: "No timeline entries", description: "Timeline events will appear as the analysis progresses through stages." }));
    }
    return (_jsxs("div", { className: "ba-timeline", role: "list", "aria-label": "Batch analysis timeline", children: [entries.map((entry, idx) => {
                const isTerminal = TERMINAL_STAGES.has(entry.stage);
                const isLast = idx === entries.length - 1;
                return (_jsxs("div", { className: `ba-timeline-entry ${isLast ? 'ba-timeline-entry--last' : ''}`, role: "listitem", children: [_jsx("div", { className: `ba-timeline-dot ${timelineDotClass(entry)} ${isTerminal ? 'ba-timeline-dot--terminal' : ''}` }), _jsx("div", { className: "ba-timeline-time", children: formatTimestamp(entry.createdAtUtc) }), _jsxs("div", { className: "ba-timeline-content", children: [_jsx("span", { className: "ba-timeline-type", children: artifactTypeLabel(entry.artifactType) }), entry.summary && (_jsx("span", { className: "ba-timeline-summary", children: humanizeAnalysisText(entry.summary) })), entry.verdict && (_jsx(Badge, { variant: verdictBadgeVariant(entry.verdict), children: entry.verdict }))] }), _jsxs("div", { className: "ba-timeline-tags", children: [_jsx(Badge, { variant: "neutral", children: getVisibleStageLabel(entry.stage) ?? STAGE_LABELS[entry.stage] }), _jsx(Badge, { variant: "neutral", children: ROLE_LABELS[entry.role] }), entry.iteration != null && (_jsxs("span", { className: "ba-timeline-iter", children: ["#", entry.iteration] }))] })] }, `${entry.artifactId}-${idx}`));
            }), stageEvents.length > 0 && (_jsxs("div", { className: "ba-overview-section", style: { marginTop: 'var(--space-4)' }, children: [_jsx("h4", { className: "ba-section-heading", children: "Stage Event Log" }), _jsx("div", { className: "ba-detail-list", children: stageEvents.map((event) => (_jsxs("div", { className: "ba-detail-card", children: [_jsxs("div", { className: "ba-detail-card-header", children: [_jsx("div", { className: "ba-detail-card-title", children: event.summary ? humanizeAnalysisText(event.summary) : event.eventType }), _jsxs("div", { className: "ba-detail-card-meta", children: [_jsx(Badge, { variant: "neutral", children: getVisibleStageLabel(event.stage) ?? STAGE_LABELS[event.stage] }), _jsx(Badge, { variant: "neutral", children: ROLE_LABELS[event.role] }), typeof event.details?.toolCallCount === 'number' && (_jsxs(Badge, { variant: "neutral", children: [event.details.toolCallCount, " tools"] })), typeof event.details?.durationMs === 'number' && (_jsxs(Badge, { variant: "neutral", children: [Math.round(event.details.durationMs / 1000), "s"] })), typeof event.details?.attempt === 'number' && (_jsxs(Badge, { variant: "neutral", children: ["attempt ", event.details.attempt] })), event.lastReviewVerdict && (_jsx(Badge, { variant: verdictBadgeVariant(event.lastReviewVerdict), children: event.lastReviewVerdict })), _jsx("span", { className: "ba-detail-created", children: formatTimestamp(event.createdAtUtc) })] })] }), event.details && (_jsxs("details", { children: [_jsx("summary", { children: "Debug details" }), _jsx("pre", { style: { whiteSpace: 'pre-wrap', marginTop: 'var(--space-2)' }, children: JSON.stringify(event.details, null, 2) })] }))] }, event.id))) })] }))] }));
}
