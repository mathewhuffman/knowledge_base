"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArticleRelationsV2IndexDb = void 0;
const db_1 = require("@kb-vault/db");
const types_1 = require("./types");
const INDEX_SCHEMA = `
  CREATE TABLE IF NOT EXISTS documents (
    locale_variant_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    family_id TEXT NOT NULL,
    locale TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    title TEXT NOT NULL,
    external_key TEXT NOT NULL,
    normalized_external_key TEXT NOT NULL,
    category_id TEXT,
    category_name TEXT,
    section_id TEXT,
    section_name TEXT,
    headings_text TEXT NOT NULL,
    aliases_text TEXT NOT NULL,
    body_text TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_article_relations_v2_documents_family
    ON documents(family_id, locale_variant_id);
  CREATE INDEX IF NOT EXISTS idx_article_relations_v2_documents_external_key
    ON documents(normalized_external_key, family_id);
  CREATE INDEX IF NOT EXISTS idx_article_relations_v2_documents_section
    ON documents(section_id, family_id);
  CREATE INDEX IF NOT EXISTS idx_article_relations_v2_documents_category
    ON documents(category_id, family_id);

  CREATE TABLE IF NOT EXISTS document_chunks (
    chunk_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    family_id TEXT NOT NULL,
    locale_variant_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    heading_path TEXT,
    text TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_article_relations_v2_chunks_family
    ON document_chunks(family_id, locale_variant_id, ordinal);

  CREATE TABLE IF NOT EXISTS document_aliases (
    locale_variant_id TEXT NOT NULL,
    family_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    PRIMARY KEY (locale_variant_id, normalized_alias)
  );

  CREATE INDEX IF NOT EXISTS idx_article_relations_v2_aliases_alias
    ON document_aliases(normalized_alias, family_id);

  CREATE TABLE IF NOT EXISTS document_links (
    link_key TEXT PRIMARY KEY,
    locale_variant_id TEXT NOT NULL,
    family_id TEXT NOT NULL,
    href TEXT NOT NULL,
    text TEXT,
    target_family_id TEXT,
    target_external_key TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_article_relations_v2_links_family
    ON document_links(family_id, target_family_id);
  CREATE INDEX IF NOT EXISTS idx_article_relations_v2_links_target_external_key
    ON document_links(target_external_key);

  CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    locale_variant_id UNINDEXED,
    workspace_id UNINDEXED,
    family_id UNINDEXED,
    title,
    headings,
    aliases,
    external_key,
    body_text,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    chunk_id UNINDEXED,
    workspace_id UNINDEXED,
    family_id UNINDEXED,
    locale_variant_id UNINDEXED,
    heading_path,
    text,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TABLE IF NOT EXISTS index_metadata (
    workspace_id TEXT PRIMARY KEY,
    engine_version TEXT NOT NULL,
    last_built_at TEXT NOT NULL,
    document_count INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL,
    alias_count INTEGER NOT NULL,
    link_count INTEGER NOT NULL
  );
`;
class ArticleRelationsV2IndexDb {
    dbPath;
    constructor(dbPath) {
        this.dbPath = dbPath;
    }
    open() {
        const db = (0, db_1.openWorkspaceDatabase)(this.dbPath);
        this.ensureSchema(db);
        return db;
    }
    ensureSchema(db) {
        db.exec(INDEX_SCHEMA);
    }
    clearAll(db) {
        db.run('DELETE FROM chunks_fts');
        db.run('DELETE FROM documents_fts');
        db.run('DELETE FROM document_links');
        db.run('DELETE FROM document_aliases');
        db.run('DELETE FROM document_chunks');
        db.run('DELETE FROM documents');
        db.run('DELETE FROM index_metadata');
    }
    listDocumentStates(db) {
        return db.all(`SELECT locale_variant_id as localeVariantId,
              family_id as familyId,
              revision_id as revisionId,
              content_hash as contentHash
       FROM documents`);
    }
    deleteDocuments(db, localeVariantIds) {
        for (const localeVariantId of localeVariantIds) {
            this.deleteDocument(db, localeVariantId);
        }
    }
    replaceDocument(db, document) {
        this.deleteDocument(db, document.localeVariantId);
        const row = toIndexDocumentRow(document);
        db.run(`INSERT INTO documents (
         locale_variant_id, workspace_id, family_id, locale, revision_id, content_hash, title,
         external_key, normalized_external_key, category_id, category_name, section_id, section_name,
         headings_text, aliases_text, body_text
       ) VALUES (
         @localeVariantId, @workspaceId, @familyId, @locale, @revisionId, @contentHash, @title,
         @externalKey, @normalizedExternalKey, @categoryId, @categoryName, @sectionId, @sectionName,
         @headingsText, @aliasesText, @bodyText
       )`, {
            localeVariantId: row.localeVariantId,
            workspaceId: row.workspaceId,
            familyId: row.familyId,
            locale: row.locale,
            revisionId: row.revisionId,
            contentHash: row.contentHash,
            title: row.title,
            externalKey: row.externalKey,
            normalizedExternalKey: row.normalizedExternalKey,
            categoryId: row.categoryId ?? null,
            categoryName: row.categoryName ?? null,
            sectionId: row.sectionId ?? null,
            sectionName: row.sectionName ?? null,
            headingsText: row.headingsText,
            aliasesText: row.aliasesText,
            bodyText: row.bodyText
        });
        db.run(`INSERT INTO documents_fts (
         locale_variant_id, workspace_id, family_id, title, headings, aliases, external_key, body_text
       ) VALUES (
         @localeVariantId, @workspaceId, @familyId, @title, @headingsText, @aliasesText, @externalKey, @bodyText
       )`, {
            localeVariantId: row.localeVariantId,
            workspaceId: row.workspaceId,
            familyId: row.familyId,
            title: row.title,
            headingsText: row.headingsText,
            aliasesText: row.aliasesText,
            externalKey: row.externalKey,
            bodyText: row.bodyText
        });
        for (const alias of document.aliases) {
            db.run(`INSERT INTO document_aliases (
           locale_variant_id, family_id, alias, normalized_alias
         ) VALUES (
           @localeVariantId, @familyId, @alias, @normalizedAlias
         )`, {
                localeVariantId: document.localeVariantId,
                familyId: document.familyId,
                alias,
                normalizedAlias: alias.trim().toLowerCase()
            });
        }
        for (const link of (0, types_1.dedupeArticleRelationsV2ExplicitLinks)(document.explicitLinks)) {
            const linkKey = (0, types_1.getArticleRelationsV2ExplicitLinkKey)(document.localeVariantId, link);
            try {
                db.run(`INSERT INTO document_links (
             link_key, locale_variant_id, family_id, href, text, target_family_id, target_external_key
           ) VALUES (
             @linkKey, @localeVariantId, @familyId, @href, @text, @targetFamilyId, @targetExternalKey
           )`, {
                    linkKey,
                    localeVariantId: document.localeVariantId,
                    familyId: document.familyId,
                    href: link.href,
                    text: link.text ?? null,
                    targetFamilyId: link.targetFamilyId ?? null,
                    targetExternalKey: link.targetExternalKey ?? null
                });
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to index explicit link for family ${document.familyId}, locale variant ${document.localeVariantId}, href ${link.href}: ${errorMessage}`, { cause: error });
            }
        }
        for (const chunk of document.chunks) {
            db.run(`INSERT INTO document_chunks (
           chunk_id, workspace_id, family_id, locale_variant_id, ordinal, heading_path, text
         ) VALUES (
           @chunkId, @workspaceId, @familyId, @localeVariantId, @ordinal, @headingPath, @text
         )`, {
                chunkId: chunk.chunkId,
                workspaceId: document.workspaceId,
                familyId: document.familyId,
                localeVariantId: document.localeVariantId,
                ordinal: chunk.ordinal,
                headingPath: chunk.headingPath ?? null,
                text: chunk.text
            });
            db.run(`INSERT INTO chunks_fts (
           chunk_id, workspace_id, family_id, locale_variant_id, heading_path, text
         ) VALUES (
           @chunkId, @workspaceId, @familyId, @localeVariantId, @headingPath, @text
         )`, {
                chunkId: chunk.chunkId,
                workspaceId: document.workspaceId,
                familyId: document.familyId,
                localeVariantId: document.localeVariantId,
                headingPath: chunk.headingPath ?? null,
                text: chunk.text
            });
        }
    }
    updateMetadata(db, workspaceId, lastBuiltAtUtc) {
        const counts = db.get(`SELECT
         (SELECT COUNT(*) FROM documents) as documentCount,
         (SELECT COUNT(*) FROM document_chunks) as chunkCount,
         (SELECT COUNT(*) FROM document_aliases) as aliasCount,
         (SELECT COUNT(*) FROM document_links) as linkCount`) ?? {
            documentCount: 0,
            chunkCount: 0,
            aliasCount: 0,
            linkCount: 0
        };
        db.run(`INSERT INTO index_metadata (
         workspace_id, engine_version, last_built_at, document_count, chunk_count, alias_count, link_count
       ) VALUES (
         @workspaceId, @engineVersion, @lastBuiltAt, @documentCount, @chunkCount, @aliasCount, @linkCount
       )
       ON CONFLICT(workspace_id) DO UPDATE SET
         engine_version = excluded.engine_version,
         last_built_at = excluded.last_built_at,
         document_count = excluded.document_count,
         chunk_count = excluded.chunk_count,
         alias_count = excluded.alias_count,
         link_count = excluded.link_count`, {
            workspaceId,
            engineVersion: types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION,
            lastBuiltAt: lastBuiltAtUtc,
            documentCount: counts.documentCount,
            chunkCount: counts.chunkCount,
            aliasCount: counts.aliasCount,
            linkCount: counts.linkCount
        });
        return {
            workspaceId,
            engineVersion: types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION,
            documentCount: counts.documentCount,
            chunkCount: counts.chunkCount,
            aliasCount: counts.aliasCount,
            linkCount: counts.linkCount,
            lastBuiltAtUtc
        };
    }
    getStats(db, workspaceId) {
        const row = db.get(`SELECT workspace_id as workspaceId,
              engine_version as engineVersion,
              last_built_at as lastBuiltAtUtc,
              document_count as documentCount,
              chunk_count as chunkCount,
              alias_count as aliasCount,
              link_count as linkCount
       FROM index_metadata
       WHERE workspace_id = @workspaceId`, { workspaceId });
        return row ?? {
            workspaceId,
            engineVersion: types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION,
            documentCount: 0,
            chunkCount: 0,
            aliasCount: 0,
            linkCount: 0
        };
    }
    deleteDocument(db, localeVariantId) {
        db.run('DELETE FROM chunks_fts WHERE locale_variant_id = @localeVariantId', { localeVariantId });
        db.run('DELETE FROM documents_fts WHERE locale_variant_id = @localeVariantId', { localeVariantId });
        db.run('DELETE FROM document_links WHERE locale_variant_id = @localeVariantId', { localeVariantId });
        db.run('DELETE FROM document_aliases WHERE locale_variant_id = @localeVariantId', { localeVariantId });
        db.run('DELETE FROM document_chunks WHERE locale_variant_id = @localeVariantId', { localeVariantId });
        db.run('DELETE FROM documents WHERE locale_variant_id = @localeVariantId', { localeVariantId });
    }
}
exports.ArticleRelationsV2IndexDb = ArticleRelationsV2IndexDb;
function toIndexDocumentRow(document) {
    return {
        workspaceId: document.workspaceId,
        familyId: document.familyId,
        localeVariantId: document.localeVariantId,
        locale: document.locale,
        revisionId: document.revisionId,
        contentHash: document.contentHash,
        title: document.title,
        externalKey: document.externalKey,
        normalizedExternalKey: document.externalKey.trim().toLowerCase(),
        categoryId: document.categoryId,
        categoryName: document.categoryName,
        sectionId: document.sectionId,
        sectionName: document.sectionName,
        headingsText: document.headings.map((heading) => heading.path).join('\n'),
        aliasesText: document.aliases.join('\n'),
        bodyText: document.bodyText
    };
}
