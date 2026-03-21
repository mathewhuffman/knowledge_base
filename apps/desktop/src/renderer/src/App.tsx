import { useEffect, useState } from 'react';
import { AppRoute, type RpcResponse } from '@kb-vault/shared-types';
import { routeToComponent } from './routes/routeMap';
import { Sidebar } from './components/Sidebar';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import type { KbvApi } from './types/window';

declare global {
  interface Window {
    kbv: KbvApi;
  }
}

function AppShell() {
  const [activeRoute, setActiveRoute] = useState<AppRoute>(AppRoute.KB_VAULT_HOME);
  const [boot, setBoot] = useState<RpcResponse | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
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
      .catch((error: unknown) => {
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

  return (
    <div className="app-shell">
      <Sidebar
        activeRoute={activeRoute}
        onNavigate={setActiveRoute}
        workspaceName={activeWorkspace?.name}
        isConnected={boot?.ok === true}
      />
      {bootError ? <p style={{ padding: '16px', color: 'crimson' }}>{bootError}</p> : null}
      <main className="main-content">
        <Active />
      </main>
    </div>
  );
}

export function App() {
  return (
    <WorkspaceProvider>
      <AppShell />
    </WorkspaceProvider>
  );
}
