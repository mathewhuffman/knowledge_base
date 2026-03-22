import { useState, useEffect, useCallback, useMemo } from 'react';
import { RevisionState, type ArticleDetailResponse, type ExplorerNode, type SearchResult, type SearchResponse, type ZendeskSyncRunRecord } from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { Drawer } from '../components/Drawer';
import {
  IconFolder,
  IconFileText,
  IconSearch,
  IconRefreshCw,
  IconClock,
  IconGlobe,
  IconEye,
  IconCode,
  IconLink,
  IconImage,
  IconChevronRight,
} from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc } from '../hooks/useIpc';

type Filter = 'all' | 'live' | 'drafts' | 'retired' | 'conflicted';

type DetailTab = 'preview' | 'source' | 'history' | 'lineage' | 'publish' | 'pbis';

type PreviewStyleResponse = { css: string; sourcePath: string };

const DETAIL_TAB_CONFIG: { id: DetailTab; label: string; icon: typeof IconEye }[] = [
  { id: 'preview', label: 'Preview', icon: IconEye },
  { id: 'source', label: 'Source', icon: IconCode },
  { id: 'history', label: 'History', icon: IconClock },
  { id: 'lineage', label: 'Lineage', icon: IconLink },
  { id: 'publish', label: 'Publish', icon: IconRefreshCw },
  { id: 'pbis', label: 'PBIs', icon: IconFileText },
];

type DetailLocaleVariant = {
  locale: string;
  localeVariantId: string;
  revision: {
    revisionId: string;
    revisionNumber: number;
    state: RevisionState;
    updatedAtUtc: string;
    draftCount: number;
  };
  hasConflicts: boolean;
};

interface DetailPanelState {
  familyId: string;
  open: boolean;
  loading: boolean;
  error: string | null;
  familyTitle: string;
  localeVariantId: string;
  localeVariants: DetailLocaleVariant[];
  activeTab: DetailTab;
  detail: ArticleDetailResponse | null;
  revisions: unknown[];
}

function formatSyncAge(utcStr: string): { label: string; freshness: 'fresh' | 'stale' | 'unknown' } {
  const diff = Date.now() - new Date(utcStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return { label: 'just now', freshness: 'fresh' };
  if (mins < 60) return { label: `${mins}m ago`, freshness: 'fresh' };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { label: `${hrs}h ago`, freshness: hrs < 4 ? 'fresh' : 'stale' };
  const days = Math.floor(hrs / 24);
  return { label: `${days}d ago`, freshness: 'stale' };
}

function revisionStateToBadge(state: RevisionState): 'live' | 'draft' | 'retired' | 'conflicted' {
  switch (state) {
    case RevisionState.LIVE: return 'live';
    case RevisionState.DRAFT_BRANCH: return 'draft';
    case RevisionState.RETIRED: return 'retired';
    case RevisionState.OBSOLETE: return 'retired';
    default: return 'live';
  }
}

function normalizePreviewHtml(rawHtml?: string | null): string {
  if (!rawHtml) return '';

  const withoutScripts = rawHtml.replace(/<script[\s\S]*?<\/script>/gi, '');

  const bodyMatch = withoutScripts.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[1]) return bodyMatch[1].trim();

  const articleBody = withoutScripts.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleBody?.[1]) return articleBody[1].trim();

  return withoutScripts.trim();
}

function buildArticlePreviewDocument(rawHtml: string, previewTitle: string, styleCss: string): string {
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

function Breadcrumb({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      {items.map((item, i) => (
        <span key={i} className="breadcrumb-item">
          {i > 0 && <IconChevronRight size={10} className="breadcrumb-separator" />}
          {item.onClick ? (
            <span className="breadcrumb-item--link" onClick={item.onClick} role="button" tabIndex={0}>
              {item.label}
            </span>
          ) : (
            <span className="breadcrumb-item--current">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function HistoryTimeline({ revisions }: { revisions: unknown[] }) {
  const items = revisions as Array<{
    id?: string;
    revisionNumber?: number;
    revisionType?: string;
    status?: string;
    updatedAtUtc?: string;
    contentHash?: string;
  }>;

  if (items.length === 0) {
    return <EmptyState title="No revision history" description="This article has no recorded revisions yet." />;
  }

  return (
    <div className="timeline">
      {items.map((rev, index) => {
        const dotClass = rev.status === 'promoted'
          ? 'timeline-dot timeline-dot--promoted'
          : rev.revisionType === 'draft'
            ? 'timeline-dot timeline-dot--draft'
            : 'timeline-dot timeline-dot--live';

        return (
          <div key={rev.id ?? index} className="timeline-item">
            <div className={dotClass} />
            <div className="timeline-item-header">
              <span className="timeline-item-title">
                Revision #{rev.revisionNumber ?? index + 1}
              </span>
              <Badge variant={rev.status === 'open' ? 'primary' : rev.status === 'promoted' ? 'success' : 'neutral'}>
                {rev.status ?? 'unknown'}
              </Badge>
            </div>
            <div className="timeline-item-meta">
              {rev.revisionType ?? 'live'} &middot; {rev.updatedAtUtc ? new Date(rev.updatedAtUtc).toLocaleString() : 'Unknown date'}
            </div>
            {rev.contentHash && (
              <div className="timeline-item-hash">
                {rev.contentHash.slice(0, 12)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LineagePanel({ entries }: { entries: ArticleDetailResponse['lineage'] }) {
  if (entries.length === 0) {
    return <EmptyState title="No lineage records" description="No lineage records are available for this article." />;
  }
  return (
    <div className="lineage-list">
      {entries.map((entry, index) => (
        <div key={entry.id ?? index} className="lineage-card">
          <IconLink size={14} className="lineage-card-icon" />
          <div className="lineage-card-body">
            <div className="lineage-card-ids">
              {entry.predecessorRevisionId} → {entry.successorRevisionId}
            </div>
            <div className="lineage-card-meta">
              {entry.createdBy} &middot; {new Date(entry.createdAtUtc).toLocaleString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PublishLogPanel({ records }: { records: ArticleDetailResponse['publishLog'] }) {
  if (records.length === 0) {
    return <EmptyState title="No publish history" description="This article has not been published yet." />;
  }
  return (
    <div className="publish-list">
      {records.map((record, index) => (
        <div key={record.id ?? index} className="publish-card">
          <div className="publish-card-header">
            <span className="publish-card-title">
              {record.zendeskArticleId ? `Zendesk #${record.zendeskArticleId}` : 'Local publish record'}
            </span>
            {record.result && (
              <Badge variant={record.result === 'success' ? 'success' : record.result === 'failed' ? 'danger' : 'neutral'}>
                {record.result}
              </Badge>
            )}
          </div>
          <div className="publish-card-meta">
            {new Date(record.publishedAtUtc).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}

function PBIPanel({ pbis }: { pbis: ArticleDetailResponse['relatedPbis'] }) {
  if (pbis.length === 0) {
    return <EmptyState title="No related PBIs" description="No linked PBIs were found for this article." />;
  }
  return (
    <div className="pbi-list">
      {pbis.map((pbi, index) => (
        <div key={pbi.id ?? index} className="pbi-card">
          <div className="pbi-card-header">
            <span className="pbi-card-id">{pbi.externalId}</span>
            {pbi.priority && <Badge variant="neutral">{pbi.priority}</Badge>}
          </div>
          <div className="pbi-card-title">{pbi.title}</div>
          {pbi.description && (
            <div className="pbi-card-desc">{pbi.description}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function PlaceholderBlocks({ placeholders }: { placeholders: ArticleDetailResponse['placeholders'] }) {
  if (placeholders.length === 0) return null;
  return (
    <div className="placeholder-section">
      <div className="placeholder-section-label">Image Placeholders</div>
      <div className="placeholder-list">
        {placeholders.map((token) => (
          <div key={token.token} className="placeholder-block">
            <IconImage size={14} className="placeholder-block-icon" />
            <span className="placeholder-block-text">{token.token}</span>
            <Badge variant="warning">unresolved</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Main Component ---------- */

export const ArticleExplorer = () => {
  const { activeWorkspace } = useWorkspace();
  const treeQuery = useIpc<{ workspaceId?: string; nodes: ExplorerNode[] }>('workspace.explorer.getTree');
  const searchQuery = useIpc<SearchResponse>('workspace.search');
  const latestSyncQuery = useIpc<ZendeskSyncRunRecord | null>('zendesk.sync.getLatest');
  const latestSuccessfulSyncQuery = useIpc<ZendeskSyncRunRecord | null>('zendesk.sync.getLatestSuccessful');
  const previewStyleQuery = useIpc<PreviewStyleResponse>('article.preview.styles.get');

  const [activeFilter, setActiveFilter] = useState<Filter>('all');
  const [searchText, setSearchText] = useState('');
  const [selectedLocale, setSelectedLocale] = useState<string | null>(null);
  const [detailPanel, setDetailPanel] = useState<DetailPanelState>({
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

    const handler = (event: { command: string; state: string }) => {
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
    if (!activeWorkspace || searchText.trim().length < 2) return;
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
    if (!data) return [];
    if (Array.isArray(data)) return data as unknown as ExplorerNode[];
    if (Array.isArray(data.nodes)) return data.nodes;
    return [];
  }, [treeQuery.data]);

  const filterCounts = useMemo(() => {
    const openableTree = tree.filter((node) => node.locales.some((locale) => Boolean(locale.revision?.revisionId)));
    const counts = { all: 0, live: 0, drafts: 0, retired: 0, conflicted: 0 };
    openableTree.forEach((node) => {
      counts.all++;
      if (node.familyStatus === RevisionState.LIVE) counts.live++;
      if (node.familyStatus === RevisionState.RETIRED) counts.retired++;
      if (node.locales.some((l) => l.hasConflicts)) counts.conflicted++;
      if (node.locales.some((l) => l.revision.draftCount > 0)) counts.drafts++;
    });
    return counts;
  }, [tree]);

  const filteredTree = useMemo(() => {
    const openableTree = tree.filter((node) => node.locales.some((locale) => Boolean(locale.revision?.revisionId)));
    return openableTree.filter((node) => {
      if (activeFilter === 'live') return node.familyStatus === RevisionState.LIVE;
      if (activeFilter === 'retired') return node.familyStatus === RevisionState.RETIRED;
      if (activeFilter === 'conflicted') return node.locales.some((l) => l.hasConflicts);
      if (activeFilter === 'drafts') return node.locales.some((l) => l.revision.draftCount > 0);
      return true;
    }).filter((node) => {
      if (!selectedLocale) return true;
      return node.locales.some((l) => l.locale === selectedLocale);
    });
  }, [tree, activeFilter, selectedLocale]);

  const availableLocales = useMemo(() => {
    const openableTree = tree.filter((node) => node.locales.some((locale) => Boolean(locale.revision?.revisionId)));
    const localeSet = new Set<string>();
    openableTree.forEach((node) => node.locales.forEach((l) => localeSet.add(l.locale)));
    return Array.from(localeSet).sort();
  }, [tree]);

  const openArticleDetail = useCallback(async (
    node: ExplorerNode,
    preferredTab: DetailTab = 'preview',
    explicitLocaleVariantId?: string,
    explicitRevisionId?: string
  ) => {
    if (!activeWorkspace) return;
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
    if (!localeInfo) return;

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
        window.kbv.invoke<ArticleDetailResponse>('article.detail.get', {
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
          ? window.kbv.invoke<{ workspaceId: string; localeVariantId: string; revisions: unknown[] }>('workspace.history.get', {
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
    } catch {
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

  const openSearchResult = useCallback(async (result: SearchResult) => {
    if (!activeWorkspace) return;

    const node = tree.find((item) => item.familyId === result.familyId);
    if (node) {
      await openArticleDetail(node, 'preview', result.localeVariantId, result.revisionId);
      return;
    }

    const fallbackNode: ExplorerNode = {
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

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All Articles', count: filterCounts.all },
    { id: 'live', label: 'Live', count: filterCounts.live },
    { id: 'drafts', label: 'Has Drafts', count: filterCounts.drafts },
    { id: 'conflicted', label: 'Conflicted', count: filterCounts.conflicted },
    { id: 'retired', label: 'Retired', count: filterCounts.retired },
  ];

  const latestSyncAttempt = latestSyncQuery.data;
  const latestSuccessfulSync = latestSuccessfulSyncQuery.data;
  const latestFailedAfterSuccess = Boolean(
    latestSyncAttempt?.state === 'FAILED' &&
    latestSyncAttempt.endedAtUtc &&
    latestSuccessfulSync?.endedAtUtc &&
    latestSyncAttempt.endedAtUtc.localeCompare(latestSuccessfulSync.endedAtUtc) > 0
  );

  const renderDetailContent = () => {
    if (detailPanel.loading) {
      return <LoadingState message="Loading article details..." />;
    }
    if (detailPanel.error) {
      return <ErrorState title="Failed to load article details" description={detailPanel.error} />;
    }
    if (!detailPanel.detail) {
      return <EmptyState title="No article details" description="This article could not be loaded." />;
    }

    const selectedLocaleInfo = detailPanel.localeVariants.find(
      (v) => v.localeVariantId === detailPanel.localeVariantId
    );

    return (
      <>
        {/* Breadcrumb */}
        <Breadcrumb items={[
          { label: 'Articles', onClick: () => setDetailPanel((s) => ({ ...s, open: false })) },
          { label: detailPanel.familyTitle },
        ]} />

        {/* Header meta row */}
        <div className="detail-header">
          <div className="detail-header-meta">
            <StatusChip status={selectedLocaleInfo ? revisionStateToBadge(selectedLocaleInfo.revision.state) : 'live'} />
            {selectedLocaleInfo && selectedLocaleInfo.revision.draftCount > 0 && (
              <Badge variant="primary">{selectedLocaleInfo.revision.draftCount} draft{selectedLocaleInfo.revision.draftCount !== 1 ? 's' : ''}</Badge>
            )}
            {selectedLocaleInfo?.hasConflicts && (
              <Badge variant="danger">Conflict</Badge>
            )}
          </div>
          {selectedLocaleInfo?.revision.updatedAtUtc && (() => {
            const info = formatSyncAge(selectedLocaleInfo.revision.updatedAtUtc);
            return (
              <span className={`sync-freshness-badge sync-freshness-badge--${info.freshness}`}>
                {info.label}
              </span>
            );
          })()}
        </div>

        {/* Locale selector */}
        {detailPanel.localeVariants.length > 1 && (
          <div className="detail-locale-selector">
            <label className="detail-locale-label">
              <IconGlobe size={11} /> Locale variant
            </label>
            <select
              className="input input-sm"
              value={detailPanel.localeVariantId}
              onChange={async (event) => {
                const nextLocaleVariantId = event.target.value;
                const node = tree.find((item) => item.familyId === detailPanel.familyId);
                const fallbackNode = node ?? {
                  familyId: detailPanel.familyId,
                  title: detailPanel.familyTitle,
                  familyStatus: RevisionState.LIVE,
                  locales: detailPanel.localeVariants
                };
                await openArticleDetail(fallbackNode, detailPanel.activeTab, nextLocaleVariantId);
              }}
            >
              {detailPanel.localeVariants.map((locale) => (
                <option key={locale.localeVariantId} value={locale.localeVariantId}>
                  {locale.locale}{locale.revision.draftCount > 0 ? ` (${locale.revision.draftCount} drafts)` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Tab bar */}
        <div className="detail-tab-bar" role="tablist">
          {DETAIL_TAB_CONFIG.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={detailPanel.activeTab === tab.id}
              className={`detail-tab${detailPanel.activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setDetailPanel((current) => ({ ...current, activeTab: tab.id }))}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {detailPanel.activeTab === 'preview' && (
          (detailPanel.detail.sourceHtml || detailPanel.detail.previewHtml) ? (
            <>
              <div className="detail-preview-frame-card">
                <iframe
                  key={`${detailPanel.familyId}-${detailPanel.localeVariantId}-${detailPanel.activeTab}`}
                  className="detail-preview-frame"
                  title={`Article preview ${detailPanel.familyTitle}`}
                  srcDoc={buildArticlePreviewDocument(
                    detailPanel.detail.previewHtml || detailPanel.detail.sourceHtml || '',
                    detailPanel.familyTitle,
                    previewStyleQuery.data?.css ?? ''
                  )}
                />
              </div>
              <PlaceholderBlocks placeholders={detailPanel.detail.placeholders} />
            </>
          ) : (
            <EmptyState title="No preview" description="No preview HTML available for this article." />
          )
        )}

        {detailPanel.activeTab === 'source' && (
          detailPanel.detail.sourceHtml ? (
            <pre className="detail-source-view">{detailPanel.detail.sourceHtml}</pre>
          ) : (
            <EmptyState title="No source" description="No source HTML available." />
          )
        )}

        {detailPanel.activeTab === 'history' && (
          <HistoryTimeline revisions={detailPanel.revisions} />
        )}

        {detailPanel.activeTab === 'lineage' && (
          <LineagePanel entries={detailPanel.detail.lineage} />
        )}

        {detailPanel.activeTab === 'publish' && (
          <PublishLogPanel records={detailPanel.detail.publishLog} />
        )}

        {detailPanel.activeTab === 'pbis' && (
          <PBIPanel pbis={detailPanel.detail.relatedPbis} />
        )}
      </>
    );
  };

  /* ---------- No workspace state ---------- */
  if (!activeWorkspace) {
    return (
      <>
        <PageHeader title="Articles" subtitle="No workspace selected" />
        <div className="route-content">
          <EmptyState
            icon={<IconFolder size={48} />}
            title="No workspace open"
            description="Open or create a workspace to browse your KB articles."
          />
        </div>
      </>
    );
  }

  const isSearching = searchText.trim().length >= 2;
  const searchResults: SearchResult[] = searchQuery.data?.results ?? [];

  return (
    <>
      <PageHeader
        title="Articles"
        subtitle={`${filterCounts.all} article families`}
        actions={
          <div className="explorer-search-wrapper">
            <IconSearch size={13} className="explorer-search-icon" />
            <input
              className="input input-sm"
              placeholder="Search articles..."
              style={{ width: 240 }}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
        }
      />
      <div className="route-content">
        <div className="explorer-layout">
          {/* Filter sidebar */}
          <div className="explorer-filter-rail">
            <div className="explorer-filter-heading">Filter</div>
            <div className="explorer-filter-list">
              {filters.map((f) => (
                <button
                  key={f.id}
                  className={`explorer-filter-btn${activeFilter === f.id ? ' active' : ''}`}
                  onClick={() => setActiveFilter(f.id)}
                >
                  <span>{f.label}</span>
                  <span className="explorer-filter-count">{f.count}</span>
                </button>
              ))}
            </div>

            {availableLocales.length > 0 && (
              <>
                <div className="divider" />
                <div className="explorer-filter-heading">Locale</div>
                <div className="explorer-filter-list">
                  <button
                    className={`explorer-filter-btn${!selectedLocale ? ' active' : ''}`}
                    onClick={() => setSelectedLocale(null)}
                  >
                    <IconGlobe size={12} />
                    <span>All locales</span>
                  </button>
                  {availableLocales.map((loc) => (
                    <button
                      key={loc}
                      className={`explorer-filter-btn${selectedLocale === loc ? ' active' : ''}`}
                      onClick={() => setSelectedLocale(loc)}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Main content */}
          <div className="explorer-main">
            {/* Sync freshness banner */}
            {latestSuccessfulSync && latestSuccessfulSync.endedAtUtc && (() => {
              const info = formatSyncAge(latestSuccessfulSync.endedAtUtc);
              return (
                <div className={`explorer-sync-banner explorer-sync-banner--${info.freshness}`}>
                  <IconRefreshCw size={12} />
                  <span>
                    Last successful sync {info.label}
                    {' '}({latestSuccessfulSync.mode} &middot; {latestSuccessfulSync.syncedArticles} articles)
                  </span>
                  {latestFailedAfterSuccess && (
                    <Badge variant="warning">Latest attempt failed</Badge>
                  )}
                  {latestSyncAttempt?.state === 'FAILED' && !latestSuccessfulSync && (
                    <Badge variant="danger">Sync failed</Badge>
                  )}
                </div>
              );
            })()}

            {treeQuery.loading ? (
              <LoadingState message="Loading article tree..." />
            ) : treeQuery.error ? (
              <ErrorState
                title="Failed to load articles"
                description={treeQuery.error}
                action={<button className="btn btn-primary" onClick={() => treeQuery.execute({ workspaceId: activeWorkspace.id })}>Retry</button>}
              />
            ) : isSearching ? (
              /* Search results */
              searchQuery.loading ? (
                <LoadingState message="Searching..." />
              ) : searchQuery.error ? (
                <ErrorState
                  title="Search failed"
                  description={searchQuery.error}
                  action={
                    <button
                      className="btn btn-primary"
                      onClick={() => searchQuery.execute({
                        workspaceId: activeWorkspace.id,
                        query: searchText.trim(),
                        locales: selectedLocale ? [selectedLocale] : undefined,
                      })}
                    >
                      Retry
                    </button>
                  }
                />
              ) : searchResults.length === 0 ? (
                <EmptyState
                  icon={<IconSearch size={48} />}
                  title="No results"
                  description={`No articles matching "${searchText}"`}
                />
              ) : (
                <div>
                  <div className="explorer-search-header">
                    {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for &ldquo;{searchText}&rdquo;
                  </div>
                  <div className="explorer-article-list">
                    {searchResults.map((r) => (
                      <div
                        key={r.revisionId}
                        className="explorer-search-row"
                        onClick={() => openSearchResult(r)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            void openSearchResult(r);
                          }
                        }}
                      >
                        <IconFileText size={14} className="explorer-article-icon" />
                        <div className="flex-1">
                          <div className="explorer-search-title">{r.title}</div>
                          {r.snippet && <div className="explorer-search-snippet">{r.snippet}</div>}
                        </div>
                        <Badge variant="neutral">{r.locale}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )
            ) : filteredTree.length === 0 ? (
              <EmptyState
                icon={<IconFolder size={48} />}
                title="No articles match this filter"
                description="Try changing the filter or locale selection."
              />
            ) : (
              /* Article tree */
              <div className="explorer-article-list">
                {filteredTree.map((node) => {
                  const totalDrafts = node.locales.reduce((sum, l) => sum + l.revision.draftCount, 0);
                  const hasConflicts = node.locales.some((l) => l.hasConflicts);

                  return (
                    <div
                      key={node.familyId}
                      className={`explorer-article-row${detailPanel.open && detailPanel.familyId === node.familyId ? ' selected' : ''}`}
                      onClick={() => openArticleDetail(node, 'preview')}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void openArticleDetail(node, 'preview');
                        }
                      }}
                    >
                      <IconFileText size={14} className="explorer-article-icon" />
                      <span className="explorer-article-title">{node.title}</span>

                      <div className="explorer-article-meta">
                        <StatusChip status={revisionStateToBadge(node.familyStatus)} />

                        {totalDrafts > 0 && (
                          <Badge variant="primary">{totalDrafts} draft{totalDrafts !== 1 ? 's' : ''}</Badge>
                        )}

                        {hasConflicts && <Badge variant="danger">Conflict</Badge>}

                        {node.locales.map((l) => (
                          <Badge key={l.locale} variant="neutral">{l.locale}</Badge>
                        ))}

                        {node.locales[0]?.revision?.updatedAtUtc && (() => {
                          const info = formatSyncAge(node.locales[0].revision.updatedAtUtc);
                          return (
                            <span className={`sync-freshness-badge sync-freshness-badge--${info.freshness}`}>
                              {info.label}
                            </span>
                          );
                        })()}

                        <button
                          type="button"
                          className="explorer-article-history-btn"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openArticleDetail(node, 'history');
                          }}
                          aria-label={`View history for ${node.title}`}
                        >
                          <IconClock size={11} />
                          History
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Article detail drawer */}
      <Drawer
        open={detailPanel.open}
        onClose={() => setDetailPanel((state) => ({ ...state, open: false }))}
        title={detailPanel.familyTitle}
        variant="fullscreen"
      >
        {renderDetailContent()}
      </Drawer>
    </>
  );
};
