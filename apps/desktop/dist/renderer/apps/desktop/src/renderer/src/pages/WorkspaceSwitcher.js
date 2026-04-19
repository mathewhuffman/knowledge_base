import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { CreateWorkspaceModal } from '../components/CreateWorkspaceModal';
import { IconFolder, IconPlus } from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
function workspaceStateToChip(state) {
    if (state === 'active')
        return 'active';
    if (state === 'conflicted')
        return 'conflicted';
    return 'retired';
}
export const WorkspaceSwitcher = () => {
    const { workspaces, loading, error, openWorkspace, setDefaultWorkspace, createWorkspace, refreshList } = useWorkspace();
    const [showCreate, setShowCreate] = useState(false);
    const [createLoading, setCreateLoading] = useState(false);
    const [createError, setCreateError] = useState(null);
    const handleCreate = async (payload) => {
        setCreateLoading(true);
        setCreateError(null);
        const result = await createWorkspace(payload);
        setCreateLoading(false);
        if (result) {
            setShowCreate(false);
        }
        else {
            setCreateError(error ?? 'Failed to create workspace. Check your settings and try again.');
        }
    };
    const handleOpen = async (workspaceId) => {
        await openWorkspace(workspaceId);
    };
    const handleSetDefault = async (workspaceId, event) => {
        event.preventDefault();
        event.stopPropagation();
        await setDefaultWorkspace(workspaceId);
    };
    const openCreate = () => {
        setCreateError(null);
        setShowCreate(true);
    };
    const workspaceListError = error === 'Maximum call stack size exceeded' ? null : error;
    if (loading && workspaces.length === 0) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Workspaces", subtitle: "Manage your local KB workspaces" }), _jsx("div", { className: "route-content", children: _jsx(LoadingState, { message: "Loading workspaces..." }) })] }));
    }
    if (error && workspaces.length === 0) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Workspaces", subtitle: "Manage your local KB workspaces" }), _jsx("div", { className: "route-content", children: _jsx(ErrorState, { title: "No workspaces loaded yet", description: `You haven't created a workspace yet. Click "Create Workspace" to get started. ${workspaceListError ? `(${workspaceListError})` : ''}`, action: _jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)' }, children: [_jsx("button", { className: "btn btn-secondary", onClick: refreshList, children: "Retry" }), _jsx("button", { className: "btn btn-primary", onClick: openCreate, children: "Create Workspace" })] }) }) }), _jsx(CreateWorkspaceModal, { open: showCreate, onClose: () => {
                        setShowCreate(false);
                        setCreateError(null);
                    }, onCreate: handleCreate, loading: createLoading, error: createError })] }));
    }
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Workspaces", subtitle: workspaces.length > 0 ? `${workspaces.length} workspace${workspaces.length > 1 ? 's' : ''}` : 'Manage your local KB workspaces', actions: _jsxs("button", { className: "btn btn-primary", onClick: () => setShowCreate(true), children: [_jsx(IconPlus, { size: 14 }), "New Workspace"] }) }), _jsx("div", { className: "route-content", children: workspaces.length === 0 ? (_jsx(EmptyState, { icon: _jsx(IconFolder, { size: 48 }), title: "No workspaces yet", description: "No workspaces created yet. Create your first workspace to connect to a Zendesk help center.", action: _jsx("button", { className: "btn btn-primary", onClick: openCreate, children: "Create Workspace" }) })) : (_jsx("div", { style: { display: 'grid', gap: 'var(--space-3)' }, children: workspaces.map((ws) => (_jsxs("div", { className: "card card-interactive card-padded", style: { display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }, onClick: () => handleOpen(ws.id), role: "button", tabIndex: 0, onKeyDown: (e) => e.key === 'Enter' && handleOpen(ws.id), children: [_jsx("div", { style: { width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--color-primary-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: _jsx(IconFolder, { size: 20 }) }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-md)', marginBottom: 2 }, children: ws.name }), _jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }, children: ws.lastOpenedAtUtc
                                            ? `Last opened ${new Date(ws.lastOpenedAtUtc).toLocaleDateString()}`
                                            : `Created ${new Date(ws.createdAtUtc).toLocaleDateString()}` })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }, children: [_jsxs(Badge, { variant: "neutral", children: [ws.articleCount, " articles"] }), ws.draftCount > 0 && _jsxs(Badge, { variant: "primary", children: [ws.draftCount, " drafts"] }), _jsx("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: (event) => handleSetDefault(ws.id, event), disabled: ws.isDefaultWorkspace, children: ws.isDefaultWorkspace ? 'Default' : 'Set default' }), ws.isDefaultWorkspace ? _jsx(Badge, { variant: "primary", children: "Primary" }) : null, _jsx(StatusChip, { status: workspaceStateToChip(ws.state) })] })] }, ws.id))) })) }), _jsx(CreateWorkspaceModal, { open: showCreate, onClose: () => { setShowCreate(false); setCreateError(null); }, onCreate: handleCreate, loading: createLoading, error: createError })] }));
};
