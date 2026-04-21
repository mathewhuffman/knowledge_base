import { createHash } from 'node:crypto';
import type { SQLite } from '@kb-vault/db';
import type {
  ArticleNeighborhoodRequest,
  ArticleNeighborhoodResponse,
  ArticleRelationDirection,
  ArticleRelationEvidence,
  ArticleRelationType,
  FeatureClusterLabelSource,
  FeatureMapScopeSummary,
  FeatureMapSummaryRequest,
  FeatureMapSummaryResponse,
  FeatureScopeRequest,
  FeatureScopeResponse,
  KBScopeDisplayNameInput,
  KBScopeDisplayNameRecord,
  KBScopeType
} from '@kb-vault/shared-types';
import {
  ArticleRelationEvidenceType,
  ArticleRelationIndexStateStatus,
  ArticleRelationOrigin,
  ArticleRelationStatus,
  RevisionState
} from '@kb-vault/shared-types';

const PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX = 'proposal-';
const FEATURE_CLUSTER_MAX_PHRASE_LENGTH = 3;
const FEATURE_CLUSTER_GENERIC_STOPWORDS = new Set([
  'a',
  'add',
  'an',
  'and',
  'article',
  'basic',
  'center',
  'change',
  'configuration',
  'configure',
  'configuring',
  'create',
  'creating',
  'delete',
  'deleting',
  'disable',
  'edit',
  'editing',
  'enable',
  'faq',
  'faqs',
  'for',
  'from',
  'get',
  'getting',
  'guide',
  'guides',
  'help',
  'how',
  'intro',
  'introduction',
  'kb',
  'learn',
  'manage',
  'managing',
  'new',
  'of',
  'on',
  'overview',
  'remove',
  'reset',
  'set',
  'setup',
  'start',
  'started',
  'support',
  'the',
  'this',
  'to',
  'troubleshoot',
  'troubleshooting',
  'update',
  'updating',
  'use',
  'using',
  'view',
  'what',
  'when',
  'where',
  'why',
  'with',
  'your'
]);

interface FeatureMapFamilyRow {
  familyId: string;
  title: string;
  sectionId: string | null;
  categoryId: string | null;
  sectionSource: string | null;
  categorySource: string | null;
  taxonomyConfidence: number | null;
}

interface FeatureMapRelationRow {
  id: string;
  workspaceId: string;
  leftFamilyId: string;
  rightFamilyId: string;
  relationType: ArticleRelationType;
  direction: ArticleRelationDirection;
  strengthScore: number;
  status: ArticleRelationStatus;
  origin: ArticleRelationOrigin;
  runId: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  leftTitle: string;
  leftExternalKey: string | null;
  leftSectionId: string | null;
  leftCategoryId: string | null;
  rightTitle: string;
  rightExternalKey: string | null;
  rightSectionId: string | null;
  rightCategoryId: string | null;
}

interface ArticleRelationEvidenceRow {
  id: string;
  relationId: string;
  evidenceType: ArticleRelationEvidenceType;
  sourceRef: string | null;
  snippet: string | null;
  weight: number;
  metadataJson: string | null;
}

interface ArticleRelationCoverageSourceStateRow {
  familyId: string;
  localeVariantId: string;
}

interface FeatureClusterTitleToken {
  normalized: string;
  surface: string;
}

interface FeatureClusterPhraseCandidate {
  key: string;
  tokenCount: number;
  docFreq: number;
  totalOccurrences: number;
  surfaces: Map<string, number>;
}

export interface ArticleRelationsV2FeatureMapServiceDeps {
  withWorkspaceDb<T>(workspaceId: string, handler: (workspaceDb: SQLite) => Promise<T> | T): Promise<T>;
  resolveKbScopeDisplayNames(
    workspaceId: string,
    scopes: KBScopeDisplayNameInput[]
  ): Promise<KBScopeDisplayNameRecord[]>;
}

export class ArticleRelationsV2FeatureMapService {
  constructor(private readonly deps: ArticleRelationsV2FeatureMapServiceDeps) {}

  async getFeatureMapSummary(
    request: FeatureMapSummaryRequest
  ): Promise<FeatureMapSummaryResponse> {
    return this.deps.withWorkspaceDb(request.workspaceId, async (workspaceDb) => {
      const context = this.loadFeatureMapContext(workspaceDb, request.workspaceId, {
        minScore: 0,
        includeSuppressed: false
      });
      const scopeLabelsByKey = await this.buildScopeLabelMap(request.workspaceId, [
        ...context.families.flatMap((family) => ([
          { scopeType: 'category' as const, scopeId: family.categoryId ?? undefined },
          { scopeType: 'section' as const, scopeId: family.sectionId ?? undefined }
        ]))
      ]);
      const visibleContext = filterVisibleFeatureMapContext(context, scopeLabelsByKey);
      const familiesById = new Map(visibleContext.families.map((family) => [family.familyId, family]));
      const taxonomyStatus = summarizeFeatureMapTaxonomyStatus(scopeLabelsByKey);
      const categoryBuckets = new Map<string, FeatureMapFamilyRow[]>();

      for (const family of visibleContext.families) {
        const bucketKey = buildFeatureMapBucketKey('category', family.categoryId);
        const bucket = categoryBuckets.get(bucketKey) ?? [];
        bucket.push(family);
        categoryBuckets.set(bucketKey, bucket);
      }

      const categories = Array.from(categoryBuckets.entries())
        .map(([bucketKey, families]) => {
          const categoryId = extractFeatureMapBucketScopeId(bucketKey);
          const categoryLabel = resolveFeatureMapScopeLabel(scopeLabelsByKey, 'category', categoryId);
          const summary = buildFeatureMapScopeSummary({
            scopeFamilies: families,
            familiesById,
            relations: visibleContext.relations,
            staleCountsByFamily: visibleContext.staleCountsByFamily,
            includeBridges: true
          });
          const sectionBuckets = new Map<string, FeatureMapFamilyRow[]>();

          for (const family of families) {
            const sectionBucketKey = buildFeatureMapBucketKey('section', family.sectionId);
            const bucket = sectionBuckets.get(sectionBucketKey) ?? [];
            bucket.push(family);
            sectionBuckets.set(sectionBucketKey, bucket);
          }

          const sections = Array.from(sectionBuckets.entries())
            .map(([sectionBucketKey, sectionFamilies]) => {
              const sectionId = extractFeatureMapBucketScopeId(sectionBucketKey);
              const sectionLabel = resolveFeatureMapScopeLabel(scopeLabelsByKey, 'section', sectionId);
              const sectionSummary = buildFeatureMapScopeSummary({
                scopeFamilies: sectionFamilies,
                familiesById,
                relations: visibleContext.relations,
                staleCountsByFamily: visibleContext.staleCountsByFamily,
                includeBridges: true
              });

              return {
                sectionId,
                sectionName: sectionLabel.displayName,
                sectionLabel,
                ...sectionSummary
              };
            })
            .sort((left, right) => left.sectionName.localeCompare(right.sectionName));

          return {
            categoryId,
            categoryName: categoryLabel.displayName,
            categoryLabel,
            articleCount: summary.articleCount,
            sectionCount: sections.length,
            clusterCount: summary.clusterCount,
            internalEdgeCount: summary.internalEdgeCount,
            bridgeEdgeCount: summary.bridgeEdgeCount,
            staleDocumentCount: summary.staleDocumentCount,
            manualEdgeCount: summary.manualEdgeCount,
            inferredEdgeCount: summary.inferredEdgeCount,
            sections
          };
        })
        .sort((left, right) => left.categoryName.localeCompare(right.categoryName));

      return {
        workspaceId: request.workspaceId,
        generatedAtUtc: new Date().toISOString(),
        taxonomyStatus,
        categories
      };
    });
  }

  async getFeatureScope(
    request: FeatureScopeRequest
  ): Promise<FeatureScopeResponse> {
    return this.deps.withWorkspaceDb(request.workspaceId, async (workspaceDb) => {
      const minScore = typeof request.minScore === 'number' ? Math.max(0, request.minScore) : 0;
      const includeBridges = request.includeBridges !== false;
      const context = this.loadFeatureMapContext(workspaceDb, request.workspaceId, {
        minScore,
        includeSuppressed: request.includeSuppressed === true
      });
      const scopeLabelsByKey = await this.buildScopeLabelMap(request.workspaceId, [
        { scopeType: request.scopeType, scopeId: request.scopeId },
        ...context.families.flatMap((family) => ([
          { scopeType: 'category' as const, scopeId: family.categoryId ?? undefined },
          { scopeType: 'section' as const, scopeId: family.sectionId ?? undefined }
        ]))
      ]);
      const visibleContext = filterVisibleFeatureMapContext(context, scopeLabelsByKey);
      const familiesById = new Map(visibleContext.families.map((family) => [family.familyId, family]));
      const scopeFamilies = visibleContext.families.filter((family) => (
        doesFeatureMapFamilyMatchScope(family, request.scopeType, request.scopeId)
      ));
      const scopeFamilyIds = new Set(scopeFamilies.map((family) => family.familyId));
      const { internalRelations, bridgeRelations } = partitionFeatureMapRelationsByScope(
        visibleContext.relations,
        scopeFamilyIds
      );
      const visibleBridgeRelations = includeBridges ? bridgeRelations : [];
      const activeInternalRelations = internalRelations.filter((relation) => relation.status === ArticleRelationStatus.ACTIVE);
      const clusters = buildFeatureMapClusters({
        scopeFamilies,
        familiesById,
        internalRelations: activeInternalRelations,
        bridgeRelations: visibleBridgeRelations
      });
      const clusterByFamilyId = new Map<string, string>();
      const clusterLabelsById = new Map<string, string>();

      for (const cluster of clusters) {
        clusterLabelsById.set(cluster.clusterId, cluster.label);
        for (const familyId of cluster.articleIds) {
          clusterByFamilyId.set(familyId, cluster.clusterId);
        }
      }

      const summary = buildFeatureMapScopeSummary({
        scopeFamilies,
        familiesById,
        relations: visibleContext.relations,
        staleCountsByFamily: visibleContext.staleCountsByFamily,
        includeBridges
      });
      const relations = this.mapRelationRows(
        internalRelations,
        this.loadRelationEvidenceByRelationId(workspaceDb, internalRelations.map((relation) => relation.id))
      ).sort(sortFeatureMapRelationEdges);
      const bridges = includeBridges
        ? buildFeatureMapBridges({
            scopeType: request.scopeType,
            familiesById,
            bridgeRelations,
            clusterByFamilyId,
            clusterLabelsById,
            scopeLabelsByKey
          })
        : [];
      const scopeLabel = resolveFeatureMapScopeLabel(scopeLabelsByKey, request.scopeType, request.scopeId);

      return {
        workspaceId: request.workspaceId,
        scope: {
          scopeType: request.scopeType,
          scopeId: normalizeFeatureMapScopeId(request.scopeId),
          scopeName: scopeLabel.displayName,
          scopeLabel
        },
        summary,
        articles: buildFeatureMapScopeArticles({
          scopeFamilies,
          internalRelations,
          bridgeRelations: visibleBridgeRelations
        }),
        relations,
        clusters,
        bridges
      };
    });
  }

  async getNeighborhood(
    request: ArticleNeighborhoodRequest
  ): Promise<ArticleNeighborhoodResponse> {
    return this.deps.withWorkspaceDb(request.workspaceId, (workspaceDb) => {
      const centerArticle = workspaceDb.get<FeatureMapFamilyRow>(
        `SELECT id as familyId,
                title,
                section_id as sectionId,
                category_id as categoryId,
                section_source as sectionSource,
                category_source as categorySource,
                taxonomy_confidence as taxonomyConfidence
           FROM article_families
          WHERE workspace_id = @workspaceId
            AND id = @familyId
            AND retired_at IS NULL
            AND lower(external_key) NOT LIKE @proposalScopedPattern`,
        {
          workspaceId: request.workspaceId,
          familyId: request.familyId,
          proposalScopedPattern: `${PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX}%`
        }
      );

      if (!centerArticle) {
        throw new Error('Article family not found');
      }

      const families = this.loadFeatureMapFamilies(workspaceDb, request.workspaceId);
      const familiesById = new Map(families.map((family) => [family.familyId, family]));
      const relations = this.loadFeatureMapRelations(workspaceDb, request.workspaceId, {
        minScore: typeof request.minScore === 'number' ? Math.max(0, request.minScore) : 0,
        includeSuppressed: request.includeSuppressed === true
      });
      const hopCount = request.hopCount === 2 ? 2 : 1;
      const visibleFamilyIds = collectFeatureMapNeighborhoodFamilyIds(
        request.familyId,
        relations,
        hopCount
      );
      const neighborhoodRelations = relations.filter((relation) => (
        visibleFamilyIds.has(relation.leftFamilyId)
        && visibleFamilyIds.has(relation.rightFamilyId)
      ));
      const evidenceByRelationId = this.loadRelationEvidenceByRelationId(
        workspaceDb,
        neighborhoodRelations.map((relation) => relation.id)
      );
      const degreeByFamilyId = new Map<string, number>();

      for (const familyId of visibleFamilyIds) {
        degreeByFamilyId.set(familyId, 0);
      }

      for (const relation of neighborhoodRelations) {
        degreeByFamilyId.set(
          relation.leftFamilyId,
          (degreeByFamilyId.get(relation.leftFamilyId) ?? 0) + 1
        );
        degreeByFamilyId.set(
          relation.rightFamilyId,
          (degreeByFamilyId.get(relation.rightFamilyId) ?? 0) + 1
        );
      }

      return {
        workspaceId: request.workspaceId,
        centerArticle: {
          familyId: centerArticle.familyId,
          title: centerArticle.title,
          sectionId: centerArticle.sectionId ?? undefined,
          categoryId: centerArticle.categoryId ?? undefined,
          sectionSource: normalizeFeatureMapScopeId(centerArticle.sectionSource) as FeatureScopeResponse['articles'][number]['sectionSource'],
          categorySource: normalizeFeatureMapScopeId(centerArticle.categorySource) as FeatureScopeResponse['articles'][number]['categorySource'],
          taxonomyConfidence: centerArticle.taxonomyConfidence ?? undefined
        },
        nodes: Array.from(visibleFamilyIds)
          .map((familyId) => familiesById.get(familyId))
          .filter((family): family is FeatureMapFamilyRow => Boolean(family))
          .map((family) => ({
            familyId: family.familyId,
            title: family.title,
            sectionId: family.sectionId ?? undefined,
            categoryId: family.categoryId ?? undefined,
            sectionSource: normalizeFeatureMapScopeId(family.sectionSource) as FeatureScopeResponse['articles'][number]['sectionSource'],
            categorySource: normalizeFeatureMapScopeId(family.categorySource) as FeatureScopeResponse['articles'][number]['categorySource'],
            taxonomyConfidence: family.taxonomyConfidence ?? undefined,
            degree: degreeByFamilyId.get(family.familyId) ?? 0
          }))
          .sort((left, right) => (
            Number(right.familyId === request.familyId) - Number(left.familyId === request.familyId)
            || right.degree - left.degree
            || left.title.localeCompare(right.title)
          )),
        edges: this.mapRelationRows(neighborhoodRelations, evidenceByRelationId).sort(sortFeatureMapRelationEdges)
      };
    });
  }

  private async buildScopeLabelMap(
    workspaceId: string,
    scopes: KBScopeDisplayNameInput[]
  ): Promise<Map<string, KBScopeDisplayNameRecord>> {
    const records = await this.deps.resolveKbScopeDisplayNames(workspaceId, scopes);
    return new Map(records.map((record) => [buildFeatureMapBucketKey(record.scopeType, record.scopeId), record]));
  }

  private loadFeatureMapContext(
    workspaceDb: SQLite,
    workspaceId: string,
    options: {
      minScore: number;
      includeSuppressed: boolean;
    }
  ): {
    families: FeatureMapFamilyRow[];
    relations: FeatureMapRelationRow[];
    staleCountsByFamily: Map<string, number>;
  } {
    return {
      families: this.loadFeatureMapFamilies(workspaceDb, workspaceId),
      relations: this.loadFeatureMapRelations(workspaceDb, workspaceId, options),
      staleCountsByFamily: this.loadFeatureMapStaleCounts(workspaceDb, workspaceId)
    };
  }

  private loadFeatureMapFamilies(
    workspaceDb: SQLite,
    workspaceId: string
  ): FeatureMapFamilyRow[] {
    return workspaceDb.all<FeatureMapFamilyRow>(
      `SELECT id as familyId,
              title,
              section_id as sectionId,
              category_id as categoryId,
              section_source as sectionSource,
              category_source as categorySource,
              taxonomy_confidence as taxonomyConfidence
         FROM article_families
        WHERE workspace_id = @workspaceId
          AND retired_at IS NULL
          AND lower(external_key) NOT LIKE @proposalScopedPattern
        ORDER BY title COLLATE NOCASE ASC`,
      {
        workspaceId,
        proposalScopedPattern: `${PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX}%`
      }
    );
  }

  private loadFeatureMapRelations(
    workspaceDb: SQLite,
    workspaceId: string,
    options: {
      minScore: number;
      includeSuppressed: boolean;
    }
  ): FeatureMapRelationRow[] {
    const where: string[] = [
      'r.workspace_id = @workspaceId',
      'r.strength_score >= @minScore',
      'left_f.retired_at IS NULL',
      'right_f.retired_at IS NULL',
      'lower(left_f.external_key) NOT LIKE @proposalScopedPattern',
      'lower(right_f.external_key) NOT LIKE @proposalScopedPattern'
    ];
    const params: Record<string, string | number> = {
      workspaceId,
      minScore: options.minScore,
      proposalScopedPattern: `${PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX}%`,
      activeStatus: ArticleRelationStatus.ACTIVE,
      suppressedStatus: ArticleRelationStatus.SUPPRESSED
    };

    if (options.includeSuppressed) {
      where.push('(r.status = @activeStatus OR r.status = @suppressedStatus)');
    } else {
      where.push('r.status = @activeStatus');
    }

    return workspaceDb.all<FeatureMapRelationRow>(
      `SELECT
         r.id,
         r.workspace_id as workspaceId,
         r.left_family_id as leftFamilyId,
         r.right_family_id as rightFamilyId,
         r.relation_type as relationType,
         r.direction as direction,
         r.strength_score as strengthScore,
         r.status as status,
         r.origin as origin,
         r.run_id as runId,
         r.created_at as createdAtUtc,
         r.updated_at as updatedAtUtc,
         left_f.title as leftTitle,
         left_f.external_key as leftExternalKey,
         left_f.section_id as leftSectionId,
         left_f.category_id as leftCategoryId,
         right_f.title as rightTitle,
         right_f.external_key as rightExternalKey,
         right_f.section_id as rightSectionId,
         right_f.category_id as rightCategoryId
       FROM article_relations r
       JOIN article_families left_f ON left_f.id = r.left_family_id
       JOIN article_families right_f ON right_f.id = r.right_family_id
       WHERE ${where.join('\n         AND ')}
       ORDER BY r.strength_score DESC, r.updated_at DESC, r.id ASC`,
      params
    );
  }

  private loadFeatureMapStaleCounts(
    workspaceDb: SQLite,
    workspaceId: string
  ): Map<string, number> {
    const sourceStates = this.loadArticleRelationCoverageSourceStates(
      workspaceId,
      this.loadArticleRelationEnabledLocales(workspaceDb, workspaceId),
      workspaceDb
    );
    if (sourceStates.length === 0) {
      return new Map();
    }

    const params: Record<string, string> = { workspaceId };
    const localeVariantPlaceholders = buildNamedInClause(
      'featureMapLocaleVariant',
      sourceStates.map((row) => row.localeVariantId),
      params
    );
    const rows = workspaceDb.all<{ familyId: string; total: number }>(
      `SELECT family_id as familyId,
              COUNT(*) as total
         FROM article_relation_index_state
        WHERE workspace_id = @workspaceId
          AND status = @status
          AND locale_variant_id IN (${localeVariantPlaceholders})
        GROUP BY family_id`,
      {
        ...params,
        status: ArticleRelationIndexStateStatus.STALE
      }
    );

    return new Map(rows.map((row) => [row.familyId, row.total]));
  }

  private loadArticleRelationEnabledLocales(
    workspaceDb: SQLite,
    workspaceId: string
  ): string[] {
    const row = workspaceDb.get<{ enabledLocales: string | null }>(
      `SELECT enabled_locales as enabledLocales
         FROM workspace_settings
        WHERE workspace_id = @workspaceId`,
      { workspaceId }
    );

    return safeParseLocales(row?.enabledLocales ?? '["en-us"]');
  }

  private loadArticleRelationCoverageSourceStates(
    workspaceId: string,
    enabledLocales: string[],
    workspaceDb: SQLite
  ): ArticleRelationCoverageSourceStateRow[] {
    const selectedLocaleKeys = normalizeRelationCoverageLocaleKeys(enabledLocales);
    if (selectedLocaleKeys.length === 0) {
      return [];
    }

    const params: Record<string, string> = {
      workspaceId,
      proposalScopedPattern: `${PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX}%`,
      liveRevisionType: RevisionState.LIVE
    };

    return workspaceDb.all<ArticleRelationCoverageSourceStateRow>(
      `SELECT
         af.id as familyId,
         lv.id as localeVariantId
       FROM article_families af
       JOIN locale_variants lv ON lv.family_id = af.id
       JOIN revisions r
         ON r.id = (
           SELECT live.id
             FROM revisions live
            WHERE live.locale_variant_id = lv.id
              AND live.revision_type = @liveRevisionType
            ORDER BY live.revision_number DESC, live.updated_at DESC, live.id DESC
            LIMIT 1
         )
       WHERE af.workspace_id = @workspaceId
         AND af.retired_at IS NULL
         AND lower(af.external_key) NOT LIKE @proposalScopedPattern
         AND (lv.retired_at IS NULL OR lv.retired_at = '')
         AND lower(lv.locale) IN (${buildNamedInClause('locale', selectedLocaleKeys, params)})
       ORDER BY af.id ASC, lv.id ASC`,
      params
    );
  }

  private loadRelationEvidenceByRelationId(
    workspaceDb: SQLite,
    relationIds: string[]
  ): Map<string, ArticleRelationEvidence[]> {
    const normalizedRelationIds = Array.from(new Set(relationIds.map((relationId) => relationId.trim()).filter(Boolean)));
    if (normalizedRelationIds.length === 0) {
      return new Map();
    }

    const params: Record<string, string> = {};
    const rows = workspaceDb.all<ArticleRelationEvidenceRow>(
      `SELECT id,
              relation_id as relationId,
              evidence_type as evidenceType,
              source_ref as sourceRef,
              snippet,
              weight,
              metadata_json as metadataJson
         FROM article_relation_evidence
        WHERE relation_id IN (${buildNamedInClause('relationId', normalizedRelationIds, params)})
        ORDER BY relation_id ASC, weight DESC, id ASC`,
      params
    );
    const evidenceByRelationId = new Map<string, ArticleRelationEvidence[]>();

    for (const row of rows) {
      const bucket = evidenceByRelationId.get(row.relationId) ?? [];
      bucket.push({
        id: row.id,
        relationId: row.relationId,
        evidenceType: row.evidenceType,
        sourceRef: row.sourceRef ?? undefined,
        snippet: row.snippet ?? undefined,
        weight: row.weight,
        metadata: safeParseJson(row.metadataJson)
      });
      evidenceByRelationId.set(row.relationId, bucket);
    }

    return evidenceByRelationId;
  }

  private mapRelationRows(
    relations: FeatureMapRelationRow[],
    evidenceByRelationId: Map<string, ArticleRelationEvidence[]>
  ): Array<{
    relationId: string;
    leftFamilyId: string;
    rightFamilyId: string;
    relationType: string;
    origin: string;
    status: string;
    strengthScore: number;
    evidence: ArticleRelationEvidence[];
  }> {
    return relations.map((relation) => ({
      relationId: relation.id,
      leftFamilyId: relation.leftFamilyId,
      rightFamilyId: relation.rightFamilyId,
      relationType: relation.relationType,
      origin: relation.origin,
      status: relation.status,
      strengthScore: relation.strengthScore,
      evidence: evidenceByRelationId.get(relation.id) ?? []
    }));
  }
}

function normalizeFeatureMapScopeId(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function buildFeatureMapBucketKey(scopeType: KBScopeType, scopeId?: string | null): string {
  return `${scopeType}::${normalizeFeatureMapScopeId(scopeId) ?? '__none__'}`;
}

function extractFeatureMapBucketScopeId(bucketKey: string): string | undefined {
  const [, rawScopeId = ''] = bucketKey.split('::');
  return rawScopeId === '__none__' ? undefined : rawScopeId;
}

function buildFallbackKbScopeDisplayName(scopeType: KBScopeType, scopeId?: string | null): string {
  const normalizedScopeId = normalizeFeatureMapScopeId(scopeId);
  if (normalizedScopeId) {
    return `${normalizedScopeId} (fallback)`;
  }
  return scopeType === 'category' ? 'Uncategorized' : 'Unsectioned';
}

function resolveFeatureMapScopeLabel(
  scopeLabelsByKey: Map<string, KBScopeDisplayNameRecord>,
  scopeType: KBScopeType,
  scopeId?: string | null
): KBScopeDisplayNameRecord {
  return scopeLabelsByKey.get(buildFeatureMapBucketKey(scopeType, scopeId)) ?? {
    scopeType,
    scopeId: normalizeFeatureMapScopeId(scopeId),
    displayName: buildFallbackKbScopeDisplayName(scopeType, scopeId),
    labelSource: 'fallback',
    isHidden: false
  };
}

function summarizeFeatureMapTaxonomyStatus(
  scopeLabelsByKey: Map<string, KBScopeDisplayNameRecord>
): FeatureMapSummaryResponse['taxonomyStatus'] {
  const labels = Array.from(scopeLabelsByKey.values());
  const catalogScopeCount = labels.filter((label) => label.labelSource === 'catalog').length;
  const overrideScopeCount = labels.filter((label) => label.labelSource === 'override').length;
  const fallbackScopeCount = labels.filter((label) => label.labelSource === 'fallback').length;
  const totalScopeCount = labels.length;

  return {
    status: totalScopeCount === 0
      ? 'missing'
      : (fallbackScopeCount === 0
          ? 'ready'
          : ((catalogScopeCount > 0 || overrideScopeCount > 0) ? 'partial' : 'missing')),
    totalScopeCount,
    catalogScopeCount,
    overrideScopeCount,
    fallbackScopeCount
  };
}

function filterVisibleFeatureMapContext(
  context: {
    families: FeatureMapFamilyRow[];
    relations: FeatureMapRelationRow[];
    staleCountsByFamily: Map<string, number>;
  },
  scopeLabelsByKey: Map<string, KBScopeDisplayNameRecord>
): {
  families: FeatureMapFamilyRow[];
  relations: FeatureMapRelationRow[];
  staleCountsByFamily: Map<string, number>;
} {
  const visibleFamilies = context.families.filter((family) => isFeatureMapFamilyVisible(family, scopeLabelsByKey));
  const visibleFamilyIds = new Set(visibleFamilies.map((family) => family.familyId));

  return {
    families: visibleFamilies,
    relations: context.relations.filter((relation) => (
      visibleFamilyIds.has(relation.leftFamilyId)
      && visibleFamilyIds.has(relation.rightFamilyId)
    )),
    staleCountsByFamily: new Map(
      Array.from(context.staleCountsByFamily.entries()).filter(([familyId]) => visibleFamilyIds.has(familyId))
    )
  };
}

function isFeatureMapFamilyVisible(
  family: FeatureMapFamilyRow,
  scopeLabelsByKey: Map<string, KBScopeDisplayNameRecord>
): boolean {
  const categoryLabel = resolveFeatureMapScopeLabel(scopeLabelsByKey, 'category', family.categoryId);
  if (categoryLabel.isHidden) {
    return false;
  }

  const sectionLabel = resolveFeatureMapScopeLabel(scopeLabelsByKey, 'section', family.sectionId);
  return !sectionLabel.isHidden;
}

function doesFeatureMapFamilyMatchScope(
  family: FeatureMapFamilyRow,
  scopeType: KBScopeType,
  scopeId?: string | null
): boolean {
  const familyScopeId = scopeType === 'section'
    ? normalizeFeatureMapScopeId(family.sectionId)
    : normalizeFeatureMapScopeId(family.categoryId);
  return familyScopeId === normalizeFeatureMapScopeId(scopeId);
}

function partitionFeatureMapRelationsByScope(
  relations: FeatureMapRelationRow[],
  scopeFamilyIds: Set<string>
): {
  internalRelations: FeatureMapRelationRow[];
  bridgeRelations: FeatureMapRelationRow[];
} {
  const internalRelations: FeatureMapRelationRow[] = [];
  const bridgeRelations: FeatureMapRelationRow[] = [];

  for (const relation of relations) {
    const leftInside = scopeFamilyIds.has(relation.leftFamilyId);
    const rightInside = scopeFamilyIds.has(relation.rightFamilyId);

    if (leftInside && rightInside) {
      internalRelations.push(relation);
      continue;
    }

    if (leftInside || rightInside) {
      bridgeRelations.push(relation);
    }
  }

  return {
    internalRelations,
    bridgeRelations
  };
}

function buildFeatureMapScopeSummary(input: {
  scopeFamilies: FeatureMapFamilyRow[];
  familiesById: Map<string, FeatureMapFamilyRow>;
  relations: FeatureMapRelationRow[];
  staleCountsByFamily: Map<string, number>;
  includeBridges: boolean;
}): FeatureMapScopeSummary {
  const scopeFamilyIds = new Set(input.scopeFamilies.map((family) => family.familyId));
  const { internalRelations, bridgeRelations } = partitionFeatureMapRelationsByScope(input.relations, scopeFamilyIds);
  const visibleBridgeRelations = input.includeBridges ? bridgeRelations : [];
  const clusters = buildFeatureMapClusters({
    scopeFamilies: input.scopeFamilies,
    familiesById: input.familiesById,
    internalRelations: internalRelations.filter((relation) => relation.status === ArticleRelationStatus.ACTIVE),
    bridgeRelations: visibleBridgeRelations
  });
  const visibleRelations = [...internalRelations, ...visibleBridgeRelations];

  return {
    articleCount: input.scopeFamilies.length,
    clusterCount: clusters.length,
    internalEdgeCount: internalRelations.length,
    bridgeEdgeCount: visibleBridgeRelations.length,
    staleDocumentCount: input.scopeFamilies.reduce(
      (total, family) => total + (input.staleCountsByFamily.get(family.familyId) ?? 0),
      0
    ),
    manualEdgeCount: visibleRelations.filter((relation) => relation.origin === ArticleRelationOrigin.MANUAL).length,
    inferredEdgeCount: visibleRelations.filter((relation) => relation.origin === ArticleRelationOrigin.INFERRED).length
  };
}

function buildFeatureMapClusters(input: {
  scopeFamilies: FeatureMapFamilyRow[];
  familiesById: Map<string, FeatureMapFamilyRow>;
  internalRelations: FeatureMapRelationRow[];
  bridgeRelations: FeatureMapRelationRow[];
}): FeatureScopeResponse['clusters'] {
  if (input.scopeFamilies.length === 0) {
    return [];
  }

  const adjacency = new Map<string, Set<string>>();
  for (const family of input.scopeFamilies) {
    adjacency.set(family.familyId, new Set());
  }
  for (const relation of input.internalRelations) {
    adjacency.get(relation.leftFamilyId)?.add(relation.rightFamilyId);
    adjacency.get(relation.rightFamilyId)?.add(relation.leftFamilyId);
  }

  const orderedFamilies = input.scopeFamilies
    .slice()
    .sort((left, right) => left.title.localeCompare(right.title));
  const visited = new Set<string>();
  const clusters: FeatureScopeResponse['clusters'] = [];

  for (const family of orderedFamilies) {
    if (visited.has(family.familyId)) {
      continue;
    }

    const stack = [family.familyId];
    const articleIds: string[] = [];
    visited.add(family.familyId);

    while (stack.length > 0) {
      const familyId = stack.pop();
      if (!familyId) {
        continue;
      }
      articleIds.push(familyId);
      const neighbors = adjacency.get(familyId) ?? new Set<string>();
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) {
          continue;
        }
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }

    articleIds.sort((left, right) => {
      const leftTitle = input.familiesById.get(left)?.title ?? left;
      const rightTitle = input.familiesById.get(right)?.title ?? right;
      return leftTitle.localeCompare(rightTitle);
    });

    const articleIdSet = new Set(articleIds);
    const componentRelations = input.internalRelations.filter((relation) => (
      articleIdSet.has(relation.leftFamilyId)
      && articleIdSet.has(relation.rightFamilyId)
    ));
    const degreeByFamilyId = new Map<string, number>();
    for (const articleId of articleIds) {
      degreeByFamilyId.set(articleId, 0);
    }
    for (const relation of componentRelations) {
      degreeByFamilyId.set(relation.leftFamilyId, (degreeByFamilyId.get(relation.leftFamilyId) ?? 0) + 1);
      degreeByFamilyId.set(relation.rightFamilyId, (degreeByFamilyId.get(relation.rightFamilyId) ?? 0) + 1);
    }

    const representativeArticleIds = articleIds
      .slice()
      .sort((left, right) => (
        (degreeByFamilyId.get(right) ?? 0) - (degreeByFamilyId.get(left) ?? 0)
        || (input.familiesById.get(left)?.title ?? left).localeCompare(input.familiesById.get(right)?.title ?? right)
      ))
      .slice(0, 3);
    const labelDetails = deriveFeatureClusterLabel({
      articleIds,
      representativeArticleIds,
      familiesById: input.familiesById
    });
    const bridgeEdgeCount = input.bridgeRelations.filter((relation) => (
      articleIdSet.has(relation.leftFamilyId) || articleIdSet.has(relation.rightFamilyId)
    )).length;

    clusters.push({
      clusterId: `cluster-${createHash('sha1').update(articleIds.join(':')).digest('hex').slice(0, 12)}`,
      label: labelDetails.label,
      labelSource: labelDetails.labelSource,
      articleIds,
      articleCount: articleIds.length,
      internalEdgeCount: componentRelations.length,
      bridgeEdgeCount,
      representativeArticleIds
    });
  }

  return clusters.sort((left, right) => (
    right.articleCount - left.articleCount
    || right.internalEdgeCount - left.internalEdgeCount
    || left.label.localeCompare(right.label)
  ));
}

function buildFeatureMapScopeArticles(input: {
  scopeFamilies: FeatureMapFamilyRow[];
  internalRelations: FeatureMapRelationRow[];
  bridgeRelations: FeatureMapRelationRow[];
}): FeatureScopeResponse['articles'] {
  const statsByFamilyId = new Map<string, {
    totalEdgeCount: number;
    internalEdgeCount: number;
    bridgeEdgeCount: number;
  }>();

  for (const family of input.scopeFamilies) {
    statsByFamilyId.set(family.familyId, {
      totalEdgeCount: 0,
      internalEdgeCount: 0,
      bridgeEdgeCount: 0
    });
  }

  for (const relation of input.internalRelations) {
    const left = statsByFamilyId.get(relation.leftFamilyId);
    const right = statsByFamilyId.get(relation.rightFamilyId);
    if (left) {
      left.totalEdgeCount += 1;
      left.internalEdgeCount += 1;
    }
    if (right) {
      right.totalEdgeCount += 1;
      right.internalEdgeCount += 1;
    }
  }

  for (const relation of input.bridgeRelations) {
    const left = statsByFamilyId.get(relation.leftFamilyId);
    const right = statsByFamilyId.get(relation.rightFamilyId);
    if (left && !right) {
      left.totalEdgeCount += 1;
      left.bridgeEdgeCount += 1;
    } else if (right && !left) {
      right.totalEdgeCount += 1;
      right.bridgeEdgeCount += 1;
    }
  }

  return input.scopeFamilies
    .map((family) => {
      const stats = statsByFamilyId.get(family.familyId);
      return {
        familyId: family.familyId,
        title: family.title,
        sectionId: family.sectionId ?? undefined,
        categoryId: family.categoryId ?? undefined,
        sectionSource: normalizeFeatureMapScopeId(family.sectionSource) as FeatureScopeResponse['articles'][number]['sectionSource'],
        categorySource: normalizeFeatureMapScopeId(family.categorySource) as FeatureScopeResponse['articles'][number]['categorySource'],
        taxonomyConfidence: family.taxonomyConfidence ?? undefined,
        totalEdgeCount: stats?.totalEdgeCount ?? 0,
        internalEdgeCount: stats?.internalEdgeCount ?? 0,
        bridgeEdgeCount: stats?.bridgeEdgeCount ?? 0
      };
    })
    .sort((left, right) => (
      right.internalEdgeCount - left.internalEdgeCount
      || right.bridgeEdgeCount - left.bridgeEdgeCount
      || right.totalEdgeCount - left.totalEdgeCount
      || left.title.localeCompare(right.title)
    ));
}

function buildFeatureMapBridges(input: {
  scopeType: KBScopeType;
  familiesById: Map<string, FeatureMapFamilyRow>;
  bridgeRelations: FeatureMapRelationRow[];
  clusterByFamilyId: Map<string, string>;
  clusterLabelsById: Map<string, string>;
  scopeLabelsByKey: Map<string, KBScopeDisplayNameRecord>;
}): FeatureScopeResponse['bridges'] {
  const bridges = new Map<string, {
    sourceClusterId: string;
    sourceClusterLabel: string;
    targetScopeType: KBScopeType;
    targetScopeId?: string;
    targetScopeName: string;
    targetScopeLabel: KBScopeDisplayNameRecord;
    summary: string;
    edgeCount: number;
    maxStrengthScore: number;
    examples: Map<string, FeatureScopeResponse['bridges'][number]['examples'][number]>;
  }>();

  for (const relation of input.bridgeRelations) {
    const leftClusterId = input.clusterByFamilyId.get(relation.leftFamilyId);
    const rightClusterId = input.clusterByFamilyId.get(relation.rightFamilyId);
    if (!leftClusterId && !rightClusterId) {
      continue;
    }

    const outsideFamilyId = leftClusterId ? relation.rightFamilyId : relation.leftFamilyId;
    const sourceClusterId = leftClusterId ?? rightClusterId!;
    const outsideFamily = input.familiesById.get(outsideFamilyId);
    const targetScope = resolveFeatureMapBridgeTargetScope(input.scopeType, outsideFamily, input.scopeLabelsByKey);
    const sourceClusterLabel = input.clusterLabelsById.get(sourceClusterId) ?? 'This cluster';
    const bridgeKey = [
      sourceClusterId,
      targetScope.targetScopeType,
      targetScope.targetScopeId ?? '__none__',
      targetScope.targetScopeName
    ].join('::');
    const aggregate = bridges.get(bridgeKey) ?? {
      sourceClusterId,
      sourceClusterLabel,
      targetScopeType: targetScope.targetScopeType,
      targetScopeId: targetScope.targetScopeId,
      targetScopeName: targetScope.targetScopeName,
      targetScopeLabel: targetScope.targetScopeLabel,
      summary: buildFeatureMapBridgeSummary(sourceClusterLabel, targetScope.targetScopeName),
      edgeCount: 0,
      maxStrengthScore: 0,
      examples: new Map()
    };
    aggregate.edgeCount += 1;
    aggregate.maxStrengthScore = Math.max(aggregate.maxStrengthScore, relation.strengthScore);
    aggregate.examples.set(relation.id, {
      leftFamilyId: relation.leftFamilyId,
      leftTitle: input.familiesById.get(relation.leftFamilyId)?.title,
      rightFamilyId: relation.rightFamilyId,
      rightTitle: input.familiesById.get(relation.rightFamilyId)?.title,
      relationType: relation.relationType,
      strengthScore: relation.strengthScore
    });
    bridges.set(bridgeKey, aggregate);
  }

  return Array.from(bridges.values())
    .map((bridge) => ({
      sourceClusterId: bridge.sourceClusterId,
      sourceClusterLabel: bridge.sourceClusterLabel,
      targetScopeType: bridge.targetScopeType,
      targetScopeId: bridge.targetScopeId,
      targetScopeName: bridge.targetScopeName,
      targetScopeLabel: bridge.targetScopeLabel,
      summary: bridge.summary,
      edgeCount: bridge.edgeCount,
      maxStrengthScore: bridge.maxStrengthScore,
      examples: Array.from(bridge.examples.values())
        .sort((left, right) => (
          right.strengthScore - left.strengthScore
          || (left.leftTitle ?? left.leftFamilyId).localeCompare(right.leftTitle ?? right.leftFamilyId)
          || (left.rightTitle ?? left.rightFamilyId).localeCompare(right.rightTitle ?? right.rightFamilyId)
        ))
        .slice(0, 3)
    }))
    .sort((left, right) => (
      right.edgeCount - left.edgeCount
      || right.maxStrengthScore - left.maxStrengthScore
      || left.targetScopeName.localeCompare(right.targetScopeName)
    ));
}

function deriveFeatureClusterLabel(input: {
  articleIds: string[];
  representativeArticleIds: string[];
  familiesById: Map<string, FeatureMapFamilyRow>;
}): {
  label: string;
  labelSource: FeatureClusterLabelSource;
} {
  const representativeLabel = input.familiesById.get(input.representativeArticleIds[0] ?? input.articleIds[0])?.title
    ?? input.familiesById.get(input.articleIds[0])?.title
    ?? 'Cluster';

  if (input.articleIds.length < 2) {
    return {
      label: representativeLabel,
      labelSource: 'representative_article'
    };
  }

  const derivedLabel = deriveFeatureClusterKeywordLabel(
    input.articleIds
      .map((articleId) => input.familiesById.get(articleId)?.title?.trim())
      .filter((title): title is string => Boolean(title))
  );

  if (derivedLabel) {
    return {
      label: derivedLabel,
      labelSource: 'derived_keywords'
    };
  }

  return {
    label: representativeLabel,
    labelSource: 'representative_article'
  };
}

function deriveFeatureClusterKeywordLabel(titles: string[]): string | null {
  const candidates = collectFeatureClusterPhraseCandidates(titles).filter((candidate) => candidate.docFreq >= 2);
  if (candidates.length === 0) {
    return null;
  }

  const maxDocFreq = Math.max(...candidates.map((candidate) => candidate.docFreq));
  const preferredMultiWordCandidates = candidates.filter((candidate) => (
    candidate.tokenCount > 1
    && candidate.docFreq >= Math.max(2, maxDocFreq - 1)
  ));
  const candidatePool = preferredMultiWordCandidates.length > 0
    ? preferredMultiWordCandidates
    : candidates;

  candidatePool.sort(compareFeatureClusterPhraseCandidates);
  return selectFeatureClusterPhraseDisplay(candidatePool[0]);
}

function collectFeatureClusterPhraseCandidates(titles: string[]): FeatureClusterPhraseCandidate[] {
  const candidates = new Map<string, FeatureClusterPhraseCandidate>();

  titles.forEach((title) => {
    const tokens = extractFeatureClusterTitleTokens(title);
    if (tokens.length === 0) {
      return;
    }

    const seenInTitle = new Set<string>();
    for (let tokenCount = 1; tokenCount <= Math.min(FEATURE_CLUSTER_MAX_PHRASE_LENGTH, tokens.length); tokenCount += 1) {
      for (let start = 0; start + tokenCount <= tokens.length; start += 1) {
        const phraseTokens = tokens.slice(start, start + tokenCount);
        const key = phraseTokens.map((token) => token.normalized).join(' ');
        const surface = phraseTokens.map((token) => token.surface).join(' ');
        const candidate = candidates.get(key) ?? {
          key,
          tokenCount,
          docFreq: 0,
          totalOccurrences: 0,
          surfaces: new Map<string, number>()
        };

        candidate.totalOccurrences += 1;
        candidate.surfaces.set(surface, (candidate.surfaces.get(surface) ?? 0) + 1);
        if (!seenInTitle.has(key)) {
          candidate.docFreq += 1;
          seenInTitle.add(key);
        }
        candidates.set(key, candidate);
      }
    }
  });

  return Array.from(candidates.values());
}

function compareFeatureClusterPhraseCandidates(
  left: FeatureClusterPhraseCandidate,
  right: FeatureClusterPhraseCandidate
): number {
  return right.docFreq - left.docFreq
    || right.tokenCount - left.tokenCount
    || right.totalOccurrences - left.totalOccurrences
    || right.key.length - left.key.length
    || left.key.localeCompare(right.key);
}

function extractFeatureClusterTitleTokens(title: string): FeatureClusterTitleToken[] {
  const rawTokens = title.match(/[A-Za-z0-9]+/g) ?? [];

  return rawTokens
    .map((surface) => ({
      normalized: normalizeFeatureClusterToken(surface),
      surface
    }))
    .filter((token) => isFeatureClusterKeywordToken(token.normalized));
}

function normalizeFeatureClusterToken(rawToken: string): string {
  let normalized = rawToken.trim().toLowerCase();
  if (!normalized || /^\d+$/.test(normalized)) {
    return '';
  }

  if (normalized.length >= 5 && normalized.endsWith('ies')) {
    normalized = `${normalized.slice(0, -3)}y`;
  } else if (
    normalized.length >= 4
    && normalized.endsWith('s')
    && !normalized.endsWith('ss')
    && !normalized.endsWith('us')
  ) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

function isFeatureClusterKeywordToken(token: string): boolean {
  return token.length >= 2
    && /[a-z]/.test(token)
    && !FEATURE_CLUSTER_GENERIC_STOPWORDS.has(token);
}

function selectFeatureClusterPhraseDisplay(candidate: FeatureClusterPhraseCandidate | undefined): string | null {
  if (!candidate) {
    return null;
  }

  const preferredSurface = Array.from(candidate.surfaces.entries())
    .sort((left, right) => (
      right[1] - left[1]
      || left[0].length - right[0].length
      || left[0].localeCompare(right[0])
    ))[0]?.[0]
    ?.trim();

  if (preferredSurface) {
    return preferredSurface;
  }

  return candidate.key
    .split(' ')
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function buildFeatureMapBridgeSummary(sourceClusterLabel: string, targetScopeName: string): string {
  return `${sourceClusterLabel} connects to ${targetScopeName}`;
}

function resolveFeatureMapBridgeTargetScope(
  scopeType: KBScopeType,
  outsideFamily: FeatureMapFamilyRow | undefined,
  scopeLabelsByKey: Map<string, KBScopeDisplayNameRecord>
): {
  targetScopeType: KBScopeType;
  targetScopeId?: string;
  targetScopeName: string;
  targetScopeLabel: KBScopeDisplayNameRecord;
} {
  if (scopeType === 'section') {
    const sectionId = normalizeFeatureMapScopeId(outsideFamily?.sectionId);
    if (sectionId) {
      const targetScopeLabel = resolveFeatureMapScopeLabel(scopeLabelsByKey, 'section', sectionId);
      return {
        targetScopeType: 'section',
        targetScopeId: sectionId,
        targetScopeName: targetScopeLabel.displayName,
        targetScopeLabel
      };
    }

    const categoryId = normalizeFeatureMapScopeId(outsideFamily?.categoryId);
    const targetScopeLabel = resolveFeatureMapScopeLabel(scopeLabelsByKey, 'category', categoryId);
    return {
      targetScopeType: 'category',
      targetScopeId: categoryId,
      targetScopeName: targetScopeLabel.displayName,
      targetScopeLabel
    };
  }

  const categoryId = normalizeFeatureMapScopeId(outsideFamily?.categoryId);
  if (categoryId) {
    const targetScopeLabel = resolveFeatureMapScopeLabel(scopeLabelsByKey, 'category', categoryId);
    return {
      targetScopeType: 'category',
      targetScopeId: categoryId,
      targetScopeName: targetScopeLabel.displayName,
      targetScopeLabel
    };
  }

  const sectionId = normalizeFeatureMapScopeId(outsideFamily?.sectionId);
  const targetScopeLabel = resolveFeatureMapScopeLabel(scopeLabelsByKey, 'section', sectionId);
  return {
    targetScopeType: 'section',
    targetScopeId: sectionId,
    targetScopeName: targetScopeLabel.displayName,
    targetScopeLabel
  };
}

function collectFeatureMapNeighborhoodFamilyIds(
  centerFamilyId: string,
  relations: FeatureMapRelationRow[],
  hopCount: 1 | 2
): Set<string> {
  const adjacency = new Map<string, Set<string>>();
  for (const relation of relations) {
    const leftNeighbors = adjacency.get(relation.leftFamilyId) ?? new Set<string>();
    leftNeighbors.add(relation.rightFamilyId);
    adjacency.set(relation.leftFamilyId, leftNeighbors);

    const rightNeighbors = adjacency.get(relation.rightFamilyId) ?? new Set<string>();
    rightNeighbors.add(relation.leftFamilyId);
    adjacency.set(relation.rightFamilyId, rightNeighbors);
  }

  const visited = new Set<string>([centerFamilyId]);
  const queue: Array<{ familyId: string; depth: number }> = [{ familyId: centerFamilyId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= hopCount) {
      continue;
    }

    for (const neighbor of adjacency.get(current.familyId) ?? new Set<string>()) {
      if (visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      queue.push({
        familyId: neighbor,
        depth: current.depth + 1
      });
    }
  }

  return visited;
}

function normalizeRelationCoverageLocaleKeys(locales?: string[]): string[] {
  const normalized = (locales ?? [])
    .map((locale) => locale.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function buildNamedInClause(
  prefix: string,
  values: string[],
  params: Record<string, string>
): string {
  return values.map((value, index) => {
    const key = `${prefix}${index}`;
    params[key] = value;
    return `@${key}`;
  }).join(', ');
}

function safeParseLocales(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed;
    }
  } catch {
    // no-op
  }
  return ['en-us'];
}

function safeParseJson(value: string | null): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function sortFeatureMapRelationEdges(
  left: { strengthScore: number; leftFamilyId: string; rightFamilyId: string },
  right: { strengthScore: number; leftFamilyId: string; rightFamilyId: string }
): number {
  return right.strengthScore - left.strengthScore
    || left.leftFamilyId.localeCompare(right.leftFamilyId)
    || left.rightFamilyId.localeCompare(right.rightFamilyId);
}
