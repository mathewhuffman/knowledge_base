import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  PBIBatchStatus,
  PBIBatchScopeMode,
  type PBIBatchRecord,
  type PBIRecord,
  type PBIBatchImportSummary,
  type PBIBatchScopePayload,
  type PBIBatchDeleteRequest,
  type AgentSessionRecord,
  type PersistedAgentAnalysisRunResponse,
} from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/Badge';
import { ConfirmationDialog, Drawer } from '../components';
import { AnalysisJobRunner } from '../components/AgentRuntimePanel';
import {
  IconUpload,
  IconPlus,
  IconX,
  IconCheckCircle,
  IconAlertCircle,
  IconFileText,
  IconPlay,
} from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc } from '../hooks/useIpc';

/* ---------- Constants ---------- */

type WizardStep = 'upload' | 'summary' | 'scope' | 'preflight';

const WIZARD_STEPS: WizardStep[] = ['upload', 'summary', 'scope', 'preflight'];

const WIZARD_STEP_LABELS: Record<WizardStep, string> = {
  upload: 'Upload',
  summary: 'Review',
  scope: 'Scope',
  preflight: 'Confirm',
};

const STATUS_LABEL: Record<string, string> = {
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

function batchStatusVariant(status: string): 'neutral' | 'primary' | 'success' | 'warning' | 'danger' {
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

function formatDate(utc: string): string {
  try {
    return new Date(utc).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return utc;
  }
}

/* ---------- Sub-components ---------- */

function StepIndicator({ steps, current }: { steps: WizardStep[]; current: WizardStep }) {
  const currentIndex = steps.indexOf(current);
  return (
    <div className="wizard-step-indicator">
      {steps.map((step, i) => (
        <span key={step} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <span className={`wizard-step-dot${i === currentIndex ? ' active' : i < currentIndex ? ' completed' : ''}`} />
          <span style={{ fontSize: 'var(--text-xs)', color: i === currentIndex ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
            {WIZARD_STEP_LABELS[step]}
          </span>
        </span>
      ))}
    </div>
  );
}

function ParseSummaryGrid({ summary }: { summary: PBIBatchImportSummary['summary'] }) {
  const items = [
    { label: 'Total Rows', value: summary.totalRows, variant: '' },
    { label: 'Candidates', value: summary.candidateRowCount, variant: 'success' },
    { label: 'Scoped', value: summary.scopedRowCount, variant: 'success' },
    { label: 'Duplicates', value: summary.duplicateRowCount, variant: summary.duplicateRowCount > 0 ? 'warning' : '' },
    { label: 'Malformed', value: summary.malformedRowCount, variant: summary.malformedRowCount > 0 ? 'danger' : '' },
    { label: 'Ignored', value: summary.ignoredRowCount, variant: summary.ignoredRowCount > 0 ? 'warning' : '' },
  ];

  return (
    <div className="parse-summary-grid">
      {items.map((item) => (
        <div key={item.label} className={`parse-summary-card${item.variant ? ` parse-summary-card--${item.variant}` : ''}`}>
          <div className="parse-summary-value">{item.value}</div>
          <div className="parse-summary-label">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

function RowReviewTable({ title, rows, variant }: { title: string; rows: PBIRecord[]; variant: 'warning' | 'danger' | 'neutral' }) {
  if (rows.length === 0) return null;
  return (
    <div className="row-review-section">
      <div className="row-review-heading">
        <Badge variant={variant}>{rows.length}</Badge>
        {title}
      </div>
      <div className="table-wrapper">
        <table className="row-review-table">
          <thead>
            <tr>
              <th>Row #</th>
              <th>External ID</th>
              <th>Title</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id ?? i}>
                <td>{row.sourceRowNumber}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.externalId || '\u2014'}</td>
                <td>{row.title || '\u2014'}</td>
                <td><span className="row-review-reason">{row.validationReason || '\u2014'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScopeModePicker({
  mode,
  onModeChange,
  scopedCount,
}: {
  mode: PBIBatchScopeMode;
  onModeChange: (mode: PBIBatchScopeMode) => void;
  scopedCount?: number;
}) {
  const options: { value: PBIBatchScopeMode; label: string; desc: string }[] = [
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

  return (
    <div className="scope-section">
      <div className="scope-section-heading">Scope Mode</div>
      <div className="scope-mode-group">
        {options.map((opt) => (
          <div
            key={opt.value}
            className={`scope-mode-option${mode === opt.value ? ' active' : ''}`}
            onClick={() => onModeChange(opt.value)}
            role="radio"
            aria-checked={mode === opt.value}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onModeChange(opt.value); } }}
          >
            <div className="scope-mode-radio" />
            <div>
              <div className="scope-mode-label">{opt.label}</div>
              <div className="scope-mode-desc">{opt.desc}</div>
            </div>
          </div>
        ))}
      </div>
      {scopedCount != null && (
        <div className="scope-feedback">
          <IconCheckCircle size={14} />
          <span>{scopedCount} row{scopedCount !== 1 ? 's' : ''} in scope for analysis</span>
        </div>
      )}
    </div>
  );
}

function PreflightPanel({
  batch,
  candidateCount,
  invalidCount,
  duplicateCount,
  ignoredCount,
  scopedCount,
  candidateTitles,
}: {
  batch: PBIBatchRecord;
  candidateCount: number;
  invalidCount: number;
  duplicateCount: number;
  ignoredCount: number;
  scopedCount: number;
  candidateTitles: string[];
}) {
  return (
    <>
      {(invalidCount > 0 || duplicateCount > 0) && (
        <div className="preflight-warning-banner">
          <IconAlertCircle size={14} />
          <div>
            {invalidCount > 0 && <div>{invalidCount} malformed row{invalidCount !== 1 ? 's' : ''} will be excluded.</div>}
            {duplicateCount > 0 && <div>{duplicateCount} duplicate row{duplicateCount !== 1 ? 's' : ''} will be excluded.</div>}
            {ignoredCount > 0 && <div>{ignoredCount} ignored row{ignoredCount !== 1 ? 's' : ''} will be excluded.</div>}
          </div>
        </div>
      )}

      <div className="preflight-section">
        <div className="preflight-heading">Preflight Checklist</div>
        <div className="preflight-checklist">
          <div className="preflight-item">
            <IconCheckCircle size={14} className="preflight-item-icon preflight-item-icon--pass" />
            <span>Batch <strong>{batch.name}</strong> from {batch.sourceFileName}</span>
          </div>
          <div className="preflight-item">
            <IconCheckCircle size={14} className="preflight-item-icon preflight-item-icon--pass" />
            <span>{candidateCount} candidates identified</span>
          </div>
          <div className="preflight-item">
            {scopedCount > 0 ? (
              <IconCheckCircle size={14} className="preflight-item-icon preflight-item-icon--pass" />
            ) : (
              <IconAlertCircle size={14} className="preflight-item-icon preflight-item-icon--warn" />
            )}
            <span>{scopedCount} row{scopedCount !== 1 ? 's' : ''} in scope for AI analysis</span>
          </div>
        </div>
      </div>

      {candidateTitles.length > 0 && (
        <div className="preflight-section">
          <div className="preflight-heading">Scoped Items Preview</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {candidateTitles.slice(0, 10).map((title, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)', padding: 'var(--space-1) 0' }}>
                <IconFileText size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                <span>{title}</span>
              </div>
            ))}
            {candidateTitles.length > 10 && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', paddingTop: 'var(--space-1)' }}>
                and {candidateTitles.length - 10} more...
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Import Wizard ---------- */

interface WizardState {
  open: boolean;
  step: WizardStep;
  importing: boolean;
  importError: string | null;
  importResult: PBIBatchImportSummary | null;
  scopeMode: PBIBatchScopeMode;
  scopeSelectedRows: number[];
  scopeSaving: boolean;
  scopeResult: PBIBatchScopePayload | null;
  preflightLoading: boolean;
  preflightError: string | null;
  preflightData: {
    batch: PBIBatchRecord;
    candidateRows: PBIRecord[];
    invalidRows: PBIRecord[];
    duplicateRows: PBIRecord[];
    ignoredRows: PBIRecord[];
    scopePayload: PBIBatchScopePayload;
    candidateTitles: string[];
  } | null;
  submitting: boolean;
  submitError: string | null;
}

const WIZARD_INITIAL: WizardState = {
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
  const batchListQuery = useIpc<{ workspaceId: string; batches: PBIBatchRecord[] }>('pbiBatch.list');
  const sessionListQuery = useIpc<{ workspaceId: string; sessions: AgentSessionRecord[] }>('agent.session.list');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jobStateByIdRef = useRef<Record<string, string>>({});

  const [wizard, setWizard] = useState<WizardState>(WIZARD_INITIAL);
  const [batchToDelete, setBatchToDelete] = useState<PBIBatchRecord | null>(null);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [deleteBatchError, setDeleteBatchError] = useState<string | null>(null);
  const [analysisBatch, setAnalysisBatch] = useState<PBIBatchRecord | null>(null);
  const [analysisAutoRun, setAnalysisAutoRun] = useState(false);
  const [activeAnalysisBatchIds, setActiveAnalysisBatchIds] = useState<string[]>([]);
  const [cachedBatches, setCachedBatches] = useState<PBIBatchRecord[]>([]);
  const [cachedSessions, setCachedSessions] = useState<AgentSessionRecord[]>([]);
  const [persistedAnalysisBatchIds, setPersistedAnalysisBatchIds] = useState<string[]>([]);
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
    } else {
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
      .filter((batch) =>
        batch.status !== PBIBatchStatus.ANALYZED
        && batch.status !== PBIBatchStatus.REVIEW_IN_PROGRESS
        && batch.status !== PBIBatchStatus.REVIEW_COMPLETE
      )
      .map((batch) => batch.id);

    if (candidateBatchIds.length === 0) {
      setPersistedAnalysisBatchIds([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      const results = await Promise.all(
        candidateBatchIds.map(async (batchId) => {
          try {
            const response = await window.kbv.invoke<PersistedAgentAnalysisRunResponse>('agent.analysis.latest', {
              workspaceId: activeWorkspace.id,
              batchId,
              limit: 0,
            });
            if (!response.ok || !response.data) {
              return null;
            }
            return response.data.run || response.data.orchestration?.latestIteration ? batchId : null;
          } catch {
            return null;
          }
        })
      );

      if (cancelled) {
        return;
      }

      setPersistedAnalysisBatchIds(results.filter((batchId): batchId is string => Boolean(batchId)));
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
      if (event.command !== 'agent.analysis.run') return;
      const previousState = jobStateByIdRef.current[event.id];
      jobStateByIdRef.current[event.id] = event.state;
      const metadata = (event as { metadata?: { batchId?: unknown } }).metadata;
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
      const shouldRefresh =
        (event.state === 'QUEUED' || event.state === 'RUNNING' || event.state === 'SUCCEEDED' || event.state === 'FAILED' || event.state === 'CANCELED')
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
    const analyzedBatchIds = new Set<string>();
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
      if (
        session.type === 'batch_analysis'
        && session.batchId
        && (session.status === 'running' || session.status === 'starting')
      ) {
        activeBatchIds.add(session.batchId);
      }
    }
    return activeBatchIds;
  }, [activeAnalysisBatchIds, sessionListQuery.data?.sessions, cachedSessions]);

  const getDisplayBatchStatus = useCallback((batch: PBIBatchRecord) => {
    if (runningAnalysisBatchIds.has(batch.id)) {
      return 'analyzing';
    }
    if (
      persistedAnalysisBatchIds.includes(batch.id)
      && batch.status !== PBIBatchStatus.ANALYZED
      && batch.status !== PBIBatchStatus.REVIEW_IN_PROGRESS
      && batch.status !== PBIBatchStatus.REVIEW_COMPLETE
    ) {
      return PBIBatchStatus.ANALYZED;
    }
    return batch.status;
  }, [persistedAnalysisBatchIds, runningAnalysisBatchIds]);

  const openAnalysis = useCallback((batch: PBIBatchRecord, shouldAutoRun = false) => {
    setAnalysisBatch(batch);
    setAnalysisAutoRun(shouldAutoRun);
  }, []);

  const resolvePersistedAnalysisOutcome = useCallback(async (batchId: string) => {
    if (!activeWorkspace) {
      return false;
    }
    try {
      const response = await window.kbv.invoke<PersistedAgentAnalysisRunResponse>('agent.analysis.latest', {
        workspaceId: activeWorkspace.id,
        batchId,
        limit: 0,
      });
      const hasPersistedOutcome = Boolean(
        response.ok
        && response.data
        && (response.data.run || response.data.orchestration?.latestIteration)
      );
      if (hasPersistedOutcome) {
        setPersistedAnalysisBatchIds((current) => (
          current.includes(batchId) ? current : [...current, batchId]
        ));
      }
      return hasPersistedOutcome;
    } catch {
      return false;
    }
  }, [activeWorkspace]);

  const hasAnalysisHistory = useCallback((batch: PBIBatchRecord) => batchHasHistory.has(batch.id), [batchHasHistory]);
  const hasAnyAnalysisOutcome = useCallback((batch: PBIBatchRecord) => {
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
  const canRunAnalysis = useCallback((batch: PBIBatchRecord) => {
    if (runningAnalysisBatchIds.has(batch.id)) {
      return false;
    }
    if (batch.status === PBIBatchStatus.IMPORTED || batch.status === PBIBatchStatus.ARCHIVED) {
      return false;
    }
    return !hasAnyAnalysisOutcome(batch);
  }, [hasAnyAnalysisOutcome, runningAnalysisBatchIds]);

  const openAnalysisFromRow = useCallback(async (batch: PBIBatchRecord) => {
    if (hasAnyAnalysisOutcome(batch) || await resolvePersistedAnalysisOutcome(batch.id)) {
      openAnalysis(batch, false);
    }
  }, [hasAnyAnalysisOutcome, openAnalysis, resolvePersistedAnalysisOutcome]);

  const handleAnalyzeAction = useCallback(async (batch: PBIBatchRecord) => {
    if (await resolvePersistedAnalysisOutcome(batch.id)) {
      openAnalysis(batch, false);
      return;
    }
    openAnalysis(batch, true);
  }, [openAnalysis, resolvePersistedAnalysisOutcome]);

  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTableRowElement>, batch: PBIBatchRecord) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void openAnalysisFromRow(batch);
      }
    },
    [openAnalysisFromRow]
  );

  const openDeleteDialog = useCallback((batch: PBIBatchRecord) => {
    setBatchToDelete(batch);
    setDeleteBatchError(null);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    if (deletingBatchId) return;
    setBatchToDelete(null);
    setDeleteBatchError(null);
  }, [deletingBatchId]);

  const handleDeleteBatch = useCallback(async () => {
    if (!activeWorkspace || !batchToDelete) return;

    setDeletingBatchId(batchToDelete.id);
    setDeleteBatchError(null);

    try {
      const payload: PBIBatchDeleteRequest = {
        workspaceId: activeWorkspace.id,
        batchId: batchToDelete.id
      };
      const res = await window.kbv.invoke<{ workspaceId: string; batchId: string }>('pbiBatch.delete', payload);
      if (res.ok) {
        batchListQuery.execute({ workspaceId: activeWorkspace.id });
        setBatchToDelete(null);
      } else {
        setDeleteBatchError(res.error?.message ?? 'Failed to delete batch');
      }
    } catch (err) {
      setDeleteBatchError(err instanceof Error ? err.message : 'Failed to delete batch');
    } finally {
      setDeletingBatchId(null);
    }
  }, [activeWorkspace, batchToDelete, batchListQuery]);

  // ---- Upload step ----
  const handleFileSelect = useCallback(async (file: File) => {
    if (!activeWorkspace) return;

    setWizard((s) => ({ ...s, importing: true, importError: null }));

    try {
      const content = await file.text();
      const format = file.name.toLowerCase().endsWith('.html') || file.name.toLowerCase().endsWith('.htm')
        ? 'html'
        : 'csv';

      const res = await window.kbv.invoke<PBIBatchImportSummary>('pbiBatch.import', {
        workspaceId: activeWorkspace.id,
        sourceFileName: file.name,
        sourceContent: content,
        sourceFormat: format,
      });

      if (res.ok && res.data) {
        setWizard((s) => ({
          ...s,
          importing: false,
          importResult: res.data!,
          step: 'summary',
        }));
      } else {
        setWizard((s) => ({
          ...s,
          importing: false,
          importError: res.error?.message ?? 'Import failed',
        }));
      }
    } catch (err) {
      setWizard((s) => ({
        ...s,
        importing: false,
        importError: err instanceof Error ? err.message : 'Import failed',
      }));
    }
  }, [activeWorkspace]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleFileSelect(file);
    }
    // Reset input value so the same file can be re-selected
    e.target.value = '';
  }, [handleFileSelect]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      void handleFileSelect(file);
    }
  }, [handleFileSelect]);

  // ---- Scope step ----
  const handleScopeSet = useCallback(async () => {
    if (!activeWorkspace || !wizard.importResult) return;

    setWizard((s) => ({ ...s, scopeSaving: true }));

    try {
      const res = await window.kbv.invoke<{ batch: PBIBatchRecord; scope: PBIBatchScopePayload }>('pbiBatch.scope.set', {
        workspaceId: activeWorkspace.id,
        batchId: wizard.importResult.batch.id,
        mode: wizard.scopeMode,
        selectedRows: wizard.scopeSelectedRows.length > 0 ? wizard.scopeSelectedRows : undefined,
      });

      if (res.ok && res.data) {
        setWizard((s) => ({
          ...s,
          scopeSaving: false,
          scopeResult: res.data!.scope,
        }));
      } else {
        setWizard((s) => ({ ...s, scopeSaving: false }));
      }
    } catch {
      setWizard((s) => ({ ...s, scopeSaving: false }));
    }
  }, [activeWorkspace, wizard.importResult, wizard.scopeMode, wizard.scopeSelectedRows]);

  // ---- Preflight step ----
  const handleLoadPreflight = useCallback(async () => {
    if (!activeWorkspace || !wizard.importResult) return;

    setWizard((s) => ({ ...s, preflightLoading: true, preflightError: null }));

    try {
      const res = await window.kbv.invoke<WizardState['preflightData']>('pbiBatch.getPreflight', {
        workspaceId: activeWorkspace.id,
        batchId: wizard.importResult.batch.id,
      });

      if (res.ok && res.data) {
        setWizard((s) => ({
          ...s,
          preflightLoading: false,
          preflightData: res.data!,
          step: 'preflight',
        }));
      } else {
        setWizard((s) => ({
          ...s,
          preflightLoading: false,
          preflightError: res.error?.message ?? 'Failed to load preflight',
        }));
      }
    } catch (err) {
      setWizard((s) => ({
        ...s,
        preflightLoading: false,
        preflightError: err instanceof Error ? err.message : 'Failed to load preflight',
      }));
    }
  }, [activeWorkspace, wizard.importResult]);

  // ---- Submit step ----
  const handleSubmitBatch = useCallback(async () => {
    if (!activeWorkspace || !wizard.importResult) return;

    setWizard((s) => ({ ...s, submitting: true, submitError: null }));

    try {
      const res = await window.kbv.invoke<{ batch: PBIBatchRecord }>('pbiBatch.setStatus', {
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
      } else {
        setWizard((s) => ({
          ...s,
          submitting: false,
          submitError: res.error?.message ?? 'Failed to submit batch for analysis',
        }));
      }
    } catch (err) {
      setWizard((s) => ({
        ...s,
        submitting: false,
        submitError: err instanceof Error ? err.message : 'Failed to submit batch for analysis',
      }));
    }
  }, [activeWorkspace, batchListQuery, openAnalysis, sessionListQuery, wizard.importResult]);

  // ---- Wizard step navigation ----
  const goToStep = useCallback((step: WizardStep) => {
    if (step === 'preflight') {
      void handleLoadPreflight();
    } else {
      setWizard((s) => ({ ...s, step }));
    }
  }, [handleLoadPreflight]);

  // ---- Render wizard content ----
  const renderWizardContent = () => {
    switch (wizard.step) {
      case 'upload':
        return (
          <>
            {wizard.importError && (
              <div className="preflight-warning-banner" style={{ marginBottom: 'var(--space-4)' }}>
                <IconAlertCircle size={14} />
                <span>{wizard.importError}</span>
              </div>
            )}
            {wizard.importing ? (
              <LoadingState message="Parsing file..." />
            ) : (
              <div
                className="upload-zone"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
              >
                <IconUpload size={32} className="upload-zone-icon" />
                <div className="upload-zone-title">Drop a CSV or HTML file here</div>
                <div className="upload-zone-hint">
                  or click to browse. Accepts Azure DevOps exports in CSV or HTML table format.
                </div>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.html,.htm"
              style={{ display: 'none' }}
              onChange={handleFileInputChange}
            />
          </>
        );

      case 'summary':
        if (!wizard.importResult) return null;
        return (
          <>
            <ParseSummaryGrid summary={wizard.importResult.summary} />
            <RowReviewTable title="Duplicate Rows" rows={wizard.importResult.duplicateRows} variant="warning" />
            <RowReviewTable title="Malformed Rows" rows={wizard.importResult.invalidRows} variant="danger" />
            <RowReviewTable title="Ignored Rows" rows={wizard.importResult.ignoredRows} variant="neutral" />
          </>
        );

      case 'scope':
        return (
          <>
            <ScopeModePicker
              mode={wizard.scopeMode}
              onModeChange={(m) => {
                setWizard((s) => ({ ...s, scopeMode: m, scopeResult: null }));
              }}
              scopedCount={wizard.scopeResult?.scopedCount ?? undefined}
            />
            {wizard.scopeMode !== PBIBatchScopeMode.ALL && wizard.importResult && (
              <div className="scope-section">
                <div className="scope-section-heading">
                  {wizard.scopeMode === PBIBatchScopeMode.SELECTED_ONLY ? 'Select rows to include' : 'Select rows to exclude'}
                </div>
                <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2)' }}>
                  {wizard.importResult.rows
                    .filter((r) => r.validationStatus === 'candidate' || r.state === 'candidate')
                    .map((row) => {
                      const selected = wizard.scopeSelectedRows.includes(row.sourceRowNumber);
                      return (
                        <label key={row.id ?? row.sourceRowNumber} className="scope-row-checkbox">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => {
                              setWizard((s) => ({
                                ...s,
                                scopeResult: null,
                                scopeSelectedRows: selected
                                  ? s.scopeSelectedRows.filter((n) => n !== row.sourceRowNumber)
                                  : [...s.scopeSelectedRows, row.sourceRowNumber],
                              }));
                            }}
                          />
                          <span style={{ fontFamily: 'var(--font-mono)', minWidth: 32 }}>#{row.sourceRowNumber}</span>
                          <span style={{ flex: 1 }}>{row.title || row.externalId}</span>
                        </label>
                      );
                    })}
                </div>
              </div>
            )}
          </>
        );

      case 'preflight':
        if (wizard.preflightLoading) return <LoadingState message="Running preflight checks..." />;
        if (wizard.preflightError) return <ErrorState title="Preflight failed" description={wizard.preflightError} />;
        if (!wizard.preflightData) return null;
        return (
          <>
            {wizard.submitError && (
              <div className="preflight-warning-banner" style={{ marginBottom: 'var(--space-4)' }}>
                <IconAlertCircle size={14} />
                <span>{wizard.submitError}</span>
              </div>
            )}
            <PreflightPanel
              batch={wizard.preflightData.batch}
              candidateCount={wizard.preflightData.candidateRows.length}
              invalidCount={wizard.preflightData.invalidRows.length}
              duplicateCount={wizard.preflightData.duplicateRows.length}
              ignoredCount={wizard.preflightData.ignoredRows.length}
              scopedCount={wizard.preflightData.scopePayload.scopedCount ?? 0}
              candidateTitles={wizard.preflightData.candidateTitles}
            />
          </>
        );

      default:
        return null;
    }
  };

  const renderWizardFooter = () => {
    const stepIndex = WIZARD_STEPS.indexOf(wizard.step);
    const isFirst = stepIndex === 0;
    const isLast = stepIndex === WIZARD_STEPS.length - 1;

    return (
      <div className="wizard-footer">
        <div className="wizard-footer-left">
          {!isFirst && wizard.step !== 'upload' && (
            <button className="btn btn-ghost" onClick={() => goToStep(WIZARD_STEPS[stepIndex - 1])}>
              Back
            </button>
          )}
        </div>
        <div className="wizard-footer-right">
          <button className="btn btn-ghost" onClick={closeWizard}>Cancel</button>
          {wizard.step === 'summary' && (
            <button className="btn btn-primary" onClick={() => goToStep('scope')}>
              Continue to Scoping
            </button>
          )}
          {wizard.step === 'scope' && (
            <>
              {!wizard.scopeResult && (
                <button
                  className="btn btn-secondary"
                  disabled={wizard.scopeSaving}
                  onClick={handleScopeSet}
                >
                  {wizard.scopeSaving ? 'Saving...' : 'Apply Scope'}
                </button>
              )}
              {wizard.scopeResult && (
                <button className="btn btn-primary" onClick={() => goToStep('preflight')}>
                  Continue to Preflight
                </button>
              )}
            </>
          )}
          {isLast && wizard.preflightData && (
            <button
              className="btn btn-primary"
              disabled={wizard.submitting || (wizard.preflightData.scopePayload.scopedCount ?? 0) === 0}
              onClick={handleSubmitBatch}
            >
              {wizard.submitting ? 'Submitting...' : 'Submit for Analysis'}
            </button>
          )}
        </div>
      </div>
    );
  };

  /* ---------- No workspace ---------- */
  if (!activeWorkspace) {
    return (
      <>
        <PageHeader title="PBI Batches" subtitle="No workspace selected" />
        <div className="route-content">
          <EmptyState
            icon={<IconUpload size={48} />}
            title="No workspace open"
            description="Open or create a workspace to import PBI batches."
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="PBI Batches"
        subtitle="Import and analyze bulk product backlog items"
        actions={
          <button className="btn btn-primary" onClick={openWizard}>
            <IconPlus size={14} />
            Import Batch
          </button>
        }
      />
      <div className="route-content">
        {batchListQuery.loading ? (
          <LoadingState message="Loading batches..." />
        ) : batchListQuery.error ? (
          <ErrorState
            title="Failed to load batches"
            description={batchListQuery.error}
            action={
              <button className="btn btn-primary" onClick={() => batchListQuery.execute({ workspaceId: activeWorkspace.id })}>
                Retry
              </button>
            }
          />
        ) : batches.length === 0 ? (
          <EmptyState
            icon={<IconUpload size={48} />}
            title="No batches imported"
            description="Upload a CSV or HTML export from Azure DevOps to start analyzing product backlog items against your KB articles."
            action={
              <button className="btn btn-primary" onClick={openWizard}>
                <IconPlus size={14} />
                Import CSV
              </button>
            }
          />
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Imported</th>
                  <th>Rows</th>
                  <th>Candidates</th>
                  <th>Scoped</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const displayStatus = getDisplayBatchStatus(b);
                  return (
                  <tr
                    key={b.id}
                    className="pbi-batch-table-row"
                    onClick={() => { void openAnalysisFromRow(b); }}
                    onKeyDown={(event) => handleRowKeyDown(event, b)}
                    role="button"
                    tabIndex={0}
                  >
                    <td style={{ fontWeight: 'var(--weight-medium)' }}>
                      <div>{b.name}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{b.sourceFileName}</div>
                    </td>
                    <td style={{ color: 'var(--color-text-secondary)' }}>{formatDate(b.importedAtUtc)}</td>
                    <td>{b.sourceRowCount}</td>
                    <td>{b.candidateRowCount}</td>
                    <td>{b.scopedRowCount}</td>
                    <td>
                      <Badge variant={batchStatusVariant(displayStatus)}>
                        {STATUS_LABEL[displayStatus] ?? displayStatus}
                      </Badge>
                    </td>
                    <td className="pbi-batch-table-actions-cell">
              {canRunAnalysis(b) && (
                <button
                  className="btn btn-primary btn-xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleAnalyzeAction(b);
                  }}
                  title="Run AI analysis"
                  aria-label={`Run analysis on ${b.name}`}
                >
                          <IconPlay size={10} />
                          Analyze
                        </button>
                      )}
                      <button
                        className="btn btn-ghost btn-icon pbi-batch-row-delete-btn"
                        disabled={deletingBatchId === b.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          openDeleteDialog(b);
                        }}
                        title="Delete batch"
                        aria-label={`Delete batch ${b.name}`}
                      >
                        <IconX size={14} />
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Import Wizard Overlay */}
      {wizard.open && (
        <div className="wizard-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeWizard(); }}>
          <div className="wizard-panel">
            <div className="wizard-header">
              <h2 className="wizard-title">Import PBI Batch</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                <StepIndicator steps={WIZARD_STEPS} current={wizard.step} />
                <button className="btn btn-ghost btn-icon" onClick={closeWizard} aria-label="Close">
                  <IconX size={16} />
                </button>
              </div>
            </div>
            <div className="wizard-body">
              {renderWizardContent()}
            </div>
            {wizard.step !== 'upload' && renderWizardFooter()}
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={Boolean(batchToDelete)}
        title="Delete PBI batch"
        message={
          <>
            <p>Delete <strong>{batchToDelete?.name}</strong> from this workspace?</p>
            <p>This will permanently remove the batch and all its uploaded rows. This action cannot be undone.</p>
            {deleteBatchError && <p className="confirmation-dialog__error">{deleteBatchError}</p>}
          </>
        }
        confirmText={deletingBatchId ? 'Deleting...' : 'Delete batch'}
        isProcessing={Boolean(deletingBatchId)}
        onClose={closeDeleteDialog}
        onConfirm={handleDeleteBatch}
      />

      {/* Analysis runner drawer */}
      <Drawer
        open={Boolean(analysisBatch)}
        onClose={() => {
          setAnalysisBatch(null);
          setAnalysisAutoRun(false);
          if (activeWorkspace) batchListQuery.execute({ workspaceId: activeWorkspace.id });
          if (activeWorkspace) sessionListQuery.execute({ workspaceId: activeWorkspace.id, includeClosed: true });
        }}
        title={`AI Analysis — ${analysisBatch?.name ?? ''}`}
        variant="wide"
      >
        {analysisBatch && activeWorkspace && (
          <AnalysisJobRunner
            workspaceId={activeWorkspace.id}
            batchId={analysisBatch.id}
            startOnOpen={analysisAutoRun}
            onComplete={() => {
              if (activeWorkspace) batchListQuery.execute({ workspaceId: activeWorkspace.id });
              if (activeWorkspace) sessionListQuery.execute({ workspaceId: activeWorkspace.id, includeClosed: true });
            }}
          />
        )}
      </Drawer>
      </>
  );
};
