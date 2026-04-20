import type { SQLite } from '@kb-vault/db';
import type {
  ArticleRelationCorpusExportRequest,
  CoverageQueryEvidence,
  CoverageQueryRequest,
  CoverageQueryResponse,
  RelationDocument
} from '@kb-vault/shared-types';

export const ARTICLE_RELATIONS_V2_ENGINE_VERSION = 'article-relations-v2';
export const ARTICLE_RELATIONS_V2_LEGACY_ENGINE_VERSION = 'legacy-v1';
export const ARTICLE_RELATIONS_V2_INDEX_DB_RELATIVE_PATH = 'cache/search/article-relations-v2.sqlite';

export type ArticleRelationsV2ExplicitLink = RelationDocument['explicitLinks'][number];

export interface ArticleRelationsV2IndexDocumentState {
  localeVariantId: string;
  familyId: string;
  revisionId: string;
  contentHash: string;
}

export interface ArticleRelationsV2IndexStats {
  workspaceId: string;
  engineVersion: string;
  documentCount: number;
  chunkCount: number;
  aliasCount: number;
  linkCount: number;
  lastBuiltAtUtc?: string;
}

export interface ArticleRelationsV2IndexBuildResult extends ArticleRelationsV2IndexStats {
  deletedDocumentCount: number;
  upsertedDocumentCount: number;
  unchangedDocumentCount: number;
}

export interface ArticleRelationsV2RebuildRequest {
  workspaceId: string;
  forceFullRebuild?: boolean;
}

export interface ArticleRelationsV2CoverageQueryRequest extends CoverageQueryRequest {}

export interface ArticleRelationsV2CoverageQueryResponse extends CoverageQueryResponse {}

export interface ArticleRelationsV2EvidenceRecord extends CoverageQueryEvidence {
  signalStrength: 'strong' | 'medium' | 'weak';
}

export interface ArticleRelationsV2FamilyAggregate {
  familyId: string;
  localeVariantIds: Set<string>;
  title: string;
  externalKey?: string;
  finalScore: number;
  evidence: ArticleRelationsV2EvidenceRecord[];
}

export interface ArticleRelationsV2ExportServiceDeps {
  fileExists(filePath: string): Promise<boolean>;
  readTextFile(filePath: string): Promise<string>;
}

export interface ArticleRelationsV2ExportServiceInput extends ArticleRelationCorpusExportRequest {
  workspacePath: string;
  enabledLocales: string[];
  workspaceDb: SQLite;
}

export interface ArticleRelationsV2ExportSourceRow {
  workspaceId: string;
  familyId: string;
  localeVariantId: string;
  locale: string;
  revisionId: string;
  contentHash?: string;
  filePath: string;
  fallbackTitle: string;
  externalKey: string;
  categoryId?: string;
  categoryName?: string;
  categorySource?: RelationDocument['categorySource'];
  sectionId?: string;
  sectionName?: string;
  sectionSource?: RelationDocument['sectionSource'];
  taxonomyConfidence?: number;
}

export interface ArticleRelationsV2LinkTarget {
  familyId: string;
  externalKey: string;
}

export interface ArticleRelationsV2ParsedDocument extends Pick<
  RelationDocument,
  'contentHash' | 'title' | 'headings' | 'aliases' | 'explicitLinks' | 'bodyText' | 'chunks'
> {}

export interface ArticleRelationsV2IndexDocumentRow {
  workspaceId: string;
  familyId: string;
  localeVariantId: string;
  locale: string;
  revisionId: string;
  contentHash: string;
  title: string;
  externalKey: string;
  normalizedExternalKey: string;
  categoryId?: string;
  categoryName?: string;
  sectionId?: string;
  sectionName?: string;
  headingsText: string;
  aliasesText: string;
  bodyText: string;
}

export interface ArticleRelationsV2ChunkRow {
  chunkId: string;
  workspaceId: string;
  familyId: string;
  localeVariantId: string;
  ordinal: number;
  headingPath?: string;
  text: string;
}

interface CanonicalResolvedExplicitLinkValue {
  rank: number;
  value: string;
  sortKey: string;
}

const INTERNAL_ARTICLE_PATH_PATTERN = /\/articles\/(\d+)(?:[-/?#]|$)/i;
const INTERNAL_ARTICLE_QUERY_PATTERN = /(?:^|[?&])(article_id|source_id|article)=([0-9]+)(?:&|$)/i;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

export function getArticleRelationsV2ExplicitLinkIdentity(
  link: Pick<ArticleRelationsV2ExplicitLink, 'href' | 'targetFamilyId' | 'targetExternalKey'>
): string {
  const normalizedTargetFamilyId = normalizeExplicitLinkKeyPart(link.targetFamilyId);
  const normalizedTargetExternalKey = normalizeExplicitLinkExternalKey(link.targetExternalKey);

  if (normalizedTargetFamilyId || normalizedTargetExternalKey) {
    return [
      'target',
      normalizedTargetFamilyId,
      normalizedTargetExternalKey
    ].join('::');
  }

  return [
    'href',
    normalizeExplicitLinkKeyPart(link.href)
  ].join('::');
}

export function getArticleRelationsV2ExplicitLinkKey(
  localeVariantId: string,
  link: Pick<ArticleRelationsV2ExplicitLink, 'href' | 'targetFamilyId' | 'targetExternalKey'>
): string {
  return [
    normalizeExplicitLinkKeyPart(localeVariantId),
    getArticleRelationsV2ExplicitLinkIdentity(link)
  ].join('::');
}

export function mergeArticleRelationsV2ExplicitLink(
  current: ArticleRelationsV2ExplicitLink | undefined,
  candidate: ArticleRelationsV2ExplicitLink
): ArticleRelationsV2ExplicitLink {
  if (!current) {
    return candidate;
  }

  const currentText = normalizeExplicitLinkText(current.text);
  const candidateText = normalizeExplicitLinkText(candidate.text);
  const targetFamilyId = current.targetFamilyId ?? candidate.targetFamilyId;
  const targetExternalKey = current.targetExternalKey ?? candidate.targetExternalKey;
  const resolvedTarget = Boolean(targetFamilyId || targetExternalKey);

  return {
    href: resolvedTarget
      ? selectCanonicalResolvedExplicitLinkHref(current.href, candidate.href)
      : current.href,
    text: resolvedTarget
      ? selectCanonicalResolvedExplicitLinkText(currentText, candidateText)
      : currentText || candidateText || undefined,
    targetFamilyId,
    targetExternalKey
  };
}

export function dedupeArticleRelationsV2ExplicitLinks(
  links: Iterable<ArticleRelationsV2ExplicitLink>
): ArticleRelationsV2ExplicitLink[] {
  const mergedByIdentity = new Map<string, ArticleRelationsV2ExplicitLink>();
  for (const link of links) {
    const identity = getArticleRelationsV2ExplicitLinkIdentity(link);
    mergedByIdentity.set(identity, mergeArticleRelationsV2ExplicitLink(mergedByIdentity.get(identity), link));
  }

  return Array.from(mergedByIdentity.values());
}

function normalizeExplicitLinkKeyPart(value: string | undefined): string {
  return value?.trim() ?? '';
}

function normalizeExplicitLinkExternalKey(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function normalizeExplicitLinkText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function selectCanonicalResolvedExplicitLinkHref(leftHref: string, rightHref: string): string {
  const left = describeCanonicalResolvedExplicitLinkHref(leftHref);
  const right = describeCanonicalResolvedExplicitLinkHref(rightHref);
  return compareCanonicalResolvedExplicitLinkValues(left, right) <= 0 ? left.value : right.value;
}

function selectCanonicalResolvedExplicitLinkText(
  leftText: string | undefined,
  rightText: string | undefined
): string | undefined {
  const candidates = [leftText, rightText]
    .map((value) => normalizeExplicitLinkText(value))
    .filter((value): value is string => Boolean(value));

  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort((left, right) => compareCanonicalResolvedExplicitLinkValues(
    describeCanonicalResolvedExplicitLinkText(left),
    describeCanonicalResolvedExplicitLinkText(right)
  ));

  return candidates[0];
}

function describeCanonicalResolvedExplicitLinkHref(href: string): CanonicalResolvedExplicitLinkValue {
  const normalizedHref = normalizeExplicitLinkKeyPart(href);
  if (!normalizedHref) {
    return {
      rank: 5,
      value: '',
      sortKey: ''
    };
  }

  const directArticleId = extractExplicitLinkZendeskArticleId(normalizedHref);
  if (directArticleId) {
    const canonicalId = `hc:${directArticleId}`;
    return {
      rank: 2,
      value: canonicalId,
      sortKey: canonicalId
    };
  }

  const parsedUrl = tryParseExplicitLinkUrl(normalizedHref);
  const pathMatch = parsedUrl?.pathname.match(INTERNAL_ARTICLE_PATH_PATTERN);
  if (pathMatch?.[1]) {
    const canonicalPath = parsedUrl?.pathname || normalizedHref;
    return {
      rank: hasExplicitLinkOrigin(normalizedHref) ? 1 : 0,
      value: canonicalPath,
      sortKey: canonicalPath.toLowerCase()
    };
  }

  const queryMatch = parsedUrl?.search.match(INTERNAL_ARTICLE_QUERY_PATTERN) ?? normalizedHref.match(INTERNAL_ARTICLE_QUERY_PATTERN);
  if (queryMatch?.[2]) {
    const canonicalId = `hc:${queryMatch[2]}`;
    return {
      rank: hasExplicitLinkOrigin(normalizedHref) ? 3 : 2,
      value: canonicalId,
      sortKey: canonicalId
    };
  }

  return {
    rank: 4,
    value: normalizedHref,
    sortKey: normalizedHref.toLowerCase()
  };
}

function describeCanonicalResolvedExplicitLinkText(text: string): CanonicalResolvedExplicitLinkValue {
  return {
    rank: 0,
    value: text,
    sortKey: text.toLowerCase()
  };
}

function compareCanonicalResolvedExplicitLinkValues(
  left: CanonicalResolvedExplicitLinkValue,
  right: CanonicalResolvedExplicitLinkValue
): number {
  return left.rank - right.rank
    || left.sortKey.localeCompare(right.sortKey)
    || left.value.localeCompare(right.value);
}

function tryParseExplicitLinkUrl(href: string): URL | undefined {
  try {
    return new URL(href, 'https://kb-vault.local');
  } catch {
    return undefined;
  }
}

function extractExplicitLinkZendeskArticleId(value: string): string | undefined {
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    return normalized;
  }
  const match = normalized.match(/^hc:(\d+)$/i);
  return match?.[1];
}

function hasExplicitLinkOrigin(href: string): boolean {
  return URL_SCHEME_PATTERN.test(href) || href.startsWith('//');
}
