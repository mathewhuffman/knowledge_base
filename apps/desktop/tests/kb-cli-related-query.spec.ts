import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, expect } from '@playwright/test';
import { AppWorkingStateService } from '../src/main/services/app-working-state-service';
import { KbCliLoopbackService } from '../src/main/services/kb-cli-loopback-service';
import { KbCliRuntimeService } from '../src/main/services/kb-cli-runtime-service';

const execFileAsync = promisify(execFile);

test.describe('kb cli related query coverage', () => {
  test('routes query-only related requests through v2 coverage for loopback and kb shim clients', async () => {
    const coverageRequests: Array<{
      workspaceId: string;
      query: string;
      maxResults?: number;
      minScore?: number;
      includeEvidence?: boolean;
    }> = [];
    const mockRepository = {
      queryArticleRelationCoverage: async (request: {
        workspaceId: string;
        query: string;
        maxResults?: number;
        minScore?: number;
        includeEvidence?: boolean;
      }) => {
        coverageRequests.push(request);
        return {
          workspaceId: request.workspaceId,
          engineVersion: 'article-relations-v2',
          results: [
            {
              familyId: 'family-coverage',
              localeVariantIds: ['variant-en'],
              title: 'Coverage Guide',
              externalKey: 'coverage-guide',
              finalScore: 1.18,
              relationEligible: true,
              evidence: [
                {
                  evidenceType: 'title_fts',
                  snippet: 'Coverage Guide',
                  weight: 0.91
                }
              ]
            }
          ]
        };
      },
      listArticleRelations: async () => {
        throw new Error('queryArticleRelationCoverage should handle query-only related requests');
      }
    } as never;

    const appWorkingStateService = new AppWorkingStateService(() => undefined);
    const loopbackService = new KbCliLoopbackService(mockRepository, appWorkingStateService);
    const cliRuntimeService = new KbCliRuntimeService(loopbackService);
    await loopbackService.start();

    try {
      const baseUrl = loopbackService.getBaseUrl();
      expect(baseUrl).toBeTruthy();

      const relatedResp = await fetch(
        `${baseUrl}/workspaces/workspace-query/articles/related`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${loopbackService.getAuthToken()}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            query: 'coverage guide',
            limit: 5,
            minScore: 0.25
          })
        }
      );
      expect(relatedResp.ok).toBe(true);
      const relatedJson = await relatedResp.json() as {
        ok: boolean;
        total: number;
        results: Array<{ familyId: string; localeVariantIds: string[] }>;
      };
      expect(relatedJson.ok).toBe(true);
      expect(relatedJson.total).toBe(1);
      expect(relatedJson.results[0]?.familyId).toBe('family-coverage');
      expect(relatedJson.results[0]?.localeVariantIds).toEqual(['variant-en']);
      expect(coverageRequests[0]).toEqual({
        workspaceId: 'workspace-query',
        query: 'coverage guide',
        maxResults: 5,
        minScore: 0.25,
        includeEvidence: true
      });

      cliRuntimeService.applyProcessEnv();
      const binaryPath = cliRuntimeService.resolveBinaryPath();
      expect(binaryPath).toBeTruthy();

      const { stdout } = await execFileAsync(
        binaryPath!,
        [
          'find-related-articles',
          '--workspace-id',
          'workspace-query',
          '--query',
          'coverage guide',
          '--limit',
          '4',
          '--json'
        ],
        {
          env: {
            ...process.env,
            ...cliRuntimeService.getEnvironment()
          }
        }
      );

      const cliPayload = JSON.parse(stdout) as {
        ok: boolean;
        command: string;
        data: {
          ok: boolean;
          total: number;
          results: Array<{ familyId: string; localeVariantIds: string[] }>;
        };
      };
      expect(cliPayload.ok).toBe(true);
      expect(cliPayload.command).toBe('find-related-articles');
      expect(cliPayload.data.ok).toBe(true);
      expect(cliPayload.data.total).toBe(1);
      expect(cliPayload.data.results[0]?.familyId).toBe('family-coverage');
      expect(cliPayload.data.results[0]?.localeVariantIds).toEqual(['variant-en']);
      expect(coverageRequests[1]).toEqual({
        workspaceId: 'workspace-query',
        query: 'coverage guide',
        maxResults: 4,
        includeEvidence: true
      });
    } finally {
      await loopbackService.stop();
    }
  });

  test('prefers relation-list routing when query is mixed with article relation seeds', async () => {
    const coverageRequests: Array<Record<string, unknown>> = [];
    const relationRequests: Array<Record<string, unknown>> = [];
    const mockRepository = {
      queryArticleRelationCoverage: async (request: Record<string, unknown>) => {
        coverageRequests.push(request);
        return {
          workspaceId: request.workspaceId,
          engineVersion: 'article-relations-v2',
          results: []
        };
      },
      listArticleRelations: async (_workspaceId: string, request: Record<string, unknown>) => {
        relationRequests.push(request);
        return {
          workspaceId: 'workspace-query',
          seedFamilyIds: request.familyId ? [request.familyId] : [],
          total: 1,
          relations: [
            {
              id: 'relation-1',
              relationType: 'see_also',
              strengthScore: 0.72,
              sourceFamily: { id: 'seed-family', title: 'Seed Family' },
              targetFamily: { id: 'family-related', title: 'Related Family' }
            }
          ]
        };
      }
    } as never;

    const appWorkingStateService = new AppWorkingStateService(() => undefined);
    const loopbackService = new KbCliLoopbackService(mockRepository, appWorkingStateService);
    const cliRuntimeService = new KbCliRuntimeService(loopbackService);
    await loopbackService.start();

    try {
      const baseUrl = loopbackService.getBaseUrl();
      expect(baseUrl).toBeTruthy();

      const relatedResp = await fetch(
        `${baseUrl}/workspaces/workspace-query/articles/related`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${loopbackService.getAuthToken()}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            query: 'coverage guide',
            familyId: 'seed-family',
            limit: 5,
            minScore: 0.25
          })
        }
      );
      expect(relatedResp.ok).toBe(true);
      const relatedJson = await relatedResp.json() as {
        ok: boolean;
        total: number;
        results: Array<{ id: string }>;
      };
      expect(relatedJson.ok).toBe(true);
      expect(relatedJson.total).toBe(1);
      expect(relatedJson.results[0]?.id).toBe('relation-1');
      expect(coverageRequests).toEqual([]);
      expect(relationRequests[0]).toEqual({
        workspaceId: 'workspace-query',
        localeVariantId: undefined,
        familyId: 'seed-family',
        batchId: undefined,
        limit: 5,
        minScore: 0.25,
        includeEvidence: true
      });

      cliRuntimeService.applyProcessEnv();
      const binaryPath = cliRuntimeService.resolveBinaryPath();
      expect(binaryPath).toBeTruthy();

      const { stdout } = await execFileAsync(
        binaryPath!,
        [
          'find-related-articles',
          '--workspace-id',
          'workspace-query',
          '--query',
          'coverage guide',
          '--family-id',
          'seed-family',
          '--limit',
          '4',
          '--json'
        ],
        {
          env: {
            ...process.env,
            ...cliRuntimeService.getEnvironment()
          }
        }
      );

      const cliPayload = JSON.parse(stdout) as {
        ok: boolean;
        command: string;
        data: {
          ok: boolean;
          total: number;
          results: Array<{ id: string }>;
        };
      };
      expect(cliPayload.ok).toBe(true);
      expect(cliPayload.command).toBe('find-related-articles');
      expect(cliPayload.data.ok).toBe(true);
      expect(cliPayload.data.total).toBe(1);
      expect(cliPayload.data.results[0]?.id).toBe('relation-1');
      expect(coverageRequests).toEqual([]);
      expect(relationRequests[1]).toEqual({
        workspaceId: 'workspace-query',
        localeVariantId: undefined,
        familyId: 'seed-family',
        batchId: undefined,
        limit: 4,
        minScore: undefined,
        includeEvidence: true
      });
    } finally {
      await loopbackService.stop();
    }
  });
});
