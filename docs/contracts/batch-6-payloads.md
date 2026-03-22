# Batch 6 Payloads

## `agent.health.check` success
```json
{
  "ok": true,
  "data": {
    "checkedAtUtc": "2026-03-21T21:00:00.000Z",
    "cursorInstalled": true,
    "acpReachable": false,
    "mcpRunning": true,
    "requiredConfigPresent": true,
    "cursorBinaryPath": "cursor",
    "issues": ["Cursor process did not initialize"],
    "workspaceId": "ws-123"
  }
}
```

## `agent.session.create` success
```json
{
  "ok": true,
  "data": {
    "id": "a1c5f2dd-2b4a-4f67-9f4a-f8f0e9bd1a7c",
    "workspaceId": "ws-123",
    "type": "batch_analysis",
    "status": "idle",
    "batchId": "b-456",
    "locale": "en-US",
    "templatePackId": "tpl-1",
    "createdAtUtc": "2026-03-21T21:01:12.100Z",
    "updatedAtUtc": "2026-03-21T21:01:12.100Z"
  }
}
```

## `agent.session.list` success
```json
{
  "ok": true,
  "data": {
    "workspaceId": "ws-123",
    "sessions": [
      { "id": "a1c5...", "type": "batch_analysis", "status": "running" }
    ]
  }
}
```

## `agent.analysis.run` job stream snapshot
```json
{
  "command": "agent.analysis.run",
  "state": "RUNNING",
  "progress": 35,
  "message": "{\"kind\":\"result\",\"sessionId\":\"a1c5...\"}"
}
```

## `agent.session.create` error
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "agent.session.create requires workspaceId"
  }
}
```

## Transcript payload
```json
{
  "ok": true,
  "data": {
    "workspaceId": "ws-123",
    "sessionId": "a1c5...",
    "lines": [
      {
        "atUtc": "2026-03-21T21:01:15.101Z",
        "direction": "to_agent",
        "event": "request",
        "payload": "{ \"jsonrpc\": \"2.0\", ... }"
      }
    ]
  }
}
```
