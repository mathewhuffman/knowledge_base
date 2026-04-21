# Batch 3 Payloads

## `zendesk.credentials.save` success
```json
{
  "ok": true,
  "data": {
    "workspaceId": "3f4be2dc-2b6c-4d0d-a8f8-9d7c2e8c7f4a",
    "email": "ops@example.com",
    "hasApiToken": true
  }
}
```

## `zendesk.credentials.get` success
```json
{
  "ok": true,
  "data": {
    "workspaceId": "3f4be2dc-2b6c-4d0d-a8f8-9d7c2e8c7f4a",
    "email": "ops@example.com",
    "hasApiToken": true
  }
}
```

## `zendesk.connection.test` success
```json
{
  "ok": true,
  "data": {
    "ok": true,
    "status": 200,
    "workspaceId": "3f4be2dc-2b6c-4d0d-a8f8-9d7c2e8c7f4a",
    "checkedAtUtc": "2026-03-21T14:08:10.000Z"
  }
}
```

## `zendesk.categories.list` success
```json
{
  "ok": true,
  "data": [
    { "id": 101, "name": "Getting Started", "position": 1 }
  ]
}
```

## `zendesk.sections.list` success
```json
{
  "ok": true,
  "data": [
    { "id": 1001, "name": "Billing", "categoryId": 101, "position": 2 }
  ]
}
```

## `zendesk.articles.search` success
```json
{
  "ok": true,
  "data": [
    {
      "id": 88901,
      "title": "How to update subscription billing",
      "locale": "en-us",
      "sourceId": 3344,
      "sectionId": 1001,
      "categoryId": 101,
      "updatedAtUtc": "2026-03-21T13:55:00.000Z"
    }
  ]
}
```

## `zendesk.sync.run` start job response
```json
{
  "ok": true,
  "data": {
    "jobId": "job-abc123"
  }
}
```

## `zendesk.sync.run` progress event stream
```json
{
  "id": "job-abc123",
  "command": "zendesk.sync.run",
  "state": "RUNNING",
  "progress": 35,
  "message": "en-us: Syncing locale",
  "startedAt": "2026-03-21T14:08:10.000Z"
}
```

## `zendesk.sync.run` running completion event
```json
{
  "id": "job-abc123",
  "command": "zendesk.sync.run",
  "state": "SUCCEEDED",
  "progress": 100,
  "message": "Sync complete. Synced 84 articles, skipped 12.",
  "startedAt": "2026-03-21T14:08:10.000Z",
  "endedAt": "2026-03-21T14:09:00.000Z"
}
```

## `zendesk.sync.run` cancellation
```json
{
  "ok": true,
  "data": {
    "jobId": "job-abc123",
    "state": "CANCELED"
  }
}
```

## `zendesk.sync.getLatest` success
```json
{
  "ok": true,
  "data": {
    "id": "sync-job-7f4b",
    "workspaceId": "3f4be2dc-2b6c-4d0d-a8f8-9d7c2e8c7f4a",
    "mode": "incremental",
    "startedAtUtc": "2026-03-21T14:08:10.000Z",
    "endedAtUtc": "2026-03-21T14:09:00.000Z",
    "state": "SUCCEEDED",
    "syncedArticles": 84,
    "skippedArticles": 12,
    "createdFamilies": 1,
    "createdVariants": 2,
    "createdRevisions": 84,
    "cursorSummary": {
      "en-us": "cursor-1"
    }
  }
}
```

## Error example
```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Zendesk credentials are not configured for this workspace"
  }
}
```
