import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DEFAULT_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES, MAX_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES, MIN_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES, PBIBatchStatus, PBIBatchScopeMode, normalizeBatchAnalysisWorkerStageBudgetMinutes, } from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/Badge';
import { ConfirmationDialog, Drawer } from '../components';
import { AnalysisJobRunner } from '../components/AgentRuntimePanel';
import { IconUpload, IconPlus, IconX, IconCheckCircle, IconAlertCircle, IconFileText, IconPlay, } from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc } from '../hooks/useIpc';
const WIZARD_STEPS = ['upload', 'summary', 'scope', 'preflight'];
const WIZARD_STEP_LABELS = {
    upload: 'Upload',
    summary: 'Review',
    scope: 'Scope & Targets',
    preflight: 'Confirm',
};
const STATUS_LABEL = {
    imported: 'Imported',
    scoped: 'Scoped',
    submitted: 'Submitted',
    analyzing: 'Analyzing',
    analyzed: 'Analyzed',
    waiting_for_input: 'Waiting for Input',
    needs_human_review: 'Needs Review',
    analysis_failed: 'Analysis Failed',
    analysis_canceled: 'Analysis Canceled',
    review_in_progress: 'In Review',
    review_complete: 'Complete',
    archived: 'Archived',
    proposed: 'Proposed',
};
function derivePersistedDisplayStatus(stage) {
    switch (stage) {
        case 'queued':
        case 'planning':
        case 'plan_reviewing':
        case 'plan_revision':
        case 'building':
        case 'worker_discovery_review':
        case 'final_reviewing':
        case 'reworking':
            return 'analyzing';
        case 'awaiting_user_input':
            return 'waiting_for_input';
        case 'approved':
            return PBIBatchStatus.ANALYZED;
        case 'needs_human_review':
            return 'needs_human_review';
        case 'failed':
            return 'analysis_failed';
        case 'canceled':
            return 'analysis_canceled';
        default:
            return null;
    }
}
/* ---------- Helpers ---------- */
function batchStatusVariant(status) {
    switch (status) {
        case 'imported': return 'neutral';
        case 'scoped': return 'primary';
        case 'submitted': return 'primary';
        case 'analyzing': return 'warning';
        case 'analyzed': return 'primary';
        case 'waiting_for_input': return 'warning';
        case 'needs_human_review': return 'danger';
        case 'analysis_failed': return 'danger';
        case 'analysis_canceled': return 'warning';
        case 'review_in_progress': return 'warning';
        case 'review_complete': return 'success';
        case 'archived': return 'neutral';
        default: return 'neutral';
    }
}
function formatDate(utc) {
    try {
        return new Date(utc).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    catch {
        return utc;
    }
}
function detectImportFormat(fileName) {
    const normalized = fileName.trim().toLowerCase();
    if (normalized.endsWith('.csv')) {
        return 'csv';
    }
    if (normalized.endsWith('.html') || normalized.endsWith('.htm')) {
        return 'html';
    }
    return null;
}
function hasDraggedFiles(dataTransfer) {
    if (!dataTransfer) {
        return false;
    }
    return Array.from(dataTransfer.types ?? []).includes('Files');
}
function recommendWorkerStageBudgetMinutes(scopedCount) {
    if (scopedCount >= 100) {
        return 60;
    }
    if (scopedCount >= 50) {
        return 30;
    }
    if (scopedCount >= 20) {
        return 15;
    }
    return DEFAULT_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES;
}
function normalizeTitleKey(value) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function makeClientId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `create-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function buildGuaranteedEditFamilyFromExplorerNode(node, selectedFromLocaleVariantId) {
    const resolvedLocaleVariants = node.locales
        .filter((locale) => locale.revision.state !== 'retired' && !locale.hasConflicts)
        .map((locale) => ({
        localeVariantId: locale.localeVariantId,
        locale: locale.locale
    }))
        .sort((left, right) => left.locale.localeCompare(right.locale));
    if (resolvedLocaleVariants.length === 0) {
        return null;
    }
    return {
        familyId: node.familyId,
        familyTitle: node.title,
        selectedFromLocaleVariantId,
        mode: 'all_live_locales',
        resolvedLocaleVariants,
        sectionId: node.sectionId,
        sectionName: node.sectionName,
        categoryId: node.categoryId,
        categoryName: node.categoryName
    };
}
function dedupeSearchResultsByFamily(results) {
    const seen = new Set();
    const deduped = [];
    for (const result of results) {
        if (seen.has(result.familyId)) {
            continue;
        }
        seen.add(result.familyId);
        deduped.push(result);
    }
    return deduped;
}
function createGuaranteedCreateArticle(title, targetLocale) {
    const trimmedTitle = title.trim();
    const trimmedLocale = targetLocale.trim().toLowerCase();
    if (!trimmedTitle || !trimmedLocale) {
        return null;
    }
    return {
        clientId: makeClientId(),
        title: trimmedTitle,
        targetLocale: trimmedLocale,
        source: 'manual'
    };
}
/* ---------- Sub-components ---------- */
function StepIndicator({ steps, current }) {
    const currentIndex = steps.indexOf(current);
    return (_jsx("div", { className: "wizard-step-indicator", children: steps.map((step, i) => (_jsxs("span", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }, children: [_jsx("span", { className: `wizard-step-dot${i === currentIndex ? ' active' : i < currentIndex ? ' completed' : ''}` }), _jsx("span", { style: { fontSize: 'var(--text-xs)', color: i === currentIndex ? 'var(--color-text)' : 'var(--color-text-muted)' }, children: WIZARD_STEP_LABELS[step] })] }, step))) }));
}
function ParseSummaryGrid({ summary }) {
    const items = [
        { label: 'Total Rows', value: summary.totalRows, variant: '' },
        { label: 'Candidates', value: summary.candidateRowCount, variant: 'success' },
        { label: 'Scoped', value: summary.scopedRowCount, variant: 'success' },
        { label: 'Duplicates', value: summary.duplicateRowCount, variant: summary.duplicateRowCount > 0 ? 'warning' : '' },
        { label: 'Malformed', value: summary.malformedRowCount, variant: summary.malformedRowCount > 0 ? 'danger' : '' },
        { label: 'Ignored', value: summary.ignoredRowCount, variant: summary.ignoredRowCount > 0 ? 'warning' : '' },
    ];
    return (_jsx("div", { className: "parse-summary-grid", children: items.map((item) => (_jsxs("div", { className: `parse-summary-card${item.variant ? ` parse-summary-card--${item.variant}` : ''}`, children: [_jsx("div", { className: "parse-summary-value", children: item.value }), _jsx("div", { className: "parse-summary-label", children: item.label })] }, item.label))) }));
}
function RowReviewTable({ title, rows, variant }) {
    if (rows.length === 0)
        return null;
    return (_jsxs("div", { className: "row-review-section", children: [_jsxs("div", { className: "row-review-heading", children: [_jsx(Badge, { variant: variant, children: rows.length }), title] }), _jsx("div", { className: "table-wrapper", children: _jsxs("table", { className: "row-review-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Row #" }), _jsx("th", { children: "External ID" }), _jsx("th", { children: "Title" }), _jsx("th", { children: "Reason" })] }) }), _jsx("tbody", { children: rows.map((row, i) => (_jsxs("tr", { children: [_jsx("td", { children: row.sourceRowNumber }), _jsx("td", { style: { fontFamily: 'var(--font-mono)' }, children: row.externalId || '\u2014' }), _jsx("td", { children: row.title || '\u2014' }), _jsx("td", { children: _jsx("span", { className: "row-review-reason", children: row.validationReason || '\u2014' }) })] }, row.id ?? i))) })] }) })] }));
}
function ScopeModePicker({ mode, onModeChange, scopedCount, }) {
    const options = [
        {
            value: PBIBatchScopeMode.ALL,
            label: 'All candidates',
            desc: 'Include every candidate row in the analysis scope.',
        },
        {
            value: PBIBatchScopeMode.SELECTED_ONLY,
            label: 'Selected only',
            desc: 'Only include the specific rows you select.',
        },
    ];
    return (_jsxs("div", { className: "scope-section", children: [_jsx("div", { className: "scope-section-heading", children: "Scope Mode" }), _jsx("div", { className: "scope-mode-group", children: options.map((opt) => (_jsxs("div", { className: `scope-mode-option${mode === opt.value ? ' active' : ''}`, onClick: () => onModeChange(opt.value), role: "radio", "aria-checked": mode === opt.value, tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onModeChange(opt.value);
                    } }, children: [_jsx("div", { className: "scope-mode-radio" }), _jsxs("div", { children: [_jsx("div", { className: "scope-mode-label", children: opt.label }), _jsx("div", { className: "scope-mode-desc", children: opt.desc })] })] }, opt.value))) }), scopedCount != null && (_jsxs("div", { className: "scope-feedback", children: [_jsx(IconCheckCircle, { size: 14 }), _jsxs("span", { children: [scopedCount, " row", scopedCount !== 1 ? 's' : '', " in scope for analysis"] })] }))] }));
}
function PreflightPanel({ batch, candidateCount, invalidCount, duplicateCount, ignoredCount, scopedCount, candidateTitles, analysisConfig, guaranteedCreateConflicts, workerStageBudgetMinutes, recommendedWorkerStageBudgetMinutes, onWorkerStageBudgetMinutesChange, }) {
    return (_jsxs(_Fragment, { children: [(invalidCount > 0 || duplicateCount > 0) && (_jsxs("div", { className: "preflight-warning-banner", children: [_jsx(IconAlertCircle, { size: 14 }), _jsxs("div", { children: [invalidCount > 0 && _jsxs("div", { children: [invalidCount, " malformed row", invalidCount !== 1 ? 's' : '', " will be excluded."] }), duplicateCount > 0 && _jsxs("div", { children: [duplicateCount, " duplicate row", duplicateCount !== 1 ? 's' : '', " will be excluded."] }), ignoredCount > 0 && _jsxs("div", { children: [ignoredCount, " ignored row", ignoredCount !== 1 ? 's' : '', " will be excluded."] })] })] })), _jsxs("div", { className: "preflight-section", children: [_jsx("div", { className: "preflight-heading", children: "Preflight Checklist" }), _jsxs("div", { className: "preflight-checklist", children: [_jsxs("div", { className: "preflight-item", children: [_jsx(IconCheckCircle, { size: 14, className: "preflight-item-icon preflight-item-icon--pass" }), _jsxs("span", { children: ["Batch ", _jsx("strong", { children: batch.name }), " from ", batch.sourceFileName] })] }), _jsxs("div", { className: "preflight-item", children: [_jsx(IconCheckCircle, { size: 14, className: "preflight-item-icon preflight-item-icon--pass" }), _jsxs("span", { children: [candidateCount, " candidates identified"] })] }), _jsxs("div", { className: "preflight-item", children: [scopedCount > 0 ? (_jsx(IconCheckCircle, { size: 14, className: "preflight-item-icon preflight-item-icon--pass" })) : (_jsx(IconAlertCircle, { size: 14, className: "preflight-item-icon preflight-item-icon--warn" })), _jsxs("span", { children: [scopedCount, " row", scopedCount !== 1 ? 's' : '', " in scope for AI analysis"] })] }), _jsxs("div", { className: "preflight-item", children: [_jsx(IconCheckCircle, { size: 14, className: "preflight-item-icon preflight-item-icon--pass" }), _jsxs("span", { children: [analysisConfig.guaranteedEditFamilies.length, " guaranteed edit family", analysisConfig.guaranteedEditFamilies.length === 1 ? '' : 'ies', " covering", ' ', analysisConfig.guaranteedEditFamilies.reduce((total, family) => total + family.resolvedLocaleVariants.length, 0), " live locale", analysisConfig.guaranteedEditFamilies.reduce((total, family) => total + family.resolvedLocaleVariants.length, 0) === 1 ? '' : 's'] })] }), _jsxs("div", { className: "preflight-item", children: [_jsx(IconCheckCircle, { size: 14, className: "preflight-item-icon preflight-item-icon--pass" }), _jsxs("span", { children: [analysisConfig.guaranteedCreateArticles.length, " guaranteed create target", analysisConfig.guaranteedCreateArticles.length === 1 ? '' : 's'] })] })] })] }), (analysisConfig.guaranteedEditFamilies.length > 0 || analysisConfig.guaranteedCreateArticles.length > 0 || analysisConfig.analysisGuidancePrompt) && (_jsxs("div", { className: "preflight-section", children: [_jsx("div", { className: "preflight-heading", children: "Guaranteed Targets" }), analysisConfig.guaranteedEditFamilies.map((family) => (_jsxs("div", { className: "preflight-target-line", children: [_jsx("strong", { children: "Edit:" }), " ", family.familyTitle, " (", family.resolvedLocaleVariants.map((variant) => variant.locale).join(', '), ")"] }, family.familyId))), analysisConfig.guaranteedCreateArticles.map((article) => (_jsxs("div", { className: "preflight-target-line", children: [_jsx("strong", { children: "Create:" }), " ", article.title, " (", article.targetLocale, ")"] }, article.clientId))), analysisConfig.analysisGuidancePrompt && (_jsx("div", { className: "preflight-guidance-box", children: analysisConfig.analysisGuidancePrompt }))] })), guaranteedCreateConflicts.length > 0 && (_jsxs("div", { className: "preflight-section", children: [_jsx("div", { className: "preflight-heading", children: "Clarification Needed" }), _jsxs("div", { className: "preflight-warning-banner", children: [_jsx(IconAlertCircle, { size: 14 }), _jsx("div", { children: guaranteedCreateConflicts.map((conflict) => (_jsxs("div", { children: [conflict.title, " (", conflict.targetLocale, ") overlaps ", conflict.matches.map((match) => `${match.title} (${match.locale})`).join(', '), " and will pause for user input before approval."] }, conflict.clientId))) })] })] })), _jsxs("div", { className: "preflight-section", children: [_jsx("div", { className: "preflight-heading", children: "Worker Time Budget" }), _jsxs("label", { className: "preflight-budget-field", children: [_jsx("span", { className: "preflight-budget-label", children: "Let the build stage run this long before the watchdog cancels it." }), _jsxs("div", { className: "preflight-budget-input-row", children: [_jsx("input", { className: "preflight-budget-input", type: "number", min: MIN_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES, max: MAX_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES, step: 5, value: workerStageBudgetMinutes, onChange: (event) => {
                                            const nextValue = normalizeBatchAnalysisWorkerStageBudgetMinutes(event.target.value);
                                            onWorkerStageBudgetMinutesChange(nextValue ?? MIN_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES);
                                        } }), _jsx("span", { className: "preflight-budget-suffix", children: "minutes" })] })] }), _jsxs("div", { className: "preflight-budget-note", children: ["Recommended: ", recommendedWorkerStageBudgetMinutes, " minutes for ", scopedCount, " scoped item", scopedCount === 1 ? '' : 's', ". This drives the worker timeout and gives the watchdog a small safety buffer on top."] })] }), candidateTitles.length > 0 && (_jsxs("div", { className: "preflight-section", children: [_jsx("div", { className: "preflight-heading", children: "Scoped Items Preview" }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 2 }, children: [candidateTitles.slice(0, 10).map((title, i) => (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)', padding: 'var(--space-1) 0' }, children: [_jsx(IconFileText, { size: 12, style: { color: 'var(--color-text-muted)', flexShrink: 0 } }), _jsx("span", { children: title })] }, i))), candidateTitles.length > 10 && (_jsxs("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', paddingTop: 'var(--space-1)' }, children: ["and ", candidateTitles.length - 10, " more..."] }))] })] }))] }));
}
const WIZARD_INITIAL = {
    open: false,
    step: 'upload',
    importing: false,
    importError: null,
    importResult: null,
    scopeMode: PBIBatchScopeMode.ALL,
    scopeSelectedRows: [],
    scopeSaving: false,
    scopeError: null,
    scopeResult: null,
    guaranteedEditFamilies: [],
    guaranteedCreateArticles: [],
    guaranteedCreateInput: '',
    analysisGuidancePrompt: '',
    guaranteedCreateConflicts: [],
    preflightLoading: false,
    preflightError: null,
    workerStageBudgetMinutes: DEFAULT_BATCH_ANALYSIS_WORKER_STAGE_BUDGET_MINUTES,
    workerStageBudgetDirty: false,
    preflightData: null,
    submitting: false,
    submitError: null,
};
/* ---------- Main Component ---------- */
export const PBI = () => {
    const { activeWorkspace } = useWorkspace();
    const batchListQuery = useIpc('pbiBatch.list');
    const sessionListQuery = useIpc('agent.session.list');
    const fileInputRef = useRef(null);
    const jobStateByIdRef = useRef({});
    const wizardRef = useRef(WIZARD_INITIAL);
    const fileDragDepthRef = useRef(0);
    const [wizard, setWizard] = useState(WIZARD_INITIAL);
    const [fileDragActive, setFileDragActive] = useState(false);
    const [batchToDelete, setBatchToDelete] = useState(null);
    const [deletingBatchId, setDeletingBatchId] = useState(null);
    const [deleteBatchError, setDeleteBatchError] = useState(null);
    const [analysisBatch, setAnalysisBatch] = useState(null);
    const [analysisAutoRun, setAnalysisAutoRun] = useState(false);
    const [activeAnalysisBatchIds, setActiveAnalysisBatchIds] = useState([]);
    const [cachedBatches, setCachedBatches] = useState([]);
    const [cachedSessions, setCachedSessions] = useState([]);
    const [persistedAnalysisStateByBatchId, setPersistedAnalysisStateByBatchId] = useState({});
    const [articlePickerTree, setArticlePickerTree] = useState([]);
    const [articlePickerTreeLoading, setArticlePickerTreeLoading] = useState(false);
    const [articlePickerSearch, setArticlePickerSearch] = useState('');
    const [articlePickerSearchLoading, setArticlePickerSearchLoading] = useState(false);
    const [articlePickerSearchResults, setArticlePickerSearchResults] = useState([]);
    const batches = useMemo(() => {
        const data = batchListQuery.data;
        if (data && Array.isArray(data.batches)) {
            return data.batches;
        }
        return cachedBatches;
    }, [batchListQuery.data, cachedBatches]);
    useEffect(() => {
        if (batchListQuery.data?.batches && Array.isArray(batchListQuery.data.batches)) {
            setCachedBatches(batchListQuery.data.batches);
        }
    }, [batchListQuery.data]);
    useEffect(() => {
        if (sessionListQuery.data?.sessions && Array.isArray(sessionListQuery.data.sessions)) {
            setCachedSessions(sessionListQuery.data.sessions);
        }
    }, [sessionListQuery.data]);
    useEffect(() => {
        wizardRef.current = wizard;
    }, [wizard]);
    const articleFamilyById = useMemo(() => new Map(articlePickerTree.map((node) => [node.familyId, node])), [articlePickerTree]);
    // Fetch batch list on mount
    useEffect(() => {
        if (activeWorkspace) {
            jobStateByIdRef.current = {};
            batchListQuery.execute({ workspaceId: activeWorkspace.id });
            sessionListQuery.execute({ workspaceId: activeWorkspace.id, includeClosed: true });
        }
        else {
            setCachedBatches([]);
            setCachedSessions([]);
            setActiveAnalysisBatchIds([]);
            setPersistedAnalysisStateByBatchId({});
        }
    }, [activeWorkspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!activeWorkspace) {
            setPersistedAnalysisStateByBatchId({});
            return;
        }
        const candidateBatchIds = batches
            .filter((batch) => batch.status !== PBIBatchStatus.ANALYZED
            && batch.status !== PBIBatchStatus.REVIEW_IN_PROGRESS
            && batch.status !== PBIBatchStatus.REVIEW_COMPLETE)
            .map((batch) => batch.id);
        if (candidateBatchIds.length === 0) {
            setPersistedAnalysisStateByBatchId({});
            return;
        }
        let cancelled = false;
        void (async () => {
            const results = await Promise.all(candidateBatchIds.map(async (batchId) => {
                try {
                    const response = await window.kbv.invoke('agent.analysis.latest', {
                        workspaceId: activeWorkspace.id,
                        batchId,
                        limit: 0,
                    });
                    if (!response.ok || !response.data) {
                        return [batchId, { hasHistory: false, displayStatus: null }];
                    }
                    const latestIteration = response.data.orchestration?.latestIteration ?? null;
                    return [
                        batchId,
                        {
                            hasHistory: Boolean(response.data.run || latestIteration),
                            displayStatus: derivePersistedDisplayStatus(latestIteration?.stage),
                        },
                    ];
                }
                catch {
                    return [batchId, { hasHistory: false, displayStatus: null }];
                }
            }));
            if (cancelled) {
                return;
            }
            setPersistedAnalysisStateByBatchId(Object.fromEntries(results));
        })();
        return () => {
            cancelled = true;
        };
    }, [activeWorkspace?.id, batches]);
    useEffect(() => {
        if (!activeWorkspace || !wizard.open || wizard.step !== 'scope') {
            return;
        }
        let cancelled = false;
        setArticlePickerTreeLoading(true);
        void (async () => {
            try {
                const response = await window.kbv.invoke('workspace.explorer.getTree', {
                    workspaceId: activeWorkspace.id
                });
                if (!cancelled) {
                    setArticlePickerTree(response.ok && response.data?.nodes ? response.data.nodes : []);
                }
            }
            finally {
                if (!cancelled) {
                    setArticlePickerTreeLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [activeWorkspace?.id, wizard.open, wizard.step]);
    useEffect(() => {
        if (!activeWorkspace || !wizard.open || wizard.step !== 'scope') {
            return;
        }
        const query = articlePickerSearch.trim();
        if (!query) {
            setArticlePickerSearchResults([]);
            setArticlePickerSearchLoading(false);
            return;
        }
        let cancelled = false;
        setArticlePickerSearchLoading(true);
        const timeout = window.setTimeout(() => {
            void (async () => {
                try {
                    const response = await window.kbv.invoke('workspace.search', {
                        workspaceId: activeWorkspace.id,
                        query,
                        scope: 'live',
                        includeArchived: false
                    });
                    if (!cancelled) {
                        setArticlePickerSearchResults(response.ok && response.data?.results
                            ? dedupeSearchResultsByFamily(response.data.results).slice(0, 8)
                            : []);
                    }
                }
                finally {
                    if (!cancelled) {
                        setArticlePickerSearchLoading(false);
                    }
                }
            })();
        }, 180);
        return () => {
            cancelled = true;
            window.clearTimeout(timeout);
        };
    }, [activeWorkspace?.id, articlePickerSearch, wizard.open, wizard.step]);
    useEffect(() => {
        if (!activeWorkspace) {
            setActiveAnalysisBatchIds([]);
            return;
        }
        const unsubscribe = window.kbv.emitJobEvents((event) => {
            if (event.command !== 'agent.analysis.run')
                return;
            const previousState = jobStateByIdRef.current[event.id];
            jobStateByIdRef.current[event.id] = event.state;
            const metadata = event.metadata;
            const batchId = typeof metadata?.batchId === 'string' ? metadata.batchId : null;
            const stateChanged = previousState !== event.state;
            const isActiveState = event.state === 'RUNNING' || event.state === 'QUEUED';
            const isTerminalState = event.state === 'SUCCEEDED' || event.state === 'FAILED' || event.state === 'CANCELED';
            if (batchId && stateChanged && (isActiveState || isTerminalState)) {
                setActiveAnalysisBatchIds((current) => {
                    const alreadyTracked = current.includes(batchId);
                    if (isActiveState) {
                        return alreadyTracked ? current : [...current, batchId];
                    }
                    if (isTerminalState) {
                        return alreadyTracked ? current.filter((id) => id !== batchId) : current;
                    }
                    return current;
                });
            }
            const shouldRefresh = (isActiveState || isTerminalState)
                && stateChanged;
            if (shouldRefresh) {
                void batchListQuery.execute({ workspaceId: activeWorkspace.id });
                void sessionListQuery.execute({ workspaceId: activeWorkspace.id, includeClosed: true });
            }
        });
        return () => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, [activeWorkspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    const openWizard = useCallback(() => {
        setAnalysisBatch(null);
        setAnalysisAutoRun(false);
        setArticlePickerSearch('');
        setArticlePickerSearchResults([]);
        setArticlePickerTree([]);
        setWizard({ ...WIZARD_INITIAL, open: true });
    }, []);
    const openWizardForFileDrag = useCallback(() => {
        setAnalysisBatch(null);
        setAnalysisAutoRun(false);
        setArticlePickerSearch('');
        setArticlePickerSearchResults([]);
        setArticlePickerTree([]);
        setWizard((current) => (current.open ? current : { ...WIZARD_INITIAL, open: true }));
    }, []);
    const closeWizard = useCallback(() => {
        fileDragDepthRef.current = 0;
        setFileDragActive(false);
        setArticlePickerSearch('');
        setArticlePickerSearchResults([]);
        setArticlePickerTree([]);
        setWizard(WIZARD_INITIAL);
        // Refresh batch list after close
        if (activeWorkspace) {
            batchListQuery.execute({ workspaceId: activeWorkspace.id });
        }
    }, [activeWorkspace]); // eslint-disable-line react-hooks/exhaustive-deps
    const batchHasHistory = useMemo(() => {
        const sessions = sessionListQuery.data?.sessions ?? cachedSessions;
        const analyzedBatchIds = new Set();
        for (const session of sessions) {
            if (session.type === 'batch_analysis' && session.batchId) {
                analyzedBatchIds.add(session.batchId);
            }
        }
        for (const [batchId, state] of Object.entries(persistedAnalysisStateByBatchId)) {
            if (state.hasHistory) {
                analyzedBatchIds.add(batchId);
            }
        }
        return analyzedBatchIds;
    }, [sessionListQuery.data?.sessions, cachedSessions, persistedAnalysisStateByBatchId]);
    const runningAnalysisBatchIds = useMemo(() => {
        const sessions = sessionListQuery.data?.sessions ?? cachedSessions;
        const activeBatchIds = new Set(activeAnalysisBatchIds);
        for (const session of sessions) {
            if (session.type === 'batch_analysis'
                && session.batchId
                && (session.status === 'running' || session.status === 'starting')) {
                activeBatchIds.add(session.batchId);
            }
        }
        return activeBatchIds;
    }, [activeAnalysisBatchIds, sessionListQuery.data?.sessions, cachedSessions]);
    const getDisplayBatchStatus = useCallback((batch) => {
        if (runningAnalysisBatchIds.has(batch.id)) {
            return 'analyzing';
        }
        const persistedState = persistedAnalysisStateByBatchId[batch.id];
        if (persistedState?.displayStatus
            && batch.status !== PBIBatchStatus.ANALYZED
            && batch.status !== PBIBatchStatus.REVIEW_IN_PROGRESS
            && batch.status !== PBIBatchStatus.REVIEW_COMPLETE) {
            return persistedState.displayStatus;
        }
        return batch.status;
    }, [persistedAnalysisStateByBatchId, runningAnalysisBatchIds]);
    const openAnalysis = useCallback((batch, shouldAutoRun = false) => {
        setAnalysisBatch(batch);
        setAnalysisAutoRun(shouldAutoRun);
    }, []);
    const resolvePersistedAnalysisOutcome = useCallback(async (batchId) => {
        if (!activeWorkspace) {
            return false;
        }
        try {
            const response = await window.kbv.invoke('agent.analysis.latest', {
                workspaceId: activeWorkspace.id,
                batchId,
                limit: 0,
            });
            const hasPersistedOutcome = Boolean(response.ok
                && response.data
                && (response.data.run || response.data.orchestration?.latestIteration));
            const latestIteration = response.data?.orchestration?.latestIteration ?? null;
            setPersistedAnalysisStateByBatchId((current) => ({
                ...current,
                [batchId]: {
                    hasHistory: hasPersistedOutcome,
                    displayStatus: derivePersistedDisplayStatus(latestIteration?.stage),
                },
            }));
            return hasPersistedOutcome;
        }
        catch {
            return false;
        }
    }, [activeWorkspace]);
    const hasAnalysisHistory = useCallback((batch) => batchHasHistory.has(batch.id), [batchHasHistory]);
    const hasAnyAnalysisOutcome = useCallback((batch) => {
        if (hasAnalysisHistory(batch)) {
            return true;
        }
        if (runningAnalysisBatchIds.has(batch.id)) {
            return true;
        }
        return batch.status === PBIBatchStatus.ANALYZED
            || batch.status === PBIBatchStatus.REVIEW_IN_PROGRESS
            || batch.status === PBIBatchStatus.REVIEW_COMPLETE;
    }, [hasAnalysisHistory, runningAnalysisBatchIds]);
    const canRunAnalysis = useCallback((batch) => {
        if (runningAnalysisBatchIds.has(batch.id)) {
            return false;
        }
        if (batch.status === PBIBatchStatus.IMPORTED || batch.status === PBIBatchStatus.ARCHIVED) {
            return false;
        }
        return !hasAnyAnalysisOutcome(batch);
    }, [hasAnyAnalysisOutcome, runningAnalysisBatchIds]);
    const openAnalysisFromRow = useCallback(async (batch) => {
        if (hasAnyAnalysisOutcome(batch) || await resolvePersistedAnalysisOutcome(batch.id)) {
            openAnalysis(batch, false);
        }
    }, [hasAnyAnalysisOutcome, openAnalysis, resolvePersistedAnalysisOutcome]);
    const handleAnalyzeAction = useCallback(async (batch) => {
        if (await resolvePersistedAnalysisOutcome(batch.id)) {
            openAnalysis(batch, false);
            return;
        }
        openAnalysis(batch, true);
    }, [openAnalysis, resolvePersistedAnalysisOutcome]);
    const handleRowKeyDown = useCallback((event, batch) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void openAnalysisFromRow(batch);
        }
    }, [openAnalysisFromRow]);
    const openDeleteDialog = useCallback((batch) => {
        setBatchToDelete(batch);
        setDeleteBatchError(null);
    }, []);
    const closeDeleteDialog = useCallback(() => {
        if (deletingBatchId)
            return;
        setBatchToDelete(null);
        setDeleteBatchError(null);
    }, [deletingBatchId]);
    const handleDeleteBatch = useCallback(async () => {
        if (!activeWorkspace || !batchToDelete)
            return;
        setDeletingBatchId(batchToDelete.id);
        setDeleteBatchError(null);
        try {
            const payload = {
                workspaceId: activeWorkspace.id,
                batchId: batchToDelete.id
            };
            const res = await window.kbv.invoke('pbiBatch.delete', payload);
            if (res.ok) {
                batchListQuery.execute({ workspaceId: activeWorkspace.id });
                setBatchToDelete(null);
            }
            else {
                setDeleteBatchError(res.error?.message ?? 'Failed to delete batch');
            }
        }
        catch (err) {
            setDeleteBatchError(err instanceof Error ? err.message : 'Failed to delete batch');
        }
        finally {
            setDeletingBatchId(null);
        }
    }, [activeWorkspace, batchToDelete, batchListQuery]);
    // ---- Upload step ----
    const handleFileSelect = useCallback(async (file) => {
        if (!activeWorkspace)
            return;
        const format = detectImportFormat(file.name);
        if (!format) {
            setWizard((s) => ({
                ...s,
                open: true,
                step: 'upload',
                importing: false,
                importError: 'Unsupported file type. Please drop a CSV or HTML export.',
            }));
            return;
        }
        setWizard((s) => ({
            ...s,
            open: true,
            step: 'upload',
            importing: true,
            importError: null,
        }));
        try {
            const content = await file.text();
            const res = await window.kbv.invoke('pbiBatch.import', {
                workspaceId: activeWorkspace.id,
                sourceFileName: file.name,
                sourceContent: content,
                sourceFormat: format,
            });
            if (res.ok && res.data) {
                setWizard((s) => ({
                    ...s,
                    importing: false,
                    importResult: res.data,
                    step: 'summary',
                }));
            }
            else {
                setWizard((s) => ({
                    ...s,
                    importing: false,
                    importError: res.error?.message ?? 'Import failed',
                }));
            }
        }
        catch (err) {
            setWizard((s) => ({
                ...s,
                importing: false,
                importError: err instanceof Error ? err.message : 'Import failed',
            }));
        }
    }, [activeWorkspace]);
    const handleFileInputChange = useCallback((e) => {
        const file = e.target.files?.[0];
        if (file) {
            void handleFileSelect(file);
        }
        // Reset input value so the same file can be re-selected
        e.target.value = '';
    }, [handleFileSelect]);
    const handlePageDragEnter = useCallback((event) => {
        if (!activeWorkspace || !hasDraggedFiles(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        fileDragDepthRef.current += 1;
        setFileDragActive(true);
        if (!wizardRef.current.open) {
            openWizardForFileDrag();
        }
    }, [activeWorkspace, openWizardForFileDrag]);
    const handlePageDragOver = useCallback((event) => {
        if (!activeWorkspace || !hasDraggedFiles(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        if (!fileDragActive) {
            setFileDragActive(true);
        }
        if (!wizardRef.current.open) {
            openWizardForFileDrag();
        }
    }, [activeWorkspace, fileDragActive, openWizardForFileDrag]);
    const handlePageDragLeave = useCallback((event) => {
        if (!activeWorkspace || !hasDraggedFiles(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
        if (fileDragDepthRef.current === 0) {
            setFileDragActive(false);
        }
    }, [activeWorkspace]);
    const handlePageDrop = useCallback((event) => {
        if (!activeWorkspace || !hasDraggedFiles(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        fileDragDepthRef.current = 0;
        setFileDragActive(false);
        if (wizardRef.current.step !== 'upload') {
            return;
        }
        const file = event.dataTransfer.files[0];
        if (file) {
            void handleFileSelect(file);
        }
    }, [activeWorkspace, handleFileSelect]);
    const markScopeDirty = useCallback(() => {
        setWizard((s) => ({
            ...s,
            scopeResult: null,
            scopeError: null,
            preflightData: null,
            preflightError: null,
            guaranteedCreateConflicts: [],
            submitError: null,
        }));
    }, []);
    const handleSelectGuaranteedEditFamily = useCallback((familyId, selectedFromLocaleVariantId) => {
        const familyNode = articleFamilyById.get(familyId);
        const nextFamily = familyNode
            ? buildGuaranteedEditFamilyFromExplorerNode(familyNode, selectedFromLocaleVariantId)
            : null;
        if (!nextFamily) {
            setWizard((s) => ({
                ...s,
                scopeError: 'That article does not currently have any live locales to guarantee edits for.',
            }));
            return;
        }
        setWizard((s) => ({
            ...s,
            scopeResult: null,
            scopeError: null,
            preflightData: null,
            preflightError: null,
            guaranteedCreateConflicts: [],
            guaranteedEditFamilies: s.guaranteedEditFamilies.some((family) => family.familyId === nextFamily.familyId)
                ? s.guaranteedEditFamilies
                : [...s.guaranteedEditFamilies, nextFamily].sort((left, right) => left.familyTitle.localeCompare(right.familyTitle)),
            submitError: null,
        }));
        setArticlePickerSearch('');
        setArticlePickerSearchResults([]);
    }, [articleFamilyById]);
    const handleRemoveGuaranteedEditFamily = useCallback((familyId) => {
        setWizard((s) => ({
            ...s,
            scopeResult: null,
            scopeError: null,
            preflightData: null,
            preflightError: null,
            guaranteedCreateConflicts: [],
            guaranteedEditFamilies: s.guaranteedEditFamilies.filter((family) => family.familyId !== familyId),
            submitError: null,
        }));
    }, []);
    const handleAddGuaranteedCreateArticle = useCallback(() => {
        if (!activeWorkspace) {
            return;
        }
        const nextArticle = createGuaranteedCreateArticle(wizard.guaranteedCreateInput, activeWorkspace.defaultLocale);
        if (!nextArticle) {
            return;
        }
        setWizard((s) => {
            const alreadyExists = s.guaranteedCreateArticles.some((article) => normalizeTitleKey(article.title) === normalizeTitleKey(nextArticle.title)
                && article.targetLocale === nextArticle.targetLocale);
            return {
                ...s,
                scopeResult: null,
                scopeError: null,
                preflightData: null,
                preflightError: null,
                guaranteedCreateConflicts: [],
                guaranteedCreateInput: '',
                guaranteedCreateArticles: alreadyExists
                    ? s.guaranteedCreateArticles
                    : [...s.guaranteedCreateArticles, nextArticle].sort((left, right) => left.title.localeCompare(right.title)),
                submitError: null,
            };
        });
    }, [activeWorkspace, wizard.guaranteedCreateInput]);
    const handleRemoveGuaranteedCreateArticle = useCallback((clientId) => {
        setWizard((s) => ({
            ...s,
            scopeResult: null,
            scopeError: null,
            preflightData: null,
            preflightError: null,
            guaranteedCreateConflicts: [],
            guaranteedCreateArticles: s.guaranteedCreateArticles.filter((article) => article.clientId !== clientId),
            submitError: null,
        }));
    }, []);
    // ---- Scope step ----
    const handleScopeSet = useCallback(async () => {
        if (!activeWorkspace || !wizard.importResult)
            return;
        setWizard((s) => ({ ...s, scopeSaving: true, scopeError: null }));
        try {
            const scopeRes = await window.kbv.invoke('pbiBatch.scope.set', {
                workspaceId: activeWorkspace.id,
                batchId: wizard.importResult.batch.id,
                mode: wizard.scopeMode,
                selectedRows: wizard.scopeSelectedRows.length > 0 ? wizard.scopeSelectedRows : undefined,
            });
            const analysisConfigPayload = {
                workspaceId: activeWorkspace.id,
                batchId: wizard.importResult.batch.id,
                analysisConfig: {
                    guaranteedEditSelections: wizard.guaranteedEditFamilies.map((family) => ({
                        familyId: family.familyId,
                        localeVariantId: family.selectedFromLocaleVariantId,
                    })),
                    guaranteedCreateArticles: wizard.guaranteedCreateArticles.map((article) => ({
                        clientId: article.clientId,
                        title: article.title,
                        targetLocale: article.targetLocale,
                    })),
                    analysisGuidancePrompt: wizard.analysisGuidancePrompt,
                },
            };
            const analysisRes = await window.kbv.invoke('pbiBatch.analysisConfig.set', analysisConfigPayload);
            if (scopeRes.ok && scopeRes.data && analysisRes.ok && analysisRes.data) {
                setWizard((s) => ({
                    ...s,
                    scopeSaving: false,
                    scopeResult: scopeRes.data.scope,
                    guaranteedEditFamilies: analysisRes.data.analysisConfig.guaranteedEditFamilies,
                    guaranteedCreateArticles: analysisRes.data.analysisConfig.guaranteedCreateArticles,
                    analysisGuidancePrompt: analysisRes.data.analysisConfig.analysisGuidancePrompt ?? '',
                    guaranteedCreateConflicts: analysisRes.data.guaranteedCreateConflicts,
                }));
            }
            else {
                setWizard((s) => ({
                    ...s,
                    scopeSaving: false,
                    scopeError: scopeRes.error?.message ?? analysisRes.error?.message ?? 'Failed to save scope and targets.',
                }));
            }
        }
        catch {
            setWizard((s) => ({
                ...s,
                scopeSaving: false,
                scopeError: 'Failed to save scope and targets.',
            }));
        }
    }, [
        activeWorkspace,
        wizard.analysisGuidancePrompt,
        wizard.guaranteedCreateArticles,
        wizard.guaranteedEditFamilies,
        wizard.importResult,
        wizard.scopeMode,
        wizard.scopeSelectedRows,
    ]);
    // ---- Preflight step ----
    const handleLoadPreflight = useCallback(async () => {
        if (!activeWorkspace || !wizard.importResult)
            return;
        setWizard((s) => ({ ...s, preflightLoading: true, preflightError: null }));
        try {
            const res = await window.kbv.invoke('pbiBatch.getPreflight', {
                workspaceId: activeWorkspace.id,
                batchId: wizard.importResult.batch.id,
            });
            if (res.ok && res.data) {
                const scopedCount = res.data.scopePayload.scopedCount ?? res.data.candidateRows.length;
                const recommendedBudgetMinutes = recommendWorkerStageBudgetMinutes(scopedCount);
                const storedBudgetMinutes = normalizeBatchAnalysisWorkerStageBudgetMinutes(res.data.batch.workerStageBudgetMinutes);
                setWizard((s) => ({
                    ...s,
                    preflightLoading: false,
                    preflightData: res.data,
                    step: 'preflight',
                    workerStageBudgetMinutes: storedBudgetMinutes
                        ?? (s.workerStageBudgetDirty ? s.workerStageBudgetMinutes : recommendedBudgetMinutes),
                }));
            }
            else {
                setWizard((s) => ({
                    ...s,
                    preflightLoading: false,
                    preflightError: res.error?.message ?? 'Failed to load preflight',
                }));
            }
        }
        catch (err) {
            setWizard((s) => ({
                ...s,
                preflightLoading: false,
                preflightError: err instanceof Error ? err.message : 'Failed to load preflight',
            }));
        }
    }, [activeWorkspace, wizard.importResult]);
    // ---- Submit step ----
    const handleSubmitBatch = useCallback(async () => {
        if (!activeWorkspace || !wizard.importResult)
            return;
        setWizard((s) => ({ ...s, submitting: true, submitError: null }));
        try {
            const workerStageBudgetMinutes = normalizeBatchAnalysisWorkerStageBudgetMinutes(wizard.workerStageBudgetMinutes)
                ?? recommendWorkerStageBudgetMinutes(wizard.preflightData?.scopePayload.scopedCount ?? 0);
            const res = await window.kbv.invoke('pbiBatch.setStatus', {
                workspaceId: activeWorkspace.id,
                batchId: wizard.importResult.batch.id,
                status: PBIBatchStatus.SUBMITTED,
                workerStageBudgetMinutes,
            });
            if (res.ok && res.data?.batch) {
                const submittedBatch = res.data.batch;
                setWizard(WIZARD_INITIAL);
                batchListQuery.execute({ workspaceId: activeWorkspace.id });
                sessionListQuery.execute({ workspaceId: activeWorkspace.id, includeClosed: true });
                openAnalysis(submittedBatch, true);
            }
            else {
                setWizard((s) => ({
                    ...s,
                    submitting: false,
                    submitError: res.error?.message ?? 'Failed to submit batch for analysis',
                }));
            }
        }
        catch (err) {
            setWizard((s) => ({
                ...s,
                submitting: false,
                submitError: err instanceof Error ? err.message : 'Failed to submit batch for analysis',
            }));
        }
    }, [
        activeWorkspace,
        batchListQuery,
        openAnalysis,
        sessionListQuery,
        wizard.importResult,
        wizard.preflightData,
        wizard.workerStageBudgetMinutes,
    ]);
    // ---- Wizard step navigation ----
    const goToStep = useCallback((step) => {
        if (step === 'preflight') {
            void handleLoadPreflight();
        }
        else {
            setWizard((s) => ({ ...s, step }));
        }
    }, [handleLoadPreflight]);
    // ---- Render wizard content ----
    const renderWizardContent = () => {
        switch (wizard.step) {
            case 'upload':
                return (_jsxs(_Fragment, { children: [wizard.importError && (_jsxs("div", { className: "preflight-warning-banner", style: { marginBottom: 'var(--space-4)' }, children: [_jsx(IconAlertCircle, { size: 14 }), _jsx("span", { children: wizard.importError })] })), wizard.importing ? (_jsx(LoadingState, { message: "Parsing file..." })) : (_jsxs("div", { className: `upload-zone${fileDragActive ? ' drag-over' : ''}`, onClick: () => fileInputRef.current?.click(), onDragOver: (e) => e.preventDefault(), role: "button", tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ')
                                fileInputRef.current?.click(); }, children: [_jsx(IconUpload, { size: 32, className: "upload-zone-icon" }), _jsx("div", { className: "upload-zone-title", children: "Drop a CSV or HTML file here" }), _jsx("div", { className: "upload-zone-hint", children: "or click to browse. Accepts Azure DevOps exports in CSV or HTML table format." })] })), _jsx("input", { ref: fileInputRef, type: "file", accept: ".csv,.html,.htm", style: { display: 'none' }, onChange: handleFileInputChange })] }));
            case 'summary':
                if (!wizard.importResult)
                    return null;
                return (_jsxs(_Fragment, { children: [_jsx(ParseSummaryGrid, { summary: wizard.importResult.summary }), _jsx(RowReviewTable, { title: "Duplicate Rows", rows: wizard.importResult.duplicateRows, variant: "warning" }), _jsx(RowReviewTable, { title: "Malformed Rows", rows: wizard.importResult.invalidRows, variant: "danger" }), _jsx(RowReviewTable, { title: "Ignored Rows", rows: wizard.importResult.ignoredRows, variant: "neutral" })] }));
            case 'scope':
                {
                    const browseFamilies = articlePickerTree
                        .map((node) => buildGuaranteedEditFamilyFromExplorerNode(node))
                        .filter((family) => Boolean(family))
                        .slice(0, 12);
                    return (_jsxs(_Fragment, { children: [wizard.scopeError && (_jsxs("div", { className: "preflight-warning-banner", style: { marginBottom: 'var(--space-4)' }, children: [_jsx(IconAlertCircle, { size: 14 }), _jsx("span", { children: wizard.scopeError })] })), _jsx(ScopeModePicker, { mode: wizard.scopeMode, onModeChange: (m) => {
                                    setWizard((s) => ({
                                        ...s,
                                        scopeMode: m,
                                        scopeResult: null,
                                        scopeError: null,
                                        preflightData: null,
                                        preflightError: null,
                                        guaranteedCreateConflicts: [],
                                        submitError: null,
                                    }));
                                }, scopedCount: wizard.scopeResult?.scopedCount ?? undefined }), wizard.scopeMode !== PBIBatchScopeMode.ALL && wizard.importResult && (_jsxs("div", { className: "scope-section", children: [_jsx("div", { className: "scope-section-heading", children: wizard.scopeMode === PBIBatchScopeMode.SELECTED_ONLY ? 'Select rows to include' : 'Select rows to exclude' }), _jsx("div", { style: { maxHeight: 240, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2)' }, children: wizard.importResult.rows
                                            .filter((r) => r.validationStatus === 'candidate' || r.state === 'candidate')
                                            .map((row) => {
                                            const selected = wizard.scopeSelectedRows.includes(row.sourceRowNumber);
                                            return (_jsxs("label", { className: "scope-row-checkbox", children: [_jsx("input", { type: "checkbox", checked: selected, onChange: () => {
                                                            setWizard((s) => {
                                                                const nextSelectedRows = selected
                                                                    ? s.scopeSelectedRows.filter((n) => n !== row.sourceRowNumber)
                                                                    : [...s.scopeSelectedRows, row.sourceRowNumber];
                                                                return {
                                                                    ...s,
                                                                    scopeResult: null,
                                                                    scopeError: null,
                                                                    preflightData: null,
                                                                    preflightError: null,
                                                                    guaranteedCreateConflicts: [],
                                                                    scopeSelectedRows: nextSelectedRows,
                                                                    submitError: null,
                                                                };
                                                            });
                                                        } }), _jsxs("span", { style: { fontFamily: 'var(--font-mono)', minWidth: 32 }, children: ["#", row.sourceRowNumber] }), _jsx("span", { style: { flex: 1 }, children: row.title || row.externalId })] }, row.id ?? row.sourceRowNumber));
                                        }) })] })), _jsxs("div", { className: "scope-section", children: [_jsx("div", { className: "scope-section-heading", children: "Guaranteed Article Edits" }), _jsx("div", { className: "scope-section-copy", children: "Select existing KB articles that must be edited. Each selection expands to every live locale in that article family." }), _jsx("div", { className: "analysis-target-search-row", children: _jsx("input", { className: "input", value: articlePickerSearch, onChange: (event) => {
                                                setArticlePickerSearch(event.target.value);
                                            }, placeholder: "Search existing live articles by title" }) }), articlePickerSearchLoading && (_jsx("div", { className: "analysis-target-hint", children: "Searching articles..." })), !articlePickerSearchLoading && articlePickerSearch.trim() && articlePickerSearchResults.length === 0 && (_jsx("div", { className: "analysis-target-hint", children: "No live article matches yet." })), articlePickerSearchResults.length > 0 && (_jsx("div", { className: "analysis-target-search-results", children: articlePickerSearchResults.map((result) => {
                                            const familyNode = articleFamilyById.get(result.familyId);
                                            const resolvedFamily = familyNode ? buildGuaranteedEditFamilyFromExplorerNode(familyNode, result.localeVariantId) : null;
                                            return (_jsxs("button", { className: "analysis-target-result", type: "button", onClick: () => handleSelectGuaranteedEditFamily(result.familyId, result.localeVariantId), disabled: !resolvedFamily, children: [_jsxs("div", { children: [_jsx("div", { className: "analysis-target-result-title", children: result.title }), _jsx("div", { className: "analysis-target-result-meta", children: resolvedFamily
                                                                    ? `${resolvedFamily.resolvedLocaleVariants.length} live locale${resolvedFamily.resolvedLocaleVariants.length === 1 ? '' : 's'}`
                                                                    : 'No live locales available' })] }), _jsx("span", { className: "analysis-target-result-snippet", children: result.snippet })] }, `${result.familyId}-${result.localeVariantId}`));
                                        }) })), !articlePickerSearch.trim() && (_jsxs(_Fragment, { children: [_jsx("div", { className: "analysis-target-hint", children: articlePickerTreeLoading ? 'Loading article families...' : 'Quick pick from live article families:' }), _jsx("div", { className: "analysis-target-browse-list", children: browseFamilies.map((family) => (_jsxs("button", { className: "analysis-target-chip", type: "button", onClick: () => handleSelectGuaranteedEditFamily(family.familyId), children: [family.familyTitle, _jsx("span", { children: family.resolvedLocaleVariants.map((variant) => variant.locale).join(', ') })] }, family.familyId))) })] })), _jsxs("div", { className: "analysis-target-selected-list", children: [wizard.guaranteedEditFamilies.map((family) => (_jsxs("div", { className: "analysis-target-selected-card", children: [_jsxs("div", { children: [_jsx("div", { className: "analysis-target-selected-title", children: family.familyTitle }), _jsx("div", { className: "analysis-target-selected-meta", children: family.resolvedLocaleVariants.map((variant) => variant.locale).join(', ') })] }), _jsx("button", { className: "btn btn-ghost btn-icon", type: "button", onClick: () => handleRemoveGuaranteedEditFamily(family.familyId), "aria-label": `Remove ${family.familyTitle}`, children: _jsx(IconX, { size: 14 }) })] }, family.familyId))), wizard.guaranteedEditFamilies.length === 0 && (_jsx("div", { className: "analysis-target-hint", children: "No guaranteed edit targets selected yet." }))] })] }), _jsxs("div", { className: "scope-section", children: [_jsx("div", { className: "scope-section-heading", children: "Guaranteed Article Creates" }), _jsxs("div", { className: "scope-section-copy", children: ["Add article titles that must be created in ", activeWorkspace?.defaultLocale, "."] }), _jsxs("div", { className: "analysis-target-create-row", children: [_jsx("input", { className: "input", value: wizard.guaranteedCreateInput, onChange: (event) => {
                                                    setWizard((s) => ({ ...s, guaranteedCreateInput: event.target.value }));
                                                }, onKeyDown: (event) => {
                                                    if (event.key === 'Enter') {
                                                        event.preventDefault();
                                                        handleAddGuaranteedCreateArticle();
                                                    }
                                                }, placeholder: "Type an article title and press Enter" }), _jsx("button", { className: "btn btn-secondary", type: "button", onClick: handleAddGuaranteedCreateArticle, children: "Add" })] }), _jsxs("div", { className: "analysis-target-selected-list", children: [wizard.guaranteedCreateArticles.map((article) => (_jsxs("div", { className: "analysis-target-selected-card", children: [_jsxs("div", { children: [_jsx("div", { className: "analysis-target-selected-title", children: article.title }), _jsx("div", { className: "analysis-target-selected-meta", children: article.targetLocale })] }), _jsx("button", { className: "btn btn-ghost btn-icon", type: "button", onClick: () => handleRemoveGuaranteedCreateArticle(article.clientId), "aria-label": `Remove ${article.title}`, children: _jsx(IconX, { size: 14 }) })] }, article.clientId))), wizard.guaranteedCreateArticles.length === 0 && (_jsx("div", { className: "analysis-target-hint", children: "No guaranteed create targets added yet." }))] }), wizard.guaranteedCreateConflicts.length > 0 && (_jsx("div", { className: "analysis-target-conflict-list", children: wizard.guaranteedCreateConflicts.map((conflict) => (_jsxs("div", { className: "analysis-target-conflict-card", children: [_jsxs("div", { className: "analysis-target-conflict-title", children: [conflict.title, " (", conflict.targetLocale, ")"] }), _jsx("div", { className: "analysis-target-conflict-copy", children: "This may already exist and will pause for clarification before planning continues." }), _jsx("div", { className: "analysis-target-conflict-matches", children: conflict.matches.map((match) => `${match.title} (${match.locale})`).join(', ') })] }, conflict.clientId))) }))] }), _jsxs("div", { className: "scope-section", children: [_jsx("div", { className: "scope-section-heading", children: "Analysis Guidance" }), _jsx("div", { className: "scope-section-copy", children: "Optional instructions for how the analyzer should think about the selected PBIs and article targets." }), _jsx("textarea", { className: "textarea", rows: 5, value: wizard.analysisGuidancePrompt, onChange: (event) => {
                                            markScopeDirty();
                                            setWizard((s) => ({ ...s, analysisGuidancePrompt: event.target.value }));
                                        }, placeholder: "Optional guidance for the planner and reviewer" })] })] }));
                }
            case 'preflight': {
                if (wizard.preflightLoading)
                    return _jsx(LoadingState, { message: "Running preflight checks..." });
                if (wizard.preflightError)
                    return _jsx(ErrorState, { title: "Preflight failed", description: wizard.preflightError });
                if (!wizard.preflightData)
                    return null;
                const recommendedWorkerStageBudgetMinutes = recommendWorkerStageBudgetMinutes(wizard.preflightData.scopePayload.scopedCount ?? 0);
                return (_jsxs(_Fragment, { children: [wizard.submitError && (_jsxs("div", { className: "preflight-warning-banner", style: { marginBottom: 'var(--space-4)' }, children: [_jsx(IconAlertCircle, { size: 14 }), _jsx("span", { children: wizard.submitError })] })), _jsx(PreflightPanel, { batch: wizard.preflightData.batch, candidateCount: wizard.preflightData.candidateRows.length, invalidCount: wizard.preflightData.invalidRows.length, duplicateCount: wizard.preflightData.duplicateRows.length, ignoredCount: wizard.preflightData.ignoredRows.length, scopedCount: wizard.preflightData.scopePayload.scopedCount ?? 0, candidateTitles: wizard.preflightData.candidateTitles, analysisConfig: wizard.preflightData.analysisConfig, guaranteedCreateConflicts: wizard.preflightData.guaranteedCreateConflicts, workerStageBudgetMinutes: wizard.workerStageBudgetMinutes, recommendedWorkerStageBudgetMinutes: recommendedWorkerStageBudgetMinutes, onWorkerStageBudgetMinutesChange: (minutes) => {
                                setWizard((s) => ({
                                    ...s,
                                    workerStageBudgetMinutes: minutes,
                                    workerStageBudgetDirty: true,
                                }));
                            } })] }));
            }
            default:
                return null;
        }
    };
    const renderWizardFooter = () => {
        const stepIndex = WIZARD_STEPS.indexOf(wizard.step);
        const isFirst = stepIndex === 0;
        const isLast = stepIndex === WIZARD_STEPS.length - 1;
        return (_jsxs("div", { className: "wizard-footer", children: [_jsx("div", { className: "wizard-footer-left", children: !isFirst && wizard.step !== 'upload' && (_jsx("button", { className: "btn btn-ghost", onClick: () => goToStep(WIZARD_STEPS[stepIndex - 1]), children: "Back" })) }), _jsxs("div", { className: "wizard-footer-right", children: [_jsx("button", { className: "btn btn-ghost", onClick: closeWizard, children: "Cancel" }), wizard.step === 'summary' && (_jsx("button", { className: "btn btn-primary", onClick: () => goToStep('scope'), children: "Continue to Scope & Targets" })), wizard.step === 'scope' && (_jsxs(_Fragment, { children: [!wizard.scopeResult && (_jsx("button", { className: "btn btn-secondary", disabled: wizard.scopeSaving, onClick: handleScopeSet, children: wizard.scopeSaving ? 'Saving...' : 'Apply Scope & Targets' })), wizard.scopeResult && (_jsx("button", { className: "btn btn-primary", onClick: () => goToStep('preflight'), children: "Continue to Preflight" }))] })), isLast && wizard.preflightData && (_jsx("button", { className: "btn btn-primary", disabled: wizard.submitting || (wizard.preflightData.scopePayload.scopedCount ?? 0) === 0, onClick: handleSubmitBatch, children: wizard.submitting ? 'Submitting...' : 'Submit for Analysis' }))] })] }));
    };
    /* ---------- No workspace ---------- */
    if (!activeWorkspace) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "PBI Batches", subtitle: "No workspace selected" }), _jsx("div", { className: "route-content", children: _jsx(EmptyState, { icon: _jsx(IconUpload, { size: 48 }), title: "No workspace open", description: "Open or create a workspace to import PBI batches." }) })] }));
    }
    return (_jsxs("div", { className: `pbi-batches-page${fileDragActive ? ' pbi-batches-page--dragging' : ''}`, onDragEnterCapture: handlePageDragEnter, onDragOverCapture: handlePageDragOver, onDragLeaveCapture: handlePageDragLeave, onDropCapture: handlePageDrop, children: [_jsx(PageHeader, { title: "PBI Batches", subtitle: "Import and analyze bulk product backlog items", actions: _jsxs("button", { className: "btn btn-primary", onClick: openWizard, children: [_jsx(IconPlus, { size: 14 }), "Import Batch"] }) }), _jsx("div", { className: "route-content", children: batchListQuery.loading ? (_jsx(LoadingState, { message: "Loading batches..." })) : batchListQuery.error ? (_jsx(ErrorState, { title: "Failed to load batches", description: batchListQuery.error, action: _jsx("button", { className: "btn btn-primary", onClick: () => batchListQuery.execute({ workspaceId: activeWorkspace.id }), children: "Retry" }) })) : batches.length === 0 ? (_jsx(EmptyState, { icon: _jsx(IconUpload, { size: 48 }), title: "No batches imported", description: "Upload a CSV or HTML export from Azure DevOps to start analyzing product backlog items against your KB articles.", action: _jsxs("button", { className: "btn btn-primary", onClick: openWizard, children: [_jsx(IconPlus, { size: 14 }), "Import CSV"] }) })) : (_jsx("div", { className: "table-wrapper", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Batch" }), _jsx("th", { children: "Imported" }), _jsx("th", { children: "Rows" }), _jsx("th", { children: "Candidates" }), _jsx("th", { children: "Scoped" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Actions" })] }) }), _jsx("tbody", { children: batches.map((b) => {
                                    const displayStatus = getDisplayBatchStatus(b);
                                    return (_jsxs("tr", { className: "pbi-batch-table-row", onClick: () => { void openAnalysisFromRow(b); }, onKeyDown: (event) => handleRowKeyDown(event, b), role: "button", tabIndex: 0, children: [_jsxs("td", { style: { fontWeight: 'var(--weight-medium)' }, children: [_jsx("div", { children: b.name }), _jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }, children: b.sourceFileName })] }), _jsx("td", { style: { color: 'var(--color-text-secondary)' }, children: formatDate(b.importedAtUtc) }), _jsx("td", { children: b.sourceRowCount }), _jsx("td", { children: b.candidateRowCount }), _jsx("td", { children: b.scopedRowCount }), _jsx("td", { children: _jsx(Badge, { variant: batchStatusVariant(displayStatus), children: STATUS_LABEL[displayStatus] ?? displayStatus }) }), _jsxs("td", { className: "pbi-batch-table-actions-cell", children: [canRunAnalysis(b) && (_jsxs("button", { className: "btn btn-primary btn-xs", onClick: (event) => {
                                                            event.stopPropagation();
                                                            void handleAnalyzeAction(b);
                                                        }, title: "Run AI analysis", "aria-label": `Run analysis on ${b.name}`, children: [_jsx(IconPlay, { size: 10 }), "Analyze"] })), _jsx("button", { className: "btn btn-ghost btn-icon pbi-batch-row-delete-btn", disabled: deletingBatchId === b.id, onClick: (event) => {
                                                            event.stopPropagation();
                                                            openDeleteDialog(b);
                                                        }, title: "Delete batch", "aria-label": `Delete batch ${b.name}`, children: _jsx(IconX, { size: 14 }) })] })] }, b.id));
                                }) })] }) })) }), wizard.open && (_jsx("div", { className: "wizard-overlay", onClick: (e) => { if (e.target === e.currentTarget)
                    closeWizard(); }, children: _jsxs("div", { className: "wizard-panel", children: [_jsxs("div", { className: "wizard-header", children: [_jsx("h2", { className: "wizard-title", children: "Import PBI Batch" }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }, children: [_jsx(StepIndicator, { steps: WIZARD_STEPS, current: wizard.step }), _jsx("button", { className: "btn btn-ghost btn-icon", onClick: closeWizard, "aria-label": "Close", children: _jsx(IconX, { size: 16 }) })] })] }), _jsx("div", { className: "wizard-body", children: renderWizardContent() }), wizard.step !== 'upload' && renderWizardFooter()] }) })), _jsx(ConfirmationDialog, { open: Boolean(batchToDelete), title: "Delete PBI batch", message: _jsxs(_Fragment, { children: [_jsxs("p", { children: ["Delete ", _jsx("strong", { children: batchToDelete?.name }), " from this workspace?"] }), _jsx("p", { children: "This will permanently remove the batch and all its uploaded rows. This action cannot be undone." }), deleteBatchError && _jsx("p", { className: "confirmation-dialog__error", children: deleteBatchError })] }), confirmText: deletingBatchId ? 'Deleting...' : 'Delete batch', isProcessing: Boolean(deletingBatchId), onClose: closeDeleteDialog, onConfirm: handleDeleteBatch }), _jsx(Drawer, { open: Boolean(analysisBatch), onClose: () => {
                    setAnalysisBatch(null);
                    setAnalysisAutoRun(false);
                    if (activeWorkspace)
                        batchListQuery.execute({ workspaceId: activeWorkspace.id });
                    if (activeWorkspace)
                        sessionListQuery.execute({ workspaceId: activeWorkspace.id, includeClosed: true });
                }, title: `AI Analysis — ${analysisBatch?.name ?? ''}`, variant: "wide", children: analysisBatch && activeWorkspace && (_jsx(AnalysisJobRunner, { workspaceId: activeWorkspace.id, batchId: analysisBatch.id, workerStageBudgetMinutes: analysisBatch.workerStageBudgetMinutes, startOnOpen: analysisAutoRun, onComplete: () => {
                        if (activeWorkspace)
                            batchListQuery.execute({ workspaceId: activeWorkspace.id });
                        if (activeWorkspace)
                            sessionListQuery.execute({ workspaceId: activeWorkspace.id, includeClosed: true });
                    } })) })] }));
};
