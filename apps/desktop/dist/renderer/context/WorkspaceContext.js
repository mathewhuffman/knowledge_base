import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
const WorkspaceContext = createContext(null);
export function WorkspaceProvider({ children }) {
    const [workspaces, setWorkspaces] = useState([]);
    const [activeWorkspace, setActiveWorkspace] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const openWorkspace = useCallback(async (workspaceId) => {
        setLoading(true);
        setError(null);
        const startedAt = performance.now();
        try {
            const res = await window.kbv.invoke('workspace.open', { workspaceId });
            console.log('[renderer] workspace.open', {
                elapsedMs: performance.now() - startedAt,
                workspaceId,
                ok: res.ok,
                hasData: Boolean(res.data),
                error: res.error?.message
            });
            if (res.ok && res.data) {
                setActiveWorkspace(res.data);
                setLoading(false);
                return true;
            }
            else {
                setError(res.error?.message ?? 'Failed to open workspace');
                setLoading(false);
                return false;
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setLoading(false);
            return false;
        }
    }, []);
    const refreshList = useCallback(async () => {
        setLoading(true);
        setError(null);
        const startedAt = performance.now();
        try {
            const res = await window.kbv.invoke('workspace.list');
            console.log('[renderer] workspace.list', {
                elapsedMs: performance.now() - startedAt,
                ok: res.ok,
                hasData: Boolean(res.data),
                error: res.error?.message
            });
            if (res.ok && res.data) {
                if (Array.isArray(res.data)) {
                    const workspaceItems = res.data;
                    setWorkspaces(workspaceItems);
                    if (!activeWorkspace && workspaceItems.length > 0) {
                        const defaultWorkspace = workspaceItems.find((item) => item.isDefaultWorkspace) ?? workspaceItems[0];
                        if (defaultWorkspace) {
                            await openWorkspace(defaultWorkspace.id);
                        }
                    }
                }
                else if (Array.isArray(res.data.workspaces)) {
                    const workspaceItems = res.data.workspaces;
                    setWorkspaces(workspaceItems);
                    if (!activeWorkspace && workspaceItems.length > 0) {
                        const defaultWorkspace = workspaceItems.find((item) => item.isDefaultWorkspace) ?? workspaceItems[0];
                        if (defaultWorkspace) {
                            await openWorkspace(defaultWorkspace.id);
                        }
                    }
                }
                else {
                    setWorkspaces([]);
                    setError('Unexpected workspace.list payload shape');
                }
            }
            else {
                const message = res.error?.message ?? 'Failed to load workspaces';
                if (message === 'Maximum call stack size exceeded') {
                    setWorkspaces([]);
                    setError(null);
                }
                else {
                    setError(message);
                }
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setLoading(false);
        }
    }, [activeWorkspace, openWorkspace]);
    const setDefaultWorkspace = useCallback(async (workspaceId) => {
        setLoading(true);
        setError(null);
        const startedAt = performance.now();
        try {
            const res = await window.kbv.invoke('workspace.default.set', { workspaceId });
            console.log('[renderer] workspace.default.set', {
                elapsedMs: performance.now() - startedAt,
                workspaceId,
                ok: res.ok,
                hasData: Boolean(res.data),
                error: res.error?.message
            });
            if (res.ok) {
                await refreshList();
                setLoading(false);
                return true;
            }
            setError(res.error?.message ?? 'Failed to set default workspace');
            setLoading(false);
            return false;
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setLoading(false);
            return false;
        }
    }, [refreshList]);
    const createWorkspace = useCallback(async (payload) => {
        setLoading(true);
        setError(null);
        const startedAt = performance.now();
        try {
            const res = await window.kbv.invoke('workspace.create', payload);
            console.log('[renderer] workspace.create', {
                elapsedMs: performance.now() - startedAt,
                ok: res.ok,
                hasData: Boolean(res.data),
                error: res.error?.message
            });
            if (res.ok && res.data) {
                setActiveWorkspace(res.data);
                // Refresh list to include the new workspace
                await refreshList();
                setLoading(false);
                return res.data;
            }
            else {
                setError(res.error?.message ?? 'Failed to create workspace');
                setLoading(false);
                return null;
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setLoading(false);
            return null;
        }
    }, [refreshList]);
    const closeWorkspace = useCallback(() => {
        setActiveWorkspace(null);
    }, []);
    // Load workspace list on mount
    useEffect(() => {
        if (window.kbv) {
            console.log('[renderer] WorkspaceContext mounted');
            refreshList();
        }
    }, [refreshList]);
    return (_jsx(WorkspaceContext.Provider, { value: {
            workspaces,
            activeWorkspace,
            loading,
            error,
            refreshList,
            openWorkspace,
            setDefaultWorkspace,
            createWorkspace,
            closeWorkspace,
        }, children: children }));
}
export function useWorkspace() {
    const ctx = useContext(WorkspaceContext);
    if (!ctx) {
        throw new Error('useWorkspace must be used within a WorkspaceProvider');
    }
    return ctx;
}
