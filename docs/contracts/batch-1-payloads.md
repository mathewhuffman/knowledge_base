# Batch 1 Payloads

## system.boot success
```json
{
  "ok": true,
  "data": {
    "workspaceRoot": "/Users/.../kb-vault-workspaces",
    "appVersion": "0.1.0",
    "environment": "development",
    "featureFlags": {
      "reviewWorkbenchV2": false,
      "mcpToolGuardrails": true,
      "strictHtmlValidation": false
    },
    "defaultWorkspaceRoot": "/Users/.../kb-vault-workspaces"
  },
  "requestId": "...",
  "timestamp": "2026-03-21T12:00:00.000Z"
}
```

## jobs.getActiveJobs success
```json
{
  "ok": true,
  "data": {
    "jobs": []
  }
}
```

## workspace.getWorkspaceRoot success
```json
{
  "ok": true,
  "data": {
    "workspaceRoot": "/Users/.../kb-vault-workspaces"
  }
}
```

## workspace.bootstrap progress event
```json
{
  "id": "...",
  "command": "workspace.bootstrap",
  "state": "RUNNING",
  "progress": 80,
  "message": "Using root /Users/.../kb-vault-workspaces"
}
```
