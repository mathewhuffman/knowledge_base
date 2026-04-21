# Claude Handoff: Batch 9

Batch 9 backend contracts are ready for article AI refinement and template management.

## What Backend Is Ready

- Persisted article AI chat sessions scoped to article/draft targets
- Persisted article AI transcript messages
- Pending AI edit state with direct accept / reject / reset actions
- ACP-backed article edit submission endpoint
- Template pack CRUD
- Template pack analysis payloads

## IPC To Use

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

## Expected Renderer Mapping

- Article AI chat sidebar:
  - `session`
  - `messages`
  - `presets`
  - `templatePacks`
- Pending edit UX:
  - `pendingEdit.currentHtml`
  - `pendingEdit.proposedHtml`
  - `pendingEdit.summary`
  - `pendingEdit.diff`
- Direct decision UX:
  - `article.ai.accept`
  - `article.ai.reject`
- Reset flow:
  - `article.ai.reset`
- Template library:
  - `templates`
  - `analysis`

## Known Gaps / Limitations

- The current Drafts page integration is functional but not yet polished into a high-trust side-by-side AI refinement experience.
- Template analysis is available, but it is currently heuristic and should be framed accordingly in the UI.
