"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARTICLE_RELATIONS_V2_INDEX_DB_RELATIVE_PATH = exports.ARTICLE_RELATIONS_V2_LEGACY_ENGINE_VERSION = exports.ARTICLE_RELATIONS_V2_ENGINE_VERSION = void 0;
exports.getArticleRelationsV2ExplicitLinkIdentity = getArticleRelationsV2ExplicitLinkIdentity;
exports.getArticleRelationsV2ExplicitLinkKey = getArticleRelationsV2ExplicitLinkKey;
exports.mergeArticleRelationsV2ExplicitLink = mergeArticleRelationsV2ExplicitLink;
exports.dedupeArticleRelationsV2ExplicitLinks = dedupeArticleRelationsV2ExplicitLinks;
exports.ARTICLE_RELATIONS_V2_ENGINE_VERSION = 'article-relations-v2';
exports.ARTICLE_RELATIONS_V2_LEGACY_ENGINE_VERSION = 'legacy-v1';
exports.ARTICLE_RELATIONS_V2_INDEX_DB_RELATIVE_PATH = 'cache/search/article-relations-v2.sqlite';
const INTERNAL_ARTICLE_PATH_PATTERN = /\/articles\/(\d+)(?:[-/?#]|$)/i;
const INTERNAL_ARTICLE_QUERY_PATTERN = /(?:^|[?&])(article_id|source_id|article)=([0-9]+)(?:&|$)/i;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
function getArticleRelationsV2ExplicitLinkIdentity(link) {
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
function getArticleRelationsV2ExplicitLinkKey(localeVariantId, link) {
    return [
        normalizeExplicitLinkKeyPart(localeVariantId),
        getArticleRelationsV2ExplicitLinkIdentity(link)
    ].join('::');
}
function mergeArticleRelationsV2ExplicitLink(current, candidate) {
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
function dedupeArticleRelationsV2ExplicitLinks(links) {
    const mergedByIdentity = new Map();
    for (const link of links) {
        const identity = getArticleRelationsV2ExplicitLinkIdentity(link);
        mergedByIdentity.set(identity, mergeArticleRelationsV2ExplicitLink(mergedByIdentity.get(identity), link));
    }
    return Array.from(mergedByIdentity.values());
}
function normalizeExplicitLinkKeyPart(value) {
    return value?.trim() ?? '';
}
function normalizeExplicitLinkExternalKey(value) {
    return value?.trim().toLowerCase() ?? '';
}
function normalizeExplicitLinkText(value) {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}
function selectCanonicalResolvedExplicitLinkHref(leftHref, rightHref) {
    const left = describeCanonicalResolvedExplicitLinkHref(leftHref);
    const right = describeCanonicalResolvedExplicitLinkHref(rightHref);
    return compareCanonicalResolvedExplicitLinkValues(left, right) <= 0 ? left.value : right.value;
}
function selectCanonicalResolvedExplicitLinkText(leftText, rightText) {
    const candidates = [leftText, rightText]
        .map((value) => normalizeExplicitLinkText(value))
        .filter((value) => Boolean(value));
    if (candidates.length === 0) {
        return undefined;
    }
    candidates.sort((left, right) => compareCanonicalResolvedExplicitLinkValues(describeCanonicalResolvedExplicitLinkText(left), describeCanonicalResolvedExplicitLinkText(right)));
    return candidates[0];
}
function describeCanonicalResolvedExplicitLinkHref(href) {
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
function describeCanonicalResolvedExplicitLinkText(text) {
    return {
        rank: 0,
        value: text,
        sortKey: text.toLowerCase()
    };
}
function compareCanonicalResolvedExplicitLinkValues(left, right) {
    return left.rank - right.rank
        || left.sortKey.localeCompare(right.sortKey)
        || left.value.localeCompare(right.value);
}
function tryParseExplicitLinkUrl(href) {
    try {
        return new URL(href, 'https://kb-vault.local');
    }
    catch {
        return undefined;
    }
}
function extractExplicitLinkZendeskArticleId(value) {
    const normalized = value.trim();
    if (/^\d+$/.test(normalized)) {
        return normalized;
    }
    const match = normalized.match(/^hc:(\d+)$/i);
    return match?.[1];
}
function hasExplicitLinkOrigin(href) {
    return URL_SCHEME_PATTERN.test(href) || href.startsWith('//');
}
