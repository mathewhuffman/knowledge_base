import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  AppRoute,
  ArticleRelationDirection,
  ArticleRelationType,
  RevisionState,
  ArticleAiPresetAction,
  type ArticleDetailResponse,
  type ArticleRelationRecord,
  type ArticleAiSessionResponse,
  type TemplatePackSummary,
  type ExplorerNode,
  type SearchResult,
  type SearchResponse,
  type ZendeskSyncRunRecord
} from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { Drawer } from '../components/Drawer';
import {
  IconFolder,
  IconFolderOpen,
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
  IconChevronDown,
  IconZap,
  IconSend,
  IconCheckCircle,
} from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc, useIpcMutation } from '../hooks/useIpc';
import { useRegisterAiAssistantView } from '../components/assistant/AssistantContext';
import { buildArticlePreviewDocument } from '../utils/previewDocument';
import { CodeEditor } from '../components/editor/CodeEditor';
import { EditorPane } from '../components/editor/EditorPane';

type Filter = 'all' | 'live' | 'drafts' | 'retired' | 'conflicted';

type DetailTab = 'preview' | 'source' | 'history' | 'lineage' | 'publish' | 'pbis' | 'relations';

type PreviewStyleResponse = { css: string; sourcePath: string };
const EXPANDED_FOLDER_STORAGE_KEY_PREFIX = 'kbv.articleExplorer.expandedFolders';

const DETAIL_TAB_CONFIG: { id: DetailTab; label: string; icon: typeof IconEye }[] = [
  { id: 'preview', label: 'Preview', icon: IconEye },
  { id: 'source', label: 'Source', icon: IconCode },
  { id: 'history', label: 'History', icon: IconClock },
  { id: 'lineage', label: 'Lineage', icon: IconLink },
  { id: 'publish', label: 'Publish', icon: IconRefreshCw },
  { id: 'pbis', label: 'PBIs', icon: IconFileText },
  { id: 'relations', label: 'Relations', icon: IconLink },
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

function relationTypeLabel(type: ArticleRelationType): string {
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

function relationVariant(relation: ArticleRelationRecord): 'primary' | 'neutral' {
  return relation.origin === 'manual' ? 'primary' : 'neutral';
}

function RelationsPanel({
  workspaceId,
  familyId,
  relations,
  onChanged,
  onOpenRelation
}: {
  workspaceId: string;
  familyId: string;
  relations: ArticleDetailResponse['relations'];
  onChanged: () => Promise<void>;
  onOpenRelation: (familyId: string) => Promise<void>;
}) {
  const searchQuery = useIpc<SearchResponse>('workspace.search');
  const createRelation = useIpcMutation<ArticleRelationRecord>('article.relations.upsert');
  const deleteRelation = useIpcMutation<{ workspaceId: string; relationId?: string }>('article.relations.delete');
  const [searchText, setSearchText] = useState('');
  const [selectedFamilyId, setSelectedFamilyId] = useState('');
  const [relationType, setRelationType] = useState<ArticleRelationType>(ArticleRelationType.SEE_ALSO);

  useEffect(() => {
    if (searchText.trim().length < 2) return;
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
  const uniqueTargets = searchResults.filter((result, index, array) =>
    array.findIndex((candidate) => candidate.familyId === result.familyId) === index
  );

  const addRelation = async () => {
    if (!selectedFamilyId) return;
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

  const removeRelation = async (relation: ArticleRelationRecord) => {
    await deleteRelation.mutate({
      workspaceId,
      relationId: relation.id,
      sourceFamilyId: relation.sourceFamily.id,
      targetFamilyId: relation.targetFamily.id
    });
    await onChanged();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div className="card">
        <div className="card-header">
          <span className="card-header-title">Add Manual Relation</span>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <input
            className="input input-sm"
            placeholder="Search article title..."
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <select
            className="input input-sm"
            value={selectedFamilyId}
            onChange={(event) => setSelectedFamilyId(event.target.value)}
          >
            <option value="">Select article</option>
            {uniqueTargets.map((result) => (
              <option key={result.familyId} value={result.familyId}>
                {result.title}
              </option>
            ))}
          </select>
          <select
            className="input input-sm"
            value={relationType}
            onChange={(event) => setRelationType(event.target.value as ArticleRelationType)}
          >
            {Object.values(ArticleRelationType).map((type) => (
              <option key={type} value={type}>
                {relationTypeLabel(type)}
              </option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" onClick={() => void addRelation()} disabled={!selectedFamilyId || createRelation.loading}>
            Add Relation
          </button>
          {(createRelation.error || deleteRelation.error) && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-danger)' }}>
              {createRelation.error ?? deleteRelation.error}
            </div>
          )}
        </div>
      </div>

      {relations.length === 0 ? (
        <EmptyState title="No relations yet" description="Run a relation refresh or add a manual relation for this article family." />
      ) : (
        <div className="publish-list">
          {relations.map((relation) => {
            const counterpart = relation.sourceFamily.id === familyId ? relation.targetFamily : relation.sourceFamily;
            return (
              <div key={relation.id} className="publish-card">
                <div className="publish-card-header">
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: 0, fontWeight: 'var(--weight-semibold)' }}
                    onClick={() => void onOpenRelation(counterpart.id)}
                    title={`Open ${counterpart.title}`}
                  >
                    {counterpart.title}
                  </button>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <Badge variant={relationVariant(relation)}>{relation.origin}</Badge>
                    <Badge variant="neutral">{relationTypeLabel(relation.relationType)}</Badge>
                    <button className="btn btn-ghost btn-xs" onClick={() => void removeRelation(relation)}>Remove</button>
                  </div>
                </div>
                <div className="publish-card-meta">
                  Score {Math.round(relation.strengthScore * 100)}%
                </div>
                {relation.evidence.length > 0 && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-2)', lineHeight: 1.5 }}>
                    {relation.evidence.slice(0, 2).map((evidence) => evidence.snippet).filter(Boolean).join(' • ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- Article AI Chat Tab ---------- */

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

function presetPrompt(action: ArticleAiPresetAction): string {
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

function ArticleAiTab({
  workspaceId,
  localeVariantId,
}: {
  workspaceId: string;
  localeVariantId: string;
}) {
  const sessionQuery = useIpc<ArticleAiSessionResponse>('article.ai.get');
  const submitMutation = useIpcMutation<ArticleAiSessionResponse>('article.ai.submit');
  const resetMutation = useIpcMutation<ArticleAiSessionResponse>('article.ai.reset');
  const acceptMutation = useIpcMutation<ArticleAiSessionResponse>('article.ai.accept');
  const rejectMutation = useIpcMutation<ArticleAiSessionResponse>('article.ai.reject');

  const [prompt, setPrompt] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<ArticleAiPresetAction>(ArticleAiPresetAction.FREEFORM);
  const transcriptRef = useRef<HTMLDivElement>(null);

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
  const templates: TemplatePackSummary[] = session?.templatePacks ?? [];

  const refreshSession = async () => {
    await sessionQuery.execute({ workspaceId, localeVariantId });
  };

  const handlePreset = (action: ArticleAiPresetAction) => {
    setSelectedPreset(action);
    setPrompt(presetPrompt(action));
  };

  const handleSubmit = async () => {
    if (!prompt.trim() || !session) return;
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
    if (!session) return;
    await resetMutation.mutate({ workspaceId, sessionId: session.session.id });
    await refreshSession();
  };

  const handleAccept = async () => {
    if (!session) return;
    await acceptMutation.mutate({ workspaceId, sessionId: session.session.id });
    await refreshSession();
  };

  const handleReject = async () => {
    if (!session) return;
    await rejectMutation.mutate({ workspaceId, sessionId: session.session.id });
    await refreshSession();
  };

  if (sessionQuery.loading && !session) {
    return <LoadingState message="Starting AI session..." />;
  }

  if (sessionQuery.error && !session) {
    return <ErrorState title="Unable to start AI session" description={sessionQuery.error} />;
  }

  if (!session) {
    return <EmptyState title="AI chat unavailable" description="Could not initialize an AI session for this article." />;
  }

  return (
    <div className="article-ai-panel" style={{ padding: 'var(--space-3) 0' }}>
      {/* Header with reset */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontWeight: 600, fontSize: 'var(--text-sm)' }}>
          <IconZap size={14} /> Article AI Chat
        </span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleReset()} disabled={busy} title="Clear chat history and start fresh">
          Reset
        </button>
      </div>

      {/* Pending edit card */}
      {hasPending && (
        <div className="article-ai-pending">
          <div className="article-ai-pending-header">
            <IconZap size={12} style={{ color: 'var(--color-primary)' }} />
            <span className="article-ai-pending-label">Pending AI edit</span>
          </div>
          <div className="article-ai-pending-summary">{session.pendingEdit!.summary}</div>
          {session.pendingEdit!.rationale && (
            <div className="article-ai-pending-diff-hint">{session.pendingEdit!.rationale}</div>
          )}
          <div className="article-ai-pending-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleAccept()} disabled={busy}>
              <IconCheckCircle size={12} /> Accept into draft
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleReject()} disabled={busy}>
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
            Use a quick action or type a request below to start editing this article with AI. Chat history persists until you reset it.
          </div>
        ) : (
          session.messages.map((message) => (
            <div key={message.id} className={`article-ai-msg ${message.role}`}>
              <div className="article-ai-msg-header">
                <span className={`article-ai-msg-role ${message.role}`}>
                  {message.role === 'assistant' ? 'AI' : message.role}
                </span>
                <span className="article-ai-msg-time">{relativeTime(message.createdAtUtc)}</span>
              </div>
              {message.presetAction && message.presetAction !== ArticleAiPresetAction.FREEFORM && (
                <div style={{ marginBottom: 4 }}>
                  <Badge variant="primary">{presetLabel(message.presetAction)}</Badge>
                </div>
              )}
              <div>{message.content}</div>
            </div>
          ))
        )}
      </div>

      {/* Preset chips */}
      <div className="article-ai-presets">
        {session.presets.map((preset) => (
          <button
            key={preset.action}
            type="button"
            className="article-ai-preset-chip"
            onClick={() => handlePreset(preset.action)}
            disabled={busy || hasPending}
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
          onChange={(e) => setSelectedTemplateId(e.target.value)}
          disabled={busy}
        >
          <option value="">No template (use article context)</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} ({template.language})
            </option>
          ))}
        </select>
      </div>

      {/* Compose */}
      <div className="article-ai-compose">
        <div className="article-ai-compose-row">
          <textarea
            className="article-ai-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the change you want..."
            disabled={busy || hasPending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && prompt.trim()) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
          />
          <button
            type="button"
            className="article-ai-send-btn"
            onClick={() => void handleSubmit()}
            disabled={busy || !prompt.trim() || hasPending}
            title="Submit (Cmd+Enter)"
          >
            <IconSend size={14} />
          </button>
        </div>
      </div>
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

/* ---------- Folder Tree ---------- */

interface FolderTreeItem {
  type: 'folder';
  id: string;
  name: string;
  depth: number;
  children: (FolderTreeItem | ArticleTreeItem)[];
  articleCount: number;
}

interface ArticleTreeItem {
  type: 'article';
  node: ExplorerNode;
  depth: number;
}

function collectFolderIds(items: (FolderTreeItem | ArticleTreeItem)[]): string[] {
  const ids: string[] = [];

  function walk(nodes: (FolderTreeItem | ArticleTreeItem)[]) {
    for (const node of nodes) {
      if (node.type !== 'folder') {
        continue;
      }

      ids.push(node.id);
      walk(node.children);
    }
  }

  walk(items);
  return ids;
}

function getExpandedFolderStorageKey(workspaceId: string): string {
  return `${EXPANDED_FOLDER_STORAGE_KEY_PREFIX}:${workspaceId}`;
}

function readExpandedFolderPreference(workspaceId: string): {
  expandedFolders: Set<string>;
  hasStoredPreference: boolean;
} {
  if (typeof window === 'undefined') {
    return { expandedFolders: new Set(), hasStoredPreference: false };
  }

  try {
    const storedValue = window.localStorage.getItem(getExpandedFolderStorageKey(workspaceId));
    if (!storedValue) {
      return { expandedFolders: new Set(), hasStoredPreference: false };
    }

    const parsed = JSON.parse(storedValue);
    if (!Array.isArray(parsed)) {
      return { expandedFolders: new Set(), hasStoredPreference: false };
    }

    const folderIds = parsed.filter((value): value is string => typeof value === 'string');
    return { expandedFolders: new Set(folderIds), hasStoredPreference: true };
  } catch {
    return { expandedFolders: new Set(), hasStoredPreference: false };
  }
}

function writeExpandedFolderPreference(workspaceId: string, expandedFolders: Set<string>) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      getExpandedFolderStorageKey(workspaceId),
      JSON.stringify(Array.from(expandedFolders).sort())
    );
  } catch {
    // Ignore storage failures so the directory view still works in-memory.
  }
}

function buildFolderTree(nodes: ExplorerNode[]): (FolderTreeItem | ArticleTreeItem)[] {
  const categoryMap = new Map<string, { name: string; sections: Map<string, { name: string; articles: ExplorerNode[] }> }>();
  const uncategorized: ExplorerNode[] = [];

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
      const cat = categoryMap.get(catId)!;
      if (!cat.sections.has(secId)) {
        cat.sections.set(secId, { name: node.sectionName || secId, articles: [] });
      }
      cat.sections.get(secId)!.articles.push(node);
    } else if (secId) {
      // Section without category - treat section as top-level folder
      const syntheticCatId = `__section_${secId}`;
      if (!categoryMap.has(syntheticCatId)) {
        categoryMap.set(syntheticCatId, { name: node.sectionName || secId, sections: new Map() });
      }
      const cat = categoryMap.get(syntheticCatId)!;
      const directKey = '__direct__';
      if (!cat.sections.has(directKey)) {
        cat.sections.set(directKey, { name: '', articles: [] });
      }
      cat.sections.get(directKey)!.articles.push(node);
    } else if (catId) {
      // Category without section - articles directly under category
      if (!categoryMap.has(catId)) {
        categoryMap.set(catId, { name: node.categoryName || catId, sections: new Map() });
      }
      const cat = categoryMap.get(catId)!;
      const directKey = '__direct__';
      if (!cat.sections.has(directKey)) {
        cat.sections.set(directKey, { name: '', articles: [] });
      }
      cat.sections.get(directKey)!.articles.push(node);
    }
  }

  const result: (FolderTreeItem | ArticleTreeItem)[] = [];

  // Sort categories alphabetically
  const sortedCategories = [...categoryMap.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));

  for (const [catId, cat] of sortedCategories) {
    const categoryFolderId = catId.startsWith('__section_')
      ? `section:${catId.replace('__section_', '')}`
      : `category:${catId}`;
    const categoryFolder: FolderTreeItem = {
      type: 'folder',
      id: categoryFolderId,
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
      } else {
        const sectionFolder: FolderTreeItem = {
          type: 'folder',
          id: `${categoryFolderId}/section:${secId}`,
          name: sec.name,
          depth: 1,
          children: sortedArticles.map((article) => ({
            type: 'article' as const,
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
        id: 'folder:uncategorized',
        name: 'Uncategorized',
        depth: 0,
        children: sortedUncategorized.map((article) => ({
          type: 'article' as const,
          node: article,
          depth: 1,
        })),
        articleCount: sortedUncategorized.length,
      });
    } else {
      // No folder structure at all - just return flat articles
      for (const article of sortedUncategorized) {
        result.push({ type: 'article', node: article, depth: 0 });
      }
    }
  }

  return result;
}

function FolderRow({
  folder,
  expanded,
  onToggle,
}: {
  folder: FolderTreeItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const ChevronIcon = expanded ? IconChevronDown : IconChevronRight;
  const FolderIcon = expanded ? IconFolderOpen : IconFolder;

  return (
    <div
      className={`explorer-folder-row${expanded ? ' expanded' : ''}`}
      style={{ paddingLeft: `calc(${folder.depth * 20}px + var(--space-2))` }}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <ChevronIcon size={12} className="explorer-folder-chevron" />
      <FolderIcon size={15} className="explorer-folder-icon" />
      <span className="explorer-folder-name">{folder.name}</span>
      <span className="explorer-folder-count">{folder.articleCount}</span>
    </div>
  );
}

function ArticleRow({
  item,
  isSelected,
  onOpen,
  onHistoryClick,
}: {
  item: ArticleTreeItem;
  isSelected: boolean;
  onOpen: () => void;
  onHistoryClick: (e: React.MouseEvent) => void;
}) {
  const node = item.node;
  const totalDrafts = node.locales.reduce((sum, l) => sum + l.revision.draftCount, 0);
  const hasConflicts = node.locales.some((l) => l.hasConflicts);

  return (
    <div
      className={`explorer-article-row${isSelected ? ' selected' : ''}`}
      style={{ paddingLeft: `calc(${item.depth * 20}px + var(--space-2))` }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
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
          onClick={onHistoryClick}
          aria-label={`View history for ${node.title}`}
        >
          <IconClock size={11} />
          History
        </button>
      </div>
    </div>
  );
}

function FolderTreeView({
  items,
  expandedFolders,
  onToggleFolder,
  detailPanel,
  openArticleDetail,
}: {
  items: (FolderTreeItem | ArticleTreeItem)[];
  expandedFolders: Set<string>;
  onToggleFolder: (id: string) => void;
  detailPanel: { open: boolean; familyId: string };
  openArticleDetail: (node: ExplorerNode, tab: DetailTab) => void;
}) {
  const rows: React.ReactNode[] = [];

  function renderItems(items: (FolderTreeItem | ArticleTreeItem)[]) {
    for (const item of items) {
      if (item.type === 'folder') {
        const isExpanded = expandedFolders.has(item.id);
        rows.push(
          <FolderRow
            key={`folder-${item.id}`}
            folder={item}
            expanded={isExpanded}
            onToggle={() => onToggleFolder(item.id)}
          />
        );
        if (isExpanded) {
          renderItems(item.children);
        }
      } else {
        rows.push(
          <ArticleRow
            key={`article-${item.node.familyId}`}
            item={item}
            isSelected={detailPanel.open && detailPanel.familyId === item.node.familyId}
            onOpen={() => openArticleDetail(item.node, 'preview')}
            onHistoryClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openArticleDetail(item.node, 'history');
            }}
          />
        );
      }
    }
  }

  renderItems(items);

  return <div className="explorer-article-list">{rows}</div>;
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
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [folderPreferenceReady, setFolderPreferenceReady] = useState(false);
  const [hasStoredFolderPreference, setHasStoredFolderPreference] = useState(false);
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

  const openableTree = useMemo(() => (
    tree.filter((node) => node.locales.some((locale) => Boolean(locale.revision?.revisionId)))
  ), [tree]);

  const filterCounts = useMemo(() => {
    const counts = { all: 0, live: 0, drafts: 0, retired: 0, conflicted: 0 };
    openableTree.forEach((node) => {
      counts.all++;
      if (node.familyStatus === RevisionState.LIVE) counts.live++;
      if (node.familyStatus === RevisionState.RETIRED) counts.retired++;
      if (node.locales.some((l) => l.hasConflicts)) counts.conflicted++;
      if (node.locales.some((l) => l.revision.draftCount > 0)) counts.drafts++;
    });
    return counts;
  }, [openableTree]);

  const filteredTree = useMemo(() => {
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
  }, [openableTree, activeFilter, selectedLocale]);

  const availableLocales = useMemo(() => {
    const localeSet = new Set<string>();
    openableTree.forEach((node) => node.locales.forEach((l) => localeSet.add(l.locale)));
    return Array.from(localeSet).sort();
  }, [openableTree]);

  const allFolderTree = useMemo(() => buildFolderTree(openableTree), [openableTree]);
  const folderTree = useMemo(() => buildFolderTree(filteredTree), [filteredTree]);
  const topLevelFolderIds = useMemo(() => (
    allFolderTree
      .filter((item): item is FolderTreeItem => item.type === 'folder')
      .map((item) => item.id)
  ), [allFolderTree]);
  const allFolderIds = useMemo(() => new Set(collectFolderIds(allFolderTree)), [allFolderTree]);
  const visibleFolderCount = useMemo(() => collectFolderIds(folderTree).length, [folderTree]);

  useEffect(() => {
    if (!activeWorkspace) {
      setExpandedFolders(new Set());
      setHasStoredFolderPreference(false);
      setFolderPreferenceReady(false);
      return;
    }

    const { expandedFolders: storedFolders, hasStoredPreference } = readExpandedFolderPreference(activeWorkspace.id);
    setExpandedFolders(storedFolders);
    setHasStoredFolderPreference(hasStoredPreference);
    setFolderPreferenceReady(true);
  }, [activeWorkspace?.id]);

  useEffect(() => {
    if (!folderPreferenceReady) {
      return;
    }

    setExpandedFolders((prev) => {
      const filtered = Array.from(prev).filter((folderId) => allFolderIds.has(folderId));
      if (filtered.length === prev.size) {
        return prev;
      }

      return new Set(filtered);
    });
  }, [allFolderIds, folderPreferenceReady]);

  useEffect(() => {
    if (!folderPreferenceReady || hasStoredFolderPreference || topLevelFolderIds.length === 0) {
      return;
    }

    setExpandedFolders(new Set(topLevelFolderIds));
    setHasStoredFolderPreference(true);
  }, [folderPreferenceReady, hasStoredFolderPreference, topLevelFolderIds]);

  useEffect(() => {
    if (!activeWorkspace || !folderPreferenceReady) {
      return;
    }

    writeExpandedFolderPreference(activeWorkspace.id, expandedFolders);
  }, [activeWorkspace?.id, expandedFolders, folderPreferenceReady]);

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const expandAllFolders = useCallback(() => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      collectFolderIds(folderTree).forEach((folderId) => next.add(folderId));
      return next;
    });
  }, [folderTree]);

  const collapseAllFolders = useCallback(() => {
    if (folderTree.length === 0) {
      return;
    }

    const visibleFolderIds = new Set(collectFolderIds(folderTree));
    setExpandedFolders((prev) => new Set(Array.from(prev).filter((folderId) => !visibleFolderIds.has(folderId))));
  }, [folderTree]);

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
      localeVariantId: localeInfo.localeVariantId,
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

  const reloadCurrentDetail = useCallback(async () => {
    if (!detailPanel.detail) return;
    const node = tree.find((item) => item.familyId === detailPanel.familyId) ?? {
      familyId: detailPanel.familyId,
      title: detailPanel.familyTitle,
      familyStatus: RevisionState.LIVE,
      locales: detailPanel.localeVariants
    };
    await openArticleDetail(node, 'relations', detailPanel.localeVariantId, detailPanel.detail.revision.id);
  }, [detailPanel, tree, openArticleDetail]);

  const openRelatedFamily = useCallback(async (relatedFamilyId: string) => {
    const node = tree.find((item) => item.familyId === relatedFamilyId);
    if (!node) {
      return;
    }
    await openArticleDetail(node, 'relations');
  }, [tree, openArticleDetail]);

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
            <EditorPane className="detail-source-editor-pane">
              <CodeEditor value={detailPanel.detail.sourceHtml} language="html" readOnly />
            </EditorPane>
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
        {detailPanel.activeTab === 'relations' && activeWorkspace && (
          <RelationsPanel
            workspaceId={activeWorkspace.id}
            familyId={detailPanel.detail.familyId}
            relations={detailPanel.detail.relations}
            onChanged={reloadCurrentDetail}
            onOpenRelation={openRelatedFamily}
          />
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
              /* Folder tree view */
              <>
                <div className="explorer-directory-shell">
                  <div className="explorer-directory-header">
                    <div>
                      <div className="explorer-directory-eyebrow">Directory</div>
                      <div className="explorer-directory-title">Article library</div>
                    </div>
                    <div className="explorer-directory-summary">
                      <Badge variant="neutral">{filteredTree.length} famil{filteredTree.length === 1 ? 'y' : 'ies'}</Badge>
                      {visibleFolderCount > 0 && (
                        <Badge variant="neutral">{visibleFolderCount} folder{visibleFolderCount !== 1 ? 's' : ''}</Badge>
                      )}
                    </div>
                  </div>
                  {folderTree.some((item) => item.type === 'folder') && (
                    <div className="explorer-tree-toolbar">
                      <div className="explorer-tree-toolbar-copy">
                        Collapse and expand state is saved per workspace.
                      </div>
                      <div className="explorer-tree-toolbar-actions">
                        <button className="btn btn-ghost btn-xs" onClick={expandAllFolders}>
                          Expand all
                        </button>
                        <button className="btn btn-ghost btn-xs" onClick={collapseAllFolders}>
                          Collapse all
                        </button>
                      </div>
                    </div>
                  )}
                  <FolderTreeView
                    items={folderTree}
                    expandedFolders={expandedFolders}
                    onToggleFolder={toggleFolder}
                    detailPanel={detailPanel}
                    openArticleDetail={openArticleDetail}
                  />
                </div>
              </>
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
