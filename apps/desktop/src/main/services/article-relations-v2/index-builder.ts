import type { SQLite } from '@kb-vault/db';
import { ArticleRelationIndexStateStatus, type RelationDocument } from '@kb-vault/shared-types';
import { ArticleRelationsV2IndexDb } from './index-db';
import {
  ARTICLE_RELATIONS_V2_ENGINE_VERSION,
  type ArticleRelationsV2IndexBuildResult
} from './types';

interface IndexBuildInput {
  workspaceId: string;
  workspaceDb: SQLite;
  documents: RelationDocument[];
  forceFullRebuild?: boolean;
}

export class ArticleRelationsV2IndexBuilder {
  constructor(private readonly indexDb: ArticleRelationsV2IndexDb) {}

  rebuild(input: IndexBuildInput): ArticleRelationsV2IndexBuildResult {
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
        } else if (deletedDocumentIds.length > 0) {
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
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } finally {
      db.close();
    }
  }

  private syncMainIndexState(
    workspaceDb: SQLite,
    workspaceId: string,
    documents: RelationDocument[],
    deletedDocumentIds: string[],
    lastBuiltAtUtc: string,
    forceFullRebuild: boolean
  ): void {
    workspaceDb.exec('BEGIN IMMEDIATE');
    try {
      if (forceFullRebuild) {
        workspaceDb.run(
          `DELETE FROM article_relation_index_state
           WHERE workspace_id = @workspaceId`,
          { workspaceId }
        );
      } else if (documents.length === 0) {
        workspaceDb.run(
          `DELETE FROM article_relation_index_state
           WHERE workspace_id = @workspaceId`,
          { workspaceId }
        );
      } else {
        workspaceDb.run(
          `DELETE FROM article_relation_index_state
           WHERE workspace_id = @workspaceId
             AND locale_variant_id NOT IN (${buildNamedInClause('scopedLocaleVariant', documents.map((document) => document.localeVariantId))})`,
          {
            workspaceId,
            ...buildNamedParams('scopedLocaleVariant', documents.map((document) => document.localeVariantId))
          }
        );
      }

      if (!forceFullRebuild && deletedDocumentIds.length > 0) {
        workspaceDb.run(
          `DELETE FROM article_relation_index_state
           WHERE workspace_id = @workspaceId
             AND locale_variant_id IN (${buildNamedInClause('deletedLocaleVariant', deletedDocumentIds)})`,
          {
            workspaceId,
            ...buildNamedParams('deletedLocaleVariant', deletedDocumentIds)
          }
        );
      }

      const upsert = workspaceDb.prepare(
        `INSERT INTO article_relation_index_state (
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
           last_error = NULL`
      );

      for (const document of documents) {
        upsert.run({
          workspaceId,
          localeVariantId: document.localeVariantId,
          familyId: document.familyId,
          revisionId: document.revisionId,
          contentHash: document.contentHash,
          engineVersion: ARTICLE_RELATIONS_V2_ENGINE_VERSION,
          status: ArticleRelationIndexStateStatus.INDEXED,
          lastIndexedAt: lastBuiltAtUtc
        });
      }

      workspaceDb.exec('COMMIT');
    } catch (error) {
      workspaceDb.exec('ROLLBACK');
      throw error;
    }
  }
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
