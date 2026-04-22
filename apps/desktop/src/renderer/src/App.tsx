import { useCallback, useEffect, useState } from 'react';
import { AppRoute, type AiAssistantRendererWindowRole, type AppNavigationEvent, type RpcResponse } from '@kb-vault/shared-types';
import { routeToComponent } from './routes/routeMap';
import { Sidebar } from './components/Sidebar';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { AppUpdateProvider } from './context/AppUpdateContext';
import type { KbvApi } from './types/window';
import { AiAssistantProvider } from './components/assistant/AssistantContext';
import { DetachedAssistantWindowHost, GlobalAssistantHost } from './components/assistant/GlobalAssistantHost';
import { BootLoadingScreen } from './components/boot/BootLoadingScreen';
import { BootLoadingStoryboard } from './components/boot/BootLoadingStoryboard';
import { REPLAY_BOOT_EVENT } from './components/boot/bootLoadingModel';

const PROPOSAL_REVIEW_TARGET_KEY = 'kbv:proposal-review-target';
const ARTICLE_EXPLORER_TARGET_KEY = 'kbv:article-explorer-target';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'kbv:sidebar-collapsed';

interface BootData {
  workspaceRoot?: string;
  appVersion?: string;
  environment?: string;
  featureFlags?: Record<string, boolean>;
  defaultWorkspaceRoot?: string;
  uiPreferences?: {
    sidebarCollapsed?: boolean;
  };
}

declare global {
  interface Window {
    kbv: KbvApi;
  }
}

function loadSidebarCollapsedFromLocalStorage(): boolean | null {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    if (raw === null) {
      console.log('[renderer] sidebar localStorage missing');
      return null;
    }

    const value = raw === 'true';
    console.log('[renderer] sidebar localStorage read', { raw, value });
    return value;
  } catch (error) {
    console.warn('[renderer] sidebar localStorage read failed', String(error));
    return null;
  }
}

function saveSidebarCollapsedToLocalStorage(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
    console.log('[renderer] sidebar localStorage write', { collapsed });
  } catch (error) {
    console.warn('[renderer] sidebar localStorage write failed', String(error));
  }
}

function AppShell() {
  const [activeRoute, setActiveRoute] = useState<AppRoute>(AppRoute.KB_VAULT_HOME);
  const [boot, setBoot] = useState<RpcResponse<BootData> | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showBootLoading, setShowBootLoading] = useState(true);
  const [bootReplayNonce, setBootReplayNonce] = useState(0);
  const { activeWorkspace } = useWorkspace();

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      console.log('[renderer] sidebar toggle', { current, next });
      saveSidebarCollapsedToLocalStorage(next);
      void window.kbv
        .invoke('system.preferences.setSidebarCollapsed', { collapsed: next })
        .then((response) => {
          console.log('[renderer] sidebar preference persisted', {
            ok: response.ok,
            requested: next,
            returned: response.data
          });
        })
        .catch((error: unknown) => {
          console.error('[renderer] sidebar preference persist failed', String(error));
        });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!window.kbv) {
      setBootError('Preload context not loaded. Check preload path in main.ts.');
      return;
    }
    const startedAt = performance.now();

    window.kbv
      .invoke<BootData>('system.boot', { timestamp: new Date().toISOString() })
      .then((response) => {
        console.log('[renderer] system.boot', { elapsedMs: performance.now() - startedAt, ok: response.ok });
        setBoot(response);
        if (response.ok) {
          const localValue = loadSidebarCollapsedFromLocalStorage();
          const mainPreference = response.data?.uiPreferences?.sidebarCollapsed;
          const mainValue = typeof mainPreference === 'boolean' ? mainPreference : null;
          console.log('[renderer] sidebar boot preferences', {
            localValue,
            mainValue
          });

          if (mainValue !== null) {
            setSidebarCollapsed(mainValue);
            saveSidebarCollapsedToLocalStorage(mainValue);
            return;
          }

          if (localValue !== null) {
            console.warn('[renderer] sidebar preference missing in main process; restoring from local cache', {
              localValue
            });
            setSidebarCollapsed(localValue);
            void window.kbv
              .invoke('system.preferences.setSidebarCollapsed', { collapsed: localValue })
              .then((persistResponse) => {
                console.log('[renderer] sidebar preference restored from local cache', {
                  ok: persistResponse.ok,
                  collapsed: localValue
                });
              })
              .catch((error: unknown) => {
                console.error('[renderer] sidebar cache restore failed', String(error));
              });
            return;
          }

          setSidebarCollapsed(false);
        }
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

  const openProposalReview = useCallback((proposalId: string) => {
    window.sessionStorage.setItem(PROPOSAL_REVIEW_TARGET_KEY, proposalId);
    setActiveRoute(AppRoute.PROPOSAL_REVIEW);
  }, []);

  const openArticleExplorer = useCallback((target: {
    familyId: string;
    localeVariantId?: string;
    tab?: 'preview' | 'relations';
  }) => {
    window.sessionStorage.setItem(ARTICLE_EXPLORER_TARGET_KEY, JSON.stringify(target));
    setActiveRoute(AppRoute.ARTICLE_EXPLORER);
  }, []);

  useEffect(() => {
    if (!window.kbv?.emitAppNavigationEvents) {
      return;
    }
    return window.kbv.emitAppNavigationEvents((event: AppNavigationEvent) => {
      if (event.action.type === 'open_proposal_review') {
        openProposalReview(event.action.proposalId);
        return;
      }
      if (event.action.type === 'open_route') {
        setActiveRoute(event.action.route);
        return;
      }
      if (event.action.type === 'open_article_explorer') {
        openArticleExplorer({
          familyId: event.action.familyId,
          localeVariantId: event.action.localeVariantId,
          tab: event.action.tab
        });
      }
    });
  }, [openArticleExplorer, openProposalReview]);

  useEffect(() => {
    const handleReplayBoot = () => {
      setBootReplayNonce((current) => current + 1);
      setShowBootLoading(true);
    };

    window.addEventListener(REPLAY_BOOT_EVENT, handleReplayBoot);
    return () => {
      window.removeEventListener(REPLAY_BOOT_EVENT, handleReplayBoot);
    };
  }, []);

  const Active = routeToComponent[activeRoute];
  const bootResolved = boot !== null || bootError !== null;

  return (
    <div className="app-shell">
      <Sidebar
        activeRoute={activeRoute}
        onNavigate={setActiveRoute}
        workspaceName={activeWorkspace?.name}
        isConnected={boot?.ok === true}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
      />
      {bootError ? <p style={{ padding: '16px', color: 'crimson' }}>{bootError}</p> : null}
      <AppUpdateProvider>
        <AiAssistantProvider
          windowRole="main"
          activeRoute={activeRoute}
          workspaceId={activeWorkspace?.id}
        >
          <main className="main-content">
            <Active />
          </main>
          <GlobalAssistantHost />
        </AiAssistantProvider>
      </AppUpdateProvider>
      {showBootLoading ? (
        <BootLoadingScreen
          key={bootReplayNonce}
          bootResolved={bootResolved}
          onComplete={() => setShowBootLoading(false)}
        />
      ) : null}
    </div>
  );
}

function DetachedAssistantApp() {
  useEffect(() => {
    document.body.classList.add('body--assistant-detached');
    return () => {
      document.body.classList.remove('body--assistant-detached');
    };
  }, []);

  return (
    <AiAssistantProvider windowRole="assistant_detached">
      <DetachedAssistantWindowHost />
    </AiAssistantProvider>
  );
}

function getRendererWindowRole(): AiAssistantRendererWindowRole {
  const rawRole = new URLSearchParams(window.location.search).get('windowRole');
  return rawRole === 'assistant_detached' ? 'assistant_detached' : 'main';
}

function getBootPreviewMode(): 'storyboard' | null {
  const previewMode = new URLSearchParams(window.location.search).get('bootPreview');
  return previewMode === 'storyboard' ? 'storyboard' : null;
}

export function App() {
  if (getRendererWindowRole() === 'assistant_detached') {
    return <DetachedAssistantApp />;
  }

  if (getBootPreviewMode() === 'storyboard') {
    return <BootLoadingStoryboard />;
  }

  return (
    <WorkspaceProvider>
      <AppShell />
    </WorkspaceProvider>
  );
}
