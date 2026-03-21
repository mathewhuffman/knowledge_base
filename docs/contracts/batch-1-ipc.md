# Batch 1 IPC Contract

## IPC channels
- `kbv:invoke` (request/response)
- `kbv:job:invoke` (job start)
- `kbv:job:event` (subscription updates)

## Shared result envelope
All invoke responses must match:

- `ok: boolean`
- `data?: any`
- `error?: { code, message, details? }`
- `requestId?: string`
- `timestamp?: string`

## Registered methods
- `system.boot`
- `system.ping`
- `system.migrations.health`
- `workspace.getRouteConfig`
- `workspace.getWorkspaceRoot`
- `jobs.getActiveJobs`

## Job commands
- `workspace.bootstrap`

## Job event envelope
- `id`
- `command`
- `state` (`QUEUED` | `RUNNING` | `SUCCEEDED` | `FAILED` | `CANCELED` | `PAUSED`)
- `progress` (0..100)
- `message?`
- `startedAt?`
- `endedAt?`
