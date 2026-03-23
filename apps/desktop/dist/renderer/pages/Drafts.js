import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { IconGitBranch } from '../components/icons';
export const Drafts = () => {
    const drafts = [
        { id: 'br-001', article: 'Create & Edit Chat Channels', branch: 'batch-42-update', base: 'rev-0003', status: 'active', locale: 'en-US', updated: '2 hours ago' },
        { id: 'br-002', article: 'Team Dashboard Tile Assignment', branch: 'new-article', base: 'N/A', status: 'draft', locale: 'en-US', updated: '3 hours ago' },
        { id: 'br-003', article: 'Getting Started Guide', branch: 'batch-42-edit', base: 'rev-0012', status: 'active', locale: 'en-US', updated: '1 day ago' },
        { id: 'br-004', article: 'Role Permissions', branch: 'conflict-fix', base: 'rev-0005', status: 'conflicted', locale: 'en-US', updated: '3 days ago' },
        { id: 'br-005', article: 'Chat Notifications', branch: 'batch-41-update', base: 'rev-0002', status: 'pending', locale: 'es-ES', updated: '5 days ago' },
    ];
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Drafts", subtitle: `${drafts.length} active draft branches` }), _jsx("div", { className: "route-content", children: drafts.length === 0 ? (_jsx(EmptyState, { icon: _jsx(IconGitBranch, { size: 48 }), title: "No draft branches", description: "Accept proposals from a batch review or create a draft branch from any article to start editing." })) : (_jsx("div", { className: "table-wrapper", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Article" }), _jsx("th", { children: "Branch" }), _jsx("th", { children: "Base" }), _jsx("th", { children: "Locale" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Updated" })] }) }), _jsx("tbody", { children: drafts.map((d) => (_jsxs("tr", { style: { cursor: 'pointer' }, children: [_jsx("td", { style: { fontWeight: 'var(--weight-medium)' }, children: d.article }), _jsx("td", { children: _jsx("code", { style: { fontSize: 'var(--text-xs)', background: 'var(--color-bg-muted)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }, children: d.branch }) }), _jsx("td", { style: { color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }, children: d.base }), _jsx("td", { children: _jsx(Badge, { variant: "neutral", children: d.locale }) }), _jsx("td", { children: _jsx(StatusChip, { status: d.status }) }), _jsx("td", { style: { color: 'var(--color-text-secondary)' }, children: d.updated })] }, d.id))) })] }) })) })] }));
};
