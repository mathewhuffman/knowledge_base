import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Badge } from '../Badge';
import { EmptyState } from '../EmptyState';
import { IconChevronRight, IconTerminal } from '../icons';
import { getVisibleStageLabel, STAGE_LABELS, ROLE_LABELS, formatTimestamp } from './helpers';
function artifactIcon(type) {
    switch (type) {
        case 'plan':
            return 'Plan';
        case 'review':
            return 'Review';
        case 'worker_report':
            return 'Worker';
        case 'amendment':
            return 'Amendment';
        case 'final_review':
            return 'Final Review';
        case 'iteration':
            return 'Iteration';
        case 'stage_run':
            return 'Stage Run';
        default:
            return type;
    }
}
export function ArtifactTranscriptLink({ links, onOpenSession }) {
    if (links.length === 0) {
        return (_jsx(EmptyState, { icon: _jsx(IconTerminal, { size: 32 }), title: "No transcript links", description: "Transcript links will appear as stage artifacts are created." }));
    }
    return (_jsx("div", { className: "ba-transcript-links", role: "list", "aria-label": "Artifact transcript links", children: links.map((link, idx) => (_jsxs("div", { className: "ba-transcript-link", role: "listitem", tabIndex: link.sessionId ? 0 : undefined, onClick: () => link.sessionId && onOpenSession?.(link.sessionId), onKeyDown: (e) => {
                if ((e.key === 'Enter' || e.key === ' ') && link.sessionId) {
                    e.preventDefault();
                    onOpenSession?.(link.sessionId);
                }
            }, children: [_jsxs("div", { className: "ba-transcript-link-left", children: [_jsx("span", { className: "ba-transcript-link-type", children: artifactIcon(link.artifactType) }), _jsx(Badge, { variant: "neutral", children: getVisibleStageLabel(link.stage) ?? STAGE_LABELS[link.stage] }), _jsx(Badge, { variant: "neutral", children: ROLE_LABELS[link.role] }), link.agentModelId && (_jsx("code", { className: "ba-transcript-link-model", children: link.agentModelId }))] }), _jsxs("div", { className: "ba-transcript-link-right", children: [_jsx("span", { className: "ba-transcript-link-time", children: formatTimestamp(link.createdAtUtc) }), link.sessionId && (_jsx(IconChevronRight, { size: 14, className: "ba-transcript-link-chevron" }))] })] }, `${link.artifactId}-${idx}`))) }));
}
