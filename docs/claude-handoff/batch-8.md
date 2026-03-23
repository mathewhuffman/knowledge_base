# Claude Handoff: Batch 8

Batch 8 draft-editing backend contracts are ready. The Drafts page is no longer mock data, but it is still intentionally functional and backend-forward.

## What Backend Is Ready

- Real draft branch list payloads with summary counts
- Real editor hydration payloads with:
  - branch metadata
  - live-vs-draft compare payload
  - validation warnings
  - autosave state
  - revision history
  - editor capabilities
- Draft save and autosave mutations
- Branch status transitions
- Discard flow
- Undo/redo through persisted head-revision changes

## IPC To Use

- `draft.branch.list`
- `draft.branch.get`
- `draft.branch.create`
- `draft.branch.save`
- `draft.branch.status.set`
- `draft.branch.discard`
- `draft.branch.undo`
- `draft.branch.redo`

## Expected Renderer Mapping

- Branch rail:
  - `summary`
  - `branches`
- Header:
  - `branch.name`
  - `branch.status`
  - `branch.baseRevisionNumber`
  - `branch.headRevisionNumber`
  - `branch.changeSummary`
- Editor surface:
  - `editor.html`
  - `editor.previewHtml`
  - `editor.capabilities`
- Validation rail:
  - `editor.validationWarnings`
  - `branch.validationSummary`
- Compare panel:
  - `editor.compare.diff`
- Autosave display:
  - `editor.autosave`
- Revision history rail:
  - `editor.history`

## Known Gaps / Limitations

- The current renderer host is still textarea-based. You can now swap in Monaco cleanly using the same payloads.
- Validation is intentionally heuristic for now.
- Ready/conflicted/obsolete/discarded states are now exposed, but Batch 10 still owns the deeper publish/conflict resolution UX.
