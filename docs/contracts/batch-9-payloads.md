# Batch 9 Payloads

## `article.ai.get`

```json
{
  "workspaceId": "ws_123",
  "session": {
    "id": "ai_session_1",
    "workspaceId": "ws_123",
    "localeVariantId": "lv_9",
    "branchId": "branch_4",
    "targetType": "draft_branch",
    "familyId": "family_2",
    "familyTitle": "Create & Edit Chat Channels",
    "locale": "en-us",
    "currentRevisionId": "rev_draft_11",
    "currentRevisionNumber": 11,
    "templatePackId": "tpl_1",
    "runtimeSessionId": "runtime_1",
    "status": "idle",
    "createdAtUtc": "2026-03-23T18:00:00.000Z",
    "updatedAtUtc": "2026-03-23T18:00:00.000Z"
  },
  "messages": [],
  "presets": [
    {
      "action": "rewrite_tone",
      "label": "Rewrite for tone",
      "description": "Adjust voice and clarity without changing core meaning."
    }
  ],
  "templatePacks": [
    {
      "id": "tpl_1",
      "workspaceId": "ws_123",
      "name": "Standard How-To",
      "language": "en-us",
      "templateType": "standard_how_to",
      "promptTemplate": "Write a task-focused help article...",
      "toneRules": "Use concise, direct instructions.",
      "active": true,
      "updatedAtUtc": "2026-03-23T18:00:00.000Z"
    }
  ]
}
```

## `article.ai.submit`

```json
{
  "workspaceId": "ws_123",
  "session": {
    "id": "ai_session_1",
    "workspaceId": "ws_123",
    "localeVariantId": "lv_9",
    "branchId": "branch_4",
    "targetType": "draft_branch",
    "familyId": "family_2",
    "familyTitle": "Create & Edit Chat Channels",
    "locale": "en-us",
    "currentRevisionId": "rev_draft_11",
    "currentRevisionNumber": 11,
    "status": "has_pending_edit",
    "createdAtUtc": "2026-03-23T18:00:00.000Z",
    "updatedAtUtc": "2026-03-23T18:03:00.000Z"
  },
  "messages": [
    {
      "id": "msg_user_1",
      "sessionId": "ai_session_1",
      "role": "user",
      "kind": "chat",
      "content": "Shorten the article and sharpen the intro.",
      "presetAction": "shorten",
      "createdAtUtc": "2026-03-23T18:03:00.000Z"
    },
    {
      "id": "msg_ai_1",
      "sessionId": "ai_session_1",
      "role": "assistant",
      "kind": "edit_result",
      "content": "Tightened the opening and simplified wording.",
      "createdAtUtc": "2026-03-23T18:03:05.000Z"
    }
  ],
  "pendingEdit": {
    "basedOnRevisionId": "rev_draft_11",
    "currentHtml": "<h1>Create & Edit Chat Channels</h1><p>Original intro.</p>",
    "proposedHtml": "<h1>Create & Edit Chat Channels</h1><p>Sharper intro.</p>",
    "previewHtml": "<h1>Create & Edit Chat Channels</h1><p>Sharper intro.</p>",
    "summary": "Tightened the opening and simplified wording.",
    "diff": {
      "beforeHtml": "<h1>Create & Edit Chat Channels</h1><p>Original intro.</p>",
      "afterHtml": "<h1>Create & Edit Chat Channels</h1><p>Sharper intro.</p>",
      "sourceDiff": { "lines": [] },
      "renderedDiff": { "blocks": [] },
      "changeRegions": [],
      "gutter": []
    },
    "updatedAtUtc": "2026-03-23T18:03:05.000Z"
  }
}
```

## `article.ai.accept`

```json
{
  "workspaceId": "ws_123",
  "acceptedBranchId": "branch_4",
  "acceptedRevisionId": "rev_draft_12",
  "session": {
    "id": "ai_session_1",
    "status": "idle",
    "branchId": "branch_4",
    "currentRevisionId": "rev_draft_12",
    "currentRevisionNumber": 12
  },
  "messages": [
    {
      "id": "msg_sys_2",
      "sessionId": "ai_session_1",
      "role": "system",
      "kind": "decision",
      "content": "Accepted AI edit into draft branch.",
      "createdAtUtc": "2026-03-23T18:05:00.000Z"
    }
  ]
}
```

## `template.pack.list`

```json
{
  "workspaceId": "ws_123",
  "templates": [
    {
      "id": "tpl_1",
      "workspaceId": "ws_123",
      "name": "Standard How-To",
      "language": "en-us",
      "templateType": "standard_how_to",
      "description": "Default step-by-step article structure.",
      "promptTemplate": "Write a task-focused help article...",
      "toneRules": "Use concise, direct instructions.",
      "active": true,
      "updatedAtUtc": "2026-03-23T18:00:00.000Z",
      "analysisSummary": "Strong template pack with clear generation guidance."
    }
  ]
}
```
