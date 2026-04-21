import { useState, useEffect, useCallback, useRef, useMemo, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  AppRoute,
  buildAppWorkingStateVersionToken,
  type PBIBatchDeleteRequest,
  ProposalReviewStatus,
  ProposalReviewDecision,
  type ProposalReviewBatchListResponse,
  type ProposalReviewBatchSummary,
  type ProposalReviewListResponse,
  type ProposalReviewDetailResponse,
  type ProposalReviewDecisionResponse,
  type ProposalReviewQueueItem,
  type ProposalReviewSummaryCounts,
  type ProposalSourceLineChange,
  type ProposalChangeRegion,
  type ProposalPlacementSuggestion,
  type PBIRecord,
  ProposalAction,
} from '@kb-vault/shared-types';
import * as diffEngine from '@kb-vault/diff-engine';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { Badge } from '../components/Badge';
import { Modal } from '../components/Modal';
import {
  IconCheckCircle,
  IconChevronLeft,
  IconChevronRight,
  IconArchive,
  IconMapPin,
  IconGitBranch,
  IconEye,
  IconCode,
  IconFileText,
  IconTrash2,
  IconPanelRight,
  IconPanelLeft,
} from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc, useIpcMutation } from '../hooks/useIpc';
import { useRegisterAiAssistantView } from '../components/assistant/AssistantContext';
import { buildPreviewDiffHtml } from '../utils/previewDiff';
import { buildArticlePreviewDocument } from '../utils/previewDocument';
import { CodeEditor } from '../components/editor/CodeEditor';
import { EditorPane } from '../components/editor/EditorPane';
import { ArticleModeToggle, ArticleSurface, type ArticleSurfaceMode } from '../components/article/ArticleSurface';
import { PlacementSummary } from '../components/article/PlacementSummary';

const { diffHtml } = diffEngine;
const PROPOSAL_REVIEW_TARGET_KEY = 'kbv:proposal-review-target';

type ContentTab = 'preview' | 'preview-diff' | 'diff' | 'source' | 'regions';
type PreviewStyleResponse = { css: string; sourcePath: string };

const PREVIEW_DIFF_FRAME_CSS = `
  .kbv-preview-diff-added,
  .kbv-preview-diff-removed {
    position: relative;
    border-radius: 0.375rem;
  }

  .kbv-preview-diff-added {
    border: 2px solid rgba(22, 163, 74, 0.72);
    background: rgba(22, 163, 74, 0.1);
  }

  .kbv-preview-diff-removed {
    border: 2px solid rgba(220, 38, 38, 0.72);
    background: rgba(220, 38, 38, 0.1);
  }

  span.kbv-preview-diff-added,
  span.kbv-preview-diff-removed {
    display: inline-block;
    padding: 0 0.2rem;
  }

  li.kbv-preview-diff-added,
  li.kbv-preview-diff-removed,
  p.kbv-preview-diff-added,
  p.kbv-preview-diff-removed,
  div.kbv-preview-diff-added,
  div.kbv-preview-diff-removed,
  section.kbv-preview-diff-added,
  section.kbv-preview-diff-removed,
  article.kbv-preview-diff-added,
  article.kbv-preview-diff-removed,
  blockquote.kbv-preview-diff-added,
  blockquote.kbv-preview-diff-removed,
  h1.kbv-preview-diff-added,
  h1.kbv-preview-diff-removed,
  h2.kbv-preview-diff-added,
  h2.kbv-preview-diff-removed,
  h3.kbv-preview-diff-added,
  h3.kbv-preview-diff-removed,
  h4.kbv-preview-diff-added,
  h4.kbv-preview-diff-removed,
  h5.kbv-preview-diff-added,
  h5.kbv-preview-diff-removed,
  h6.kbv-preview-diff-added,
  h6.kbv-preview-diff-removed,
  ul.kbv-preview-diff-added,
  ul.kbv-preview-diff-removed,
  ol.kbv-preview-diff-added,
  ol.kbv-preview-diff-removed,
  table.kbv-preview-diff-added,
  table.kbv-preview-diff-removed,
  pre.kbv-preview-diff-added,
  pre.kbv-preview-diff-removed {
    padding: 0.35rem 0.5rem;
    margin-left: -0.5rem;
    margin-right: -0.5rem;
  }

  li.kbv-preview-diff-added,
  li.kbv-preview-diff-removed {
    list-style-position: inside;
  }

  li.kbv-preview-diff-added::before,
  li.kbv-preview-diff-removed::before,
  p.kbv-preview-diff-added::before,
  p.kbv-preview-diff-removed::before,
  div.kbv-preview-diff-added::before,
  div.kbv-preview-diff-removed::before {
    left: 0.5rem !important;
    right: auto !important;
  }
`;

const ACTION_LABEL: Record<string, string> = {
  create: 'Create',
  edit: 'Edit',
  retire: 'Retire',
  no_impact: 'No Impact',
};

const ACTION_VARIANT: Record<string, 'success' | 'primary' | 'danger' | 'neutral'> = {
  create: 'success',
  edit: 'primary',
  retire: 'danger',
  no_impact: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  pending_review: 'Pending',
  accepted: 'Accepted',
  denied: 'Denied',
  deferred: 'Deferred',
  applied_to_branch: 'Applied',
  archived: 'Archived',
};

const STATUS_VARIANT: Record<string, 'neutral' | 'primary' | 'success' | 'warning' | 'danger'> = {
  pending_review: 'neutral',
  accepted: 'success',
  denied: 'danger',
  deferred: 'warning',
  applied_to_branch: 'primary',
  archived: 'neutral',
};

const BATCH_STATUS_LABEL: Record<string, string> = {
  imported: 'Imported',
  scoped: 'Scoped',
  submitted: 'Submitted',
  analyzed: 'Analyzed',
  review_in_progress: 'In Review',
  review_complete: 'Complete',
  archived: 'Archived',
  proposed: 'Proposed',
};

function batchStatusVariant(status: string): 'neutral' | 'primary' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'review_complete':
      return 'success';
    case 'review_in_progress':
      return 'warning';
    case 'analyzed':
    case 'submitted':
    case 'proposed':
    case 'scoped':
      return 'primary';
    default:
      return 'neutral';
  }
}

function formatDate(utc: string): string {
  try {
    return new Date(utc).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return utc;
  }
}

function confidenceClass(score: number | undefined): string {
  if (!score) return 'confidence-value--medium';
  if (score >= 0.8) return 'confidence-value--high';
  if (score >= 0.5) return 'confidence-value--medium';
  return 'confidence-value--low';
}

function formatConfidence(score: number | undefined): string {
  if (score == null) return '—';
  return `${Math.round(score * 100)}%`;
}

function formatPBIValidationStatus(status?: string): string {
  if (!status) return '—';
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function PBIDetailModal({
  pbi,
  open,
  onClose,
}: {
  pbi: PBIRecord | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!pbi) return null;

  const detailRows = [
    { label: 'External ID', value: pbi.externalId || pbi.id },
    { label: 'Work item type', value: pbi.workItemType },
    { label: 'Priority', value: pbi.priority },
    { label: 'Validation', value: formatPBIValidationStatus(pbi.validationStatus ?? pbi.state) },
    { label: 'Source row', value: String(pbi.sourceRowNumber) },
    { label: 'Parent PBI', value: pbi.parentExternalId },
  ].filter((row) => row.value && row.value !== '—');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={pbi.title || pbi.externalId || 'PBI details'}
      className="pbi-detail-modal"
      footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}
    >
      <div className="pbi-detail-modal__content">
        <div className="pbi-detail-modal__header">
          <div className="pbi-detail-modal__eyebrow">Proposal evidence</div>
          <div className="pbi-detail-modal__title-row">
            <span className="pbi-detail-modal__id">{pbi.externalId || pbi.id}</span>
            {pbi.priority && <Badge variant="warning">{pbi.priority}</Badge>}
            {pbi.workItemType && <Badge variant="neutral">{pbi.workItemType}</Badge>}
          </div>
        </div>

        {detailRows.length > 0 && (
          <div className="pbi-detail-modal__grid">
            {detailRows.map((row) => (
              <div key={row.label} className="pbi-detail-modal__field">
                <div className="pbi-detail-modal__label">{row.label}</div>
                <div className="pbi-detail-modal__value">{row.value}</div>
              </div>
            ))}
          </div>
        )}

        {pbi.description && (
          <section className="pbi-detail-modal__section">
            <div className="pbi-detail-modal__section-label">Description</div>
            <p className="pbi-detail-modal__copy">{pbi.description}</p>
          </section>
        )}

        {pbi.descriptionText && pbi.descriptionText !== pbi.description && (
          <section className="pbi-detail-modal__section">
            <div className="pbi-detail-modal__section-label">Parsed Description</div>
            <p className="pbi-detail-modal__copy">{pbi.descriptionText}</p>
          </section>
        )}

        {pbi.acceptanceCriteriaText && (
          <section className="pbi-detail-modal__section">
            <div className="pbi-detail-modal__section-label">Acceptance Criteria</div>
            <p className="pbi-detail-modal__copy">{pbi.acceptanceCriteriaText}</p>
          </section>
        )}

        {pbi.validationReason && (
          <section className="pbi-detail-modal__section">
            <div className="pbi-detail-modal__section-label">Validation Notes</div>
            <p className="pbi-detail-modal__copy">{pbi.validationReason}</p>
          </section>
        )}

        {pbi.rawDescription && pbi.rawDescription !== pbi.description && (
          <section className="pbi-detail-modal__section">
            <div className="pbi-detail-modal__section-label">Raw Description</div>
            <pre className="pbi-detail-modal__pre">{pbi.rawDescription}</pre>
          </section>
        )}

        {pbi.rawAcceptanceCriteria && (
          <section className="pbi-detail-modal__section">
            <div className="pbi-detail-modal__section-label">Raw Acceptance Criteria</div>
            <pre className="pbi-detail-modal__pre">{pbi.rawAcceptanceCriteria}</pre>
          </section>
        )}
      </div>
    </Modal>
  );
}

function SummaryBar({ summary }: { summary: ProposalReviewSummaryCounts }) {
  return (
    <div className="review-summary-bar">
      <div className="review-summary-stat">
        <span className="review-summary-stat-count">{summary.total}</span> total
      </div>
      <div className="review-summary-stat">
        <span className="review-summary-stat-count">{summary.pendingReview}</span> pending
      </div>
      {summary.accepted > 0 && (
        <div className="review-summary-stat">
          <span className="review-summary-stat-count">{summary.accepted}</span> accepted
        </div>
      )}
      {summary.denied > 0 && (
        <div className="review-summary-stat">
          <span className="review-summary-stat-count">{summary.denied}</span> denied
        </div>
      )}
      {summary.deferred > 0 && (
        <div className="review-summary-stat">
          <span className="review-summary-stat-count">{summary.deferred}</span> deferred
        </div>
      )}
    </div>
  );
}

function QueueItem({
  item,
  isActive,
  onClick,
}: {
  item: ProposalReviewQueueItem;
  isActive: boolean;
  onClick: () => void;
}) {
  const decided = item.reviewStatus !== ProposalReviewStatus.PENDING_REVIEW;
  return (
    <div
      className={[
        'review-queue-item',
        isActive && 'review-queue-item--active',
        decided && 'review-queue-item--decided',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
    >
      <div className="review-queue-item-header">
        <Badge variant={ACTION_VARIANT[item.action] ?? 'neutral'}>
          {ACTION_LABEL[item.action] ?? item.action}
        </Badge>
        {decided && (
          <Badge variant={STATUS_VARIANT[item.reviewStatus] ?? 'neutral'}>
            {STATUS_LABEL[item.reviewStatus] ?? item.reviewStatus}
          </Badge>
        )}
      </div>
      <div className="review-queue-item-title">{item.articleLabel}</div>
      <div className="review-queue-item-meta">
        {item.confidenceScore != null && <span>{Math.round(item.confidenceScore * 100)}%</span>}
        {item.relatedPbiCount > 0 && <span>{item.relatedPbiCount} PBI{item.relatedPbiCount !== 1 ? 's' : ''}</span>}
        {item.locale && <span>{item.locale}</span>}
      </div>
    </div>
  );
}

function PreviewDiffPanel({
  beforeHtml,
  afterHtml,
  styleCss,
  title,
}: {
  beforeHtml: string;
  afterHtml: string;
  styleCss: string;
  title: string;
}) {
  const diffHtml = useMemo(() => buildPreviewDiffHtml(beforeHtml, afterHtml), [beforeHtml, afterHtml]);

  if (!diffHtml) {
    return (
      <div className="html-preview" style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
        No content available
      </div>
    );
  }

  return (
    <div className="detail-preview-frame-card proposal-review-preview-frame-card">
      <iframe
        className="detail-preview-frame proposal-review-preview-frame"
        title={title}
        srcDoc={buildArticlePreviewDocument(diffHtml, title, styleCss, { extraCss: PREVIEW_DIFF_FRAME_CSS })}
        sandbox="allow-same-origin"
      />
    </div>
  );
}

function SourceDiffPanel({ lines }: { lines: ProposalSourceLineChange[] }) {
  if (!lines || lines.length === 0) {
    return (
      <div className="diff-view" style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
        No diff data available
      </div>
    );
  }
  return (
    <div className="diff-view">
      {lines.map((line, i) => (
        <div key={i} className={`diff-line diff-line--${line.kind}`}>
          <div className={`diff-gutter diff-gutter--${line.kind}`}>
            {line.kind === 'removed'
              ? line.lineNumberBefore ?? ''
              : line.kind === 'added'
                ? line.lineNumberAfter ?? ''
                : line.lineNumberBefore ?? ''}
          </div>
          <div className="diff-content">
            {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : '  '}
            {line.content}
          </div>
        </div>
      ))}
    </div>
  );
}

function SourcePanel({
  html,
  savedHtml,
  onChange,
  onSave,
  onRestore,
  saving,
  error,
}: {
  html: string;
  savedHtml: string;
  onChange: (nextValue: string) => void;
  onSave: () => void;
  onRestore: () => void;
  saving: boolean;
  error?: string | null;
}) {
  const isDirty = html !== savedHtml;

  return (
    <EditorPane
      className="source-editor-pane"
      footerStart={error ? <span className="source-editor-pane__error">{error}</span> : <span />} 
      footerEnd={
        isDirty ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onRestore} disabled={saving}>
              Restore
            </button>
            <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </>
        ) : null
      }
    >
      <CodeEditor value={html || ''} language="html" onChange={onChange} />
    </EditorPane>
  );
}

function ChangeRegionsPanel({ regions }: { regions: ProposalChangeRegion[] }) {
  if (!regions || regions.length === 0) {
    return (
      <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
        No change regions
      </div>
    );
  }
  return (
    <div className="change-regions">
      {regions.map((region) => (
        <div key={region.id} className={`change-region change-region--${region.kind}`}>
          <div className="change-region-label">
            <Badge variant={region.kind === 'added' ? 'success' : region.kind === 'removed' ? 'danger' : 'warning'}>
              {region.kind}
            </Badge>
            {region.label}
          </div>
          {region.beforeText && region.kind !== 'added' && (
            <div className="change-region-text" style={{ textDecoration: region.kind === 'removed' ? 'line-through' : undefined }}>
              {region.beforeText}
            </div>
          )}
          {region.afterText && region.kind !== 'removed' && (
            <div className="change-region-text">{region.afterText}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function ConfidenceCard({ score }: { score: number | undefined }) {
  return (
    <div className="card card-padded">
      <div className="review-section-label">Confidence</div>
      <div className="confidence-bar">
        <div className="progress-bar" style={{ flex: 1 }}>
          <div className="progress-bar-fill" style={{ width: `${(score ?? 0) * 100}%` }} />
        </div>
        <span className={`confidence-value ${confidenceClass(score)}`}>{formatConfidence(score)}</span>
      </div>
    </div>
  );
}

function AISummaryCard({
  rationaleSummary,
  aiNotes,
}: {
  rationaleSummary?: string;
  aiNotes?: string;
}) {
  if (!rationaleSummary && !aiNotes) return null;
  return (
    <div className="card card-padded">
      <div className="review-section-label">AI Summary</div>
      <div className="review-scroll-card-body">
        {rationaleSummary && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)', lineHeight: 'var(--leading-normal)', margin: 0 }}>
            {rationaleSummary}
          </p>
        )}
        {aiNotes && (
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', lineHeight: 'var(--leading-normal)', marginTop: 'var(--space-2)' }}>
            {aiNotes}
          </p>
        )}
      </div>
    </div>
  );
}

function PBIEvidenceCard({
  pbis,
  onSelectPBI,
}: {
  pbis: PBIRecord[];
  onSelectPBI: (pbi: PBIRecord) => void;
}) {
  return (
    <div className="card card-padded">
      <div className="review-section-label">Triggering PBIs ({pbis.length})</div>
      <div className="review-scroll-card-body">
        {pbis.length === 0 ? (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>No linked PBIs</div>
        ) : (
          <div className="pbi-evidence-list">
            {pbis.map((pbi) => (
              <button
                key={pbi.id}
                type="button"
                className="pbi-evidence-item"
                onClick={() => onSelectPBI(pbi)}
                aria-label={`Open details for PBI ${pbi.externalId ?? pbi.id}`}
              >
                <div className="pbi-evidence-item-id">{pbi.externalId ?? pbi.id}</div>
                <div className="pbi-evidence-item-title">{pbi.title}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlacementCard({
  currentPlacement,
  suggestedPlacement,
}: {
  currentPlacement?: ProposalReviewDetailResponse['proposal']['currentPlacement'];
  suggestedPlacement?: ProposalPlacementSuggestion;
}) {
  return (
    <div className="card card-padded">
      <div className="review-section-label">
        <IconMapPin size={12} /> Article Location
      </div>
      <PlacementSummary
        current={currentPlacement}
        suggested={suggestedPlacement}
        emptyMessage="No placement metadata is attached to this proposal yet."
      />
    </div>
  );
}

function ProposalBatchRow({
  batch,
  onOpen,
  onDelete,
}: {
  batch: ProposalReviewBatchSummary;
  onOpen: () => void;
  onDelete: (batch: ProposalReviewBatchSummary) => void;
}) {
  const reviewedCount = batch.proposalCount - batch.pendingReviewCount;
  const progress = batch.proposalCount > 0 ? (reviewedCount / batch.proposalCount) * 100 : 0;
  const openCellProps = {
    className: 'proposal-batch-open-cell',
    onClick: onOpen,
    onKeyDown: (event: ReactKeyboardEvent<HTMLTableCellElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpen();
      }
    },
    role: 'button' as const,
    tabIndex: 0,
  };

  return (
    <tr className="proposal-batch-table-row">
      <td {...openCellProps} style={{ fontWeight: 'var(--weight-medium)' }}>
        <div>{batch.batchName}</div>
        <div className="proposal-batch-secondary">{batch.sourceFileName}</div>
      </td>
      <td {...openCellProps} style={{ color: 'var(--color-text-secondary)' }}>{formatDate(batch.importedAtUtc)}</td>
      <td {...openCellProps}>{batch.proposalCount}</td>
      <td {...openCellProps}>
        <div className="proposal-batch-progress">
          <span>{reviewedCount} / {batch.proposalCount}</span>
          <div className="progress-bar proposal-batch-progress-bar">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </td>
      <td {...openCellProps}>
        {batch.pendingReviewCount > 0 ? (
          <span>{batch.pendingReviewCount} pending</span>
        ) : (
          <span className="proposal-batch-empty-note">All reviewed</span>
        )}
      </td>
      <td {...openCellProps}>
        <Badge variant={batchStatusVariant(batch.batchStatus)}>
          {BATCH_STATUS_LABEL[batch.batchStatus] ?? batch.batchStatus}
        </Badge>
      </td>
      <td
        className="proposal-batch-actions-cell"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="proposal-batch-actions">
          <button
            type="button"
            className="btn btn-primary btn-xs"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            {batch.pendingReviewCount > 0 ? 'Review' : 'Open'}
          </button>
          <button
            type="button"
            className="proposal-batch-delete"
            title="Delete proposal set"
            aria-label="Delete proposal set"
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(batch);
            }}
          >
            <IconTrash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

export const ProposalReview = () => {
  const { activeWorkspace } = useWorkspace();

  const previewStyleQuery = useIpc<PreviewStyleResponse>('article.preview.styles.get');
  const batchListIpc = useIpc<ProposalReviewBatchListResponse>('proposal.review.batchList');
  const listIpc = useIpc<ProposalReviewListResponse>('proposal.review.list');
  const detailIpc = useIpc<ProposalReviewDetailResponse>('proposal.review.get');
  const decideMutation = useIpcMutation<ProposalReviewDecisionResponse>('proposal.review.decide');
  const saveWorkingCopyMutation = useIpcMutation<ProposalReviewDetailResponse>('proposal.review.saveWorkingCopy');
  const { execute: executeBatchList, reset: resetBatchList } = batchListIpc;
  const { execute: executeList, reset: resetList } = listIpc;
  const { execute: executeDetail, reset: resetDetail } = detailIpc;
  const { mutate: mutateDecision } = decideMutation;
  const { mutate: mutateSaveWorkingCopy, loading: savingWorkingCopy, error: saveWorkingCopyError } = saveWorkingCopyMutation;

  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ContentTab>('preview');
  const [decidingAs, setDecidingAs] = useState<ProposalReviewDecision | null>(null);
  const [selectedPBI, setSelectedPBI] = useState<PBIRecord | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProposalReviewBatchSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const toggleInfoPanel = useCallback(() => setInfoPanelOpen((o) => !o), []);
  const [proposalWorkingCopy, setProposalWorkingCopy] = useState<{
    html: string;
    title?: string;
    rationale?: string;
    rationaleSummary?: string;
    aiNotes?: string;
  } | null>(null);
  const [sourceEditorHtml, setSourceEditorHtml] = useState('');
  const [savedSourceHtml, setSavedSourceHtml] = useState('');
  const [previewMode, setPreviewMode] = useState<ArticleSurfaceMode>('preview');
  const containerRef = useRef<HTMLDivElement>(null);

  const batchSummaries = batchListIpc.data?.batches ?? [];
  const listData = listIpc.data;
  const detail = detailIpc.data;
  const queue = listData?.queue ?? [];
  const groups = listData?.groups ?? [];
  const summary = listData?.summary;
  const proposal = detail?.proposal;
  const persistedDiff = detail?.diff;
  const navigation = detail?.navigation;
  const relatedPbis = detail?.relatedPbis ?? [];
  const selectedQueueItem = queue.find((item) => item.proposalId === selectedProposalId);
  const selectedBatchSummary = batchSummaries.find((batch) => batch.batchId === selectedBatchId) ?? null;
  const allReviewed = summary ? summary.pendingReview === 0 : false;

  const loadBatchSummaries = useCallback(async () => {
    if (!activeWorkspace) return;
    await executeBatchList({ workspaceId: activeWorkspace.id });
  }, [activeWorkspace?.id, executeBatchList]);

  const openBatch = useCallback((batchId: string) => {
    setSelectedBatchId(batchId);
    setSelectedProposalId(null);
    setSelectedPBI(null);
    setActiveTab('preview');
    resetDetail();
  }, [resetDetail]);

  const closeBatch = useCallback(() => {
    setSelectedBatchId(null);
    setSelectedProposalId(null);
    setSelectedPBI(null);
    setActiveTab('preview');
    resetList();
    resetDetail();
  }, [resetDetail, resetList]);

  useEffect(() => {
    if (!activeWorkspace) return;
    setSelectedBatchId(null);
    setSelectedProposalId(null);
    setSelectedPBI(null);
    setActiveTab('preview');
    resetBatchList();
    resetList();
    resetDetail();
    void previewStyleQuery.execute({});
    void loadBatchSummaries();
  }, [activeWorkspace?.id, resetBatchList, resetList, resetDetail, loadBatchSummaries, previewStyleQuery.execute]);

  useEffect(() => {
    if (!activeWorkspace) {
      return;
    }

    const unsubscribe = window.kbv.emitJobEvents((event) => {
      if (event.command !== 'agent.analysis.run') return;
      if (event.state !== 'SUCCEEDED') return;

      const metadata = (event as { metadata?: { batchId?: unknown; workspaceId?: unknown } }).metadata;
      const batchId = typeof metadata?.batchId === 'string' ? metadata.batchId : null;
      const workspaceId = typeof metadata?.workspaceId === 'string' ? metadata.workspaceId : activeWorkspace.id;

      if (workspaceId !== activeWorkspace.id) {
        return;
      }

      void loadBatchSummaries();

      if (batchId && selectedBatchId === batchId) {
        void executeList({ workspaceId: activeWorkspace.id, batchId });
        if (selectedProposalId) {
          void executeDetail({ workspaceId: activeWorkspace.id, proposalId: selectedProposalId });
        }
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [activeWorkspace?.id, executeDetail, executeList, loadBatchSummaries, selectedBatchId, selectedProposalId]);

  useEffect(() => {
    if (!activeWorkspace) return;
    const targetProposalId = window.sessionStorage.getItem(PROPOSAL_REVIEW_TARGET_KEY);
    if (!targetProposalId) return;
    window.sessionStorage.removeItem(PROPOSAL_REVIEW_TARGET_KEY);
    setSelectedProposalId(targetProposalId);
    setSelectedPBI(null);
    setActiveTab('preview');
  }, [activeWorkspace?.id]);

  useEffect(() => {
    if (!activeWorkspace || !selectedBatchId) return;
    void executeList({ workspaceId: activeWorkspace.id, batchId: selectedBatchId });
  }, [activeWorkspace?.id, selectedBatchId, executeList]);

  useEffect(() => {
    if (!activeWorkspace || !selectedProposalId) return;
    void executeDetail({ workspaceId: activeWorkspace.id, proposalId: selectedProposalId });
  }, [activeWorkspace?.id, selectedProposalId, executeDetail]);

  useEffect(() => {
    if (!detail?.batchId) return;
    if (selectedBatchId === detail.batchId) return;
    setSelectedBatchId(detail.batchId);
  }, [detail?.batchId, selectedBatchId]);

  useEffect(() => {
    setSelectedPBI(null);
  }, [selectedProposalId]);

  useEffect(() => {
    if (!detail?.proposal?.id) return;
    setProposalWorkingCopy(null);
  }, [detail?.proposal.id, detail?.diff?.afterHtml]);

  useEffect(() => {
    if (!detail?.proposal?.id && !proposalWorkingCopy?.html) return;
    const nextHtml = proposalWorkingCopy?.html ?? detail?.diff?.afterHtml ?? '';
    setSourceEditorHtml(nextHtml);
    setSavedSourceHtml(nextHtml);
  }, [detail?.proposal.id, detail?.diff?.afterHtml, proposalWorkingCopy?.html]);

  useEffect(() => {
    if (queue.length === 0 || selectedProposalId) return;
    const firstPending = queue.find((item) => item.reviewStatus === ProposalReviewStatus.PENDING_REVIEW);
    setSelectedProposalId(firstPending?.proposalId ?? queue[0].proposalId);
  }, [queue, selectedProposalId]);

  const navigateNext = useCallback(() => {
    if (navigation?.nextProposalId) {
      setSelectedProposalId(navigation.nextProposalId);
    }
  }, [navigation?.nextProposalId]);

  const navigatePrevious = useCallback(() => {
    if (navigation?.previousProposalId) {
      setSelectedProposalId(navigation.previousProposalId);
    }
  }, [navigation?.previousProposalId]);

  const refreshCurrentBatch = useCallback(async () => {
    if (!activeWorkspace || !selectedBatchId) return;
    await Promise.all([
      executeList({ workspaceId: activeWorkspace.id, batchId: selectedBatchId }),
      loadBatchSummaries(),
    ]);
  }, [activeWorkspace?.id, selectedBatchId, executeList, loadBatchSummaries]);

  const handleSaveSource = useCallback(async () => {
    if (!activeWorkspace || !proposal?.id) return;
    const result = await mutateSaveWorkingCopy({
      workspaceId: activeWorkspace.id,
      proposalId: proposal.id,
      html: sourceEditorHtml,
    });
    if (!result) return;

    const nextHtml = result.diff.afterHtml;
    setProposalWorkingCopy({
      html: nextHtml,
      title: result.proposal.targetTitle,
      rationale: proposalWorkingCopy?.rationale,
      rationaleSummary: result.proposal.rationaleSummary,
      aiNotes: proposalWorkingCopy?.aiNotes ?? result.proposal.aiNotes,
    });
    setSavedSourceHtml(nextHtml);
    setSourceEditorHtml(nextHtml);
  }, [activeWorkspace, proposal?.id, sourceEditorHtml, mutateSaveWorkingCopy, proposalWorkingCopy?.aiNotes, proposalWorkingCopy?.rationale]);

  const handleRestoreSource = useCallback(() => {
    setSourceEditorHtml(savedSourceHtml);
  }, [savedSourceHtml]);

  const handleDecision = useCallback(async (decision: ProposalReviewDecision) => {
    if (!activeWorkspace || !selectedProposalId) return;
    setDecidingAs(decision);
    try {
      const result = await mutateDecision({
        workspaceId: activeWorkspace.id,
        proposalId: selectedProposalId,
        decision,
      });
      if (!result) return;

      await refreshCurrentBatch();

      if (navigation?.nextProposalId) {
        setSelectedProposalId(navigation.nextProposalId);
      } else {
        await executeDetail({ workspaceId: activeWorkspace.id, proposalId: selectedProposalId });
      }
    } finally {
      setDecidingAs(null);
    }
  }, [activeWorkspace?.id, selectedProposalId, mutateDecision, refreshCurrentBatch, navigation?.nextProposalId, executeDetail]);

  const handleDelete = useCallback(async () => {
    if (!activeWorkspace || !deleteTarget) return;
    setDeletingBatchId(deleteTarget.batchId);
    setDeleteError(null);
    try {
      const payload: PBIBatchDeleteRequest = {
        workspaceId: activeWorkspace.id,
        batchId: deleteTarget.batchId
      };
      const response = await window.kbv.invoke<{ workspaceId: string; batchId: string }>('pbiBatch.delete', payload);
      if (!response.ok) {
        setDeleteError(response.error?.message ?? 'Failed to delete proposal set');
        return;
      }
      setShowDeleteDialog(false);
      setDeleteTarget(null);
      setSelectedBatchId(null);
      setSelectedProposalId(null);
      setSelectedPBI(null);
      setProposalWorkingCopy(null);
      resetList();
      resetDetail();
      await loadBatchSummaries();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete proposal set');
    } finally {
      setDeletingBatchId(null);
    }
  }, [
    activeWorkspace,
    deleteTarget,
    loadBatchSummaries,
    resetDetail,
    resetList
  ]);

  const isEditProposal = proposal?.action === ProposalAction.EDIT;
  const workingHtml = proposalWorkingCopy?.html ?? persistedDiff?.afterHtml ?? '';
  const diff = useMemo(() => {
    if (!persistedDiff) return persistedDiff;
    if (!proposalWorkingCopy?.html) return persistedDiff;
    const next = diffHtml(persistedDiff.beforeHtml ?? '', proposalWorkingCopy.html);
    return {
      beforeHtml: next.beforeHtml,
      afterHtml: next.afterHtml,
      sourceDiff: {
        lines: next.sourceLines.map((line) => ({
          kind: line.kind,
          lineNumberBefore: line.beforeLineNumber,
          lineNumberAfter: line.afterLineNumber,
          content: line.content
        }))
      },
      renderedDiff: {
        blocks: next.renderedBlocks.map((block) => ({
          kind: block.kind,
          beforeText: block.beforeText,
          afterText: block.afterText
        }))
      },
      changeRegions: next.changeRegions.map((region) => ({
        id: region.id,
        kind: region.kind,
        label: region.label,
        beforeText: region.beforeText,
        afterText: region.afterText,
        beforeLineStart: region.beforeLineStart,
        beforeLineEnd: region.beforeLineEnd,
        afterLineStart: region.afterLineStart,
        afterLineEnd: region.afterLineEnd
      })),
      gutter: next.gutter.map((item) => ({
        lineNumber: item.lineNumber,
        kind: item.kind,
        regionId: item.regionId,
        side: item.side
      }))
    };
  }, [persistedDiff, proposalWorkingCopy?.html]);
  const hasDiff = !!diff?.sourceDiff?.lines?.length;
  const previewDiffBeforeHtml = persistedDiff?.beforeHtml ?? '';
  const previewDiffAfterHtml = workingHtml;
  const previewSurfaceHtml = sourceEditorHtml;

  useRegisterAiAssistantView({
    enabled: Boolean(activeWorkspace && proposal && diff),
    context: {
      workspaceId: activeWorkspace?.id ?? '',
      route: AppRoute.PROPOSAL_REVIEW,
      routeLabel: 'Proposal Review',
      subject: {
        type: 'proposal',
        id: proposal?.id ?? 'proposal',
        title: proposalWorkingCopy?.title ?? proposal?.targetTitle ?? selectedQueueItem?.articleLabel,
        locale: proposal?.targetLocale
      },
      workingState: {
        kind: 'proposal_html',
        versionToken: proposal ? buildAppWorkingStateVersionToken({
          route: AppRoute.PROPOSAL_REVIEW,
          entityType: 'proposal',
          entityId: proposal.id,
          currentValues: {
            html: workingHtml,
            title: proposalWorkingCopy?.title ?? proposal?.targetTitle ?? '',
            rationale: proposalWorkingCopy?.rationale ?? '',
            rationaleSummary: proposalWorkingCopy?.rationaleSummary ?? proposal?.rationaleSummary ?? '',
            aiNotes: proposalWorkingCopy?.aiNotes ?? proposal?.aiNotes ?? ''
          }
        }) : 'proposal',
        payload: {
          html: workingHtml,
          title: proposalWorkingCopy?.title ?? proposal?.targetTitle ?? '',
          rationale: proposalWorkingCopy?.rationale ?? '',
          aiNotes: proposalWorkingCopy?.aiNotes ?? proposal?.aiNotes ?? '',
          rationaleSummary: proposalWorkingCopy?.rationaleSummary ?? proposal?.rationaleSummary ?? ''
        }
      },
      capabilities: {
        canChat: true,
        canCreateProposal: false,
        canPatchProposal: true,
        canPatchDraft: false,
        canPatchTemplate: false,
        canUseUnsavedWorkingState: true
      },
      backingData: {
        batchId: selectedBatchId,
        proposalId: proposal?.id,
        articleKey: selectedQueueItem?.articleKey,
        localeVariantId: proposal?.localeVariantId,
        sourceRevisionId: proposal?.sourceRevisionId,
        proposal
      }
    },
    applyWorkingStatePatch: (patch) => {
      setProposalWorkingCopy((prev) => ({
        html: typeof patch.html === 'string' ? patch.html : (prev?.html ?? workingHtml),
        title: typeof patch.title === 'string' ? patch.title : (prev?.title ?? proposal?.targetTitle),
        rationale: typeof patch.rationale === 'string' ? patch.rationale : (prev?.rationale ?? ''),
        rationaleSummary: typeof patch.rationaleSummary === 'string'
          ? patch.rationaleSummary
          : (prev?.rationaleSummary ?? proposal?.rationaleSummary),
        aiNotes: typeof patch.aiNotes === 'string'
          ? patch.aiNotes
          : (prev?.aiNotes ?? proposal?.aiNotes)
      }));
    }
  });

  if (!activeWorkspace) {
    return (
      <>
        <PageHeader title="Proposal Review" subtitle="No workspace selected" />
        <div className="route-content">
          <EmptyState
            icon={<IconCheckCircle size={48} />}
            title="No workspace open"
            description="Open or create a workspace to review generated proposal batches."
          />
        </div>
      </>
    );
  }

  if (!selectedBatchId) {
    return (
      <>
        <PageHeader title="Proposal Review" subtitle="Browse generated proposal batches before opening the reviewer workbench" />
        <div className="route-content">
          {batchListIpc.loading && !batchListIpc.data ? (
            <LoadingState message="Loading proposal batches..." />
          ) : batchListIpc.error && !batchListIpc.data ? (
            <ErrorState
              title="Failed to load proposal batches"
              description={batchListIpc.error}
              action={
                <button className="btn btn-primary" onClick={() => void loadBatchSummaries()}>
                  Retry
                </button>
              }
            />
          ) : batchSummaries.length === 0 ? (
            <EmptyState
              icon={<IconCheckCircle size={48} />}
              title="No generated proposals yet"
              description="Run analysis on a PBI batch to generate proposals that can be reviewed here."
            />
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Proposal Set</th>
                    <th>Imported</th>
                    <th>Proposals</th>
                    <th>Reviewed</th>
                    <th>Pending</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {batchSummaries.map((batch) => (
                    <ProposalBatchRow
                      key={batch.batchId}
                      batch={batch}
                      onOpen={() => openBatch(batch.batchId)}
                      onDelete={(batchItem) => {
                        setDeleteTarget(batchItem);
                        setDeleteError(null);
                        setShowDeleteDialog(true);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    );
  }

  if (listIpc.loading && !listData) {
    return (
      <>
        <PageHeader
          title="Proposal Review"
          subtitle={selectedBatchSummary?.batchName ?? 'Loading proposal set'}
          actions={
            <button className="btn btn-ghost proposal-review-back-btn" onClick={closeBatch}>
              <IconChevronLeft size={14} />
              Back to Proposal Sets
            </button>
          }
        />
        <div className="route-content">
          <LoadingState message="Loading proposals..." />
        </div>
      </>
    );
  }

  if (listIpc.error && !listData) {
    return (
      <>
        <PageHeader
          title="Proposal Review"
          subtitle={selectedBatchSummary?.batchName ?? 'Proposal set'}
          actions={
            <button className="btn btn-ghost proposal-review-back-btn" onClick={closeBatch}>
              <IconChevronLeft size={14} />
              Back to Proposal Sets
            </button>
          }
        />
        <div className="route-content">
          <ErrorState
            title="Failed to load proposals"
            description={listIpc.error}
            action={
              <button
                className="btn btn-secondary"
                onClick={() => activeWorkspace && void listIpc.execute({ workspaceId: activeWorkspace.id, batchId: selectedBatchId })}
              >
                Retry
              </button>
            }
          />
        </div>
      </>
    );
  }

  if (!listData || queue.length === 0) {
    return (
      <>
        <PageHeader
          title="Proposal Review"
          subtitle={selectedBatchSummary?.batchName ?? 'Proposal set'}
          actions={
            <button className="btn btn-ghost proposal-review-back-btn" onClick={closeBatch}>
              <IconChevronLeft size={14} />
              Back to Proposal Sets
            </button>
          }
        />
        <div className="route-content">
          <EmptyState
            icon={<IconCheckCircle size={48} />}
            title="No proposals in this batch"
            description="This proposal set does not currently contain any reviewable proposals."
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Proposal Review"
        subtitle={selectedBatchSummary?.batchName ?? `${summary?.total ?? queue.length} proposals`}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <button className="btn btn-ghost proposal-review-back-btn" onClick={closeBatch}>
              <IconChevronLeft size={14} />
              Back to Proposal Sets
            </button>
            {summary && (
              <>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  {summary.total - summary.pendingReview} / {summary.total} reviewed
                </span>
                <div className="progress-bar" style={{ width: 120 }}>
                  <div
                    className="progress-bar-fill"
                    style={{
                      width: `${((summary.total - summary.pendingReview) / Math.max(summary.total, 1)) * 100}%`,
                    }}
                  />
                </div>
              </>
            )}
          </div>
        }
      />
      <div className="route-content" ref={containerRef}>
        <div className="review-layout">
          <div className="card review-queue">
            <div className="card-header">
              <span className="card-header-title">Proposals</span>
            </div>
            {summary && <SummaryBar summary={summary} />}
            <div className="review-queue-list">
              {groups.length > 0
                ? groups.map((group) => (
                    <div key={group.articleKey}>
                      <div className="review-queue-group">
                        {group.articleLabel}
                        <span style={{ fontWeight: 'var(--weight-normal)', marginLeft: 'var(--space-1)' }}>
                          ({group.total})
                        </span>
                      </div>
                      {queue
                        .filter((item) => group.proposalIds.includes(item.proposalId))
                        .map((item) => (
                          <QueueItem
                            key={item.proposalId}
                            item={item}
                            isActive={item.proposalId === selectedProposalId}
                            onClick={() => setSelectedProposalId(item.proposalId)}
                          />
                        ))}
                    </div>
                  ))
                : queue.map((item) => (
                    <QueueItem
                      key={item.proposalId}
                      item={item}
                      isActive={item.proposalId === selectedProposalId}
                      onClick={() => setSelectedProposalId(item.proposalId)}
                    />
                  ))}
            </div>
          </div>

          <div className="card review-center">
            {detailIpc.loading && !detail ? (
              <LoadingState message="Loading proposal..." />
            ) : detailIpc.error && !detail ? (
              <ErrorState title="Failed to load proposal" description={detailIpc.error} />
            ) : !proposal ? (
              <EmptyState title="Select a proposal" description="Choose a proposal from the queue to review." />
            ) : (
              <>
                <div className="review-center-header">
                  <div className="review-center-title">
                    <Badge variant={ACTION_VARIANT[proposal.action] ?? 'neutral'}>
                      {ACTION_LABEL[proposal.action] ?? proposal.action}
                    </Badge>
                    <span className="review-center-title-text">
                      {proposalWorkingCopy?.title || proposal.targetTitle || selectedQueueItem?.articleLabel || 'Proposal'}
                    </span>
                    {proposal.reviewStatus !== ProposalReviewStatus.PENDING_REVIEW && (
                      <Badge variant={STATUS_VARIANT[proposal.reviewStatus] ?? 'neutral'}>
                        {STATUS_LABEL[proposal.reviewStatus] ?? proposal.reviewStatus}
                      </Badge>
                    )}
                  </div>
                  {navigation && (
                    <div className="review-center-nav">
                      {activeTab === 'preview' && (
                        <ArticleModeToggle mode={previewMode} onChange={setPreviewMode} compact />
                      )}
                      <button
                        className="review-center-nav-btn"
                        disabled={!navigation.previousProposalId}
                        onClick={navigatePrevious}
                        title="Previous (K / Up)"
                      >
                        <IconChevronLeft size={16} />
                      </button>
                      <span className="review-center-nav-pos">
                        {navigation.currentIndex + 1} / {navigation.total}
                      </span>
                      <button
                        className="review-center-nav-btn"
                        disabled={!navigation.nextProposalId}
                        onClick={navigateNext}
                        title="Next (J / Down)"
                      >
                        <IconChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </div>

                <div className="review-tab-bar">
                  <div className={`review-tab ${activeTab === 'preview' ? 'review-tab--active' : ''}`} onClick={() => setActiveTab('preview')}>
                    <span className="review-tab-icon">
                      <IconEye size={14} />
                    </span>
                    Preview
                  </div>
                  {(isEditProposal || hasDiff) && (
                    <div className={`review-tab ${activeTab === 'preview-diff' ? 'review-tab--active' : ''}`} onClick={() => setActiveTab('preview-diff')}>
                      <span className="review-tab-icon">
                        <IconEye size={14} />
                      </span>
                      Preview + Diff
                    </div>
                  )}
                  {(isEditProposal || hasDiff) && (
                    <div className={`review-tab ${activeTab === 'diff' ? 'review-tab--active' : ''}`} onClick={() => setActiveTab('diff')}>
                      <span className="review-tab-icon">
                        <IconFileText size={14} />
                      </span>
                      Source Diff
                    </div>
                  )}
                  <div className={`review-tab ${activeTab === 'source' ? 'review-tab--active' : ''}`} onClick={() => setActiveTab('source')}>
                    <span className="review-tab-icon">
                      <IconCode size={14} />
                    </span>
                    Source
                  </div>
                  {diff?.changeRegions && diff.changeRegions.length > 0 && (
                    <div className={`review-tab ${activeTab === 'regions' ? 'review-tab--active' : ''}`} onClick={() => setActiveTab('regions')}>
                      Changes ({diff.changeRegions.length})
                    </div>
                  )}
                </div>

                <div
                  className={`review-content-body ${
                    activeTab === 'preview' || activeTab === 'preview-diff' ? 'review-content-body--preview' : ''
                  }`}
                >
                  {activeTab === 'preview' && (
                    <ArticleSurface
                      mode={previewMode}
                      html={previewSurfaceHtml}
                      styleCss={previewStyleQuery.data?.css ?? ''}
                      title={proposalWorkingCopy?.title ?? proposal?.targetTitle ?? 'Proposal preview'}
                      onChange={setSourceEditorHtml}
                      savedHtml={savedSourceHtml}
                      onSave={() => void handleSaveSource()}
                      onRestore={handleRestoreSource}
                      saving={savingWorkingCopy}
                      error={saveWorkingCopyError}
                    />
                  )}
                  {activeTab === 'preview-diff' && (
                    <PreviewDiffPanel
                      beforeHtml={previewDiffBeforeHtml}
                      afterHtml={previewDiffAfterHtml}
                      styleCss={previewStyleQuery.data?.css ?? ''}
                      title={`${proposalWorkingCopy?.title ?? proposal?.targetTitle ?? 'Proposal preview'} diff preview`}
                    />
                  )}
                  {activeTab === 'diff' && diff && <SourceDiffPanel lines={diff.sourceDiff?.lines ?? []} />}
                  {activeTab === 'source' && (
                    <SourcePanel
                      html={sourceEditorHtml}
                      savedHtml={savedSourceHtml}
                      onChange={setSourceEditorHtml}
                      onSave={() => void handleSaveSource()}
                      onRestore={handleRestoreSource}
                      saving={savingWorkingCopy}
                      error={saveWorkingCopyError}
                    />
                  )}
                  {activeTab === 'regions' && diff && <ChangeRegionsPanel regions={diff.changeRegions ?? []} />}
                </div>

                <div className="review-center-actions">
                  {proposal.reviewStatus === ProposalReviewStatus.PENDING_REVIEW ? (
                    <>
                      <div className="review-actions-row">
                        <button
                          className="btn btn-primary review-actions-accept"
                          onClick={() => void handleDecision(ProposalReviewDecision.ACCEPT)}
                          disabled={!!decidingAs}
                        >
                          {decidingAs === ProposalReviewDecision.ACCEPT ? 'Accepting...' : 'Accept'}
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={() => void handleDecision(ProposalReviewDecision.DENY)}
                          disabled={!!decidingAs}
                        >
                          {decidingAs === ProposalReviewDecision.DENY ? 'Denying...' : 'Deny'}
                        </button>
                      </div>
                      {isEditProposal && (
                        <button
                          className="btn btn-ghost"
                          onClick={() => void handleDecision(ProposalReviewDecision.APPLY_TO_BRANCH)}
                          disabled={!!decidingAs}
                        >
                          <span className="review-action-icon">
                            <IconGitBranch size={14} />
                          </span>
                          Apply to Branch
                        </button>
                      )}
                      {proposal.action === ProposalAction.NO_IMPACT && (
                        <button
                          className="btn btn-ghost"
                          onClick={() => void handleDecision(ProposalReviewDecision.ARCHIVE)}
                          disabled={!!decidingAs}
                        >
                          <span className="review-action-icon">
                            <IconArchive size={14} />
                          </span>
                          Archive
                        </button>
                      )}
                    </>
                  ) : (
                    <div style={{ textAlign: 'center', padding: 'var(--space-3)' }}>
                      <Badge variant={STATUS_VARIANT[proposal.reviewStatus] ?? 'neutral'}>
                        {STATUS_LABEL[proposal.reviewStatus] ?? proposal.reviewStatus}
                      </Badge>
                      {proposal.decidedAtUtc && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
                          Decided {new Date(proposal.decidedAtUtc).toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className={`review-right ${infoPanelOpen ? 'review-right--open' : ''}`}>
            <button
              className="proposal-info-toggle"
              onClick={toggleInfoPanel}
              title={infoPanelOpen ? 'Hide proposal info' : 'Show proposal info'}
            >
              {infoPanelOpen ? <IconPanelRight size={18} /> : <IconPanelLeft size={18} />}
            </button>

            <div className={`proposal-info-panel ${infoPanelOpen ? 'proposal-info-panel--open' : ''}`}>
              {proposal && (
                <>
                  <ConfidenceCard score={proposal.confidenceScore} />
                  <AISummaryCard
                    rationaleSummary={proposalWorkingCopy?.rationaleSummary ?? proposal.rationaleSummary}
                    aiNotes={proposalWorkingCopy?.aiNotes ?? proposalWorkingCopy?.rationale ?? proposal.aiNotes}
                  />
                  <PBIEvidenceCard pbis={relatedPbis} onSelectPBI={setSelectedPBI} />
                  <PlacementCard
                    currentPlacement={proposal.currentPlacement}
                    suggestedPlacement={proposal.suggestedPlacement}
                  />
                </>
              )}
            </div>

            {allReviewed && !proposal && (
              <div className="card card-padded" style={{ textAlign: 'center' }}>
                <IconCheckCircle size={32} className="text-success" />
                <h3 style={{ margin: 'var(--space-2) 0', fontSize: 'var(--text-base)' }}>All Reviewed</h3>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                  {summary?.accepted} accepted, {summary?.denied} denied, {summary?.deferred} deferred
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      <PBIDetailModal pbi={selectedPBI} open={selectedPBI != null} onClose={() => setSelectedPBI(null)} />
      <ConfirmationDialog
        open={showDeleteDialog}
        title="Delete Proposal"
        message={
          <>
            <p>Are you sure you want to delete <strong>{deleteTarget?.batchName || 'this proposal set'}</strong>?</p>
            <p>This will permanently remove the proposal set, its proposals, and the imported PBI rows tied to that batch.</p>
            {deleteError && <p className="confirmation-dialog__error">{deleteError}</p>}
          </>
        }
        confirmText={deletingBatchId ? 'Deleting...' : 'Delete Proposal Set'}
        variant="danger"
        isProcessing={Boolean(deletingBatchId)}
        onClose={() => {
          if (deletingBatchId) return;
          setShowDeleteDialog(false);
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={handleDelete}
      />
    </>
  );
};
