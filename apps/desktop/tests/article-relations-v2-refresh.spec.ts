import { expect, test } from '@playwright/test';
import { ArticleRelationStatus } from '@kb-vault/shared-types';
import { ArticleRelationsV2RelationOrchestrator } from '../src/main/services/article-relations-v2/relation-orchestrator';

class FakeWorkspaceDb {
  readonly insertedRelations: Array<Record<string, unknown>> = [];
  readonly insertedEvidence: Array<Record<string, unknown>> = [];
  readonly deletedRelationIds: string[] = [];

  all<T>(sql: string, params?: Record<string, unknown>): T[] {
    if (sql.includes('FROM article_relations') && sql.includes('origin = @origin') && sql.includes('status = @status')) {
      return [] as T[];
    }

    if (sql.includes('SELECT id') && sql.includes('FROM article_relations') && sql.includes('origin = @origin')) {
      return [{ id: 'legacy-inferred-1' }] as T[];
    }

    if (sql.includes('FROM article_relation_overrides')) {
      return [
        {
          leftFamilyId: 'family-billing',
          rightFamilyId: 'family-reports'
        }
      ] as T[];
    }

    void params;
    return [];
  }

  get<T>(sql: string, _params?: Record<string, unknown>): T | undefined {
    if (sql.includes('COUNT(*) as total') && sql.includes('FROM article_relations')) {
      return { total: 0 } as T;
    }

    if (sql.includes('COUNT(*) as total') && sql.includes('FROM article_relation_overrides')) {
      return { total: 1 } as T;
    }

    return undefined;
  }

  run(sql: string, params?: Record<string, unknown>): void {
    if (sql.includes('DELETE FROM article_relations')) {
      this.deletedRelationIds.push(...Object.values(params ?? {}) as string[]);
      return;
    }

    if (sql.includes('INSERT INTO article_relations')) {
      this.insertedRelations.push(params ?? {});
      return;
    }

    if (sql.includes('INSERT INTO article_relation_evidence')) {
      this.insertedEvidence.push(params ?? {});
    }
  }

  prepare(sql: string): { run: (params?: Record<string, unknown>) => void } {
    return {
      run: (params?: Record<string, unknown>) => {
        this.run(sql, params);
      }
    };
  }

  exec(_sql: string): void {}
}

test.describe('article relations v2 refresh', () => {
  test('persists active inferred relations through v2 coverage and preserves force-remove suppressions', () => {
    const queryCoverage = ({
      request
    }: {
      request: { seedFamilyIds?: string[] };
    }) => {
      const seedFamilyId = request.seedFamilyIds?.[0];
      if (seedFamilyId === 'family-billing') {
        return {
          workspaceId: 'workspace-1',
          engineVersion: 'article-relations-v2',
          results: [
            {
              familyId: 'family-notifications',
              localeVariantIds: ['variant-notifications'],
              title: 'Manage Notifications',
              externalKey: 'hc:2002',
              finalScore: 1.62,
              relationEligible: true,
              evidence: [
                {
                  evidenceType: 'explicit_link',
                  snippet: 'Manage Notifications',
                  weight: 1.35
                }
              ]
            },
            {
              familyId: 'family-reports',
              localeVariantIds: ['variant-reports'],
              title: 'Export Reports',
              externalKey: 'hc:3003',
              finalScore: 1.44,
              relationEligible: true,
              evidence: [
                {
                  evidenceType: 'explicit_link',
                  snippet: 'Export Reports',
                  weight: 1.35
                }
              ]
            }
          ]
        };
      }

      return {
        workspaceId: 'workspace-1',
        engineVersion: 'article-relations-v2',
        results: []
      };
    };

    const workspaceDb = new FakeWorkspaceDb();
    const orchestrator = new ArticleRelationsV2RelationOrchestrator({
      queryCoverage
    } as never);

    const summary = orchestrator.refreshRelations({
      workspaceId: 'workspace-1',
      runId: 'run-1',
      startedAtUtc: '2026-04-19T00:00:00.000Z',
      workspaceDb: workspaceDb as never,
      indexDb: {} as never,
      seedFamilyIds: ['family-billing', 'family-notifications', 'family-reports'],
      limitPerArticle: 4,
      indexedDocumentCount: 3,
      staleDocumentCount: 0,
      degradedMode: false
    });

    expect(summary).toEqual(expect.objectContaining({
      totalArticles: 3,
      candidatePairs: 2,
      inferredRelations: 2,
      suppressedRelations: 1,
      engineVersion: 'article-relations-v2'
    }));

    expect(workspaceDb.deletedRelationIds).toContain('legacy-inferred-1');
    expect(workspaceDb.insertedRelations).toHaveLength(2);
    expect(workspaceDb.insertedRelations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        leftFamilyId: 'family-billing',
        rightFamilyId: 'family-notifications',
        relationType: 'same_workflow',
        status: ArticleRelationStatus.ACTIVE
      }),
      expect.objectContaining({
        leftFamilyId: 'family-billing',
        rightFamilyId: 'family-reports',
        relationType: 'same_workflow',
        status: ArticleRelationStatus.SUPPRESSED
      })
    ]));
    expect(workspaceDb.insertedEvidence.some((entry) => entry.evidenceType === 'explicit_link')).toBe(true);
  });
});
