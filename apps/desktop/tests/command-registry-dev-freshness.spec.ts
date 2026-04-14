import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { __commandRegistryTestables } from '../src/main/services/command-registry';

const writePair = async (
  root: string,
  sourceRelativePath: string,
  buildRelativePath: string,
  sourceMtimeMs: number,
  buildMtimeMs: number
) => {
  const sourcePath = path.join(root, sourceRelativePath);
  const buildPath = path.join(root, buildRelativePath);
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await mkdir(path.dirname(buildPath), { recursive: true });
  await writeFile(sourcePath, '// source\n');
  await writeFile(buildPath, '// build\n');
  await utimes(sourcePath, sourceMtimeMs / 1000, sourceMtimeMs / 1000);
  await utimes(buildPath, buildMtimeMs / 1000, buildMtimeMs / 1000);
};

test.describe('command registry dev build freshness', () => {
  test('flags batch analyzation when critical source is newer than dist main output', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-freshness-'));
    try {
      const now = Date.now();
      await writePair(
        root,
        'apps/desktop/src/main/services/command-registry.ts',
        'apps/desktop/dist/main/services/command-registry.js',
        now,
        now - 60_000
      );

      const result = await __commandRegistryTestables.evaluateBatchAnalysisDevBuildFreshness(root);

      expect(result.stale).toBe(true);
      expect(result.message).toContain('stale desktop main build');
      expect(result.message).toContain('apps/desktop/src/main/services/command-registry.ts');
      expect(result.stalePairs).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('allows batch analyzation when dist main output is newer than source', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kb-vault-freshness-'));
    try {
      const now = Date.now();
      await writePair(
        root,
        'apps/desktop/src/main/services/command-registry.ts',
        'apps/desktop/dist/main/services/command-registry.js',
        now - 60_000,
        now
      );

      const result = await __commandRegistryTestables.evaluateBatchAnalysisDevBuildFreshness(root);

      expect(result.stale).toBe(false);
      expect(result.message).toBeUndefined();
      expect(result.stalePairs).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
