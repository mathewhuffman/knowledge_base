# Batch 8 IPC Contract (Codex)

## New IPC methods added in Codex batch 8

### `draft.branch.list`

Request:

- `workspaceId: string`
- Optional:
  - `localeVariantId`
  - `includeDiscarded`

Response:

- `DraftBranchListResponse`

### `draft.branch.get`

Request:

- `workspaceId: string`
- `branchId: string`

Response:

- `DraftBranchGetResponse`

### `draft.branch.create`

Request:

- `workspaceId: string`
- `localeVariantId: string`
- Optional:
  - `name`
  - `sourceHtml`
  - `baseRevisionId`
  - `editorState`

Response:

- `DraftBranchGetResponse`

### `draft.branch.save`

Request:

- `workspaceId: string`
- `branchId: string`
- `html: string`
- Optional:
  - `autosave`
  - `commitMessage`
  - `expectedHeadRevisionId`
  - `editorState`

Response:

- `DraftBranchSaveResponse`

### `draft.branch.status.set`

Request:

- `workspaceId: string`
- `branchId: string`
- `status: "active" | "ready_to_publish" | "conflicted" | "published" | "obsolete" | "discarded"`

Response:

- `DraftBranchGetResponse`

### `draft.branch.discard`

Request:

- `workspaceId: string`
- `branchId: string`

Response:

- `DraftBranchGetResponse`

### `draft.branch.undo`

Request:

- `workspaceId: string`
- `branchId: string`

Response:

- `DraftBranchGetResponse`

### `draft.branch.redo`

Request:

- `workspaceId: string`
- `branchId: string`

Response:

- `DraftBranchGetResponse`

## Error behavior

- Missing required identifiers => `INVALID_REQUEST`
- Unknown workspace / locale variant / branch => `NOT_FOUND`
- Stale editor head on save => `INTERNAL_ERROR`
- Attempt to save discarded/obsolete branches => `INTERNAL_ERROR`
