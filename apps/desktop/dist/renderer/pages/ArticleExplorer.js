import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppRoute, ArticleRelationDirection, ArticleRelationType, RevisionState, ArticleAiPresetAction } from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { Drawer } from '../components/Drawer';
import { IconFolder, IconFolderOpen, IconFileText, IconSearch, IconRefreshCw, IconClock, IconGlobe, IconEye, IconCode, IconLink, IconImage, IconChevronRight, IconChevronDown, IconZap, IconSend, IconCheckCircle, } from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc, useIpcMutation } from '../hooks/useIpc';
import { useRegisterAiAssistantView } from '../components/assistant/AssistantContext';
const DETAIL_TAB_CONFIG = [
    { id: 'preview', label: 'Preview', icon: IconEye },
    { id: 'source', label: 'Source', icon: IconCode },
    { id: 'history', label: 'History', icon: IconClock },
    { id: 'lineage', label: 'Lineage', icon: IconLink },
    { id: 'publish', label: 'Publish', icon: IconRefreshCw },
    { id: 'pbis', label: 'PBIs', icon: IconFileText },
    { id: 'relations', label: 'Relations', icon: IconLink },
];
function formatSyncAge(utcStr) {
    const diff = Date.now() - new Date(utcStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)
        return { label: 'just now', freshness: 'fresh' };
    if (mins < 60)
        return { label: `${mins}m ago`, freshness: 'fresh' };
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)
        return { label: `${hrs}h ago`, freshness: hrs < 4 ? 'fresh' : 'stale' };
    const days = Math.floor(hrs / 24);
    return { label: `${days}d ago`, freshness: 'stale' };
}
function revisionStateToBadge(state) {
    switch (state) {
        case RevisionState.LIVE: return 'live';
        case RevisionState.DRAFT_BRANCH: return 'draft';
        case RevisionState.RETIRED: return 'retired';
        case RevisionState.OBSOLETE: return 'retired';
        default: return 'live';
    }
}
function normalizePreviewHtml(rawHtml) {
    if (!rawHtml)
        return '';
    const withoutScripts = rawHtml.replace(/<script[\s\S]*?<\/script>/gi, '');
    const bodyMatch = withoutScripts.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch?.[1])
        return bodyMatch[1].trim();
    const articleBody = withoutScripts.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleBody?.[1])
        return articleBody[1].trim();
    return withoutScripts.trim();
}
function buildArticlePreviewDocument(rawHtml, previewTitle, styleCss) {
    const articleBody = normalizePreviewHtml(rawHtml) || '<p>No preview content found.</p>';
    return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'; font-src 'self' data: https:; media-src https:; connect-src https:; frame-src 'none'; script-src 'none';"
    />
    <title>${previewTitle}</title>
    <style>
      :root {
        --kbv-default-bg: #ffffff;
      }

      html,
      body {
        margin: 0;
        padding: 0;
        width: 100%;
        min-height: auto;
        height: auto;
      }

      body {
        background: #ffffff;
        color: var(--kbv-zendesk-preview-color_text, #1a202c);
        font-size: 16px;
      }

      #kbv-zendesk-preview-host {
        width: min(1120px, 100%);
        max-width: 100%;
        margin: 0 auto;
        padding: 0 clamp(16px, 3vw, 32px) 8px;
        box-sizing: border-box;
        background: var(--kbv-default-bg);
        min-height: auto;
        color: var(--kbv-zendesk-preview-color_text, #1a202c);
      }

      #kbv-zendesk-preview-host > :first-child {
        margin-top: 0;
      }

      #kbv-zendesk-preview-host > :last-child {
        margin-bottom: 0;
      }

      #kbv-zendesk-preview-host img,
      #kbv-zendesk-preview-host figure img {
        width: auto;
        max-width: 100% !important;
        max-height: min(360px, 40vh) !important;
        height: auto;
        display: inline-block;
      }

      #kbv-zendesk-preview-host .header,
      #kbv-zendesk-preview-host .hero {
        height: auto;
        max-width: 100%;
      }

      #kbv-zendesk-preview-host .hero img,
      #kbv-zendesk-preview-host .hero picture img,
      #kbv-zendesk-preview-host [class*="hero"] img,
      #kbv-zendesk-preview-host .article-header img,
      #kbv-zendesk-preview-host header img,
      #kbv-zendesk-preview-host main img {
        display: block;
        width: min(100%, 980px) !important;
        max-width: 100% !important;
        max-height: min(360px, 40vh) !important;
        height: auto !important;
        object-fit: contain !important;
        margin-left: auto;
        margin-right: auto;
      }

      #kbv-zendesk-preview-host table {
        width: 100%;
      }

      #kbv-zendesk-preview-host pre,
      #kbv-zendesk-preview-host code {
        white-space: pre-wrap;
        word-break: break-word;
      }
    </style>
    <style>${styleCss}</style>
  </head>
  <body>
    <main id="kbv-zendesk-preview-host">${articleBody}</main>
  </body>
</html>
  `.trim();
}
/* ---------- Sub-components for detail panels ---------- */
function Breadcrumb({ items }) {
    return (_jsx("nav", { className: "breadcrumb", "aria-label": "Breadcrumb", children: items.map((item, i) => (_jsxs("span", { className: "breadcrumb-item", children: [i > 0 && _jsx(IconChevronRight, { size: 10, className: "breadcrumb-separator" }), item.onClick ? (_jsx("span", { className: "breadcrumb-item--link", onClick: item.onClick, role: "button", tabIndex: 0, children: item.label })) : (_jsx("span", { className: "breadcrumb-item--current", children: item.label }))] }, i))) }));
}
function HistoryTimeline({ revisions }) {
    const items = revisions;
    if (items.length === 0) {
        return _jsx(EmptyState, { title: "No revision history", description: "This article has no recorded revisions yet." });
    }
    return (_jsx("div", { className: "timeline", children: items.map((rev, index) => {
            const dotClass = rev.status === 'promoted'
                ? 'timeline-dot timeline-dot--promoted'
                : rev.revisionType === 'draft'
                    ? 'timeline-dot timeline-dot--draft'
                    : 'timeline-dot timeline-dot--live';
            return (_jsxs("div", { className: "timeline-item", children: [_jsx("div", { className: dotClass }), _jsxs("div", { className: "timeline-item-header", children: [_jsxs("span", { className: "timeline-item-title", children: ["Revision #", rev.revisionNumber ?? index + 1] }), _jsx(Badge, { variant: rev.status === 'open' ? 'primary' : rev.status === 'promoted' ? 'success' : 'neutral', children: rev.status ?? 'unknown' })] }), _jsxs("div", { className: "timeline-item-meta", children: [rev.revisionType ?? 'live', " \u00B7 ", rev.updatedAtUtc ? new Date(rev.updatedAtUtc).toLocaleString() : 'Unknown date'] }), rev.contentHash && (_jsx("div", { className: "timeline-item-hash", children: rev.contentHash.slice(0, 12) }))] }, rev.id ?? index));
        }) }));
}
function LineagePanel({ entries }) {
    if (entries.length === 0) {
        return _jsx(EmptyState, { title: "No lineage records", description: "No lineage records are available for this article." });
    }
    return (_jsx("div", { className: "lineage-list", children: entries.map((entry, index) => (_jsxs("div", { className: "lineage-card", children: [_jsx(IconLink, { size: 14, className: "lineage-card-icon" }), _jsxs("div", { className: "lineage-card-body", children: [_jsxs("div", { className: "lineage-card-ids", children: [entry.predecessorRevisionId, " \u2192 ", entry.successorRevisionId] }), _jsxs("div", { className: "lineage-card-meta", children: [entry.createdBy, " \u00B7 ", new Date(entry.createdAtUtc).toLocaleString()] })] })] }, entry.id ?? index))) }));
}
function PublishLogPanel({ records }) {
    if (records.length === 0) {
        return _jsx(EmptyState, { title: "No publish history", description: "This article has not been published yet." });
    }
    return (_jsx("div", { className: "publish-list", children: records.map((record, index) => (_jsxs("div", { className: "publish-card", children: [_jsxs("div", { className: "publish-card-header", children: [_jsx("span", { className: "publish-card-title", children: record.zendeskArticleId ? `Zendesk #${record.zendeskArticleId}` : 'Local publish record' }), record.result && (_jsx(Badge, { variant: record.result === 'success' ? 'success' : record.result === 'failed' ? 'danger' : 'neutral', children: record.result }))] }), _jsx("div", { className: "publish-card-meta", children: new Date(record.publishedAtUtc).toLocaleString() })] }, record.id ?? index))) }));
}
function PBIPanel({ pbis }) {
    if (pbis.length === 0) {
        return _jsx(EmptyState, { title: "No related PBIs", description: "No linked PBIs were found for this article." });
    }
    return (_jsx("div", { className: "pbi-list", children: pbis.map((pbi, index) => (_jsxs("div", { className: "pbi-card", children: [_jsxs("div", { className: "pbi-card-header", children: [_jsx("span", { className: "pbi-card-id", children: pbi.externalId }), pbi.priority && _jsx(Badge, { variant: "neutral", children: pbi.priority })] }), _jsx("div", { className: "pbi-card-title", children: pbi.title }), pbi.description && (_jsx("div", { className: "pbi-card-desc", children: pbi.description }))] }, pbi.id ?? index))) }));
}
function relationTypeLabel(type) {
    switch (type) {
        case ArticleRelationType.SAME_WORKFLOW: return 'Same Workflow';
        case ArticleRelationType.PREREQUISITE: return 'Prerequisite';
        case ArticleRelationType.FOLLOW_UP: return 'Follow Up';
        case ArticleRelationType.PARENT_TOPIC: return 'Parent Topic';
        case ArticleRelationType.CHILD_TOPIC: return 'Child Topic';
        case ArticleRelationType.SHARED_SURFACE: return 'Shared Surface';
        case ArticleRelationType.REPLACES: return 'Replaces';
        case ArticleRelationType.SEE_ALSO:
        default:
            return 'See Also';
    }
}
function relationVariant(relation) {
    return relation.origin === 'manual' ? 'primary' : 'neutral';
}
function RelationsPanel({ workspaceId, familyId, relations, onChanged, onOpenRelation }) {
    const searchQuery = useIpc('workspace.search');
    const createRelation = useIpcMutation('article.relations.upsert');
    const deleteRelation = useIpcMutation('article.relations.delete');
    const [searchText, setSearchText] = useState('');
    const [selectedFamilyId, setSelectedFamilyId] = useState('');
    const [relationType, setRelationType] = useState(ArticleRelationType.SEE_ALSO);
    useEffect(() => {
        if (searchText.trim().length < 2)
            return;
        const timeout = setTimeout(() => {
            searchQuery.execute({
                workspaceId,
                query: searchText.trim(),
                scope: 'all',
                includeArchived: true
            });
        }, 250);
        return () => clearTimeout(timeout);
    }, [searchText, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
    const searchResults = (searchQuery.data?.results ?? []).filter((result) => result.familyId !== familyId);
    const uniqueTargets = searchResults.filter((result, index, array) => array.findIndex((candidate) => candidate.familyId === result.familyId) === index);
    const addRelation = async () => {
        if (!selectedFamilyId)
            return;
        await createRelation.mutate({
            workspaceId,
            sourceFamilyId: familyId,
            targetFamilyId: selectedFamilyId,
            relationType,
            direction: ArticleRelationDirection.BIDIRECTIONAL
        });
        setSearchText('');
        setSelectedFamilyId('');
        await onChanged();
    };
    const removeRelation = async (relation) => {
        await deleteRelation.mutate({
            workspaceId,
            relationId: relation.id,
            sourceFamilyId: relation.sourceFamily.id,
            targetFamilyId: relation.targetFamily.id
        });
        await onChanged();
    };
    return (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }, children: [_jsxs("div", { className: "card", children: [_jsx("div", { className: "card-header", children: _jsx("span", { className: "card-header-title", children: "Add Manual Relation" }) }), _jsxs("div", { className: "card-body", style: { display: 'grid', gap: 'var(--space-3)' }, children: [_jsx("input", { className: "input input-sm", placeholder: "Search article title...", value: searchText, onChange: (event) => setSearchText(event.target.value) }), _jsxs("select", { className: "input input-sm", value: selectedFamilyId, onChange: (event) => setSelectedFamilyId(event.target.value), children: [_jsx("option", { value: "", children: "Select article" }), uniqueTargets.map((result) => (_jsx("option", { value: result.familyId, children: result.title }, result.familyId)))] }), _jsx("select", { className: "input input-sm", value: relationType, onChange: (event) => setRelationType(event.target.value), children: Object.values(ArticleRelationType).map((type) => (_jsx("option", { value: type, children: relationTypeLabel(type) }, type))) }), _jsx("button", { className: "btn btn-primary btn-sm", onClick: () => void addRelation(), disabled: !selectedFamilyId || createRelation.loading, children: "Add Relation" }), (createRelation.error || deleteRelation.error) && (_jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-danger)' }, children: createRelation.error ?? deleteRelation.error }))] })] }), relations.length === 0 ? (_jsx(EmptyState, { title: "No relations yet", description: "Run a relation refresh or add a manual relation for this article family." })) : (_jsx("div", { className: "publish-list", children: relations.map((relation) => {
                    const counterpart = relation.sourceFamily.id === familyId ? relation.targetFamily : relation.sourceFamily;
                    return (_jsxs("div", { className: "publish-card", children: [_jsxs("div", { className: "publish-card-header", children: [_jsx("button", { className: "btn btn-ghost btn-sm", style: { padding: 0, fontWeight: 'var(--weight-semibold)' }, onClick: () => void onOpenRelation(counterpart.id), title: `Open ${counterpart.title}`, children: counterpart.title }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }, children: [_jsx(Badge, { variant: relationVariant(relation), children: relation.origin }), _jsx(Badge, { variant: "neutral", children: relationTypeLabel(relation.relationType) }), _jsx("button", { className: "btn btn-ghost btn-xs", onClick: () => void removeRelation(relation), children: "Remove" })] })] }), _jsxs("div", { className: "publish-card-meta", children: ["Score ", Math.round(relation.strengthScore * 100), "%"] }), relation.evidence.length > 0 && (_jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-2)', lineHeight: 1.5 }, children: relation.evidence.slice(0, 2).map((evidence) => evidence.snippet).filter(Boolean).join(' • ') }))] }, relation.id));
                }) }))] }));
}
/* ---------- Article AI Chat Tab ---------- */
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
function presetPrompt(action) {
    switch (action) {
        case ArticleAiPresetAction.REWRITE_TONE: return 'Rewrite this article for a clearer, more confident support tone.';
        case ArticleAiPresetAction.SHORTEN: return 'Shorten this article while preserving every required step.';
        case ArticleAiPresetAction.EXPAND: return 'Expand this article with missing context and examples.';
        case ArticleAiPresetAction.RESTRUCTURE: return 'Restructure this article into a clearer heading and section flow.';
        case ArticleAiPresetAction.CONVERT_TO_TROUBLESHOOTING: return 'Convert this article into a troubleshooting article with symptoms, causes, and fixes.';
        case ArticleAiPresetAction.ALIGN_TO_TEMPLATE: return 'Align this article to the selected template pack.';
        case ArticleAiPresetAction.UPDATE_LOCALE: return 'Update this article for the target locale and keep terminology consistent.';
        case ArticleAiPresetAction.INSERT_IMAGE_PLACEHOLDERS: return 'Insert image placeholders where screenshots would help.';
        default: return '';
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
function ArticleAiTab({ workspaceId, localeVariantId, }) {
    const sessionQuery = useIpc('article.ai.get');
    const submitMutation = useIpcMutation('article.ai.submit');
    const resetMutation = useIpcMutation('article.ai.reset');
    const acceptMutation = useIpcMutation('article.ai.accept');
    const rejectMutation = useIpcMutation('article.ai.reject');
    const [prompt, setPrompt] = useState('');
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [selectedPreset, setSelectedPreset] = useState(ArticleAiPresetAction.FREEFORM);
    const transcriptRef = useRef(null);
    useEffect(() => {
        void sessionQuery.execute({ workspaceId, localeVariantId });
    }, [workspaceId, localeVariantId]);
    useEffect(() => {
        if (transcriptRef.current) {
            transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
        }
    }, [sessionQuery.data?.messages.length]);
    const session = sessionQuery.data;
    const busy = sessionQuery.loading || submitMutation.loading || resetMutation.loading || acceptMutation.loading || rejectMutation.loading;
    const hasPending = !!session?.pendingEdit;
    const isRunning = session?.session.status === 'running';
    const templates = session?.templatePacks ?? [];
    const refreshSession = async () => {
        await sessionQuery.execute({ workspaceId, localeVariantId });
    };
    const handlePreset = (action) => {
        setSelectedPreset(action);
        setPrompt(presetPrompt(action));
    };
    const handleSubmit = async () => {
        if (!prompt.trim() || !session)
            return;
        const result = await submitMutation.mutate({
            workspaceId,
            localeVariantId,
            message: prompt,
            templatePackId: selectedTemplateId || undefined,
            presetAction: selectedPreset,
        });
        if (result) {
            setPrompt('');
            setSelectedPreset(ArticleAiPresetAction.FREEFORM);
            await refreshSession();
        }
    };
    const handleReset = async () => {
        if (!session)
            return;
        await resetMutation.mutate({ workspaceId, sessionId: session.session.id });
        await refreshSession();
    };
    const handleAccept = async () => {
        if (!session)
            return;
        await acceptMutation.mutate({ workspaceId, sessionId: session.session.id });
        await refreshSession();
    };
    const handleReject = async () => {
        if (!session)
            return;
        await rejectMutation.mutate({ workspaceId, sessionId: session.session.id });
        await refreshSession();
    };
    if (sessionQuery.loading && !session) {
        return _jsx(LoadingState, { message: "Starting AI session..." });
    }
    if (sessionQuery.error && !session) {
        return _jsx(ErrorState, { title: "Unable to start AI session", description: sessionQuery.error });
    }
    if (!session) {
        return _jsx(EmptyState, { title: "AI chat unavailable", description: "Could not initialize an AI session for this article." });
    }
    return (_jsxs("div", { className: "article-ai-panel", style: { padding: 'var(--space-3) 0' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }, children: [_jsxs("span", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontWeight: 600, fontSize: 'var(--text-sm)' }, children: [_jsx(IconZap, { size: 14 }), " Article AI Chat"] }), _jsx("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: () => void handleReset(), disabled: busy, title: "Clear chat history and start fresh", children: "Reset" })] }), hasPending && (_jsxs("div", { className: "article-ai-pending", children: [_jsxs("div", { className: "article-ai-pending-header", children: [_jsx(IconZap, { size: 12, style: { color: 'var(--color-primary)' } }), _jsx("span", { className: "article-ai-pending-label", children: "Pending AI edit" })] }), _jsx("div", { className: "article-ai-pending-summary", children: session.pendingEdit.summary }), session.pendingEdit.rationale && (_jsx("div", { className: "article-ai-pending-diff-hint", children: session.pendingEdit.rationale })), _jsxs("div", { className: "article-ai-pending-actions", children: [_jsxs("button", { type: "button", className: "btn btn-primary btn-sm", onClick: () => void handleAccept(), disabled: busy, children: [_jsx(IconCheckCircle, { size: 12 }), " Accept into draft"] }), _jsx("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: () => void handleReject(), disabled: busy, children: "Reject" })] })] })), isRunning && (_jsxs("div", { className: "article-ai-running", children: [_jsx("span", { className: "article-ai-running-dot" }), "AI is processing your request..."] })), _jsx("div", { className: "article-ai-transcript", ref: transcriptRef, children: session.messages.length === 0 ? (_jsx("div", { className: "article-ai-empty-hint", children: "Use a quick action or type a request below to start editing this article with AI. Chat history persists until you reset it." })) : (session.messages.map((message) => (_jsxs("div", { className: `article-ai-msg ${message.role}`, children: [_jsxs("div", { className: "article-ai-msg-header", children: [_jsx("span", { className: `article-ai-msg-role ${message.role}`, children: message.role === 'assistant' ? 'AI' : message.role }), _jsx("span", { className: "article-ai-msg-time", children: relativeTime(message.createdAtUtc) })] }), message.presetAction && message.presetAction !== ArticleAiPresetAction.FREEFORM && (_jsx("div", { style: { marginBottom: 4 }, children: _jsx(Badge, { variant: "primary", children: presetLabel(message.presetAction) }) })), _jsx("div", { children: message.content })] }, message.id)))) }), _jsx("div", { className: "article-ai-presets", children: session.presets.map((preset) => (_jsx("button", { type: "button", className: "article-ai-preset-chip", onClick: () => handlePreset(preset.action), disabled: busy || hasPending, title: preset.description, children: presetLabel(preset.action) }, preset.action))) }), _jsx("div", { className: "article-ai-template-row", children: _jsxs("select", { className: "input article-ai-template-select", value: selectedTemplateId, onChange: (e) => setSelectedTemplateId(e.target.value), disabled: busy, children: [_jsx("option", { value: "", children: "No template (use article context)" }), templates.map((template) => (_jsxs("option", { value: template.id, children: [template.name, " (", template.language, ")"] }, template.id)))] }) }), _jsx("div", { className: "article-ai-compose", children: _jsxs("div", { className: "article-ai-compose-row", children: [_jsx("textarea", { className: "article-ai-textarea", value: prompt, onChange: (e) => setPrompt(e.target.value), placeholder: "Describe the change you want...", disabled: busy || hasPending, onKeyDown: (e) => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && prompt.trim()) {
                                    e.preventDefault();
                                    void handleSubmit();
                                }
                            } }), _jsx("button", { type: "button", className: "article-ai-send-btn", onClick: () => void handleSubmit(), disabled: busy || !prompt.trim() || hasPending, title: "Submit (Cmd+Enter)", children: _jsx(IconSend, { size: 14 }) })] }) })] }));
}
function PlaceholderBlocks({ placeholders }) {
    if (placeholders.length === 0)
        return null;
    return (_jsxs("div", { className: "placeholder-section", children: [_jsx("div", { className: "placeholder-section-label", children: "Image Placeholders" }), _jsx("div", { className: "placeholder-list", children: placeholders.map((token) => (_jsxs("div", { className: "placeholder-block", children: [_jsx(IconImage, { size: 14, className: "placeholder-block-icon" }), _jsx("span", { className: "placeholder-block-text", children: token.token }), _jsx(Badge, { variant: "warning", children: "unresolved" })] }, token.token))) })] }));
}
function buildFolderTree(nodes) {
    const categoryMap = new Map();
    const uncategorized = [];
    for (const node of nodes) {
        const catId = node.categoryId;
        const secId = node.sectionId;
        if (!catId && !secId) {
            uncategorized.push(node);
            continue;
        }
        if (catId && secId) {
            if (!categoryMap.has(catId)) {
                categoryMap.set(catId, { name: node.categoryName || catId, sections: new Map() });
            }
            const cat = categoryMap.get(catId);
            if (!cat.sections.has(secId)) {
                cat.sections.set(secId, { name: node.sectionName || secId, articles: [] });
            }
            cat.sections.get(secId).articles.push(node);
        }
        else if (secId) {
            // Section without category - treat section as top-level folder
            const syntheticCatId = `__section_${secId}`;
            if (!categoryMap.has(syntheticCatId)) {
                categoryMap.set(syntheticCatId, { name: node.sectionName || secId, sections: new Map() });
            }
            const cat = categoryMap.get(syntheticCatId);
            const directKey = '__direct__';
            if (!cat.sections.has(directKey)) {
                cat.sections.set(directKey, { name: '', articles: [] });
            }
            cat.sections.get(directKey).articles.push(node);
        }
        else if (catId) {
            // Category without section - articles directly under category
            if (!categoryMap.has(catId)) {
                categoryMap.set(catId, { name: node.categoryName || catId, sections: new Map() });
            }
            const cat = categoryMap.get(catId);
            const directKey = '__direct__';
            if (!cat.sections.has(directKey)) {
                cat.sections.set(directKey, { name: '', articles: [] });
            }
            cat.sections.get(directKey).articles.push(node);
        }
    }
    const result = [];
    // Sort categories alphabetically
    const sortedCategories = [...categoryMap.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
    for (const [catId, cat] of sortedCategories) {
        const categoryFolder = {
            type: 'folder',
            id: catId,
            name: cat.name,
            depth: 0,
            children: [],
            articleCount: 0,
        };
        const sortedSections = [...cat.sections.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
        for (const [secId, sec] of sortedSections) {
            const sortedArticles = [...sec.articles].sort((a, b) => a.title.localeCompare(b.title));
            if (secId === '__direct__') {
                // Articles directly under category
                for (const article of sortedArticles) {
                    categoryFolder.children.push({ type: 'article', node: article, depth: 1 });
                    categoryFolder.articleCount++;
                }
            }
            else {
                const sectionFolder = {
                    type: 'folder',
                    id: secId,
                    name: sec.name,
                    depth: 1,
                    children: sortedArticles.map((article) => ({
                        type: 'article',
                        node: article,
                        depth: 2,
                    })),
                    articleCount: sortedArticles.length,
                };
                categoryFolder.children.push(sectionFolder);
                categoryFolder.articleCount += sortedArticles.length;
            }
        }
        result.push(categoryFolder);
    }
    // Add uncategorized articles
    if (uncategorized.length > 0) {
        const sortedUncategorized = [...uncategorized].sort((a, b) => a.title.localeCompare(b.title));
        // If there are categories, group uncategorized under a folder
        if (categoryMap.size > 0) {
            result.push({
                type: 'folder',
                id: '__uncategorized__',
                name: 'Uncategorized',
                depth: 0,
                children: sortedUncategorized.map((article) => ({
                    type: 'article',
                    node: article,
                    depth: 1,
                })),
                articleCount: sortedUncategorized.length,
            });
        }
        else {
            // No folder structure at all - just return flat articles
            for (const article of sortedUncategorized) {
                result.push({ type: 'article', node: article, depth: 0 });
            }
        }
    }
    return result;
}
function FolderRow({ folder, expanded, onToggle, }) {
    const ChevronIcon = expanded ? IconChevronDown : IconChevronRight;
    const FolderIcon = expanded ? IconFolderOpen : IconFolder;
    return (_jsxs("div", { className: `explorer-folder-row${expanded ? ' expanded' : ''}`, style: { paddingLeft: `calc(${folder.depth * 20}px + var(--space-2))` }, onClick: onToggle, role: "button", tabIndex: 0, onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onToggle();
            }
        }, children: [_jsx(ChevronIcon, { size: 12, className: "explorer-folder-chevron" }), _jsx(FolderIcon, { size: 15, className: "explorer-folder-icon" }), _jsx("span", { className: "explorer-folder-name", children: folder.name }), _jsx("span", { className: "explorer-folder-count", children: folder.articleCount })] }));
}
function ArticleRow({ item, isSelected, onOpen, onHistoryClick, }) {
    const node = item.node;
    const totalDrafts = node.locales.reduce((sum, l) => sum + l.revision.draftCount, 0);
    const hasConflicts = node.locales.some((l) => l.hasConflicts);
    return (_jsxs("div", { className: `explorer-article-row${isSelected ? ' selected' : ''}`, style: { paddingLeft: `calc(${item.depth * 20}px + var(--space-2))` }, onClick: onOpen, role: "button", tabIndex: 0, onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen();
            }
        }, children: [_jsx(IconFileText, { size: 14, className: "explorer-article-icon" }), _jsx("span", { className: "explorer-article-title", children: node.title }), _jsxs("div", { className: "explorer-article-meta", children: [_jsx(StatusChip, { status: revisionStateToBadge(node.familyStatus) }), totalDrafts > 0 && (_jsxs(Badge, { variant: "primary", children: [totalDrafts, " draft", totalDrafts !== 1 ? 's' : ''] })), hasConflicts && _jsx(Badge, { variant: "danger", children: "Conflict" }), node.locales.map((l) => (_jsx(Badge, { variant: "neutral", children: l.locale }, l.locale))), node.locales[0]?.revision?.updatedAtUtc && (() => {
                        const info = formatSyncAge(node.locales[0].revision.updatedAtUtc);
                        return (_jsx("span", { className: `sync-freshness-badge sync-freshness-badge--${info.freshness}`, children: info.label }));
                    })(), _jsxs("button", { type: "button", className: "explorer-article-history-btn", onClick: onHistoryClick, "aria-label": `View history for ${node.title}`, children: [_jsx(IconClock, { size: 11 }), "History"] })] })] }));
}
function FolderTreeView({ items, expandedFolders, onToggleFolder, detailPanel, openArticleDetail, }) {
    const rows = [];
    function renderItems(items) {
        for (const item of items) {
            if (item.type === 'folder') {
                const isExpanded = expandedFolders.has(item.id);
                rows.push(_jsx(FolderRow, { folder: item, expanded: isExpanded, onToggle: () => onToggleFolder(item.id) }, `folder-${item.id}`));
                if (isExpanded) {
                    renderItems(item.children);
                }
            }
            else {
                rows.push(_jsx(ArticleRow, { item: item, isSelected: detailPanel.open && detailPanel.familyId === item.node.familyId, onOpen: () => openArticleDetail(item.node, 'preview'), onHistoryClick: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openArticleDetail(item.node, 'history');
                    } }, `article-${item.node.familyId}`));
            }
        }
    }
    renderItems(items);
    return _jsx("div", { className: "explorer-article-list", children: rows });
}
/* ---------- Main Component ---------- */
export const ArticleExplorer = () => {
    const { activeWorkspace } = useWorkspace();
    const treeQuery = useIpc('workspace.explorer.getTree');
    const searchQuery = useIpc('workspace.search');
    const latestSyncQuery = useIpc('zendesk.sync.getLatest');
    const latestSuccessfulSyncQuery = useIpc('zendesk.sync.getLatestSuccessful');
    const previewStyleQuery = useIpc('article.preview.styles.get');
    const [activeFilter, setActiveFilter] = useState('all');
    const [searchText, setSearchText] = useState('');
    const [selectedLocale, setSelectedLocale] = useState(null);
    const [expandedFolders, setExpandedFolders] = useState(new Set());
    const [detailPanel, setDetailPanel] = useState({
        familyId: '',
        open: false,
        loading: false,
        error: null,
        familyTitle: '',
        localeVariantId: '',
        localeVariants: [],
        activeTab: 'preview',
        detail: null,
        revisions: []
    });
    // Fetch tree and sync status when workspace changes
    useEffect(() => {
        if (activeWorkspace) {
            treeQuery.execute({ workspaceId: activeWorkspace.id });
            latestSyncQuery.execute({ workspaceId: activeWorkspace.id });
            latestSuccessfulSyncQuery.execute({ workspaceId: activeWorkspace.id });
        }
    }, [activeWorkspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!activeWorkspace) {
            return;
        }
        const handler = (event) => {
            if (event.command !== 'zendesk.sync.run') {
                return;
            }
            if (event.state !== 'SUCCEEDED' && event.state !== 'FAILED' && event.state !== 'CANCELED') {
                return;
            }
            treeQuery.execute({ workspaceId: activeWorkspace.id });
            latestSyncQuery.execute({ workspaceId: activeWorkspace.id });
            latestSuccessfulSyncQuery.execute({ workspaceId: activeWorkspace.id });
        };
        const unsubscribe = window.kbv.emitJobEvents(handler);
        return () => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, [activeWorkspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (activeWorkspace) {
            void previewStyleQuery.execute({});
        }
    }, [activeWorkspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    // Search debounce
    useEffect(() => {
        if (!activeWorkspace || searchText.trim().length < 2)
            return;
        const timer = setTimeout(() => {
            searchQuery.execute({
                workspaceId: activeWorkspace.id,
                query: searchText.trim(),
                locales: selectedLocale ? [selectedLocale] : undefined,
            });
        }, 300);
        return () => clearTimeout(timer);
    }, [searchText, selectedLocale, activeWorkspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    const tree = useMemo(() => {
        const data = treeQuery.data;
        if (!data)
            return [];
        if (Array.isArray(data))
            return data;
        if (Array.isArray(data.nodes))
            return data.nodes;
        return [];
    }, [treeQuery.data]);
    const filterCounts = useMemo(() => {
        const openableTree = tree.filter((node) => node.locales.some((locale) => Boolean(locale.revision?.revisionId)));
        const counts = { all: 0, live: 0, drafts: 0, retired: 0, conflicted: 0 };
        openableTree.forEach((node) => {
            counts.all++;
            if (node.familyStatus === RevisionState.LIVE)
                counts.live++;
            if (node.familyStatus === RevisionState.RETIRED)
                counts.retired++;
            if (node.locales.some((l) => l.hasConflicts))
                counts.conflicted++;
            if (node.locales.some((l) => l.revision.draftCount > 0))
                counts.drafts++;
        });
        return counts;
    }, [tree]);
    const filteredTree = useMemo(() => {
        const openableTree = tree.filter((node) => node.locales.some((locale) => Boolean(locale.revision?.revisionId)));
        return openableTree.filter((node) => {
            if (activeFilter === 'live')
                return node.familyStatus === RevisionState.LIVE;
            if (activeFilter === 'retired')
                return node.familyStatus === RevisionState.RETIRED;
            if (activeFilter === 'conflicted')
                return node.locales.some((l) => l.hasConflicts);
            if (activeFilter === 'drafts')
                return node.locales.some((l) => l.revision.draftCount > 0);
            return true;
        }).filter((node) => {
            if (!selectedLocale)
                return true;
            return node.locales.some((l) => l.locale === selectedLocale);
        });
    }, [tree, activeFilter, selectedLocale]);
    const availableLocales = useMemo(() => {
        const openableTree = tree.filter((node) => node.locales.some((locale) => Boolean(locale.revision?.revisionId)));
        const localeSet = new Set();
        openableTree.forEach((node) => node.locales.forEach((l) => localeSet.add(l.locale)));
        return Array.from(localeSet).sort();
    }, [tree]);
    const folderTree = useMemo(() => buildFolderTree(filteredTree), [filteredTree]);
    // Auto-expand all top-level folders on first load
    useEffect(() => {
        if (expandedFolders.size === 0 && folderTree.length > 0) {
            const topLevelFolderIds = folderTree
                .filter((item) => item.type === 'folder')
                .map((f) => f.id);
            if (topLevelFolderIds.length > 0) {
                setExpandedFolders(new Set(topLevelFolderIds));
            }
        }
    }, [folderTree]); // eslint-disable-line react-hooks/exhaustive-deps
    const toggleFolder = useCallback((folderId) => {
        setExpandedFolders((prev) => {
            const next = new Set(prev);
            if (next.has(folderId)) {
                next.delete(folderId);
            }
            else {
                next.add(folderId);
            }
            return next;
        });
    }, []);
    const expandAllFolders = useCallback(() => {
        const allIds = [];
        function collectIds(items) {
            for (const item of items) {
                if (item.type === 'folder') {
                    allIds.push(item.id);
                    collectIds(item.children);
                }
            }
        }
        collectIds(folderTree);
        setExpandedFolders(new Set(allIds));
    }, [folderTree]);
    const collapseAllFolders = useCallback(() => {
        setExpandedFolders(new Set());
    }, []);
    const openArticleDetail = useCallback(async (node, preferredTab = 'preview', explicitLocaleVariantId, explicitRevisionId) => {
        if (!activeWorkspace)
            return;
        const explicitLocaleVariant = explicitLocaleVariantId
            ? node.locales.find((locale) => locale.localeVariantId === explicitLocaleVariantId)
            : undefined;
        const preferredLocale = explicitLocaleVariant?.revision?.revisionId
            ? explicitLocaleVariant
            : node.locales.find((locale) => locale.revision?.revisionId);
        const targetLocaleVariantId = explicitLocaleVariantId ?? preferredLocale?.localeVariantId;
        const targetRevisionId = explicitRevisionId ?? preferredLocale?.revision?.revisionId;
        const selectedLocaleMissingRevision = Boolean(explicitLocaleVariantId) && !explicitRevisionId && explicitLocaleVariant && !explicitLocaleVariant.revision?.revisionId;
        if (selectedLocaleMissingRevision) {
            setDetailPanel({
                open: true,
                loading: false,
                error: 'Unable to open this article: no revision available for the selected locale.',
                familyId: node.familyId,
                familyTitle: node.title,
                localeVariantId: explicitLocaleVariantId ?? '',
                localeVariants: node.locales,
                activeTab: preferredTab,
                detail: null,
                revisions: []
            });
            return;
        }
        if (!targetLocaleVariantId && !targetRevisionId) {
            setDetailPanel({
                open: true,
                loading: false,
                error: 'Unable to open this article: no revision information available.',
                familyId: node.familyId,
                familyTitle: node.title,
                localeVariantId: '',
                localeVariants: node.locales,
                activeTab: preferredTab,
                detail: null,
                revisions: []
            });
            return;
        }
        const localeInfo = node.locales.find((item) => item.localeVariantId === targetLocaleVariantId);
        if (!localeInfo)
            return;
        setDetailPanel({
            open: true,
            loading: true,
            error: null,
            familyId: node.familyId,
            familyTitle: node.title,
            localeVariantId: localeInfo.localeVariantId,
            localeVariants: node.locales,
            activeTab: preferredTab,
            detail: null,
            revisions: []
        });
        try {
            const [detailRes, historyRes] = await Promise.all([
                window.kbv.invoke('article.detail.get', {
                    workspaceId: activeWorkspace.id,
                    localeVariantId: targetLocaleVariantId,
                    revisionId: targetRevisionId,
                    includeSource: true,
                    includePreview: true,
                    includeLineage: true,
                    includePublishLog: true,
                    preferRevisionType: localeInfo?.revision.state ?? RevisionState.LIVE
                }),
                targetLocaleVariantId
                    ? window.kbv.invoke('workspace.history.get', {
                        workspaceId: activeWorkspace.id,
                        localeVariantId: targetLocaleVariantId,
                    })
                    : Promise.resolve({ ok: false, error: { code: 'NOT_AVAILABLE', message: 'No locale variant selected for history.' } })
            ]);
            const detail = detailRes.ok && detailRes.data ? detailRes.data : null;
            const historyData = historyRes.ok && 'data' in historyRes ? historyRes.data : undefined;
            const revisions = historyData?.revisions ?? [];
            setDetailPanel({
                open: true,
                loading: false,
                error: detail
                    ? null
                    : (detailRes.error?.message ?? historyRes.error?.message ?? 'Failed to load article details'),
                familyId: node.familyId,
                familyTitle: node.title,
                localeVariantId: localeInfo?.localeVariantId ?? targetLocaleVariantId ?? '',
                localeVariants: node.locales,
                activeTab: preferredTab,
                detail,
                revisions
            });
        }
        catch {
            setDetailPanel({
                open: true,
                loading: false,
                error: 'Failed to load article details',
                familyId: node.familyId,
                familyTitle: node.title,
                localeVariantId: localeInfo?.localeVariantId ?? targetLocaleVariantId ?? '',
                localeVariants: node.locales,
                activeTab: preferredTab,
                detail: null,
                revisions: []
            });
        }
    }, [activeWorkspace]);
    const openSearchResult = useCallback(async (result) => {
        if (!activeWorkspace)
            return;
        const node = tree.find((item) => item.familyId === result.familyId);
        if (node) {
            await openArticleDetail(node, 'preview', result.localeVariantId, result.revisionId);
            return;
        }
        const fallbackNode = {
            familyId: result.familyId,
            title: result.title,
            familyStatus: RevisionState.LIVE,
            locales: [{
                    locale: result.locale,
                    localeVariantId: result.localeVariantId,
                    revision: {
                        revisionId: result.revisionId,
                        revisionNumber: 0,
                        state: RevisionState.LIVE,
                        updatedAtUtc: '',
                        draftCount: 0,
                    },
                    hasConflicts: false,
                }],
        };
        await openArticleDetail(fallbackNode, 'preview', result.localeVariantId, result.revisionId);
    }, [activeWorkspace, tree, openArticleDetail]);
    const reloadCurrentDetail = useCallback(async () => {
        if (!detailPanel.detail)
            return;
        const node = tree.find((item) => item.familyId === detailPanel.familyId) ?? {
            familyId: detailPanel.familyId,
            title: detailPanel.familyTitle,
            familyStatus: RevisionState.LIVE,
            locales: detailPanel.localeVariants
        };
        await openArticleDetail(node, 'relations', detailPanel.localeVariantId, detailPanel.detail.revision.id);
    }, [detailPanel, tree, openArticleDetail]);
    const openRelatedFamily = useCallback(async (relatedFamilyId) => {
        const node = tree.find((item) => item.familyId === relatedFamilyId);
        if (!node) {
            return;
        }
        await openArticleDetail(node, 'relations');
    }, [tree, openArticleDetail]);
    const filters = [
        { id: 'all', label: 'All Articles', count: filterCounts.all },
        { id: 'live', label: 'Live', count: filterCounts.live },
        { id: 'drafts', label: 'Has Drafts', count: filterCounts.drafts },
        { id: 'conflicted', label: 'Conflicted', count: filterCounts.conflicted },
        { id: 'retired', label: 'Retired', count: filterCounts.retired },
    ];
    const latestSyncAttempt = latestSyncQuery.data;
    const latestSuccessfulSync = latestSuccessfulSyncQuery.data;
    const latestFailedAfterSuccess = Boolean(latestSyncAttempt?.state === 'FAILED' &&
        latestSyncAttempt.endedAtUtc &&
        latestSuccessfulSync?.endedAtUtc &&
        latestSyncAttempt.endedAtUtc.localeCompare(latestSuccessfulSync.endedAtUtc) > 0);
    useRegisterAiAssistantView({
        enabled: Boolean(activeWorkspace && detailPanel.detail),
        context: {
            workspaceId: activeWorkspace?.id ?? '',
            route: AppRoute.ARTICLE_EXPLORER,
            routeLabel: 'Article Explorer',
            subject: {
                type: 'article',
                id: detailPanel.localeVariantId || detailPanel.familyId || 'article',
                title: detailPanel.familyTitle,
                locale: detailPanel.localeVariants.find((item) => item.localeVariantId === detailPanel.localeVariantId)?.locale
            },
            workingState: {
                kind: 'none',
                payload: null
            },
            capabilities: {
                canChat: true,
                canCreateProposal: Boolean(detailPanel.detail),
                canPatchProposal: false,
                canPatchDraft: false,
                canPatchTemplate: false,
                canUseUnsavedWorkingState: false
            },
            backingData: {
                familyId: detailPanel.detail?.familyId ?? detailPanel.familyId,
                localeVariantId: detailPanel.localeVariantId,
                sourceRevisionId: detailPanel.detail?.revision.id,
                sourceHtml: detailPanel.detail?.sourceHtml,
                previewHtml: detailPanel.detail?.previewHtml
            }
        }
    });
    const renderDetailContent = () => {
        if (detailPanel.loading) {
            return _jsx(LoadingState, { message: "Loading article details..." });
        }
        if (detailPanel.error) {
            return _jsx(ErrorState, { title: "Failed to load article details", description: detailPanel.error });
        }
        if (!detailPanel.detail) {
            return _jsx(EmptyState, { title: "No article details", description: "This article could not be loaded." });
        }
        const selectedLocaleInfo = detailPanel.localeVariants.find((v) => v.localeVariantId === detailPanel.localeVariantId);
        return (_jsxs(_Fragment, { children: [_jsx(Breadcrumb, { items: [
                        { label: 'Articles', onClick: () => setDetailPanel((s) => ({ ...s, open: false })) },
                        { label: detailPanel.familyTitle },
                    ] }), _jsxs("div", { className: "detail-header", children: [_jsxs("div", { className: "detail-header-meta", children: [_jsx(StatusChip, { status: selectedLocaleInfo ? revisionStateToBadge(selectedLocaleInfo.revision.state) : 'live' }), selectedLocaleInfo && selectedLocaleInfo.revision.draftCount > 0 && (_jsxs(Badge, { variant: "primary", children: [selectedLocaleInfo.revision.draftCount, " draft", selectedLocaleInfo.revision.draftCount !== 1 ? 's' : ''] })), selectedLocaleInfo?.hasConflicts && (_jsx(Badge, { variant: "danger", children: "Conflict" }))] }), selectedLocaleInfo?.revision.updatedAtUtc && (() => {
                            const info = formatSyncAge(selectedLocaleInfo.revision.updatedAtUtc);
                            return (_jsx("span", { className: `sync-freshness-badge sync-freshness-badge--${info.freshness}`, children: info.label }));
                        })()] }), detailPanel.localeVariants.length > 1 && (_jsxs("div", { className: "detail-locale-selector", children: [_jsxs("label", { className: "detail-locale-label", children: [_jsx(IconGlobe, { size: 11 }), " Locale variant"] }), _jsx("select", { className: "input input-sm", value: detailPanel.localeVariantId, onChange: async (event) => {
                                const nextLocaleVariantId = event.target.value;
                                const node = tree.find((item) => item.familyId === detailPanel.familyId);
                                const fallbackNode = node ?? {
                                    familyId: detailPanel.familyId,
                                    title: detailPanel.familyTitle,
                                    familyStatus: RevisionState.LIVE,
                                    locales: detailPanel.localeVariants
                                };
                                await openArticleDetail(fallbackNode, detailPanel.activeTab, nextLocaleVariantId);
                            }, children: detailPanel.localeVariants.map((locale) => (_jsxs("option", { value: locale.localeVariantId, children: [locale.locale, locale.revision.draftCount > 0 ? ` (${locale.revision.draftCount} drafts)` : ''] }, locale.localeVariantId))) })] })), _jsx("div", { className: "detail-tab-bar", role: "tablist", children: DETAIL_TAB_CONFIG.map((tab) => (_jsx("button", { role: "tab", "aria-selected": detailPanel.activeTab === tab.id, className: `detail-tab${detailPanel.activeTab === tab.id ? ' active' : ''}`, onClick: () => setDetailPanel((current) => ({ ...current, activeTab: tab.id })), children: tab.label }, tab.id))) }), detailPanel.activeTab === 'preview' && ((detailPanel.detail.sourceHtml || detailPanel.detail.previewHtml) ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "detail-preview-frame-card", children: _jsx("iframe", { className: "detail-preview-frame", title: `Article preview ${detailPanel.familyTitle}`, srcDoc: buildArticlePreviewDocument(detailPanel.detail.previewHtml || detailPanel.detail.sourceHtml || '', detailPanel.familyTitle, previewStyleQuery.data?.css ?? '') }, `${detailPanel.familyId}-${detailPanel.localeVariantId}-${detailPanel.activeTab}`) }), _jsx(PlaceholderBlocks, { placeholders: detailPanel.detail.placeholders })] })) : (_jsx(EmptyState, { title: "No preview", description: "No preview HTML available for this article." }))), detailPanel.activeTab === 'source' && (detailPanel.detail.sourceHtml ? (_jsx("pre", { className: "detail-source-view", children: detailPanel.detail.sourceHtml })) : (_jsx(EmptyState, { title: "No source", description: "No source HTML available." }))), detailPanel.activeTab === 'history' && (_jsx(HistoryTimeline, { revisions: detailPanel.revisions })), detailPanel.activeTab === 'lineage' && (_jsx(LineagePanel, { entries: detailPanel.detail.lineage })), detailPanel.activeTab === 'publish' && (_jsx(PublishLogPanel, { records: detailPanel.detail.publishLog })), detailPanel.activeTab === 'pbis' && (_jsx(PBIPanel, { pbis: detailPanel.detail.relatedPbis })), detailPanel.activeTab === 'relations' && activeWorkspace && (_jsx(RelationsPanel, { workspaceId: activeWorkspace.id, familyId: detailPanel.detail.familyId, relations: detailPanel.detail.relations, onChanged: reloadCurrentDetail, onOpenRelation: openRelatedFamily }))] }));
    };
    /* ---------- No workspace state ---------- */
    if (!activeWorkspace) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Articles", subtitle: "No workspace selected" }), _jsx("div", { className: "route-content", children: _jsx(EmptyState, { icon: _jsx(IconFolder, { size: 48 }), title: "No workspace open", description: "Open or create a workspace to browse your KB articles." }) })] }));
    }
    const isSearching = searchText.trim().length >= 2;
    const searchResults = searchQuery.data?.results ?? [];
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Articles", subtitle: `${filterCounts.all} article families`, actions: _jsxs("div", { className: "explorer-search-wrapper", children: [_jsx(IconSearch, { size: 13, className: "explorer-search-icon" }), _jsx("input", { className: "input input-sm", placeholder: "Search articles...", style: { width: 240 }, value: searchText, onChange: (e) => setSearchText(e.target.value) })] }) }), _jsx("div", { className: "route-content", children: _jsxs("div", { className: "explorer-layout", children: [_jsxs("div", { className: "explorer-filter-rail", children: [_jsx("div", { className: "explorer-filter-heading", children: "Filter" }), _jsx("div", { className: "explorer-filter-list", children: filters.map((f) => (_jsxs("button", { className: `explorer-filter-btn${activeFilter === f.id ? ' active' : ''}`, onClick: () => setActiveFilter(f.id), children: [_jsx("span", { children: f.label }), _jsx("span", { className: "explorer-filter-count", children: f.count })] }, f.id))) }), availableLocales.length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { className: "divider" }), _jsx("div", { className: "explorer-filter-heading", children: "Locale" }), _jsxs("div", { className: "explorer-filter-list", children: [_jsxs("button", { className: `explorer-filter-btn${!selectedLocale ? ' active' : ''}`, onClick: () => setSelectedLocale(null), children: [_jsx(IconGlobe, { size: 12 }), _jsx("span", { children: "All locales" })] }), availableLocales.map((loc) => (_jsx("button", { className: `explorer-filter-btn${selectedLocale === loc ? ' active' : ''}`, onClick: () => setSelectedLocale(loc), children: loc }, loc)))] })] }))] }), _jsxs("div", { className: "explorer-main", children: [latestSuccessfulSync && latestSuccessfulSync.endedAtUtc && (() => {
                                    const info = formatSyncAge(latestSuccessfulSync.endedAtUtc);
                                    return (_jsxs("div", { className: `explorer-sync-banner explorer-sync-banner--${info.freshness}`, children: [_jsx(IconRefreshCw, { size: 12 }), _jsxs("span", { children: ["Last successful sync ", info.label, ' ', "(", latestSuccessfulSync.mode, " \u00B7 ", latestSuccessfulSync.syncedArticles, " articles)"] }), latestFailedAfterSuccess && (_jsx(Badge, { variant: "warning", children: "Latest attempt failed" })), latestSyncAttempt?.state === 'FAILED' && !latestSuccessfulSync && (_jsx(Badge, { variant: "danger", children: "Sync failed" }))] }));
                                })(), treeQuery.loading ? (_jsx(LoadingState, { message: "Loading article tree..." })) : treeQuery.error ? (_jsx(ErrorState, { title: "Failed to load articles", description: treeQuery.error, action: _jsx("button", { className: "btn btn-primary", onClick: () => treeQuery.execute({ workspaceId: activeWorkspace.id }), children: "Retry" }) })) : isSearching ? (
                                /* Search results */
                                searchQuery.loading ? (_jsx(LoadingState, { message: "Searching..." })) : searchQuery.error ? (_jsx(ErrorState, { title: "Search failed", description: searchQuery.error, action: _jsx("button", { className: "btn btn-primary", onClick: () => searchQuery.execute({
                                            workspaceId: activeWorkspace.id,
                                            query: searchText.trim(),
                                            locales: selectedLocale ? [selectedLocale] : undefined,
                                        }), children: "Retry" }) })) : searchResults.length === 0 ? (_jsx(EmptyState, { icon: _jsx(IconSearch, { size: 48 }), title: "No results", description: `No articles matching "${searchText}"` })) : (_jsxs("div", { children: [_jsxs("div", { className: "explorer-search-header", children: [searchResults.length, " result", searchResults.length !== 1 ? 's' : '', " for \u201C", searchText, "\u201D"] }), _jsx("div", { className: "explorer-article-list", children: searchResults.map((r) => (_jsxs("div", { className: "explorer-search-row", onClick: () => openSearchResult(r), role: "button", tabIndex: 0, onKeyDown: (event) => {
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                        event.preventDefault();
                                                        void openSearchResult(r);
                                                    }
                                                }, children: [_jsx(IconFileText, { size: 14, className: "explorer-article-icon" }), _jsxs("div", { className: "flex-1", children: [_jsx("div", { className: "explorer-search-title", children: r.title }), r.snippet && _jsx("div", { className: "explorer-search-snippet", children: r.snippet })] }), _jsx(Badge, { variant: "neutral", children: r.locale })] }, r.revisionId))) })] }))) : filteredTree.length === 0 ? (_jsx(EmptyState, { icon: _jsx(IconFolder, { size: 48 }), title: "No articles match this filter", description: "Try changing the filter or locale selection." })) : (
                                /* Folder tree view */
                                _jsxs(_Fragment, { children: [folderTree.some((item) => item.type === 'folder') && (_jsxs("div", { className: "explorer-tree-toolbar", children: [_jsx("button", { className: "btn btn-ghost btn-xs", onClick: expandAllFolders, children: "Expand all" }), _jsx("button", { className: "btn btn-ghost btn-xs", onClick: collapseAllFolders, children: "Collapse all" })] })), _jsx(FolderTreeView, { items: folderTree, expandedFolders: expandedFolders, onToggleFolder: toggleFolder, detailPanel: detailPanel, openArticleDetail: openArticleDetail })] }))] })] }) }), _jsx(Drawer, { open: detailPanel.open, onClose: () => setDetailPanel((state) => ({ ...state, open: false })), title: detailPanel.familyTitle, variant: "fullscreen", children: renderDetailContent() })] }));
};
