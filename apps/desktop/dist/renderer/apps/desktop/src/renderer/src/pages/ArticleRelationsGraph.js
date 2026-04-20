import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { JobState } from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingState } from '../components/LoadingState';
import { Badge } from '../components/Badge';
import { IconAlertCircle, IconArrowUpRight, IconLayers, IconRefreshCw, IconSearch } from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc, useIpcMutation } from '../hooks/useIpc';
const DEFAULT_MIN_SCORE = 0;
const DEFAULT_SORT = 'stale';
const DEFAULT_GRAPH_WIDTH = 960;
const DEFAULT_GRAPH_HEIGHT = 560;
const GRAPH_LAYOUT_PADDING_X = 84;
const GRAPH_LAYOUT_PADDING_Y = 72;
function deriveRelationHealth(summary, latestRun, busy, localError) {
    const hasIndex = Math.max(summary?.indexStats?.documentCount ?? 0, summary?.indexedDocumentCount ?? 0) > 0;
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
function relationTypeLabel(type) {
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
function evidenceTypeLabel(type) {
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
function clusterLabelSourceLabel(labelSource) {
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
function scopeLabelSourceLabel(labelSource) {
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
function scopeLabelSourceVariant(labelSource) {
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
function articleTaxonomyBadge(article) {
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
function taxonomyStatusLabel(status) {
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
function taxonomyStatusVariant(status) {
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
function taxonomyStatusDescription(taxonomyStatus) {
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
function formatEvidenceMetadata(metadata) {
    if (!metadata)
        return null;
    if (typeof metadata === 'string')
        return metadata;
    try {
        return JSON.stringify(metadata);
    }
    catch {
        return null;
    }
}
function dedupeSearchResults(results) {
    return results.filter((result, index, all) => (all.findIndex((candidate) => candidate.familyId === result.familyId) === index));
}
function buildScopeKey(scopeType, scopeId) {
    return `${scopeType}::${scopeId ?? '__none__'}`;
}
function extractScopeId(scopeKey) {
    if (!scopeKey)
        return undefined;
    const [, rawScopeId = ''] = scopeKey.split('::');
    return rawScopeId === '__none__' ? undefined : rawScopeId;
}
function sortFeatureCards(cards, sortField) {
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
function buildGraphRingCapacities(nodeCount) {
    const capacities = [];
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
function buildGraphLayout(nodes, edges, width, height, centerFamilyId) {
    const layout = new Map();
    if (nodes.length === 0) {
        return layout;
    }
    const centerX = width / 2;
    const centerY = height / 2;
    const degreeByNode = new Map();
    for (const node of nodes) {
        degreeByNode.set(node.familyId, node.degree);
    }
    for (const edge of edges) {
        degreeByNode.set(edge.leftFamilyId, (degreeByNode.get(edge.leftFamilyId) ?? 0) + 1);
        degreeByNode.set(edge.rightFamilyId, (degreeByNode.get(edge.rightFamilyId) ?? 0) + 1);
    }
    const ordered = nodes.slice().sort((left, right) => ((degreeByNode.get(right.familyId) ?? 0) - (degreeByNode.get(left.familyId) ?? 0)
        || left.title.localeCompare(right.title)));
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
function edgeStrokeColor(edge) {
    if (edge.status === 'suppressed')
        return 'var(--gray-500)';
    if (edge.origin === 'manual')
        return 'var(--color-success)';
    return 'var(--color-primary)';
}
function edgeStrokeWidth(edge, selected) {
    const base = edge.origin === 'manual' ? 2.8 : 2;
    const scoreBoost = Math.max(0, Math.min(2.2, edge.strengthScore));
    return selected ? base + scoreBoost + 1.5 : base + scoreBoost;
}
function nodeRadius(node) {
    return 22 + Math.min(16, node.degree * 2.2);
}
function useGraphViewport() {
    const ref = useRef(null);
    const [size, setSize] = useState({ width: DEFAULT_GRAPH_WIDTH, height: DEFAULT_GRAPH_HEIGHT });
    useEffect(() => {
        const element = ref.current;
        if (!element) {
            return;
        }
        const updateSize = () => {
            const nextWidth = Math.max(680, Math.round(element.clientWidth || DEFAULT_GRAPH_WIDTH));
            const nextHeight = Math.max(420, Math.min(640, Math.round(nextWidth * 0.6)));
            setSize((current) => (current.width === nextWidth && current.height === nextHeight
                ? current
                : { width: nextWidth, height: nextHeight }));
        };
        updateSize();
        const observer = new ResizeObserver(() => updateSize());
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return { ref, size };
}
function useViewportWidth() {
    const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
    useEffect(() => {
        const handleResize = () => setWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    return width;
}
function countUniqueArticles(summary) {
    return summary?.categories.reduce((total, category) => total + category.articleCount, 0) ?? 0;
}
function countUniqueSections(summary) {
    return summary?.categories.reduce((total, category) => total + category.sectionCount, 0) ?? 0;
}
function countTotalClusters(summary) {
    return summary?.categories.reduce((total, category) => total + category.clusterCount, 0) ?? 0;
}
function countTotalBridges(summary) {
    return summary?.categories.reduce((total, category) => total + category.bridgeEdgeCount, 0) ?? 0;
}
function countTotalStale(summary) {
    return summary?.categories.reduce((total, category) => total + category.staleDocumentCount, 0) ?? 0;
}
function DetailStat({ label, value }) {
    return (_jsxs("div", { style: {
            display: 'grid',
            gap: 4,
            padding: 'var(--space-3)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-bg)'
        }, children: [_jsx("span", { style: { fontSize: 'var(--text-xs)', textTransform: 'uppercase', color: 'var(--color-text-secondary)', letterSpacing: '0.03em' }, children: label }), _jsx("span", { style: { fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }, children: value })] }));
}
function ScopeMetricBadges({ summary }) {
    if (!summary)
        return null;
    return (_jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: [_jsxs(Badge, { variant: "neutral", children: [summary.articleCount, " articles"] }), _jsxs(Badge, { variant: "neutral", children: [summary.clusterCount, " clusters"] }), _jsxs(Badge, { variant: "neutral", children: [summary.internalEdgeCount, " internal"] }), _jsxs(Badge, { variant: "neutral", children: [summary.bridgeEdgeCount, " bridges"] }), _jsxs(Badge, { variant: summary.staleDocumentCount > 0 ? 'warning' : 'neutral', children: [summary.staleDocumentCount, " stale docs"] }), _jsxs(Badge, { variant: "success", children: [summary.manualEdgeCount, " manual"] }), _jsxs(Badge, { variant: "primary", children: [summary.inferredEdgeCount, " inferred"] })] }));
}
function FeatureListItem({ item, active, onClick }) {
    return (_jsxs("button", { type: "button", onClick: onClick, style: {
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
        }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }, children: [_jsxs("div", { style: { display: 'grid', gap: 4 }, children: [_jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("span", { style: { fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }, children: item.label }), _jsx(Badge, { variant: scopeLabelSourceVariant(item.scopeLabel.labelSource), children: scopeLabelSourceLabel(item.scopeLabel.labelSource) })] }), item.parentLabel ? (_jsx("span", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }, children: item.parentLabel })) : null] }), _jsxs("div", { style: { display: 'grid', gap: 6, justifyItems: 'end' }, children: [_jsxs(Badge, { variant: item.staleDocumentCount > 0 ? 'warning' : 'neutral', children: [item.articleCount, " articles"] }), item.staleDocumentCount > 0 ? (_jsxs("span", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-warning)' }, children: [item.staleDocumentCount, " stale"] })) : null] })] }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: [_jsxs(Badge, { variant: "neutral", children: [item.clusterCount, " clusters"] }), _jsxs(Badge, { variant: "neutral", children: [item.internalEdgeCount, " internal"] }), _jsxs(Badge, { variant: "neutral", children: [item.bridgeEdgeCount, " bridges"] }), _jsxs(Badge, { variant: item.staleDocumentCount > 0 ? 'warning' : 'neutral', children: [item.staleDocumentCount, " stale"] })] }), _jsxs("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }, children: [item.manualEdgeCount, " manual / ", item.inferredEdgeCount, " inferred"] })] }));
}
function TaxonomyStatusCard({ taxonomyStatus }) {
    return (_jsxs("div", { style: {
            display: 'grid',
            gap: 'var(--space-3)',
            padding: 'var(--space-3)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-bg)',
            boxShadow: 'var(--shadow-xs)'
        }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'flex-start' }, children: [_jsxs("div", { style: { display: 'grid', gap: 4 }, children: [_jsx("span", { style: { fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }, children: "Taxonomy Status" }), _jsx("span", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }, children: taxonomyStatusDescription(taxonomyStatus) })] }), _jsx(Badge, { variant: taxonomyStatusVariant(taxonomyStatus?.status), children: taxonomyStatusLabel(taxonomyStatus?.status) })] }), taxonomyStatus ? (_jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: [_jsxs(Badge, { variant: "neutral", children: [taxonomyStatus.totalScopeCount, " scopes"] }), _jsxs(Badge, { variant: "success", children: [taxonomyStatus.catalogScopeCount, " catalog"] }), _jsxs(Badge, { variant: "primary", children: [taxonomyStatus.overrideScopeCount, " override"] }), _jsxs(Badge, { variant: taxonomyStatus.fallbackScopeCount > 0 ? 'warning' : 'neutral', children: [taxonomyStatus.fallbackScopeCount, " fallback"] })] })) : null] }));
}
function RelationGraph({ title, nodes, edges, centerFamilyId, selectedEdgeId, onSelectEdge, onSelectNode }) {
    const { ref, size } = useGraphViewport();
    const layout = useMemo(() => buildGraphLayout(nodes, edges, size.width, size.height, centerFamilyId), [centerFamilyId, edges, nodes, size.height, size.width]);
    return (_jsxs("div", { className: "card", style: { minHeight: 0 }, children: [_jsx("div", { className: "card-header", children: _jsx("span", { className: "card-header-title", children: title }) }), _jsx("div", { className: "card-body", ref: ref, style: { minHeight: 0 }, children: nodes.length === 0 ? (_jsx(EmptyState, { icon: _jsx(IconLayers, { size: 36 }), title: "No graph to render", description: "Select a cluster or article neighborhood with visible relations." })) : (_jsxs("svg", { width: "100%", viewBox: `0 0 ${size.width} ${size.height}`, style: {
                        borderRadius: 18,
                        background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.04), rgba(15, 23, 42, 0))'
                    }, children: [_jsx("defs", { children: _jsx("filter", { id: "feature-map-shadow", x: "-20%", y: "-20%", width: "140%", height: "140%", children: _jsx("feDropShadow", { dx: "0", dy: "8", stdDeviation: "12", floodOpacity: "0.18" }) }) }), edges.map((edge) => {
                            const left = layout.get(edge.leftFamilyId);
                            const right = layout.get(edge.rightFamilyId);
                            if (!left || !right)
                                return null;
                            const isSelected = edge.relationId === selectedEdgeId;
                            return (_jsx("line", { x1: left.x, y1: left.y, x2: right.x, y2: right.y, stroke: edgeStrokeColor(edge), strokeWidth: edgeStrokeWidth(edge, isSelected), strokeDasharray: edge.status === 'suppressed' ? '10 8' : undefined, strokeOpacity: isSelected ? 0.96 : 0.54, style: { cursor: 'pointer' }, onClick: () => onSelectEdge(edge.relationId) }, edge.relationId));
                        }), nodes.map((node) => {
                            const point = layout.get(node.familyId);
                            if (!point)
                                return null;
                            const radius = nodeRadius(node);
                            const isCenter = node.familyId === centerFamilyId;
                            return (_jsxs("g", { transform: `translate(${point.x}, ${point.y})`, style: { cursor: 'pointer' }, onClick: () => onSelectNode(node.familyId), children: [_jsx("circle", { r: radius + 10, fill: isCenter ? 'rgba(37, 99, 235, 0.14)' : 'rgba(15, 23, 42, 0.06)' }), _jsx("circle", { r: radius, fill: isCenter ? 'var(--color-primary)' : 'white', stroke: isCenter ? 'rgba(37, 99, 235, 0.9)' : 'rgba(15, 23, 42, 0.16)', strokeWidth: isCenter ? 3 : 2, filter: "url(#feature-map-shadow)" }), _jsx("text", { textAnchor: "middle", y: 4, style: {
                                            fontSize: 12,
                                            fontWeight: 700,
                                            fill: isCenter ? 'white' : 'var(--color-text)',
                                            pointerEvents: 'none'
                                        }, children: node.title.length > 18 ? `${node.title.slice(0, 18)}…` : node.title })] }, node.familyId));
                        })] })) })] }));
}
function EdgeEvidenceCard({ edge, leftTitle, rightTitle }) {
    if (!edge) {
        return (_jsxs("div", { className: "card", children: [_jsx("div", { className: "card-header", children: _jsx("span", { className: "card-header-title", children: "Edge Evidence" }) }), _jsx("div", { className: "card-body", children: _jsx(EmptyState, { icon: _jsx(IconLayers, { size: 34 }), title: "No edge selected", description: "Select a relation edge from a cluster or article neighborhood graph to inspect its evidence." }) })] }));
    }
    return (_jsxs("div", { className: "card", children: [_jsx("div", { className: "card-header", children: _jsx("span", { className: "card-header-title", children: "Edge Evidence" }) }), _jsxs("div", { className: "card-body", style: { display: 'grid', gap: 'var(--space-3)' }, children: [_jsxs("div", { style: { display: 'grid', gap: 4 }, children: [_jsxs("div", { style: { fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }, children: [leftTitle ?? edge.leftFamilyId, " ", _jsx("span", { style: { color: 'var(--color-text-secondary)' }, children: "to" }), " ", rightTitle ?? edge.rightFamilyId] }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: [_jsx(Badge, { variant: edge.origin === 'manual' ? 'success' : 'primary', children: edge.origin }), _jsx(Badge, { variant: edge.status === 'suppressed' ? 'warning' : 'neutral', children: edge.status }), _jsx(Badge, { variant: "neutral", children: relationTypeLabel(edge.relationType) }), _jsxs(Badge, { variant: "neutral", children: ["score ", edge.strengthScore.toFixed(2)] })] })] }), edge.evidence.length === 0 ? (_jsx("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }, children: "No saved evidence is attached to this relation." })) : (_jsx("div", { style: { display: 'grid', gap: 'var(--space-2)' }, children: edge.evidence.map((evidence) => (_jsxs("div", { style: {
                                display: 'grid',
                                gap: 6,
                                padding: 'var(--space-3)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-lg)',
                                background: 'var(--color-bg-subtle)'
                            }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }, children: [_jsx("span", { style: { fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }, children: evidenceTypeLabel(evidence.evidenceType) }), _jsxs("span", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }, children: ["weight ", evidence.weight.toFixed(2)] })] }), evidence.snippet ? (_jsx("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text)' }, children: evidence.snippet })) : null, evidence.sourceRef ? (_jsxs("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }, children: ["source ", evidence.sourceRef] })) : null, formatEvidenceMetadata(evidence.metadata) ? (_jsx("pre", { style: {
                                        margin: 0,
                                        padding: 'var(--space-2)',
                                        borderRadius: 'var(--radius-md)',
                                        background: 'var(--color-bg)',
                                        overflowX: 'auto',
                                        fontSize: 'var(--text-xs)'
                                    }, children: formatEvidenceMetadata(evidence.metadata) })) : null] }, evidence.id))) }))] })] }));
}
export const ArticleRelationsGraph = () => {
    const { activeWorkspace } = useWorkspace();
    const summaryQuery = useIpc('article.relations.feature-map.summary');
    const scopeQuery = useIpc('article.relations.feature-map.scope');
    const neighborhoodQuery = useIpc('article.relations.neighborhood');
    const searchQuery = useIpc('workspace.search');
    const relationStatusQuery = useIpc('article.relations.status');
    const rebuildMutation = useIpcMutation('article.relations.rebuild');
    const viewportWidth = useViewportWidth();
    const [view, setView] = useState('features');
    const [sortField, setSortField] = useState(DEFAULT_SORT);
    const [selectedCategoryKey, setSelectedCategoryKey] = useState(null);
    const [selectedSectionKey, setSelectedSectionKey] = useState(null);
    const [selectedFamilyId, setSelectedFamilyId] = useState(null);
    const [selectedClusterId, setSelectedClusterId] = useState(null);
    const [selectedScopeEdgeId, setSelectedScopeEdgeId] = useState(null);
    const [selectedNeighborhoodEdgeId, setSelectedNeighborhoodEdgeId] = useState(null);
    const [includeBridges, setIncludeBridges] = useState(true);
    const [includeSuppressed, setIncludeSuppressed] = useState(false);
    const [hopCount, setHopCount] = useState(1);
    const [minScore, setMinScore] = useState(DEFAULT_MIN_SCORE);
    const [jumpToArticleText, setJumpToArticleText] = useState('');
    const [rebuildMessage, setRebuildMessage] = useState(null);
    const [relationJob, setRelationJob] = useState(null);
    const [analysisError, setAnalysisError] = useState(null);
    const [articleReturnView, setArticleReturnView] = useState('features');
    const [selectedBridgeState, setSelectedBridgeState] = useState(null);
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
            if (event.command !== 'article.relations.refresh')
                return;
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
    const categoryCards = useMemo(() => (sortFeatureCards((summaryQuery.data?.categories ?? []).map((category) => ({
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
    })), sortField)), [sortField, summaryQuery.data?.categories]);
    const sectionCards = useMemo(() => (sortFeatureCards((summaryQuery.data?.categories ?? []).flatMap((category) => (category.sections.map((section) => ({
        key: buildScopeKey('section', section.sectionId),
        scopeType: 'section',
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
    })))), sortField)), [sortField, summaryQuery.data?.categories]);
    useEffect(() => {
        if (!selectedCategoryKey && categoryCards.length > 0) {
            setSelectedCategoryKey(categoryCards[0].key);
        }
        if (!selectedSectionKey && sectionCards.length > 0) {
            setSelectedSectionKey(sectionCards[0].key);
        }
    }, [categoryCards, sectionCards, selectedCategoryKey, selectedSectionKey]);
    const selectedCategoryCard = useMemo(() => categoryCards.find((item) => item.key === selectedCategoryKey) ?? null, [categoryCards, selectedCategoryKey]);
    const selectedSectionCard = useMemo(() => sectionCards.find((item) => item.key === selectedSectionKey) ?? null, [sectionCards, selectedSectionKey]);
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
            setSelectedClusterId((current) => (current && scopeQuery.data?.clusters.some((cluster) => cluster.clusterId === current)
                ? current
                : scopeQuery.data?.clusters[0]?.clusterId ?? null));
        }
        else {
            setSelectedClusterId(null);
        }
    }, [scopeQuery.data?.clusters]);
    const familySearchResults = useMemo(() => dedupeSearchResults(searchQuery.data?.results ?? []), [searchQuery.data?.results]);
    const scopeArticlesById = useMemo(() => new Map((scopeQuery.data?.articles ?? []).map((article) => [article.familyId, article])), [scopeQuery.data?.articles]);
    const selectedCluster = useMemo(() => ((scopeQuery.data?.clusters ?? []).find((cluster) => cluster.clusterId === selectedClusterId) ?? null), [scopeQuery.data?.clusters, selectedClusterId]);
    const selectedClusterGraphNodes = useMemo(() => {
        if (!selectedCluster)
            return [];
        const clusterArticleIdSet = new Set(selectedCluster.articleIds);
        const degreeById = new Map();
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
            .filter((article) => Boolean(article))
            .map((article) => ({
            familyId: article.familyId,
            title: article.title,
            sectionId: article.sectionId,
            categoryId: article.categoryId,
            degree: degreeById.get(article.familyId) ?? 0
        }));
    }, [scopeArticlesById, scopeQuery.data?.relations, selectedCluster]);
    const selectedClusterGraphEdges = useMemo(() => {
        if (!selectedCluster)
            return [];
        const clusterArticleIdSet = new Set(selectedCluster.articleIds);
        return (scopeQuery.data?.relations ?? [])
            .filter((relation) => (clusterArticleIdSet.has(relation.leftFamilyId)
            && clusterArticleIdSet.has(relation.rightFamilyId)))
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
    const selectedScopeEdge = useMemo(() => (selectedClusterGraphEdges.find((edge) => edge.relationId === selectedScopeEdgeId) ?? null), [selectedClusterGraphEdges, selectedScopeEdgeId]);
    const neighborhoodGraphNodes = useMemo(() => ((neighborhoodQuery.data?.nodes ?? []).map((node) => ({
        familyId: node.familyId,
        title: node.title,
        sectionId: node.sectionId,
        categoryId: node.categoryId,
        degree: node.degree
    }))), [neighborhoodQuery.data?.nodes]);
    const neighborhoodGraphEdges = useMemo(() => ((neighborhoodQuery.data?.edges ?? []).map((edge) => ({
        relationId: edge.relationId,
        leftFamilyId: edge.leftFamilyId,
        rightFamilyId: edge.rightFamilyId,
        relationType: edge.relationType,
        origin: edge.origin,
        status: edge.status,
        strengthScore: edge.strengthScore,
        evidence: edge.evidence
    }))), [neighborhoodQuery.data?.edges]);
    const selectedNeighborhoodEdge = useMemo(() => (neighborhoodGraphEdges.find((edge) => edge.relationId === selectedNeighborhoodEdgeId) ?? null), [neighborhoodGraphEdges, selectedNeighborhoodEdgeId]);
    const neighborhoodNodesById = useMemo(() => new Map(neighborhoodQuery.data?.nodes.map((node) => [node.familyId, node.title]) ?? []), [neighborhoodQuery.data?.nodes]);
    const categoryCardsById = useMemo(() => new Map(categoryCards.map((item) => [item.scopeId ?? '__none__', item])), [categoryCards]);
    const sectionCardsById = useMemo(() => new Map(sectionCards.map((item) => [item.scopeId ?? '__none__', item])), [sectionCards]);
    const currentScope = useMemo(() => {
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
    const relationHealth = deriveRelationHealth(relationStatusQuery.data?.summary, relationStatusQuery.data?.latestRun, relationBusy, analysisError);
    const openArticleFamily = async (familyId) => {
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
    const openCategoryDetail = (scopeId, options) => {
        setSelectedCategoryKey(buildScopeKey('category', scopeId));
        setView('category');
        setSelectedFamilyId(null);
        setSelectedScopeEdgeId(null);
        setSelectedNeighborhoodEdgeId(null);
        if (!options?.preserveBridge) {
            setSelectedBridgeState(null);
        }
    };
    const openSectionDetail = (scopeId, options) => {
        setSelectedSectionKey(buildScopeKey('section', scopeId));
        setView('section');
        setSelectedFamilyId(null);
        setSelectedScopeEdgeId(null);
        setSelectedNeighborhoodEdgeId(null);
        if (!options?.preserveBridge) {
            setSelectedBridgeState(null);
        }
    };
    const openArticleNeighborhood = (familyId) => {
        setArticleReturnView(view === 'category' || view === 'section'
            ? view
            : view === 'article'
                ? articleReturnView
                : 'features');
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
    const openBridgeTarget = (bridge) => {
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
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Feature Map", subtitle: "No workspace selected" }), _jsx("div", { className: "route-content", children: _jsx(EmptyState, { icon: _jsx(IconLayers, { size: 48 }), title: "No workspace open", description: "Open a workspace to explore categories, sections, clusters, and article neighborhoods." }) })] }));
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
    const leftPane = (_jsxs("div", { style: { display: 'grid', gap: 'var(--space-4)', position: stackedPanes ? 'static' : 'sticky', top: 'var(--space-4)' }, children: [_jsx(TaxonomyStatusCard, { taxonomyStatus: summaryQuery.data?.taxonomyStatus }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "card-header", style: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'center' }, children: [_jsx("span", { className: "card-header-title", children: "Categories" }), _jsx(Badge, { variant: "neutral", children: categoryCards.length })] }), _jsx("div", { className: "card-body", style: { display: 'grid', gap: 'var(--space-2)' }, children: summaryQuery.loading && !summaryQuery.data ? (_jsx(LoadingState, { message: "Loading categories..." })) : categoryCards.length === 0 ? (_jsx(EmptyState, { icon: _jsx(IconLayers, { size: 34 }), title: "No categories yet", description: "This view only depends on KB article scope membership and relations. Sync category or section metadata to replace fallback labels." })) : (categoryCards.map((item) => (_jsx(FeatureListItem, { item: item, active: view === 'category' && item.key === selectedCategoryKey, onClick: () => openCategoryDetail(item.scopeId) }, item.key)))) })] }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "card-header", style: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'center' }, children: [_jsx("span", { className: "card-header-title", children: "Sections" }), _jsx(Badge, { variant: "neutral", children: sectionCards.length })] }), _jsx("div", { className: "card-body", style: { display: 'grid', gap: 'var(--space-2)' }, children: summaryQuery.loading && !summaryQuery.data ? (_jsx(LoadingState, { message: "Loading sections..." })) : sectionCards.length === 0 ? (_jsx(EmptyState, { icon: _jsx(IconLayers, { size: 34 }), title: "No sections yet", description: "Sections appear here as soon as KB articles carry section membership, even when the workspace has zero PBIs." })) : (sectionCards.map((item) => (_jsx(FeatureListItem, { item: item, active: view === 'section' && item.key === selectedSectionKey, onClick: () => openSectionDetail(item.scopeId) }, item.key)))) })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "card-header", children: _jsx("span", { className: "card-header-title", children: "Jump To Article" }) }), _jsxs("div", { className: "card-body", style: { display: 'grid', gap: 'var(--space-3)' }, children: [_jsxs("label", { style: { display: 'grid', gap: 6 }, children: [_jsx("span", { style: { fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }, children: "Optional article jump" }), _jsxs("div", { style: { position: 'relative' }, children: [_jsx(IconSearch, { size: 14, className: "input-icon" }), _jsx("input", { className: "input input-sm", style: { paddingLeft: 32 }, placeholder: "Search article title...", value: jumpToArticleText, onChange: (event) => setJumpToArticleText(event.target.value) })] })] }), jumpToArticleText.trim().length < 2 ? (_jsx("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }, children: "Search is optional here. The default way into the map is categories, sections, clusters, and bridges." })) : searchQuery.loading ? (_jsx(LoadingState, { message: "Searching articles..." })) : familySearchResults.length === 0 ? (_jsxs("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }, children: ["No article matches for \u201C", jumpToArticleText.trim(), "\u201D."] })) : (familySearchResults.slice(0, 8).map((result) => (_jsxs("button", { type: "button", className: "btn btn-secondary btn-sm", style: { justifyContent: 'space-between', textAlign: 'left' }, onClick: () => openArticleNeighborhood(result.familyId), children: [_jsx("span", { style: { overflow: 'hidden', textOverflow: 'ellipsis' }, children: result.title }), _jsx(IconArrowUpRight, { size: 13 })] }, result.familyId))))] })] })] }));
    const centerPane = (_jsxs("div", { style: { display: 'grid', gap: 'var(--space-4)' }, children: [view === 'features' ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "card", children: [_jsxs("div", { className: "card-header", style: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("span", { className: "card-header-title", children: "Feature Map Home" }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: [_jsx(Badge, { variant: taxonomyStatusVariant(summaryQuery.data?.taxonomyStatus.status), children: taxonomyStatusLabel(summaryQuery.data?.taxonomyStatus.status) }), _jsx(Badge, { variant: relationHealth.variant, children: relationHealth.label })] })] }), _jsxs("div", { className: "card-body", style: { display: 'grid', gap: 'var(--space-4)' }, children: [_jsx("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.7 }, children: "Browse KB features from categories and sections first, then drill into clusters, bridges, and article neighborhoods. This page is powered by KB article metadata and relations only." }), summaryQuery.data?.taxonomyStatus.status !== 'ready' ? (_jsxs("div", { style: {
                                            display: 'grid',
                                            gap: 'var(--space-2)',
                                            padding: 'var(--space-3)',
                                            borderRadius: 'var(--radius-lg)',
                                            border: '1px solid color-mix(in srgb, var(--color-warning) 25%, var(--color-border))',
                                            background: 'color-mix(in srgb, var(--color-warning-bg) 70%, white)'
                                        }, children: [_jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }, children: [_jsx(IconAlertCircle, { size: 16 }), _jsx("span", { style: { fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }, children: "Category or section naming is incomplete" })] }), _jsx("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }, children: "Relation analysis rebuilds the derived index and refreshes inferred relations. It does not repair taxonomy names; missing names will stay marked as fallback labels until sync data or overrides exist." })] })) : null, _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)' }, children: [_jsx(DetailStat, { label: "Categories", value: summaryQuery.data?.categories.length ?? 0 }), _jsx(DetailStat, { label: "Sections", value: countUniqueSections(summaryQuery.data) }), _jsx(DetailStat, { label: "Articles", value: countUniqueArticles(summaryQuery.data) }), _jsx(DetailStat, { label: "Clusters", value: countTotalClusters(summaryQuery.data) }), _jsx(DetailStat, { label: "Bridges", value: countTotalBridges(summaryQuery.data) }), _jsx(DetailStat, { label: "Stale Docs", value: countTotalStale(summaryQuery.data) })] })] })] }), summaryQuery.loading ? (_jsx(LoadingState, { message: "Loading feature map..." })) : summaryQuery.error ? (_jsx(ErrorState, { title: "Unable to load the feature map", description: summaryQuery.error })) : categoryCards.length === 0 ? (_jsx(EmptyState, { icon: _jsx(IconLayers, { size: 40 }), title: "No feature scopes yet", description: "Once KB articles have category or section membership, the feature map home will summarize them here." })) : (_jsx("div", { style: { display: 'grid', gap: 'var(--space-4)' }, children: categoryCards.map((category) => {
                            const categorySummary = summaryQuery.data?.categories.find((item) => item.categoryId === category.scopeId);
                            return (_jsxs("div", { className: "card", children: [_jsxs("div", { className: "card-header", style: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }, children: [_jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("span", { className: "card-header-title", children: category.label }), _jsx(Badge, { variant: scopeLabelSourceVariant(category.scopeLabel.labelSource), children: scopeLabelSourceLabel(category.scopeLabel.labelSource) })] }), _jsx("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: () => openCategoryDetail(category.scopeId), children: "Open Category" })] }), _jsxs("div", { className: "card-body", style: { display: 'grid', gap: 'var(--space-3)' }, children: [_jsx(ScopeMetricBadges, { summary: category }), _jsx("div", { style: { display: 'grid', gap: 'var(--space-2)' }, children: (categorySummary?.sections ?? [])
                                                    .sort((left, right) => right.bridgeEdgeCount - left.bridgeEdgeCount || left.sectionName.localeCompare(right.sectionName))
                                                    .map((section) => (_jsxs("button", { type: "button", className: "btn btn-secondary btn-sm", style: { justifyContent: 'space-between', textAlign: 'left' }, onClick: () => openSectionDetail(section.sectionId), children: [_jsxs("span", { style: { display: 'grid', gap: 4 }, children: [_jsx("span", { children: section.sectionName }), _jsxs("span", { style: { color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }, children: [section.articleCount, " articles / ", section.clusterCount, " clusters / ", section.bridgeEdgeCount, " bridges"] })] }), _jsx(Badge, { variant: scopeLabelSourceVariant(section.sectionLabel.labelSource), children: scopeLabelSourceLabel(section.sectionLabel.labelSource) })] }, buildScopeKey('section', section.sectionId)))) })] })] }, category.key));
                        }) }))] })) : null, (view === 'category' || view === 'section') ? (scopeQuery.loading && !scopeQuery.data ? (_jsx(LoadingState, { message: "Loading feature detail..." })) : scopeQuery.error ? (_jsx(ErrorState, { title: "Unable to load scope detail", description: scopeQuery.error })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "card", children: [_jsx("div", { className: "card-header", children: _jsx("span", { className: "card-header-title", children: view === 'category' ? 'Category Detail' : 'Section Detail' }) }), _jsxs("div", { className: "card-body", style: { display: 'grid', gap: 'var(--space-4)' }, children: [_jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }, children: [_jsx("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: openFeatureHome, children: "Feature Map Home" }), _jsx(Badge, { variant: "neutral", children: currentScope?.scopeType ?? view }), currentScope ? (_jsx(Badge, { variant: scopeLabelSourceVariant(currentScope.scopeLabel.labelSource), children: scopeLabelSourceLabel(currentScope.scopeLabel.labelSource) })) : null] }), _jsxs("div", { style: { display: 'grid', gap: 6 }, children: [_jsx("div", { style: { fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }, children: currentScope?.scopeName ?? (view === 'category' ? selectedCategoryCard?.label : selectedSectionCard?.label) }), _jsx("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.7 }, children: view === 'category'
                                                    ? 'This category view shows the sections, article clusters, and cross-feature bridges inside one KB feature area.'
                                                    : 'This section view focuses on one KB feature slice and the article clusters that define it.' }), currentScope?.scopeLabel.labelSource === 'fallback' ? (_jsx("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-warning)', lineHeight: 1.6 }, children: "This scope is still using a fallback label derived from raw IDs." })) : null] }), _jsx(ScopeMetricBadges, { summary: scopeQuery.data?.summary }), view === 'category' && selectedCategoryCard ? (_jsxs("div", { style: { display: 'grid', gap: 'var(--space-2)' }, children: [_jsx("div", { style: { fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }, children: "Sections In This Category" }), sectionCards
                                                .filter((item) => item.parentScopeId === selectedCategoryCard.scopeId)
                                                .map((item) => (_jsxs("button", { type: "button", className: "btn btn-secondary btn-sm", style: { justifyContent: 'space-between', textAlign: 'left' }, onClick: () => openSectionDetail(item.scopeId), children: [_jsxs("span", { style: { display: 'grid', gap: 4 }, children: [_jsx("span", { children: item.label }), _jsxs("span", { style: { color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }, children: [item.articleCount, " articles / ", item.clusterCount, " clusters"] })] }), _jsx(Badge, { variant: scopeLabelSourceVariant(item.scopeLabel.labelSource), children: scopeLabelSourceLabel(item.scopeLabel.labelSource) })] }, item.key)))] })) : null] })] }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "card-header", style: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'center' }, children: [_jsx("span", { className: "card-header-title", children: "Clusters" }), _jsx(Badge, { variant: "neutral", children: scopeQuery.data?.clusters.length ?? 0 })] }), _jsx("div", { className: "card-body", style: { display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }, children: (scopeQuery.data?.clusters ?? []).map((cluster) => (_jsxs("button", { type: "button", onClick: () => {
                                        setSelectedClusterId(cluster.clusterId);
                                        setSelectedScopeEdgeId(null);
                                    }, style: {
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
                                    }, children: [_jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', alignItems: 'center', justifyContent: 'space-between' }, children: [_jsx("div", { style: { fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }, children: cluster.label }), _jsx(Badge, { variant: cluster.labelSource === 'derived_keywords' ? 'primary' : 'neutral', children: clusterLabelSourceLabel(cluster.labelSource) })] }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: [_jsxs(Badge, { variant: "neutral", children: [cluster.articleCount, " articles"] }), _jsxs(Badge, { variant: "neutral", children: [cluster.internalEdgeCount, " internal"] }), _jsxs(Badge, { variant: "neutral", children: [cluster.bridgeEdgeCount, " bridges"] })] }), _jsxs("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }, children: ["Representatives: ", cluster.representativeArticleIds.map((familyId) => scopeArticlesById.get(familyId)?.title ?? familyId).join(', ')] })] }, cluster.clusterId))) })] }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "card-header", style: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'center' }, children: [_jsx("span", { className: "card-header-title", children: "Article Inventory" }), _jsx(Badge, { variant: "neutral", children: scopeQuery.data?.articles.length ?? 0 })] }), _jsx("div", { className: "card-body", style: { display: 'grid', gap: 'var(--space-2)' }, children: (scopeQuery.data?.articles ?? []).map((article) => (_jsxs("button", { type: "button", className: "btn btn-secondary btn-sm", style: { justifyContent: 'space-between', textAlign: 'left' }, onClick: () => openArticleNeighborhood(article.familyId), children: [_jsxs("span", { style: { display: 'grid', gap: 4 }, children: [_jsx("span", { children: article.title }), _jsxs("span", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: [_jsx(Badge, { variant: scopeLabelSourceVariant(categoryCardsById.get(article.categoryId ?? '__none__')?.scopeLabel.labelSource ?? 'fallback'), children: categoryCardsById.get(article.categoryId ?? '__none__')?.label ?? 'Uncategorized' }), _jsx(Badge, { variant: scopeLabelSourceVariant(sectionCardsById.get(article.sectionId ?? '__none__')?.scopeLabel.labelSource ?? 'fallback'), children: sectionCardsById.get(article.sectionId ?? '__none__')?.label ?? 'Unsectioned' }), articleTaxonomyBadge(article) ? (_jsx(Badge, { variant: articleTaxonomyBadge(article)?.variant ?? 'neutral', children: articleTaxonomyBadge(article)?.label })) : null, !article.categoryId ? _jsx(Badge, { variant: "warning", children: "uncategorized" }) : null, !article.sectionId ? _jsx(Badge, { variant: "warning", children: "unsectioned" }) : null] })] }), _jsxs("span", { style: { color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }, children: [article.internalEdgeCount, " internal / ", article.bridgeEdgeCount, " bridges"] })] }, article.familyId))) })] }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "card-header", style: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'center' }, children: [_jsx("span", { className: "card-header-title", children: "Bridges" }), _jsx(Badge, { variant: "neutral", children: scopeQuery.data?.bridges.length ?? 0 })] }), _jsx("div", { className: "card-body", style: { display: 'grid', gap: 'var(--space-2)' }, children: (scopeQuery.data?.bridges ?? []).length === 0 ? (_jsx("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }, children: includeBridges
                                        ? 'No outward bridges are visible for this scope.'
                                        : 'Bridge rendering is off. Enable “Include bridges” above to inspect outward connections.' })) : ((scopeQuery.data?.bridges ?? []).map((bridge) => (_jsxs("button", { type: "button", className: "btn btn-secondary btn-sm", style: { justifyContent: 'space-between', textAlign: 'left' }, onClick: () => openBridgeTarget(bridge), children: [_jsxs("span", { style: { display: 'grid', gap: 4 }, children: [_jsx("span", { children: bridge.summary }), _jsxs("span", { style: { color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }, children: ["Opens ", bridge.targetScopeType, " detail: ", bridge.targetScopeName] })] }), _jsxs("span", { style: { display: 'grid', gap: 6, justifyItems: 'end' }, children: [_jsx(Badge, { variant: scopeLabelSourceVariant(bridge.targetScopeLabel.labelSource), children: scopeLabelSourceLabel(bridge.targetScopeLabel.labelSource) }), _jsxs("span", { style: { color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }, children: [bridge.edgeCount, " edges"] })] })] }, `${bridge.sourceClusterId}:${bridge.targetScopeType}:${bridge.targetScopeId ?? '__none__'}:${bridge.targetScopeName}`)))) })] }), _jsx(RelationGraph, { title: selectedCluster ? `Cluster Graph: ${selectedCluster.label}` : 'Cluster Graph', nodes: selectedClusterGraphNodes, edges: selectedClusterGraphEdges, centerFamilyId: selectedCluster?.representativeArticleIds[0], selectedEdgeId: selectedScopeEdgeId, onSelectEdge: setSelectedScopeEdgeId, onSelectNode: openArticleNeighborhood })] }))) : null, view === 'article' ? (neighborhoodQuery.loading && !neighborhoodQuery.data ? (_jsx(LoadingState, { message: "Loading article neighborhood..." })) : neighborhoodQuery.error ? (_jsx(ErrorState, { title: "Unable to load article neighborhood", description: neighborhoodQuery.error })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "card", children: [_jsx("div", { className: "card-header", children: _jsx("span", { className: "card-header-title", children: "Article Neighborhood" }) }), _jsxs("div", { className: "card-body", style: { display: 'grid', gap: 'var(--space-4)' }, children: [_jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }, children: [_jsx("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: openFeatureHome, children: "Feature Map Home" }), _jsx("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: returnFromArticle, children: articleReturnView === 'features' ? 'Back To Home' : `Back To ${articleReturnView === 'category' ? 'Category' : 'Section'}` })] }), _jsxs("div", { style: { display: 'grid', gap: 6 }, children: [_jsx("div", { style: { fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }, children: centerArticle?.title ?? 'Center Article' }), _jsx("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.7 }, children: "Article Neighborhood is a drill-down from the feature map. Use it to inspect how one article connects across the surrounding KB graph." })] }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: [centerArticleCategory ? (_jsxs("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: () => openCategoryDetail(centerArticleCategory.scopeId), children: ["Category: ", centerArticleCategory.label] })) : null, centerArticleSection ? (_jsxs("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: () => openSectionDetail(centerArticleSection.scopeId), children: ["Section: ", centerArticleSection.label] })) : null, articleTaxonomyBadge(centerArticle) ? (_jsx(Badge, { variant: articleTaxonomyBadge(centerArticle)?.variant ?? 'neutral', children: articleTaxonomyBadge(centerArticle)?.label })) : null, !centerArticle?.categoryId ? _jsx(Badge, { variant: "warning", children: "uncategorized" }) : null, !centerArticle?.sectionId ? _jsx(Badge, { variant: "warning", children: "unsectioned" }) : null, _jsx(Badge, { variant: "success", children: "manual relations visible" })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)' }, children: [_jsx(DetailStat, { label: "Nodes", value: neighborhoodQuery.data?.nodes.length ?? 0 }), _jsx(DetailStat, { label: "Edges", value: neighborhoodQuery.data?.edges.length ?? 0 }), _jsx(DetailStat, { label: "Hop Count", value: hopCount }), _jsx(DetailStat, { label: "Min Score", value: minScore.toFixed(1) })] })] })] }), _jsx(RelationGraph, { title: "Article Neighborhood", nodes: neighborhoodGraphNodes, edges: neighborhoodGraphEdges, centerFamilyId: selectedFamilyId ?? neighborhoodQuery.data?.centerArticle.familyId, selectedEdgeId: selectedNeighborhoodEdgeId, onSelectEdge: setSelectedNeighborhoodEdgeId, onSelectNode: openArticleNeighborhood }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "card-header", children: _jsx("span", { className: "card-header-title", children: "Neighbor Articles" }) }), _jsx("div", { className: "card-body", style: { display: 'grid', gap: 'var(--space-2)' }, children: (neighborhoodQuery.data?.nodes ?? []).map((node) => (_jsxs("button", { type: "button", className: "btn btn-secondary btn-sm", style: { justifyContent: 'space-between', textAlign: 'left' }, onClick: () => openArticleNeighborhood(node.familyId), children: [_jsx("span", { children: node.title }), _jsxs("span", { style: { color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }, children: ["degree ", node.degree] })] }, node.familyId))) })] })] }))) : null] }));
    const rightPane = (_jsxs("div", { style: { display: 'grid', gap: 'var(--space-4)', position: stackedPanes ? 'static' : 'sticky', top: 'var(--space-4)' }, children: [_jsxs("div", { className: "card", children: [_jsx("div", { className: "card-header", children: _jsx("span", { className: "card-header-title", children: "Selected Bridge" }) }), _jsx("div", { className: "card-body", style: { display: 'grid', gap: 'var(--space-3)' }, children: !selectedBridgeState ? (_jsx("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }, children: "Choose a bridge from a category or section to navigate into the connected scope and keep the bridge evidence visible here." })) : (_jsxs(_Fragment, { children: [_jsxs("div", { style: { display: 'grid', gap: 4 }, children: [_jsx("div", { style: { fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }, children: selectedBridgeState.bridge.summary }), _jsxs("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }, children: [selectedBridgeState.bridge.sourceClusterLabel, " connects out from ", selectedBridgeState.sourceScope.scopeName, " into ", selectedBridgeState.bridge.targetScopeName, "."] }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: [_jsxs(Badge, { variant: "neutral", children: [selectedBridgeState.bridge.edgeCount, " edges"] }), _jsxs(Badge, { variant: "neutral", children: ["max ", selectedBridgeState.bridge.maxStrengthScore.toFixed(2)] }), _jsx(Badge, { variant: "neutral", children: selectedBridgeState.bridge.targetScopeType }), _jsx(Badge, { variant: scopeLabelSourceVariant(selectedBridgeState.bridge.targetScopeLabel.labelSource), children: scopeLabelSourceLabel(selectedBridgeState.bridge.targetScopeLabel.labelSource) })] })] }), _jsx("div", { style: { display: 'grid', gap: 'var(--space-2)' }, children: selectedBridgeState.bridge.examples.map((example, index) => (_jsxs("div", { style: {
                                            display: 'grid',
                                            gap: 4,
                                            padding: 'var(--space-3)',
                                            border: '1px solid var(--color-border)',
                                            borderRadius: 'var(--radius-lg)',
                                            background: 'var(--color-bg-subtle)'
                                        }, children: [_jsxs("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text)' }, children: [example.leftTitle ?? example.leftFamilyId, " to ", example.rightTitle ?? example.rightFamilyId] }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: [_jsx(Badge, { variant: "neutral", children: relationTypeLabel(example.relationType) }), _jsxs(Badge, { variant: "neutral", children: ["score ", example.strengthScore.toFixed(2)] })] })] }, `${example.leftFamilyId}:${example.rightFamilyId}:${index}`))) }), _jsxs("div", { style: { display: 'grid', gap: 'var(--space-2)' }, children: [_jsxs("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: () => {
                                                if (selectedBridgeState.sourceScope.scopeType === 'category') {
                                                    openCategoryDetail(selectedBridgeState.sourceScope.scopeId);
                                                    return;
                                                }
                                                openSectionDetail(selectedBridgeState.sourceScope.scopeId);
                                            }, children: ["Open Source ", selectedBridgeState.sourceScope.scopeType === 'category' ? 'Category' : 'Section'] }), _jsxs("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: () => {
                                                if (selectedBridgeState.bridge.targetScopeType === 'category') {
                                                    openCategoryDetail(selectedBridgeState.bridge.targetScopeId, { preserveBridge: true });
                                                    return;
                                                }
                                                openSectionDetail(selectedBridgeState.bridge.targetScopeId, { preserveBridge: true });
                                            }, children: ["Open Target ", selectedBridgeState.bridge.targetScopeType === 'category' ? 'Category' : 'Section'] })] })] })) })] }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "card-header", children: _jsx("span", { className: "card-header-title", children: "Selected Article" }) }), _jsx("div", { className: "card-body", style: { display: 'grid', gap: 'var(--space-3)' }, children: centerArticle ? (_jsxs(_Fragment, { children: [_jsx("div", { style: { fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }, children: centerArticle.title }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: [centerArticleCategory ? (_jsxs(Badge, { variant: scopeLabelSourceVariant(centerArticleCategory.scopeLabel.labelSource), children: ["category: ", centerArticleCategory.label] })) : null, centerArticleSection ? (_jsxs(Badge, { variant: scopeLabelSourceVariant(centerArticleSection.scopeLabel.labelSource), children: ["section: ", centerArticleSection.label] })) : null, articleTaxonomyBadge(centerArticle) ? (_jsx(Badge, { variant: articleTaxonomyBadge(centerArticle)?.variant ?? 'neutral', children: articleTaxonomyBadge(centerArticle)?.label })) : null, !centerArticle.categoryId ? _jsx(Badge, { variant: "warning", children: "uncategorized" }) : null, !centerArticle.sectionId ? _jsx(Badge, { variant: "warning", children: "unsectioned" }) : null, typeof centerArticle.taxonomyConfidence === 'number' && articleTaxonomyBadge(centerArticle) ? (_jsxs(Badge, { variant: "neutral", children: ["confidence ", centerArticle.taxonomyConfidence.toFixed(2)] })) : null] }), _jsx("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: () => void openArticleFamily(centerArticle.familyId), children: "Open In Article Explorer" })] })) : (_jsx("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }, children: "Articles clicked from a scope inventory open Article Neighborhood immediately, and the selected article stays visible here." })) })] }), _jsx(EdgeEvidenceCard, { edge: view === 'article' ? selectedNeighborhoodEdge : selectedScopeEdge, leftTitle: view === 'article'
                    ? (selectedNeighborhoodEdge ? neighborhoodNodesById.get(selectedNeighborhoodEdge.leftFamilyId) : undefined)
                    : selectedScopeEdgeLeftTitle, rightTitle: view === 'article'
                    ? (selectedNeighborhoodEdge ? neighborhoodNodesById.get(selectedNeighborhoodEdge.rightFamilyId) : undefined)
                    : selectedScopeEdgeRightTitle }), _jsxs("div", { className: "card", children: [_jsx("div", { className: "card-header", children: _jsx("span", { className: "card-header-title", children: "Relation Engine" }) }), _jsxs("div", { className: "card-body", style: { display: 'grid', gap: 'var(--space-3)' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }, children: [_jsx("span", { style: { color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }, children: "Status" }), _jsx(Badge, { variant: relationHealth.variant, children: relationHealth.label })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }, children: [_jsx("span", { style: { color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }, children: "Indexed docs" }), _jsx("span", { children: relationStatusQuery.data?.summary.indexedDocumentCount ?? 0 })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }, children: [_jsx("span", { style: { color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }, children: "Stale docs" }), _jsx("span", { children: relationStatusQuery.data?.summary.staleDocumentCount ?? 0 })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }, children: [_jsx("span", { style: { color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }, children: "Chunks" }), _jsx("span", { children: relationStatusQuery.data?.summary.indexStats?.chunkCount ?? 0 })] }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: [_jsx(Badge, { variant: "success", children: "manual relations visible" }), _jsxs(Badge, { variant: "neutral", children: ["min score ", minScore.toFixed(1)] }), includeSuppressed ? _jsx(Badge, { variant: "warning", children: "suppressed shown" }) : null] }), _jsxs("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }, children: [relationHealth.description, " Full relation analysis rebuilds the index and refreshes inferred relations. Taxonomy names come from KB sync data and overrides, not from relation analysis."] })] })] })] }));
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Feature Map", subtitle: activeWorkspace.name, actions: (_jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'flex-end' }, children: [_jsxs("button", { className: "btn btn-primary btn-sm", onClick: () => void runFullRelationAnalysis(), disabled: fullAnalysisBusy, children: [_jsx(IconRefreshCw, { size: 13 }), fullAnalysisBusy ? 'Running Full Analysis...' : 'Run Full Relation Analysis'] }), _jsxs("button", { className: "btn btn-secondary btn-sm", onClick: () => {
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
                            }, disabled: summaryQuery.loading, children: [_jsx(IconRefreshCw, { size: 13 }), "Refresh View"] })] })) }), _jsxs("div", { className: "route-content", style: { display: 'grid', gap: 'var(--space-4)' }, children: [_jsxs("section", { style: {
                            display: 'grid',
                            gap: 'var(--space-4)',
                            padding: 'var(--space-4)',
                            border: '1px solid var(--color-border-strong)',
                            borderRadius: 'var(--radius-xl)',
                            background: 'linear-gradient(180deg, color-mix(in srgb, var(--color-primary) 4%, var(--color-bg)) 0%, var(--color-bg-subtle) 100%)',
                            boxShadow: 'var(--shadow-sm)'
                        }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'flex-start' }, children: [_jsxs("div", { style: { display: 'grid', gap: 6 }, children: [_jsx("div", { style: { fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text)' }, children: "KB-first feature explorer" }), _jsx("div", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6, maxWidth: 760 }, children: "Start from categories and sections, inspect article clusters inside each scope, follow bridges into connected features, and only drill into Article Neighborhood when you want one article\u2019s local graph." })] }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }, children: [_jsx(Badge, { variant: taxonomyStatusVariant(summaryQuery.data?.taxonomyStatus.status), children: taxonomyStatusLabel(summaryQuery.data?.taxonomyStatus.status) }), _jsx(Badge, { variant: relationHealth.variant, children: relationHealth.label })] })] }), _jsxs("div", { style: { display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }, children: [_jsxs("label", { style: {
                                            display: 'grid',
                                            gap: 6,
                                            padding: 'var(--space-3)',
                                            border: '1px solid var(--color-border)',
                                            borderRadius: 'var(--radius-lg)',
                                            background: 'var(--color-bg)',
                                            boxShadow: 'var(--shadow-xs)'
                                        }, children: [_jsx("span", { style: { fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }, children: "Home Sort" }), _jsxs("select", { className: "select input-sm", value: sortField, onChange: (event) => setSortField(event.target.value), children: [_jsx("option", { value: "stale", children: "Stale Docs Desc" }), _jsx("option", { value: "bridge", children: "Bridge Count Desc" }), _jsx("option", { value: "internal", children: "Internal Relations Desc" }), _jsx("option", { value: "articles", children: "Article Count Desc" }), _jsx("option", { value: "name", children: "Name Asc" })] })] }), _jsxs("label", { style: {
                                            display: 'grid',
                                            gap: 6,
                                            padding: 'var(--space-3)',
                                            border: '1px solid var(--color-border)',
                                            borderRadius: 'var(--radius-lg)',
                                            background: 'var(--color-bg)',
                                            boxShadow: 'var(--shadow-xs)'
                                        }, children: [_jsx("span", { style: { fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }, children: "Minimum Score" }), _jsx("input", { className: "input input-sm", type: "number", min: 0, max: 3, step: 0.1, value: minScore, onChange: (event) => setMinScore(Number(event.target.value) || 0) })] }), _jsxs("div", { style: {
                                            display: 'grid',
                                            gap: 8,
                                            padding: 'var(--space-3)',
                                            border: '1px solid var(--color-border)',
                                            borderRadius: 'var(--radius-lg)',
                                            background: 'var(--color-bg)',
                                            boxShadow: 'var(--shadow-xs)'
                                        }, children: [_jsx("span", { style: { fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }, children: "Scope Visibility" }), _jsxs("label", { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)' }, children: [_jsx("input", { type: "checkbox", checked: includeBridges, onChange: (event) => setIncludeBridges(event.target.checked), disabled: view !== 'category' && view !== 'section' }), "Include bridges"] }), _jsxs("label", { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)' }, children: [_jsx("input", { type: "checkbox", checked: includeSuppressed, onChange: (event) => setIncludeSuppressed(event.target.checked) }), "Include suppressed"] }), _jsxs("label", { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)' }, children: [_jsx("input", { type: "checkbox", checked: hopCount === 2, onChange: (event) => setHopCount(event.target.checked ? 2 : 1), disabled: view !== 'article' }), "Two hops in Article Neighborhood"] })] })] }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }, children: [_jsxs(Badge, { variant: "neutral", children: [countUniqueArticles(summaryQuery.data), " articles"] }), _jsxs(Badge, { variant: "neutral", children: [countUniqueSections(summaryQuery.data), " sections"] }), _jsxs(Badge, { variant: "neutral", children: [countTotalClusters(summaryQuery.data), " clusters"] }), _jsxs(Badge, { variant: "neutral", children: [countTotalBridges(summaryQuery.data), " bridges"] }), _jsxs(Badge, { variant: countTotalStale(summaryQuery.data) > 0 ? 'warning' : 'neutral', children: [countTotalStale(summaryQuery.data), " stale docs"] }), _jsx(Badge, { variant: "success", children: "manual relations visible by default" }), rebuildMessage ? (_jsx("span", { style: { fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }, children: rebuildMessage })) : null] })] }), _jsx("div", { style: {
                            display: 'grid',
                            gridTemplateColumns: stackedPanes
                                ? 'minmax(0, 1fr)'
                                : 'minmax(260px, 320px) minmax(0, 1fr) minmax(300px, 360px)',
                            gap: 'var(--space-4)',
                            alignItems: 'start'
                        }, children: stackedPanes ? (_jsxs(_Fragment, { children: [centerPane, leftPane, rightPane] })) : (_jsxs(_Fragment, { children: [leftPane, centerPane, rightPane] })) })] })] }));
};
