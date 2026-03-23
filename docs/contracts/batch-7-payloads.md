# Batch 7 Payloads

## `proposal.review.list`

```json
{
  "workspaceId": "ws_123",
  "batchId": "batch_42",
  "batchStatus": "review_in_progress",
  "summary": {
    "total": 2,
    "pendingReview": 1,
    "accepted": 0,
    "denied": 1,
    "deferred": 0,
    "appliedToBranch": 0,
    "archived": 0
  },
  "queue": [
    {
      "proposalId": "prop_1",
      "queueOrder": 1,
      "action": "edit",
      "reviewStatus": "pending_review",
      "articleKey": "locale:lv_1",
      "articleLabel": "Create & Edit Chat Channels",
      "locale": "en-us",
      "confidenceScore": 0.88,
      "rationaleSummary": "Reflect the new dashboard assignment path.",
      "relatedPbiCount": 2
    }
  ],
  "groups": [
    {
      "articleKey": "locale:lv_1",
      "articleLabel": "Create & Edit Chat Channels",
      "locale": "en-us",
      "proposalIds": ["prop_1"],
      "total": 1,
      "actions": ["edit"]
    }
  ]
}
```

## `proposal.review.get`

```json
{
  "workspaceId": "ws_123",
  "batchId": "batch_42",
  "batchStatus": "review_in_progress",
  "proposal": {
    "id": "prop_1",
    "workspaceId": "ws_123",
    "batchId": "batch_42",
    "action": "edit",
    "reviewStatus": "pending_review",
    "targetTitle": "Create & Edit Chat Channels",
    "targetLocale": "en-us",
    "confidenceScore": 0.88,
    "rationaleSummary": "Reflect the new dashboard assignment path.",
    "aiNotes": "Steps 2-4 need updates.",
    "queueOrder": 1,
    "generatedAtUtc": "2026-03-22T18:30:00.000Z",
    "updatedAtUtc": "2026-03-22T18:30:00.000Z"
  },
  "relatedPbis": [
    {
      "id": "pbi_101",
      "batchId": "batch_42",
      "sourceRowNumber": 1,
      "externalId": "101",
      "title": "Dashboard Assignment",
      "description": "Document the new dashboard assignment flow"
    }
  ],
  "diff": {
    "beforeHtml": "<p>Old assignment flow.</p>",
    "afterHtml": "<p>New assignment flow.</p>",
    "sourceDiff": {
      "lines": [
        {
          "kind": "removed",
          "lineNumberBefore": 1,
          "content": "<p>Old assignment flow.</p>"
        },
        {
          "kind": "added",
          "lineNumberAfter": 1,
          "content": "<p>New assignment flow.</p>"
        }
      ]
    },
    "renderedDiff": {
      "blocks": [
        {
          "kind": "removed",
          "beforeText": "Old assignment flow."
        },
        {
          "kind": "added",
          "afterText": "New assignment flow."
        }
      ]
    },
    "changeRegions": [
      {
        "id": "region-1",
        "kind": "changed",
        "label": "Changed region 1",
        "beforeText": "<p>Old assignment flow.</p>",
        "afterText": "<p>New assignment flow.</p>",
        "beforeLineStart": 1,
        "beforeLineEnd": 1,
        "afterLineStart": 1,
        "afterLineEnd": 1
      }
    ],
    "gutter": [
      {
        "lineNumber": 1,
        "kind": "changed",
        "regionId": "region-1",
        "side": "before"
      },
      {
        "lineNumber": 1,
        "kind": "changed",
        "regionId": "region-1",
        "side": "after"
      }
    ]
  },
  "navigation": {
    "currentIndex": 0,
    "total": 1
  }
}
```

## `proposal.review.decide`

```json
{
  "workspaceId": "ws_123",
  "batchId": "batch_42",
  "proposalId": "prop_1",
  "reviewStatus": "accepted",
  "batchStatus": "review_complete",
  "branchId": "branch_7",
  "revisionId": "rev_11",
  "familyId": "family_9",
  "localeVariantId": "lv_1",
  "summary": {
    "total": 1,
    "pendingReview": 0,
    "accepted": 1,
    "denied": 0,
    "deferred": 0,
    "appliedToBranch": 0,
    "archived": 0
  }
}
```
