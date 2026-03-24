import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AppRoute, ProposalReviewStatus, ProposalReviewDecision, ProposalAction, } from '@kb-vault/shared-types';
import * as diffEngine from '@kb-vault/diff-engine';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { Badge } from '../components/Badge';
import { Kbd } from '../components/Kbd';
import { Modal } from '../components/Modal';
import { IconCheckCircle, IconChevronLeft, IconChevronRight, IconArchive, IconMapPin, IconGitBranch, IconEye, IconCode, IconFileText, IconTrash2, } from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc, useIpcMutation } from '../hooks/useIpc';
import { useRegisterAiAssistantView } from '../components/assistant/AssistantContext';
const { diffHtml } = diffEngine;
const PROPOSAL_REVIEW_TARGET_KEY = 'kbv:proposal-review-target';
const ACTION_LABEL = {
    create: 'Create',
    edit: 'Edit',
    retire: 'Retire',
    no_impact: 'No Impact',
};
const ACTION_VARIANT = {
    create: 'success',
    edit: 'primary',
    retire: 'danger',
    no_impact: 'neutral',
};
const STATUS_LABEL = {
    pending_review: 'Pending',
    accepted: 'Accepted',
    denied: 'Denied',
    deferred: 'Deferred',
    applied_to_branch: 'Applied',
    archived: 'Archived',
};
const STATUS_VARIANT = {
    pending_review: 'neutral',
    accepted: 'success',
    denied: 'danger',
    deferred: 'warning',
    applied_to_branch: 'primary',
    archived: 'neutral',
};
const BATCH_STATUS_LABEL = {
    imported: 'Imported',
    scoped: 'Scoped',
    submitted: 'Submitted',
    analyzed: 'Analyzed',
    review_in_progress: 'In Review',
    review_complete: 'Complete',
    archived: 'Archived',
    proposed: 'Proposed',
};
function batchStatusVariant(status) {
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
function formatDate(utc) {
    try {
        return new Date(utc).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    catch {
        return utc;
    }
}
function confidenceClass(score) {
    if (!score)
        return 'confidence-value--medium';
    if (score >= 0.8)
        return 'confidence-value--high';
    if (score >= 0.5)
        return 'confidence-value--medium';
    return 'confidence-value--low';
}
function formatConfidence(score) {
    if (score == null)
        return '—';
    return `${Math.round(score * 100)}%`;
}
function formatPBIValidationStatus(status) {
    if (!status)
        return '—';
    return status
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}
function PBIDetailModal({ pbi, open, onClose, }) {
    if (!pbi)
        return null;
    const detailRows = [
        { label: 'External ID', value: pbi.externalId || pbi.id },
        { label: 'Work item type', value: pbi.workItemType },
        { label: 'Priority', value: pbi.priority },
        { label: 'Validation', value: formatPBIValidationStatus(pbi.validationStatus ?? pbi.state) },
        { label: 'Source row', value: String(pbi.sourceRowNumber) },
        { label: 'Parent PBI', value: pbi.parentExternalId },
    ].filter((row) => row.value && row.value !== '—');
    return (_jsx(Modal, { open: open, onClose: onClose, title: pbi.title || pbi.externalId || 'PBI details', className: "pbi-detail-modal", footer: _jsx("button", { className: "btn btn-primary", onClick: onClose, children: "Close" }), children: _jsxs("div", { className: "pbi-detail-modal__content", children: [_jsxs("div", { className: "pbi-detail-modal__header", children: [_jsx("div", { className: "pbi-detail-modal__eyebrow", children: "Proposal evidence" }), _jsxs("div", { className: "pbi-detail-modal__title-row", children: [_jsx("span", { className: "pbi-detail-modal__id", children: pbi.externalId || pbi.id }), pbi.priority && _jsx(Badge, { variant: "warning", children: pbi.priority }), pbi.workItemType && _jsx(Badge, { variant: "neutral", children: pbi.workItemType })] })] }), detailRows.length > 0 && (_jsx("div", { className: "pbi-detail-modal__grid", children: detailRows.map((row) => (_jsxs("div", { className: "pbi-detail-modal__field", children: [_jsx("div", { className: "pbi-detail-modal__label", children: row.label }), _jsx("div", { className: "pbi-detail-modal__value", children: row.value })] }, row.label))) })), pbi.description && (_jsxs("section", { className: "pbi-detail-modal__section", children: [_jsx("div", { className: "pbi-detail-modal__section-label", children: "Description" }), _jsx("p", { className: "pbi-detail-modal__copy", children: pbi.description })] })), pbi.descriptionText && pbi.descriptionText !== pbi.description && (_jsxs("section", { className: "pbi-detail-modal__section", children: [_jsx("div", { className: "pbi-detail-modal__section-label", children: "Parsed Description" }), _jsx("p", { className: "pbi-detail-modal__copy", children: pbi.descriptionText })] })), pbi.acceptanceCriteriaText && (_jsxs("section", { className: "pbi-detail-modal__section", children: [_jsx("div", { className: "pbi-detail-modal__section-label", children: "Acceptance Criteria" }), _jsx("p", { className: "pbi-detail-modal__copy", children: pbi.acceptanceCriteriaText })] })), pbi.validationReason && (_jsxs("section", { className: "pbi-detail-modal__section", children: [_jsx("div", { className: "pbi-detail-modal__section-label", children: "Validation Notes" }), _jsx("p", { className: "pbi-detail-modal__copy", children: pbi.validationReason })] })), pbi.rawDescription && pbi.rawDescription !== pbi.description && (_jsxs("section", { className: "pbi-detail-modal__section", children: [_jsx("div", { className: "pbi-detail-modal__section-label", children: "Raw Description" }), _jsx("pre", { className: "pbi-detail-modal__pre", children: pbi.rawDescription })] })), pbi.rawAcceptanceCriteria && (_jsxs("section", { className: "pbi-detail-modal__section", children: [_jsx("div", { className: "pbi-detail-modal__section-label", children: "Raw Acceptance Criteria" }), _jsx("pre", { className: "pbi-detail-modal__pre", children: pbi.rawAcceptanceCriteria })] }))] }) }));
}
function SummaryBar({ summary }) {
    return (_jsxs("div", { className: "review-summary-bar", children: [_jsxs("div", { className: "review-summary-stat", children: [_jsx("span", { className: "review-summary-stat-count", children: summary.total }), " total"] }), _jsxs("div", { className: "review-summary-stat", children: [_jsx("span", { className: "review-summary-stat-count", children: summary.pendingReview }), " pending"] }), summary.accepted > 0 && (_jsxs("div", { className: "review-summary-stat", children: [_jsx("span", { className: "review-summary-stat-count", children: summary.accepted }), " accepted"] })), summary.denied > 0 && (_jsxs("div", { className: "review-summary-stat", children: [_jsx("span", { className: "review-summary-stat-count", children: summary.denied }), " denied"] })), summary.deferred > 0 && (_jsxs("div", { className: "review-summary-stat", children: [_jsx("span", { className: "review-summary-stat-count", children: summary.deferred }), " deferred"] }))] }));
}
function QueueItem({ item, isActive, onClick, }) {
    const decided = item.reviewStatus !== ProposalReviewStatus.PENDING_REVIEW;
    return (_jsxs("div", { className: [
            'review-queue-item',
            isActive && 'review-queue-item--active',
            decided && 'review-queue-item--decided',
        ]
            .filter(Boolean)
            .join(' '), onClick: onClick, children: [_jsxs("div", { className: "review-queue-item-header", children: [_jsx(Badge, { variant: ACTION_VARIANT[item.action] ?? 'neutral', children: ACTION_LABEL[item.action] ?? item.action }), decided && (_jsx(Badge, { variant: STATUS_VARIANT[item.reviewStatus] ?? 'neutral', children: STATUS_LABEL[item.reviewStatus] ?? item.reviewStatus }))] }), _jsx("div", { className: "review-queue-item-title", children: item.articleLabel }), _jsxs("div", { className: "review-queue-item-meta", children: [item.confidenceScore != null && _jsxs("span", { children: [Math.round(item.confidenceScore * 100), "%"] }), item.relatedPbiCount > 0 && _jsxs("span", { children: [item.relatedPbiCount, " PBI", item.relatedPbiCount !== 1 ? 's' : ''] }), item.locale && _jsx("span", { children: item.locale })] })] }));
}
function PreviewPanel({ html }) {
    if (!html) {
        return (_jsx("div", { className: "html-preview", style: { textAlign: 'center', color: 'var(--color-text-muted)' }, children: "No content available" }));
    }
    return _jsx("div", { className: "html-preview", dangerouslySetInnerHTML: { __html: html } });
}
function SourceDiffPanel({ lines }) {
    if (!lines || lines.length === 0) {
        return (_jsx("div", { className: "diff-view", style: { padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)' }, children: "No diff data available" }));
    }
    return (_jsx("div", { className: "diff-view", children: lines.map((line, i) => (_jsxs("div", { className: `diff-line diff-line--${line.kind}`, children: [_jsx("div", { className: `diff-gutter diff-gutter--${line.kind}`, children: line.kind === 'removed'
                        ? line.lineNumberBefore ?? ''
                        : line.kind === 'added'
                            ? line.lineNumberAfter ?? ''
                            : line.lineNumberBefore ?? '' }), _jsxs("div", { className: "diff-content", children: [line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : '  ', line.content] })] }, i))) }));
}
function SourcePanel({ html }) {
    return _jsx("pre", { className: "source-view", children: html || 'No source HTML' });
}
function ChangeRegionsPanel({ regions }) {
    if (!regions || regions.length === 0) {
        return (_jsx("div", { style: { padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }, children: "No change regions" }));
    }
    return (_jsx("div", { className: "change-regions", children: regions.map((region) => (_jsxs("div", { className: `change-region change-region--${region.kind}`, children: [_jsxs("div", { className: "change-region-label", children: [_jsx(Badge, { variant: region.kind === 'added' ? 'success' : region.kind === 'removed' ? 'danger' : 'warning', children: region.kind }), region.label] }), region.beforeText && region.kind !== 'added' && (_jsx("div", { className: "change-region-text", style: { textDecoration: region.kind === 'removed' ? 'line-through' : undefined }, children: region.beforeText })), region.afterText && region.kind !== 'removed' && (_jsx("div", { className: "change-region-text", children: region.afterText }))] }, region.id))) }));
}
function ConfidenceCard({ score }) {
    return (_jsxs("div", { className: "card card-padded", children: [_jsx("div", { className: "review-section-label", children: "Confidence" }), _jsxs("div", { className: "confidence-bar", children: [_jsx("div", { className: "progress-bar", style: { flex: 1 }, children: _jsx("div", { className: "progress-bar-fill", style: { width: `${(score ?? 0) * 100}%` } }) }), _jsx("span", { className: `confidence-value ${confidenceClass(score)}`, children: formatConfidence(score) })] })] }));
}
function AISummaryCard({ rationaleSummary, aiNotes, }) {
    if (!rationaleSummary && !aiNotes)
        return null;
    return (_jsxs("div", { className: "card card-padded", children: [_jsx("div", { className: "review-section-label", children: "AI Summary" }), _jsxs("div", { className: "review-scroll-card-body", children: [rationaleSummary && (_jsx("p", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text)', lineHeight: 'var(--leading-normal)', margin: 0 }, children: rationaleSummary })), aiNotes && (_jsx("p", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', lineHeight: 'var(--leading-normal)', marginTop: 'var(--space-2)' }, children: aiNotes }))] })] }));
}
function PBIEvidenceCard({ pbis, onSelectPBI, }) {
    return (_jsxs("div", { className: "card card-padded", children: [_jsxs("div", { className: "review-section-label", children: ["Triggering PBIs (", pbis.length, ")"] }), _jsx("div", { className: "review-scroll-card-body", children: pbis.length === 0 ? (_jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }, children: "No linked PBIs" })) : (_jsx("div", { className: "pbi-evidence-list", children: pbis.map((pbi) => (_jsxs("button", { type: "button", className: "pbi-evidence-item", onClick: () => onSelectPBI(pbi), "aria-label": `Open details for PBI ${pbi.externalId ?? pbi.id}`, children: [_jsx("div", { className: "pbi-evidence-item-id", children: pbi.externalId ?? pbi.id }), _jsx("div", { className: "pbi-evidence-item-title", children: pbi.title })] }, pbi.id))) })) })] }));
}
function PlacementCard({ placement }) {
    if (!placement)
        return null;
    const hasContent = placement.categoryId || placement.sectionId || placement.articleTitle || placement.notes;
    if (!hasContent)
        return null;
    return (_jsxs("div", { className: "card card-padded", children: [_jsxs("div", { className: "review-section-label", children: [_jsx(IconMapPin, { size: 12 }), " Suggested Placement"] }), _jsxs("div", { className: "placement-info", children: [placement.articleTitle && (_jsxs("div", { className: "placement-info-row", children: [_jsx("span", { className: "placement-info-label", children: "Title" }), _jsx("span", { children: placement.articleTitle })] })), placement.sectionId && (_jsxs("div", { className: "placement-info-row", children: [_jsx("span", { className: "placement-info-label", children: "Section" }), _jsx("span", { children: placement.sectionId })] })), placement.categoryId && (_jsxs("div", { className: "placement-info-row", children: [_jsx("span", { className: "placement-info-label", children: "Category" }), _jsx("span", { children: placement.categoryId })] })), placement.notes && (_jsxs("div", { className: "placement-info-row", children: [_jsx("span", { className: "placement-info-label", children: "Notes" }), _jsx("span", { children: placement.notes })] }))] })] }));
}
function ProposalBatchRow({ batch, onOpen, onDelete, }) {
    const reviewedCount = batch.proposalCount - batch.pendingReviewCount;
    const progress = batch.proposalCount > 0 ? (reviewedCount / batch.proposalCount) * 100 : 0;
    const openCellProps = {
        className: 'proposal-batch-open-cell',
        onClick: onOpen,
        onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen();
            }
        },
        role: 'button',
        tabIndex: 0,
    };
    return (_jsxs("tr", { className: "proposal-batch-table-row", children: [_jsxs("td", { ...openCellProps, style: { fontWeight: 'var(--weight-medium)' }, children: [_jsx("div", { children: batch.batchName }), _jsx("div", { className: "proposal-batch-secondary", children: batch.sourceFileName })] }), _jsx("td", { ...openCellProps, style: { color: 'var(--color-text-secondary)' }, children: formatDate(batch.importedAtUtc) }), _jsx("td", { ...openCellProps, children: batch.proposalCount }), _jsx("td", { ...openCellProps, children: _jsxs("div", { className: "proposal-batch-progress", children: [_jsxs("span", { children: [reviewedCount, " / ", batch.proposalCount] }), _jsx("div", { className: "progress-bar proposal-batch-progress-bar", children: _jsx("div", { className: "progress-bar-fill", style: { width: `${progress}%` } }) })] }) }), _jsx("td", { ...openCellProps, children: batch.pendingReviewCount > 0 ? (_jsxs("span", { children: [batch.pendingReviewCount, " pending"] })) : (_jsx("span", { className: "proposal-batch-empty-note", children: "All reviewed" })) }), _jsx("td", { ...openCellProps, children: _jsx(Badge, { variant: batchStatusVariant(batch.batchStatus), children: BATCH_STATUS_LABEL[batch.batchStatus] ?? batch.batchStatus }) }), _jsx("td", { className: "proposal-batch-actions-cell", onClick: (event) => event.stopPropagation(), onMouseDown: (event) => event.stopPropagation(), children: _jsxs("div", { className: "proposal-batch-actions", children: [_jsx("button", { type: "button", className: "btn btn-primary btn-xs", onClick: (event) => {
                                event.stopPropagation();
                                onOpen();
                            }, children: batch.pendingReviewCount > 0 ? 'Review' : 'Open' }), _jsx("button", { type: "button", className: "proposal-batch-delete", title: "Delete proposal set", "aria-label": "Delete proposal set", onMouseDown: (event) => {
                                event.stopPropagation();
                            }, onClick: (event) => {
                                event.stopPropagation();
                                onDelete(batch);
                            }, children: _jsx(IconTrash2, { size: 14 }) })] }) })] }));
}
export const ProposalReview = () => {
    const { activeWorkspace } = useWorkspace();
    const batchListIpc = useIpc('proposal.review.batchList');
    const listIpc = useIpc('proposal.review.list');
    const detailIpc = useIpc('proposal.review.get');
    const decideMutation = useIpcMutation('proposal.review.decide');
    const { execute: executeBatchList, reset: resetBatchList } = batchListIpc;
    const { execute: executeList, reset: resetList } = listIpc;
    const { execute: executeDetail, reset: resetDetail } = detailIpc;
    const { mutate: mutateDecision } = decideMutation;
    const [selectedBatchId, setSelectedBatchId] = useState(null);
    const [selectedProposalId, setSelectedProposalId] = useState(null);
    const [activeTab, setActiveTab] = useState('preview');
    const [decidingAs, setDecidingAs] = useState(null);
    const [selectedPBI, setSelectedPBI] = useState(null);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleteError, setDeleteError] = useState(null);
    const [deletingBatchId, setDeletingBatchId] = useState(null);
    const [proposalWorkingCopy, setProposalWorkingCopy] = useState(null);
    const containerRef = useRef(null);
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
        if (!activeWorkspace)
            return;
        await executeBatchList({ workspaceId: activeWorkspace.id });
    }, [activeWorkspace?.id, executeBatchList]);
    const openBatch = useCallback((batchId) => {
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
        if (!activeWorkspace)
            return;
        setSelectedBatchId(null);
        setSelectedProposalId(null);
        setSelectedPBI(null);
        setActiveTab('preview');
        resetBatchList();
        resetList();
        resetDetail();
        void loadBatchSummaries();
    }, [activeWorkspace?.id, resetBatchList, resetList, resetDetail, loadBatchSummaries]);
    useEffect(() => {
        if (!activeWorkspace)
            return;
        const targetProposalId = window.sessionStorage.getItem(PROPOSAL_REVIEW_TARGET_KEY);
        if (!targetProposalId)
            return;
        window.sessionStorage.removeItem(PROPOSAL_REVIEW_TARGET_KEY);
        setSelectedProposalId(targetProposalId);
        setSelectedPBI(null);
        setActiveTab('preview');
    }, [activeWorkspace?.id]);
    useEffect(() => {
        if (!activeWorkspace || !selectedBatchId)
            return;
        void executeList({ workspaceId: activeWorkspace.id, batchId: selectedBatchId });
    }, [activeWorkspace?.id, selectedBatchId, executeList]);
    useEffect(() => {
        if (!activeWorkspace || !selectedProposalId)
            return;
        void executeDetail({ workspaceId: activeWorkspace.id, proposalId: selectedProposalId });
    }, [activeWorkspace?.id, selectedProposalId, executeDetail]);
    useEffect(() => {
        if (!detail?.batchId)
            return;
        if (selectedBatchId === detail.batchId)
            return;
        setSelectedBatchId(detail.batchId);
    }, [detail?.batchId, selectedBatchId]);
    useEffect(() => {
        setSelectedPBI(null);
    }, [selectedProposalId]);
    useEffect(() => {
        setProposalWorkingCopy(null);
    }, [detail?.proposal.id, detail?.diff?.afterHtml]);
    useEffect(() => {
        if (queue.length === 0 || selectedProposalId)
            return;
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
        if (!activeWorkspace || !selectedBatchId)
            return;
        await Promise.all([
            executeList({ workspaceId: activeWorkspace.id, batchId: selectedBatchId }),
            loadBatchSummaries(),
        ]);
    }, [activeWorkspace?.id, selectedBatchId, executeList, loadBatchSummaries]);
    const handleDecision = useCallback(async (decision) => {
        if (!activeWorkspace || !selectedProposalId)
            return;
        setDecidingAs(decision);
        try {
            const result = await mutateDecision({
                workspaceId: activeWorkspace.id,
                proposalId: selectedProposalId,
                decision,
            });
            if (!result)
                return;
            await refreshCurrentBatch();
            if (navigation?.nextProposalId) {
                setSelectedProposalId(navigation.nextProposalId);
            }
            else {
                await executeDetail({ workspaceId: activeWorkspace.id, proposalId: selectedProposalId });
            }
        }
        finally {
            setDecidingAs(null);
        }
    }, [activeWorkspace?.id, selectedProposalId, mutateDecision, refreshCurrentBatch, navigation?.nextProposalId, executeDetail]);
    const handleDelete = useCallback(async () => {
        if (!activeWorkspace || !deleteTarget)
            return;
        setDeletingBatchId(deleteTarget.batchId);
        setDeleteError(null);
        try {
            const payload = {
                workspaceId: activeWorkspace.id,
                batchId: deleteTarget.batchId
            };
            const response = await window.kbv.invoke('pbiBatch.delete', payload);
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
        }
        catch (error) {
            setDeleteError(error instanceof Error ? error.message : 'Failed to delete proposal set');
        }
        finally {
            setDeletingBatchId(null);
        }
    }, [
        activeWorkspace,
        deleteTarget,
        loadBatchSummaries,
        resetDetail,
        resetList
    ]);
    useEffect(() => {
        const handler = (e) => {
            if (!selectedBatchId)
                return;
            if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)
                return;
            switch (e.key.toLowerCase()) {
                case 'a':
                    if (!e.metaKey && !e.ctrlKey)
                        void handleDecision(ProposalReviewDecision.ACCEPT);
                    break;
                case 'd':
                    if (!e.metaKey && !e.ctrlKey)
                        void handleDecision(ProposalReviewDecision.DENY);
                    break;
                case 'arrowdown':
                case 'j':
                    e.preventDefault();
                    navigateNext();
                    break;
                case 'arrowup':
                case 'k':
                    e.preventDefault();
                    navigatePrevious();
                    break;
                case '1':
                    setActiveTab('preview');
                    break;
                case '2':
                    setActiveTab('diff');
                    break;
                case '3':
                    setActiveTab('source');
                    break;
                case '4':
                    setActiveTab('regions');
                    break;
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [selectedBatchId, handleDecision, navigateNext, navigatePrevious]);
    const isEditProposal = proposal?.action === ProposalAction.EDIT;
    const workingHtml = proposalWorkingCopy?.html ?? persistedDiff?.afterHtml ?? '';
    const diff = useMemo(() => {
        if (!persistedDiff)
            return persistedDiff;
        if (!proposalWorkingCopy?.html)
            return persistedDiff;
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
                versionToken: proposal ? `${proposal.id}:${proposal.updatedAtUtc}` : 'proposal',
                payload: {
                    html: workingHtml,
                    title: proposalWorkingCopy?.title ?? proposal?.targetTitle,
                    rationaleSummary: proposalWorkingCopy?.rationaleSummary ?? proposal?.rationaleSummary
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
                proposalId: proposal?.id,
                localeVariantId: proposal?.localeVariantId,
                sourceRevisionId: proposal?.sourceRevisionId,
                proposal
            }
        },
        applyUiActions: (actions) => {
            actions.forEach((action) => {
                if (action.type === 'replace_working_html' && action.target === 'proposal') {
                    setProposalWorkingCopy((prev) => ({
                        html: action.html,
                        title: prev?.title ?? proposal?.targetTitle,
                        rationale: prev?.rationale ?? proposal?.aiNotes,
                        rationaleSummary: prev?.rationaleSummary ?? proposal?.rationaleSummary
                    }));
                }
            });
        }
    });
    if (!activeWorkspace) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Proposal Review", subtitle: "No workspace selected" }), _jsx("div", { className: "route-content", children: _jsx(EmptyState, { icon: _jsx(IconCheckCircle, { size: 48 }), title: "No workspace open", description: "Open or create a workspace to review generated proposal batches." }) })] }));
    }
    if (!selectedBatchId) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Proposal Review", subtitle: "Browse generated proposal batches before opening the reviewer workbench" }), _jsx("div", { className: "route-content", children: batchListIpc.loading && !batchListIpc.data ? (_jsx(LoadingState, { message: "Loading proposal batches..." })) : batchListIpc.error && !batchListIpc.data ? (_jsx(ErrorState, { title: "Failed to load proposal batches", description: batchListIpc.error, action: _jsx("button", { className: "btn btn-primary", onClick: () => void loadBatchSummaries(), children: "Retry" }) })) : batchSummaries.length === 0 ? (_jsx(EmptyState, { icon: _jsx(IconCheckCircle, { size: 48 }), title: "No generated proposals yet", description: "Run analysis on a PBI batch to generate proposals that can be reviewed here." })) : (_jsx("div", { className: "table-wrapper", children: _jsxs("table", { className: "table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Proposal Set" }), _jsx("th", { children: "Imported" }), _jsx("th", { children: "Proposals" }), _jsx("th", { children: "Reviewed" }), _jsx("th", { children: "Pending" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Action" })] }) }), _jsx("tbody", { children: batchSummaries.map((batch) => (_jsx(ProposalBatchRow, { batch: batch, onOpen: () => openBatch(batch.batchId), onDelete: (batchItem) => {
                                            setDeleteTarget(batchItem);
                                            setDeleteError(null);
                                            setShowDeleteDialog(true);
                                        } }, batch.batchId))) })] }) })) })] }));
    }
    if (listIpc.loading && !listData) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Proposal Review", subtitle: selectedBatchSummary?.batchName ?? 'Loading proposal set', actions: _jsxs("button", { className: "btn btn-ghost proposal-review-back-btn", onClick: closeBatch, children: [_jsx(IconChevronLeft, { size: 14 }), "Back to Proposal Sets"] }) }), _jsx("div", { className: "route-content", children: _jsx(LoadingState, { message: "Loading proposals..." }) })] }));
    }
    if (listIpc.error && !listData) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Proposal Review", subtitle: selectedBatchSummary?.batchName ?? 'Proposal set', actions: _jsxs("button", { className: "btn btn-ghost proposal-review-back-btn", onClick: closeBatch, children: [_jsx(IconChevronLeft, { size: 14 }), "Back to Proposal Sets"] }) }), _jsx("div", { className: "route-content", children: _jsx(ErrorState, { title: "Failed to load proposals", description: listIpc.error, action: _jsx("button", { className: "btn btn-secondary", onClick: () => activeWorkspace && void listIpc.execute({ workspaceId: activeWorkspace.id, batchId: selectedBatchId }), children: "Retry" }) }) })] }));
    }
    if (!listData || queue.length === 0) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Proposal Review", subtitle: selectedBatchSummary?.batchName ?? 'Proposal set', actions: _jsxs("button", { className: "btn btn-ghost proposal-review-back-btn", onClick: closeBatch, children: [_jsx(IconChevronLeft, { size: 14 }), "Back to Proposal Sets"] }) }), _jsx("div", { className: "route-content", children: _jsx(EmptyState, { icon: _jsx(IconCheckCircle, { size: 48 }), title: "No proposals in this batch", description: "This proposal set does not currently contain any reviewable proposals." }) })] }));
    }
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Proposal Review", subtitle: selectedBatchSummary?.batchName ?? `${summary?.total ?? queue.length} proposals`, actions: _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }, children: [_jsxs("button", { className: "btn btn-ghost proposal-review-back-btn", onClick: closeBatch, children: [_jsx(IconChevronLeft, { size: 14 }), "Back to Proposal Sets"] }), summary && (_jsxs(_Fragment, { children: [_jsxs("span", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }, children: [summary.total - summary.pendingReview, " / ", summary.total, " reviewed"] }), _jsx("div", { className: "progress-bar", style: { width: 120 }, children: _jsx("div", { className: "progress-bar-fill", style: {
                                            width: `${((summary.total - summary.pendingReview) / Math.max(summary.total, 1)) * 100}%`,
                                        } }) })] }))] }) }), _jsx("div", { className: "route-content", ref: containerRef, children: _jsxs("div", { className: "review-layout", children: [_jsxs("div", { className: "card review-queue", children: [_jsx("div", { className: "card-header", children: _jsx("span", { className: "card-header-title", children: "Proposals" }) }), summary && _jsx(SummaryBar, { summary: summary }), _jsx("div", { className: "review-queue-list", children: groups.length > 0
                                        ? groups.map((group) => (_jsxs("div", { children: [_jsxs("div", { className: "review-queue-group", children: [group.articleLabel, _jsxs("span", { style: { fontWeight: 'var(--weight-normal)', marginLeft: 'var(--space-1)' }, children: ["(", group.total, ")"] })] }), queue
                                                    .filter((item) => group.proposalIds.includes(item.proposalId))
                                                    .map((item) => (_jsx(QueueItem, { item: item, isActive: item.proposalId === selectedProposalId, onClick: () => setSelectedProposalId(item.proposalId) }, item.proposalId)))] }, group.articleKey)))
                                        : queue.map((item) => (_jsx(QueueItem, { item: item, isActive: item.proposalId === selectedProposalId, onClick: () => setSelectedProposalId(item.proposalId) }, item.proposalId))) })] }), _jsx("div", { className: "card review-center", children: detailIpc.loading && !detail ? (_jsx(LoadingState, { message: "Loading proposal..." })) : detailIpc.error && !detail ? (_jsx(ErrorState, { title: "Failed to load proposal", description: detailIpc.error })) : !proposal ? (_jsx(EmptyState, { title: "Select a proposal", description: "Choose a proposal from the queue to review." })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "review-center-header", children: [_jsxs("div", { className: "review-center-title", children: [_jsx(Badge, { variant: ACTION_VARIANT[proposal.action] ?? 'neutral', children: ACTION_LABEL[proposal.action] ?? proposal.action }), _jsx("span", { className: "review-center-title-text", children: proposalWorkingCopy?.title || proposal.targetTitle || selectedQueueItem?.articleLabel || 'Proposal' }), proposal.reviewStatus !== ProposalReviewStatus.PENDING_REVIEW && (_jsx(Badge, { variant: STATUS_VARIANT[proposal.reviewStatus] ?? 'neutral', children: STATUS_LABEL[proposal.reviewStatus] ?? proposal.reviewStatus }))] }), navigation && (_jsxs("div", { className: "review-center-nav", children: [_jsx("button", { className: "review-center-nav-btn", disabled: !navigation.previousProposalId, onClick: navigatePrevious, title: "Previous (K / Up)", children: _jsx(IconChevronLeft, { size: 16 }) }), _jsxs("span", { className: "review-center-nav-pos", children: [navigation.currentIndex + 1, " / ", navigation.total] }), _jsx("button", { className: "review-center-nav-btn", disabled: !navigation.nextProposalId, onClick: navigateNext, title: "Next (J / Down)", children: _jsx(IconChevronRight, { size: 16 }) })] }))] }), _jsxs("div", { className: "review-tab-bar", children: [_jsxs("div", { className: `review-tab ${activeTab === 'preview' ? 'review-tab--active' : ''}`, onClick: () => setActiveTab('preview'), children: [_jsx("span", { className: "review-tab-icon", children: _jsx(IconEye, { size: 14 }) }), "Preview"] }), (isEditProposal || hasDiff) && (_jsxs("div", { className: `review-tab ${activeTab === 'diff' ? 'review-tab--active' : ''}`, onClick: () => setActiveTab('diff'), children: [_jsx("span", { className: "review-tab-icon", children: _jsx(IconFileText, { size: 14 }) }), "Diff"] })), _jsxs("div", { className: `review-tab ${activeTab === 'source' ? 'review-tab--active' : ''}`, onClick: () => setActiveTab('source'), children: [_jsx("span", { className: "review-tab-icon", children: _jsx(IconCode, { size: 14 }) }), "Source"] }), diff?.changeRegions && diff.changeRegions.length > 0 && (_jsxs("div", { className: `review-tab ${activeTab === 'regions' ? 'review-tab--active' : ''}`, onClick: () => setActiveTab('regions'), children: ["Changes (", diff.changeRegions.length, ")"] }))] }), _jsxs("div", { className: "review-content-body", children: [activeTab === 'preview' && (_jsx(PreviewPanel, { html: workingHtml })), activeTab === 'diff' && diff && _jsx(SourceDiffPanel, { lines: diff.sourceDiff?.lines ?? [] }), activeTab === 'source' && _jsx(SourcePanel, { html: workingHtml }), activeTab === 'regions' && diff && _jsx(ChangeRegionsPanel, { regions: diff.changeRegions ?? [] })] })] })) }), _jsxs("div", { className: "review-right", children: [proposal && (_jsxs(_Fragment, { children: [_jsx(ConfidenceCard, { score: proposal.confidenceScore }), _jsx(AISummaryCard, { rationaleSummary: proposalWorkingCopy?.rationaleSummary ?? proposal.rationaleSummary, aiNotes: proposalWorkingCopy?.rationale ?? proposal.aiNotes }), _jsx(PBIEvidenceCard, { pbis: relatedPbis, onSelectPBI: setSelectedPBI }), _jsx(PlacementCard, { placement: proposal.suggestedPlacement }), _jsx("div", { className: "review-actions", children: proposal.reviewStatus === ProposalReviewStatus.PENDING_REVIEW ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "review-actions-row", children: [_jsx("button", { className: "btn btn-primary review-actions-accept", onClick: () => void handleDecision(ProposalReviewDecision.ACCEPT), disabled: !!decidingAs, children: decidingAs === ProposalReviewDecision.ACCEPT ? 'Accepting...' : 'Accept' }), _jsx("button", { className: "btn btn-danger", onClick: () => void handleDecision(ProposalReviewDecision.DENY), disabled: !!decidingAs, children: decidingAs === ProposalReviewDecision.DENY ? 'Denying...' : 'Deny' })] }), isEditProposal && (_jsxs("button", { className: "btn btn-ghost", style: { width: '100%' }, onClick: () => void handleDecision(ProposalReviewDecision.APPLY_TO_BRANCH), disabled: !!decidingAs, children: [_jsx("span", { className: "review-action-icon", children: _jsx(IconGitBranch, { size: 14 }) }), "Apply to Branch"] })), proposal.action === ProposalAction.NO_IMPACT && (_jsxs("button", { className: "btn btn-ghost", style: { width: '100%' }, onClick: () => void handleDecision(ProposalReviewDecision.ARCHIVE), disabled: !!decidingAs, children: [_jsx("span", { className: "review-action-icon", children: _jsx(IconArchive, { size: 14 }) }), "Archive"] })), _jsxs("div", { className: "review-keyboard-hints", children: [_jsxs("span", { className: "review-keyboard-hint", children: [_jsx(Kbd, { keys: "A" }), " accept"] }), _jsxs("span", { className: "review-keyboard-hint", children: [_jsx(Kbd, { keys: "D" }), " deny"] }), _jsxs("span", { className: "review-keyboard-hint", children: [_jsx(Kbd, { keys: "J" }), " next"] }), _jsxs("span", { className: "review-keyboard-hint", children: [_jsx(Kbd, { keys: "K" }), " prev"] })] })] })) : (_jsxs("div", { style: { textAlign: 'center', padding: 'var(--space-3)' }, children: [_jsx(Badge, { variant: STATUS_VARIANT[proposal.reviewStatus] ?? 'neutral', children: STATUS_LABEL[proposal.reviewStatus] ?? proposal.reviewStatus }), proposal.decidedAtUtc && (_jsxs("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }, children: ["Decided ", new Date(proposal.decidedAtUtc).toLocaleString()] }))] })) })] })), allReviewed && !proposal && (_jsxs("div", { className: "card card-padded", style: { textAlign: 'center' }, children: [_jsx(IconCheckCircle, { size: 32, className: "text-success" }), _jsx("h3", { style: { margin: 'var(--space-2) 0', fontSize: 'var(--text-base)' }, children: "All Reviewed" }), _jsxs("p", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }, children: [summary?.accepted, " accepted, ", summary?.denied, " denied, ", summary?.deferred, " deferred"] })] }))] })] }) }), _jsx(PBIDetailModal, { pbi: selectedPBI, open: selectedPBI != null, onClose: () => setSelectedPBI(null) }), _jsx(ConfirmationDialog, { open: showDeleteDialog, title: "Delete Proposal", message: _jsxs(_Fragment, { children: [_jsxs("p", { children: ["Are you sure you want to delete ", _jsx("strong", { children: deleteTarget?.batchName || 'this proposal set' }), "?"] }), _jsx("p", { children: "This will permanently remove the proposal set, its proposals, and the imported PBI rows tied to that batch." }), deleteError && _jsx("p", { className: "confirmation-dialog__error", children: deleteError })] }), confirmText: deletingBatchId ? 'Deleting...' : 'Delete Proposal Set', variant: "danger", isProcessing: Boolean(deletingBatchId), onClose: () => {
                    if (deletingBatchId)
                        return;
                    setShowDeleteDialog(false);
                    setDeleteTarget(null);
                    setDeleteError(null);
                }, onConfirm: handleDelete })] }));
};
