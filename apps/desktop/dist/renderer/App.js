import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { AppRoute } from '@kb-vault/shared-types';
import { routeToComponent } from './routes/routeMap';
import { Sidebar } from './components/Sidebar';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
function AppShell() {
    const [activeRoute, setActiveRoute] = useState(AppRoute.KB_VAULT_HOME);
    const [boot, setBoot] = useState(null);
    const [bootError, setBootError] = useState(null);
    const { activeWorkspace } = useWorkspace();
    useEffect(() => {
        if (!window.kbv) {
            setBootError('Preload context not loaded. Check preload path in main.ts.');
            return;
        }
        const startedAt = performance.now();
        window.kbv
            .invoke('system.boot', { timestamp: new Date().toISOString() })
            .then((response) => {
            console.log('[renderer] system.boot', { elapsedMs: performance.now() - startedAt, ok: response.ok });
            setBoot(response);
        })
            .catch((error) => {
            setBootError(String(error));
        });
    }, []);
    // When no workspace is active, nudge to workspace switcher
    useEffect(() => {
        if (!activeWorkspace && activeRoute !== AppRoute.WORKSPACE_SWITCHER && activeRoute !== AppRoute.SETTINGS) {
            // Don't auto-navigate — just let pages show their empty states
        }
    }, [activeWorkspace, activeRoute]);
    const Active = routeToComponent[activeRoute];
    return (_jsxs("div", { className: "app-shell", children: [_jsx(Sidebar, { activeRoute: activeRoute, onNavigate: setActiveRoute, workspaceName: activeWorkspace?.name, isConnected: boot?.ok === true }), bootError ? _jsx("p", { style: { padding: '16px', color: 'crimson' }, children: bootError }) : null, _jsx("main", { className: "main-content", children: _jsx(Active, {}) })] }));
}
export function App() {
    return (_jsx(WorkspaceProvider, { children: _jsx(AppShell, {}) }));
}
