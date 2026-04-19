import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState } from 'react';
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import { IconChevronRight } from '../icons';
import { actionBadgeVariant, actionLabel, executionStatusBadgeVariant, formatTimestamp, getVisibleStageLabel, STAGE_LABELS, humanizeAnalysisText, } from './helpers';
function ExecutionBar({ report }) {
    const executed = report.executedItems.filter((i) => i.status === 'executed').length;
    const blocked = report.executedItems.filter((i) => i.status === 'blocked').length;
    const skipped = report.executedItems.filter((i) => i.status === 'skipped').length;
    const total = report.executedItems.length || 1;
    return (_jsxs("div", { className: "ba-exec-section", children: [_jsxs("div", { className: "ba-exec-counts", children: [_jsxs("span", { className: "ba-exec-count ba-exec-count--executed", children: ["Executed: ", executed] }), _jsxs("span", { className: "ba-exec-count ba-exec-count--blocked", children: ["Blocked: ", blocked] }), _jsxs("span", { className: "ba-exec-count ba-exec-count--skipped", children: ["Skipped: ", skipped] })] }), _jsxs("div", { className: "ba-exec-bar", role: "img", "aria-label": `${executed} executed, ${blocked} blocked, ${skipped} skipped`, children: [executed > 0 && (_jsx("div", { className: "ba-exec-segment ba-exec-segment--executed", style: { width: `${(executed / total) * 100}%` } })), blocked > 0 && (_jsx("div", { className: "ba-exec-segment ba-exec-segment--blocked", style: { width: `${(blocked / total) * 100}%` } })), skipped > 0 && (_jsx("div", { className: "ba-exec-segment ba-exec-segment--skipped", style: { width: `${(skipped / total) * 100}%` } }))] })] }));
}
function ExecutedItemRow({ item, expanded, onToggle, }) {
    return (_jsxs("div", { className: `ba-plan-item ${expanded ? 'ba-plan-item--expanded' : ''}`, children: [_jsxs("div", { className: "ba-plan-item-row", onClick: onToggle, role: "button", tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle();
                } }, "aria-expanded": expanded, children: [_jsx("span", { className: "ba-plan-item-chevron", "aria-hidden": "true", children: _jsx(IconChevronRight, { size: 12 }) }), _jsx(Badge, { variant: actionBadgeVariant(item.action), children: actionLabel(item.action) }), _jsx("code", { className: "ba-exec-item-id", children: item.planItemId }), _jsx(Badge, { variant: executionStatusBadgeVariant(item.status), children: item.status })] }), expanded && (_jsxs("div", { className: "ba-plan-item-detail", children: [item.note && (_jsxs("div", { className: "ba-plan-item-reason", children: [_jsx("span", { className: "ba-detail-label", children: "Note:" }), _jsx("span", { children: humanizeAnalysisText(item.note) })] })), item.artifactIds && item.artifactIds.length > 0 && (_jsxs("div", { className: "ba-plan-item-meta-row", children: [_jsx("span", { className: "ba-detail-label", children: "Artifacts:" }), _jsx("span", { children: item.artifactIds.join(', ') })] }))] }))] }));
}
export function WorkerReportView({ reports, compact }) {
    const [expandedItemId, setExpandedItemId] = useState(null);
    if (reports.length === 0) {
        return (_jsx(EmptyState, { title: "No worker reports yet", description: "Reports will appear after the worker execution stage." }));
    }
    return (_jsx("div", { className: "ba-worker-reports", children: reports.map((report) => (_jsxs("div", { className: "ba-worker-report card", children: [_jsxs("div", { className: "ba-review-header", children: [_jsx("span", { className: "ba-review-title", children: "Worker Report" }), _jsx(Badge, { variant: report.status === 'completed' ? 'success' : report.status === 'failed' ? 'danger' : 'warning', children: report.status }), _jsxs("span", { className: "ba-review-meta", children: [getVisibleStageLabel(report.stage) ?? STAGE_LABELS[report.stage], " \u00B7 Iter ", report.iteration] }), _jsx("span", { className: "ba-review-time", children: formatTimestamp(report.createdAtUtc) })] }), report.summary && (_jsx("div", { className: "ba-review-summary", children: humanizeAnalysisText(report.summary) })), _jsx(ExecutionBar, { report: report }), report.blockerNotes.length > 0 && (_jsxs("div", { className: "ba-worker-blockers", children: [_jsx("span", { className: "ba-detail-label", children: "Blockers:" }), _jsx("ul", { className: "ba-delta-list", children: report.blockerNotes.map((note, i) => (_jsx("li", { children: humanizeAnalysisText(note) }, i))) })] })), !compact && (_jsx("div", { className: "ba-plan-items", children: report.executedItems.map((item) => (_jsx(ExecutedItemRow, { item: item, expanded: expandedItemId === item.planItemId, onToggle: () => setExpandedItemId((prev) => prev === item.planItemId ? null : item.planItemId) }, item.planItemId))) })), report.discoveredWork.length > 0 && (_jsx("div", { className: "ba-worker-discoveries-note", children: _jsxs(Badge, { variant: "warning", children: [report.discoveredWork.length, " discovered work item", report.discoveredWork.length !== 1 ? 's' : ''] }) }))] }, report.id))) }));
}
