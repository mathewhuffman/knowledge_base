# Codex Batch 9 Handoff

## What Was Built

- Added a dedicated Batch 9 contract layer in `packages/shared-types/src/batch9.ts`.
- Added migration `0011_batch9_article_ai_and_templates` for:
  - persisted article AI sessions,
  - persisted article AI chat messages,
  - richer template metadata and cached analysis.
- Extended `WorkspaceRepository` with:
  - article AI session creation/loading,
  - persisted chat transcript storage,
  - pending AI edit storage,
  - direct accept/reject/reset flows,
  - template pack list/get/save/delete/analyze methods,
  - default template pack bootstrapping.
- Extended `CommandRegistry` with:
  - article AI IPC endpoints,
  - ACP-backed article edit submission,
  - template pack CRUD and analysis endpoints.
- Updated the renderer:
  - `Drafts` now includes an article AI sidebar with persisted chat history, presets, template selection, and accept/reject controls.
  - `TemplatesAndPrompts` is now backed by live template CRUD and analysis data.
- Updated the ACP runtime contracts so article-edit runs can return structured result payloads.

## Files Added / Changed

- Added: `packages/shared-types/src/batch9.ts`
- Added: `docs/batches/codex-batch-9.md`
- Added: `docs/claude-handoff/batch-9.md`
- Added: `docs/contracts/batch-9-ipc.md`
- Added: `docs/contracts/batch-9-schema.md`
- Added: `docs/contracts/batch-9-payloads.md`
- Changed: `packages/shared-types/src/index.ts`
- Changed: `packages/shared-types/src/batch6.ts`
- Changed: `packages/db/src/migrations.ts`
- Changed: `packages/agent-runtime/src/index.ts`
- Changed: `apps/desktop/src/main/services/workspace-repository.ts`
- Changed: `apps/desktop/src/main/services/command-registry.ts`
- Changed: `apps/desktop/src/renderer/src/pages/Drafts.tsx`
- Changed: `apps/desktop/src/renderer/src/pages/TemplatesAndPrompts.tsx`
- Changed: `apps/desktop/tests/repository-content-model.spec.ts`
- Changed: `apps/desktop/tests/command-registry-content-model.spec.ts`

## DB Schema / Migration Changes

- Added migration `0011_batch9_article_ai_and_templates`.
- New table: `article_ai_sessions`
- New table: `article_ai_messages`
- New `template_packs` columns:
  - `template_type`
  - `description`
  - `analysis_json`

## IPC Endpoints Added

- `article.ai.get`
- `article.ai.submit`
- `article.ai.reset`
- `article.ai.accept`
- `article.ai.reject`
- `template.pack.list`
- `template.pack.get`
- `template.pack.save`
- `template.pack.delete`
- `template.pack.analyze`

## Background Jobs Added

- None.
- Article AI submission is synchronous from the renderer’s perspective in this batch.

## Renderer Hooks Available For Claude

- `article.ai.get`
- `article.ai.submit`
- `article.ai.reset`
- `article.ai.accept`
- `article.ai.reject`
- `template.pack.list`
- `template.pack.get`
- `template.pack.save`
- `template.pack.delete`
- `template.pack.analyze`

## Exact Places Claude Should Plug UI Into

- `apps/desktop/src/renderer/src/pages/Drafts.tsx`
  - The article AI sidebar is functional but intentionally backend-first.
  - Key payload areas:
    - `session`
    - `messages`
    - `pendingEdit`
    - `presets`
    - `templatePacks`
- `apps/desktop/src/renderer/src/pages/TemplatesAndPrompts.tsx`
  - The page is now live-wired for CRUD and analysis.
  - Claude can refine composition, hierarchy, and editing affordances without changing IPC contracts.

## Known Limitations

- Article AI currently uses ACP-backed structured responses, but the pending edit presentation is still lightweight and draft-centric.
- Live article AI entry is supported by contract and backend shape, but the strongest renderer entry point today is still the Drafts page.
- Template analysis is persisted and surfaced, but it is currently heuristic rather than a separate ACP analysis workflow.

## Verification

- Passed:
  - `./apps/desktop/node_modules/.bin/tsc -p packages/shared-types/tsconfig.json --noEmit`
  - `./apps/desktop/node_modules/.bin/tsc -p apps/desktop/tsconfig.main.json --noEmit`
  - `./apps/desktop/node_modules/.bin/tsc -p apps/desktop/tsconfig.renderer.json --noEmit`
- Blocked in this environment:
  - Focused Playwright repository/command tests fail before execution because `better-sqlite3` is compiled for a different Node ABI (`NODE_MODULE_VERSION 123` vs `137`).
