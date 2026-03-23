# Batch 8 Payloads

## `draft.branch.list`

```json
{
  "workspaceId": "ws_123",
  "summary": {
    "total": 2,
    "active": 1,
    "readyToPublish": 1,
    "conflicted": 0,
    "obsolete": 0,
    "discarded": 0
  },
  "branches": [
    {
      "id": "branch_1",
      "workspaceId": "ws_123",
      "familyId": "family_9",
      "familyTitle": "Create & Edit Chat Channels",
      "localeVariantId": "lv_1",
      "locale": "en-us",
      "name": "Create & Edit Chat Channels Draft 2",
      "status": "active",
      "legacyState": "active",
      "baseRevisionId": "rev_live_7",
      "baseRevisionNumber": 7,
      "headRevisionId": "rev_draft_8",
      "headRevisionNumber": 8,
      "liveRevisionId": "rev_live_7",
      "liveRevisionNumber": 7,
      "createdAtUtc": "2026-03-23T15:10:00.000Z",
      "updatedAtUtc": "2026-03-23T15:14:00.000Z",
      "lastManualSaveAtUtc": "2026-03-23T15:14:00.000Z",
      "changeSummary": "Live diff: 1 changed region",
      "validationSummary": {
        "total": 0,
        "errors": 0,
        "warnings": 0,
        "infos": 0
      }
    }
  ]
}
```

## `draft.branch.get`

```json
{
  "workspaceId": "ws_123",
  "branch": {
    "id": "branch_1",
    "workspaceId": "ws_123",
    "familyId": "family_9",
    "familyTitle": "Create & Edit Chat Channels",
    "localeVariantId": "lv_1",
    "locale": "en-us",
    "name": "Create & Edit Chat Channels Draft 2",
    "status": "ready_to_publish",
    "baseRevisionId": "rev_live_7",
    "baseRevisionNumber": 7,
    "headRevisionId": "rev_draft_9",
    "headRevisionNumber": 9,
    "liveRevisionId": "rev_live_7",
    "liveRevisionNumber": 7,
    "createdAtUtc": "2026-03-23T15:10:00.000Z",
    "updatedAtUtc": "2026-03-23T15:21:00.000Z",
    "lastAutosavedAtUtc": "2026-03-23T15:18:00.000Z",
    "lastManualSaveAtUtc": "2026-03-23T15:21:00.000Z",
    "changeSummary": "Live diff: 1 changed region",
    "validationSummary": {
      "total": 1,
      "errors": 0,
      "warnings": 1,
      "infos": 0
    }
  },
  "editor": {
    "html": "<h1>Create & Edit Chat Channels</h1><p>Updated flow.</p>",
    "previewHtml": "<h1>Create & Edit Chat Channels</h1><p>Updated flow.</p>",
    "compare": {
      "liveHtml": "<h1>Create & Edit Chat Channels</h1><p>Old flow.</p>",
      "draftHtml": "<h1>Create & Edit Chat Channels</h1><p>Updated flow.</p>",
      "diff": {
        "beforeHtml": "<h1>Create & Edit Chat Channels</h1><p>Old flow.</p>",
        "afterHtml": "<h1>Create & Edit Chat Channels</h1><p>Updated flow.</p>",
        "sourceDiff": {
          "lines": [
            { "kind": "removed", "lineNumberBefore": 1, "content": "<h1>Create & Edit Chat Channels</h1><p>Old flow.</p>" },
            { "kind": "added", "lineNumberAfter": 1, "content": "<h1>Create & Edit Chat Channels</h1><p>Updated flow.</p>" }
          ]
        },
        "renderedDiff": {
          "blocks": [
            { "kind": "removed", "beforeText": "Create & Edit Chat Channels Old flow." },
            { "kind": "added", "afterText": "Create & Edit Chat Channels Updated flow." }
          ]
        },
        "changeRegions": [
          {
            "id": "region-1",
            "kind": "changed",
            "label": "Changed region 1",
            "beforeText": "<h1>Create & Edit Chat Channels</h1><p>Old flow.</p>",
            "afterText": "<h1>Create & Edit Chat Channels</h1><p>Updated flow.</p>",
            "beforeLineStart": 1,
            "beforeLineEnd": 1,
            "afterLineStart": 1,
            "afterLineEnd": 1
          }
        ],
        "gutter": [
          { "lineNumber": 1, "kind": "changed", "regionId": "region-1", "side": "before" },
          { "lineNumber": 1, "kind": "changed", "regionId": "region-1", "side": "after" }
        ]
      }
    },
    "validationWarnings": [
      {
        "code": "unresolved_placeholder",
        "severity": "warning",
        "message": "Draft contains unresolved placeholder content.",
        "detail": "Screenshot of dashboard assignment"
      }
    ],
    "autosave": {
      "enabled": true,
      "status": "saved",
      "lastAutosavedAtUtc": "2026-03-23T15:18:00.000Z",
      "lastManualSaveAtUtc": "2026-03-23T15:21:00.000Z",
      "pendingChanges": false
    },
    "history": [
      {
        "revisionId": "rev_draft_9",
        "revisionNumber": 9,
        "sourceRevisionId": "rev_draft_8",
        "source": "manual",
        "summary": "Refined dashboard assignment steps",
        "createdAtUtc": "2026-03-23T15:21:00.000Z",
        "updatedAtUtc": "2026-03-23T15:21:00.000Z",
        "isCurrent": true
      }
    ],
    "capabilities": {
      "preferredEditor": "monaco",
      "previewSync": true,
      "compareAgainstLive": true,
      "undoRedo": true
    }
  }
}
```

## `draft.branch.save`

```json
{
  "workspaceId": "ws_123",
  "branch": {
    "id": "branch_1",
    "status": "active",
    "headRevisionId": "rev_draft_10",
    "headRevisionNumber": 10,
    "changeSummary": "Live diff: 2 changed regions",
    "validationSummary": {
      "total": 1,
      "errors": 1,
      "warnings": 0,
      "infos": 0
    }
  },
  "editor": {
    "autosave": {
      "enabled": true,
      "status": "saved",
      "lastManualSaveAtUtc": "2026-03-23T15:30:00.000Z",
      "pendingChanges": false
    }
  }
}
```
