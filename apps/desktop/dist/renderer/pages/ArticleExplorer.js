import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback, useMemo } from 'react';
import { RevisionState } from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { Drawer } from '../components/Drawer';
import { IconFolder, IconFileText, IconSearch, IconRefreshCw, IconClock, IconGlobe, IconEye, IconCode, IconLink, IconImage, IconChevronRight, } from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc } from '../hooks/useIpc';
const DETAIL_TAB_CONFIG = [
    { id: 'preview', label: 'Preview', icon: IconEye },
    { id: 'source', label: 'Source', icon: IconCode },
    { id: 'history', label: 'History', icon: IconClock },
    { id: 'lineage', label: 'Lineage', icon: IconLink },
    { id: 'publish', label: 'Publish', icon: IconRefreshCw },
    { id: 'pbis', label: 'PBIs', icon: IconFileText },
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
function PlaceholderBlocks({ placeholders }) {
    if (placeholders.length === 0)
        return null;
    return (_jsxs("div", { className: "placeholder-section", children: [_jsx("div", { className: "placeholder-section-label", children: "Image Placeholders" }), _jsx("div", { className: "placeholder-list", children: placeholders.map((token) => (_jsxs("div", { className: "placeholder-block", children: [_jsx(IconImage, { size: 14, className: "placeholder-block-icon" }), _jsx("span", { className: "placeholder-block-text", children: token.token }), _jsx(Badge, { variant: "warning", children: "unresolved" })] }, token.token))) })] }));
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
            localeVariantId: targetLocaleVariantId,
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
            const revisions = historyRes.ok && historyRes.data?.revisions ? historyRes.data.revisions : [];
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
                            }, children: detailPanel.localeVariants.map((locale) => (_jsxs("option", { value: locale.localeVariantId, children: [locale.locale, locale.revision.draftCount > 0 ? ` (${locale.revision.draftCount} drafts)` : ''] }, locale.localeVariantId))) })] })), _jsx("div", { className: "detail-tab-bar", role: "tablist", children: DETAIL_TAB_CONFIG.map((tab) => (_jsx("button", { role: "tab", "aria-selected": detailPanel.activeTab === tab.id, className: `detail-tab${detailPanel.activeTab === tab.id ? ' active' : ''}`, onClick: () => setDetailPanel((current) => ({ ...current, activeTab: tab.id })), children: tab.label }, tab.id))) }), detailPanel.activeTab === 'preview' && ((detailPanel.detail.sourceHtml || detailPanel.detail.previewHtml) ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "detail-preview-frame-card", children: _jsx("iframe", { className: "detail-preview-frame", title: `Article preview ${detailPanel.familyTitle}`, srcDoc: buildArticlePreviewDocument(detailPanel.detail.previewHtml || detailPanel.detail.sourceHtml || '', detailPanel.familyTitle, previewStyleQuery.data?.css ?? '') }, `${detailPanel.familyId}-${detailPanel.localeVariantId}-${detailPanel.activeTab}`) }), _jsx(PlaceholderBlocks, { placeholders: detailPanel.detail.placeholders })] })) : (_jsx(EmptyState, { title: "No preview", description: "No preview HTML available for this article." }))), detailPanel.activeTab === 'source' && (detailPanel.detail.sourceHtml ? (_jsx("pre", { className: "detail-source-view", children: detailPanel.detail.sourceHtml })) : (_jsx(EmptyState, { title: "No source", description: "No source HTML available." }))), detailPanel.activeTab === 'history' && (_jsx(HistoryTimeline, { revisions: detailPanel.revisions })), detailPanel.activeTab === 'lineage' && (_jsx(LineagePanel, { entries: detailPanel.detail.lineage })), detailPanel.activeTab === 'publish' && (_jsx(PublishLogPanel, { records: detailPanel.detail.publishLog })), detailPanel.activeTab === 'pbis' && (_jsx(PBIPanel, { pbis: detailPanel.detail.relatedPbis }))] }));
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
                                /* Article tree */
                                _jsx("div", { className: "explorer-article-list", children: filteredTree.map((node) => {
                                        const totalDrafts = node.locales.reduce((sum, l) => sum + l.revision.draftCount, 0);
                                        const hasConflicts = node.locales.some((l) => l.hasConflicts);
                                        return (_jsxs("div", { className: `explorer-article-row${detailPanel.open && detailPanel.familyId === node.familyId ? ' selected' : ''}`, onClick: () => openArticleDetail(node, 'preview'), role: "button", tabIndex: 0, onKeyDown: (event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    void openArticleDetail(node, 'preview');
                                                }
                                            }, children: [_jsx(IconFileText, { size: 14, className: "explorer-article-icon" }), _jsx("span", { className: "explorer-article-title", children: node.title }), _jsxs("div", { className: "explorer-article-meta", children: [_jsx(StatusChip, { status: revisionStateToBadge(node.familyStatus) }), totalDrafts > 0 && (_jsxs(Badge, { variant: "primary", children: [totalDrafts, " draft", totalDrafts !== 1 ? 's' : ''] })), hasConflicts && _jsx(Badge, { variant: "danger", children: "Conflict" }), node.locales.map((l) => (_jsx(Badge, { variant: "neutral", children: l.locale }, l.locale))), node.locales[0]?.revision?.updatedAtUtc && (() => {
                                                            const info = formatSyncAge(node.locales[0].revision.updatedAtUtc);
                                                            return (_jsx("span", { className: `sync-freshness-badge sync-freshness-badge--${info.freshness}`, children: info.label }));
                                                        })(), _jsxs("button", { type: "button", className: "explorer-article-history-btn", onClick: (event) => {
                                                                event.preventDefault();
                                                                event.stopPropagation();
                                                                openArticleDetail(node, 'history');
                                                            }, "aria-label": `View history for ${node.title}`, children: [_jsx(IconClock, { size: 11 }), "History"] })] })] }, node.familyId));
                                    }) }))] })] }) }), _jsx(Drawer, { open: detailPanel.open, onClose: () => setDetailPanel((state) => ({ ...state, open: false })), title: detailPanel.familyTitle, variant: "fullscreen", children: renderDetailContent() })] }));
};
