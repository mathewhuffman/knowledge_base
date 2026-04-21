import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from 'react';
import { DraftBranchStatus } from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/Badge';
import { IconAlertCircle, IconCheckCircle, IconGitBranch, IconSend } from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc } from '../hooks/useIpc';
function summarizeValidation(branch) {
    const { errors, warnings, infos } = branch.validationSummary;
    if (errors > 0) {
        return {
            badge: 'danger',
            label: 'Blocked',
            detail: `${errors} error${errors === 1 ? '' : 's'}`
        };
    }
    if (warnings > 0) {
        return {
            badge: 'warning',
            label: 'Warnings',
            detail: `${warnings} warning${warnings === 1 ? '' : 's'}`
        };
    }
    if (infos > 0) {
        return {
            badge: 'primary',
            label: 'Info',
            detail: `${infos} note${infos === 1 ? '' : 's'}`
        };
    }
    return {
        badge: 'success',
        label: 'Pass',
        detail: 'No validation issues'
    };
}
function relativeTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1)
        return 'just now';
    if (mins < 60)
        return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24)
        return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
export const PublishQueue = () => {
    const { activeWorkspace } = useWorkspace();
    const listQuery = useIpc('draft.branch.list');
    const { execute: executeList } = listQuery;
    useEffect(() => {
        if (!activeWorkspace)
            return;
        void executeList({ workspaceId: activeWorkspace.id });
    }, [activeWorkspace, executeList]);
    if (!activeWorkspace) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Publish Queue", subtitle: "Open a workspace to review ready drafts." }), _jsx("div", { className: "route-content", children: _jsx(EmptyState, { icon: _jsx(IconSend, { size: 48 }), title: "No workspace selected", description: "Choose a workspace to load publish-ready draft branches." }) })] }));
    }
    if (listQuery.loading && !listQuery.data) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Publish Queue", subtitle: "Loading ready branches" }), _jsx("div", { className: "route-content", children: _jsx(LoadingState, { message: "Collecting draft branches that are marked ready to publish." }) })] }));
    }
    if (listQuery.error && !listQuery.data) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Publish Queue", subtitle: "Unable to load publish queue" }), _jsx("div", { className: "route-content", children: _jsx(ErrorState, { title: "Publish queue loading failed", description: listQuery.error }) })] }));
    }
    const queue = (listQuery.data?.branches ?? []).filter((branch) => branch.status === DraftBranchStatus.READY_TO_PUBLISH);
    const cleanCount = queue.filter((branch) => branch.validationSummary.errors === 0 && branch.validationSummary.warnings === 0).length;
    const warningCount = queue.filter((branch) => branch.validationSummary.errors === 0 && branch.validationSummary.warnings > 0).length;
    const blockedCount = queue.filter((branch) => branch.validationSummary.errors > 0).length;
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Publish Queue", subtitle: `${queue.length} ready branch${queue.length === 1 ? '' : 'es'} in ${activeWorkspace.name}`, actions: _jsxs("button", { className: "btn btn-primary", disabled: true, title: "Zendesk publishing is not wired yet.", children: [_jsx(IconSend, { size: 14 }), "Publish to Zendesk"] }) }), _jsx("div", { className: "route-content", children: queue.length === 0 ? (_jsx(EmptyState, { icon: _jsx(IconGitBranch, { size: 48 }), title: "Nothing in the queue", description: "Mark draft branches as ready in Drafts and they will appear here automatically." })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "panel", style: { marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }, children: [_jsxs(Badge, { variant: "success", children: [cleanCount, " clean"] }), warningCount > 0 && (_jsxs(Badge, { variant: "warning", children: [warningCount, " with warnings"] })), blockedCount > 0 && (_jsxs(Badge, { variant: "danger", children: [blockedCount, " blocked"] })), _jsx("span", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginLeft: 'auto' }, children: "Queue data is live. Zendesk publish calls still need the write-side integration." })] }), _jsx("div", { className: "table-wrapper", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Article" }), _jsx("th", { children: "Branch" }), _jsx("th", { children: "Locale" }), _jsx("th", { children: "Revision" }), _jsx("th", { children: "Validation" }), _jsx("th", { children: "Last Updated" })] }) }), _jsx("tbody", { children: queue.map((branch) => {
                                            const validation = summarizeValidation(branch);
                                            return (_jsxs("tr", { children: [_jsxs("td", { children: [_jsx("div", { style: { fontWeight: 'var(--weight-medium)' }, children: branch.familyTitle }), branch.changeSummary && (_jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 4 }, children: branch.changeSummary }))] }), _jsx("td", { children: _jsx("code", { style: { fontSize: 'var(--text-xs)', background: 'var(--color-bg-muted)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }, children: branch.name }) }), _jsx("td", { children: _jsx(Badge, { variant: "neutral", children: branch.locale }) }), _jsx("td", { children: _jsxs("span", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }, children: ["base r", branch.baseRevisionNumber ?? '—', ' -> ', "head r", branch.headRevisionNumber] }) }), _jsx("td", { children: _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: [_jsx(Badge, { variant: validation.badge, children: validation.label }), _jsxs("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }, children: [validation.badge === 'danger'
                                                                            ? _jsx(IconAlertCircle, { size: 12 })
                                                                            : _jsx(IconCheckCircle, { size: 12 }), validation.detail] })] }) }), _jsx("td", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }, children: relativeTime(branch.updatedAtUtc) })] }, branch.id));
                                        }) })] }) })] })) })] }));
};
