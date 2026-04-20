import type { SQLite } from '@kb-vault/db';
import type { CoverageQueryRequest, CoverageQueryResponse } from '@kb-vault/shared-types';
import {
  addFamilyEvidence,
  buildCoverageMatchQuery,
  estimateFtsConfidence,
  finalizeFamilyAggregate,
  normalizeCoverageText,
  overlapRatio,
  roundCoverageScore,
  tokenizeCoverageText
} from './evidence';
import {
  ARTICLE_RELATIONS_V2_ENGINE_VERSION,
  type ArticleRelationsV2CoverageQueryResponse,
  type ArticleRelationsV2EvidenceRecord,
  type ArticleRelationsV2FamilyAggregate
} from './types';

interface CoverageQueryContext {
  workspaceDb: SQLite;
  indexDb: SQLite;
  request: CoverageQueryRequest;
}

interface DocumentMatchRow {
  familyId: string;
  localeVariantId: string;
  title: string;
  externalKey: string;
  headingsText: string;
  titleSnippet: string | null;
  headingSnippet: string | null;
  rank: number;
}

interface ChunkMatchRow {
  familyId: string;
  localeVariantId: string;
  title: string;
  externalKey: string;
  chunkId: string;
  headingPath: string | null;
  chunkSnippet: string | null;
  chunkText: string;
  rank: number;
}

interface SeedDocumentRow {
  familyId: string;
  localeVariantId: string;
  title: string;
  externalKey: string;
  sectionId: string | null;
  categoryId: string | null;
  headingsText: string;
}

interface CandidateSeedRow {
  familyId: string;
  localeVariantId: string;
  title: string;
  externalKey: string;
}

const DEFAULT_MAX_RESULTS = 24;
const DEFAULT_MIN_SCORE = 0.12;
const MAX_RETRIEVAL_ROWS = 80;

export class ArticleRelationsV2QueryService {
  queryCoverage(context: CoverageQueryContext): ArticleRelationsV2CoverageQueryResponse {
    const { workspaceDb, indexDb, request } = context;
    const aggregates = new Map<string, ArticleRelationsV2FamilyAggregate>();
    const excludedFamilies = new Set((request.seedFamilyIds ?? []).filter(Boolean));
    const includeEvidence = request.includeEvidence !== false;

    const directQueries = dedupeStrings([
      request.query?.trim() ?? '',
      ...(request.batchQueries ?? []).map((value) => value.trim())
    ].filter(Boolean));

    for (const queryText of directQueries) {
      this.collectExactMatches(indexDb, request.workspaceId, queryText, aggregates, excludedFamilies);
      this.collectDocumentMatches(indexDb, request.workspaceId, queryText, aggregates, excludedFamilies, 1, undefined);
      this.collectChunkMatches(indexDb, request.workspaceId, queryText, aggregates, excludedFamilies, 1, undefined);
    }

    const seedFamilyIds = Array.from(excludedFamilies);
    if (seedFamilyIds.length > 0) {
      const seedDocuments = this.loadSeedDocuments(indexDb, seedFamilyIds);
      this.collectExplicitLinkMatches(indexDb, seedDocuments, aggregates, excludedFamilies);
      this.collectManualRelationMatches(workspaceDb, indexDb, request.workspaceId, seedFamilyIds, aggregates, excludedFamilies);
      this.collectSectionAndCategoryMatches(indexDb, seedDocuments, aggregates, excludedFamilies);
      this.collectSeedExpansionMatches(indexDb, request.workspaceId, seedDocuments, aggregates, excludedFamilies);
    }

    const minScore = typeof request.minScore === 'number' ? request.minScore : DEFAULT_MIN_SCORE;
    const maxResults = clampMaxResults(request.maxResults);
    const results = Array.from(aggregates.values())
      .map((aggregate) => finalizeFamilyAggregate(aggregate))
      .filter((result) => !excludedFamilies.has(result.familyId))
      .filter((result) => result.finalScore >= minScore)
      .sort((left, right) =>
        right.finalScore - left.finalScore
        || Number(right.relationEligible) - Number(left.relationEligible)
        || left.title.localeCompare(right.title)
      )
      .slice(0, maxResults)
      .map((result): CoverageQueryResponse['results'][number] => ({
        ...result,
        evidence: includeEvidence ? result.evidence : []
      }));

    return {
      workspaceId: request.workspaceId,
      engineVersion: ARTICLE_RELATIONS_V2_ENGINE_VERSION,
      results
    };
  }

  private collectExactMatches(
    indexDb: SQLite,
    workspaceId: string,
    queryText: string,
    aggregates: Map<string, ArticleRelationsV2FamilyAggregate>,
    excludedFamilies: Set<string>
  ): void {
    const lookupTerms = buildLookupTerms(queryText);
    if (lookupTerms.length === 0) {
      return;
    }

    const exactKeyRows = indexDb.all<CandidateSeedRow & { matchedExternalKey: string }>(
      `SELECT family_id as familyId,
              locale_variant_id as localeVariantId,
              title,
              external_key as externalKey,
              normalized_external_key as matchedExternalKey
       FROM documents
       WHERE workspace_id = @workspaceId
         AND normalized_external_key IN (${buildNamedInClause('term', lookupTerms)})`,
      {
        workspaceId,
        ...buildNamedParams('term', lookupTerms)
      }
    );

    for (const row of exactKeyRows) {
      this.recordEvidence(aggregates, row, {
        evidenceType: 'external_key_exact',
        sourceRef: queryText,
        snippet: row.matchedExternalKey,
        weight: 1.55,
        signalStrength: 'strong'
      }, excludedFamilies);
    }

    const aliasRows = indexDb.all<CandidateSeedRow & { matchedAlias: string }>(
      `SELECT d.family_id as familyId,
              d.locale_variant_id as localeVariantId,
              d.title,
              d.external_key as externalKey,
              a.alias as matchedAlias
       FROM document_aliases a
       JOIN documents d ON d.locale_variant_id = a.locale_variant_id
       WHERE d.workspace_id = @workspaceId
         AND a.normalized_alias IN (${buildNamedInClause('alias', lookupTerms)})`,
      {
        workspaceId,
        ...buildNamedParams('alias', lookupTerms)
      }
    );

    for (const row of aliasRows) {
      this.recordEvidence(aggregates, row, {
        evidenceType: 'alias_exact',
        sourceRef: queryText,
        snippet: row.matchedAlias,
        weight: 1.4,
        signalStrength: 'strong'
      }, excludedFamilies);
    }
  }

  private collectDocumentMatches(
    indexDb: SQLite,
    workspaceId: string,
    queryText: string,
    aggregates: Map<string, ArticleRelationsV2FamilyAggregate>,
    excludedFamilies: Set<string>,
    scale: number,
    sourceFamilyId?: string
  ): void {
    const matchQuery = buildCoverageMatchQuery(queryText);
    if (!matchQuery) {
      return;
    }

    const rows = indexDb.all<DocumentMatchRow>(
      `SELECT d.family_id as familyId,
              d.locale_variant_id as localeVariantId,
              d.title,
              d.external_key as externalKey,
              d.headings_text as headingsText,
              snippet(documents_fts, 3, '', '', ' ... ', 12) as titleSnippet,
              snippet(documents_fts, 4, '', '', ' ... ', 12) as headingSnippet,
              bm25(documents_fts, 0.0, 0.0, 0.0, 5.0, 4.0, 1.5, 2.0, 0.35) as rank
       FROM documents_fts
       JOIN documents d ON d.locale_variant_id = documents_fts.locale_variant_id
       WHERE documents_fts.workspace_id = @workspaceId
         AND documents_fts MATCH @matchQuery
       ORDER BY rank
       LIMIT ${MAX_RETRIEVAL_ROWS}`,
      {
        workspaceId,
        matchQuery
      }
    );

    for (const row of rows) {
      const confidence = estimateFtsConfidence(row.rank);
      const titleOverlap = overlapRatio(queryText, row.title);
      const headingOverlap = overlapRatio(queryText, row.headingsText);

      if (titleOverlap > 0 || normalizeCoverageText(row.title).includes(normalizeCoverageText(queryText))) {
        this.recordEvidence(aggregates, row, {
          evidenceType: 'title_fts',
          sourceRef: sourceFamilyId ?? queryText,
          snippet: row.titleSnippet ?? row.title,
          weight: scale * roundCoverageScore((0.55 + (titleOverlap * 0.45)) * confidence),
          signalStrength: titleOverlap >= 0.75 ? 'strong' : 'medium',
          metadata: sourceFamilyId ? { sourceFamilyId, query: queryText } : { query: queryText }
        }, excludedFamilies);
      }

      if (headingOverlap > 0 || normalizeCoverageText(row.headingsText).includes(normalizeCoverageText(queryText))) {
        this.recordEvidence(aggregates, row, {
          evidenceType: 'heading_fts',
          sourceRef: sourceFamilyId ?? queryText,
          snippet: row.headingSnippet ?? firstNonEmptyLine(row.headingsText) ?? row.title,
          weight: scale * roundCoverageScore((0.48 + (headingOverlap * 0.4)) * confidence),
          signalStrength: headingOverlap >= 0.75 ? 'strong' : 'medium',
          metadata: sourceFamilyId ? { sourceFamilyId, query: queryText } : { query: queryText }
        }, excludedFamilies);
      }
    }
  }

  private collectChunkMatches(
    indexDb: SQLite,
    workspaceId: string,
    queryText: string,
    aggregates: Map<string, ArticleRelationsV2FamilyAggregate>,
    excludedFamilies: Set<string>,
    scale: number,
    sourceFamilyId?: string
  ): void {
    const matchQuery = buildCoverageMatchQuery(queryText);
    if (!matchQuery) {
      return;
    }

    const rows = indexDb.all<ChunkMatchRow>(
      `SELECT d.family_id as familyId,
              d.locale_variant_id as localeVariantId,
              d.title,
              d.external_key as externalKey,
              c.chunk_id as chunkId,
              c.heading_path as headingPath,
              c.text as chunkText,
              snippet(chunks_fts, 5, '', '', ' ... ', 18) as chunkSnippet,
              bm25(chunks_fts, 0.0, 0.0, 0.0, 0.0, 2.4, 1.0) as rank
       FROM chunks_fts
       JOIN document_chunks c ON c.chunk_id = chunks_fts.chunk_id
       JOIN documents d ON d.locale_variant_id = c.locale_variant_id
       WHERE chunks_fts.workspace_id = @workspaceId
         AND chunks_fts MATCH @matchQuery
       ORDER BY rank
       LIMIT ${MAX_RETRIEVAL_ROWS}`,
      {
        workspaceId,
        matchQuery
      }
    );

    for (const row of rows) {
      const confidence = estimateFtsConfidence(row.rank);
      const bodyOverlap = overlapRatio(queryText, row.chunkText);
      if (bodyOverlap <= 0 && !normalizeCoverageText(row.chunkText).includes(normalizeCoverageText(queryText))) {
        continue;
      }

      this.recordEvidence(aggregates, row, {
        evidenceType: 'body_chunk_fts',
        sourceRef: sourceFamilyId ?? queryText,
        snippet: row.chunkSnippet ?? row.chunkText.slice(0, 220),
        weight: scale * roundCoverageScore((0.34 + (bodyOverlap * 0.32)) * confidence),
        signalStrength: 'medium',
        metadata: {
          chunkId: row.chunkId,
          headingPath: row.headingPath ?? undefined,
          ...(sourceFamilyId ? { sourceFamilyId, query: queryText } : { query: queryText })
        }
      }, excludedFamilies);
    }
  }

  private loadSeedDocuments(indexDb: SQLite, seedFamilyIds: string[]): SeedDocumentRow[] {
    if (seedFamilyIds.length === 0) {
      return [];
    }

    return indexDb.all<SeedDocumentRow>(
      `SELECT family_id as familyId,
              locale_variant_id as localeVariantId,
              title,
              external_key as externalKey,
              section_id as sectionId,
              category_id as categoryId,
              headings_text as headingsText
       FROM documents
       WHERE family_id IN (${buildNamedInClause('seedFamily', seedFamilyIds)})`,
      buildNamedParams('seedFamily', seedFamilyIds)
    );
  }

  private collectExplicitLinkMatches(
    indexDb: SQLite,
    seedDocuments: SeedDocumentRow[],
    aggregates: Map<string, ArticleRelationsV2FamilyAggregate>,
    excludedFamilies: Set<string>
  ): void {
    const seedFamilyIds = dedupeStrings(seedDocuments.map((document) => document.familyId));
    const seedExternalKeys = dedupeStrings(seedDocuments.map((document) => document.externalKey.trim().toLowerCase()));
    if (seedFamilyIds.length === 0) {
      return;
    }

    const outgoingRows = indexDb.all<{
      familyId: string;
      localeVariantId: string;
      title: string;
      externalKey: string;
      sourceFamilyId: string;
      href: string;
      linkText: string | null;
    }>(
      `SELECT target.family_id as familyId,
              target.locale_variant_id as localeVariantId,
              target.title,
              target.external_key as externalKey,
              source.family_id as sourceFamilyId,
              links.href as href,
              links.text as linkText
       FROM document_links links
       JOIN documents source ON source.locale_variant_id = links.locale_variant_id
       JOIN documents target
         ON target.family_id = COALESCE(
              links.target_family_id,
              (SELECT matched.family_id
               FROM documents matched
               WHERE matched.normalized_external_key = lower(COALESCE(links.target_external_key, ''))
               LIMIT 1)
            )
       WHERE source.family_id IN (${buildNamedInClause('outSeedFamily', seedFamilyIds)})`,
      buildNamedParams('outSeedFamily', seedFamilyIds)
    );

    for (const row of outgoingRows) {
      this.recordEvidence(aggregates, row, {
        evidenceType: 'explicit_link',
        sourceRef: row.sourceFamilyId,
        snippet: row.linkText?.trim() || row.href,
        weight: 1.35,
        signalStrength: 'strong',
        metadata: {
          direction: 'outgoing',
          href: row.href,
          sourceFamilyId: row.sourceFamilyId
        }
      }, excludedFamilies);
    }

    const incomingRows = indexDb.all<{
      familyId: string;
      localeVariantId: string;
      title: string;
      externalKey: string;
      targetFamilyId: string | null;
      href: string;
      linkText: string | null;
    }>(
      `SELECT source.family_id as familyId,
              source.locale_variant_id as localeVariantId,
              source.title,
              source.external_key as externalKey,
              links.target_family_id as targetFamilyId,
              links.href as href,
              links.text as linkText
       FROM document_links links
       JOIN documents source ON source.locale_variant_id = links.locale_variant_id
       WHERE (
         links.target_family_id IN (${buildNamedInClause('inSeedFamily', seedFamilyIds)})
         ${seedExternalKeys.length > 0 ? `OR lower(COALESCE(links.target_external_key, '')) IN (${buildNamedInClause('inSeedKey', seedExternalKeys)})` : ''}
       )`,
      {
        ...buildNamedParams('inSeedFamily', seedFamilyIds),
        ...buildNamedParams('inSeedKey', seedExternalKeys)
      }
    );

    for (const row of incomingRows) {
      this.recordEvidence(aggregates, row, {
        evidenceType: 'explicit_link',
        sourceRef: row.targetFamilyId ?? row.href,
        snippet: row.linkText?.trim() || row.href,
        weight: 1.28,
        signalStrength: 'strong',
        metadata: {
          direction: 'incoming',
          href: row.href,
          targetFamilyId: row.targetFamilyId ?? undefined
        }
      }, excludedFamilies);
    }
  }

  private collectManualRelationMatches(
    workspaceDb: SQLite,
    indexDb: SQLite,
    workspaceId: string,
    seedFamilyIds: string[],
    aggregates: Map<string, ArticleRelationsV2FamilyAggregate>,
    excludedFamilies: Set<string>
  ): void {
    if (seedFamilyIds.length === 0) {
      return;
    }

    const rows = workspaceDb.all<{
      relationId: string;
      sourceFamilyId: string;
      candidateFamilyId: string;
      relationType: string;
    }>(
      `SELECT r.id as relationId,
              CASE
                WHEN r.left_family_id IN (${buildNamedInClause('manualSeedLeft', seedFamilyIds)}) THEN r.left_family_id
                ELSE r.right_family_id
              END as sourceFamilyId,
              CASE
                WHEN r.left_family_id IN (${buildNamedInClause('manualSeedRight', seedFamilyIds)}) THEN r.right_family_id
                ELSE r.left_family_id
              END as candidateFamilyId,
              r.relation_type as relationType
       FROM article_relations r
       WHERE r.workspace_id = @workspaceId
         AND r.origin = 'manual'
         AND r.status = 'active'
         AND (
           r.left_family_id IN (${buildNamedInClause('manualSeedFilterLeft', seedFamilyIds)})
           OR r.right_family_id IN (${buildNamedInClause('manualSeedFilterRight', seedFamilyIds)})
         )`,
      {
        workspaceId,
        ...buildNamedParams('manualSeedLeft', seedFamilyIds),
        ...buildNamedParams('manualSeedRight', seedFamilyIds),
        ...buildNamedParams('manualSeedFilterLeft', seedFamilyIds),
        ...buildNamedParams('manualSeedFilterRight', seedFamilyIds)
      }
    );

    for (const row of rows) {
      const candidate = indexDb.get<CandidateSeedRow>(
        `SELECT family_id as familyId,
                locale_variant_id as localeVariantId,
                title,
                external_key as externalKey
         FROM documents
         WHERE family_id = @familyId
         ORDER BY locale_variant_id ASC
         LIMIT 1`,
        { familyId: row.candidateFamilyId }
      );

      if (!candidate) {
        continue;
      }

      this.recordEvidence(aggregates, candidate, {
        evidenceType: 'manual_relation',
        sourceRef: row.sourceFamilyId,
        snippet: `Manual ${row.relationType} relation`,
        weight: 1.25,
        signalStrength: 'strong',
        metadata: {
          relationId: row.relationId,
          relationType: row.relationType,
          sourceFamilyId: row.sourceFamilyId
        }
      }, excludedFamilies);
    }
  }

  private collectSectionAndCategoryMatches(
    indexDb: SQLite,
    seedDocuments: SeedDocumentRow[],
    aggregates: Map<string, ArticleRelationsV2FamilyAggregate>,
    excludedFamilies: Set<string>
  ): void {
    const sectionIds = dedupeStrings(seedDocuments.map((document) => document.sectionId ?? ''));
    if (sectionIds.length > 0) {
      const sectionRows = indexDb.all<CandidateSeedRow & { sectionId: string }>(
        `SELECT family_id as familyId,
                locale_variant_id as localeVariantId,
                title,
                external_key as externalKey,
                section_id as sectionId
         FROM documents
         WHERE section_id IN (${buildNamedInClause('section', sectionIds)})`,
        buildNamedParams('section', sectionIds)
      );

      for (const row of sectionRows) {
        this.recordEvidence(aggregates, row, {
          evidenceType: 'same_section',
          sourceRef: row.sectionId,
          snippet: 'Shares section with a seed article',
          weight: 0.24,
          signalStrength: 'medium',
          metadata: {
            sectionId: row.sectionId
          }
        }, excludedFamilies);
      }
    }

    const categoryIds = dedupeStrings(seedDocuments.map((document) => document.categoryId ?? ''));
    if (categoryIds.length > 0) {
      const categoryRows = indexDb.all<CandidateSeedRow & { categoryId: string }>(
        `SELECT family_id as familyId,
                locale_variant_id as localeVariantId,
                title,
                external_key as externalKey,
                category_id as categoryId
         FROM documents
         WHERE category_id IN (${buildNamedInClause('category', categoryIds)})`,
        buildNamedParams('category', categoryIds)
      );

      for (const row of categoryRows) {
        this.recordEvidence(aggregates, row, {
          evidenceType: 'same_category',
          sourceRef: row.categoryId,
          snippet: 'Shares category with a seed article',
          weight: 0.16,
          signalStrength: 'medium',
          metadata: {
            categoryId: row.categoryId
          }
        }, excludedFamilies);
      }
    }
  }

  private collectSeedExpansionMatches(
    indexDb: SQLite,
    workspaceId: string,
    seedDocuments: SeedDocumentRow[],
    aggregates: Map<string, ArticleRelationsV2FamilyAggregate>,
    excludedFamilies: Set<string>
  ): void {
    const seedQueries = buildSeedQueries(seedDocuments);
    for (const seedQuery of seedQueries) {
      this.collectDocumentMatches(
        indexDb,
        workspaceId,
        seedQuery.queryText,
        aggregates,
        excludedFamilies,
        seedQuery.scale,
        seedQuery.sourceFamilyId
      );
      this.collectChunkMatches(
        indexDb,
        workspaceId,
        seedQuery.queryText,
        aggregates,
        excludedFamilies,
        seedQuery.scale * 0.92,
        seedQuery.sourceFamilyId
      );
    }
  }

  private recordEvidence(
    aggregates: Map<string, ArticleRelationsV2FamilyAggregate>,
    candidate: CandidateSeedRow,
    evidence: ArticleRelationsV2EvidenceRecord,
    excludedFamilies: Set<string>
  ): void {
    if (!candidate.familyId || excludedFamilies.has(candidate.familyId)) {
      return;
    }

    const aggregate = aggregates.get(candidate.familyId) ?? {
      familyId: candidate.familyId,
      localeVariantIds: new Set<string>(),
      title: candidate.title,
      externalKey: candidate.externalKey,
      finalScore: 0,
      evidence: []
    };
    aggregate.localeVariantIds.add(candidate.localeVariantId);
    if (!aggregate.title && candidate.title) {
      aggregate.title = candidate.title;
    }
    if (!aggregate.externalKey && candidate.externalKey) {
      aggregate.externalKey = candidate.externalKey;
    }

    addFamilyEvidence(aggregate, evidence);
    aggregates.set(candidate.familyId, aggregate);
  }
}

function buildLookupTerms(queryText: string): string[] {
  const normalized = normalizeCoverageText(queryText);
  const tokens = queryText
    .toLowerCase()
    .split(/[\s,;|]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  return dedupeStrings([
    normalized,
    ...tokens,
    ...tokenizeCoverageText(queryText)
  ]).slice(0, 16);
}

function buildSeedQueries(seedDocuments: SeedDocumentRow[]): Array<{ sourceFamilyId: string; queryText: string; scale: number }> {
  const queries: Array<{ sourceFamilyId: string; queryText: string; scale: number }> = [];
  const seen = new Set<string>();

  for (const seed of seedDocuments) {
    const titleKey = `${seed.familyId}::title::${normalizeCoverageText(seed.title)}`;
    if (!seen.has(titleKey) && seed.title.trim()) {
      queries.push({
        sourceFamilyId: seed.familyId,
        queryText: seed.title.trim(),
        scale: 0.72
      });
      seen.add(titleKey);
    }

    const headingCandidates = seed.headingsText
      .split('\n')
      .map((heading) => heading.trim())
      .filter(Boolean)
      .filter((heading) => normalizeCoverageText(heading) !== normalizeCoverageText(seed.title))
      .slice(0, 2);

    for (const heading of headingCandidates) {
      const key = `${seed.familyId}::heading::${normalizeCoverageText(heading)}`;
      if (seen.has(key)) {
        continue;
      }
      queries.push({
        sourceFamilyId: seed.familyId,
        queryText: heading,
        scale: 0.58
      });
      seen.add(key);
    }
  }

  return queries.slice(0, 12);
}

function firstNonEmptyLine(value: string | null | undefined): string | undefined {
  return value?.split('\n').map((line) => line.trim()).find(Boolean);
}

function buildNamedInClause(prefix: string, values: string[]): string {
  return values.map((_, index) => `@${prefix}${index}`).join(', ');
}

function buildNamedParams(prefix: string, values: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  values.forEach((value, index) => {
    params[`${prefix}${index}`] = value;
  });
  return params;
}

function dedupeStrings(values: string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized) {
      unique.add(normalized);
    }
  }
  return Array.from(unique);
}

function clampMaxResults(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS;
  }
  return Math.max(1, Math.min(100, Math.floor(value as number)));
}
