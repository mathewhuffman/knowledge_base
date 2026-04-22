import { useEffect, useMemo, useState } from 'react';
import type { ArticleRelationRefreshStatusResponse, ExplorerNode, JobEvent, RepositoryStructurePayload } from '@kb-vault/shared-types';
import { AppRoute, JobState, RevisionState } from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { IconHome, IconLayers, IconRefreshCw } from '../components/icons';
import { requestBootReplay } from '../components/boot/bootLoadingModel';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc, useIpcMutation } from '../hooks/useIpc';

function deriveRelationHealth(
  summary: ArticleRelationRefreshStatusResponse['summary'] | undefined,
  latestRun: ArticleRelationRefreshStatusResponse['latestRun'] | null | undefined,
  busy: boolean,
  localError?: string | null
): {
  label: string;
  variant: 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
  description: string;
} {
  const hasIndex = Math.max(
    summary?.indexStats?.documentCount ?? 0,
    summary?.indexedDocumentCount ?? 0
  ) > 0;
  const latestError = latestRun?.summary?.error;

  if (busy || latestRun?.status === 'running') {
    return {
      label: 'running',
      variant: 'primary',
      description: 'Relation analysis is currently running.'
    };
  }

  if (localError) {
    return {
      label: 'index build failed',
      variant: 'danger',
      description: localError
    };
  }

  if (!hasIndex && !latestRun) {
    return {
      label: 'not started',
      variant: 'warning',
      description: 'Run Full Relation Analysis to build the derived index and refresh inferred relations.'
    };
  }

  if (!hasIndex && latestRun?.status === 'failed') {
    return {
      label: 'setup required',
      variant: 'warning',
      description: latestError ?? 'No usable relation index exists yet. Run Full Relation Analysis.'
    };
  }

  if (latestRun?.status === 'failed') {
    return {
      label: 'refresh failed',
      variant: 'danger',
      description: latestError ?? 'The last inferred-relation refresh failed.'
    };
  }

  if (latestRun?.status === 'canceled') {
    return {
      label: 'canceled',
      variant: 'warning',
      description: 'The last inferred-relation refresh was canceled.'
    };
  }

  if (latestRun?.status === 'complete') {
    return {
      label: summary?.degradedMode ? 'degraded' : 'healthy',
      variant: summary?.degradedMode ? 'warning' : 'success',
      description: summary?.degradedMode
        ? 'Using a stale derived index fallback.'
        : 'Derived index and inferred relations are available.'
    };
  }

  if (hasIndex) {
    return {
      label: 'index ready',
      variant: 'primary',
      description: 'The derived search index is built. Run Full Relation Analysis to refresh inferred relations.'
    };
  }

  return {
    label: 'idle',
    variant: 'neutral',
    description: 'Run Full Relation Analysis to build the relation index and refresh inferred relations.'
  };
}

export const KBVaultHome = () => {
  const { activeWorkspace } = useWorkspace();
  const treeQuery = useIpc<{ workspaceId?: string; nodes: ExplorerNode[] }>('workspace.explorer.getTree');
  const repoQuery = useIpc<RepositoryStructurePayload>('workspace.repository.info');
  const relationStatusQuery = useIpc<ArticleRelationRefreshStatusResponse>('article.relations.status');
  const rebuildMutation = useIpcMutation<{
    documentCount: number;
    chunkCount: number;
    aliasCount: number;
    linkCount: number;
  }>('article.relations.rebuild');
  const [relationJob, setRelationJob] = useState<JobEvent | null>(null);
  const [rebuildMessage, setRebuildMessage] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  useEffect(() => {
    if (activeWorkspace) {
      treeQuery.execute({ workspaceId: activeWorkspace.id });
      repoQuery.execute({ workspaceId: activeWorkspace.id });
      relationStatusQuery.execute({ workspaceId: activeWorkspace.id });
    }
  }, [activeWorkspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeWorkspace) return;

    const unsubscribe = window.kbv.emitJobEvents((event) => {
      if (event.command !== 'article.relations.refresh') return;
      setRelationJob(event);
      if (event.state === 'SUCCEEDED' || event.state === 'FAILED' || event.state === 'CANCELED') {
        relationStatusQuery.execute({ workspaceId: activeWorkspace.id });
      }
    });

    return () => unsubscribe();
  }, [activeWorkspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tree = useMemo(() => {
    const data = treeQuery.data;
    if (!data) return [];
    if (Array.isArray(data)) {
      console.error('[KBVaultHome] Unexpected tree payload shape (raw array), normalizing directly', {
        workspaceId: activeWorkspace?.id
      });
      return data;
    }
    if (Array.isArray(data.nodes)) {
      return data.nodes;
    }
    console.error('[KBVaultHome] Invalid tree payload shape', {
      workspaceId: activeWorkspace?.id,
      payload: data
    });
    return [];
  }, [treeQuery.data, activeWorkspace?.id]);

  const stats = useMemo(() => {
    let articles = 0;
    let drafts = 0;
    let conflicted = 0;
    let retired = 0;
    tree.forEach((node: ExplorerNode) => {
      articles++;
      if (node.locales.some((l) => l.revision.draftCount > 0)) drafts += node.locales.reduce((s: number, l) => s + l.revision.draftCount, 0);
      if (node.locales.some((l) => l.hasConflicts)) conflicted++;
      if (node.familyStatus === RevisionState.RETIRED) retired++;
    });
    return { articles, drafts, conflicted, retired };
  }, [tree]);

  const relationSummary = relationStatusQuery.data?.summary;
  const relationRun = relationStatusQuery.data?.latestRun;
  const relationBusy = relationJob?.state === 'RUNNING' || relationJob?.state === 'QUEUED';
  const fullAnalysisBusy = rebuildMutation.loading || relationBusy;
  const relationHealth = deriveRelationHealth(relationSummary, relationRun, relationBusy, analysisError);

  const runFullRelationAnalysis = async () => {
    if (!activeWorkspace || fullAnalysisBusy) return;
    setAnalysisError(null);
    setRebuildMessage('Rebuilding the derived search index...');
    const rebuildResult = await rebuildMutation.mutateDetailed({
      workspaceId: activeWorkspace.id,
      forceFullRebuild: true
    });
    if (!rebuildResult.data) {
      const errorMessage = rebuildResult.error ?? 'The relation index rebuild failed.';
      setAnalysisError(errorMessage);
      setRebuildMessage(`Full relation analysis stopped during index rebuild: ${errorMessage}`);
      await relationStatusQuery.execute({ workspaceId: activeWorkspace.id });
      return;
    }

    setRebuildMessage(`Rebuilt ${rebuildResult.data.documentCount} documents and ${rebuildResult.data.chunkCount} chunks. Starting saved-relation refresh...`);
    setRelationJob({
      id: '',
      command: 'article.relations.refresh',
      state: JobState.QUEUED,
      progress: 0,
      message: 'queued'
    });
    await relationStatusQuery.execute({ workspaceId: activeWorkspace.id });
    await window.kbv.startJob('article.relations.refresh', {
      workspaceId: activeWorkspace.id
    });
  };

  const openRelationsGraph = async () => {
    await window.kbv.invoke('app.navigation.dispatch', {
      action: {
        type: 'open_route',
        route: AppRoute.RELATIONS_GRAPH
      }
    });
  };

  if (!activeWorkspace) {
    return (
      <>
        <PageHeader title="Home" subtitle="No workspace selected" />
        <div className="route-content">
          <EmptyState
            icon={<IconHome size={48} />}
            title="No workspace open"
            description="Open or create a workspace from the Workspaces page to see your dashboard."
          />
        </div>
      </>
    );
  }

  if (treeQuery.loading) {
    return (
      <>
        <PageHeader title="Home" subtitle={activeWorkspace.name} />
        <div className="route-content">
          <LoadingState message="Loading workspace data..." />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Home"
        subtitle={activeWorkspace.name}
        actions={
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => void runFullRelationAnalysis()}
              disabled={fullAnalysisBusy}
            >
              <IconRefreshCw size={13} />
              {fullAnalysisBusy ? 'Running Full Analysis...' : 'Run Full Relation Analysis'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => treeQuery.execute({ workspaceId: activeWorkspace.id })}
            >
              <IconRefreshCw size={13} />
              Refresh
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => void openRelationsGraph()}
            >
              <IconLayers size={13} />
              Open Feature Map
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => requestBootReplay()}
            >
              <IconRefreshCw size={13} />
              Replay Loading Sequence
            </button>
          </div>
        }
      />
      <div className="route-content">
        {/* Stats row */}
        <div className="stat-grid" style={{ marginBottom: 'var(--space-6)' }}>
          <div className="stat-card">
            <div className="stat-label">Article Families</div>
            <div className="stat-value">{stats.articles}</div>
            <div className="stat-meta">{activeWorkspace.enabledLocales.length} locale{activeWorkspace.enabledLocales.length > 1 ? 's' : ''} enabled</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Active Drafts</div>
            <div className="stat-value">{stats.drafts}</div>
            <div className="stat-meta">Across all articles</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Conflicts</div>
            <div className="stat-value">{stats.conflicted}</div>
            <div className="stat-meta">{stats.conflicted > 0 ? 'Needs attention' : 'All clear'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Workspace</div>
            <div className="stat-value" style={{ fontSize: 'var(--text-md)' }}>
              <StatusChip status={activeWorkspace.state === 'active' ? 'active' : 'retired'} label={activeWorkspace.state} />
            </div>
            <div className="stat-meta">Default: {activeWorkspace.defaultLocale}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Feature Map</div>
            <div className="stat-value">{relationSummary?.totalActive ?? 0}</div>
            <div className="stat-meta">
              {relationHealth.description}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Indexed Docs</div>
            <div className="stat-value">{relationSummary?.indexedDocumentCount ?? 0}</div>
            <div className="stat-meta">
              {relationSummary?.indexStats?.chunkCount ?? 0} chunks in derived index
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Stale Docs</div>
            <div className="stat-value">{relationSummary?.staleDocumentCount ?? 0}</div>
            <div className="stat-meta">
              {relationSummary?.degradedMode ? 'Refresh running in degraded mode' : 'Ready for rebuild when content changes'}
            </div>
          </div>
        </div>

        {/* Workspace info + recent articles */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          {/* Workspace details card */}
          <div className="card">
            <div className="card-header">
              <span className="card-header-title">Workspace Info</span>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Name</span>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }}>{activeWorkspace.name}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Path</span>
                <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>{activeWorkspace.path}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Created</span>
                <span style={{ fontSize: 'var(--text-sm)' }}>{new Date(activeWorkspace.createdAtUtc).toLocaleDateString()}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Locales</span>
                <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                  {activeWorkspace.enabledLocales.map((loc) => (
                    <Badge key={loc} variant={loc === activeWorkspace.defaultLocale ? 'primary' : 'neutral'}>{loc}</Badge>
                  ))}
                </div>
              </div>
              {repoQuery.data && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>DB</span>
                  <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>{repoQuery.data.dbPath}</span>
                </div>
              )}
            </div>
          </div>

        {/* Feature Map status card */}
        <div className="card">
          <div className="card-header">
            <span className="card-header-title">Feature Map</span>
          </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Inferred</span>
                <Badge variant="neutral">{relationSummary?.inferred ?? 0}</Badge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Manual</span>
                <Badge variant="primary">{relationSummary?.manual ?? 0}</Badge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Latest status</span>
                <Badge variant={relationHealth.variant}>{relationHealth.label}</Badge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Index stats</span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                  {relationSummary?.indexStats?.documentCount ?? 0} docs · {relationSummary?.indexStats?.aliasCount ?? 0} aliases · {relationSummary?.indexStats?.linkCount ?? 0} links
                </span>
              </div>
              {rebuildMessage && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  {rebuildMessage}
                </div>
              )}
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                `Run Full Relation Analysis` rebuilds the derived search index and refreshes inferred relations. It does not repair category or section naming.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
