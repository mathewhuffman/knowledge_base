import { useEffect, useState, useCallback, useRef } from 'react';
import {
  DraftBranchStatus,
  DraftValidationSeverity,
  DraftCommitSource,
  AppRoute,
  ArticleAiPresetAction,
  buildAppWorkingStateVersionToken,
  type DraftBranchGetResponse,
  type DraftBranchListResponse,
  type DraftBranchSummary,
  type DraftValidationWarning,
  type DraftBranchHistoryEntry,
  type ArticleAiSessionResponse,
  type TemplatePackSummary,
} from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import {
  IconGitBranch,
  IconAlertCircle,
  IconCheckCircle,
  IconEye,
  IconCode,
  IconColumns,
  IconCornerUpLeft,
  IconCornerUpRight,
  IconSave,
  IconSend,
  IconTrash2,
  IconFilter,
  IconClock,
  IconZap,
  IconRefreshCw,
  IconMapPin,
} from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc, useIpcMutation } from '../hooks/useIpc';
import { useRegisterAiAssistantView } from '../components/assistant/AssistantContext';
import { PlacementSummary } from '../components/article/PlacementSummary';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EditorTab = 'source' | 'preview' | 'compare';
type BranchFilter = 'all' | 'active' | 'ready' | 'conflicted';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusTone(status: DraftBranchStatus): 'success' | 'warning' | 'danger' | 'primary' | 'neutral' {
  switch (status) {
    case DraftBranchStatus.READY_TO_PUBLISH: return 'success';
    case DraftBranchStatus.CONFLICTED: return 'danger';
    case DraftBranchStatus.OBSOLETE:
    case DraftBranchStatus.DISCARDED: return 'warning';
    case DraftBranchStatus.PUBLISHED: return 'neutral';
    default: return 'primary';
  }
}

function statusChipProps(status: DraftBranchStatus): { status: 'live' | 'draft' | 'conflicted' | 'retired' | 'pending' | 'active'; label: string } {
  switch (status) {
    case DraftBranchStatus.CONFLICTED: return { status: 'conflicted', label: 'Conflicted' };
    case DraftBranchStatus.OBSOLETE: return { status: 'pending', label: 'Obsolete' };
    case DraftBranchStatus.DISCARDED: return { status: 'retired', label: 'Discarded' };
    case DraftBranchStatus.READY_TO_PUBLISH: return { status: 'active', label: 'Ready' };
    case DraftBranchStatus.PUBLISHED: return { status: 'live', label: 'Published' };
    case DraftBranchStatus.ACTIVE:
    default: return { status: 'draft', label: 'Active' };
  }
}

function validationIcon(w: DraftValidationWarning) {
  const color = w.severity === DraftValidationSeverity.ERROR
    ? 'var(--color-danger)'
    : w.severity === DraftValidationSeverity.WARNING
      ? 'var(--color-warning)'
      : 'var(--color-info)';
  return <IconAlertCircle size={12} style={{ color }} />;
}

function commitSourceLabel(source: DraftCommitSource): string {
  switch (source) {
    case DraftCommitSource.PROPOSAL: return 'proposal';
    case DraftCommitSource.MANUAL: return 'manual';
    case DraftCommitSource.AUTOSAVE: return 'autosave';
    case DraftCommitSource.SYSTEM: return 'system';
    default: return source;
  }
}

function commitSourceVariant(source: DraftCommitSource): 'neutral' | 'primary' | 'success' | 'warning' {
  switch (source) {
    case DraftCommitSource.PROPOSAL: return 'primary';
    case DraftCommitSource.MANUAL: return 'success';
    case DraftCommitSource.AUTOSAVE: return 'warning';
    default: return 'neutral';
  }
}

function validationSummaryClass(branch: DraftBranchSummary): string {
  if (branch.validationSummary.errors > 0) return 'has-errors';
  if (branch.validationSummary.warnings > 0) return 'has-warnings';
  return 'clean';
}

function validationSummaryText(branch: DraftBranchSummary): string {
  const { errors, warnings, infos } = branch.validationSummary;
  if (errors + warnings + infos === 0) return 'Clean';
  const parts: string[] = [];
  if (errors) parts.push(`${errors}E`);
  if (warnings) parts.push(`${warnings}W`);
  if (infos) parts.push(`${infos}I`);
  return parts.join('/');
}

function filterBranches(branches: DraftBranchSummary[], filter: BranchFilter): DraftBranchSummary[] {
  switch (filter) {
    case 'active': return branches.filter(b => b.status === DraftBranchStatus.ACTIVE);
    case 'ready': return branches.filter(b => b.status === DraftBranchStatus.READY_TO_PUBLISH);
    case 'conflicted': return branches.filter(b => b.status === DraftBranchStatus.CONFLICTED);
    default: return branches;
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function presetLabel(action: ArticleAiPresetAction): string {
  switch (action) {
    case ArticleAiPresetAction.REWRITE_TONE: return 'Tone';
    case ArticleAiPresetAction.SHORTEN: return 'Shorten';
    case ArticleAiPresetAction.EXPAND: return 'Expand';
    case ArticleAiPresetAction.RESTRUCTURE: return 'Restructure';
    case ArticleAiPresetAction.CONVERT_TO_TROUBLESHOOTING: return 'Troubleshoot';
    case ArticleAiPresetAction.ALIGN_TO_TEMPLATE: return 'Template';
    case ArticleAiPresetAction.UPDATE_LOCALE: return 'Locale';
    case ArticleAiPresetAction.INSERT_IMAGE_PLACEHOLDERS: return 'Images';
    default: return 'Custom';
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BranchRail({
  branches,
  summary,
  filter,
  selectedId,
  onSelectBranch,
  onFilterChange,
}: {
  branches: DraftBranchSummary[];
  summary: { active: number; conflicted: number; readyToPublish: number; total: number };
  filter: BranchFilter;
  selectedId: string | null;
  onSelectBranch: (id: string) => void;
  onFilterChange: (f: BranchFilter) => void;
}) {
  const filtered = filterBranches(branches, filter);

  return (
    <div className="draft-rail">
      <div className="draft-rail-header">
        <div>
          <div className="draft-rail-title">Branches</div>
          <div className="draft-rail-meta">
            {summary.active} active{summary.conflicted > 0 ? `, ${summary.conflicted} conflicted` : ''}
          </div>
        </div>
        <Badge variant="neutral">{summary.total}</Badge>
      </div>

      <div className="draft-rail-filter">
        {(['all', 'active', 'ready', 'conflicted'] as BranchFilter[]).map(f => (
          <button
            key={f}
            type="button"
            className={`draft-rail-filter-btn${filter === f ? ' active' : ''}`}
            onClick={() => onFilterChange(f)}
          >
            {f === 'all' ? 'All' : f === 'active' ? 'Active' : f === 'ready' ? 'Ready' : 'Conflict'}
          </button>
        ))}
      </div>

      <div className="draft-rail-list">
        {filtered.length === 0 ? (
          <div style={{ padding: 'var(--space-5)' }}>
            <EmptyState
              icon={<IconFilter size={32} />}
              title={filter === 'all' ? 'No draft branches' : `No ${filter} branches`}
              description={filter === 'all'
                ? 'Accept a proposal or create a branch from an article to start editing.'
                : 'Try a different filter to find branches.'}
            />
          </div>
        ) : (
          filtered.map(branch => (
            <button
              key={branch.id}
              type="button"
              className={`draft-rail-item${branch.id === selectedId ? ' selected' : ''}`}
              onClick={() => onSelectBranch(branch.id)}
            >
              <div className="draft-rail-item-title">{branch.familyTitle}</div>
              <div className="draft-rail-item-branch">{branch.name}</div>
              <div className="draft-rail-item-footer">
                <StatusChip {...statusChipProps(branch.status)} />
                <div className="draft-rail-item-rev">r{branch.headRevisionNumber}</div>
                <div className={`draft-rail-item-validation ${validationSummaryClass(branch)}`}>
                  {branch.validationSummary.errors > 0
                    ? <IconAlertCircle size={11} />
                    : <IconCheckCircle size={11} />}
                  {validationSummaryText(branch)}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function ValidationPanel({ warnings }: { warnings: DraftValidationWarning[] }) {
  if (warnings.length === 0) {
    return (
      <div className="draft-validation-ok">
        <IconCheckCircle size={14} />
        No validation issues
      </div>
    );
  }

  return (
    <>
      {warnings.map((w, i) => (
        <div key={`${w.code}-${i}`} className="draft-validation-item">
          <div className="draft-validation-item-header">
            {validationIcon(w)}
            <span className="draft-validation-item-code">{w.code.replace(/_/g, ' ')}</span>
            <Badge variant={w.severity === 'error' ? 'danger' : w.severity === 'warning' ? 'warning' : 'primary'}>
              {w.severity}
            </Badge>
          </div>
          <div className="draft-validation-item-msg">{w.message}</div>
          {w.line != null && (
            <div className="draft-validation-item-line">line {w.line}</div>
          )}
        </div>
      ))}
    </>
  );
}

function HistoryPanel({ entries }: { entries: DraftBranchHistoryEntry[] }) {
  if (entries.length === 0) {
    return <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>No revision history.</div>;
  }

  return (
    <>
      {entries.map(entry => (
        <div key={entry.revisionId} className={`draft-history-item${entry.isCurrent ? ' current' : ''}`}>
          <span className="draft-history-rev">r{entry.revisionNumber}</span>
          <div className="draft-history-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginBottom: '1px' }}>
              <Badge variant={commitSourceVariant(entry.source)}>{commitSourceLabel(entry.source)}</Badge>
              {entry.isCurrent && <Badge variant="primary">current</Badge>}
            </div>
            <div className="draft-history-summary">{entry.summary || 'No commit note'}</div>
            <div className="draft-history-time">{relativeTime(entry.updatedAtUtc)}</div>
          </div>
        </div>
      ))}
    </>
  );
}

function ChangeRegionsPanel({ regions }: { regions: Array<{ label: string; kind: string }> }) {
  if (regions.length === 0) {
    return <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Identical to live revision.</div>;
  }

  return (
    <>
      {regions.map((region, i) => (
        <div key={i} className="draft-region-item">
          <span className={`draft-region-kind ${region.kind === 'added' ? 'added' : region.kind === 'removed' ? 'removed' : 'changed'}`} />
          <span className="draft-region-label">{region.label}</span>
        </div>
      ))}
    </>
  );
}

function ArticleAiPanel({
  session,
  prompt,
  onPromptChange,
  selectedTemplateId,
  onTemplateChange,
  onPreset,
  onSubmit,
  onReset,
  onAccept,
  onReject,
  loading,
  templates,
}: {
  session: ArticleAiSessionResponse | null;
  prompt: string;
  onPromptChange: (value: string) => void;
  selectedTemplateId: string;
  onTemplateChange: (value: string) => void;
  onPreset: (preset: ArticleAiPresetAction) => void;
  onSubmit: () => void;
  onReset: () => void;
  onAccept: () => void;
  onReject: () => void;
  loading: boolean;
  templates: TemplatePackSummary[];
}) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const isRunning = session?.session.status === 'running';
  const hasPending = !!session?.pendingEdit;

  // Auto-scroll transcript to bottom when messages change
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [session?.messages.length]);

  return (
    <div className="draft-sidebar-section">
      <div className="draft-sidebar-section-title">
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <IconZap size={12} /> Article AI
        </span>
        {session && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onReset}
            disabled={loading}
            title="Clear chat history and start fresh"
          >
            <IconRefreshCw size={12} /> Reset
          </button>
        )}
      </div>

      {!session ? (
        <div className="article-ai-empty-hint">
          Select a draft branch to open an AI chat session. Chat history persists until you reset it.
        </div>
      ) : (
        <div className="article-ai-panel">
          {/* Pending AI edit card — shown prominently at top when present */}
          {hasPending && (
            <div className="article-ai-pending">
              <div className="article-ai-pending-header">
                <IconZap size={12} style={{ color: 'var(--color-primary)' }} />
                <span className="article-ai-pending-label">Pending AI edit</span>
              </div>
              <div className="article-ai-pending-summary">
                {session.pendingEdit!.summary}
              </div>
              {session.pendingEdit!.rationale && (
                <div className="article-ai-pending-diff-hint">
                  {session.pendingEdit!.rationale}
                </div>
              )}
              <div className="article-ai-pending-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={onAccept}
                  disabled={loading}
                >
                  <IconCheckCircle size={12} /> Accept into draft
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={onReject}
                  disabled={loading}
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          {/* Running indicator */}
          {isRunning && (
            <div className="article-ai-running">
              <span className="article-ai-running-dot" />
              AI is processing your request...
            </div>
          )}

          {/* Chat transcript */}
          <div className="article-ai-transcript" ref={transcriptRef}>
            {session.messages.length === 0 ? (
              <div className="article-ai-empty-hint">
                Use a quick action or type a request below. Chat history stays with this article until you reset it.
              </div>
            ) : (
              session.messages.map((message) => (
                <div key={message.id} className={`article-ai-msg ${message.role}`}>
                  <div className="article-ai-msg-header">
                    <span className={`article-ai-msg-role ${message.role}`}>
                      {message.role === 'assistant' ? 'AI' : message.role}
                    </span>
                    <span className="article-ai-msg-time">
                      {relativeTime(message.createdAtUtc)}
                    </span>
                  </div>
                  {message.presetAction && message.presetAction !== ArticleAiPresetAction.FREEFORM && (
                    <div style={{ marginBottom: 4 }}>
                      <Badge variant="primary">
                        {presetLabel(message.presetAction)}
                      </Badge>
                    </div>
                  )}
                  <div>{message.content}</div>
                </div>
              ))
            )}
          </div>

          {/* Quick action presets */}
          <div className="article-ai-presets">
            {session.presets.map((preset) => (
              <button
                key={preset.action}
                type="button"
                className="article-ai-preset-chip"
                onClick={() => onPreset(preset.action)}
                disabled={loading || hasPending}
                title={preset.description}
              >
                {presetLabel(preset.action)}
              </button>
            ))}
          </div>

          {/* Template selector */}
          <div className="article-ai-template-row">
            <select
              className="input article-ai-template-select"
              value={selectedTemplateId}
              onChange={(e) => onTemplateChange(e.target.value)}
              disabled={loading}
            >
              <option value="">No template (use article context)</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template.language})
                </option>
              ))}
            </select>
          </div>

          {/* Compose input */}
          <div className="article-ai-compose">
            <div className="article-ai-compose-row">
              <textarea
                className="article-ai-textarea"
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                placeholder="Describe the change you want..."
                disabled={loading || hasPending}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && prompt.trim()) {
                    e.preventDefault();
                    onSubmit();
                  }
                }}
              />
              <button
                type="button"
                className="article-ai-send-btn"
                onClick={onSubmit}
                disabled={loading || !prompt.trim() || hasPending}
                title="Submit (Cmd+Enter)"
              >
                <IconSend size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const Drafts = () => {
  const { activeWorkspace } = useWorkspace();

  // Branch state
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState<BranchFilter>('all');

  // Editor state
  const [draftHtml, setDraftHtml] = useState('');
  const [originalHtml, setOriginalHtml] = useState('');
  const [tab, setTab] = useState<EditorTab>('source');
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const hasUnsavedChanges = draftHtml !== originalHtml;

  // IPC
  const listQuery = useIpc<DraftBranchListResponse>('draft.branch.list');
  const detailQuery = useIpc<DraftBranchGetResponse>('draft.branch.get');
  const saveMutation = useIpcMutation<DraftBranchGetResponse>('draft.branch.save');
  const undoMutation = useIpcMutation<DraftBranchGetResponse>('draft.branch.undo');
  const redoMutation = useIpcMutation<DraftBranchGetResponse>('draft.branch.redo');
  const statusMutation = useIpcMutation<DraftBranchGetResponse>('draft.branch.status.set');
  const discardMutation = useIpcMutation<DraftBranchGetResponse>('draft.branch.discard');
  const { execute: executeList } = listQuery;
  const { execute: executeDetail, reset: resetDetail } = detailQuery;

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!activeWorkspace) return;
    void executeList({ workspaceId: activeWorkspace.id });
  }, [activeWorkspace, executeList]);

  useEffect(() => {
    if (!listQuery.data) {
      return;
    }
    const branches = listQuery.data?.branches ?? [];
    if (branches.length === 0) {
      if (selectedBranchId !== null) {
        setSelectedBranchId(null);
      }
      return;
    }
    const currentStillExists = selectedBranchId
      ? branches.some((branch) => branch.id === selectedBranchId)
      : false;
    if (!currentStillExists) {
      setSelectedBranchId(branches[0].id);
    }
  }, [listQuery.data, selectedBranchId]);

  useEffect(() => {
    if (!activeWorkspace || !selectedBranchId) {
      resetDetail();
      return;
    }
    void executeDetail({ workspaceId: activeWorkspace.id, branchId: selectedBranchId });
  }, [activeWorkspace, selectedBranchId, executeDetail, resetDetail]);

  useEffect(() => {
    if (detailQuery.data) {
      setDraftHtml(detailQuery.data.editor.html);
      setOriginalHtml(detailQuery.data.editor.html);
    }
  }, [detailQuery.data]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const refresh = useCallback(async (branchId?: string) => {
    if (!activeWorkspace) return;
    const nextList = await executeList({ workspaceId: activeWorkspace.id });
    const availableBranches = nextList?.branches ?? [];
    const preferredBranchId = branchId ?? selectedBranchId;
    const resolvedBranchId = preferredBranchId && availableBranches.some((branch) => branch.id === preferredBranchId)
      ? preferredBranchId
      : (availableBranches[0]?.id ?? null);

    setSelectedBranchId(resolvedBranchId);

    if (!resolvedBranchId) {
      resetDetail();
      setDraftHtml('');
      setOriginalHtml('');
      return;
    }

    const detail = await executeDetail({ workspaceId: activeWorkspace.id, branchId: resolvedBranchId });
    if (detail) {
      setDraftHtml(detail.editor.html);
      setOriginalHtml(detail.editor.html);
    }
  }, [activeWorkspace, selectedBranchId, executeDetail, executeList, resetDetail]);

  const saveDraft = useCallback(async (autosave = false) => {
    if (!activeWorkspace || !selectedBranchId || !detailQuery.data) return;
    const saved = await saveMutation.mutate({
      workspaceId: activeWorkspace.id,
      branchId: selectedBranchId,
      html: draftHtml,
      autosave,
      expectedHeadRevisionId: detailQuery.data.branch.headRevisionId,
      editorState: { activeTab: tab },
    });
    if (saved) {
      setDraftHtml(saved.editor.html);
      setOriginalHtml(saved.editor.html);
      await refresh(selectedBranchId);
    }
  }, [activeWorkspace, selectedBranchId, detailQuery.data, draftHtml, tab, refresh]);

  const applyDetail = useCallback(async (result: DraftBranchGetResponse | null) => {
    if (!result) return;
    setSelectedBranchId(result.branch.id);
    setDraftHtml(result.editor.html);
    setOriginalHtml(result.editor.html);
    await refresh(result.branch.id);
  }, [refresh]);

  const handleUndo = useCallback(async () => {
    if (!activeWorkspace || !selectedBranchId) return;
    const result = await undoMutation.mutate({ workspaceId: activeWorkspace.id, branchId: selectedBranchId });
    await applyDetail(result);
  }, [activeWorkspace, selectedBranchId, applyDetail]);

  const handleRedo = useCallback(async () => {
    if (!activeWorkspace || !selectedBranchId) return;
    const result = await redoMutation.mutate({ workspaceId: activeWorkspace.id, branchId: selectedBranchId });
    await applyDetail(result);
  }, [activeWorkspace, selectedBranchId, applyDetail]);

  const handleMarkReady = useCallback(async () => {
    if (!activeWorkspace || !selectedBranchId) return;
    const result = await statusMutation.mutate({
      workspaceId: activeWorkspace.id,
      branchId: selectedBranchId,
      status: DraftBranchStatus.READY_TO_PUBLISH,
    });
    await applyDetail(result);
  }, [activeWorkspace, selectedBranchId, applyDetail]);

  const handleDiscard = useCallback(async () => {
    if (!activeWorkspace || !selectedBranchId) return;
    const result = await discardMutation.mutate({ workspaceId: activeWorkspace.id, branchId: selectedBranchId });
    setShowDiscardDialog(false);
    if (result) {
      await applyDetail(result);
    }
  }, [activeWorkspace, selectedBranchId, applyDetail]);

  const handleRevertToActive = useCallback(async () => {
    if (!activeWorkspace || !selectedBranchId) return;
    const result = await statusMutation.mutate({
      workspaceId: activeWorkspace.id,
      branchId: selectedBranchId,
      status: DraftBranchStatus.ACTIVE,
    });
    await applyDetail(result);
  }, [activeWorkspace, selectedBranchId, applyDetail]);

  // ---------------------------------------------------------------------------
  // Autosave on idle (debounced)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const timer = setTimeout(() => {
      void saveDraft(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, [draftHtml, hasUnsavedChanges]);

  const branches = listQuery.data?.branches ?? [];
  const summary = listQuery.data?.summary ?? { total: 0, active: 0, readyToPublish: 0, conflicted: 0, obsolete: 0, discarded: 0 };
  const selected = detailQuery.data;
  const branchStatus = selected?.branch.status;
  const isEditable = branchStatus === DraftBranchStatus.ACTIVE || branchStatus === DraftBranchStatus.READY_TO_PUBLISH;

  useRegisterAiAssistantView({
    enabled: Boolean(activeWorkspace && selected),
    context: {
      workspaceId: activeWorkspace?.id ?? '',
      route: AppRoute.DRAFTS,
      routeLabel: 'Drafts',
      subject: {
        type: 'draft_branch',
        id: selected?.branch.id ?? 'draft-branch',
        title: selected?.branch.name,
        locale: selected?.branch.locale
      },
      workingState: {
        kind: 'article_html',
        versionToken: selected
          ? buildAppWorkingStateVersionToken({
              route: AppRoute.DRAFTS,
              entityType: 'draft_branch',
              entityId: selected.branch.id,
              currentValues: {
                html: draftHtml
              }
            })
          : `draft:${selectedBranchId ?? 'unknown'}`,
        payload: { html: draftHtml }
      },
      capabilities: {
        canChat: true,
        canCreateProposal: false,
        canPatchProposal: false,
        canPatchDraft: true,
        canPatchTemplate: false,
        canUseUnsavedWorkingState: true
      },
      backingData: {
        branchId: selected?.branch.id,
        localeVariantId: selected?.branch.localeVariantId,
        locale: selected?.branch.locale,
        sourceHtml: originalHtml
      }
    },
    applyWorkingStatePatch: (patch) => {
      if (typeof patch.html === 'string') {
        setDraftHtml(patch.html);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Render: guards
  // ---------------------------------------------------------------------------

  if (!activeWorkspace) {
    return (
      <>
        <PageHeader title="Drafts" subtitle="Open a workspace to manage draft branches." />
        <div className="route-content">
          <EmptyState
            icon={<IconGitBranch size={48} />}
            title="No workspace selected"
            description="Choose a workspace to load draft branches and editing history."
          />
        </div>
      </>
    );
  }

  if (listQuery.loading && !listQuery.data) {
    return (
      <>
        <PageHeader title="Drafts" subtitle="Loading draft branches" />
        <div className="route-content">
          <LoadingState message="Pulling branch metadata, validation state, and editor context." />
        </div>
      </>
    );
  }

  if (listQuery.error && !listQuery.data) {
    return (
      <>
        <PageHeader title="Drafts" subtitle="Draft branch loading failed" />
        <div className="route-content">
          <ErrorState title="Unable to load drafts" description={listQuery.error} />
        </div>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: main
  // ---------------------------------------------------------------------------

  return (
    <>
      <PageHeader
        title="Drafts"
        subtitle={`${summary.total} branch${summary.total !== 1 ? 'es' : ''} in ${activeWorkspace.name}`}
      />

      <div className="draft-layout" style={{ flex: 1, overflow: 'hidden' }}>
        {/* ---- Branch rail ---- */}
        <BranchRail
          branches={branches}
          summary={summary}
          filter={branchFilter}
          selectedId={selectedBranchId}
          onSelectBranch={setSelectedBranchId}
          onFilterChange={setBranchFilter}
        />

        {/* ---- Editor panel ---- */}
        <div className="draft-editor-panel">
          {!selectedBranchId ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState
                icon={<IconGitBranch size={40} />}
                title="Select a branch"
                description="Choose a draft branch from the left to start editing."
              />
            </div>
          ) : detailQuery.loading && !selected ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <LoadingState message="Loading editor state..." />
            </div>
          ) : detailQuery.error && !selected ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ErrorState title="Unable to load branch" description={detailQuery.error} />
            </div>
          ) : selected ? (
            <>
              {/* Branch status banners */}
              {branchStatus === DraftBranchStatus.CONFLICTED && (
                <div className="draft-branch-banner danger">
                  <IconAlertCircle size={16} />
                  <span className="draft-branch-banner-text">
                    This branch has conflicts with the live revision. Resolve conflicts before publishing.
                  </span>
                </div>
              )}
              {branchStatus === DraftBranchStatus.OBSOLETE && (
                <div className="draft-branch-banner warning">
                  <IconAlertCircle size={16} />
                  <span className="draft-branch-banner-text">
                    This branch is obsolete. A newer branch has been published for this article.
                  </span>
                  <button className="btn btn-sm btn-secondary" onClick={() => void handleRevertToActive()}>
                    Reactivate
                  </button>
                </div>
              )}
              {branchStatus === DraftBranchStatus.DISCARDED && (
                <div className="draft-branch-banner warning">
                  <IconAlertCircle size={16} />
                  <span className="draft-branch-banner-text">
                    This branch has been discarded. Reactivate to continue editing.
                  </span>
                  <button className="btn btn-sm btn-secondary" onClick={() => void handleRevertToActive()}>
                    Reactivate
                  </button>
                </div>
              )}

              {/* Header */}
              <div className="draft-editor-header">
                <div className="draft-editor-header-row">
                  <div>
                    <div className="draft-editor-title">
                      {selected.branch.familyTitle}
                      {hasUnsavedChanges && <span className="draft-unsaved-dot" title="Unsaved changes" />}
                      <StatusChip {...statusChipProps(selected.branch.status)} />
                    </div>
                    <div className="draft-editor-breadcrumb">
                      <span>{selected.branch.name}</span>
                      <span className="draft-editor-breadcrumb-sep">/</span>
                      <span>base r{selected.branch.baseRevisionNumber ?? '—'}</span>
                      <span className="draft-editor-breadcrumb-sep">/</span>
                      <span>head r{selected.branch.headRevisionNumber}</span>
                      {selected.branch.locale && (
                        <>
                          <span className="draft-editor-breadcrumb-sep">/</span>
                          <Badge variant={statusTone(selected.branch.status)}>{selected.branch.locale}</Badge>
                        </>
                      )}
                    </div>
                    {selected.branch.changeSummary && (
                      <div className="draft-editor-change-summary">{selected.branch.changeSummary}</div>
                    )}
                  </div>
                  <div className="draft-editor-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => void handleUndo()} disabled={!isEditable} title="Undo (Cmd+Z)">
                      <IconCornerUpLeft size={14} /> Undo
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => void handleRedo()} disabled={!isEditable} title="Redo (Cmd+Shift+Z)">
                      <IconCornerUpRight size={14} /> Redo
                    </button>
                    <div style={{ width: '1px', height: '20px', background: 'var(--color-border)' }} />
                    {branchStatus === DraftBranchStatus.ACTIVE && (
                      <button className="btn btn-secondary btn-sm" onClick={() => void handleMarkReady()}>
                        <IconCheckCircle size={14} /> Mark Ready
                      </button>
                    )}
                    {branchStatus === DraftBranchStatus.READY_TO_PUBLISH && (
                      <button className="btn btn-secondary btn-sm" onClick={() => void handleRevertToActive()}>
                        Back to Active
                      </button>
                    )}
                    {isEditable && (
                      <button className="btn btn-danger btn-sm" onClick={() => setShowDiscardDialog(true)}>
                        <IconTrash2 size={14} /> Discard
                      </button>
                    )}
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void saveDraft(false)}
                      disabled={!isEditable || !hasUnsavedChanges}
                      title="Save (Cmd+S)"
                    >
                      <IconSave size={14} /> Save
                    </button>
                  </div>
                </div>
              </div>

              {/* Toolbar */}
              <div className="draft-toolbar">
                <div className="draft-toolbar-tabs">
                  <button
                    type="button"
                    className={`draft-toolbar-tab${tab === 'source' ? ' active' : ''}`}
                    onClick={() => setTab('source')}
                  >
                    <IconCode size={13} /> Source
                  </button>
                  <button
                    type="button"
                    className={`draft-toolbar-tab${tab === 'preview' ? ' active' : ''}`}
                    onClick={() => setTab('preview')}
                  >
                    <IconEye size={13} /> Preview
                  </button>
                  <button
                    type="button"
                    className={`draft-toolbar-tab${tab === 'compare' ? ' active' : ''}`}
                    onClick={() => setTab('compare')}
                  >
                    <IconColumns size={13} /> Compare
                  </button>
                </div>
                <div className="draft-toolbar-meta">
                  <span>
                    <span
                      className={`draft-toolbar-autosave-dot ${selected.editor.autosave.pendingChanges || hasUnsavedChanges ? 'pending' : 'saved'}`}
                    />
                    {selected.editor.autosave.enabled ? 'Autosave on' : 'Autosave off'}
                  </span>
                  {selected.editor.autosave.lastManualSaveAtUtc && (
                    <span>Saved {relativeTime(selected.editor.autosave.lastManualSaveAtUtc)}</span>
                  )}
                </div>
              </div>

              {/* Editor body */}
              <div className={`draft-editor-body${tab === 'compare' ? ' no-sidebar' : ''}`}>
                {/* Main content area */}
                {tab === 'source' && (
                  <textarea
                    ref={editorRef}
                    className="draft-source-editor"
                    value={draftHtml}
                    onChange={e => setDraftHtml(e.target.value)}
                    spellCheck={false}
                    readOnly={!isEditable}
                    placeholder={isEditable ? 'Start writing HTML...' : 'This branch is read-only.'}
                  />
                )}

                {tab === 'preview' && (
                  <div
                    className="draft-preview-pane"
                    dangerouslySetInnerHTML={{ __html: selected.editor.previewHtml || draftHtml }}
                  />
                )}

                {tab === 'compare' && (
                  <div className="draft-compare-container">
                    <div>
                      <div className="draft-compare-label">Live Revision</div>
                      <div className="draft-compare-pane draft-compare-pane-live">
                        {selected.editor.compare.liveHtml || <span style={{ color: 'var(--color-text-muted)' }}>No live content</span>}
                      </div>
                    </div>
                    <div>
                      <div className="draft-compare-label">Draft (head r{selected.branch.headRevisionNumber})</div>
                      <div className="draft-compare-pane draft-compare-pane-draft">
                        {selected.editor.compare.draftHtml || draftHtml}
                      </div>
                    </div>
                  </div>
                )}

                {/* Right sidebar (not shown in compare mode) */}
                {tab !== 'compare' && (
                  <div className="draft-sidebar">
                    <div className="draft-sidebar-section">
                      <div className="draft-sidebar-section-title">
                        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                          <IconMapPin size={12} /> Article Location
                        </span>
                      </div>
                      <PlacementSummary
                        current={selected.branch.placement}
                        emptyMessage="This draft target does not have placement metadata yet."
                      />
                    </div>

                    {/* Validation */}
                    <div className="draft-sidebar-section">
                      <div className="draft-sidebar-section-title">
                        Validation
                        {selected.editor.validationWarnings.length > 0 && (
                          <span className="draft-sidebar-section-count">{selected.editor.validationWarnings.length}</span>
                        )}
                      </div>
                      <ValidationPanel warnings={selected.editor.validationWarnings} />
                    </div>

                    {/* Change Regions */}
                    <div className="draft-sidebar-section">
                      <div className="draft-sidebar-section-title">
                        Changes vs Live
                        {selected.editor.compare.diff.changeRegions.length > 0 && (
                          <span className="draft-sidebar-section-count">
                            {selected.editor.compare.diff.changeRegions.length}
                          </span>
                        )}
                      </div>
                      <ChangeRegionsPanel regions={selected.editor.compare.diff.changeRegions} />
                    </div>

                    {/* History */}
                    <div className="draft-sidebar-section">
                      <div className="draft-sidebar-section-title">
                        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                          <IconClock size={12} /> History
                        </span>
                        {selected.editor.history.length > 0 && (
                          <span className="draft-sidebar-section-count">{selected.editor.history.length}</span>
                        )}
                      </div>
                      <HistoryPanel entries={selected.editor.history} />
                    </div>

                  </div>
                )}
              </div>

            </>
          ) : null}
        </div>
      </div>

      {/* Discard confirmation */}
      <ConfirmationDialog
        open={showDiscardDialog}
        title="Discard Branch"
        message={
          <>
            <p>Are you sure you want to discard <strong>{selected?.branch.name}</strong>?</p>
            <p>The branch will be marked as discarded but can be reactivated later.</p>
          </>
        }
        confirmText="Discard Branch"
        variant="danger"
        isProcessing={discardMutation.loading}
        onClose={() => setShowDiscardDialog(false)}
        onConfirm={handleDiscard}
      />
    </>
  );
};
