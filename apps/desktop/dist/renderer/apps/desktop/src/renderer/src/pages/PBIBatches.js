import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PBIBatchStatus, PBIBatchScopeMode, } from '@kb-vault/shared-types';
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
    scope: 'Scope',
    preflight: 'Confirm',
};
const STATUS_LABEL = {
    imported: 'Imported',
    scoped: 'Scoped',
    submitted: 'Submitted',
    analyzing: 'Analyzing',
    analyzed: 'Analyzed',
    review_in_progress: 'In Review',
    review_complete: 'Complete',
    archived: 'Archived',
    proposed: 'Proposed',
};
/* ---------- Helpers ---------- */
function batchStatusVariant(status) {
    switch (status) {
        case 'imported': return 'neutral';
        case 'scoped': return 'primary';
        case 'submitted': return 'primary';
        case 'analyzing': return 'warning';
        case 'analyzed': return 'primary';
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
function PreflightPanel({ batch, candidateCount, invalidCount, duplicateCount, ignoredCount, scopedCount, candidateTitles, }) {
    return (_jsxs(_Fragment, { children: [(invalidCount > 0 || duplicateCount > 0) && (_jsxs("div", { className: "preflight-warning-banner", children: [_jsx(IconAlertCircle, { size: 14 }), _jsxs("div", { children: [invalidCount > 0 && _jsxs("div", { children: [invalidCount, " malformed row", invalidCount !== 1 ? 's' : '', " will be excluded."] }), duplicateCount > 0 && _jsxs("div", { children: [duplicateCount, " duplicate row", duplicateCount !== 1 ? 's' : '', " will be excluded."] }), ignoredCount > 0 && _jsxs("div", { children: [ignoredCount, " ignored row", ignoredCount !== 1 ? 's' : '', " will be excluded."] })] })] })), _jsxs("div", { className: "preflight-section", children: [_jsx("div", { className: "preflight-heading", children: "Preflight Checklist" }), _jsxs("div", { className: "preflight-checklist", children: [_jsxs("div", { className: "preflight-item", children: [_jsx(IconCheckCircle, { size: 14, className: "preflight-item-icon preflight-item-icon--pass" }), _jsxs("span", { children: ["Batch ", _jsx("strong", { children: batch.name }), " from ", batch.sourceFileName] })] }), _jsxs("div", { className: "preflight-item", children: [_jsx(IconCheckCircle, { size: 14, className: "preflight-item-icon preflight-item-icon--pass" }), _jsxs("span", { children: [candidateCount, " candidates identified"] })] }), _jsxs("div", { className: "preflight-item", children: [scopedCount > 0 ? (_jsx(IconCheckCircle, { size: 14, className: "preflight-item-icon preflight-item-icon--pass" })) : (_jsx(IconAlertCircle, { size: 14, className: "preflight-item-icon preflight-item-icon--warn" })), _jsxs("span", { children: [scopedCount, " row", scopedCount !== 1 ? 's' : '', " in scope for AI analysis"] })] })] })] }), candidateTitles.length > 0 && (_jsxs("div", { className: "preflight-section", children: [_jsx("div", { className: "preflight-heading", children: "Scoped Items Preview" }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 2 }, children: [candidateTitles.slice(0, 10).map((title, i) => (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)', padding: 'var(--space-1) 0' }, children: [_jsx(IconFileText, { size: 12, style: { color: 'var(--color-text-muted)', flexShrink: 0 } }), _jsx("span", { children: title })] }, i))), candidateTitles.length > 10 && (_jsxs("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', paddingTop: 'var(--space-1)' }, children: ["and ", candidateTitles.length - 10, " more..."] }))] })] }))] }));
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
    scopeResult: null,
    preflightLoading: false,
    preflightError: null,
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
    const [wizard, setWizard] = useState(WIZARD_INITIAL);
    const [batchToDelete, setBatchToDelete] = useState(null);
    const [deletingBatchId, setDeletingBatchId] = useState(null);
    const [deleteBatchError, setDeleteBatchError] = useState(null);
    const [analysisBatch, setAnalysisBatch] = useState(null);
    const [analysisAutoRun, setAnalysisAutoRun] = useState(false);
    const [activeAnalysisBatchIds, setActiveAnalysisBatchIds] = useState([]);
    const [cachedBatches, setCachedBatches] = useState([]);
    const [cachedSessions, setCachedSessions] = useState([]);
    const [persistedAnalysisBatchIds, setPersistedAnalysisBatchIds] = useState([]);
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
            setPersistedAnalysisBatchIds([]);
        }
    }, [activeWorkspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!activeWorkspace) {
            setPersistedAnalysisBatchIds([]);
            return;
        }
        const candidateBatchIds = batches
            .filter((batch) => batch.status !== PBIBatchStatus.ANALYZED
            && batch.status !== PBIBatchStatus.REVIEW_IN_PROGRESS
            && batch.status !== PBIBatchStatus.REVIEW_COMPLETE)
            .map((batch) => batch.id);
        if (candidateBatchIds.length === 0) {
            setPersistedAnalysisBatchIds([]);
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
                        return null;
                    }
                    return response.data.run || response.data.orchestration?.latestIteration ? batchId : null;
                }
                catch {
                    return null;
                }
            }));
            if (cancelled) {
                return;
            }
            setPersistedAnalysisBatchIds(results.filter((batchId) => Boolean(batchId)));
        })();
        return () => {
            cancelled = true;
        };
    }, [activeWorkspace?.id, batches]);
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
            if (batchId) {
                setActiveAnalysisBatchIds((current) => {
                    const next = new Set(current);
                    if (event.state === 'RUNNING' || event.state === 'QUEUED') {
                        next.add(batchId);
                    }
                    if (event.state === 'SUCCEEDED' || event.state === 'FAILED' || event.state === 'CANCELED') {
                        next.delete(batchId);
                    }
                    return Array.from(next);
                });
            }
            const stateChanged = previousState !== event.state;
            const shouldRefresh = (event.state === 'QUEUED' || event.state === 'RUNNING' || event.state === 'SUCCEEDED' || event.state === 'FAILED' || event.state === 'CANCELED')
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
        setWizard({ ...WIZARD_INITIAL, open: true });
    }, []);
    const closeWizard = useCallback(() => {
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
        for (const batchId of persistedAnalysisBatchIds) {
            analyzedBatchIds.add(batchId);
        }
        return analyzedBatchIds;
    }, [sessionListQuery.data?.sessions, cachedSessions, persistedAnalysisBatchIds]);
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
        if (persistedAnalysisBatchIds.includes(batch.id)
            && batch.status !== PBIBatchStatus.ANALYZED
            && batch.status !== PBIBatchStatus.REVIEW_IN_PROGRESS
            && batch.status !== PBIBatchStatus.REVIEW_COMPLETE) {
            return PBIBatchStatus.ANALYZED;
        }
        return batch.status;
    }, [persistedAnalysisBatchIds, runningAnalysisBatchIds]);
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
            if (hasPersistedOutcome) {
                setPersistedAnalysisBatchIds((current) => (current.includes(batchId) ? current : [...current, batchId]));
            }
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
        setWizard((s) => ({ ...s, importing: true, importError: null }));
        try {
            const content = await file.text();
            const format = file.name.toLowerCase().endsWith('.html') || file.name.toLowerCase().endsWith('.htm')
                ? 'html'
                : 'csv';
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
    const handleDrop = useCallback((e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) {
            void handleFileSelect(file);
        }
    }, [handleFileSelect]);
    // ---- Scope step ----
    const handleScopeSet = useCallback(async () => {
        if (!activeWorkspace || !wizard.importResult)
            return;
        setWizard((s) => ({ ...s, scopeSaving: true }));
        try {
            const res = await window.kbv.invoke('pbiBatch.scope.set', {
                workspaceId: activeWorkspace.id,
                batchId: wizard.importResult.batch.id,
                mode: wizard.scopeMode,
                selectedRows: wizard.scopeSelectedRows.length > 0 ? wizard.scopeSelectedRows : undefined,
            });
            if (res.ok && res.data) {
                setWizard((s) => ({
                    ...s,
                    scopeSaving: false,
                    scopeResult: res.data.scope,
                }));
            }
            else {
                setWizard((s) => ({ ...s, scopeSaving: false }));
            }
        }
        catch {
            setWizard((s) => ({ ...s, scopeSaving: false }));
        }
    }, [activeWorkspace, wizard.importResult, wizard.scopeMode, wizard.scopeSelectedRows]);
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
                setWizard((s) => ({
                    ...s,
                    preflightLoading: false,
                    preflightData: res.data,
                    step: 'preflight',
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
            const res = await window.kbv.invoke('pbiBatch.setStatus', {
                workspaceId: activeWorkspace.id,
                batchId: wizard.importResult.batch.id,
                status: PBIBatchStatus.SUBMITTED,
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
    }, [activeWorkspace, batchListQuery, openAnalysis, sessionListQuery, wizard.importResult]);
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
                return (_jsxs(_Fragment, { children: [wizard.importError && (_jsxs("div", { className: "preflight-warning-banner", style: { marginBottom: 'var(--space-4)' }, children: [_jsx(IconAlertCircle, { size: 14 }), _jsx("span", { children: wizard.importError })] })), wizard.importing ? (_jsx(LoadingState, { message: "Parsing file..." })) : (_jsxs("div", { className: "upload-zone", onClick: () => fileInputRef.current?.click(), onDragOver: (e) => e.preventDefault(), onDrop: handleDrop, role: "button", tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ')
                                fileInputRef.current?.click(); }, children: [_jsx(IconUpload, { size: 32, className: "upload-zone-icon" }), _jsx("div", { className: "upload-zone-title", children: "Drop a CSV or HTML file here" }), _jsx("div", { className: "upload-zone-hint", children: "or click to browse. Accepts Azure DevOps exports in CSV or HTML table format." })] })), _jsx("input", { ref: fileInputRef, type: "file", accept: ".csv,.html,.htm", style: { display: 'none' }, onChange: handleFileInputChange })] }));
            case 'summary':
                if (!wizard.importResult)
                    return null;
                return (_jsxs(_Fragment, { children: [_jsx(ParseSummaryGrid, { summary: wizard.importResult.summary }), _jsx(RowReviewTable, { title: "Duplicate Rows", rows: wizard.importResult.duplicateRows, variant: "warning" }), _jsx(RowReviewTable, { title: "Malformed Rows", rows: wizard.importResult.invalidRows, variant: "danger" }), _jsx(RowReviewTable, { title: "Ignored Rows", rows: wizard.importResult.ignoredRows, variant: "neutral" })] }));
            case 'scope':
                return (_jsxs(_Fragment, { children: [_jsx(ScopeModePicker, { mode: wizard.scopeMode, onModeChange: (m) => {
                                setWizard((s) => ({ ...s, scopeMode: m, scopeResult: null }));
                            }, scopedCount: wizard.scopeResult?.scopedCount ?? undefined }), wizard.scopeMode !== PBIBatchScopeMode.ALL && wizard.importResult && (_jsxs("div", { className: "scope-section", children: [_jsx("div", { className: "scope-section-heading", children: wizard.scopeMode === PBIBatchScopeMode.SELECTED_ONLY ? 'Select rows to include' : 'Select rows to exclude' }), _jsx("div", { style: { maxHeight: 240, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2)' }, children: wizard.importResult.rows
                                        .filter((r) => r.validationStatus === 'candidate' || r.state === 'candidate')
                                        .map((row) => {
                                        const selected = wizard.scopeSelectedRows.includes(row.sourceRowNumber);
                                        return (_jsxs("label", { className: "scope-row-checkbox", children: [_jsx("input", { type: "checkbox", checked: selected, onChange: () => {
                                                        setWizard((s) => ({
                                                            ...s,
                                                            scopeResult: null,
                                                            scopeSelectedRows: selected
                                                                ? s.scopeSelectedRows.filter((n) => n !== row.sourceRowNumber)
                                                                : [...s.scopeSelectedRows, row.sourceRowNumber],
                                                        }));
                                                    } }), _jsxs("span", { style: { fontFamily: 'var(--font-mono)', minWidth: 32 }, children: ["#", row.sourceRowNumber] }), _jsx("span", { style: { flex: 1 }, children: row.title || row.externalId })] }, row.id ?? row.sourceRowNumber));
                                    }) })] }))] }));
            case 'preflight':
                if (wizard.preflightLoading)
                    return _jsx(LoadingState, { message: "Running preflight checks..." });
                if (wizard.preflightError)
                    return _jsx(ErrorState, { title: "Preflight failed", description: wizard.preflightError });
                if (!wizard.preflightData)
                    return null;
                return (_jsxs(_Fragment, { children: [wizard.submitError && (_jsxs("div", { className: "preflight-warning-banner", style: { marginBottom: 'var(--space-4)' }, children: [_jsx(IconAlertCircle, { size: 14 }), _jsx("span", { children: wizard.submitError })] })), _jsx(PreflightPanel, { batch: wizard.preflightData.batch, candidateCount: wizard.preflightData.candidateRows.length, invalidCount: wizard.preflightData.invalidRows.length, duplicateCount: wizard.preflightData.duplicateRows.length, ignoredCount: wizard.preflightData.ignoredRows.length, scopedCount: wizard.preflightData.scopePayload.scopedCount ?? 0, candidateTitles: wizard.preflightData.candidateTitles })] }));
            default:
                return null;
        }
    };
    const renderWizardFooter = () => {
        const stepIndex = WIZARD_STEPS.indexOf(wizard.step);
        const isFirst = stepIndex === 0;
        const isLast = stepIndex === WIZARD_STEPS.length - 1;
        return (_jsxs("div", { className: "wizard-footer", children: [_jsx("div", { className: "wizard-footer-left", children: !isFirst && wizard.step !== 'upload' && (_jsx("button", { className: "btn btn-ghost", onClick: () => goToStep(WIZARD_STEPS[stepIndex - 1]), children: "Back" })) }), _jsxs("div", { className: "wizard-footer-right", children: [_jsx("button", { className: "btn btn-ghost", onClick: closeWizard, children: "Cancel" }), wizard.step === 'summary' && (_jsx("button", { className: "btn btn-primary", onClick: () => goToStep('scope'), children: "Continue to Scoping" })), wizard.step === 'scope' && (_jsxs(_Fragment, { children: [!wizard.scopeResult && (_jsx("button", { className: "btn btn-secondary", disabled: wizard.scopeSaving, onClick: handleScopeSet, children: wizard.scopeSaving ? 'Saving...' : 'Apply Scope' })), wizard.scopeResult && (_jsx("button", { className: "btn btn-primary", onClick: () => goToStep('preflight'), children: "Continue to Preflight" }))] })), isLast && wizard.preflightData && (_jsx("button", { className: "btn btn-primary", disabled: wizard.submitting || (wizard.preflightData.scopePayload.scopedCount ?? 0) === 0, onClick: handleSubmitBatch, children: wizard.submitting ? 'Submitting...' : 'Submit for Analysis' }))] })] }));
    };
    /* ---------- No workspace ---------- */
    if (!activeWorkspace) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "PBI Batches", subtitle: "No workspace selected" }), _jsx("div", { className: "route-content", children: _jsx(EmptyState, { icon: _jsx(IconUpload, { size: 48 }), title: "No workspace open", description: "Open or create a workspace to import PBI batches." }) })] }));
    }
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "PBI Batches", subtitle: "Import and analyze bulk product backlog items", actions: _jsxs("button", { className: "btn btn-primary", onClick: openWizard, children: [_jsx(IconPlus, { size: 14 }), "Import Batch"] }) }), _jsx("div", { className: "route-content", children: batchListQuery.loading ? (_jsx(LoadingState, { message: "Loading batches..." })) : batchListQuery.error ? (_jsx(ErrorState, { title: "Failed to load batches", description: batchListQuery.error, action: _jsx("button", { className: "btn btn-primary", onClick: () => batchListQuery.execute({ workspaceId: activeWorkspace.id }), children: "Retry" }) })) : batches.length === 0 ? (_jsx(EmptyState, { icon: _jsx(IconUpload, { size: 48 }), title: "No batches imported", description: "Upload a CSV or HTML export from Azure DevOps to start analyzing product backlog items against your KB articles.", action: _jsxs("button", { className: "btn btn-primary", onClick: openWizard, children: [_jsx(IconPlus, { size: 14 }), "Import CSV"] }) })) : (_jsx("div", { className: "table-wrapper", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Batch" }), _jsx("th", { children: "Imported" }), _jsx("th", { children: "Rows" }), _jsx("th", { children: "Candidates" }), _jsx("th", { children: "Scoped" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Actions" })] }) }), _jsx("tbody", { children: batches.map((b) => {
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
                }, title: `AI Analysis — ${analysisBatch?.name ?? ''}`, variant: "wide", children: analysisBatch && activeWorkspace && (_jsx(AnalysisJobRunner, { workspaceId: activeWorkspace.id, batchId: analysisBatch.id, startOnOpen: analysisAutoRun, onComplete: () => {
                        if (activeWorkspace)
                            batchListQuery.execute({ workspaceId: activeWorkspace.id });
                        if (activeWorkspace)
                            sessionListQuery.execute({ workspaceId: activeWorkspace.id, includeClosed: true });
                    } })) })] }));
};
