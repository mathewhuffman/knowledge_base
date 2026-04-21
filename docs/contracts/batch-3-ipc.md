# Batch 3 IPC Contract (Codex)

## IPC methods added in Codex batch 3
- `zendesk.credentials.get`
- `zendesk.credentials.save`
- `zendesk.connection.test`
- `zendesk.categories.list`
- `zendesk.sections.list`
- `zendesk.articles.search`
- `zendesk.sync.getLatest`
- `zendesk.sync.run` (job command)

## Method payloads

### `zendesk.credentials.get`
```ts
{
  workspaceId: string;
}
```

Success:
```ts
{
  ok: true,
  data: {
    workspaceId: string;
    email: string;
    hasApiToken: boolean;
  } | null
}
```

### `zendesk.credentials.save`
```ts
{
  workspaceId: string;
  email: string;
  apiToken: string;
}
```

Success:
```ts
{
  ok: true,
  data: {
    workspaceId: string;
    email: string;
    hasApiToken: true;
  }
}
```

### `zendesk.connection.test`
```ts
{
  workspaceId: string;
}
```

Success:
```ts
{
  ok: true,
  data: {
    ok: boolean;
    status: number;
    workspaceId: string;
    checkedAtUtc: string;
  }
}
```

### `zendesk.categories.list`
```ts
{
  workspaceId: string;
  locale: string;
}
```

Success:
```ts
{
  ok: true,
  data: Array<{
    id: number;
    name: string;
    position?: number;
    outdated?: boolean;
    updatedAtUtc?: string;
  }>
}
```

### `zendesk.sections.list`
```ts
{
  workspaceId: string;
  locale: string;
  categoryId: number;
}
```

Success:
```ts
{
  ok: true,
  data: Array<{
    id: number;
    name: string;
    categoryId?: number;
    position?: number;
    outdated?: boolean;
    updatedAtUtc?: string;
  }>
}
```

### `zendesk.articles.search`
```ts
{
  workspaceId: string;
  locale: string;
  query: string;
}
```

Success:
```ts
{
  ok: true,
  data: Array<{
    id: number;
    title: string;
    locale: string;
    sourceId?: number;
    sectionId?: number;
    categoryId?: number;
    updatedAtUtc: string;
  }>
}
```

### `zendesk.sync.getLatest`
```ts
{
  workspaceId: string;
}
```

Success:
```ts
{
  ok: true,
  data: {
    id: string;
    workspaceId: string;
    mode: 'full' | 'incremental';
    startedAtUtc: string;
    endedAtUtc?: string;
    state: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'QUEUED' | 'CANCELED' | 'PAUSED';
    syncedArticles: number;
    skippedArticles: number;
    createdFamilies: number;
    createdVariants: number;
    createdRevisions: number;
    cursorSummary?: Record<string, string>;
    remoteError?: string;
  } | null
}
```

### `zendesk.sync.run` job runner
`startJob` payload:
```ts
{
  workspaceId: string;
  mode: 'full' | 'incremental';
  locale?: string;
  force?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
  retryMaxDelayMs?: number;
}
```

### `zendesk.sync.run` event payload
```ts
{
  id: string;             // jobId
  command: 'zendesk.sync.run';
  state: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  progress: number;
  message?: string;
  startedAt?: string;
  endedAt?: string;
}
```

### `zendesk.sync.run` cancellation helper
`window.kbv.cancelJob(jobId)` payload:
```ts
{
  jobId: string;
}
```

```ts
{
  ok: true,
  data: {
    jobId: string;
    state: 'CANCELED';
  }
}
```

## Error payloads used by batch-3 methods
Typical errors map to standard `RpcResponse.error`:
```ts
{
  ok: false,
  error: {
    code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'NOT_AUTHORIZED' | 'INTERNAL_ERROR',
    message: string
  }
}
```

## Notes
- `zendesk.sync.run` stores locale cursor summary in `zendesk_sync_runs.cursor_summary`.
- Sync emits progress in job events and marks unseen locale variants as retired.
- Deletion/rename handling is implemented as metadata/title refresh plus retired variants for missing locale content.
- Job cancellation is available through `window.kbv.cancelJob(jobId)`.
