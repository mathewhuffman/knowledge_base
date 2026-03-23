import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo } from 'react';
import { RevisionState } from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { IconHome, IconRefreshCw } from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc } from '../hooks/useIpc';
export const KBVaultHome = () => {
    const { activeWorkspace } = useWorkspace();
    const treeQuery = useIpc('workspace.explorer.getTree');
    const repoQuery = useIpc('workspace.repository.info');
    useEffect(() => {
        if (activeWorkspace) {
            treeQuery.execute({ workspaceId: activeWorkspace.id });
            repoQuery.execute({ workspaceId: activeWorkspace.id });
        }
    }, [activeWorkspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    const tree = useMemo(() => {
        const data = treeQuery.data;
        if (!data)
            return [];
        if (Array.isArray(data)) {
            console.error('[KBVaultHome] Unexpected tree payload shape (raw array), normalizing directly', {
                workspaceId: activeWorkspace?.id
            });
            return data;
        }
        if (Array.isArray(data.nodes)) {
            return data.nodes;
        }
        console.error('[KBVaultHome] Invalid tree payload shape', {
            workspaceId: activeWorkspace?.id,
            payload: data
        });
        return [];
    }, [treeQuery.data, activeWorkspace?.id]);
    const stats = useMemo(() => {
        let articles = 0;
        let drafts = 0;
        let conflicted = 0;
        let retired = 0;
        tree.forEach((node) => {
            articles++;
            if (node.locales.some((l) => l.revision.draftCount > 0))
                drafts += node.locales.reduce((s, l) => s + l.revision.draftCount, 0);
            if (node.locales.some((l) => l.hasConflicts))
                conflicted++;
            if (node.familyStatus === RevisionState.RETIRED)
                retired++;
        });
        return { articles, drafts, conflicted, retired };
    }, [tree]);
    if (!activeWorkspace) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Home", subtitle: "No workspace selected" }), _jsx("div", { className: "route-content", children: _jsx(EmptyState, { icon: _jsx(IconHome, { size: 48 }), title: "No workspace open", description: "Open or create a workspace from the Workspaces page to see your dashboard." }) })] }));
    }
    if (treeQuery.loading) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Home", subtitle: activeWorkspace.name }), _jsx("div", { className: "route-content", children: _jsx(LoadingState, { message: "Loading workspace data..." }) })] }));
    }
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Home", subtitle: activeWorkspace.name, actions: _jsxs("button", { className: "btn btn-secondary btn-sm", onClick: () => treeQuery.execute({ workspaceId: activeWorkspace.id }), children: [_jsx(IconRefreshCw, { size: 13 }), "Refresh"] }) }), _jsxs("div", { className: "route-content", children: [_jsxs("div", { className: "stat-grid", style: { marginBottom: 'var(--space-6)' }, children: [_jsxs("div", { className: "stat-card", children: [_jsx("div", { className: "stat-label", children: "Article Families" }), _jsx("div", { className: "stat-value", children: stats.articles }), _jsxs("div", { className: "stat-meta", children: [activeWorkspace.enabledLocales.length, " locale", activeWorkspace.enabledLocales.length > 1 ? 's' : '', " enabled"] })] }), _jsxs("div", { className: "stat-card", children: [_jsx("div", { className: "stat-label", children: "Active Drafts" }), _jsx("div", { className: "stat-value", children: stats.drafts }), _jsx("div", { className: "stat-meta", children: "Across all articles" })] }), _jsxs("div", { className: "stat-card", children: [_jsx("div", { className: "stat-label", children: "Conflicts" }), _jsx("div", { className: "stat-value", children: stats.conflicted }), _jsx("div", { className: "stat-meta", children: stats.conflicted > 0 ? 'Needs attention' : 'All clear' })] }), _jsxs("div", { className: "stat-card", children: [_jsx("div", { className: "stat-label", children: "Workspace" }), _jsx("div", { className: "stat-value", style: { fontSize: 'var(--text-md)' }, children: _jsx(StatusChip, { status: activeWorkspace.state === 'active' ? 'active' : 'retired', label: activeWorkspace.state }) }), _jsxs("div", { className: "stat-meta", children: ["Default: ", activeWorkspace.defaultLocale] })] })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }, children: [_jsxs("div", { className: "card", children: [_jsx("div", { className: "card-header", children: _jsx("span", { className: "card-header-title", children: "Workspace Info" }) }), _jsxs("div", { className: "card-body", style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between' }, children: [_jsx("span", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }, children: "Name" }), _jsx("span", { style: { fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }, children: activeWorkspace.name })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between' }, children: [_jsx("span", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }, children: "Path" }), _jsx("span", { style: { fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }, children: activeWorkspace.path })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between' }, children: [_jsx("span", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }, children: "Created" }), _jsx("span", { style: { fontSize: 'var(--text-sm)' }, children: new Date(activeWorkspace.createdAtUtc).toLocaleDateString() })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsx("span", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }, children: "Locales" }), _jsx("div", { style: { display: 'flex', gap: 'var(--space-1)' }, children: activeWorkspace.enabledLocales.map((loc) => (_jsx(Badge, { variant: loc === activeWorkspace.defaultLocale ? 'primary' : 'neutral', children: loc }, loc))) })] }), repoQuery.data && (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between' }, children: [_jsx("span", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }, children: "DB" }), _jsx("span", { style: { fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }, children: repoQuery.data.dbPath })] }))] })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "card-header", children: _jsx("span", { className: "card-header-title", children: "Recent Articles" }) }), _jsx("div", { className: "card-body", style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }, children: tree.length === 0 ? (_jsx("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', padding: 'var(--space-4)' }, children: "No articles synced yet. Run a Zendesk sync to populate." })) : (tree.slice(0, 5).map((node) => (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }, children: node.title }), _jsxs("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }, children: [node.locales.length, " locale", node.locales.length > 1 ? 's' : ''] })] }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }, children: [node.locales.some((l) => l.revision.draftCount > 0) && _jsx(Badge, { variant: "primary", children: "Drafts" }), node.locales.some((l) => l.hasConflicts) && _jsx(Badge, { variant: "danger", children: "Conflict" })] })] }, node.familyId)))) })] })] })] })] }));
};
