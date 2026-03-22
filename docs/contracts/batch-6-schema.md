# Batch 6 Schema (Domain model)

No new tables were required for this batch. New in-memory runtime contracts were introduced in `@kb-vault/shared-types`:

- `AgentSessionRecord`
- `AgentSessionCreateRequest`
- `AgentSessionListRequest`
- `AgentSessionGetRequest`
- `AgentSessionCloseRequest`
- `AgentAnalysisRunRequest`
- `AgentArticleEditRunRequest`
- `AgentHealthCheckResponse`
- `AgentTranscriptRequest`
- `AgentTranscriptLine`
- `AgentTranscriptResponse`
- `AgentRunResult`
- `AgentStreamingPayload`
- `AgentToolCallAudit`
- MCP tool request shape interfaces:
  - `MCPGetArticleFamilyInput`
  - `MCPGetArticleInput`
  - `MCPGetLocaleVariantInput`
  - `MCPGetArticleHistoryInput`
  - `MCPGetBatchContextInput`
  - `MCPGetPBIInput`
  - `MCPGetPBISubsetInput`
  - `MCPListCategoriesInput`
  - `MCPListSectionsInput`
  - `MCPListArticleTemplatesInput`
  - `MCPRecordAgentNotesInput`
  - `MCPFindRelatedArticlesInput`
- `MCPGetTemplateInput`

## Runtime behavior introduced
- Session registry with per-workspace isolation.
- Transcript persistence in `.meta/agent-transcripts/<session-id>/<run-id>.jsonl`.
- Tool-call audit trail attached to runtime.
- Cursor command/process health check and fallback states.
- JSON-RPC message transport layer with request/retry/cancellation paths.
- MCP tool registry in `@kb-vault/mcp-server` with the required tool names and JSON-RPC `tools/list`, `tools/call` support.
- MCP `propose_*` calls now write proposal rows into local `proposals` (+ `proposal_pbi_links`) tables.
- `list_categories` and `list_sections` MCP implementations resolve through workspace Zendesk credentials where available.
