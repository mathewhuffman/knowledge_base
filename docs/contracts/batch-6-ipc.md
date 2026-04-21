# Batch 6 IPC Contract (Codex)

## IPC methods added in Codex batch 6
- `agent.health.check`
- `agent.session.create`
- `agent.session.list`
- `agent.session.get`
- `agent.session.close`
- `agent.transcript.get`
- `agent.tool.calls`
- `agent.analysis.run` (job command)
- `agent.article_edit.run` (job command)

## Method payloads

### `agent.health.check`
```ts
{}
```

### `agent.session.create`
```ts
{
  workspaceId: string;
  type: 'batch_analysis' | 'article_edit';
  batchId?: string;
  locale?: string;
  templatePackId?: string;
  scope?: {
    localeVariantIds?: string[];
    familyIds?: string[];
  }
}
```

### `agent.session.list`
```ts
{
  workspaceId: string;
  includeClosed?: boolean;
}
```

### `agent.session.get`
```ts
{
  workspaceId: string;
  sessionId: string;
}
```

### `agent.session.close`
```ts
{
  workspaceId: string;
  sessionId: string;
}
```

### `agent.transcript.get`
```ts
{
  workspaceId: string;
  sessionId: string;
  limit?: number;
}
```

### `agent.analysis.run` (job)
```ts
{
  workspaceId: string;
  batchId: string;
  locale?: string;
  sessionId?: string;
  sessionType?: 'batch_analysis' | 'article_edit';
  prompt?: string;
  systemPrompt?: string;
  templatePackId?: string;
  localeVariantScope?: string[];
  timeoutMs?: number;
}
```

### `agent.article_edit.run` (job)
```ts
{
  workspaceId: string;
  localeVariantId: string;
  locale?: string;
  sessionId?: string;
  sessionType?: 'batch_analysis' | 'article_edit';
  prompt?: string;
  timeoutMs?: number;
}
```

### `system.migrations.health` (hardening validation; existing command surfaced in batch-2)
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

- `workspaceId` can be omitted for a global health sweep.
- `repaired` is true when the workspace database was recreated/upgraded during health check.
- `exists` is true when the workspace database is present after the check.

## Job event payloads (streaming)
Job progress uses `JobEvent` with the `message` field containing JSON payload:
```json
{
  "kind": "session_started|progress|tool_call|tool_response|result|warning|error|timeout|canceled",
  "sessionId": "uuid",
  "atUtc": "2026-03-21T12:00:00.000Z",
  "data": {}
}
```

## Error examples
- `agent.analysis.run` missing required fields => `INVALID_REQUEST`
- session not found => `NOT_FOUND`
- malformed prompt payload => `INVALID_REQUEST`
- runtime unavailable => `INTERNAL_ERROR` or `NOT_AUTHORIZED` equivalent failure state in job event
