"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArticleRelationsV2IndexBuilder = void 0;
const shared_types_1 = require("@kb-vault/shared-types");
const types_1 = require("./types");
class ArticleRelationsV2IndexBuilder {
    indexDb;
    constructor(indexDb) {
        this.indexDb = indexDb;
    }
    rebuild(input) {
        const db = this.indexDb.open();
        try {
            const existingStates = this.indexDb.listDocumentStates(db);
            const existingByLocaleVariant = new Map(existingStates.map((row) => [row.localeVariantId, row]));
            const nextByLocaleVariant = new Map(input.documents.map((document) => [document.localeVariantId, document]));
            const deletedDocumentIds = input.forceFullRebuild
                ? existingStates.map((row) => row.localeVariantId)
                : existingStates
                    .filter((row) => !nextByLocaleVariant.has(row.localeVariantId))
                    .map((row) => row.localeVariantId);
            const documentsToUpsert = input.forceFullRebuild
                ? input.documents
                : input.documents.filter((document) => {
                    const existing = existingByLocaleVariant.get(document.localeVariantId);
                    return !existing
                        || existing.familyId !== document.familyId
                        || existing.revisionId !== document.revisionId
                        || existing.contentHash !== document.contentHash;
                });
            const unchangedDocumentCount = Math.max(0, input.documents.length - documentsToUpsert.length);
            const lastBuiltAtUtc = new Date().toISOString();
            db.exec('BEGIN IMMEDIATE');
            try {
                if (input.forceFullRebuild) {
                    this.indexDb.clearAll(db);
                }
                else if (deletedDocumentIds.length > 0) {
                    this.indexDb.deleteDocuments(db, deletedDocumentIds);
                }
                for (const document of documentsToUpsert) {
                    this.indexDb.replaceDocument(db, document);
                }
                const stats = this.indexDb.updateMetadata(db, input.workspaceId, lastBuiltAtUtc);
                db.exec('COMMIT');
                this.syncMainIndexState(input.workspaceDb, input.workspaceId, input.documents, deletedDocumentIds, lastBuiltAtUtc, Boolean(input.forceFullRebuild));
                return {
                    ...stats,
                    deletedDocumentCount: deletedDocumentIds.length,
                    upsertedDocumentCount: documentsToUpsert.length,
                    unchangedDocumentCount
                };
            }
            catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        }
        finally {
            db.close();
        }
    }
    syncMainIndexState(workspaceDb, workspaceId, documents, deletedDocumentIds, lastBuiltAtUtc, forceFullRebuild) {
        workspaceDb.exec('BEGIN IMMEDIATE');
        try {
            if (forceFullRebuild) {
                workspaceDb.run(`DELETE FROM article_relation_index_state
           WHERE workspace_id = @workspaceId`, { workspaceId });
            }
            else if (documents.length === 0) {
                workspaceDb.run(`DELETE FROM article_relation_index_state
           WHERE workspace_id = @workspaceId`, { workspaceId });
            }
            else {
                workspaceDb.run(`DELETE FROM article_relation_index_state
           WHERE workspace_id = @workspaceId
             AND locale_variant_id NOT IN (${buildNamedInClause('scopedLocaleVariant', documents.map((document) => document.localeVariantId))})`, {
                    workspaceId,
                    ...buildNamedParams('scopedLocaleVariant', documents.map((document) => document.localeVariantId))
                });
            }
            if (!forceFullRebuild && deletedDocumentIds.length > 0) {
                workspaceDb.run(`DELETE FROM article_relation_index_state
           WHERE workspace_id = @workspaceId
             AND locale_variant_id IN (${buildNamedInClause('deletedLocaleVariant', deletedDocumentIds)})`, {
                    workspaceId,
                    ...buildNamedParams('deletedLocaleVariant', deletedDocumentIds)
                });
            }
            const upsert = workspaceDb.prepare(`INSERT INTO article_relation_index_state (
           workspace_id, locale_variant_id, family_id, revision_id, content_hash, engine_version, status, last_indexed_at, last_error
         ) VALUES (
           @workspaceId, @localeVariantId, @familyId, @revisionId, @contentHash, @engineVersion, @status, @lastIndexedAt, NULL
         )
         ON CONFLICT(workspace_id, locale_variant_id) DO UPDATE SET
           family_id = excluded.family_id,
           revision_id = excluded.revision_id,
           content_hash = excluded.content_hash,
           engine_version = excluded.engine_version,
           status = excluded.status,
           last_indexed_at = excluded.last_indexed_at,
           last_error = NULL`);
            for (const document of documents) {
                upsert.run({
                    workspaceId,
                    localeVariantId: document.localeVariantId,
                    familyId: document.familyId,
                    revisionId: document.revisionId,
                    contentHash: document.contentHash,
                    engineVersion: types_1.ARTICLE_RELATIONS_V2_ENGINE_VERSION,
                    status: shared_types_1.ArticleRelationIndexStateStatus.INDEXED,
                    lastIndexedAt: lastBuiltAtUtc
                });
            }
            workspaceDb.exec('COMMIT');
        }
        catch (error) {
            workspaceDb.exec('ROLLBACK');
            throw error;
        }
    }
}
exports.ArticleRelationsV2IndexBuilder = ArticleRelationsV2IndexBuilder;
function buildNamedInClause(prefix, values) {
    return values.map((_, index) => `@${prefix}${index}`).join(', ');
}
function buildNamedParams(prefix, values) {
    const params = {};
    values.forEach((value, index) => {
        params[`${prefix}${index}`] = value;
    });
    return params;
}
