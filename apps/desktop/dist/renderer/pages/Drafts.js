import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState, useCallback, useRef } from 'react';
import { DraftBranchStatus, DraftValidationSeverity, DraftCommitSource, AppRoute, ArticleAiPresetAction, } from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { IconGitBranch, IconAlertCircle, IconCheckCircle, IconEye, IconCode, IconColumns, IconCornerUpLeft, IconCornerUpRight, IconSave, IconSend, IconTrash2, IconFilter, IconClock, IconZap, IconRefreshCw, } from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc, useIpcMutation } from '../hooks/useIpc';
import { useRegisterAiAssistantView } from '../components/assistant/AssistantContext';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function statusTone(status) {
    switch (status) {
        case DraftBranchStatus.READY_TO_PUBLISH: return 'success';
        case DraftBranchStatus.CONFLICTED: return 'danger';
        case DraftBranchStatus.OBSOLETE:
        case DraftBranchStatus.DISCARDED: return 'warning';
        case DraftBranchStatus.PUBLISHED: return 'neutral';
        default: return 'primary';
    }
}
function statusChipProps(status) {
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
function validationIcon(w) {
    const color = w.severity === DraftValidationSeverity.ERROR
        ? 'var(--color-danger)'
        : w.severity === DraftValidationSeverity.WARNING
            ? 'var(--color-warning)'
            : 'var(--color-info)';
    return _jsx(IconAlertCircle, { size: 12, style: { color } });
}
function commitSourceLabel(source) {
    switch (source) {
        case DraftCommitSource.PROPOSAL: return 'proposal';
        case DraftCommitSource.MANUAL: return 'manual';
        case DraftCommitSource.AUTOSAVE: return 'autosave';
        case DraftCommitSource.SYSTEM: return 'system';
        default: return source;
    }
}
function commitSourceVariant(source) {
    switch (source) {
        case DraftCommitSource.PROPOSAL: return 'primary';
        case DraftCommitSource.MANUAL: return 'success';
        case DraftCommitSource.AUTOSAVE: return 'warning';
        default: return 'neutral';
    }
}
function validationSummaryClass(branch) {
    if (branch.validationSummary.errors > 0)
        return 'has-errors';
    if (branch.validationSummary.warnings > 0)
        return 'has-warnings';
    return 'clean';
}
function validationSummaryText(branch) {
    const { errors, warnings, infos } = branch.validationSummary;
    if (errors + warnings + infos === 0)
        return 'Clean';
    const parts = [];
    if (errors)
        parts.push(`${errors}E`);
    if (warnings)
        parts.push(`${warnings}W`);
    if (infos)
        parts.push(`${infos}I`);
    return parts.join('/');
}
function filterBranches(branches, filter) {
    switch (filter) {
        case 'active': return branches.filter(b => b.status === DraftBranchStatus.ACTIVE);
        case 'ready': return branches.filter(b => b.status === DraftBranchStatus.READY_TO_PUBLISH);
        case 'conflicted': return branches.filter(b => b.status === DraftBranchStatus.CONFLICTED);
        default: return branches;
    }
}
function relativeTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1)
        return 'just now';
    if (mins < 60)
        return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24)
        return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
function presetLabel(action) {
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
function BranchRail({ branches, summary, filter, selectedId, onSelectBranch, onFilterChange, }) {
    const filtered = filterBranches(branches, filter);
    return (_jsxs("div", { className: "draft-rail", children: [_jsxs("div", { className: "draft-rail-header", children: [_jsxs("div", { children: [_jsx("div", { className: "draft-rail-title", children: "Branches" }), _jsxs("div", { className: "draft-rail-meta", children: [summary.active, " active", summary.conflicted > 0 ? `, ${summary.conflicted} conflicted` : ''] })] }), _jsx(Badge, { variant: "neutral", children: summary.total })] }), _jsx("div", { className: "draft-rail-filter", children: ['all', 'active', 'ready', 'conflicted'].map(f => (_jsx("button", { type: "button", className: `draft-rail-filter-btn${filter === f ? ' active' : ''}`, onClick: () => onFilterChange(f), children: f === 'all' ? 'All' : f === 'active' ? 'Active' : f === 'ready' ? 'Ready' : 'Conflict' }, f))) }), _jsx("div", { className: "draft-rail-list", children: filtered.length === 0 ? (_jsx("div", { style: { padding: 'var(--space-5)' }, children: _jsx(EmptyState, { icon: _jsx(IconFilter, { size: 32 }), title: filter === 'all' ? 'No draft branches' : `No ${filter} branches`, description: filter === 'all'
                            ? 'Accept a proposal or create a branch from an article to start editing.'
                            : 'Try a different filter to find branches.' }) })) : (filtered.map(branch => (_jsxs("button", { type: "button", className: `draft-rail-item${branch.id === selectedId ? ' selected' : ''}`, onClick: () => onSelectBranch(branch.id), children: [_jsx("div", { className: "draft-rail-item-title", children: branch.familyTitle }), _jsx("div", { className: "draft-rail-item-branch", children: branch.name }), _jsxs("div", { className: "draft-rail-item-footer", children: [_jsx(StatusChip, { ...statusChipProps(branch.status) }), _jsxs("div", { className: "draft-rail-item-rev", children: ["r", branch.headRevisionNumber] }), _jsxs("div", { className: `draft-rail-item-validation ${validationSummaryClass(branch)}`, children: [branch.validationSummary.errors > 0
                                            ? _jsx(IconAlertCircle, { size: 11 })
                                            : _jsx(IconCheckCircle, { size: 11 }), validationSummaryText(branch)] })] })] }, branch.id)))) })] }));
}
function ValidationPanel({ warnings }) {
    if (warnings.length === 0) {
        return (_jsxs("div", { className: "draft-validation-ok", children: [_jsx(IconCheckCircle, { size: 14 }), "No validation issues"] }));
    }
    return (_jsx(_Fragment, { children: warnings.map((w, i) => (_jsxs("div", { className: "draft-validation-item", children: [_jsxs("div", { className: "draft-validation-item-header", children: [validationIcon(w), _jsx("span", { className: "draft-validation-item-code", children: w.code.replace(/_/g, ' ') }), _jsx(Badge, { variant: w.severity === 'error' ? 'danger' : w.severity === 'warning' ? 'warning' : 'primary', children: w.severity })] }), _jsx("div", { className: "draft-validation-item-msg", children: w.message }), w.line != null && (_jsxs("div", { className: "draft-validation-item-line", children: ["line ", w.line] }))] }, `${w.code}-${i}`))) }));
}
function HistoryPanel({ entries }) {
    if (entries.length === 0) {
        return _jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }, children: "No revision history." });
    }
    return (_jsx(_Fragment, { children: entries.map(entry => (_jsxs("div", { className: `draft-history-item${entry.isCurrent ? ' current' : ''}`, children: [_jsxs("span", { className: "draft-history-rev", children: ["r", entry.revisionNumber] }), _jsxs("div", { className: "draft-history-body", children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-1)', marginBottom: '1px' }, children: [_jsx(Badge, { variant: commitSourceVariant(entry.source), children: commitSourceLabel(entry.source) }), entry.isCurrent && _jsx(Badge, { variant: "primary", children: "current" })] }), _jsx("div", { className: "draft-history-summary", children: entry.summary || 'No commit note' }), _jsx("div", { className: "draft-history-time", children: relativeTime(entry.updatedAtUtc) })] })] }, entry.revisionId))) }));
}
function ChangeRegionsPanel({ regions }) {
    if (regions.length === 0) {
        return _jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }, children: "Identical to live revision." });
    }
    return (_jsx(_Fragment, { children: regions.map((region, i) => (_jsxs("div", { className: "draft-region-item", children: [_jsx("span", { className: `draft-region-kind ${region.kind === 'added' ? 'added' : region.kind === 'removed' ? 'removed' : 'changed'}` }), _jsx("span", { className: "draft-region-label", children: region.label })] }, i))) }));
}
function ArticleAiPanel({ session, prompt, onPromptChange, selectedTemplateId, onTemplateChange, onPreset, onSubmit, onReset, onAccept, onReject, loading, templates, }) {
    const transcriptRef = useRef(null);
    const isRunning = session?.session.status === 'running';
    const hasPending = !!session?.pendingEdit;
    // Auto-scroll transcript to bottom when messages change
    useEffect(() => {
        if (transcriptRef.current) {
            transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
        }
    }, [session?.messages.length]);
    return (_jsxs("div", { className: "draft-sidebar-section", children: [_jsxs("div", { className: "draft-sidebar-section-title", children: [_jsxs("span", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }, children: [_jsx(IconZap, { size: 12 }), " Article AI"] }), session && (_jsxs("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: onReset, disabled: loading, title: "Clear chat history and start fresh", children: [_jsx(IconRefreshCw, { size: 12 }), " Reset"] }))] }), !session ? (_jsx("div", { className: "article-ai-empty-hint", children: "Select a draft branch to open an AI chat session. Chat history persists until you reset it." })) : (_jsxs("div", { className: "article-ai-panel", children: [hasPending && (_jsxs("div", { className: "article-ai-pending", children: [_jsxs("div", { className: "article-ai-pending-header", children: [_jsx(IconZap, { size: 12, style: { color: 'var(--color-primary)' } }), _jsx("span", { className: "article-ai-pending-label", children: "Pending AI edit" })] }), _jsx("div", { className: "article-ai-pending-summary", children: session.pendingEdit.summary }), session.pendingEdit.rationale && (_jsx("div", { className: "article-ai-pending-diff-hint", children: session.pendingEdit.rationale })), _jsxs("div", { className: "article-ai-pending-actions", children: [_jsxs("button", { type: "button", className: "btn btn-primary btn-sm", onClick: onAccept, disabled: loading, children: [_jsx(IconCheckCircle, { size: 12 }), " Accept into draft"] }), _jsx("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: onReject, disabled: loading, children: "Reject" })] })] })), isRunning && (_jsxs("div", { className: "article-ai-running", children: [_jsx("span", { className: "article-ai-running-dot" }), "AI is processing your request..."] })), _jsx("div", { className: "article-ai-transcript", ref: transcriptRef, children: session.messages.length === 0 ? (_jsx("div", { className: "article-ai-empty-hint", children: "Use a quick action or type a request below. Chat history stays with this article until you reset it." })) : (session.messages.map((message) => (_jsxs("div", { className: `article-ai-msg ${message.role}`, children: [_jsxs("div", { className: "article-ai-msg-header", children: [_jsx("span", { className: `article-ai-msg-role ${message.role}`, children: message.role === 'assistant' ? 'AI' : message.role }), _jsx("span", { className: "article-ai-msg-time", children: relativeTime(message.createdAtUtc) })] }), message.presetAction && message.presetAction !== ArticleAiPresetAction.FREEFORM && (_jsx("div", { style: { marginBottom: 4 }, children: _jsx(Badge, { variant: "primary", children: presetLabel(message.presetAction) }) })), _jsx("div", { children: message.content })] }, message.id)))) }), _jsx("div", { className: "article-ai-presets", children: session.presets.map((preset) => (_jsx("button", { type: "button", className: "article-ai-preset-chip", onClick: () => onPreset(preset.action), disabled: loading || hasPending, title: preset.description, children: presetLabel(preset.action) }, preset.action))) }), _jsx("div", { className: "article-ai-template-row", children: _jsxs("select", { className: "input article-ai-template-select", value: selectedTemplateId, onChange: (e) => onTemplateChange(e.target.value), disabled: loading, children: [_jsx("option", { value: "", children: "No template (use article context)" }), templates.map((template) => (_jsxs("option", { value: template.id, children: [template.name, " (", template.language, ")"] }, template.id)))] }) }), _jsx("div", { className: "article-ai-compose", children: _jsxs("div", { className: "article-ai-compose-row", children: [_jsx("textarea", { className: "article-ai-textarea", value: prompt, onChange: (e) => onPromptChange(e.target.value), placeholder: "Describe the change you want...", disabled: loading || hasPending, onKeyDown: (e) => {
                                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && prompt.trim()) {
                                            e.preventDefault();
                                            onSubmit();
                                        }
                                    } }), _jsx("button", { type: "button", className: "article-ai-send-btn", onClick: onSubmit, disabled: loading || !prompt.trim() || hasPending, title: "Submit (Cmd+Enter)", children: _jsx(IconSend, { size: 14 }) })] }) })] }))] }));
}
// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export const Drafts = () => {
    const { activeWorkspace } = useWorkspace();
    // Branch state
    const [selectedBranchId, setSelectedBranchId] = useState(null);
    const [branchFilter, setBranchFilter] = useState('all');
    // Editor state
    const [draftHtml, setDraftHtml] = useState('');
    const [originalHtml, setOriginalHtml] = useState('');
    const [tab, setTab] = useState('source');
    const [showDiscardDialog, setShowDiscardDialog] = useState(false);
    const editorRef = useRef(null);
    const hasUnsavedChanges = draftHtml !== originalHtml;
    // IPC
    const listQuery = useIpc('draft.branch.list');
    const detailQuery = useIpc('draft.branch.get');
    const saveMutation = useIpcMutation('draft.branch.save');
    const undoMutation = useIpcMutation('draft.branch.undo');
    const redoMutation = useIpcMutation('draft.branch.redo');
    const statusMutation = useIpcMutation('draft.branch.status.set');
    const discardMutation = useIpcMutation('draft.branch.discard');
    // ---------------------------------------------------------------------------
    // Data loading
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (!activeWorkspace)
            return;
        void listQuery.execute({ workspaceId: activeWorkspace.id });
    }, [activeWorkspace]);
    useEffect(() => {
        const firstBranchId = listQuery.data?.branches[0]?.id;
        if (!selectedBranchId && firstBranchId) {
            setSelectedBranchId(firstBranchId);
        }
    }, [listQuery.data, selectedBranchId]);
    useEffect(() => {
        if (!activeWorkspace || !selectedBranchId)
            return;
        void detailQuery.execute({ workspaceId: activeWorkspace.id, branchId: selectedBranchId });
    }, [activeWorkspace, selectedBranchId]);
    useEffect(() => {
        if (detailQuery.data) {
            setDraftHtml(detailQuery.data.editor.html);
            setOriginalHtml(detailQuery.data.editor.html);
        }
    }, [detailQuery.data]);
    // ---------------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------------
    const refresh = useCallback(async (branchId) => {
        if (!activeWorkspace)
            return;
        await listQuery.execute({ workspaceId: activeWorkspace.id });
        const nextBranchId = branchId ?? selectedBranchId;
        if (nextBranchId) {
            const detail = await detailQuery.execute({ workspaceId: activeWorkspace.id, branchId: nextBranchId });
            if (detail) {
                setDraftHtml(detail.editor.html);
                setOriginalHtml(detail.editor.html);
            }
        }
    }, [activeWorkspace, selectedBranchId]);
    const saveDraft = useCallback(async (autosave = false) => {
        if (!activeWorkspace || !selectedBranchId || !detailQuery.data)
            return;
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
    const applyDetail = useCallback(async (result) => {
        if (!result)
            return;
        setSelectedBranchId(result.branch.id);
        setDraftHtml(result.editor.html);
        setOriginalHtml(result.editor.html);
        await refresh(result.branch.id);
    }, [refresh]);
    const handleUndo = useCallback(async () => {
        if (!activeWorkspace || !selectedBranchId)
            return;
        const result = await undoMutation.mutate({ workspaceId: activeWorkspace.id, branchId: selectedBranchId });
        await applyDetail(result);
    }, [activeWorkspace, selectedBranchId, applyDetail]);
    const handleRedo = useCallback(async () => {
        if (!activeWorkspace || !selectedBranchId)
            return;
        const result = await redoMutation.mutate({ workspaceId: activeWorkspace.id, branchId: selectedBranchId });
        await applyDetail(result);
    }, [activeWorkspace, selectedBranchId, applyDetail]);
    const handleMarkReady = useCallback(async () => {
        if (!activeWorkspace || !selectedBranchId)
            return;
        const result = await statusMutation.mutate({
            workspaceId: activeWorkspace.id,
            branchId: selectedBranchId,
            status: DraftBranchStatus.READY_TO_PUBLISH,
        });
        await applyDetail(result);
    }, [activeWorkspace, selectedBranchId, applyDetail]);
    const handleDiscard = useCallback(async () => {
        if (!activeWorkspace || !selectedBranchId)
            return;
        const result = await discardMutation.mutate({ workspaceId: activeWorkspace.id, branchId: selectedBranchId });
        setShowDiscardDialog(false);
        if (result) {
            await applyDetail(result);
        }
    }, [activeWorkspace, selectedBranchId, applyDetail]);
    const handleRevertToActive = useCallback(async () => {
        if (!activeWorkspace || !selectedBranchId)
            return;
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
        if (!hasUnsavedChanges)
            return;
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
    const isObsoleteOrDiscarded = branchStatus === DraftBranchStatus.OBSOLETE || branchStatus === DraftBranchStatus.DISCARDED;
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
                versionToken: selected?.branch.headRevisionId ?? `draft:${selected?.branch.id ?? 'unknown'}`,
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
        applyUiActions: (actions) => {
            actions.forEach((action) => {
                if (action.type === 'replace_working_html' && action.target === 'draft') {
                    setDraftHtml(action.html);
                }
            });
        }
    });
    // ---------------------------------------------------------------------------
    // Render: guards
    // ---------------------------------------------------------------------------
    if (!activeWorkspace) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Drafts", subtitle: "Open a workspace to manage draft branches." }), _jsx("div", { className: "route-content", children: _jsx(EmptyState, { icon: _jsx(IconGitBranch, { size: 48 }), title: "No workspace selected", description: "Choose a workspace to load draft branches and editing history." }) })] }));
    }
    if (listQuery.loading && !listQuery.data) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Drafts", subtitle: "Loading draft branches" }), _jsx("div", { className: "route-content", children: _jsx(LoadingState, { message: "Pulling branch metadata, validation state, and editor context." }) })] }));
    }
    if (listQuery.error && !listQuery.data) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Drafts", subtitle: "Draft branch loading failed" }), _jsx("div", { className: "route-content", children: _jsx(ErrorState, { title: "Unable to load drafts", description: listQuery.error }) })] }));
    }
    // ---------------------------------------------------------------------------
    // Render: main
    // ---------------------------------------------------------------------------
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Drafts", subtitle: `${summary.total} branch${summary.total !== 1 ? 'es' : ''} in ${activeWorkspace.name}` }), _jsxs("div", { className: "draft-layout", style: { flex: 1, overflow: 'hidden' }, children: [_jsx(BranchRail, { branches: branches, summary: summary, filter: branchFilter, selectedId: selectedBranchId, onSelectBranch: setSelectedBranchId, onFilterChange: setBranchFilter }), _jsx("div", { className: "draft-editor-panel", children: !selectedBranchId ? (_jsx("div", { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: _jsx(EmptyState, { icon: _jsx(IconGitBranch, { size: 40 }), title: "Select a branch", description: "Choose a draft branch from the left to start editing." }) })) : detailQuery.loading && !selected ? (_jsx("div", { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: _jsx(LoadingState, { message: "Loading editor state..." }) })) : detailQuery.error && !selected ? (_jsx("div", { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: _jsx(ErrorState, { title: "Unable to load branch", description: detailQuery.error }) })) : selected ? (_jsxs(_Fragment, { children: [branchStatus === DraftBranchStatus.CONFLICTED && (_jsxs("div", { className: "draft-branch-banner danger", children: [_jsx(IconAlertCircle, { size: 16 }), _jsx("span", { className: "draft-branch-banner-text", children: "This branch has conflicts with the live revision. Resolve conflicts before publishing." })] })), branchStatus === DraftBranchStatus.OBSOLETE && (_jsxs("div", { className: "draft-branch-banner warning", children: [_jsx(IconAlertCircle, { size: 16 }), _jsx("span", { className: "draft-branch-banner-text", children: "This branch is obsolete. A newer branch has been published for this article." }), _jsx("button", { className: "btn btn-sm btn-secondary", onClick: () => void handleRevertToActive(), children: "Reactivate" })] })), branchStatus === DraftBranchStatus.DISCARDED && (_jsxs("div", { className: "draft-branch-banner warning", children: [_jsx(IconAlertCircle, { size: 16 }), _jsx("span", { className: "draft-branch-banner-text", children: "This branch has been discarded. Reactivate to continue editing." }), _jsx("button", { className: "btn btn-sm btn-secondary", onClick: () => void handleRevertToActive(), children: "Reactivate" })] })), _jsx("div", { className: "draft-editor-header", children: _jsxs("div", { className: "draft-editor-header-row", children: [_jsxs("div", { children: [_jsxs("div", { className: "draft-editor-title", children: [selected.branch.familyTitle, hasUnsavedChanges && _jsx("span", { className: "draft-unsaved-dot", title: "Unsaved changes" }), _jsx(StatusChip, { ...statusChipProps(selected.branch.status) })] }), _jsxs("div", { className: "draft-editor-breadcrumb", children: [_jsx("span", { children: selected.branch.name }), _jsx("span", { className: "draft-editor-breadcrumb-sep", children: "/" }), _jsxs("span", { children: ["base r", selected.branch.baseRevisionNumber ?? '—'] }), _jsx("span", { className: "draft-editor-breadcrumb-sep", children: "/" }), _jsxs("span", { children: ["head r", selected.branch.headRevisionNumber] }), selected.branch.locale && (_jsxs(_Fragment, { children: [_jsx("span", { className: "draft-editor-breadcrumb-sep", children: "/" }), _jsx(Badge, { variant: statusTone(selected.branch.status), children: selected.branch.locale })] }))] }), selected.branch.changeSummary && (_jsx("div", { className: "draft-editor-change-summary", children: selected.branch.changeSummary }))] }), _jsxs("div", { className: "draft-editor-actions", children: [_jsxs("button", { className: "btn btn-secondary btn-sm", onClick: () => void handleUndo(), disabled: !isEditable, title: "Undo (Cmd+Z)", children: [_jsx(IconCornerUpLeft, { size: 14 }), " Undo"] }), _jsxs("button", { className: "btn btn-secondary btn-sm", onClick: () => void handleRedo(), disabled: !isEditable, title: "Redo (Cmd+Shift+Z)", children: [_jsx(IconCornerUpRight, { size: 14 }), " Redo"] }), _jsx("div", { style: { width: '1px', height: '20px', background: 'var(--color-border)' } }), branchStatus === DraftBranchStatus.ACTIVE && (_jsxs("button", { className: "btn btn-secondary btn-sm", onClick: () => void handleMarkReady(), children: [_jsx(IconCheckCircle, { size: 14 }), " Mark Ready"] })), branchStatus === DraftBranchStatus.READY_TO_PUBLISH && (_jsx("button", { className: "btn btn-secondary btn-sm", onClick: () => void handleRevertToActive(), children: "Back to Active" })), isEditable && (_jsxs("button", { className: "btn btn-danger btn-sm", onClick: () => setShowDiscardDialog(true), children: [_jsx(IconTrash2, { size: 14 }), " Discard"] })), _jsxs("button", { className: "btn btn-primary btn-sm", onClick: () => void saveDraft(false), disabled: !isEditable || !hasUnsavedChanges, title: "Save (Cmd+S)", children: [_jsx(IconSave, { size: 14 }), " Save"] })] })] }) }), _jsxs("div", { className: "draft-toolbar", children: [_jsxs("div", { className: "draft-toolbar-tabs", children: [_jsxs("button", { type: "button", className: `draft-toolbar-tab${tab === 'source' ? ' active' : ''}`, onClick: () => setTab('source'), children: [_jsx(IconCode, { size: 13 }), " Source"] }), _jsxs("button", { type: "button", className: `draft-toolbar-tab${tab === 'preview' ? ' active' : ''}`, onClick: () => setTab('preview'), children: [_jsx(IconEye, { size: 13 }), " Preview"] }), _jsxs("button", { type: "button", className: `draft-toolbar-tab${tab === 'compare' ? ' active' : ''}`, onClick: () => setTab('compare'), children: [_jsx(IconColumns, { size: 13 }), " Compare"] })] }), _jsxs("div", { className: "draft-toolbar-meta", children: [_jsxs("span", { children: [_jsx("span", { className: `draft-toolbar-autosave-dot ${selected.editor.autosave.pendingChanges || hasUnsavedChanges ? 'pending' : 'saved'}` }), selected.editor.autosave.enabled ? 'Autosave on' : 'Autosave off'] }), selected.editor.autosave.lastManualSaveAtUtc && (_jsxs("span", { children: ["Saved ", relativeTime(selected.editor.autosave.lastManualSaveAtUtc)] }))] })] }), _jsxs("div", { className: `draft-editor-body${tab === 'compare' ? ' no-sidebar' : ''}`, children: [tab === 'source' && (_jsx("textarea", { ref: editorRef, className: "draft-source-editor", value: draftHtml, onChange: e => setDraftHtml(e.target.value), spellCheck: false, readOnly: !isEditable, placeholder: isEditable ? 'Start writing HTML...' : 'This branch is read-only.' })), tab === 'preview' && (_jsx("div", { className: "draft-preview-pane", dangerouslySetInnerHTML: { __html: selected.editor.previewHtml || draftHtml } })), tab === 'compare' && (_jsxs("div", { className: "draft-compare-container", children: [_jsxs("div", { children: [_jsx("div", { className: "draft-compare-label", children: "Live Revision" }), _jsx("div", { className: "draft-compare-pane draft-compare-pane-live", children: selected.editor.compare.liveHtml || _jsx("span", { style: { color: 'var(--color-text-muted)' }, children: "No live content" }) })] }), _jsxs("div", { children: [_jsxs("div", { className: "draft-compare-label", children: ["Draft (head r", selected.branch.headRevisionNumber, ")"] }), _jsx("div", { className: "draft-compare-pane draft-compare-pane-draft", children: selected.editor.compare.draftHtml || draftHtml })] })] })), tab !== 'compare' && (_jsxs("div", { className: "draft-sidebar", children: [_jsxs("div", { className: "draft-sidebar-section", children: [_jsxs("div", { className: "draft-sidebar-section-title", children: ["Validation", selected.editor.validationWarnings.length > 0 && (_jsx("span", { className: "draft-sidebar-section-count", children: selected.editor.validationWarnings.length }))] }), _jsx(ValidationPanel, { warnings: selected.editor.validationWarnings })] }), _jsxs("div", { className: "draft-sidebar-section", children: [_jsxs("div", { className: "draft-sidebar-section-title", children: ["Changes vs Live", selected.editor.compare.diff.changeRegions.length > 0 && (_jsx("span", { className: "draft-sidebar-section-count", children: selected.editor.compare.diff.changeRegions.length }))] }), _jsx(ChangeRegionsPanel, { regions: selected.editor.compare.diff.changeRegions })] }), _jsxs("div", { className: "draft-sidebar-section", children: [_jsxs("div", { className: "draft-sidebar-section-title", children: [_jsxs("span", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }, children: [_jsx(IconClock, { size: 12 }), " History"] }), selected.editor.history.length > 0 && (_jsx("span", { className: "draft-sidebar-section-count", children: selected.editor.history.length }))] }), _jsx(HistoryPanel, { entries: selected.editor.history })] })] }))] })] })) : null })] }), _jsx(ConfirmationDialog, { open: showDiscardDialog, title: "Discard Branch", message: _jsxs(_Fragment, { children: [_jsxs("p", { children: ["Are you sure you want to discard ", _jsx("strong", { children: selected?.branch.name }), "?"] }), _jsx("p", { children: "The branch will be marked as discarded but can be reactivated later." })] }), confirmText: "Discard Branch", variant: "danger", isProcessing: discardMutation.loading, onClose: () => setShowDiscardDialog(false), onConfirm: handleDiscard })] }));
};
