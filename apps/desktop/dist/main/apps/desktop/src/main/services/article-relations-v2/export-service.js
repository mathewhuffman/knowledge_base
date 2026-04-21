"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArticleRelationsV2ExportService = exports.ArticleRelationsV2ExportDocumentError = void 0;
const node_crypto_1 = require("node:crypto");
const node_path_1 = __importDefault(require("node:path"));
const shared_types_1 = require("@kb-vault/shared-types");
const types_1 = require("./types");
const PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX = 'proposal-';
const SOFT_MIN_CHUNK_TOKENS = 220;
const TARGET_CHUNK_TOKENS = 280;
const HARD_MAX_CHUNK_TOKENS = 450;
const OVERLAP_CHUNK_TOKENS = 40;
const HEADING_PATTERN = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
const LINK_PATTERN = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const INTERNAL_ARTICLE_PATH_PATTERN = /\/articles\/(\d+)(?:[-/?#]|$)/i;
const INTERNAL_ARTICLE_QUERY_PATTERN = /(?:^|[?&])(article_id|source_id|article)=([0-9]+)(?:&|$)/i;
const HTML_ENTITY_PATTERN = /&(#x?[0-9a-f]+|[a-z]+);/gi;
const TOKEN_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}][\p{L}\p{N}\p{M}'’._-]*/gu;
class ArticleRelationsV2ExportDocumentError extends Error {
    code;
    row;
    filePath;
    constructor(code, row, filePath, cause) {
        const prefix = code === 'missing_live_revision_file'
            ? 'Missing live revision file'
            : 'Failed to read live revision file';
        super(`${prefix} for locale variant ${row.localeVariantId} (revision ${row.revisionId}) at ${filePath}`, cause ? { cause } : undefined);
        this.code = code;
        this.row = row;
        this.filePath = filePath;
        this.name = 'ArticleRelationsV2ExportDocumentError';
    }
}
exports.ArticleRelationsV2ExportDocumentError = ArticleRelationsV2ExportDocumentError;
class ArticleRelationsV2ExportService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async exportDocuments(input) {
        const enabledLocaleKeys = normalizeLocaleKeys(input.enabledLocales);
        const requestedLocaleKeys = normalizeLocaleKeys(input.locales);
        const selectedLocaleKeys = requestedLocaleKeys.length > 0
            ? requestedLocaleKeys.filter((locale) => enabledLocaleKeys.includes(locale))
            : enabledLocaleKeys;
        if (selectedLocaleKeys.length === 0) {
            return {
                workspaceId: input.workspaceId,
                engineVersion: types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION,
                exportedAtUtc: new Date().toISOString(),
                documentCount: 0,
                documents: []
            };
        }
        const sourceRows = this.loadSourceRows(input, selectedLocaleKeys);
        const labeledRows = this.decorateScopeNames(input.workspaceDb, sourceRows);
        const linkTargets = this.loadLinkTargets(input);
        const documents = [];
        for (const row of labeledRows) {
            const absolutePath = resolveRevisionPath(input.workspacePath, row.filePath);
            const html = await this.readCanonicalHtml(row, absolutePath);
            const parsed = this.parseDocument(row, html, linkTargets);
            documents.push({
                workspaceId: row.workspaceId,
                familyId: row.familyId,
                localeVariantId: row.localeVariantId,
                locale: row.locale,
                revisionId: row.revisionId,
                contentHash: parsed.contentHash,
                title: parsed.title,
                externalKey: row.externalKey,
                categoryId: row.categoryId,
                categoryName: row.categoryName,
                categorySource: row.categorySource,
                sectionId: row.sectionId,
                sectionName: row.sectionName,
                sectionSource: row.sectionSource,
                taxonomyConfidence: row.taxonomyConfidence,
                headings: parsed.headings,
                aliases: parsed.aliases,
                explicitLinks: parsed.explicitLinks,
                bodyText: parsed.bodyText,
                chunks: parsed.chunks
            });
        }
        return {
            workspaceId: input.workspaceId,
            engineVersion: types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION,
            exportedAtUtc: new Date().toISOString(),
            documentCount: documents.length,
            documents
        };
    }
    loadSourceRows(input, selectedLocaleKeys) {
        const params = {
            workspaceId: input.workspaceId,
            proposalScopedPattern: `${PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX}%`,
            liveRevisionType: shared_types_1.RevisionState.LIVE
        };
        const whereClauses = [
            'af.workspace_id = @workspaceId',
            'af.retired_at IS NULL',
            `lower(af.external_key) NOT LIKE @proposalScopedPattern`,
            `(lv.retired_at IS NULL OR lv.retired_at = '')`,
            `lower(lv.locale) IN (${buildInClause('locale', selectedLocaleKeys, params)})`
        ];
        const familyIds = normalizeIdList(input.familyIds);
        if (familyIds.length > 0) {
            whereClauses.push(`af.id IN (${buildInClause('family', familyIds, params)})`);
        }
        const localeVariantIds = normalizeIdList(input.localeVariantIds);
        if (localeVariantIds.length > 0) {
            whereClauses.push(`lv.id IN (${buildInClause('variant', localeVariantIds, params)})`);
        }
        return input.workspaceDb.all(`SELECT
         af.workspace_id as workspaceId,
         af.id as familyId,
         lv.id as localeVariantId,
         lv.locale as locale,
         r.id as revisionId,
         r.content_hash as contentHash,
         r.file_path as filePath,
         af.title as fallbackTitle,
         af.external_key as externalKey,
         af.category_id as categoryId,
         af.category_source as categorySource,
         NULL as categoryName,
         af.section_id as sectionId,
         af.section_source as sectionSource,
         NULL as sectionName,
         af.taxonomy_confidence as taxonomyConfidence
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
       WHERE ${whereClauses.join('\n         AND ')}
       ORDER BY af.title COLLATE NOCASE, af.id ASC, lv.locale COLLATE NOCASE, lv.id ASC, r.revision_number DESC, r.id DESC`, params).map((row) => ({
            ...row,
            contentHash: normalizeOptionalString(row.contentHash),
            categoryId: normalizeOptionalString(row.categoryId),
            categorySource: normalizeOptionalString(row.categorySource),
            categoryName: normalizeOptionalString(row.categoryName),
            sectionId: normalizeOptionalString(row.sectionId),
            sectionSource: normalizeOptionalString(row.sectionSource),
            sectionName: normalizeOptionalString(row.sectionName),
            taxonomyConfidence: normalizeOptionalNumber(row.taxonomyConfidence)
        }));
    }
    decorateScopeNames(workspaceDb, rows) {
        const categoryNamesById = this.loadScopeNames(workspaceDb, 'category', rows.map((row) => row.categoryId).filter((value) => Boolean(value)));
        const sectionNamesById = this.loadScopeNames(workspaceDb, 'section', rows.map((row) => row.sectionId).filter((value) => Boolean(value)));
        return rows.map((row) => ({
            ...row,
            categoryName: resolveScopeName('category', row.categoryId, categoryNamesById),
            sectionName: resolveScopeName('section', row.sectionId, sectionNamesById)
        }));
    }
    loadScopeNames(workspaceDb, scopeType, scopeIds) {
        const normalizedScopeIds = normalizeIdList(scopeIds);
        if (normalizedScopeIds.length === 0) {
            return new Map();
        }
        const params = buildNamedParams(`${scopeType}Scope`, normalizedScopeIds);
        const placeholders = buildInClause(`${scopeType}Scope`, normalizedScopeIds, params);
        const namesById = new Map();
        const catalogRows = workspaceDb.all(`SELECT scope_id as scopeId, display_name as displayName
         FROM kb_scope_catalog
        WHERE scope_type = @scopeType
          AND scope_id IN (${placeholders})`, {
            ...params,
            scopeType
        });
        for (const row of catalogRows) {
            const scopeId = normalizeOptionalString(row.scopeId);
            const displayName = normalizeOptionalString(row.displayName);
            if (scopeId && displayName) {
                namesById.set(scopeId, displayName);
            }
        }
        const overrideRows = workspaceDb.all(`SELECT scope_id as scopeId, display_name as displayName
         FROM kb_scope_overrides
        WHERE scope_type = @scopeType
          AND scope_id IN (${placeholders})`, {
            ...params,
            scopeType
        });
        for (const row of overrideRows) {
            const scopeId = normalizeOptionalString(row.scopeId);
            const displayName = normalizeOptionalString(row.displayName);
            if (scopeId && displayName) {
                namesById.set(scopeId, displayName);
            }
        }
        return namesById;
    }
    loadLinkTargets(input) {
        const rows = input.workspaceDb.all(`SELECT id as familyId, external_key as externalKey
       FROM article_families
       WHERE workspace_id = @workspaceId
         AND lower(external_key) NOT LIKE @proposalScopedPattern`, {
            workspaceId: input.workspaceId,
            proposalScopedPattern: `${PROPOSAL_SCOPED_EXTERNAL_KEY_PREFIX}%`
        });
        const targets = new Map();
        for (const row of rows) {
            const normalizedExternalKey = row.externalKey.trim().toLowerCase();
            if (normalizedExternalKey) {
                targets.set(normalizedExternalKey, {
                    familyId: row.familyId,
                    externalKey: row.externalKey
                });
            }
            const numericArticleId = extractZendeskArticleId(row.externalKey);
            if (numericArticleId) {
                targets.set(`hc:${numericArticleId}`, {
                    familyId: row.familyId,
                    externalKey: row.externalKey
                });
            }
        }
        return targets;
    }
    async readCanonicalHtml(row, filePath) {
        if (!(await this.deps.fileExists(filePath))) {
            throw new ArticleRelationsV2ExportDocumentError('missing_live_revision_file', row, filePath);
        }
        try {
            return await this.deps.readTextFile(filePath);
        }
        catch (error) {
            throw new ArticleRelationsV2ExportDocumentError('read_live_revision_failed', row, filePath, error);
        }
    }
    parseDocument(row, html, linkTargets) {
        const cleanedHtml = stripIgnoredHtml(html);
        const headings = extractHeadings(cleanedHtml);
        const title = headings.find((heading) => heading.level === 1)?.text
            ?? headings[0]?.text
            ?? row.fallbackTitle.trim()
            ?? row.externalKey;
        const explicitLinks = extractLinks(cleanedHtml, linkTargets);
        const aliases = buildAliases(title, row.fallbackTitle, row.externalKey);
        const bodyBlocks = htmlToTextBlocks(cleanedHtml);
        const bodyText = bodyBlocks.length > 0
            ? bodyBlocks.join('\n\n')
            : title;
        const chunks = buildChunks({
            familyId: row.familyId,
            locale: row.locale,
            title,
            cleanedHtml,
            headings,
            bodyText
        });
        const contentHash = (0, node_crypto_1.createHash)('sha256')
            .update(stableStringify({
            familyId: row.familyId,
            localeVariantId: row.localeVariantId,
            locale: row.locale,
            title,
            externalKey: row.externalKey,
            categoryId: row.categoryId,
            categoryName: row.categoryName,
            categorySource: row.categorySource,
            sectionId: row.sectionId,
            sectionName: row.sectionName,
            sectionSource: row.sectionSource,
            taxonomyConfidence: row.taxonomyConfidence,
            headings: headings.map(({ level, text, path }) => ({ level, text, path })),
            aliases,
            explicitLinks,
            bodyText,
            chunks: chunks.map((chunk) => ({
                ordinal: chunk.ordinal,
                headingPath: chunk.headingPath,
                text: chunk.text
            }))
        }))
            .digest('hex');
        return {
            contentHash,
            title,
            headings: headings.map(({ level, text, path }) => ({ level, text, path })),
            aliases,
            explicitLinks,
            bodyText,
            chunks
        };
    }
}
exports.ArticleRelationsV2ExportService = ArticleRelationsV2ExportService;
function extractHeadings(html) {
    const headings = [];
    HEADING_PATTERN.lastIndex = 0;
    let match = HEADING_PATTERN.exec(html);
    while (match) {
        const text = htmlFragmentToInlineText(match[2]);
        if (text) {
            headings.push({
                level: Number.parseInt(match[1], 10),
                text,
                start: match.index,
                end: HEADING_PATTERN.lastIndex
            });
        }
        match = HEADING_PATTERN.exec(html);
    }
    const stack = [];
    return headings.map((heading) => {
        while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
            stack.pop();
        }
        stack.push({ level: heading.level, text: heading.text });
        return {
            ...heading,
            path: stack.map((entry) => entry.text).join(' > ')
        };
    });
}
function extractLinks(html, linkTargets) {
    const links = [];
    LINK_PATTERN.lastIndex = 0;
    let match = LINK_PATTERN.exec(html);
    while (match) {
        const attributes = parseTagAttributes(match[1]);
        const href = normalizeOptionalString(attributes.href);
        if (!href) {
            match = LINK_PATTERN.exec(html);
            continue;
        }
        const text = normalizeOptionalString(htmlFragmentToInlineText(match[2]));
        const targetExternalKey = normalizeLinkTargetExternalKey(href, linkTargets);
        const target = targetExternalKey ? linkTargets.get(targetExternalKey.toLowerCase()) : undefined;
        links.push({
            href,
            text,
            targetFamilyId: target?.familyId,
            targetExternalKey: target?.externalKey ?? targetExternalKey
        });
        match = LINK_PATTERN.exec(html);
    }
    return (0, types_1.dedupeArticleRelationsV2ExplicitLinks)(links);
}
function normalizeLinkTargetExternalKey(href, linkTargets) {
    const normalizedHref = href.trim();
    if (!normalizedHref || normalizedHref.startsWith('#')) {
        return undefined;
    }
    const lowerHref = normalizedHref.toLowerCase();
    const directTarget = linkTargets.get(lowerHref);
    if (directTarget) {
        return directTarget.externalKey;
    }
    const numericFromExternalKey = extractZendeskArticleId(normalizedHref);
    if (numericFromExternalKey) {
        const mapped = linkTargets.get(`hc:${numericFromExternalKey}`);
        return mapped?.externalKey ?? `hc:${numericFromExternalKey}`;
    }
    const resolvedFromPath = resolveZendeskArticleIdFromHref(normalizedHref);
    if (!resolvedFromPath) {
        return undefined;
    }
    const mapped = linkTargets.get(`hc:${resolvedFromPath}`);
    return mapped?.externalKey ?? `hc:${resolvedFromPath}`;
}
function resolveZendeskArticleIdFromHref(href) {
    try {
        const url = new URL(href, 'https://kb-vault.local');
        const pathMatch = url.pathname.match(INTERNAL_ARTICLE_PATH_PATTERN);
        if (pathMatch?.[1]) {
            return pathMatch[1];
        }
        const query = url.search.match(INTERNAL_ARTICLE_QUERY_PATTERN);
        if (query?.[2]) {
            return query[2];
        }
    }
    catch {
        const pathMatch = href.match(INTERNAL_ARTICLE_PATH_PATTERN);
        if (pathMatch?.[1]) {
            return pathMatch[1];
        }
        const query = href.match(INTERNAL_ARTICLE_QUERY_PATTERN);
        if (query?.[2]) {
            return query[2];
        }
    }
    return undefined;
}
function extractZendeskArticleId(value) {
    const normalized = value.trim();
    if (/^\d+$/.test(normalized)) {
        return normalized;
    }
    const match = normalized.match(/^hc:(\d+)$/i);
    return match?.[1];
}
function buildAliases(title, fallbackTitle, externalKey) {
    const aliases = [];
    const seen = new Set();
    const push = (value) => {
        const normalized = normalizeOptionalString(value);
        if (!normalized) {
            return;
        }
        const dedupeKey = normalized.toLowerCase();
        if (seen.has(dedupeKey)) {
            return;
        }
        seen.add(dedupeKey);
        aliases.push(normalized);
    };
    push(title);
    push(fallbackTitle);
    push(normalizeAliasText(title));
    push(normalizeAliasText(title.replace(/&/g, ' and ')));
    push(normalizeAliasText(fallbackTitle));
    push(externalKey);
    const externalKeySuffix = externalKey.includes(':') ? externalKey.split(':').slice(1).join(':') : externalKey;
    push(externalKeySuffix);
    return aliases;
}
function buildChunks(input) {
    const sections = buildSections(input.cleanedHtml, input.headings, input.title);
    const chunks = [];
    let ordinal = 0;
    for (const section of sections) {
        const chunkTexts = chunkBlocks(section.blocks);
        for (const chunkText of chunkTexts) {
            chunks.push({
                chunkId: (0, node_crypto_1.createHash)('sha256')
                    .update(`${input.familyId}|${input.locale}|${section.headingPath ?? 'root'}|${ordinal}`)
                    .digest('hex'),
                ordinal,
                headingPath: section.headingPath,
                text: chunkText
            });
            ordinal += 1;
        }
    }
    if (chunks.length === 0 && input.bodyText.trim()) {
        chunks.push({
            chunkId: (0, node_crypto_1.createHash)('sha256')
                .update(`${input.familyId}|${input.locale}|root|0`)
                .digest('hex'),
            ordinal: 0,
            text: input.bodyText.trim()
        });
    }
    return chunks;
}
function buildSections(html, headings, title) {
    if (headings.length === 0) {
        const bodyBlocks = htmlToTextBlocks(html);
        return bodyBlocks.length > 0
            ? [{ blocks: bodyBlocks }]
            : [{ blocks: [title] }];
    }
    const sections = [];
    const introBlocks = htmlToTextBlocks(html.slice(0, headings[0].start));
    if (introBlocks.length > 0) {
        sections.push({ blocks: introBlocks });
    }
    for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index];
        const nextHeading = headings[index + 1];
        const sectionHtml = html.slice(heading.end, nextHeading?.start ?? html.length);
        const sectionBlocks = htmlToTextBlocks(sectionHtml);
        const blocks = shouldPrefixHeading(sectionBlocks, heading.text)
            ? [heading.text, ...sectionBlocks]
            : sectionBlocks.length > 0
                ? sectionBlocks
                : [heading.text];
        sections.push({
            headingPath: heading.path,
            blocks
        });
    }
    return sections;
}
function shouldPrefixHeading(blocks, headingText) {
    if (blocks.length === 0) {
        return true;
    }
    return normalizeAliasText(blocks[0]) !== normalizeAliasText(headingText);
}
function chunkBlocks(blocks) {
    const pieces = blocks.flatMap((block) => splitOversizedBlock(block));
    const chunks = [];
    let currentPieces = [];
    let currentTokens = 0;
    const flushCurrent = () => {
        if (currentPieces.length === 0) {
            return;
        }
        const chunkText = currentPieces.join('\n\n').trim();
        if (chunkText) {
            chunks.push(chunkText);
        }
    };
    for (const piece of pieces) {
        const pieceTokens = estimateTokenCount(piece);
        if (currentPieces.length === 0) {
            currentPieces = [piece];
            currentTokens = pieceTokens;
            continue;
        }
        const nextTokenCount = currentTokens + pieceTokens;
        const exceedsHardMax = nextTokenCount > HARD_MAX_CHUNK_TOKENS;
        const exceedsTarget = currentTokens >= SOFT_MIN_CHUNK_TOKENS && nextTokenCount > TARGET_CHUNK_TOKENS;
        if (!exceedsHardMax && !exceedsTarget) {
            currentPieces.push(piece);
            currentTokens = nextTokenCount;
            continue;
        }
        flushCurrent();
        const overlapPieces = takeOverlapPieces(currentPieces, OVERLAP_CHUNK_TOKENS);
        const overlapTokens = overlapPieces.reduce((total, entry) => total + estimateTokenCount(entry), 0);
        currentPieces = overlapPieces.slice();
        currentTokens = overlapTokens;
        if (pieceTokens > HARD_MAX_CHUNK_TOKENS) {
            currentPieces = splitOversizedBlock(piece);
            currentTokens = currentPieces.reduce((total, entry) => total + estimateTokenCount(entry), 0);
            flushCurrent();
            currentPieces = [];
            currentTokens = 0;
            continue;
        }
        if (currentTokens + pieceTokens > HARD_MAX_CHUNK_TOKENS) {
            currentPieces = [piece];
            currentTokens = pieceTokens;
            continue;
        }
        currentPieces.push(piece);
        currentTokens += pieceTokens;
    }
    flushCurrent();
    return chunks;
}
function splitOversizedBlock(block) {
    const normalizedBlock = normalizeOptionalString(block);
    if (!normalizedBlock) {
        return [];
    }
    if (estimateTokenCount(normalizedBlock) <= HARD_MAX_CHUNK_TOKENS) {
        return [normalizedBlock];
    }
    const sentenceParts = normalizedBlock
        .split(/(?<=[.!?。！？])\s+/u)
        .map((part) => part.trim())
        .filter(Boolean);
    if (sentenceParts.length > 1) {
        return sentenceParts.flatMap((part) => splitOversizedBlock(part));
    }
    return splitTextByTokenWindow(normalizedBlock, HARD_MAX_CHUNK_TOKENS);
}
function splitTextByTokenWindow(text, maxTokens) {
    const spans = getTokenSpans(text);
    if (spans.length === 0 || spans.length <= maxTokens) {
        return [text.trim()].filter(Boolean);
    }
    const parts = [];
    for (let index = 0; index < spans.length; index += maxTokens) {
        const start = spans[index].start;
        const end = spans[Math.min(index + maxTokens - 1, spans.length - 1)].end;
        const segment = text.slice(start, end).trim();
        if (segment) {
            parts.push(segment);
        }
    }
    return parts;
}
function takeOverlapPieces(pieces, overlapTokens) {
    if (pieces.length <= 1) {
        return [];
    }
    const overlap = [];
    let tokenCount = 0;
    for (let index = pieces.length - 1; index >= 0; index -= 1) {
        const piece = pieces[index];
        const pieceTokens = estimateTokenCount(piece);
        if (overlap.length > 0 && tokenCount + pieceTokens > overlapTokens) {
            break;
        }
        overlap.unshift(piece);
        tokenCount += pieceTokens;
        if (tokenCount >= overlapTokens) {
            break;
        }
    }
    return overlap;
}
function htmlToTextBlocks(html) {
    const withBreaks = stripIgnoredHtml(html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<(?:li)\b[^>]*>/gi, '\n- ')
        .replace(/<\/(?:address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|form|header|h[1-6]|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)>/gi, '\n\n')
        .replace(/<(?:address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|form|header|main|nav|ol|p|pre|section|table|tbody|tfoot|thead|tr|ul)\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');
    return decodeHtmlEntities(withBreaks)
        .split(/\n{2,}/)
        .map((block) => normalizeOptionalString(block.replace(/[ \t]*\n[ \t]*/g, ' ')))
        .filter((block) => Boolean(block));
}
function htmlFragmentToInlineText(html) {
    return normalizeOptionalString(decodeHtmlEntities(stripIgnoredHtml(html)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, ' '))) ?? '';
}
function stripIgnoredHtml(html) {
    return html
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
}
function parseTagAttributes(rawAttributes) {
    const attributes = {};
    const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let match = attributePattern.exec(rawAttributes);
    while (match) {
        const key = match[1]?.toLowerCase();
        if (key) {
            attributes[key] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '');
        }
        match = attributePattern.exec(rawAttributes);
    }
    return attributes;
}
function decodeHtmlEntities(value) {
    return value.replace(HTML_ENTITY_PATTERN, (raw, entity) => {
        const lowerEntity = entity.toLowerCase();
        if (lowerEntity === 'amp')
            return '&';
        if (lowerEntity === 'lt')
            return '<';
        if (lowerEntity === 'gt')
            return '>';
        if (lowerEntity === 'quot')
            return '"';
        if (lowerEntity === 'apos')
            return "'";
        if (lowerEntity === 'nbsp')
            return ' ';
        if (lowerEntity === 'ndash')
            return '-';
        if (lowerEntity === 'mdash')
            return '-';
        if (lowerEntity === 'hellip')
            return '...';
        if (lowerEntity === 'lsquo' || lowerEntity === 'rsquo')
            return "'";
        if (lowerEntity === 'ldquo' || lowerEntity === 'rdquo')
            return '"';
        if (lowerEntity.startsWith('#x')) {
            const codePoint = Number.parseInt(lowerEntity.slice(2), 16);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : raw;
        }
        if (lowerEntity.startsWith('#')) {
            const codePoint = Number.parseInt(lowerEntity.slice(1), 10);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : raw;
        }
        return raw;
    });
}
function estimateTokenCount(text) {
    return getTokenSpans(text).length;
}
function getTokenSpans(text) {
    const spans = [];
    TOKEN_PATTERN.lastIndex = 0;
    let match = TOKEN_PATTERN.exec(text);
    while (match) {
        spans.push({
            start: match.index,
            end: match.index + match[0].length
        });
        match = TOKEN_PATTERN.exec(text);
    }
    return spans;
}
function normalizeAliasText(value) {
    return value
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}
function normalizeOptionalString(value) {
    const normalized = value?.replace(/\s+/g, ' ').trim();
    return normalized ? normalized : undefined;
}
function normalizeOptionalNumber(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    return Number(value.toFixed(3));
}
function resolveScopeName(scopeType, scopeId, namesById) {
    if (!scopeId) {
        return scopeType === 'category' ? 'Uncategorized' : 'Unsectioned';
    }
    return namesById.get(scopeId) ?? `${scopeId} (fallback)`;
}
function normalizeLocaleKeys(locales) {
    return Array.from(new Set((locales ?? [])
        .map((locale) => locale.trim().toLowerCase())
        .filter(Boolean)));
}
function normalizeIdList(values) {
    return Array.from(new Set((values ?? [])
        .map((value) => value.trim())
        .filter(Boolean)));
}
function buildInClause(prefix, values, params) {
    return values.map((value, index) => {
        const key = `${prefix}${index}`;
        params[key] = value;
        return `@${key}`;
    }).join(', ');
}
function buildNamedParams(prefix, values) {
    const params = {};
    values.forEach((value, index) => {
        params[`${prefix}${index}`] = value;
    });
    return params;
}
function resolveRevisionPath(workspacePath, filePath) {
    return node_path_1.default.isAbsolute(filePath) ? filePath : node_path_1.default.join(workspacePath, filePath);
}
function stableStringify(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    }
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}
