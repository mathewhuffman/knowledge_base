# Batch 2 IPC Contract

## IPC methods added in Codex batch 2
- `workspace.create`
- `workspace.list`
- `workspace.get`
- `workspace.open`
- `workspace.delete`
- `workspace.explorer.getTree`
- `workspace.search`
- `workspace.history.get`
- `workspace.repository.info`
- `workspace.route.get`
- `system.migrations.health`
- `workspace.settings.get`
- `workspace.settings.update`
- `articleFamily.list`
- `articleFamily.get`
- `articleFamily.create`
- `articleFamily.update`
- `articleFamily.delete`
- `localeVariant.list`
- `localeVariant.get`
- `localeVariant.create`
- `localeVariant.update`
- `localeVariant.delete`
- `revision.list`
- `revision.get`
- `revision.create`
- `revision.update`
- `revision.delete`

## Method payloads

### `workspace.create`
```ts
{
  name: string;
  zendeskSubdomain: string;
  zendeskBrandId?: string;
  defaultLocale: string;
  enabledLocales?: string[];
  path?: string;
}
```

Success:
```ts
{
  ok: true,
  data: WorkspaceRecord
}
```

### `workspace.list`
Success:
```ts
{
  ok: true,
  data: { workspaces: WorkspaceListItem[] }
}
```

### `workspace.get`
```ts
{ workspaceId: string }
```

### `workspace.open`
```ts
{ workspaceId: string }
```

### `workspace.explorer.getTree`
```ts
{ workspaceId: string }
```

### `workspace.search`
```ts
{
  workspaceId: string;
  query: string;
  locales?: string[];
  includeArchived?: boolean;
}
```

### `workspace.history.get`
```ts
{
  workspaceId: string;
  localeVariantId: string;
}
```

### `workspace.repository.info`
```ts
{ workspaceId: string }
```

### `workspace.route.get`
```ts
{ workspaceId: string }
```

### `system.migrations.health`
```ts
{
  workspaceId?: string
}
```

Success:
```ts
{
  ok: true,
  data: {
    catalogVersion: number;
    workspaceId: string | null;
    workspaces: Array<{
      workspaceId: string;
      workspacePath: string;
      catalogVersion: number;
      workspaceDbPath: string;
      workspaceDbVersion: number;
      repaired: boolean;
      exists: boolean;
    }>;
  }
}
```

### `workspace.settings.get`
```ts
{ workspaceId: string }
```

### `workspace.settings.update`
```ts
{
  workspaceId: string;
  zendeskSubdomain?: string;
  zendeskBrandId?: string;
  defaultLocale?: string;
  enabledLocales?: string[];
}
```

### `articleFamily.list`
```ts
{ workspaceId: string }
```

### `articleFamily.get`
```ts
{ workspaceId: string; familyId: string }
```

### `articleFamily.create`
```ts
{
  workspaceId: string;
  externalKey: string;
  title: string;
  sectionId?: string;
  categoryId?: string;
  retiredAtUtc?: string;
}
```

### `articleFamily.update`
```ts
{
  workspaceId: string;
  familyId: string;
  title?: string;
  sectionId?: string;
  categoryId?: string;
  retiredAtUtc?: string;
}
```

### `articleFamily.delete`
```ts
{ workspaceId: string; familyId: string }
```

### `localeVariant.list`
```ts
{ workspaceId: string }
```

### `localeVariant.get`
```ts
{ workspaceId: string; variantId: string }
```

### `localeVariant.create`
```ts
{
  workspaceId: string;
  familyId: string;
  locale: string;
  status?: 'live' | 'draft_branch' | 'obsolete' | 'retired';
  retiredAtUtc?: string;
}
```

### `localeVariant.update`
```ts
{
  workspaceId: string;
  variantId: string;
  locale?: string;
  status?: 'live' | 'draft_branch' | 'obsolete' | 'retired';
  retiredAtUtc?: string | null;
}
```

### `localeVariant.delete`
```ts
{ workspaceId: string; variantId: string }
```

### `revision.list`
```ts
{
  workspaceId: string;
  localeVariantId?: string;
}
```

### `revision.get`
```ts
{ workspaceId: string; revisionId: string }
```

### `revision.create`
```ts
{
  workspaceId: string;
  localeVariantId: string;
  revisionType: 'live' | 'draft_branch' | 'obsolete' | 'retired';
  branchId?: string;
  filePath: string;
  contentHash?: string;
  sourceRevisionId?: string;
  revisionNumber: number;
  status: 'open' | 'promoted' | 'failed' | 'deleted';
}
```

### `revision.update`
```ts
{
  workspaceId: string;
  revisionId: string;
  revisionType?: 'live' | 'draft_branch' | 'obsolete' | 'retired';
  branchId?: string;
  filePath?: string;
  contentHash?: string;
  sourceRevisionId?: string;
  revisionNumber?: number;
  status?: 'open' | 'promoted' | 'failed' | 'deleted';
}
```

### `revision.delete`
```ts
{ workspaceId: string; revisionId: string }
```

## Error handling
- Missing required payload fields: `INVALID_REQUEST`
- Workspace not found: `NOT_FOUND`
- Unexpected: `INTERNAL_ERROR`
