import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useRef, useCallback } from 'react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { LoadingState } from '../components/LoadingState';
import { HealthStatusPanel, SessionListPanel, SessionDetailPanel } from '../components/AgentRuntimePanel';
import { IconSettings, IconSearch, IconRefreshCw, IconCheckCircle, IconAlertCircle, IconFolder } from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc, useIpcMutation } from '../hooks/useIpc';
const LOCALE_OPTIONS = [
    { value: 'en-us', label: 'English (en-US)' },
    { value: 'es-es', label: 'Spanish (es-ES)' },
    { value: 'fr-fr', label: 'French (fr-FR)' },
    { value: 'de-de', label: 'German (de-DE)' },
    { value: 'pt-br', label: 'Portuguese (pt-BR)' },
    { value: 'ja-jp', label: 'Japanese (ja-JP)' },
];
function syncStateBadgeVariant(state) {
    switch (state) {
        case 'QUEUED': return 'warning';
        case 'RUNNING': return 'primary';
        case 'SUCCEEDED': return 'success';
        case 'FAILED': return 'danger';
        case 'CANCELED': return 'neutral';
        default: return 'neutral';
    }
}
function isUpToDateSyncMessage(message) {
    if (!message) {
        return false;
    }
    const normalized = message.trim().toLowerCase();
    return normalized === 'article family update requires at least one field';
}
function formatRelativeTime(utc) {
    const diff = Date.now() - new Date(utc).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)
        return 'just now';
    if (mins < 60)
        return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)
        return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}
/* ================================================================== */
/* ZendeskCredentialSection                                            */
/* ================================================================== */
function ZendeskCredentialSection({ workspaceId, subdomain, credential, credentialLoading, onCredentialsSaved, }) {
    const saveMutation = useIpcMutation('zendesk.credentials.save');
    const [email, setEmail] = useState('');
    const [apiToken, setApiToken] = useState('');
    const [saveSuccess, setSaveSuccess] = useState(false);
    useEffect(() => {
        setEmail(credential?.email ?? '');
        setApiToken('');
    }, [credential]);
    const handleSave = async () => {
        setSaveSuccess(false);
        const result = await saveMutation.mutate({ workspaceId, email, apiToken });
        if (result) {
            setSaveSuccess(true);
            setApiToken('');
            onCredentialsSaved();
            setTimeout(() => setSaveSuccess(false), 3000);
        }
    };
    return (_jsxs("div", { className: "card", style: { marginBottom: 'var(--space-4)' }, children: [_jsxs("div", { className: "card-header", children: [_jsx("span", { className: "card-header-title", children: "Credentials" }), _jsx(StatusChip, { status: credential ? 'active' : 'pending', label: credentialLoading ? 'Loading...' : credential ? 'Configured' : 'Not configured' })] }), _jsxs("div", { className: "card-body", style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }, children: [_jsxs("div", { children: [_jsx("label", { className: "settings-label", children: "Subdomain" }), _jsx("div", { className: "settings-value-readonly", children: subdomain ? `${subdomain}.zendesk.com` : 'Not configured — set in workspace creation' })] }), _jsxs("div", { children: [_jsx("label", { className: "settings-label", children: "Email" }), _jsx("input", { className: "input", value: email, onChange: (e) => setEmail(e.target.value), placeholder: "your-email@company.com" })] }), _jsxs("div", { children: [_jsx("label", { className: "settings-label", children: "API Token" }), _jsx("input", { className: "input", type: "password", value: apiToken, onChange: (e) => setApiToken(e.target.value), placeholder: credential?.hasApiToken ? 'Token saved — enter new value to update' : 'Zendesk API token' }), _jsx("div", { className: "settings-hint", children: "Stored securely in your OS keychain via Electron safeStorage" })] }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }, children: [_jsx("button", { className: "btn btn-primary", onClick: handleSave, disabled: saveMutation.loading || !email.trim() || !apiToken.trim(), children: saveMutation.loading ? 'Saving...' : 'Save Credentials' }), saveSuccess && (_jsxs("span", { className: "settings-inline-success", children: [_jsx(IconCheckCircle, { size: 14 }), " Saved"] })), saveMutation.error && (_jsx("span", { className: "settings-inline-error", children: saveMutation.error }))] })] })] }));
}
/* ================================================================== */
/* ZendeskConnectionTestSection                                        */
/* ================================================================== */
function ZendeskConnectionTestSection({ workspaceId }) {
    const testMutation = useIpcMutation('zendesk.connection.test');
    const [testState, setTestState] = useState('idle');
    const [testResult, setTestResult] = useState(null);
    const handleTest = async () => {
        setTestState('testing');
        setTestResult(null);
        const result = await testMutation.mutate({ workspaceId });
        if (result) {
            setTestResult(result);
            setTestState(result.ok ? 'success' : 'failed');
        }
        else {
            setTestState('failed');
        }
    };
    return (_jsxs("div", { className: "card", style: { marginBottom: 'var(--space-4)' }, children: [_jsxs("div", { className: "card-header", children: [_jsx("span", { className: "card-header-title", children: "Connection Test" }), testState === 'success' && _jsx(Badge, { variant: "success", children: "Connected" }), testState === 'failed' && _jsx(Badge, { variant: "danger", children: "Failed" })] }), _jsx("div", { className: "card-body", children: _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }, children: [_jsx("button", { className: "btn btn-secondary", onClick: handleTest, disabled: testState === 'testing', children: testState === 'testing' ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "spinner", style: { width: 14, height: 14, borderWidth: 2 } }), "Testing..."] })) : ('Test Connection') }), testState === 'success' && testResult && (_jsxs("div", { className: "settings-test-result settings-test-result--success", children: [_jsx(IconCheckCircle, { size: 16 }), _jsxs("div", { children: [_jsx("div", { style: { fontWeight: 'var(--weight-medium)' }, children: "Connection successful" }), _jsxs("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }, children: ["HTTP ", testResult.status, " at ", new Date(testResult.checkedAtUtc).toLocaleTimeString()] })] })] })), testState === 'failed' && (_jsxs("div", { className: "settings-test-result settings-test-result--failed", children: [_jsx(IconAlertCircle, { size: 16 }), _jsxs("div", { children: [_jsx("div", { style: { fontWeight: 'var(--weight-medium)' }, children: "Connection failed" }), _jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }, children: testMutation.error
                                                ? testMutation.error
                                                : testResult
                                                    ? `HTTP ${testResult.status} — check credentials and subdomain`
                                                    : 'Unable to reach Zendesk API' })] })] }))] }) })] }));
}
/* ================================================================== */
/* ZendeskSyncSection                                                  */
/* ================================================================== */
function ZendeskSyncSection({ workspaceId }) {
    const latestSyncQuery = useIpc('zendesk.sync.getLatest');
    const [syncMode, setSyncMode] = useState('full');
    const [syncJobId, setSyncJobId] = useState(null);
    const [syncProgress, setSyncProgress] = useState(0);
    const [syncMessage, setSyncMessage] = useState('');
    const [syncState, setSyncState] = useState('');
    const [syncCanceling, setSyncCanceling] = useState(false);
    const syncJobIdRef = useRef(null);
    const { execute: executeLatestSync } = latestSyncQuery;
    useEffect(() => {
        executeLatestSync({ workspaceId });
    }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
    // Job event listener
    useEffect(() => {
        const handler = (event) => {
            if (event.command !== 'zendesk.sync.run')
                return;
            if (syncJobIdRef.current && event.id !== syncJobIdRef.current)
                return;
            const st = event.state;
            setSyncState(st);
            setSyncProgress(event.progress);
            setSyncMessage(event.message ?? '');
            if (st === 'SUCCEEDED' || st === 'FAILED' || st === 'CANCELED') {
                executeLatestSync({ workspaceId });
            }
        };
        const unsubscribe = window.kbv.emitJobEvents(handler);
        return () => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, [executeLatestSync, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleRunSync = async () => {
        const response = await window.kbv.startJob('zendesk.sync.run', { workspaceId, mode: syncMode });
        if (response.jobId) {
            setSyncJobId(response.jobId);
            syncJobIdRef.current = response.jobId;
            setSyncState('QUEUED');
            setSyncProgress(0);
            setSyncMessage(`Queued ${syncMode} sync...`);
        }
    };
    const handleCancelSync = async () => {
        if (!syncJobId)
            return;
        setSyncCanceling(true);
        try {
            const response = await window.kbv.cancelJob(syncJobId);
            if (response?.state === 'CANCELED') {
                setSyncState('CANCELED');
                setSyncMessage('Sync canceled.');
            }
        }
        finally {
            setSyncCanceling(false);
        }
    };
    const isRunning = syncState === 'RUNNING' || syncState === 'QUEUED';
    const latestSync = latestSyncQuery.data;
    const currentSyncIsUpToDate = isUpToDateSyncMessage(syncMessage);
    const latestSyncIsUpToDate = isUpToDateSyncMessage(latestSync?.remoteError);
    const latestSyncBadgeVariant = latestSyncIsUpToDate
        ? 'success'
        : syncStateBadgeVariant(latestSync?.state ?? '');
    const latestSyncBadgeLabel = latestSyncIsUpToDate ? 'UP TO DATE' : latestSync?.state;
    return (_jsxs("div", { className: "card", style: { marginBottom: 'var(--space-4)' }, children: [_jsxs("div", { className: "card-header", children: [_jsx("span", { className: "card-header-title", children: "Sync" }), latestSync && (_jsx(Badge, { variant: latestSyncBadgeVariant, children: latestSyncBadgeLabel }))] }), _jsxs("div", { className: "card-body", style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: [_jsxs("select", { className: "select", style: { width: 'auto', minWidth: 140 }, value: syncMode, onChange: (e) => setSyncMode(e.target.value), disabled: isRunning, children: [_jsx("option", { value: "full", children: "Full Sync" }), _jsx("option", { value: "incremental", children: "Incremental Sync" })] }), _jsxs("button", { className: "btn btn-primary", onClick: handleRunSync, disabled: isRunning, children: [_jsx(IconRefreshCw, { size: 14 }), isRunning ? 'Syncing...' : 'Run Sync'] }), isRunning && (_jsx("button", { className: "btn btn-danger btn-sm", onClick: handleCancelSync, disabled: syncCanceling, children: syncCanceling ? 'Canceling...' : 'Cancel' }))] }), syncState && (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }, children: [_jsx("span", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }, children: currentSyncIsUpToDate ? 'You’re up to date' : (syncMessage || syncState) }), _jsxs("span", { style: { fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)' }, children: [syncProgress, "%"] })] }), _jsx("div", { className: "progress-bar", style: { height: 6 }, children: _jsx("div", { className: "progress-bar-fill", style: {
                                        width: `${syncProgress}%`,
                                        background: currentSyncIsUpToDate
                                            ? 'var(--color-success)'
                                            : syncState === 'FAILED' || syncState === 'CANCELED'
                                                ? 'var(--color-danger)'
                                                : syncState === 'SUCCEEDED'
                                                    ? 'var(--color-success)'
                                                    : undefined,
                                    } }) }), currentSyncIsUpToDate ? (_jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-success)', marginTop: 'var(--space-1)' }, children: "No article family changes were needed for this sync." })) : ((syncState === 'FAILED' || syncState === 'CANCELED') && (_jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-danger)', marginTop: 'var(--space-1)' }, children: syncState === 'FAILED' ? 'Sync failed — check credentials and network connection' : 'Sync was canceled' })))] })), latestSync ? (_jsxs("div", { className: "panel", style: { padding: 'var(--space-3)' }, children: [_jsx("div", { style: { fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 'var(--space-2)' }, children: "Last Sync" }), _jsxs("div", { className: "stat-grid", style: { gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }, children: [_jsx(SyncStat, { label: "Articles", value: latestSync.syncedArticles }), _jsx(SyncStat, { label: "Skipped", value: latestSync.skippedArticles }), _jsx(SyncStat, { label: "Families", value: latestSync.createdFamilies }), _jsx(SyncStat, { label: "Variants", value: latestSync.createdVariants }), _jsx(SyncStat, { label: "Revisions", value: latestSync.createdRevisions }), _jsx(SyncStat, { label: "Mode", value: latestSync.mode, isText: true })] }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }, children: [latestSync.startedAtUtc && _jsxs("span", { children: ["Started ", formatRelativeTime(latestSync.startedAtUtc)] }), latestSync.endedAtUtc && _jsxs("span", { children: ["Completed ", formatRelativeTime(latestSync.endedAtUtc)] })] }), latestSync.cursorSummary && Object.keys(latestSync.cursorSummary).length > 0 && (_jsxs("div", { style: { marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }, children: ["Locale cursors: ", Object.entries(latestSync.cursorSummary).map(([loc, cur]) => `${loc}:${cur}`).join(', ')] })), latestSync.remoteError && (latestSyncIsUpToDate ? (_jsxs("div", { style: {
                                    marginTop: 'var(--space-2)',
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 'var(--space-2)',
                                    padding: 'var(--space-3)',
                                    borderRadius: 'var(--radius-md)',
                                    background: 'rgba(34, 197, 94, 0.10)',
                                    border: '1px solid rgba(34, 197, 94, 0.35)',
                                    color: 'var(--color-text)'
                                }, children: [_jsx(IconCheckCircle, { size: 14 }), _jsxs("div", { children: [_jsx("div", { style: { fontWeight: 'var(--weight-medium)' }, children: "You're up to date" }), _jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }, children: "No article family changes were needed for this sync." })] })] })) : (_jsxs("div", { className: "settings-error-banner", style: { marginTop: 'var(--space-2)' }, children: [_jsx(IconAlertCircle, { size: 14 }), _jsxs("div", { children: [_jsx("div", { style: { fontWeight: 'var(--weight-medium)' }, children: "Remote error" }), _jsx("div", { children: latestSync.remoteError })] })] })))] })) : (_jsx("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', padding: 'var(--space-3)' }, children: "No sync history yet. Run a full sync to pull your Zendesk content." }))] })] }));
}
function SyncStat({ label, value, isText }) {
    return (_jsxs("div", { children: [_jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }, children: label }), _jsx("div", { style: { fontSize: isText ? 'var(--text-sm)' : 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', textTransform: isText ? 'capitalize' : undefined }, children: value })] }));
}
/* ================================================================== */
/* ZendeskTaxonomyBrowser                                              */
/* ================================================================== */
function ZendeskTaxonomyBrowser({ workspaceId }) {
    const categoriesQuery = useIpc('zendesk.categories.list');
    const sectionsQuery = useIpc('zendesk.sections.list');
    const searchQuery = useIpc('zendesk.articles.search');
    const [locale, setLocale] = useState('en-us');
    const [selectedCategoryId, setSelectedCategoryId] = useState(null);
    const [searchText, setSearchText] = useState('');
    const [activeTab, setActiveTab] = useState('browse');
    const loadCategories = useCallback(() => {
        categoriesQuery.execute({ workspaceId, locale });
    }, [workspaceId, locale]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        loadCategories();
    }, [loadCategories]);
    useEffect(() => {
        if (selectedCategoryId !== null) {
            sectionsQuery.execute({ workspaceId, locale, categoryId: selectedCategoryId });
        }
    }, [selectedCategoryId, workspaceId, locale]); // eslint-disable-line react-hooks/exhaustive-deps
    // Search debounce
    useEffect(() => {
        if (activeTab !== 'search' || searchText.trim().length < 2)
            return;
        const timer = setTimeout(() => {
            searchQuery.execute({ workspaceId, locale, query: searchText.trim() });
        }, 400);
        return () => clearTimeout(timer);
    }, [searchText, workspaceId, locale, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps
    return (_jsxs("div", { className: "card", style: { marginBottom: 'var(--space-4)' }, children: [_jsxs("div", { className: "card-header", children: [_jsx("span", { className: "card-header-title", children: "Zendesk Content Browser" }), _jsx("select", { className: "select", style: { width: 'auto', minWidth: 120, padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-xs)' }, value: locale, onChange: (e) => {
                            setLocale(e.target.value);
                            setSelectedCategoryId(null);
                        }, children: LOCALE_OPTIONS.map((opt) => (_jsx("option", { value: opt.value, children: opt.label }, opt.value))) })] }), _jsxs("div", { className: "tab-bar", children: [_jsx("button", { className: `tab-item ${activeTab === 'browse' ? 'active' : ''}`, onClick: () => setActiveTab('browse'), children: "Browse" }), _jsx("button", { className: `tab-item ${activeTab === 'search' ? 'active' : ''}`, onClick: () => setActiveTab('search'), children: "Search Articles" })] }), _jsx("div", { className: "card-body", children: activeTab === 'browse' ? (_jsxs("div", { style: { display: 'flex', gap: 'var(--space-4)' }, children: [_jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsx("div", { className: "settings-section-label", children: "Categories" }), categoriesQuery.loading ? (_jsx("div", { style: { padding: 'var(--space-3)', textAlign: 'center' }, children: _jsx("span", { className: "spinner", style: { width: 16, height: 16, borderWidth: 2 } }) })) : categoriesQuery.error ? (_jsx("div", { className: "settings-inline-error", style: { padding: 'var(--space-2)' }, children: categoriesQuery.error })) : !categoriesQuery.data || categoriesQuery.data.length === 0 ? (_jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', padding: 'var(--space-2)' }, children: "No categories found. Run a sync first." })) : (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 1 }, children: categoriesQuery.data.map((cat) => (_jsxs("button", { className: `btn ${selectedCategoryId === cat.id ? 'btn-secondary' : 'btn-ghost'} btn-sm`, style: { justifyContent: 'flex-start', width: '100%' }, onClick: () => setSelectedCategoryId(cat.id), children: [_jsx(IconFolder, { size: 12 }), _jsx("span", { style: { flex: 1, textAlign: 'left' }, children: cat.name }), cat.position !== undefined && (_jsxs("span", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }, children: ["#", cat.position] }))] }, cat.id))) }))] }), _jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsx("div", { className: "settings-section-label", children: "Sections" }), selectedCategoryId === null ? (_jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', padding: 'var(--space-2)' }, children: "Select a category to view sections" })) : sectionsQuery.loading ? (_jsx("div", { style: { padding: 'var(--space-3)', textAlign: 'center' }, children: _jsx("span", { className: "spinner", style: { width: 16, height: 16, borderWidth: 2 } }) })) : sectionsQuery.error ? (_jsx("div", { className: "settings-inline-error", style: { padding: 'var(--space-2)' }, children: sectionsQuery.error })) : !sectionsQuery.data || sectionsQuery.data.length === 0 ? (_jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', padding: 'var(--space-2)' }, children: "No sections in this category" })) : (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 1 }, children: sectionsQuery.data.map((sec) => (_jsxs("div", { className: "btn btn-ghost btn-sm", style: { justifyContent: 'flex-start', width: '100%', cursor: 'default' }, children: [_jsx("span", { style: { flex: 1, textAlign: 'left' }, children: sec.name }), sec.position !== undefined && (_jsxs("span", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }, children: ["#", sec.position] }))] }, sec.id))) }))] })] })) : (
                /* Search tab */
                _jsxs("div", { children: [_jsxs("div", { style: { position: 'relative', marginBottom: 'var(--space-3)' }, children: [_jsx("input", { className: "input", placeholder: "Search Zendesk articles...", value: searchText, onChange: (e) => setSearchText(e.target.value), style: { paddingLeft: 32 } }), _jsx(IconSearch, { size: 14, className: "" })] }), searchText.trim().length < 2 ? (_jsx("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', padding: 'var(--space-4)' }, children: "Type at least 2 characters to search" })) : searchQuery.loading ? (_jsx("div", { style: { padding: 'var(--space-4)', textAlign: 'center' }, children: _jsx("span", { className: "spinner", style: { width: 16, height: 16, borderWidth: 2 } }) })) : searchQuery.error ? (_jsx("div", { className: "settings-inline-error", style: { padding: 'var(--space-2)' }, children: searchQuery.error })) : !searchQuery.data || searchQuery.data.length === 0 ? (_jsx(EmptyState, { icon: _jsx(IconSearch, { size: 32 }), title: "No results", description: `No articles matching "${searchText}" in ${locale}` })) : (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }, children: [_jsxs("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)' }, children: [searchQuery.data.length, " result", searchQuery.data.length !== 1 ? 's' : ''] }), searchQuery.data.map((article) => (_jsxs("div", { style: {
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--space-3)',
                                        padding: 'var(--space-2) var(--space-3)',
                                        borderRadius: 'var(--radius-md)',
                                        fontSize: 'var(--text-sm)',
                                        background: 'var(--color-bg-subtle)',
                                    }, children: [_jsx("span", { style: { flex: 1, fontWeight: 'var(--weight-medium)' }, children: article.title }), _jsx(Badge, { variant: "neutral", children: article.locale }), article.updatedAtUtc && (_jsx("span", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }, children: formatRelativeTime(article.updatedAtUtc) }))] }, article.id)))] }))] })) })] }));
}
/* ================================================================== */
/* Main Settings page                                                  */
/* ================================================================== */
export const Settings = () => {
    const { activeWorkspace } = useWorkspace();
    const settingsQuery = useIpc('workspace.settings.get');
    const repoQuery = useIpc('workspace.repository.info');
    const settingsMutation = useIpcMutation('workspace.settings.update');
    const credentialsQuery = useIpc('zendesk.credentials.get');
    const [activeSection, setActiveSection] = useState('zendesk');
    const [selectedSession, setSelectedSession] = useState(null);
    // Form state for locale settings
    const [defaultLocale, setDefaultLocale] = useState('');
    const [enabledLocales, setEnabledLocales] = useState([]);
    const [saveSuccess, setSaveSuccess] = useState(false);
    useEffect(() => {
        if (activeWorkspace) {
            settingsQuery.execute({ workspaceId: activeWorkspace.id });
            repoQuery.execute({ workspaceId: activeWorkspace.id });
            credentialsQuery.execute({ workspaceId: activeWorkspace.id });
        }
    }, [activeWorkspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (settingsQuery.data) {
            setDefaultLocale(settingsQuery.data.defaultLocale);
            setEnabledLocales(settingsQuery.data.enabledLocales);
        }
    }, [settingsQuery.data]);
    const handleToggleLocale = (locale) => {
        if (locale === defaultLocale)
            return;
        setEnabledLocales((prev) => prev.includes(locale) ? prev.filter((l) => l !== locale) : [...prev, locale]);
    };
    const handleSaveLocales = async () => {
        if (!activeWorkspace)
            return;
        setSaveSuccess(false);
        const result = await settingsMutation.mutate({
            workspaceId: activeWorkspace.id,
            defaultLocale,
            enabledLocales,
        });
        if (result) {
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
        }
    };
    const handleCredentialsSaved = () => {
        if (activeWorkspace) {
            credentialsQuery.execute({ workspaceId: activeWorkspace.id });
        }
    };
    const sections = [
        { id: 'zendesk', label: 'Zendesk Connection' },
        { id: 'locales', label: 'Locales' },
        { id: 'ai', label: 'AI Runtime' },
        { id: 'workspace', label: 'Workspace' },
        { id: 'storage', label: 'Storage' },
        { id: 'about', label: 'About' },
    ];
    if (!activeWorkspace) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Settings", subtitle: "No workspace selected" }), _jsx("div", { className: "route-content", children: _jsx(EmptyState, { icon: _jsx(IconSettings, { size: 48 }), title: "No workspace open", description: "Open a workspace to configure its settings." }) })] }));
    }
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Settings", subtitle: activeWorkspace.name }), _jsxs("div", { className: "route-content", style: { display: 'flex', gap: 'var(--space-6)' }, children: [_jsx("div", { style: { width: 180, flexShrink: 0 }, children: _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 2 }, children: sections.map((s) => (_jsx("button", { className: `btn ${activeSection === s.id ? 'btn-secondary' : 'btn-ghost'} btn-sm`, style: { justifyContent: 'flex-start', width: '100%' }, onClick: () => setActiveSection(s.id), children: s.label }, s.id))) }) }), _jsxs("div", { style: { flex: 1, maxWidth: 680 }, children: [activeSection === 'zendesk' && (_jsxs("div", { children: [_jsx("h3", { className: "settings-heading", children: "Zendesk Connection" }), _jsx(ZendeskCredentialSection, { workspaceId: activeWorkspace.id, subdomain: settingsQuery.data?.zendeskSubdomain, credential: credentialsQuery.data ?? null, credentialLoading: credentialsQuery.loading, onCredentialsSaved: handleCredentialsSaved }), _jsx(ZendeskConnectionTestSection, { workspaceId: activeWorkspace.id }), _jsx(ZendeskSyncSection, { workspaceId: activeWorkspace.id }), _jsx(ZendeskTaxonomyBrowser, { workspaceId: activeWorkspace.id })] })), activeSection === 'locales' && (_jsxs("div", { children: [_jsx("h3", { className: "settings-heading", children: "Locale Configuration" }), _jsxs("div", { style: { marginBottom: 'var(--space-4)' }, children: [_jsx("label", { className: "settings-label", children: "Default Locale" }), _jsx("select", { className: "select", value: defaultLocale, onChange: (e) => {
                                                    setDefaultLocale(e.target.value);
                                                    if (!enabledLocales.includes(e.target.value)) {
                                                        setEnabledLocales((prev) => [...prev, e.target.value]);
                                                    }
                                                }, children: LOCALE_OPTIONS.map((opt) => (_jsx("option", { value: opt.value, children: opt.label }, opt.value))) })] }), _jsxs("div", { style: { marginBottom: 'var(--space-4)' }, children: [_jsx("label", { className: "settings-label", style: { marginBottom: 'var(--space-2)' }, children: "Enabled Locales" }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }, children: LOCALE_OPTIONS.map((opt) => (_jsxs("div", { className: "card card-padded", style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }, children: [_jsx("input", { type: "checkbox", checked: enabledLocales.includes(opt.value), onChange: () => handleToggleLocale(opt.value), disabled: opt.value === defaultLocale }), _jsxs("div", { children: [_jsx("div", { style: { fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-sm)' }, children: opt.label }), opt.value === defaultLocale && (_jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }, children: "Default source locale" }))] })] }), opt.value === defaultLocale ? (_jsx(Badge, { variant: "primary", children: "Default" })) : enabledLocales.includes(opt.value) ? (_jsx(Badge, { variant: "success", children: "Enabled" })) : (_jsx(Badge, { variant: "neutral", children: "Disabled" }))] }, opt.value))) })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }, children: [_jsx("button", { className: "btn btn-primary", onClick: handleSaveLocales, disabled: settingsMutation.loading, children: settingsMutation.loading ? 'Saving...' : 'Save Locales' }), saveSuccess && (_jsxs("span", { className: "settings-inline-success", children: [_jsx(IconCheckCircle, { size: 14 }), " Saved"] })), settingsMutation.error && _jsx("span", { className: "settings-inline-error", children: settingsMutation.error })] })] })), activeSection === 'ai' && (_jsxs("div", { children: [_jsx("h3", { className: "settings-heading", children: "AI Runtime" }), _jsx(HealthStatusPanel, { workspaceId: activeWorkspace.id }), selectedSession ? (_jsx(SessionDetailPanel, { workspaceId: activeWorkspace.id, session: selectedSession, onBack: () => setSelectedSession(null) })) : (_jsx(SessionListPanel, { workspaceId: activeWorkspace.id, onSelectSession: setSelectedSession }))] })), activeSection === 'workspace' && (_jsxs("div", { children: [_jsx("h3", { className: "settings-heading", children: "Workspace Settings" }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }, children: [_jsxs("div", { children: [_jsx("label", { className: "settings-label", children: "Workspace Name" }), _jsx("input", { className: "input", defaultValue: activeWorkspace.name })] }), _jsxs("div", { children: [_jsx("label", { className: "settings-label", children: "Storage Path" }), _jsx("input", { className: "input", readOnly: true, value: activeWorkspace.path, style: { color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' } })] }), _jsxs("div", { children: [_jsx("label", { className: "settings-label", children: "State" }), _jsx(StatusChip, { status: activeWorkspace.state === 'active' ? 'active' : 'retired', label: activeWorkspace.state })] })] })] })), activeSection === 'storage' && (_jsxs("div", { children: [_jsx("h3", { className: "settings-heading", children: "Local Repository Structure" }), repoQuery.loading ? (_jsx(LoadingState, { message: "Loading..." })) : repoQuery.data ? (_jsx("div", { className: "card card-padded", children: _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between' }, children: [_jsx("span", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }, children: "Root" }), _jsx("code", { style: { fontSize: 'var(--text-xs)', background: 'var(--color-bg-muted)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }, children: repoQuery.data.rootPath })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between' }, children: [_jsx("span", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }, children: "Database" }), _jsx("code", { style: { fontSize: 'var(--text-xs)', background: 'var(--color-bg-muted)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }, children: repoQuery.data.dbPath })] }), repoQuery.data.storage && Object.entries(repoQuery.data.storage).map(([key, path]) => (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between' }, children: [_jsx("span", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }, children: key }), _jsx("code", { style: { fontSize: 'var(--text-xs)', background: 'var(--color-bg-muted)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }, children: path })] }, key)))] }) })) : (_jsx("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }, children: "No repository info available." }))] })), activeSection === 'about' && (_jsxs("div", { children: [_jsx("h3", { className: "settings-heading", children: "About KB Vault" }), _jsxs("div", { className: "card card-padded", children: [_jsxs("div", { style: { fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }, children: [_jsx("strong", { children: "Version:" }), " 0.1.0"] }), _jsxs("div", { style: { fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }, children: [_jsx("strong", { children: "Workspace ID:" }), " ", activeWorkspace.id] }), _jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }, children: "Local-first Electron desktop application for automating Zendesk KB maintenance from bulk PBI uploads." })] })] }))] })] })] }));
};
