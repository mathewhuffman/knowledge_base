import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ArticleNeighborhoodResponse,
  ArticleRelationEvidence,
  ArticleRelationRefreshStatusResponse,
  FeatureMapSummaryResponse,
  FeatureScopeResponse,
  JobEvent,
  KBScopeDisplayNameRecord,
  SearchResponse
} from '@kb-vault/shared-types';
import { JobState } from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { Badge } from '../components/Badge';
import {
  IconAlertCircle,
  IconArrowUpRight,
  IconLayers,
  IconLink,
  IconRefreshCw,
  IconSearch
} from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc, useIpcMutation } from '../hooks/useIpc';

type FeatureView = 'features' | 'category' | 'section' | 'article';
type FeatureSortField = 'stale' | 'bridge' | 'internal' | 'articles' | 'name';

type ScopeSummary = FeatureScopeResponse['summary'];
type ScopeArticle = FeatureScopeResponse['articles'][number];
type ScopeCluster = FeatureScopeResponse['clusters'][number];
type ScopeBridge = FeatureScopeResponse['bridges'][number];
type ScopeRelation = FeatureScopeResponse['relations'][number];
type NeighborhoodNode = ArticleNeighborhoodResponse['nodes'][number];
type NeighborhoodEdge = ArticleNeighborhoodResponse['edges'][number];

type FeatureCard = {
  key: string;
  scopeType: 'category' | 'section';
  scopeId?: string;
  label: string;
  scopeLabel: KBScopeDisplayNameRecord;
  parentScopeId?: string;
  parentLabel?: string;
  articleCount: number;
  clusterCount: number;
  internalEdgeCount: number;
  bridgeEdgeCount: number;
  staleDocumentCount: number;
  manualEdgeCount: number;
  inferredEdgeCount: number;
};

type GraphNode = {
  familyId: string;
  title: string;
  sectionId?: string;
  categoryId?: string;
  degree: number;
};

type GraphEdge = {
  relationId: string;
  leftFamilyId: string;
  rightFamilyId: string;
  relationType: string;
  origin: string;
  status: string;
  strengthScore: number;
  evidence: ArticleRelationEvidence[];
};

type GraphLayoutPoint = {
  x: number;
  y: number;
};

type TaxonomyAwareArticle = {
  sectionId?: string;
  categoryId?: string;
  sectionSource?: ScopeArticle['sectionSource'];
  categorySource?: ScopeArticle['categorySource'];
  taxonomyConfidence?: number;
};

const DEFAULT_MIN_SCORE = 0;
const DEFAULT_SORT: FeatureSortField = 'stale';
const DEFAULT_GRAPH_WIDTH = 960;
const DEFAULT_GRAPH_HEIGHT = 560;
const GRAPH_LAYOUT_PADDING_X = 84;
const GRAPH_LAYOUT_PADDING_Y = 72;

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
      description: 'The last saved-relation refresh was canceled.'
    };
  }

  if (latestRun?.status === 'complete') {
    return {
      label: summary?.degradedMode ? 'degraded' : 'healthy',
      variant: summary?.degradedMode ? 'warning' : 'success',
      description: summary?.degradedMode
        ? 'Using a stale derived index fallback.'
        : 'Derived index and saved relations are available.'
    };
  }

  if (hasIndex) {
    return {
      label: 'index ready',
      variant: 'primary',
      description: 'The derived search index is built. Run Full Relation Analysis to refresh persisted inferred relations.'
    };
  }

  return {
    label: 'idle',
    variant: 'neutral',
    description: 'Run Full Relation Analysis to build the relation index and refresh inferred relations.'
  };
}

function relationTypeLabel(type: string): string {
  switch (type) {
    case 'same_workflow': return 'Same Workflow';
    case 'prerequisite': return 'Prerequisite';
    case 'follow_up': return 'Follow Up';
    case 'parent_topic': return 'Parent Topic';
    case 'child_topic': return 'Child Topic';
    case 'shared_surface': return 'Shared Surface';
    case 'replaces': return 'Replaces';
    case 'see_also':
    default:
      return 'See Also';
  }
}

function evidenceTypeLabel(type: string): string {
  switch (type) {
    case 'explicit_link': return 'Explicit Link';
    case 'external_key_exact': return 'External Key';
    case 'alias_exact': return 'Alias Match';
    case 'title_fts': return 'Title Match';
    case 'heading_fts': return 'Heading Match';
    case 'body_chunk_fts': return 'Body Match';
    case 'same_section': return 'Same Section';
    case 'same_category': return 'Same Category';
    case 'manual_relation': return 'Manual Relation';
    case 'manual_note': return 'Manual Note';
    default:
      return type.replace(/_/g, ' ');
  }
}

function clusterLabelSourceLabel(labelSource: ScopeCluster['labelSource']): string {
  switch (labelSource) {
    case 'derived_keywords':
      return 'derived keywords';
    case 'manual':
      return 'manual';
    case 'representative_article':
    default:
      return 'article title';
  }
}

function scopeLabelSourceLabel(labelSource: KBScopeDisplayNameRecord['labelSource']): string {
  switch (labelSource) {
    case 'catalog':
      return 'catalog';
    case 'override':
      return 'override';
    case 'fallback':
    default:
      return 'fallback';
  }
}

function scopeLabelSourceVariant(
  labelSource: KBScopeDisplayNameRecord['labelSource']
): 'neutral' | 'primary' | 'success' | 'warning' {
  switch (labelSource) {
    case 'catalog':
      return 'success';
    case 'override':
      return 'primary';
    case 'fallback':
    default:
      return 'warning';
  }
}

function articleTaxonomyBadge(
  article: TaxonomyAwareArticle | null | undefined
): { label: string; variant: 'neutral' | 'primary' | 'success' | 'warning' } | null {
  if (!article) {
    return null;
  }

  const sources = [article.sectionSource, article.categorySource].filter(Boolean);
  if (sources.some((source) => source?.startsWith('inferred_'))) {
    return {
      label: 'inferred taxonomy',
      variant: 'primary'
    };
  }
  if (sources.includes('manual_override')) {
    return {
      label: 'manual override',
      variant: 'primary'
    };
  }
  if (article.categorySource === 'zendesk_section_parent') {
    return {
      label: 'derived category',
      variant: 'success'
    };
  }
  if (sources.includes('zendesk_article')) {
    return {
      label: 'zendesk taxonomy',
      variant: 'success'
    };
  }

  return null;
}

function taxonomyStatusLabel(status: FeatureMapSummaryResponse['taxonomyStatus']['status'] | undefined): string {
  switch (status) {
    case 'ready':
      return 'taxonomy ready';
    case 'partial':
      return 'taxonomy partial';
    case 'missing':
    default:
      return 'taxonomy missing';
  }
}

function taxonomyStatusVariant(
  status: FeatureMapSummaryResponse['taxonomyStatus']['status'] | undefined
): 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'ready':
      return 'success';
    case 'partial':
      return 'warning';
    case 'missing':
    default:
      return 'danger';
  }
}

function taxonomyStatusDescription(taxonomyStatus: FeatureMapSummaryResponse['taxonomyStatus'] | null | undefined): string {
  if (!taxonomyStatus) {
    return 'Loading category and section naming status.';
  }

  if (taxonomyStatus.status === 'ready') {
    return 'Category and section names are coming from synced KB taxonomy data or explicit overrides.';
  }

  if (taxonomyStatus.status === 'partial') {
    return `${taxonomyStatus.fallbackScopeCount} scope label${taxonomyStatus.fallbackScopeCount === 1 ? ' is' : 's are'} still using fallback naming.`;
  }

  return 'This workspace is still relying on fallback category or section labels derived from raw scope IDs.';
}

function formatEvidenceMetadata(metadata: unknown): string | null {
  if (!metadata) return null;
  if (typeof metadata === 'string') return metadata;
  try {
    return JSON.stringify(metadata);
  } catch {
    return null;
  }
}

function dedupeSearchResults(results: SearchResponse['results']): SearchResponse['results'] {
  return results.filter((result, index, all) => (
    all.findIndex((candidate) => candidate.familyId === result.familyId) === index
  ));
}

function buildScopeKey(scopeType: 'category' | 'section', scopeId?: string): string {
  return `${scopeType}::${scopeId ?? '__none__'}`;
}

function extractScopeId(scopeKey: string | null): string | undefined {
  if (!scopeKey) return undefined;
  const [, rawScopeId = ''] = scopeKey.split('::');
  return rawScopeId === '__none__' ? undefined : rawScopeId;
}

function sortFeatureCards(cards: FeatureCard[], sortField: FeatureSortField): FeatureCard[] {
  const sorted = cards.slice();
  sorted.sort((left, right) => {
    switch (sortField) {
      case 'stale':
        return right.staleDocumentCount - left.staleDocumentCount
          || right.bridgeEdgeCount - left.bridgeEdgeCount
          || right.internalEdgeCount - left.internalEdgeCount
          || right.articleCount - left.articleCount
          || left.label.localeCompare(right.label);
      case 'bridge':
        return right.bridgeEdgeCount - left.bridgeEdgeCount
          || right.staleDocumentCount - left.staleDocumentCount
          || right.internalEdgeCount - left.internalEdgeCount
          || right.articleCount - left.articleCount
          || left.label.localeCompare(right.label);
      case 'internal':
        return right.internalEdgeCount - left.internalEdgeCount
          || right.bridgeEdgeCount - left.bridgeEdgeCount
          || right.articleCount - left.articleCount
          || right.staleDocumentCount - left.staleDocumentCount
          || left.label.localeCompare(right.label);
      case 'articles':
        return right.articleCount - left.articleCount
          || right.internalEdgeCount - left.internalEdgeCount
          || right.bridgeEdgeCount - left.bridgeEdgeCount
          || right.staleDocumentCount - left.staleDocumentCount
          || left.label.localeCompare(right.label);
      case 'name':
      default:
        return left.label.localeCompare(right.label);
    }
  });
  return sorted;
}

function buildGraphRingCapacities(nodeCount: number): number[] {
  const capacities: number[] = [];
  let remaining = nodeCount;
  let ringIndex = 1;

  while (remaining > 0) {
    const capacity = Math.max(8, ringIndex * 8);
    capacities.push(capacity);
    remaining -= capacity;
    ringIndex += 1;
  }

  return capacities;
}

function buildGraphLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  centerFamilyId?: string
): Map<string, GraphLayoutPoint> {
  const layout = new Map<string, GraphLayoutPoint>();
  if (nodes.length === 0) {
    return layout;
  }

  const centerX = width / 2;
  const centerY = height / 2;
  const degreeByNode = new Map<string, number>();
  for (const node of nodes) {
    degreeByNode.set(node.familyId, node.degree);
  }
  for (const edge of edges) {
    degreeByNode.set(edge.leftFamilyId, (degreeByNode.get(edge.leftFamilyId) ?? 0) + 1);
    degreeByNode.set(edge.rightFamilyId, (degreeByNode.get(edge.rightFamilyId) ?? 0) + 1);
  }

  const ordered = nodes.slice().sort((left, right) => (
    (degreeByNode.get(right.familyId) ?? 0) - (degreeByNode.get(left.familyId) ?? 0)
    || left.title.localeCompare(right.title)
  ));
  const seedNode = centerFamilyId
    ? ordered.find((node) => node.familyId === centerFamilyId)
    : ordered[0];
  if (!seedNode) {
    return layout;
  }

  layout.set(seedNode.familyId, { x: centerX, y: centerY });
  const remaining = ordered.filter((node) => node.familyId !== seedNode.familyId);
  if (remaining.length === 0) {
    return layout;
  }

  const ringCapacities = buildGraphRingCapacities(remaining.length);
  const maxRadiusX = (width / 2) - GRAPH_LAYOUT_PADDING_X;
  const maxRadiusY = (height / 2) - GRAPH_LAYOUT_PADDING_Y;
  let offset = 0;

  for (let ringIndex = 0; ringIndex < ringCapacities.length && offset < remaining.length; ringIndex += 1) {
    const capacity = ringCapacities[ringIndex];
    const slice = remaining.slice(offset, offset + capacity);
    const radiusFactor = ringCapacities.length === 1
      ? 0.58
      : 0.24 + (0.68 * (ringIndex / Math.max(1, ringCapacities.length - 1)));
    const radiusX = maxRadiusX * radiusFactor;
    const radiusY = maxRadiusY * radiusFactor;
    const angleOffset = ringIndex % 2 === 0 ? 0 : Math.PI / Math.max(1, slice.length);

    slice.forEach((node, index) => {
      const angle = ((Math.PI * 2) / Math.max(1, slice.length)) * index - (Math.PI / 2) + angleOffset;
      layout.set(node.familyId, {
        x: centerX + (Math.cos(angle) * radiusX),
        y: centerY + (Math.sin(angle) * radiusY)
      });
    });
    offset += slice.length;
  }

  return layout;
}

function edgeStrokeColor(edge: GraphEdge): string {
  if (edge.status === 'suppressed') return 'var(--gray-500)';
  if (edge.origin === 'manual') return 'var(--color-success)';
  return 'var(--color-primary)';
}

function edgeStrokeWidth(edge: GraphEdge, selected: boolean): number {
  const base = edge.origin === 'manual' ? 2.8 : 2;
  const scoreBoost = Math.max(0, Math.min(2.2, edge.strengthScore));
  return selected ? base + scoreBoost + 1.5 : base + scoreBoost;
}

function nodeRadius(node: GraphNode): number {
  return 22 + Math.min(16, node.degree * 2.2);
}

function useGraphViewport() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: DEFAULT_GRAPH_WIDTH, height: DEFAULT_GRAPH_HEIGHT });

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      const nextWidth = Math.max(680, Math.round(element.clientWidth || DEFAULT_GRAPH_WIDTH));
      const nextHeight = Math.max(420, Math.min(640, Math.round(nextWidth * 0.6)));
      setSize((current) => (
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight }
      ));
    };

    updateSize();
    const observer = new ResizeObserver(() => updateSize());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

function useViewportWidth() {
  const [width, setWidth] = useState(() => (
    typeof window === 'undefined' ? 1440 : window.innerWidth
  ));

  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return width;
}

function countUniqueArticles(summary: FeatureMapSummaryResponse | null): number {
  return summary?.categories.reduce((total, category) => total + category.articleCount, 0) ?? 0;
}

function countUniqueSections(summary: FeatureMapSummaryResponse | null): number {
  return summary?.categories.reduce((total, category) => total + category.sectionCount, 0) ?? 0;
}

function countTotalClusters(summary: FeatureMapSummaryResponse | null): number {
  return summary?.categories.reduce((total, category) => total + category.clusterCount, 0) ?? 0;
}

function countTotalBridges(summary: FeatureMapSummaryResponse | null): number {
  return summary?.categories.reduce((total, category) => total + category.bridgeEdgeCount, 0) ?? 0;
}

function countTotalStale(summary: FeatureMapSummaryResponse | null): number {
  return summary?.categories.reduce((total, category) => total + category.staleDocumentCount, 0) ?? 0;
}

function DetailStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 4,
        padding: 'var(--space-3)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-bg)'
      }}
    >
      <span style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', color: 'var(--color-text-secondary)', letterSpacing: '0.03em' }}>
        {label}
      </span>
      <span style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>
        {value}
      </span>
    </div>
  );
}

function ScopeMetricBadges({ summary }: { summary: ScopeSummary | undefined }) {
  if (!summary) return null;
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <Badge variant="neutral">{summary.articleCount} articles</Badge>
      <Badge variant="neutral">{summary.clusterCount} clusters</Badge>
      <Badge variant="neutral">{summary.internalEdgeCount} internal</Badge>
      <Badge variant="neutral">{summary.bridgeEdgeCount} bridges</Badge>
      <Badge variant={summary.staleDocumentCount > 0 ? 'warning' : 'neutral'}>
        {summary.staleDocumentCount} stale docs
      </Badge>
      <Badge variant="success">{summary.manualEdgeCount} manual</Badge>
      <Badge variant="primary">{summary.inferredEdgeCount} inferred</Badge>
    </div>
  );
}

function FeatureListItem({
  item,
  active,
  onClick
}: {
  item: FeatureCard;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'grid',
        gap: 'var(--space-2)',
        width: '100%',
        textAlign: 'left',
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-lg)',
        border: active ? '1px solid color-mix(in srgb, var(--color-primary) 54%, white)' : '1px solid var(--color-border)',
        background: active
          ? 'linear-gradient(180deg, color-mix(in srgb, var(--color-primary) 10%, var(--color-bg)) 0%, var(--color-bg) 100%)'
          : 'var(--color-bg)',
        boxShadow: active ? 'var(--shadow-sm)' : 'var(--shadow-xs)',
        cursor: 'pointer'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>{item.label}</span>
            <Badge variant={scopeLabelSourceVariant(item.scopeLabel.labelSource)}>
              {scopeLabelSourceLabel(item.scopeLabel.labelSource)}
            </Badge>
          </div>
          {item.parentLabel ? (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>{item.parentLabel}</span>
          ) : null}
        </div>
        <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
          <Badge variant={item.staleDocumentCount > 0 ? 'warning' : 'neutral'}>{item.articleCount} articles</Badge>
          {item.staleDocumentCount > 0 ? (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warning)' }}>
              {item.staleDocumentCount} stale
            </span>
          ) : null}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <Badge variant="neutral">{item.clusterCount} clusters</Badge>
        <Badge variant="neutral">{item.internalEdgeCount} internal</Badge>
        <Badge variant="neutral">{item.bridgeEdgeCount} bridges</Badge>
        <Badge variant={item.staleDocumentCount > 0 ? 'warning' : 'neutral'}>
          {item.staleDocumentCount} stale
        </Badge>
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
        {item.manualEdgeCount} manual / {item.inferredEdgeCount} inferred
      </div>
    </button>
  );
}

function TaxonomyStatusCard({
  taxonomyStatus
}: {
  taxonomyStatus: FeatureMapSummaryResponse['taxonomyStatus'] | undefined;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-bg)',
        boxShadow: 'var(--shadow-xs)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Taxonomy Status
          </span>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
            {taxonomyStatusDescription(taxonomyStatus)}
          </span>
        </div>
        <Badge variant={taxonomyStatusVariant(taxonomyStatus?.status)}>
          {taxonomyStatusLabel(taxonomyStatus?.status)}
        </Badge>
      </div>
      {taxonomyStatus ? (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Badge variant="neutral">{taxonomyStatus.totalScopeCount} scopes</Badge>
          <Badge variant="success">{taxonomyStatus.catalogScopeCount} catalog</Badge>
          <Badge variant="primary">{taxonomyStatus.overrideScopeCount} override</Badge>
          <Badge variant={taxonomyStatus.fallbackScopeCount > 0 ? 'warning' : 'neutral'}>
            {taxonomyStatus.fallbackScopeCount} fallback
          </Badge>
        </div>
      ) : null}
    </div>
  );
}

function RelationGraph({
  title,
  nodes,
  edges,
  centerFamilyId,
  selectedEdgeId,
  onSelectEdge,
  onSelectNode
}: {
  title: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  centerFamilyId?: string;
  selectedEdgeId: string | null;
  onSelectEdge: (relationId: string) => void;
  onSelectNode: (familyId: string) => void;
}) {
  const { ref, size } = useGraphViewport();
  const layout = useMemo(
    () => buildGraphLayout(nodes, edges, size.width, size.height, centerFamilyId),
    [centerFamilyId, edges, nodes, size.height, size.width]
  );

  return (
    <div className="card" style={{ minHeight: 0 }}>
      <div className="card-header">
        <span className="card-header-title">{title}</span>
      </div>
      <div className="card-body" ref={ref} style={{ minHeight: 0 }}>
        {nodes.length === 0 ? (
          <EmptyState
            icon={<IconLayers size={36} />}
            title="No graph to render"
            description="Select a cluster or article neighborhood with visible relations."
          />
        ) : (
          <svg
            width="100%"
            viewBox={`0 0 ${size.width} ${size.height}`}
            style={{
              borderRadius: 18,
              background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.04), rgba(15, 23, 42, 0))'
            }}
          >
            <defs>
              <filter id="feature-map-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="8" stdDeviation="12" floodOpacity="0.18" />
              </filter>
            </defs>

            {edges.map((edge) => {
              const left = layout.get(edge.leftFamilyId);
              const right = layout.get(edge.rightFamilyId);
              if (!left || !right) return null;
              const isSelected = edge.relationId === selectedEdgeId;
              return (
                <line
                  key={edge.relationId}
                  x1={left.x}
                  y1={left.y}
                  x2={right.x}
                  y2={right.y}
                  stroke={edgeStrokeColor(edge)}
                  strokeWidth={edgeStrokeWidth(edge, isSelected)}
                  strokeDasharray={edge.status === 'suppressed' ? '10 8' : undefined}
                  strokeOpacity={isSelected ? 0.96 : 0.54}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelectEdge(edge.relationId)}
                />
              );
            })}

            {nodes.map((node) => {
              const point = layout.get(node.familyId);
              if (!point) return null;
              const radius = nodeRadius(node);
              const isCenter = node.familyId === centerFamilyId;
              return (
                <g
                  key={node.familyId}
                  transform={`translate(${point.x}, ${point.y})`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelectNode(node.familyId)}
                >
                  <circle
                    r={radius + 10}
                    fill={isCenter ? 'rgba(37, 99, 235, 0.14)' : 'rgba(15, 23, 42, 0.06)'}
                  />
                  <circle
                    r={radius}
                    fill={isCenter ? 'var(--color-primary)' : 'white'}
                    stroke={isCenter ? 'rgba(37, 99, 235, 0.9)' : 'rgba(15, 23, 42, 0.16)'}
                    strokeWidth={isCenter ? 3 : 2}
                    filter="url(#feature-map-shadow)"
                  />
                  <text
                    textAnchor="middle"
                    y={4}
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      fill: isCenter ? 'white' : 'var(--color-text)',
                      pointerEvents: 'none'
                    }}
                  >
                    {node.title.length > 18 ? `${node.title.slice(0, 18)}…` : node.title}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

function EdgeEvidenceCard({
  edge,
  leftTitle,
  rightTitle
}: {
  edge: GraphEdge | null;
  leftTitle?: string;
  rightTitle?: string;
}) {
  if (!edge) {
    return (
      <div className="card">
        <div className="card-header">
          <span className="card-header-title">Edge Evidence</span>
        </div>
        <div className="card-body">
          <EmptyState
            icon={<IconLayers size={34} />}
            title="No edge selected"
            description="Select a relation edge from a cluster or article neighborhood graph to inspect its evidence."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-header-title">Edge Evidence</span>
      </div>
      <div className="card-body" style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>
            {leftTitle ?? edge.leftFamilyId} <span style={{ color: 'var(--color-text-secondary)' }}>to</span> {rightTitle ?? edge.rightFamilyId}
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Badge variant={edge.origin === 'manual' ? 'success' : 'primary'}>
              {edge.origin}
            </Badge>
            <Badge variant={edge.status === 'suppressed' ? 'warning' : 'neutral'}>
              {edge.status}
            </Badge>
            <Badge variant="neutral">{relationTypeLabel(edge.relationType)}</Badge>
            <Badge variant="neutral">score {edge.strengthScore.toFixed(2)}</Badge>
          </div>
        </div>

        {edge.evidence.length === 0 ? (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
            No saved evidence is attached to this relation.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            {edge.evidence.map((evidence) => (
              <div
                key={evidence.id}
                style={{
                  display: 'grid',
                  gap: 6,
                  padding: 'var(--space-3)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--color-bg-subtle)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                  <span style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>
                    {evidenceTypeLabel(evidence.evidenceType)}
                  </span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                    weight {evidence.weight.toFixed(2)}
                  </span>
                </div>
                {evidence.snippet ? (
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>{evidence.snippet}</div>
                ) : null}
                {evidence.sourceRef ? (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                    source {evidence.sourceRef}
                  </div>
                ) : null}
                {formatEvidenceMetadata(evidence.metadata) ? (
                  <pre
                    style={{
                      margin: 0,
                      padding: 'var(--space-2)',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-bg)',
                      overflowX: 'auto',
                      fontSize: 'var(--text-xs)'
                    }}
                  >
                    {formatEvidenceMetadata(evidence.metadata)}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const ArticleRelationsGraph = () => {
  const { activeWorkspace } = useWorkspace();
  const summaryQuery = useIpc<FeatureMapSummaryResponse>('article.relations.feature-map.summary');
  const scopeQuery = useIpc<FeatureScopeResponse>('article.relations.feature-map.scope');
  const neighborhoodQuery = useIpc<ArticleNeighborhoodResponse>('article.relations.neighborhood');
  const searchQuery = useIpc<SearchResponse>('workspace.search');
  const relationStatusQuery = useIpc<ArticleRelationRefreshStatusResponse>('article.relations.status');
  const rebuildMutation = useIpcMutation<{
    documentCount: number;
    chunkCount: number;
    aliasCount: number;
    linkCount: number;
  }>('article.relations.rebuild');
  const viewportWidth = useViewportWidth();

  const [view, setView] = useState<FeatureView>('features');
  const [sortField, setSortField] = useState<FeatureSortField>(DEFAULT_SORT);
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(null);
  const [selectedSectionKey, setSelectedSectionKey] = useState<string | null>(null);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [selectedScopeEdgeId, setSelectedScopeEdgeId] = useState<string | null>(null);
  const [selectedNeighborhoodEdgeId, setSelectedNeighborhoodEdgeId] = useState<string | null>(null);
  const [includeBridges, setIncludeBridges] = useState(true);
  const [includeSuppressed, setIncludeSuppressed] = useState(false);
  const [hopCount, setHopCount] = useState<1 | 2>(1);
  const [minScore, setMinScore] = useState(DEFAULT_MIN_SCORE);
  const [jumpToArticleText, setJumpToArticleText] = useState('');
  const [rebuildMessage, setRebuildMessage] = useState<string | null>(null);
  const [relationJob, setRelationJob] = useState<JobEvent | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [articleReturnView, setArticleReturnView] = useState<'features' | 'category' | 'section'>('features');
  const [selectedBridgeState, setSelectedBridgeState] = useState<{
    bridge: ScopeBridge;
    sourceScope: FeatureScopeResponse['scope'];
  } | null>(null);

  const stackedPanes = viewportWidth < 1320;

  useEffect(() => {
    if (!activeWorkspace) {
      return;
    }
    void summaryQuery.execute({ workspaceId: activeWorkspace.id });
    void relationStatusQuery.execute({ workspaceId: activeWorkspace.id });
  }, [activeWorkspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeWorkspace) {
      return;
    }

    const unsubscribe = window.kbv.emitJobEvents((event) => {
      if (event.command !== 'article.relations.refresh') return;
      setRelationJob(event);
      if (event.state === 'SUCCEEDED' || event.state === 'FAILED' || event.state === 'CANCELED') {
        void summaryQuery.execute({ workspaceId: activeWorkspace.id });
        void relationStatusQuery.execute({ workspaceId: activeWorkspace.id });
        if (view === 'category' && selectedCategoryKey) {
          void scopeQuery.execute({
            workspaceId: activeWorkspace.id,
            scopeType: 'category',
            scopeId: extractScopeId(selectedCategoryKey),
            includeBridges,
            includeSuppressed,
            minScore
          });
        }
        if (view === 'section' && selectedSectionKey) {
          void scopeQuery.execute({
            workspaceId: activeWorkspace.id,
            scopeType: 'section',
            scopeId: extractScopeId(selectedSectionKey),
            includeBridges,
            includeSuppressed,
            minScore
          });
        }
        if (view === 'article' && selectedFamilyId) {
          void neighborhoodQuery.execute({
            workspaceId: activeWorkspace.id,
            familyId: selectedFamilyId,
            includeSuppressed,
            minScore,
            hopCount
          });
        }
      }
    });

    return () => unsubscribe();
  }, [
    activeWorkspace?.id,
    hopCount,
    includeBridges,
    includeSuppressed,
    minScore,
    selectedCategoryKey,
    selectedFamilyId,
    selectedSectionKey,
    view
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeWorkspace || jumpToArticleText.trim().length < 2) {
      return;
    }
    const timeout = setTimeout(() => {
      void searchQuery.execute({
        workspaceId: activeWorkspace.id,
        query: jumpToArticleText.trim(),
        scope: 'all',
        includeArchived: true
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [activeWorkspace?.id, jumpToArticleText]); // eslint-disable-line react-hooks/exhaustive-deps

  const categoryCards = useMemo<FeatureCard[]>(() => (
    sortFeatureCards(
      (summaryQuery.data?.categories ?? []).map((category) => ({
        key: buildScopeKey('category', category.categoryId),
        scopeType: 'category',
        scopeId: category.categoryId,
        label: category.categoryName,
        scopeLabel: category.categoryLabel,
        articleCount: category.articleCount,
        clusterCount: category.clusterCount,
        internalEdgeCount: category.internalEdgeCount,
        bridgeEdgeCount: category.bridgeEdgeCount,
        staleDocumentCount: category.staleDocumentCount,
        manualEdgeCount: category.manualEdgeCount,
        inferredEdgeCount: category.inferredEdgeCount
      })),
      sortField
    )
  ), [sortField, summaryQuery.data?.categories]);

  const sectionCards = useMemo<FeatureCard[]>(() => (
    sortFeatureCards(
      (summaryQuery.data?.categories ?? []).flatMap((category) => (
        category.sections.map((section) => ({
          key: buildScopeKey('section', section.sectionId),
          scopeType: 'section' as const,
          scopeId: section.sectionId,
          label: section.sectionName,
          scopeLabel: section.sectionLabel,
          parentScopeId: category.categoryId,
          parentLabel: category.categoryName,
          articleCount: section.articleCount,
          clusterCount: section.clusterCount,
          internalEdgeCount: section.internalEdgeCount,
          bridgeEdgeCount: section.bridgeEdgeCount,
          staleDocumentCount: section.staleDocumentCount,
          manualEdgeCount: section.manualEdgeCount,
          inferredEdgeCount: section.inferredEdgeCount
        }))
      )),
      sortField
    )
  ), [sortField, summaryQuery.data?.categories]);

  useEffect(() => {
    if (!selectedCategoryKey && categoryCards.length > 0) {
      setSelectedCategoryKey(categoryCards[0].key);
    }
    if (!selectedSectionKey && sectionCards.length > 0) {
      setSelectedSectionKey(sectionCards[0].key);
    }
  }, [categoryCards, sectionCards, selectedCategoryKey, selectedSectionKey]);

  const selectedCategoryCard = useMemo(
    () => categoryCards.find((item) => item.key === selectedCategoryKey) ?? null,
    [categoryCards, selectedCategoryKey]
  );
  const selectedSectionCard = useMemo(
    () => sectionCards.find((item) => item.key === selectedSectionKey) ?? null,
    [sectionCards, selectedSectionKey]
  );

  useEffect(() => {
    if (!activeWorkspace) {
      return;
    }
    if (view === 'category' && selectedCategoryKey) {
      void scopeQuery.execute({
        workspaceId: activeWorkspace.id,
        scopeType: 'category',
        scopeId: extractScopeId(selectedCategoryKey),
        includeBridges,
        includeSuppressed,
        minScore
      });
      return;
    }
    if (view === 'section' && selectedSectionKey) {
      void scopeQuery.execute({
        workspaceId: activeWorkspace.id,
        scopeType: 'section',
        scopeId: extractScopeId(selectedSectionKey),
        includeBridges,
        includeSuppressed,
        minScore
      });
      return;
    }
    scopeQuery.reset();
  }, [
    activeWorkspace?.id,
    includeBridges,
    includeSuppressed,
    minScore,
    selectedCategoryKey,
    selectedSectionKey,
    view
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeWorkspace || view !== 'article' || !selectedFamilyId) {
      neighborhoodQuery.reset();
      return;
    }
    void neighborhoodQuery.execute({
      workspaceId: activeWorkspace.id,
      familyId: selectedFamilyId,
      includeSuppressed,
      minScore,
      hopCount
    });
  }, [activeWorkspace?.id, hopCount, includeSuppressed, minScore, selectedFamilyId, view]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scopeQuery.data?.clusters?.length) {
      setSelectedClusterId((current) => (
        current && scopeQuery.data?.clusters.some((cluster) => cluster.clusterId === current)
          ? current
          : scopeQuery.data?.clusters[0]?.clusterId ?? null
      ));
    } else {
      setSelectedClusterId(null);
    }
  }, [scopeQuery.data?.clusters]);

  const familySearchResults = useMemo(
    () => dedupeSearchResults(searchQuery.data?.results ?? []),
    [searchQuery.data?.results]
  );

  const scopeArticlesById = useMemo(() => new Map(
    (scopeQuery.data?.articles ?? []).map((article) => [article.familyId, article])
  ), [scopeQuery.data?.articles]);

  const selectedCluster = useMemo<ScopeCluster | null>(() => (
    (scopeQuery.data?.clusters ?? []).find((cluster) => cluster.clusterId === selectedClusterId) ?? null
  ), [scopeQuery.data?.clusters, selectedClusterId]);

  const selectedClusterGraphNodes = useMemo<GraphNode[]>(() => {
    if (!selectedCluster) return [];
    const clusterArticleIdSet = new Set(selectedCluster.articleIds);
    const degreeById = new Map<string, number>();
    for (const familyId of clusterArticleIdSet) {
      degreeById.set(familyId, 0);
    }
    for (const relation of scopeQuery.data?.relations ?? []) {
      if (clusterArticleIdSet.has(relation.leftFamilyId) && clusterArticleIdSet.has(relation.rightFamilyId)) {
        degreeById.set(relation.leftFamilyId, (degreeById.get(relation.leftFamilyId) ?? 0) + 1);
        degreeById.set(relation.rightFamilyId, (degreeById.get(relation.rightFamilyId) ?? 0) + 1);
      }
    }
    return selectedCluster.articleIds
      .map((familyId) => scopeArticlesById.get(familyId))
      .filter((article): article is ScopeArticle => Boolean(article))
      .map((article) => ({
        familyId: article.familyId,
        title: article.title,
        sectionId: article.sectionId,
        categoryId: article.categoryId,
        degree: degreeById.get(article.familyId) ?? 0
      }));
  }, [scopeArticlesById, scopeQuery.data?.relations, selectedCluster]);

  const selectedClusterGraphEdges = useMemo<GraphEdge[]>(() => {
    if (!selectedCluster) return [];
    const clusterArticleIdSet = new Set(selectedCluster.articleIds);
    return (scopeQuery.data?.relations ?? [])
      .filter((relation) => (
        clusterArticleIdSet.has(relation.leftFamilyId)
        && clusterArticleIdSet.has(relation.rightFamilyId)
      ))
      .map((relation) => ({
        relationId: relation.relationId,
        leftFamilyId: relation.leftFamilyId,
        rightFamilyId: relation.rightFamilyId,
        relationType: relation.relationType,
        origin: relation.origin,
        status: relation.status,
        strengthScore: relation.strengthScore,
        evidence: relation.evidence
      }));
  }, [scopeQuery.data?.relations, selectedCluster]);

  const selectedScopeEdge = useMemo<GraphEdge | null>(() => (
    selectedClusterGraphEdges.find((edge) => edge.relationId === selectedScopeEdgeId) ?? null
  ), [selectedClusterGraphEdges, selectedScopeEdgeId]);

  const neighborhoodGraphNodes = useMemo<GraphNode[]>(() => (
    (neighborhoodQuery.data?.nodes ?? []).map((node) => ({
      familyId: node.familyId,
      title: node.title,
      sectionId: node.sectionId,
      categoryId: node.categoryId,
      degree: node.degree
    }))
  ), [neighborhoodQuery.data?.nodes]);

  const neighborhoodGraphEdges = useMemo<GraphEdge[]>(() => (
    (neighborhoodQuery.data?.edges ?? []).map((edge) => ({
      relationId: edge.relationId,
      leftFamilyId: edge.leftFamilyId,
      rightFamilyId: edge.rightFamilyId,
      relationType: edge.relationType,
      origin: edge.origin,
      status: edge.status,
      strengthScore: edge.strengthScore,
      evidence: edge.evidence
    }))
  ), [neighborhoodQuery.data?.edges]);

  const selectedNeighborhoodEdge = useMemo<GraphEdge | null>(() => (
    neighborhoodGraphEdges.find((edge) => edge.relationId === selectedNeighborhoodEdgeId) ?? null
  ), [neighborhoodGraphEdges, selectedNeighborhoodEdgeId]);

  const neighborhoodNodesById = useMemo(() => new Map(
    neighborhoodQuery.data?.nodes.map((node) => [node.familyId, node.title]) ?? []
  ), [neighborhoodQuery.data?.nodes]);

  const categoryCardsById = useMemo(() => new Map(
    categoryCards.map((item) => [item.scopeId ?? '__none__', item])
  ), [categoryCards]);
  const sectionCardsById = useMemo(() => new Map(
    sectionCards.map((item) => [item.scopeId ?? '__none__', item])
  ), [sectionCards]);

  const currentScope = useMemo<FeatureScopeResponse['scope'] | null>(() => {
    if (view === 'category') {
      if (scopeQuery.data?.scope.scopeType === 'category') {
        return scopeQuery.data.scope;
      }
      return selectedCategoryCard ? {
        scopeType: 'category',
        scopeId: selectedCategoryCard.scopeId,
        scopeName: selectedCategoryCard.label,
        scopeLabel: selectedCategoryCard.scopeLabel
      } : null;
    }
    if (view === 'section') {
      if (scopeQuery.data?.scope.scopeType === 'section') {
        return scopeQuery.data.scope;
      }
      return selectedSectionCard ? {
        scopeType: 'section',
        scopeId: selectedSectionCard.scopeId,
        scopeName: selectedSectionCard.label,
        scopeLabel: selectedSectionCard.scopeLabel
      } : null;
    }
    return null;
  }, [scopeQuery.data?.scope, selectedCategoryCard, selectedSectionCard, view]);

  const relationBusy = relationJob?.state === JobState.RUNNING || relationJob?.state === JobState.QUEUED;
  const fullAnalysisBusy = rebuildMutation.loading || relationBusy;
  const relationHealth = deriveRelationHealth(
    relationStatusQuery.data?.summary,
    relationStatusQuery.data?.latestRun,
    relationBusy,
    analysisError
  );

  const openArticleFamily = async (familyId: string) => {
    await window.kbv.invoke('app.navigation.dispatch', {
      action: {
        type: 'open_article_explorer',
        familyId,
        tab: 'preview'
      }
    });
  };

  const openFeatureHome = () => {
    setView('features');
    setSelectedFamilyId(null);
    setSelectedScopeEdgeId(null);
    setSelectedNeighborhoodEdgeId(null);
    setSelectedBridgeState(null);
  };

  const openCategoryDetail = (scopeId?: string, options?: { preserveBridge?: boolean }) => {
    setSelectedCategoryKey(buildScopeKey('category', scopeId));
    setView('category');
    setSelectedFamilyId(null);
    setSelectedScopeEdgeId(null);
    setSelectedNeighborhoodEdgeId(null);
    if (!options?.preserveBridge) {
      setSelectedBridgeState(null);
    }
  };

  const openSectionDetail = (scopeId?: string, options?: { preserveBridge?: boolean }) => {
    setSelectedSectionKey(buildScopeKey('section', scopeId));
    setView('section');
    setSelectedFamilyId(null);
    setSelectedScopeEdgeId(null);
    setSelectedNeighborhoodEdgeId(null);
    if (!options?.preserveBridge) {
      setSelectedBridgeState(null);
    }
  };

  const openArticleNeighborhood = (familyId: string) => {
    setArticleReturnView(
      view === 'category' || view === 'section'
        ? view
        : view === 'article'
          ? articleReturnView
          : 'features'
    );
    setSelectedFamilyId(familyId);
    setSelectedScopeEdgeId(null);
    setSelectedNeighborhoodEdgeId(null);
    setView('article');
  };

  const returnFromArticle = () => {
    setSelectedFamilyId(null);
    setSelectedNeighborhoodEdgeId(null);
    if (articleReturnView === 'category' && selectedCategoryKey) {
      setView('category');
      return;
    }
    if (articleReturnView === 'section' && selectedSectionKey) {
      setView('section');
      return;
    }
    setView('features');
  };

  const openBridgeTarget = (bridge: ScopeBridge) => {
    if (!currentScope) {
      return;
    }
    setSelectedBridgeState({
      bridge,
      sourceScope: currentScope
    });
    setSelectedScopeEdgeId(null);
    if (bridge.targetScopeType === 'category') {
      openCategoryDetail(bridge.targetScopeId, { preserveBridge: true });
      return;
    }
    openSectionDetail(bridge.targetScopeId, { preserveBridge: true });
  };

  const runFullRelationAnalysis = async () => {
    if (!activeWorkspace || fullAnalysisBusy) {
      return;
    }

    setAnalysisError(null);
    setRebuildMessage('Rebuilding the derived relation index...');
    const rebuilt = await rebuildMutation.mutateDetailed({
      workspaceId: activeWorkspace.id,
      forceFullRebuild: true
    });
    if (!rebuilt.data) {
      const errorMessage = rebuilt.error ?? 'The relation index rebuild failed.';
      setAnalysisError(errorMessage);
      setRebuildMessage(`Full relation analysis stopped during index rebuild: ${errorMessage}`);
      await relationStatusQuery.execute({ workspaceId: activeWorkspace.id });
      return;
    }

    setRebuildMessage(`Rebuilt ${rebuilt.data.documentCount} documents and ${rebuilt.data.chunkCount} chunks. Starting inferred-relation refresh...`);
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

  if (!activeWorkspace) {
    return (
      <>
        <PageHeader title="Feature Map" subtitle="No workspace selected" />
        <div className="route-content">
          <EmptyState
            icon={<IconLayers size={48} />}
            title="No workspace open"
            description="Open a workspace to explore categories, sections, clusters, and article neighborhoods."
          />
        </div>
      </>
    );
  }

  const selectedScopeEdgeLeftTitle = selectedScopeEdge
    ? scopeArticlesById.get(selectedScopeEdge.leftFamilyId)?.title
    : undefined;
  const selectedScopeEdgeRightTitle = selectedScopeEdge
    ? scopeArticlesById.get(selectedScopeEdge.rightFamilyId)?.title
    : undefined;

  const centerArticle = neighborhoodQuery.data?.centerArticle ?? null;
  const centerArticleCategory = centerArticle
    ? categoryCardsById.get(centerArticle.categoryId ?? '__none__') ?? null
    : null;
  const centerArticleSection = centerArticle
    ? sectionCardsById.get(centerArticle.sectionId ?? '__none__') ?? null
    : null;

  const leftPane = (
    <div style={{ display: 'grid', gap: 'var(--space-4)', position: stackedPanes ? 'static' : 'sticky', top: 'var(--space-4)' }}>
      <TaxonomyStatusCard taxonomyStatus={summaryQuery.data?.taxonomyStatus} />

      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'center' }}>
          <span className="card-header-title">Categories</span>
          <Badge variant="neutral">{categoryCards.length}</Badge>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {summaryQuery.loading && !summaryQuery.data ? (
            <LoadingState message="Loading categories..." />
          ) : categoryCards.length === 0 ? (
            <EmptyState
              icon={<IconLayers size={34} />}
              title="No categories yet"
              description="This view only depends on KB article scope membership and relations. Sync category or section metadata to replace fallback labels."
            />
          ) : (
            categoryCards.map((item) => (
              <FeatureListItem
                key={item.key}
                item={item}
                active={view === 'category' && item.key === selectedCategoryKey}
                onClick={() => openCategoryDetail(item.scopeId)}
              />
            ))
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'center' }}>
          <span className="card-header-title">Sections</span>
          <Badge variant="neutral">{sectionCards.length}</Badge>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {summaryQuery.loading && !summaryQuery.data ? (
            <LoadingState message="Loading sections..." />
          ) : sectionCards.length === 0 ? (
            <EmptyState
              icon={<IconLayers size={34} />}
              title="No sections yet"
              description="Sections appear here as soon as KB articles carry section membership, even when the workspace has zero PBIs."
            />
          ) : (
            sectionCards.map((item) => (
              <FeatureListItem
                key={item.key}
                item={item}
                active={view === 'section' && item.key === selectedSectionKey}
                onClick={() => openSectionDetail(item.scopeId)}
              />
            ))
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-header-title">Jump To Article</span>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Optional article jump
            </span>
            <div style={{ position: 'relative' }}>
              <IconSearch size={14} className="input-icon" />
              <input
                className="input input-sm"
                style={{ paddingLeft: 32 }}
                placeholder="Search article title..."
                value={jumpToArticleText}
                onChange={(event) => setJumpToArticleText(event.target.value)}
              />
            </div>
          </label>

          {jumpToArticleText.trim().length < 2 ? (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              Search is optional here. The default way into the map is categories, sections, clusters, and bridges.
            </div>
          ) : searchQuery.loading ? (
            <LoadingState message="Searching articles..." />
          ) : familySearchResults.length === 0 ? (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
              No article matches for “{jumpToArticleText.trim()}”.
            </div>
          ) : (
            familySearchResults.slice(0, 8).map((result) => (
              <button
                key={result.familyId}
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ justifyContent: 'space-between', textAlign: 'left' }}
                onClick={() => openArticleNeighborhood(result.familyId)}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{result.title}</span>
                <IconArrowUpRight size={13} />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );

  const centerPane = (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      {view === 'features' ? (
        <>
          <div className="card">
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="card-header-title">Feature Map Home</span>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <Badge variant={taxonomyStatusVariant(summaryQuery.data?.taxonomyStatus.status)}>
                  {taxonomyStatusLabel(summaryQuery.data?.taxonomyStatus.status)}
                </Badge>
                <Badge variant={relationHealth.variant}>{relationHealth.label}</Badge>
              </div>
            </div>
            <div className="card-body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                Browse KB features from categories and sections first, then drill into clusters, bridges, and article neighborhoods. This page is powered by KB article metadata and relations only.
              </div>

              {summaryQuery.data?.taxonomyStatus.status !== 'ready' ? (
                <div
                  style={{
                    display: 'grid',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid color-mix(in srgb, var(--color-warning) 25%, var(--color-border))',
                    background: 'color-mix(in srgb, var(--color-warning-bg) 70%, white)'
                  }}
                >
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <IconAlertCircle size={16} />
                    <span style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>
                      Category or section naming is incomplete
                    </span>
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                    Relation analysis rebuilds the derived index and refreshes inferred relations. It does not repair taxonomy names; missing names will stay marked as fallback labels until sync data or overrides exist.
                  </div>
                </div>
              ) : null}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)' }}>
                <DetailStat label="Categories" value={summaryQuery.data?.categories.length ?? 0} />
                <DetailStat label="Sections" value={countUniqueSections(summaryQuery.data)} />
                <DetailStat label="Articles" value={countUniqueArticles(summaryQuery.data)} />
                <DetailStat label="Clusters" value={countTotalClusters(summaryQuery.data)} />
                <DetailStat label="Bridges" value={countTotalBridges(summaryQuery.data)} />
                <DetailStat label="Stale Docs" value={countTotalStale(summaryQuery.data)} />
              </div>
            </div>
          </div>

          {summaryQuery.loading ? (
            <LoadingState message="Loading feature map..." />
          ) : summaryQuery.error ? (
            <ErrorState title="Unable to load the feature map" description={summaryQuery.error} />
          ) : categoryCards.length === 0 ? (
            <EmptyState
              icon={<IconLayers size={40} />}
              title="No feature scopes yet"
              description="Once KB articles have category or section membership, the feature map home will summarize them here."
            />
          ) : (
            <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
              {categoryCards.map((category) => {
                const categorySummary = summaryQuery.data?.categories.find((item) => item.categoryId === category.scopeId);
                return (
                  <div key={category.key} className="card">
                    <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="card-header-title">{category.label}</span>
                        <Badge variant={scopeLabelSourceVariant(category.scopeLabel.labelSource)}>
                          {scopeLabelSourceLabel(category.scopeLabel.labelSource)}
                        </Badge>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openCategoryDetail(category.scopeId)}
                      >
                        Open Category
                      </button>
                    </div>
                    <div className="card-body" style={{ display: 'grid', gap: 'var(--space-3)' }}>
                      <ScopeMetricBadges summary={category} />
                      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                        {(categorySummary?.sections ?? [])
                          .sort((left, right) => right.bridgeEdgeCount - left.bridgeEdgeCount || left.sectionName.localeCompare(right.sectionName))
                          .map((section) => (
                            <button
                              key={buildScopeKey('section', section.sectionId)}
                              type="button"
                              className="btn btn-secondary btn-sm"
                              style={{ justifyContent: 'space-between', textAlign: 'left' }}
                              onClick={() => openSectionDetail(section.sectionId)}
                            >
                              <span style={{ display: 'grid', gap: 4 }}>
                                <span>{section.sectionName}</span>
                                <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>
                                  {section.articleCount} articles / {section.clusterCount} clusters / {section.bridgeEdgeCount} bridges
                                </span>
                              </span>
                              <Badge variant={scopeLabelSourceVariant(section.sectionLabel.labelSource)}>
                                {scopeLabelSourceLabel(section.sectionLabel.labelSource)}
                              </Badge>
                            </button>
                          ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : null}

      {(view === 'category' || view === 'section') ? (
        scopeQuery.loading && !scopeQuery.data ? (
          <LoadingState message="Loading feature detail..." />
        ) : scopeQuery.error ? (
          <ErrorState title="Unable to load scope detail" description={scopeQuery.error} />
        ) : (
          <>
            <div className="card">
              <div className="card-header">
                <span className="card-header-title">{view === 'category' ? 'Category Detail' : 'Section Detail'}</span>
              </div>
              <div className="card-body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={openFeatureHome}>
                    Feature Map Home
                  </button>
                  <Badge variant="neutral">{currentScope?.scopeType ?? view}</Badge>
                  {currentScope ? (
                    <Badge variant={scopeLabelSourceVariant(currentScope.scopeLabel.labelSource)}>
                      {scopeLabelSourceLabel(currentScope.scopeLabel.labelSource)}
                    </Badge>
                  ) : null}
                </div>

                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>
                    {currentScope?.scopeName ?? (view === 'category' ? selectedCategoryCard?.label : selectedSectionCard?.label)}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                    {view === 'category'
                      ? 'This category view shows the sections, article clusters, and cross-feature bridges inside one KB feature area.'
                      : 'This section view focuses on one KB feature slice and the article clusters that define it.'}
                  </div>
                  {currentScope?.scopeLabel.labelSource === 'fallback' ? (
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-warning)', lineHeight: 1.6 }}>
                      This scope is still using a fallback label derived from raw IDs.
                    </div>
                  ) : null}
                </div>

                <ScopeMetricBadges summary={scopeQuery.data?.summary} />

                {view === 'category' && selectedCategoryCard ? (
                  <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>
                      Sections In This Category
                    </div>
                    {sectionCards
                      .filter((item) => item.parentScopeId === selectedCategoryCard.scopeId)
                      .map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ justifyContent: 'space-between', textAlign: 'left' }}
                          onClick={() => openSectionDetail(item.scopeId)}
                        >
                          <span style={{ display: 'grid', gap: 4 }}>
                            <span>{item.label}</span>
                            <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>
                              {item.articleCount} articles / {item.clusterCount} clusters
                            </span>
                          </span>
                          <Badge variant={scopeLabelSourceVariant(item.scopeLabel.labelSource)}>
                            {scopeLabelSourceLabel(item.scopeLabel.labelSource)}
                          </Badge>
                        </button>
                      ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'center' }}>
                <span className="card-header-title">Clusters</span>
                <Badge variant="neutral">{scopeQuery.data?.clusters.length ?? 0}</Badge>
              </div>
              <div className="card-body" style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                {(scopeQuery.data?.clusters ?? []).map((cluster) => (
                  <button
                    key={cluster.clusterId}
                    type="button"
                    onClick={() => {
                      setSelectedClusterId(cluster.clusterId);
                      setSelectedScopeEdgeId(null);
                    }}
                    style={{
                      display: 'grid',
                      gap: 'var(--space-2)',
                      padding: 'var(--space-3)',
                      textAlign: 'left',
                      borderRadius: 'var(--radius-lg)',
                      border: cluster.clusterId === selectedClusterId
                        ? '1px solid color-mix(in srgb, var(--color-primary) 54%, white)'
                        : '1px solid var(--color-border)',
                      background: cluster.clusterId === selectedClusterId
                        ? 'linear-gradient(180deg, color-mix(in srgb, var(--color-primary) 10%, var(--color-bg)) 0%, var(--color-bg) 100%)'
                        : 'var(--color-bg)',
                      boxShadow: 'var(--shadow-xs)',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>{cluster.label}</div>
                      <Badge variant={cluster.labelSource === 'derived_keywords' ? 'primary' : 'neutral'}>
                        {clusterLabelSourceLabel(cluster.labelSource)}
                      </Badge>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <Badge variant="neutral">{cluster.articleCount} articles</Badge>
                      <Badge variant="neutral">{cluster.internalEdgeCount} internal</Badge>
                      <Badge variant="neutral">{cluster.bridgeEdgeCount} bridges</Badge>
                    </div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                      Representatives: {cluster.representativeArticleIds.map((familyId) => scopeArticlesById.get(familyId)?.title ?? familyId).join(', ')}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'center' }}>
                <span className="card-header-title">Article Inventory</span>
                <Badge variant="neutral">{scopeQuery.data?.articles.length ?? 0}</Badge>
              </div>
              <div className="card-body" style={{ display: 'grid', gap: 'var(--space-2)' }}>
                {(scopeQuery.data?.articles ?? []).map((article) => (
                  <button
                    key={article.familyId}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ justifyContent: 'space-between', textAlign: 'left' }}
                    onClick={() => openArticleNeighborhood(article.familyId)}
                  >
                    <span style={{ display: 'grid', gap: 4 }}>
                      <span>{article.title}</span>
                      <span style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        <Badge variant={scopeLabelSourceVariant(categoryCardsById.get(article.categoryId ?? '__none__')?.scopeLabel.labelSource ?? 'fallback')}>
                          {categoryCardsById.get(article.categoryId ?? '__none__')?.label ?? 'Uncategorized'}
                        </Badge>
                        <Badge variant={scopeLabelSourceVariant(sectionCardsById.get(article.sectionId ?? '__none__')?.scopeLabel.labelSource ?? 'fallback')}>
                          {sectionCardsById.get(article.sectionId ?? '__none__')?.label ?? 'Unsectioned'}
                        </Badge>
                        {articleTaxonomyBadge(article) ? (
                          <Badge variant={articleTaxonomyBadge(article)?.variant ?? 'neutral'}>
                            {articleTaxonomyBadge(article)?.label}
                          </Badge>
                        ) : null}
                        {!article.categoryId ? <Badge variant="warning">uncategorized</Badge> : null}
                        {!article.sectionId ? <Badge variant="warning">unsectioned</Badge> : null}
                      </span>
                    </span>
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>
                      {article.internalEdgeCount} internal / {article.bridgeEdgeCount} bridges
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'center' }}>
                <span className="card-header-title">Bridges</span>
                <Badge variant="neutral">{scopeQuery.data?.bridges.length ?? 0}</Badge>
              </div>
              <div className="card-body" style={{ display: 'grid', gap: 'var(--space-2)' }}>
                {(scopeQuery.data?.bridges ?? []).length === 0 ? (
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                    {includeBridges
                      ? 'No outward bridges are visible for this scope.'
                      : 'Bridge rendering is off. Enable “Include bridges” above to inspect outward connections.'}
                  </div>
                ) : (
                  (scopeQuery.data?.bridges ?? []).map((bridge) => (
                    <button
                      key={`${bridge.sourceClusterId}:${bridge.targetScopeType}:${bridge.targetScopeId ?? '__none__'}:${bridge.targetScopeName}`}
                      type="button"
                      className="btn btn-secondary btn-sm"
                      style={{ justifyContent: 'space-between', textAlign: 'left' }}
                      onClick={() => openBridgeTarget(bridge)}
                    >
                      <span style={{ display: 'grid', gap: 4 }}>
                        <span>{bridge.summary}</span>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>
                          Opens {bridge.targetScopeType} detail: {bridge.targetScopeName}
                        </span>
                      </span>
                      <span style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                        <Badge variant={scopeLabelSourceVariant(bridge.targetScopeLabel.labelSource)}>
                          {scopeLabelSourceLabel(bridge.targetScopeLabel.labelSource)}
                        </Badge>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>
                          {bridge.edgeCount} edges
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <RelationGraph
              title={selectedCluster ? `Cluster Graph: ${selectedCluster.label}` : 'Cluster Graph'}
              nodes={selectedClusterGraphNodes}
              edges={selectedClusterGraphEdges}
              centerFamilyId={selectedCluster?.representativeArticleIds[0]}
              selectedEdgeId={selectedScopeEdgeId}
              onSelectEdge={setSelectedScopeEdgeId}
              onSelectNode={openArticleNeighborhood}
            />
          </>
        )
      ) : null}

      {view === 'article' ? (
        neighborhoodQuery.loading && !neighborhoodQuery.data ? (
          <LoadingState message="Loading article neighborhood..." />
        ) : neighborhoodQuery.error ? (
          <ErrorState title="Unable to load article neighborhood" description={neighborhoodQuery.error} />
        ) : (
          <>
            <div className="card">
              <div className="card-header">
                <span className="card-header-title">Article Neighborhood</span>
              </div>
              <div className="card-body" style={{ display: 'grid', gap: 'var(--space-4)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={openFeatureHome}>
                    Feature Map Home
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={returnFromArticle}>
                    {articleReturnView === 'features' ? 'Back To Home' : `Back To ${articleReturnView === 'category' ? 'Category' : 'Section'}`}
                  </button>
                </div>

                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>
                    {centerArticle?.title ?? 'Center Article'}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                    Article Neighborhood is a drill-down from the feature map. Use it to inspect how one article connects across the surrounding KB graph.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {centerArticleCategory ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openCategoryDetail(centerArticleCategory.scopeId)}>
                      Category: {centerArticleCategory.label}
                    </button>
                  ) : null}
                  {centerArticleSection ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openSectionDetail(centerArticleSection.scopeId)}>
                      Section: {centerArticleSection.label}
                    </button>
                  ) : null}
                  {articleTaxonomyBadge(centerArticle) ? (
                    <Badge variant={articleTaxonomyBadge(centerArticle)?.variant ?? 'neutral'}>
                      {articleTaxonomyBadge(centerArticle)?.label}
                    </Badge>
                  ) : null}
                  {!centerArticle?.categoryId ? <Badge variant="warning">uncategorized</Badge> : null}
                  {!centerArticle?.sectionId ? <Badge variant="warning">unsectioned</Badge> : null}
                  <Badge variant="success">manual relations visible</Badge>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)' }}>
                  <DetailStat label="Nodes" value={neighborhoodQuery.data?.nodes.length ?? 0} />
                  <DetailStat label="Edges" value={neighborhoodQuery.data?.edges.length ?? 0} />
                  <DetailStat label="Hop Count" value={hopCount} />
                  <DetailStat label="Min Score" value={minScore.toFixed(1)} />
                </div>
              </div>
            </div>

            <RelationGraph
              title="Article Neighborhood"
              nodes={neighborhoodGraphNodes}
              edges={neighborhoodGraphEdges}
              centerFamilyId={selectedFamilyId ?? neighborhoodQuery.data?.centerArticle.familyId}
              selectedEdgeId={selectedNeighborhoodEdgeId}
              onSelectEdge={setSelectedNeighborhoodEdgeId}
              onSelectNode={openArticleNeighborhood}
            />

            <div className="card">
              <div className="card-header">
                <span className="card-header-title">Neighbor Articles</span>
              </div>
              <div className="card-body" style={{ display: 'grid', gap: 'var(--space-2)' }}>
                {(neighborhoodQuery.data?.nodes ?? []).map((node) => (
                  <button
                    key={node.familyId}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ justifyContent: 'space-between', textAlign: 'left' }}
                    onClick={() => openArticleNeighborhood(node.familyId)}
                  >
                    <span>{node.title}</span>
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>
                      degree {node.degree}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )
      ) : null}
    </div>
  );

  const rightPane = (
    <div style={{ display: 'grid', gap: 'var(--space-4)', position: stackedPanes ? 'static' : 'sticky', top: 'var(--space-4)' }}>
      <div className="card">
        <div className="card-header">
          <span className="card-header-title">Selected Bridge</span>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          {!selectedBridgeState ? (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              Choose a bridge from a category or section to navigate into the connected scope and keep the bridge evidence visible here.
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gap: 4 }}>
                <div style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>
                  {selectedBridgeState.bridge.summary}
                </div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                  {selectedBridgeState.bridge.sourceClusterLabel} connects out from {selectedBridgeState.sourceScope.scopeName} into {selectedBridgeState.bridge.targetScopeName}.
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <Badge variant="neutral">{selectedBridgeState.bridge.edgeCount} edges</Badge>
                  <Badge variant="neutral">max {selectedBridgeState.bridge.maxStrengthScore.toFixed(2)}</Badge>
                  <Badge variant="neutral">{selectedBridgeState.bridge.targetScopeType}</Badge>
                  <Badge variant={scopeLabelSourceVariant(selectedBridgeState.bridge.targetScopeLabel.labelSource)}>
                    {scopeLabelSourceLabel(selectedBridgeState.bridge.targetScopeLabel.labelSource)}
                  </Badge>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                {selectedBridgeState.bridge.examples.map((example, index) => (
                  <div
                    key={`${example.leftFamilyId}:${example.rightFamilyId}:${index}`}
                    style={{
                      display: 'grid',
                      gap: 4,
                      padding: 'var(--space-3)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-lg)',
                      background: 'var(--color-bg-subtle)'
                    }}
                  >
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
                      {example.leftTitle ?? example.leftFamilyId} to {example.rightTitle ?? example.rightFamilyId}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <Badge variant="neutral">{relationTypeLabel(example.relationType)}</Badge>
                      <Badge variant="neutral">score {example.strengthScore.toFixed(2)}</Badge>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    if (selectedBridgeState.sourceScope.scopeType === 'category') {
                      openCategoryDetail(selectedBridgeState.sourceScope.scopeId);
                      return;
                    }
                    openSectionDetail(selectedBridgeState.sourceScope.scopeId);
                  }}
                >
                  Open Source {selectedBridgeState.sourceScope.scopeType === 'category' ? 'Category' : 'Section'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    if (selectedBridgeState.bridge.targetScopeType === 'category') {
                      openCategoryDetail(selectedBridgeState.bridge.targetScopeId, { preserveBridge: true });
                      return;
                    }
                    openSectionDetail(selectedBridgeState.bridge.targetScopeId, { preserveBridge: true });
                  }}
                >
                  Open Target {selectedBridgeState.bridge.targetScopeType === 'category' ? 'Category' : 'Section'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-header-title">Selected Article</span>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          {centerArticle ? (
            <>
              <div style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>
                {centerArticle.title}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {centerArticleCategory ? (
                  <Badge variant={scopeLabelSourceVariant(centerArticleCategory.scopeLabel.labelSource)}>
                    category: {centerArticleCategory.label}
                  </Badge>
                ) : null}
                {centerArticleSection ? (
                  <Badge variant={scopeLabelSourceVariant(centerArticleSection.scopeLabel.labelSource)}>
                    section: {centerArticleSection.label}
                  </Badge>
                ) : null}
                {articleTaxonomyBadge(centerArticle) ? (
                  <Badge variant={articleTaxonomyBadge(centerArticle)?.variant ?? 'neutral'}>
                    {articleTaxonomyBadge(centerArticle)?.label}
                  </Badge>
                ) : null}
                {!centerArticle.categoryId ? <Badge variant="warning">uncategorized</Badge> : null}
                {!centerArticle.sectionId ? <Badge variant="warning">unsectioned</Badge> : null}
                {typeof centerArticle.taxonomyConfidence === 'number' && articleTaxonomyBadge(centerArticle) ? (
                  <Badge variant="neutral">confidence {centerArticle.taxonomyConfidence.toFixed(2)}</Badge>
                ) : null}
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void openArticleFamily(centerArticle.familyId)}
              >
                Open In Article Explorer
              </button>
            </>
          ) : (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              Articles clicked from a scope inventory open Article Neighborhood immediately, and the selected article stays visible here.
            </div>
          )}
        </div>
      </div>

      <EdgeEvidenceCard
        edge={view === 'article' ? selectedNeighborhoodEdge : selectedScopeEdge}
        leftTitle={view === 'article'
          ? (selectedNeighborhoodEdge ? neighborhoodNodesById.get(selectedNeighborhoodEdge.leftFamilyId) : undefined)
          : selectedScopeEdgeLeftTitle}
        rightTitle={view === 'article'
          ? (selectedNeighborhoodEdge ? neighborhoodNodesById.get(selectedNeighborhoodEdge.rightFamilyId) : undefined)
          : selectedScopeEdgeRightTitle}
      />

      <div className="card">
        <div className="card-header">
          <span className="card-header-title">Relation Engine</span>
        </div>
        <div className="card-body" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>Status</span>
            <Badge variant={relationHealth.variant}>{relationHealth.label}</Badge>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>Indexed docs</span>
            <span>{relationStatusQuery.data?.summary.indexedDocumentCount ?? 0}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>Stale docs</span>
            <span>{relationStatusQuery.data?.summary.staleDocumentCount ?? 0}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>Chunks</span>
            <span>{relationStatusQuery.data?.summary.indexStats?.chunkCount ?? 0}</span>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Badge variant="success">manual relations visible</Badge>
            <Badge variant="neutral">min score {minScore.toFixed(1)}</Badge>
            {includeSuppressed ? <Badge variant="warning">suppressed shown</Badge> : null}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            {relationHealth.description} Full relation analysis rebuilds the index and refreshes inferred relations. Taxonomy names come from KB sync data and overrides, not from relation analysis.
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Feature Map"
        subtitle={activeWorkspace.name}
        actions={(
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
              onClick={() => {
                void summaryQuery.execute({ workspaceId: activeWorkspace.id });
                void relationStatusQuery.execute({ workspaceId: activeWorkspace.id });
                if (view === 'category' && selectedCategoryKey) {
                  void scopeQuery.execute({
                    workspaceId: activeWorkspace.id,
                    scopeType: 'category',
                    scopeId: extractScopeId(selectedCategoryKey),
                    includeBridges,
                    includeSuppressed,
                    minScore
                  });
                }
                if (view === 'section' && selectedSectionKey) {
                  void scopeQuery.execute({
                    workspaceId: activeWorkspace.id,
                    scopeType: 'section',
                    scopeId: extractScopeId(selectedSectionKey),
                    includeBridges,
                    includeSuppressed,
                    minScore
                  });
                }
                if (view === 'article' && selectedFamilyId) {
                  void neighborhoodQuery.execute({
                    workspaceId: activeWorkspace.id,
                    familyId: selectedFamilyId,
                    includeSuppressed,
                    minScore,
                    hopCount
                  });
                }
              }}
              disabled={summaryQuery.loading}
            >
              <IconRefreshCw size={13} />
              Refresh View
            </button>
          </div>
        )}
      />

      <div className="route-content" style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <section
          style={{
            display: 'grid',
            gap: 'var(--space-4)',
            padding: 'var(--space-4)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 'var(--radius-xl)',
            background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-primary) 4%, var(--color-bg)) 0%, var(--color-bg-subtle) 100%)',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }}>
                KB-first feature explorer
              </div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6, maxWidth: 760 }}>
                Start from categories and sections, inspect article clusters inside each scope, follow bridges into connected features, and only drill into Article Neighborhood when you want one article’s local graph.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Badge variant={taxonomyStatusVariant(summaryQuery.data?.taxonomyStatus.status)}>
                {taxonomyStatusLabel(summaryQuery.data?.taxonomyStatus.status)}
              </Badge>
              <Badge variant={relationHealth.variant}>{relationHealth.label}</Badge>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label
              style={{
                display: 'grid',
                gap: 6,
                padding: 'var(--space-3)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--color-bg)',
                boxShadow: 'var(--shadow-xs)'
              }}
            >
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Home Sort
              </span>
              <select className="select input-sm" value={sortField} onChange={(event) => setSortField(event.target.value as FeatureSortField)}>
                <option value="stale">Stale Docs Desc</option>
                <option value="bridge">Bridge Count Desc</option>
                <option value="internal">Internal Relations Desc</option>
                <option value="articles">Article Count Desc</option>
                <option value="name">Name Asc</option>
              </select>
            </label>

            <label
              style={{
                display: 'grid',
                gap: 6,
                padding: 'var(--space-3)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--color-bg)',
                boxShadow: 'var(--shadow-xs)'
              }}
            >
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Minimum Score
              </span>
              <input
                className="input input-sm"
                type="number"
                min={0}
                max={3}
                step={0.1}
                value={minScore}
                onChange={(event) => setMinScore(Number(event.target.value) || 0)}
              />
            </label>

            <div
              style={{
                display: 'grid',
                gap: 8,
                padding: 'var(--space-3)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--color-bg)',
                boxShadow: 'var(--shadow-xs)'
              }}
            >
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Scope Visibility
              </span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)' }}>
                <input
                  type="checkbox"
                  checked={includeBridges}
                  onChange={(event) => setIncludeBridges(event.target.checked)}
                  disabled={view !== 'category' && view !== 'section'}
                />
                Include bridges
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)' }}>
                <input
                  type="checkbox"
                  checked={includeSuppressed}
                  onChange={(event) => setIncludeSuppressed(event.target.checked)}
                />
                Include suppressed
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)' }}>
                <input
                  type="checkbox"
                  checked={hopCount === 2}
                  onChange={(event) => setHopCount(event.target.checked ? 2 : 1)}
                  disabled={view !== 'article'}
                />
                Two hops in Article Neighborhood
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge variant="neutral">{countUniqueArticles(summaryQuery.data)} articles</Badge>
            <Badge variant="neutral">{countUniqueSections(summaryQuery.data)} sections</Badge>
            <Badge variant="neutral">{countTotalClusters(summaryQuery.data)} clusters</Badge>
            <Badge variant="neutral">{countTotalBridges(summaryQuery.data)} bridges</Badge>
            <Badge variant={countTotalStale(summaryQuery.data) > 0 ? 'warning' : 'neutral'}>
              {countTotalStale(summaryQuery.data)} stale docs
            </Badge>
            <Badge variant="success">manual relations visible by default</Badge>
            {rebuildMessage ? (
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{rebuildMessage}</span>
            ) : null}
          </div>
        </section>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: stackedPanes
              ? 'minmax(0, 1fr)'
              : 'minmax(260px, 320px) minmax(0, 1fr) minmax(300px, 360px)',
            gap: 'var(--space-4)',
            alignItems: 'start'
          }}
        >
          {stackedPanes ? (
            <>
              {centerPane}
              {leftPane}
              {rightPane}
            </>
          ) : (
            <>
              {leftPane}
              {centerPane}
              {rightPane}
            </>
          )}
        </div>
      </div>
    </>
  );
};
