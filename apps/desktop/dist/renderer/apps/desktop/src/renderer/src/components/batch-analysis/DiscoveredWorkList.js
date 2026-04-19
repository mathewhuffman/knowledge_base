import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import { actionBadgeVariant, actionLabel, discoveryStatusBadgeVariant, confidenceColor, humanizeAnalysisText, } from './helpers';
export function DiscoveredWorkList({ items, compact }) {
    if (items.length === 0) {
        return (_jsx(EmptyState, { title: "No discovered work", description: "The worker has not identified any additional work items." }));
    }
    const displayItems = compact ? items.slice(0, 3) : items;
    return (_jsxs("div", { className: "ba-discoveries", children: [displayItems.map((item, index) => {
                const isRejected = item.status === 'rejected';
                return (_jsxs("div", { className: `ba-discovery-card ${item.status === 'escalated' ? 'ba-discovery-card--escalated' : ''} ${isRejected ? 'ba-discovery-card--rejected' : ''}`, children: [_jsxs("div", { className: "ba-discovery-header", children: [_jsx(Badge, { variant: actionBadgeVariant(item.discoveredAction), children: actionLabel(item.discoveredAction) }), _jsx("span", { className: "ba-discovery-target", title: humanizeAnalysisText(item.suspectedTarget), children: humanizeAnalysisText(item.suspectedTarget) }), _jsx("span", { className: "ba-confidence-bar ba-confidence-bar--inline", title: `${Math.round(item.confidence * 100)}% confidence`, children: _jsx("span", { className: "ba-confidence-fill", style: {
                                            width: `${Math.round(item.confidence * 100)}%`,
                                            background: confidenceColor(item.confidence * 100),
                                        } }) }), item.status && (_jsx(Badge, { variant: discoveryStatusBadgeVariant(item.status), children: item.status.replace('_', ' ') }))] }), _jsx("div", { className: "ba-discovery-reason", children: humanizeAnalysisText(item.reason) }), !compact && (_jsxs(_Fragment, { children: [item.linkedPbiIds.length > 0 && (_jsx("div", { className: "ba-discovery-pbis", children: item.linkedPbiIds.map((id, pbiIndex) => (_jsx("span", { className: "ba-pbi-tag", children: id }, `${item.discoveryId}:pbi:${id}:${pbiIndex}`))) })), item.evidence.length > 0 && (_jsx("div", { className: "ba-discovery-evidence", children: item.evidence.map((ev, i) => (_jsxs("div", { className: "ba-evidence-item", children: [_jsx(Badge, { variant: "neutral", children: ev.kind }), _jsx("span", { children: humanizeAnalysisText(ev.summary) })] }, i))) })), item.requiresPlanAmendment && (_jsx("div", { className: "ba-discovery-amendment-flag", children: "Requires plan amendment" }))] }))] }, `${item.sourceWorkerRunId}:${item.discoveryId}:${index}`));
            }), compact && items.length > 3 && (_jsxs("div", { className: "ba-plan-more", children: ["+", items.length - 3, " more discovery item", items.length - 3 !== 1 ? 's' : ''] }))] }));
}
