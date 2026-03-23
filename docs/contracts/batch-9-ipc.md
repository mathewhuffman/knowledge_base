# Batch 9 IPC Contract (Codex)

## Article AI

### `article.ai.get`

Request:

- `workspaceId: string`
- One of:
  - `branchId: string`
  - `localeVariantId: string`

Response:

- `ArticleAiSessionResponse`

### `article.ai.submit`

Request:

- `workspaceId: string`
- One of:
  - `branchId: string`
  - `localeVariantId: string`
- `message: string`
- Optional:
  - `presetAction`
  - `templatePackId`
  - `targetLocale`

Response:

- `ArticleAiSubmitResponse`

### `article.ai.reset`

Request:

- `workspaceId: string`
- `sessionId: string`

Response:

- `ArticleAiSessionResponse`

### `article.ai.accept`

Request:

- `workspaceId: string`
- `sessionId: string`

Response:

- `ArticleAiDecisionResponse`

### `article.ai.reject`

Request:

- `workspaceId: string`
- `sessionId: string`

Response:

- `ArticleAiDecisionResponse`

## Template Packs

### `template.pack.list`

Request:

- `workspaceId: string`
- Optional:
  - `includeInactive`

Response:

- `TemplatePackListResponse`

### `template.pack.get`

Request:

- `workspaceId: string`
- `templatePackId: string`

Response:

- `TemplatePackDetail`

### `template.pack.save`

Request:

- `workspaceId: string`
- `name: string`
- `language: string`
- `templateType`
- `promptTemplate: string`
- `toneRules: string`
- Optional:
  - `templatePackId`
  - `description`
  - `examples`
  - `active`

Response:

- `TemplatePackDetail`

### `template.pack.delete`

Request:

- `workspaceId: string`
- `templatePackId: string`

Response:

- `{ workspaceId, templatePackId }`

### `template.pack.analyze`

Request:

- `workspaceId: string`
- `templatePackId: string`

Response:

- `TemplatePackDetail`
