import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { AppRoute } from '@kb-vault/shared-types';
import { routeToComponent } from './routes/routeMap';
import { Sidebar } from './components/Sidebar';
import { WorkspaceProvider, useWorkspace } from './context/WorkspaceContext';
import { AiAssistantProvider } from './components/assistant/AssistantContext';
import { DetachedAssistantWindowHost, GlobalAssistantHost } from './components/assistant/GlobalAssistantHost';
const PROPOSAL_REVIEW_TARGET_KEY = 'kbv:proposal-review-target';
const ARTICLE_EXPLORER_TARGET_KEY = 'kbv:article-explorer-target';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'kbv:sidebar-collapsed';
function loadSidebarCollapsedFromLocalStorage() {
    try {
        const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
        if (raw === null) {
            console.log('[renderer] sidebar localStorage missing');
            return null;
        }
        const value = raw === 'true';
        console.log('[renderer] sidebar localStorage read', { raw, value });
        return value;
    }
    catch (error) {
        console.warn('[renderer] sidebar localStorage read failed', String(error));
        return null;
    }
}
function saveSidebarCollapsedToLocalStorage(collapsed) {
    try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
        console.log('[renderer] sidebar localStorage write', { collapsed });
    }
    catch (error) {
        console.warn('[renderer] sidebar localStorage write failed', String(error));
    }
}
function AppShell() {
    const [activeRoute, setActiveRoute] = useState(AppRoute.KB_VAULT_HOME);
    const [boot, setBoot] = useState(null);
    const [bootError, setBootError] = useState(null);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
                .catch((error) => {
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
            .invoke('system.boot', { timestamp: new Date().toISOString() })
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
                        .catch((error) => {
                        console.error('[renderer] sidebar cache restore failed', String(error));
                    });
                    return;
                }
                setSidebarCollapsed(false);
            }
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
    const openProposalReview = useCallback((proposalId) => {
        window.sessionStorage.setItem(PROPOSAL_REVIEW_TARGET_KEY, proposalId);
        setActiveRoute(AppRoute.PROPOSAL_REVIEW);
    }, []);
    const openArticleExplorer = useCallback((target) => {
        window.sessionStorage.setItem(ARTICLE_EXPLORER_TARGET_KEY, JSON.stringify(target));
        setActiveRoute(AppRoute.ARTICLE_EXPLORER);
    }, []);
    useEffect(() => {
        if (!window.kbv?.emitAppNavigationEvents) {
            return;
        }
        return window.kbv.emitAppNavigationEvents((event) => {
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
    const Active = routeToComponent[activeRoute];
    return (_jsxs("div", { className: "app-shell", children: [_jsx(Sidebar, { activeRoute: activeRoute, onNavigate: setActiveRoute, workspaceName: activeWorkspace?.name, isConnected: boot?.ok === true, collapsed: sidebarCollapsed, onToggleCollapse: toggleSidebar }), bootError ? _jsx("p", { style: { padding: '16px', color: 'crimson' }, children: bootError }) : null, _jsxs(AiAssistantProvider, { windowRole: "main", activeRoute: activeRoute, workspaceId: activeWorkspace?.id, children: [_jsx("main", { className: "main-content", children: _jsx(Active, {}) }), _jsx(GlobalAssistantHost, {})] })] }));
}
function DetachedAssistantApp() {
    useEffect(() => {
        document.body.classList.add('body--assistant-detached');
        return () => {
            document.body.classList.remove('body--assistant-detached');
        };
    }, []);
    return (_jsx(AiAssistantProvider, { windowRole: "assistant_detached", children: _jsx(DetachedAssistantWindowHost, {}) }));
}
function getRendererWindowRole() {
    const rawRole = new URLSearchParams(window.location.search).get('windowRole');
    return rawRole === 'assistant_detached' ? 'assistant_detached' : 'main';
}
export function App() {
    if (getRendererWindowRole() === 'assistant_detached') {
        return _jsx(DetachedAssistantApp, {});
    }
    return (_jsx(WorkspaceProvider, { children: _jsx(AppShell, {}) }));
}
