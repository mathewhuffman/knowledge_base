# Codex Batch 1 Handoff

## What was built
- Established a fresh monorepo bootstrap for Batch 1 foundation.
- Added Electron shell entry points (`apps/desktop/src/main/main.ts`) with window bootstrap and IPC binding.
- Added shared TypeScript contract package (`packages/shared-types`) containing route identifiers, IPC envelopes, job state, and error taxonomy.
- Added minimal typed IPC bridge (`apps/desktop/src/preload/ipc`) and renderer shell (`apps/desktop/src/renderer`) with all required route containers.
- Added command bus, job registry, and feature-flag-aware config loader.
- Added lightweight logging and workspace root resolution.
- Added package boundaries and skeletons for planned modules: db, zendesk-client, agent-runtime, mcp-server, diff-engine, html-preview.
- Added required batch handoff/contract files for Batch 1.

## Files added/changed
- Added: `package.json`
- Added: `pnpm-workspace.yaml`
- Added: `apps/desktop/package.json`
- Added: `apps/desktop/index.html`
- Added: `apps/desktop/tsconfig.base.json`
- Added: `apps/desktop/tsconfig.main.json`
- Added: `apps/desktop/tsconfig.renderer.json`
- Added: `apps/desktop/vite.config.ts`
- Added: `apps/desktop/playwright.config.ts`
- Added: `apps/desktop/src/main/main.ts`
- Added: `apps/desktop/src/main/config/workspace-root.ts`
- Added: `apps/desktop/src/main/config/config-loader.ts`
- Added: `apps/desktop/src/main/config/types.ts`
- Added: `apps/desktop/src/main/services/logger.ts`
- Added: `apps/desktop/src/main/services/command-bus.ts`
- Added: `apps/desktop/src/main/services/job-runner.ts`
- Added: `apps/desktop/src/main/services/command-registry.ts`
- Added: `apps/desktop/src/preload/ipc.ts`
- Added: `apps/desktop/src/renderer/src/main.tsx`
- Added: `apps/desktop/src/renderer/src/App.tsx`
- Added: `apps/desktop/src/renderer/src/styles.css`
- Added: `apps/desktop/src/renderer/src/routes/routeMap.ts`
- Added: `apps/desktop/src/renderer/src/pages/WorkspaceSwitcher.tsx`
- Added: `apps/desktop/src/renderer/src/pages/KBVaultHome.tsx`
- Added: `apps/desktop/src/renderer/src/pages/ArticleExplorer.tsx`
- Added: `apps/desktop/src/renderer/src/pages/PBIBatches.tsx`
- Added: `apps/desktop/src/renderer/src/pages/ProposalReview.tsx`
- Added: `apps/desktop/src/renderer/src/pages/Drafts.tsx`
- Added: `apps/desktop/src/renderer/src/pages/PublishQueue.tsx`
- Added: `apps/desktop/src/renderer/src/pages/TemplatesAndPrompts.tsx`
- Added: `apps/desktop/src/renderer/src/pages/Settings.tsx`
- Added: `apps/desktop/src/renderer/src/types/window.d.ts`
- Added: `apps/desktop/tests/smoke-shell.spec.ts`
- Added: `packages/shared-types/package.json`
- Added: `packages/shared-types/tsconfig.json`
- Added: `packages/shared-types/src/index.ts`
- Added: `packages/shared-types/src/routes.ts`
- Added: `packages/shared-types/src/errors.ts`
- Added: `packages/shared-types/src/ipc.ts`
- Added: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/src/index.ts`, `packages/db/src/migrations.ts`
- Added: `packages/zendesk-client/package.json`, `packages/zendesk-client/tsconfig.json`, `packages/zendesk-client/src/index.ts`
- Added: `packages/agent-runtime/package.json`, `packages/agent-runtime/tsconfig.json`, `packages/agent-runtime/src/index.ts`
- Added: `packages/mcp-server/package.json`, `packages/mcp-server/tsconfig.json`, `packages/mcp-server/src/index.ts`
- Added: `packages/diff-engine/package.json`, `packages/diff-engine/tsconfig.json`, `packages/diff-engine/src/index.ts`
- Added: `packages/html-preview/package.json`, `packages/html-preview/tsconfig.json`, `packages/html-preview/src/index.ts`
- Added: `docs/batches/codex-batch-1.md`
- Added: `docs/claude-handoff/batch-1.md`
- Added: `docs/contracts/batch-1-ipc.md`
- Added: `docs/contracts/batch-1-schema.md`
- Added: `docs/contracts/batch-1-payloads.md`

## New DB tables/migrations
No concrete SQLite tables were implemented in Batch 1.
Migration contract exists in `packages/db/src/migrations.ts` with placeholder bootstrap migration `0001_bootstrap_fixtures`.

## New IPC endpoints added/changed
- `system.boot`
- `system.ping`
- `system.migrations.health`
- `workspace.getRouteConfig`
- `workspace.getWorkspaceRoot`
- `jobs.getActiveJobs`
- `workspace.bootstrap` (via job command channel)

## New background jobs
- `workspace.bootstrap` runner stub (job registry)

## Renderer hooks now available
- `window.kbv.invoke(method, payload)` returning shared `RpcResponse`
- `window.kbv.startJob(command, input)` for background jobs
- `window.kbv.emitJobEvents(handler)` for live job updates via IPC event channel

## Sample payloads
- See docs/contracts/batch-1-payloads.md

## Known limitations
- Rendered shell is intentionally unstyled and not final UX.
- Electron + Vite startup scripts are placeholders; no install/build runtime validation has been executed in this environment.
- Package imports for crypto uuid use Node `crypto.randomUUID`, and some legacy fallback paths may need a compatibility check in older Node versions.
- MCP, Zendesk, ACP/MCP runtime, DB persistence, and migration persistence not implemented.

## What Claude should plug UI into
- Route surface in `apps/desktop/src/renderer/src/App.tsx` and `src/renderer/src/routes/routeMap.ts`.
- IPC bootstrap and shell data reads use `window.kbv.invoke('system.boot', ...)`.
- Replace route placeholders in `src/renderer/src/pages/*` with polished screen implementations.
- Add job progress indicators via `window.kbv.emitJobEvents`.

## Test coverage added
- Smoke test shell placeholder: `apps/desktop/tests/smoke-shell.spec.ts`
