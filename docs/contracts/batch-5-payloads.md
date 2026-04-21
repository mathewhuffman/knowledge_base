# Batch 5 Payloads

## `pbiBatch.import` success
```json
{
  "ok": true,
  "data": {
    "batch": {
      "id": "9f3d9a7b-9d3d-4f55-9e1f-3b4a2cc1f9c1",
      "workspaceId": "ws-123",
      "name": "adobe-ado-export",
      "sourceFileName": "pbi-export.csv",
      "sourceRowCount": 124,
      "sourcePath": "imports/8d2.../pbi-export.csv",
      "sourceFormat": "csv",
      "candidateRowCount": 102,
      "ignoredRowCount": 8,
      "malformedRowCount": 5,
      "duplicateRowCount": 9,
      "scopedRowCount": 95,
      "scopeMode": "all_except_selected",
      "scopePayload": "{\"selectedSourceRowNumbers\":[4,8],\"selectedExternalIds\":[\"\"]}",
      "importedAtUtc": "2026-03-21T20:10:00.000Z",
      "status": "scoped"
    },
    "summary": {
      "totalRows": 124,
      "candidateRowCount": 102,
      "malformedRowCount": 5,
      "duplicateRowCount": 9,
      "ignoredRowCount": 8,
      "scopedRowCount": 95
    },
    "invalidRows": [
      { "id": "r1", "batchId": "9f3d9a7b-9d3d-4f55-9e1f-3b4a2cc1f9c1", "sourceRowNumber": 11, "externalId": "T-101", "title": "Build release validation flow", "validationStatus": "ignored", "validationReason": "Rule-based technical ignore" }
    ],
    "duplicateRows": [
      { "id": "r2", "batchId": "9f3d9a7b-9d3d-4f55-9e1f-3b4a2cc1f9c1", "sourceRowNumber": 27, "externalId": "T-201", "title": "Help text update", "validationStatus": "duplicate", "validationReason": "Duplicate external id" }
    ],
    "ignoredRows": [
      { "id": "r3", "batchId": "9f3d9a7b-9d3d-4f55-9e1f-3b4a2cc1f9c1", "sourceRowNumber": 11, "externalId": "T-101", "title": "Build release validation flow", "validationStatus": "ignored", "validationReason": "Rule-based technical ignore" }
    ]
  }
}
```

## `pbiBatch.getPreflight` success
```json
{
  "ok": true,
  "data": {
    "batch": {
      "id": "9f3d9a7b-9d3d-4f55-9e1f-3b4a2cc1f9c1",
      "workspaceId": "ws-123",
      "name": "adobe-ado-export",
      "scopeMode": "selected_only",
      "scopedRowCount": 18
    },
    "candidateRows": [
      { "sourceRowNumber": 4, "externalId": "T-10", "title": "Customer can reopen closed tickets", "state": "candidate" }
    ],
    "invalidRows": [
      { "sourceRowNumber": 11, "externalId": "", "title": "", "validationStatus": "malformed", "validationReason": "Missing external id or title" }
    ],
    "duplicateRows": [
      { "sourceRowNumber": 22, "externalId": "T-14", "title": "Duplicate pbi title" }
    ],
    "ignoredRows": [
      { "sourceRowNumber": 39, "externalId": "T-31", "title": "CI Pipeline baseline" , "validationStatus": "ignored" }
    ],
    "scopePayload": {
      "batchId": "9f3d9a7b-9d3d-4f55-9e1f-3b4a2cc1f9c1",
      "workspaceId": "ws-123",
      "mode": "selected_only",
      "scopedRowNumbers": [4, 7, 12],
      "scopedCount": 3,
      "updatedAtUtc": "2026-03-21T20:12:00.000Z"
    },
    "candidateTitles": [
      "Customer can reopen closed tickets",
      "Invoice exports show wrong totals",
      "Article search highlights missing image thumbnails"
    ]
  }
}
```

## `pbiBatch.scope.set` success
```json
{
  "ok": true,
  "data": {
    "batch": {
      "id": "9f3d9a7b-9d3d-4f55-9e1f-3b4a2cc1f9c1",
      "scopeMode": "all_except_selected",
      "scopedRowCount": 93
    },
    "scope": {
      "mode": "all_except_selected",
      "selectedRows": [4, 11],
      "selectedExternalIds": ["T-10"],
      "scopedRowNumbers": [1, 2, 3],
      "scopedCount": 93,
      "updatedAtUtc": "2026-03-21T20:14:00.000Z"
    }
  }
}
```

## `pbiBatch.setStatus` success
```json
{
  "ok": true,
  "data": {
    "batch": {
      "id": "9f3d9a7b-9d3d-4f55-9e1f-3b4a2cc1f9c1",
      "workspaceId": "ws-123",
      "name": "adobe-ado-export",
      "scopeMode": "selected_only",
      "status": "submitted",
      "scopedRowCount": 18
    }
  }
}
```

## `pbiBatch.setStatus` error
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Cannot transition batch status from 'imported' to 'analyzed'"
  }
}
```

## Error example
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "pbiBatch.scope.set mode must be all|all_except_selected|selected_only"
  }
}
```
