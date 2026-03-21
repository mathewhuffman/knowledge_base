import { useState, useEffect, useCallback, useMemo } from 'react';
import { RevisionState, type ExplorerNode, type SearchResult, type SearchResponse } from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { Drawer } from '../components/Drawer';
import { IconFolder, IconFileText, IconSearch } from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc } from '../hooks/useIpc';

type Filter = 'all' | 'live' | 'drafts' | 'retired' | 'conflicted';

function revisionStateToBadge(state: RevisionState): 'live' | 'draft' | 'retired' | 'conflicted' {
  switch (state) {
    case RevisionState.LIVE: return 'live';
    case RevisionState.DRAFT_BRANCH: return 'draft';
    case RevisionState.RETIRED: return 'retired';
    case RevisionState.OBSOLETE: return 'retired';
    default: return 'live';
  }
}

export const ArticleExplorer = () => {
  const { activeWorkspace } = useWorkspace();
  const treeQuery = useIpc<{ workspaceId?: string; nodes: ExplorerNode[] }>('workspace.explorer.getTree');
  const searchQuery = useIpc<SearchResponse>('workspace.search');

  const [activeFilter, setActiveFilter] = useState<Filter>('all');
  const [searchText, setSearchText] = useState('');
  const [selectedLocale, setSelectedLocale] = useState<string | null>(null);
  const [historyDrawer, setHistoryDrawer] = useState<{ open: boolean; familyTitle: string; revisions: unknown[] }>({ open: false, familyTitle: '', revisions: [] });

  // Fetch tree when workspace changes
  useEffect(() => {
    if (activeWorkspace) {
      treeQuery.execute({ workspaceId: activeWorkspace.id });
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
    if (Array.isArray(data)) {
      console.error('[ArticleExplorer] Unexpected tree payload shape (raw array), normalizing directly', {
        workspaceId: activeWorkspace?.id
      });
      return data;
    }
    if (Array.isArray(data.nodes)) {
      return data.nodes;
    }
    console.error('[ArticleExplorer] Invalid tree payload shape', {
      workspaceId: activeWorkspace?.id,
      payload: data
    });
    return [];
  }, [treeQuery.data, activeWorkspace?.id]);

  // Compute filter counts from tree data
  const filterCounts = useMemo(() => {
    const counts = { all: 0, live: 0, drafts: 0, retired: 0, conflicted: 0 };
    tree.forEach((node) => {
      counts.all++;
      if (node.familyStatus === RevisionState.LIVE) counts.live++;
      if (node.familyStatus === RevisionState.RETIRED) counts.retired++;
      if (node.locales.some((l) => l.hasConflicts)) counts.conflicted++;
      if (node.locales.some((l) => l.revision.draftCount > 0)) counts.drafts++;
    });
    return counts;
  }, [tree]);

  // Filter tree
  const filteredTree = useMemo(() => {
    return tree.filter((node) => {
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

  // Get unique locales from tree
  const availableLocales = useMemo(() => {
    const localeSet = new Set<string>();
    tree.forEach((node) => node.locales.forEach((l) => localeSet.add(l.locale)));
    return Array.from(localeSet).sort();
  }, [tree]);

  const handleViewHistory = useCallback(async (node: ExplorerNode) => {
    if (!activeWorkspace) return;
    const firstLocale = node.locales[0];
    if (!firstLocale) return;
    try {
      const res = await window.kbv.invoke('workspace.history.get', {
        workspaceId: activeWorkspace.id,
        localeVariantId: firstLocale.revision.revisionId,
      });
      setHistoryDrawer({
        open: true,
        familyTitle: node.title,
        revisions: res.ok && res.data ? (res.data as any).revisions ?? [] : [],
      });
    } catch {
      setHistoryDrawer({ open: true, familyTitle: node.title, revisions: [] });
    }
  }, [activeWorkspace]);

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: filterCounts.all },
    { id: 'live', label: 'Live', count: filterCounts.live },
    { id: 'drafts', label: 'Has Drafts', count: filterCounts.drafts },
    { id: 'conflicted', label: 'Conflicted', count: filterCounts.conflicted },
    { id: 'retired', label: 'Retired', count: filterCounts.retired },
  ];

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <div style={{ position: 'relative' }}>
              <input
                className="input input-sm"
                placeholder="Search articles..."
                style={{ width: 240, paddingLeft: 28 }}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
              <IconSearch size={13} className="" />
            </div>
          </div>
        }
      />
      <div className="route-content" style={{ display: 'flex', gap: 'var(--space-6)' }}>
        {/* Filter sidebar */}
        <div style={{ width: 180, flexShrink: 0 }}>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 'var(--space-2)', letterSpacing: '0.03em' }}>Filter</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filters.map((f) => (
              <button
                key={f.id}
                className={`btn ${activeFilter === f.id ? 'btn-secondary' : 'btn-ghost'} btn-sm`}
                style={{ justifyContent: 'space-between', width: '100%' }}
                onClick={() => setActiveFilter(f.id)}
              >
                <span>{f.label}</span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{f.count}</span>
              </button>
            ))}
          </div>

          {availableLocales.length > 0 && (
            <>
              <div className="divider" />
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 'var(--space-2)', letterSpacing: '0.03em' }}>Locale</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button
                  className={`btn ${!selectedLocale ? 'btn-secondary' : 'btn-ghost'} btn-sm`}
                  style={{ justifyContent: 'flex-start', width: '100%' }}
                  onClick={() => setSelectedLocale(null)}
                >
                  All locales
                </button>
                {availableLocales.map((loc) => (
                  <button
                    key={loc}
                    className={`btn ${selectedLocale === loc ? 'btn-secondary' : 'btn-ghost'} btn-sm`}
                    style={{ justifyContent: 'flex-start', width: '100%' }}
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
        <div style={{ flex: 1 }}>
          {treeQuery.loading ? (
            <LoadingState message="Loading article tree..." />
          ) : treeQuery.error ? (
            <ErrorState
              title="Failed to load articles"
              description={treeQuery.error}
              action={<button className="btn btn-primary" onClick={() => treeQuery.execute({ workspaceId: activeWorkspace.id })}>Retry</button>}
            />
          ) : isSearching ? (
            /* Search results mode */
            searchQuery.loading ? (
              <LoadingState message="Searching..." />
            ) : searchResults.length === 0 ? (
              <EmptyState
                icon={<IconSearch size={48} />}
                title="No results"
                description={`No articles matching "${searchText}"`}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>
                  {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for &ldquo;{searchText}&rdquo;
                </div>
                {searchResults.map((r) => (
                  <div
                    key={r.revisionId}
                    className="card-interactive"
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
                  >
                    <IconFileText size={14} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }}>{r.title}</div>
                      {r.snippet && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 2 }}>{r.snippet}</div>}
                    </div>
                    <Badge variant="neutral">{r.locale}</Badge>
                  </div>
                ))}
              </div>
            )
          ) : filteredTree.length === 0 ? (
            <EmptyState
              icon={<IconFolder size={48} />}
              title="No articles match this filter"
              description="Try changing the filter or locale selection."
            />
          ) : (
            /* Tree mode */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {filteredTree.map((node) => (
                <div
                  key={node.familyId}
                  className="card-interactive"
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
                  onClick={() => handleViewHistory(node)}
                >
                  <IconFileText size={14} />
                  <span style={{ flex: 1, fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }}>{node.title}</span>

                  {/* Status badges */}
                  <StatusChip status={revisionStateToBadge(node.familyStatus)} />

                  {node.locales.some((l) => l.revision.draftCount > 0) && (
                    <Badge variant="primary">
                      {node.locales.reduce((sum, l) => sum + l.revision.draftCount, 0)} drafts
                    </Badge>
                  )}

                  {node.locales.some((l) => l.hasConflicts) && (
                    <Badge variant="danger">Conflict</Badge>
                  )}

                  {/* Locale tags */}
                  {node.locales.map((l) => (
                    <Badge key={l.locale} variant="neutral">{l.locale}</Badge>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* History drawer */}
      <Drawer
        open={historyDrawer.open}
        onClose={() => setHistoryDrawer({ open: false, familyTitle: '', revisions: [] })}
        title={`History: ${historyDrawer.familyTitle}`}
      >
        {(historyDrawer.revisions as any[]).length === 0 ? (
          <EmptyState title="No revision history" description="This article has no recorded revisions yet." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {(historyDrawer.revisions as any[]).map((rev: any, i: number) => (
              <div key={rev.id ?? i} className="card card-padded">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-1)' }}>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>
                    Revision #{rev.revisionNumber ?? i + 1}
                  </span>
                  <Badge variant={rev.status === 'open' ? 'primary' : rev.status === 'promoted' ? 'success' : 'neutral'}>
                    {rev.status ?? 'unknown'}
                  </Badge>
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                  {rev.revisionType ?? 'live'} &middot; {rev.updatedAtUtc ? new Date(rev.updatedAtUtc).toLocaleString() : 'Unknown date'}
                </div>
                {rev.contentHash && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                    Hash: {rev.contentHash.slice(0, 12)}...
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </>
  );
};
