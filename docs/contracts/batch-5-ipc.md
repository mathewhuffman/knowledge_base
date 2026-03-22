# Batch 5 IPC Contract (Codex)

## IPC methods added in Codex batch 5
- `pbiBatch.import`
- `pbiBatch.list`
- `pbiBatch.get`
- `pbiBatch.rows.list`
- `pbiBatch.scope.set`
- `pbiBatch.setStatus`
- `pbiBatch.getPreflight`

## Method payloads

### `pbiBatch.import`
```ts
{
  workspaceId: string;
  batchName?: string;
  sourceFileName: string;
  sourcePath?: string;
  sourceContent?: string;
  sourceFormat?: 'csv' | 'html';
  fieldMapping?: {
    externalId: string;
    title: string;
    description: string;
    acceptanceCriteria?: string;
    priority?: string;
    type?: string;
    parentExternalId?: string;
  };
  scope?: {
    mode?: 'all' | 'all_except_selected' | 'selected_only';
    selectedRows?: number[];
    selectedExternalIds?: string[];
  };
}
```

Success:
```ts
{
  ok: true,
  data: {
    batch: PBIBatchRecord;
    rows: PBIRecord[];
    summary: {
      totalRows: number;
      candidateRowCount: number;
      malformedRowCount: number;
      duplicateRowCount: number;
      ignoredRowCount: number;
      scopedRowCount: number;
    };
    invalidRows: PBIRecord[];
    duplicateRows: PBIRecord[];
    ignoredRows: PBIRecord[];
  }
}
```

### `pbiBatch.list`
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
    batches: PBIBatchRecord[];
  }
}
```

### `pbiBatch.get`
```ts
{
  workspaceId: string;
  batchId: string;
}
```

Success:
```ts
{
  ok: true,
  data: {
    workspaceId: string;
    batch: PBIBatchRecord;
  }
}
```

### `pbiBatch.rows.list`
```ts
{
  workspaceId: string;
  batchId: string;
  validationStatuses?: Array<'candidate' | 'malformed' | 'duplicate' | 'ignored'>;
}
```

Success:
```ts
{
  ok: true,
  data: {
    workspaceId: string;
    batchId: string;
    rows: PBIRecord[];
  }
}
```

### `pbiBatch.scope.set`
```ts
{
  workspaceId: string;
  batchId: string;
  mode: 'all' | 'all_except_selected' | 'selected_only';
  selectedRows?: number[];
  selectedExternalIds?: string[];
}
```

Success:
```ts
{
  ok: true,
  data: {
    batch: PBIBatchRecord;
    scope: {
      batchId: string;
      workspaceId: string;
      mode: 'all' | 'all_except_selected' | 'selected_only';
      selectedRows?: number[];
      selectedExternalIds?: string[];
      scopedRowNumbers?: number[];
      scopedCount?: number;
      updatedAtUtc: string;
    };
  }
}
```

### `pbiBatch.setStatus`
```ts
{
  workspaceId: string;
  batchId: string;
  status:
    | 'imported'
    | 'scoped'
    | 'submitted'
    | 'analyzed'
    | 'review_in_progress'
    | 'review_complete'
    | 'archived';
  force?: boolean;
}
```

Success:
```ts
{
  ok: true,
  data: {
    batch: PBIBatchRecord;
  }
}
```

### `pbiBatch.getPreflight`
```ts
{
  workspaceId: string;
  batchId: string;
}
```

Success:
```ts
{
  ok: true,
  data: {
    batch: PBIBatchRecord;
    candidateRows: PBIRecord[];
    invalidRows: PBIRecord[];
    duplicateRows: PBIRecord[];
    ignoredRows: PBIRecord[];
    scopePayload: {
      batchId: string;
      workspaceId: string;
      mode: 'all' | 'all_except_selected' | 'selected_only';
      selectedRows?: number[];
      selectedExternalIds?: string[];
      scopedRowNumbers?: number[];
      scopedCount?: number;
      updatedAtUtc: string;
    };
    candidateTitles: string[];
  }
}
```

## Errors
- Standard `RpcResponse.error` object from shared types is used:
- `INVALID_REQUEST` for missing params, unsupported scope mode/status, or parsing failures
- `NOT_FOUND` for unknown workspace or batch
- `INVALID_REQUEST` for invalid status transition attempts
- `INTERNAL_ERROR` for unexpected failures
