import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { IconCheckCircle, IconAlertCircle, IconFileText, IconGitBranch, IconEye, IconTool, IconArrowUpRight, IconRefreshCw, IconX, IconXCircle } from '../icons';
const TYPE_META = {
    informational_response: { label: 'Response', icon: _jsx(IconFileText, { size: 14 }), family: 'info' },
    proposal_candidate: { label: 'New Proposal', icon: _jsx(IconArrowUpRight, { size: 14 }), family: 'proposal' },
    proposal_patch: { label: 'Proposal Refinement', icon: _jsx(IconEye, { size: 14 }), family: 'patch' },
    draft_patch: { label: 'Draft Update', icon: _jsx(IconGitBranch, { size: 14 }), family: 'patch' },
    template_patch: { label: 'Template Update', icon: _jsx(IconTool, { size: 14 }), family: 'patch' },
    navigation_suggestion: { label: 'Navigation', icon: _jsx(IconArrowUpRight, { size: 14 }), family: 'info' },
    clarification_request: { label: 'Clarification Needed', icon: _jsx(IconAlertCircle, { size: 14 }), family: 'info' }
};
const STATUS_LABELS = {
    pending: 'Awaiting your decision',
    applied: 'Applied',
    rejected: 'Rejected',
    superseded: 'Superseded'
};
export function AssistantArtifactCard({ artifact, stale, loading, onDismiss, onApply, onReject, onRerun }) {
    const meta = TYPE_META[artifact.artifactType] ?? TYPE_META.informational_response;
    const isPending = artifact.status === 'pending';
    const isProposalCandidate = artifact.artifactType === 'proposal_candidate';
    const isPatch = meta.family === 'patch';
    const isProposalRefinement = artifact.artifactType === 'proposal_patch';
    const isClarification = artifact.artifactType === 'clarification_request';
    const showDismissButton = (isProposalCandidate || isProposalRefinement || isClarification) && Boolean(onDismiss);
    return (_jsxs("div", { className: [
            'ai-artifact',
            `ai-artifact--${artifact.status}`,
            `ai-artifact--${meta.family}`,
            (isProposalCandidate || isProposalRefinement || isClarification) && 'ai-artifact--candidate',
            stale && 'ai-artifact--stale'
        ]
            .filter(Boolean)
            .join(' '), role: "region", "aria-label": `${meta.label}: ${artifact.summary}`, children: [_jsxs("div", { className: "ai-artifact__type-row", children: [_jsxs("span", { className: "ai-artifact__type-badge", children: [meta.icon, _jsx("span", { children: meta.label })] }), _jsxs("div", { className: "ai-artifact__type-row-actions", children: [_jsx("span", { className: `ai-artifact__status ai-artifact__status--${artifact.status}`, children: stale ? 'Stale — version changed' : STATUS_LABELS[artifact.status] ?? artifact.status }), showDismissButton && (_jsx("button", { type: "button", className: "ai-artifact__dismiss", onClick: onDismiss, disabled: loading, "aria-label": `Dismiss ${meta.label.toLowerCase()}`, title: "Dismiss", children: _jsx(IconX, { size: 14 }) }))] })] }), _jsx("div", { className: "ai-artifact__summary", children: artifact.summary }), stale && isPending && (_jsxs("div", { className: "ai-artifact__stale-warning", role: "alert", children: [_jsx(IconAlertCircle, { size: 14 }), _jsxs("div", { children: [_jsx("strong", { children: "Content has changed" }), " since this was generated. You can re-run the request or review carefully before applying."] })] })), isPatch && artifact.status === 'applied' && (_jsxs("div", { className: "ai-artifact__applied-note", children: [_jsx(IconCheckCircle, { size: 14 }), _jsx("span", { children: "Working copy updated \u2014 save when ready" })] })), isProposalCandidate && isPending && (_jsxs("div", { className: "ai-artifact__actions", children: [_jsxs("button", { type: "button", className: "ai-artifact__btn ai-artifact__btn--apply", onClick: onApply, disabled: loading, children: [_jsx(IconCheckCircle, { size: 14 }), "Create Proposal"] }), _jsxs("button", { type: "button", className: "ai-artifact__btn ai-artifact__btn--reject", onClick: onReject, disabled: loading, children: [_jsx(IconXCircle, { size: 14 }), "Dismiss"] })] })), stale && isPending && (_jsx("div", { className: "ai-artifact__actions ai-artifact__actions--stale", children: _jsxs("button", { type: "button", className: "ai-artifact__btn ai-artifact__btn--rerun", onClick: onRerun, disabled: loading, title: "Re-run with current content", children: [_jsx(IconRefreshCw, { size: 14 }), "Re-run"] }) }))] }));
}
