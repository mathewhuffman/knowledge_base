# Batch 2 Payloads

## workspace.create success
```json
{
  "ok": true,
  "data": {
    "id": "3f4be2dc-2b6c-4d0d-a8f8-9d7c2e8c7f4a",
    "name": "Acme Help Center",
    "createdAtUtc": "2026-03-21T10:00:00.000Z",
    "updatedAtUtc": "2026-03-21T10:00:00.000Z",
    "lastOpenedAtUtc": "2026-03-21T10:00:00.000Z",
    "zendeskConnectionId": "5f7d2e77-3c77-4e1d-9b17-56ab1c6e90f5",
    "defaultLocale": "en-us",
    "enabledLocales": ["en-us", "es-es"],
    "state": "active",
    "path": "/Users/.../kb-vault-workspaces/acme-help-center"
  }
}
```

## workspace.explorer.getTree success
```json
{
  "ok": true,
  "data": {
    "workspaceId": "3f4be2dc-2b6c-4d0d-a8f8-9d7c2e8c7f4a",
    "nodes": [
      {
        "familyId": "family-01",
        "title": "Getting Started",
        "familyStatus": "live",
        "locales": [
          {
            "locale": "en-us",
            "revision": {
              "revisionId": "rev-1001",
              "revisionNumber": 14,
              "state": "live",
              "updatedAtUtc": "2026-03-20T14:08:10.000Z",
              "draftCount": 2
            },
            "hasConflicts": false
          }
        ]
      }
    ]
  }
}
```

## workspace.search success
```json
{
  "ok": true,
  "data": {
    "workspaceId": "3f4be2dc-2b6c-4d0d-a8f8-9d7c2e8c7f4a",
    "total": 1,
    "results": [
      {
        "revisionId": "rev-1001",
        "familyId": "family-01",
        "locale": "en-us",
        "title": "Getting Started",
        "snippet": "Getting Started · PBI mapping",
        "score": 0.92
      }
    ]
  }
}
```

## workspace.repository.info success
```json
{
  "ok": true,
  "data": {
    "workspaceId": "3f4be2dc-2b6c-4d0d-a8f8-9d7c2e8c7f4a",
    "rootPath": "/Users/.../kb-vault-workspaces/acme-help-center",
    "dbPath": "/Users/.../kb-vault-workspaces/acme-help-center/.meta/kb-vault.sqlite",
    "storage": {
      "root": "/Users/.../kb-vault-workspaces/acme-help-center",
      "articles": "/Users/.../acme-help-center/articles",
      "drafts": "/Users/.../acme-help-center/drafts",
      "revisions": "/Users/.../acme-help-center/revisions",
      "imports": "/Users/.../acme-help-center/imports",
      "proposals": "/Users/.../acme-help-center/proposals",
      "runs": "/Users/.../acme-help-center/runs",
      "assets": "/Users/.../acme-help-center/assets",
      "cache": "/Users/.../acme-help-center/cache",
      "searchIndex": "/Users/.../acme-help-center/search-index"
    }
  }
}
```

## `system.migrations.health` success
```json
{
  "ok": true,
  "data": {
    "catalogVersion": 1,
    "workspaceId": null,
    "workspaces": [
      {
        "workspaceId": "3f4be2dc-2b6c-4d0d-a8f8-9d7c2e8c7f4a",
        "workspacePath": "/Users/.../kb-vault-workspaces/acme-help-center",
        "catalogVersion": 1,
        "workspaceDbPath": "/Users/.../acme-help-center/.meta/kb-vault.sqlite",
        "workspaceDbVersion": 1,
        "repaired": false,
        "exists": true
      }
    ]
  }
}
```

## `workspace.settings.get` success
```json
{
  "ok": true,
  "data": {
    "workspaceId": "3f4be2dc-2b6c-4d0d-a8f8-9d7c2e8c7f4a",
    "zendeskSubdomain": "acmehelp",
    "zendeskBrandId": "brand-001",
    "defaultLocale": "en-us",
    "enabledLocales": ["en-us", "es-es"]
  }
}
```

## `articleFamily.create` success
```json
{
  "ok": true,
  "data": {
    "id": "family-01",
    "workspaceId": "3f4be2dc-2b6c-4d0d-a8f8-9d7c2e8c7f4a",
    "externalKey": "getting_started",
    "title": "Getting Started",
    "sectionId": "section-01",
    "categoryId": "cat-01",
    "retiredAtUtc": null
  }
}
```

## `revision.update` success
```json
{
  "ok": true,
  "data": {
    "id": "rev-1001",
    "localeVariantId": "variant-01",
    "workspaceId": "3f4be2dc-2b6c-4d0d-a8f8-9d7c2e8c7f4a",
    "revisionType": "live",
    "branchId": null,
    "filePath": "/Users/.../revisions/en-us/getting-started.json",
    "contentHash": "sha256:...",
    "sourceRevisionId": null,
    "revisionNumber": 15,
    "status": "promoted",
    "createdAtUtc": "2026-03-20T14:00:00.000Z",
    "updatedAtUtc": "2026-03-21T09:10:00.000Z"
  }
}
```
