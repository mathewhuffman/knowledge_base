# KB Vault — Project Breakdown
**Version:** 1.0  
**Date:** 2026-03-21  
**Status:** Planning baseline  
**Product module:** KB Vault  
**App shell:** Modular desktop app with KB Vault as the first module

---

## 1. Product definition

KB Vault is a **local-first Electron desktop application** for automating the maintenance and creation of Zendesk knowledge base articles from bulk Product Backlog Item uploads.

The core job of the product is to close the gap between product change and customer documentation:

1. Pull live Zendesk help center content into a local workspace.
2. Import a bulk CSV batch of PBIs from Azure DevOps.
3. Package the batch and selected article context for an LLM running through **Cursor ACP**.
4. Give that LLM controlled access to local KB tools through **MCP**.
5. Receive structured proposals for:
   - new KB article creation,
   - edits to existing articles,
   - retirement of obsolete articles,
   - or no-impact decisions.
6. Present those proposals in a high-trust review flow.
7. Let the user accept or deny each proposal one at a time.
8. Convert accepted proposals into draft branches.
9. Let the user refine drafts manually or with additional LLM assistance.
10. Push selected drafts back to Zendesk.
11. Promote the published draft to the new live local version and close the active draft branch.

This product is **not** a dashboard-centric content tracker. It is a **workflow engine for doc maintenance and article generation**.

---

## 2. Product vision

### 2.1 Vision statement
Create a secure, local-first documentation operations workspace that turns bulk product change input into reviewed, publish-ready Zendesk KB updates with minimal missed coverage and minimal manual triage.

### 2.2 Primary outcomes
The product is successful when it materially improves:

- **Automatic doc coverage**
- **Fewer missed article updates**
- **More current KB content**
- **Higher review quality before publish**
- **Safer and more structured AI usage under enterprise policy**

### 2.3 Primary users
The first intended users are:

- Product Managers
- Technical Writers
- Product Operations

### 2.4 Product principles
1. **Local-first always**
   - All content, state, history, prompts, and proposal review data live on the user’s machine.
   - No cloud app backend is required for the core product.
2. **Cursor is an engine, not a user-facing dependency**
   - The user should not need to manually interact with Cursor.
   - KB Vault talks to Cursor programmatically through ACP.
3. **AI never publishes directly**
   - AI proposes. Humans accept or deny.
4. **Zendesk is the source of live production truth; KB Vault is the source of working truth**
   - Live articles reflect what is currently published.
   - Draft branches represent proposed local changes not yet live.
5. **Security is a feature**
   - The product must feel safe to use with real internal product data.
6. **Review quality is more important than raw generation speed**
   - The core UX is the proposal review experience.
7. **Modular product architecture**
   - KB Vault is the first module inside a larger local-first artifact automation platform.

---

## 3. Scope of this project

This project covers the full KB Vault module, including:

- Local workspace management
- Zendesk knowledge base sync
- Bulk CSV PBI import and parsing
- Scoped article selection and exclusion controls for AI processing
- Cursor ACP integration for persistent LLM sessions
- MCP tool server for KB-aware tool calls
- Proposal generation for create/edit/retire/no-impact
- Proposal review UX with rendered preview, rendered diff, and source diff
- Draft branch creation and management
- Manual editing and article-level AI editing
- Publish selected drafts to Zendesk
- Conflict detection and conflict resolution workflow
- English and Spanish article support
- Local version history and publish history
- Prompt/template management for KB article generation

---

## 4. Explicit non-goals for v1

The following are intentionally out of scope for the first implementation:

- Multi-user cloud collaboration
- Team sharing or shared remote environments
- Analytics dashboard or executive reporting dashboard
- General-purpose release notes automation
- Non-Zendesk help center targets
- Ticket integration
- External SaaS orchestration backend
- AI auto-publish with no human review
- Broad enterprise admin console
- Full revision-control semantics beyond the article/draft/history model defined here

The app should be **architected for future expansion**, but the implementation should stay focused on KB maintenance and creation from bulk PBI uploads.

---

## 5. Product shape

### 5.1 App model
This is a **desktop Electron app** with a modular left navigation.  
The first implemented module is **KB Vault**.

Future modules can reuse:

- workspace infrastructure,
- file explorer and content viewer,
- version history model,
- ACP/MCP orchestration,
- proposal review framework,
- publishing pipeline.

### 5.2 Workspace model
The app supports **multiple local workspaces**.

Each workspace represents:

- one local environment,
- one Zendesk integration,
- one KB repository mirror,
- one article history set,
- one prompt/template library,
- one publish/sync context.

A single user can switch between workspaces locally.

### 5.3 Live vs draft model
Every KB article locale variant has:

- a **live version** representing the current known Zendesk state,
- zero or more **draft branches** representing local proposed changes.

For brand-new articles:
- no live version exists until the first successful publish.

For existing articles:
- the live version is created from Zendesk sync.
- draft branches are created only when the user or AI creates one.

### 5.4 Draft branching model
Branching is allowed.

A locale variant can have multiple draft branches. Each branch is anchored to a specific base live revision.

When a branch is published:
- that branch is promoted to the new live revision,
- the branch itself ceases to exist as an active draft,
- sibling branches based on an older live revision become **obsolete** and require user review, deletion, or rebase.

This preserves the user’s desire for branching while keeping publish behavior deterministic.

---

## 6. Core concepts

### 6.1 Workspace
A local environment bound to a Zendesk help center/brand connection and its local KB data.

### 6.2 Article family
A logical KB article identity independent of language, such as “Create & Edit Chat Channels.”

### 6.3 Locale variant
A language-specific version of an article family, such as:
- English
- Spanish

Each locale variant has its own live revision and draft branches.

### 6.4 Live revision
A snapshot of the article as last synced from or published to Zendesk.

### 6.5 Draft branch
A mutable local working version of a locale variant. Draft branches can receive:
- accepted AI proposals,
- manual edits,
- article-level AI edits.

### 6.6 PBI batch
A named upload event containing many PBIs from a CSV import and the resulting analysis run(s), proposals, decisions, and notes.

### 6.7 Proposal
A structured AI output for a single article-level recommendation:
- create article,
- edit article,
- retire article,
- no impact.

### 6.8 Review decision
A user action on a proposal:
- accept,
- deny,
- defer,
- apply to existing branch,
- create new branch.

### 6.9 Publish job
A user-initiated batch publish action that pushes one or more selected draft branches to Zendesk.

### 6.10 Template pack
A workspace-editable set of article templates, guidance, tone rules, and examples used to shape AI generation.

### 6.11 Image placeholder
A structured placeholder emitted by the LLM to indicate where an image or screenshot should be inserted.  
Canonical form:

```html
<image_placeholder description="Screenshot of Team Dashboard showing Leadership tile assignment" />
```

These placeholders render as visual blocks in the editor and preview.

---

## 7. Primary user journeys

## 7.1 Initial workspace setup
1. User creates a workspace.
2. User enters Zendesk connection details.
3. User selects default locale and enabled locales.
4. User runs an initial manual sync.
5. KB Vault builds the local article repository.

## 7.2 Sync current Zendesk content
1. User clicks manual sync.
2. App pulls categories, sections, articles, translations, and attachments metadata as needed.
3. Local live revisions are updated.
4. Changed articles are marked for re-indexing.
5. Draft branches that now diverge from a changed live revision are marked potentially conflicted.

## 7.3 Import a bulk PBI batch
1. User opens the PBI import workflow.
2. User uploads a CSV file.
3. App parses and validates rows.
4. App displays a parsed batch summary.
5. User sees:
   - detected PBIs,
   - ignored rows,
   - unsupported rows,
   - parent/child linkages,
   - duplicate IDs if any.
6. User scopes which KB articles may be analyzed:
   - all articles,
   - all except selected,
   - only selected.
7. User submits the batch to AI analysis.

## 7.4 AI recommendation generation
1. App opens or resumes a persistent Cursor ACP conversation for the batch.
2. App sends:
   - sanitized PBI batch payload,
   - article hierarchy summary,
   - selected candidate article list,
   - template pack and style guidance,
   - locale context,
   - prior batch notes if relevant.
3. LLM requests more article context via MCP tools when needed.
4. App receives structured proposal results.
5. App stores all proposals locally.

## 7.5 Proposal review
1. Proposals are grouped **by article**.
2. User reviews one proposal at a time.
3. User sees:
   - triggering PBI(s),
   - confidence score,
   - AI notes,
   - suggested category/section placement,
   - rendered article preview,
   - rendered visual diff for edits,
   - source/HTML diff,
   - change markers in the gutter/ledger.
4. User accepts or denies each proposal.

## 7.6 Accept proposal into draft
Depending on proposal type:

- **Create**
  - create a new article family and locale draft branch
  - or attach to an existing manually chosen draft family if the user overrides placement
- **Edit**
  - create a new draft branch from live
  - or apply to an existing active branch chosen by the user
- **Retire**
  - mark the article locale or family as retired in local state
  - user later decides whether to publish the retirement to Zendesk
- **No impact**
  - no draft is created

## 7.7 Edit with AI at article level
1. User opens any draft branch.
2. User chats with the LLM inside KB Vault.
3. The app routes the request through ACP using article-scoped context.
4. AI returns a proposed edit patch or a full proposed rewrite.
5. User can accept the proposal into the branch, reject it, or manually edit further.

## 7.8 Publish selected drafts
1. User selects one or more draft branches for publish.
2. App validates:
   - unresolved conflicts,
   - unresolved placeholders,
   - missing locale metadata,
   - missing Zendesk placement,
   - invalid HTML or disallowed tags.
3. App sync-checks against live Zendesk state.
4. If no conflict:
   - upload assets,
   - create or update article/translations,
   - update categories/sections if approved and needed,
   - record publish metadata,
   - promote branch to live revision,
   - close branch.
5. If conflict:
   - block publish,
   - open conflict resolution flow.

---

## 8. Functional requirements

## 8.1 App shell and navigation
The app must provide a modular shell with at least the following KB Vault surfaces:

- Workspace switcher
- Article Explorer
- PBI Batches
- Proposal Review
- Drafts
- Publish Queue
- Templates & Prompts
- Settings / Zendesk connection

The app should not contain a dashboard as a primary landing experience.

## 8.2 Article explorer
The explorer must provide:

- category/section/article tree
- locale-aware article grouping
- search
- filters for:
  - live only,
  - has drafts,
  - retired,
  - conflicted,
  - recently changed,
  - untranslated / translation out-of-date
- draft branch indicators
- publish status indicators
- history presence indicator

## 8.3 Article detail view
The article detail surface must support:

- rendered Zendesk-like preview
- source/HTML view
- locale switcher
- live vs draft comparison
- branch selector
- linked PBI history
- AI notes history
- publish history
- asset placeholders
- manual edit mode
- AI chat side panel

## 8.4 PBI import requirements
The import pipeline must:

- accept bulk CSV uploads
- preserve the original file as part of batch history
- parse HTML present in description and acceptance criteria fields
- store both raw HTML and stripped plain-text forms
- support the original column model unless the user remaps fields
- build parent-child relationships
- deduplicate by work item ID
- flag invalid rows rather than silently dropping them

Expected PBI columns:

- State
- ID
- Work Item Type
- Title 1
- Title 2
- Title 3
- Description
- Acceptance Criteria
- Parent

### PBI preprocessing rules
The system should:

- ignore clearly technical implementation-only tasks by default
- keep task rows available in raw import history
- use title hierarchy to infer feature area
- preserve HTML fields for reference
- strip HTML to plain text for search and analysis
- classify rows into:
  - candidate for KB analysis,
  - ignored technical row,
  - malformed row,
  - duplicate row

## 8.5 Article scoping controls before AI analysis
Before the app sends a batch to AI, the user must be able to control scope.

The scoping view must include a file-list or tree-list style article browser that lets the user:

- exclude specific articles or folders from analysis
- select only specific articles/folders for analysis
- review what the AI is allowed to inspect
- preview candidate counts before submitting

This is a trust and cost-control feature.

## 8.6 AI orchestration via ACP
ACP is the primary LLM integration layer.

The app must:

- run a persistent ACP client session without requiring visible user interaction in Cursor
- create or resume sessions per:
  - PBI batch,
  - article editing conversation,
  - optionally workspace background context
- maintain local mapping between app objects and ACP sessions
- support structured request/response handling
- support retries and error recovery
- keep the app usable if Cursor is not available

### ACP usage model
Two primary ACP session types:

1. **Batch analysis session**
   - used for bulk PBI -> proposal generation
2. **Article editing session**
   - used when the user chats on a specific article branch

## 8.7 MCP tool server
KB Vault must expose a local MCP server so Cursor can call workspace-aware tools.

Minimum MCP tool set:

- `search_kb`
- `get_article`
- `get_article_family`
- `get_locale_variant`
- `find_related_articles`
- `list_categories`
- `list_sections`
- `list_article_templates`
- `get_template`
- `get_batch_context`
- `get_pbi`
- `get_pbi_subset`
- `get_article_history`
- `propose_create_kb`
- `propose_edit_kb`
- `propose_retire_kb`
- `record_agent_notes`

### Tooling rule
The model may gather context and return proposal payloads, but it may not directly publish, delete live content, or mutate Zendesk without explicit user action.

## 8.8 Proposal schema and review model
Every AI batch result must be normalized into structured proposals.

Each proposal must include at minimum:

- proposal ID
- originating batch ID
- action type:
  - `CREATE_ARTICLE`
  - `EDIT_ARTICLE`
  - `RETIRE_ARTICLE`
  - `NO_IMPACT`
- target article family if known
- target locale(s)
- suggested category
- suggested section
- triggering PBI IDs
- confidence score
- AI notes
- rationale summary
- proposed title
- proposed body HTML or patch
- structured diff metadata where relevant
- placeholder list
- validation warnings

### Proposal review states
Proposal states:

- `PENDING_REVIEW`
- `ACCEPTED`
- `DENIED`
- `DEFERRED`
- `APPLIED_TO_BRANCH`
- `ARCHIVED`

## 8.9 Proposal review UX
The review flow is the centerpiece of the product.

### Required behaviors
- Group proposals by article
- Review one at a time
- Easy next/previous movement between proposals
- Rapid accept/deny controls
- Confidence visibility
- PBI evidence visible alongside article content
- No hidden reasoning requirement for trust

### Recommended interaction model
A slider, carousel, or stepper-style review flow is appropriate because the user explicitly wants something intuitive and navigable.

### Required views for a new article proposal
- rendered Zendesk-like preview
- source/HTML toggle
- template used
- suggested placement
- linked PBI evidence
- confidence + notes
- accept / deny / edit now / save to draft

### Required views for an edit proposal
- rendered visual diff
- full rendered preview
- source/HTML diff
- left-side change ledger / change gutter
- linked PBI evidence
- confidence + notes
- accept / deny / apply to existing draft / create new branch

## 8.10 Draft editing
Draft editing must support:

- source/HTML editing
- rendered preview
- branch switching
- manual edits
- AI-assisted edits
- placeholder resolution
- local undo/redo
- autosave
- validation warnings
- branch metadata display

### Editor requirements
The editor should support:
- HTML-aware editing
- diff rendering
- inline change markers
- preview fidelity close to Zendesk article rendering
- safe handling of inline styles and supported tags

## 8.11 Article-level AI editing
From any article or draft branch, the user can ask the AI to:

- rewrite for tone
- refactor structure
- shorten or expand
- align to template
- add or revise steps
- convert to troubleshooting format
- update Spanish or English locale variants
- insert image placeholders

All article-level AI edits must still come back as proposals or patches that the user can accept or reject.

## 8.12 Templates and prompt packs
The workspace must provide editable template and prompt management.

Users should be able to:

- view templates used by AI
- edit templates
- create new templates
- ask AI to analyze current KB style and propose improved templates
- assign template preferences by article type
- maintain tone/style guidance inside the workspace

Initial template types:
- Standard how-to
- FAQ
- Troubleshooting
- Policy / notice
- Feature overview

## 8.13 Retire workflow
Retirement must be supported as both a recommendation and a lifecycle state.

### Recommendation action
A proposal can recommend `RETIRE_ARTICLE`.

### Article status
An article family or locale variant can be marked `RETIRED`.

### Delete
Delete is a separate destructive action that can remove:
- draft branches,
- historical local revisions,
- or retired article records.

Remote deletion in Zendesk should be treated as a distinct explicit user action and should be guarded with warnings.

## 8.14 Publish workflow
The product must support publishing multiple selected draft branches in one operation.

### Publish requirements
- multi-select drafts
- validate before publish
- show pending publish list
- publish in deterministic order
- handle partial failures
- record per-article publish result
- promote successful branches to live
- preserve publish log on the live article
- remove the promoted draft branch from active drafts

## 8.15 Conflict management
If live Zendesk content changed after the local branch base revision, publish must be blocked.

The user must be shown a conflict view similar in spirit to source-control conflict resolution.

The conflict workflow must provide:
- remote live content
- local draft content
- base revision content
- rendered diff
- source diff
- manual merge option
- accept remote / accept local / merge output behaviors

## 8.16 Locale support
The product must support English and Spanish in the first implementation.

### Locale requirements
- locale variants grouped under one article family
- switcher in explorer and article detail
- separate draft branches per locale
- separate live revisions per locale
- separate translation publish operations where required
- translation freshness visibility

### Recommended initial rule
English can act as default source locale where applicable, but Spanish variants must still be first-class editable documents rather than second-class generated outputs.

---

## 9. Data model

## 9.1 Workspace
Fields:
- `id`
- `name`
- `root_path`
- `default_locale`
- `enabled_locales`
- `zendesk_subdomain_or_base_url`
- `zendesk_brand_id` (optional)
- `created_at`
- `updated_at`
- `last_sync_at`
- `theme_style_pack_id`
- `settings_json`

## 9.2 Zendesk connection
Fields:
- `workspace_id`
- `auth_mode`
- `email_or_username`
- `token_reference`
- `brand_reference`
- `locale_config`
- `created_at`
- `updated_at`

Credentials should not be stored in plain text in workspace files.

## 9.3 Category
Fields:
- `id`
- `workspace_id`
- `zendesk_category_id`
- `name`
- `locale`
- `position`
- `is_deleted_remote`
- `created_at`
- `updated_at`

## 9.4 Section
Fields:
- `id`
- `workspace_id`
- `zendesk_section_id`
- `category_id`
- `name`
- `locale`
- `position`
- `is_deleted_remote`
- `created_at`
- `updated_at`

## 9.5 Article family
Fields:
- `id`
- `workspace_id`
- `canonical_slug`
- `primary_category_id`
- `primary_section_id`
- `status`
- `created_at`
- `updated_at`
- `retired_at`
- `deleted_at`

Suggested family statuses:
- `DRAFT_ONLY`
- `LIVE_ONLY`
- `LIVE_WITH_DRAFTS`
- `RETIRED`
- `DELETED`

## 9.6 Locale variant
Fields:
- `id`
- `article_family_id`
- `locale`
- `zendesk_article_id`
- `zendesk_translation_id` (if applicable)
- `title_current`
- `status`
- `last_synced_at`
- `last_published_at`
- `last_conflict_at`
- `translation_source_locale`
- `created_at`
- `updated_at`

Variant statuses:
- `LIVE_ONLY`
- `LIVE_WITH_DRAFTS`
- `DRAFT_ONLY`
- `CONFLICTED`
- `RETIRED`
- `DELETED`

## 9.7 Live revision
Fields:
- `id`
- `locale_variant_id`
- `revision_number`
- `title`
- `body_html`
- `body_text`
- `source_hash`
- `zendesk_revision_reference`
- `synced_from_zendesk_at`
- `published_to_zendesk_at`
- `created_at`

## 9.8 Draft branch
Fields:
- `id`
- `locale_variant_id`
- `name`
- `base_live_revision_id`
- `status`
- `head_revision_id`
- `created_from`
- `created_at`
- `updated_at`
- `published_at`
- `obsoleted_at`

Branch statuses:
- `ACTIVE`
- `READY_TO_PUBLISH`
- `CONFLICTED`
- `PUBLISHED`
- `OBSOLETE`
- `DISCARDED`

## 9.9 Draft revision
Fields:
- `id`
- `draft_branch_id`
- `revision_number`
- `title`
- `body_html`
- `body_text`
- `change_summary`
- `author_type` (`USER` or `AI`)
- `origin_proposal_id` (nullable)
- `created_at`

## 9.10 PBI batch
Fields:
- `id`
- `workspace_id`
- `name`
- `source_filename`
- `source_file_hash`
- `status`
- `raw_file_path`
- `row_count`
- `candidate_row_count`
- `ignored_row_count`
- `created_at`
- `updated_at`
- `submitted_to_ai_at`
- `completed_at`

Batch statuses:
- `IMPORTED`
- `SCOPED`
- `SUBMITTED`
- `ANALYZED`
- `REVIEW_IN_PROGRESS`
- `REVIEW_COMPLETE`
- `ARCHIVED`

## 9.11 PBI record
Fields:
- `id`
- `batch_id`
- `work_item_id`
- `state`
- `work_item_type`
- `title_1`
- `title_2`
- `title_3`
- `description_html`
- `description_text`
- `acceptance_html`
- `acceptance_text`
- `parent_work_item_id`
- `classification`
- `parse_warnings_json`
- `created_at`

## 9.12 AI run
Fields:
- `id`
- `workspace_id`
- `batch_id` or `draft_branch_id`
- `session_type`
- `acp_session_reference`
- `started_at`
- `completed_at`
- `status`
- `notes_summary`
- `raw_response_path`

## 9.13 Proposal
Fields:
- `id`
- `batch_id`
- `ai_run_id`
- `action_type`
- `target_article_family_id`
- `target_locale`
- `suggested_category_id`
- `suggested_section_id`
- `confidence_score`
- `rationale`
- `ai_notes`
- `proposal_payload_json`
- `status`
- `created_at`
- `updated_at`

## 9.14 Proposal-PBI link
Fields:
- `proposal_id`
- `pbi_record_id`

## 9.15 Publish job
Fields:
- `id`
- `workspace_id`
- `status`
- `started_at`
- `completed_at`
- `requested_branch_ids_json`
- `result_summary_json`

## 9.16 Publish record
Fields:
- `id`
- `publish_job_id`
- `draft_branch_id`
- `locale_variant_id`
- `zendesk_target_reference`
- `result`
- `error_message`
- `published_revision_id`
- `created_at`

## 9.17 Asset placeholder
Fields:
- `id`
- `draft_revision_id`
- `description`
- `position_reference`
- `resolved_asset_id`
- `status`

## 9.18 Asset
Fields:
- `id`
- `workspace_id`
- `local_path`
- `mime_type`
- `size_bytes`
- `width`
- `height`
- `alt_text`
- `zendesk_attachment_id`
- `zendesk_url`
- `created_at`

## 9.19 Template pack
Fields:
- `id`
- `workspace_id`
- `name`
- `type`
- `body`
- `guidance_json`
- `created_at`
- `updated_at`

## 9.20 Article history link table
There must be a durable way to track which PBIs influenced an article across time.

This should be represented as article-level lineage, not just branch-level lineage.

Fields:
- `article_family_id`
- `locale_variant_id`
- `pbi_record_id`
- `relationship_type` (`TRIGGERED_CREATE`, `TRIGGERED_EDIT`, `TRIGGERED_RETIRE`, `REFERENCED_ONLY`)
- `origin_proposal_id`
- `created_at`

---

## 10. Status model and lifecycle rules

## 10.1 Proposal action types
- `CREATE_ARTICLE`
- `EDIT_ARTICLE`
- `RETIRE_ARTICLE`
- `NO_IMPACT`

## 10.2 Proposal review statuses
- `PENDING_REVIEW`
- `ACCEPTED`
- `DENIED`
- `DEFERRED`
- `APPLIED_TO_BRANCH`
- `ARCHIVED`

## 10.3 Locale/article statuses
- `DRAFT_ONLY`
- `LIVE_ONLY`
- `LIVE_WITH_DRAFTS`
- `CONFLICTED`
- `RETIRED`
- `DELETED`

## 10.4 Branch statuses
- `ACTIVE`
- `READY_TO_PUBLISH`
- `CONFLICTED`
- `PUBLISHED`
- `OBSOLETE`
- `DISCARDED`

## 10.5 Lifecycle rules
1. AI cannot create live content directly.
2. Accepted create/edit proposals become draft branch content.
3. Published branches cease to exist as active drafts because they become the new live revision.
4. Old live revisions remain in history until the user deletes them.
5. Retired is a status, not just a recommendation label.
6. Delete is a separate destructive action.

---

## 11. Local storage model

The product is local-first and should keep both filesystem-friendly content and indexed metadata.

### 11.1 Recommended storage strategy
- **SQLite** for metadata, relationships, search index metadata, history tables, proposal tables, and job state
- **Filesystem** for large content payloads, article snapshots, raw imports, rendered cache, assets, and raw AI responses

### 11.2 Recommended workspace structure

```text
kb-vault-workspaces/
  <workspace_slug>/
    workspace.json
    state.db
    secrets/                # references only; actual credentials in OS keychain
    articles/
      families/
        <article_family_id>/
          family.json
          locales/
            en-US/
              live/
                rev-0001.html
                rev-0002.html
              drafts/
                <branch_id>/
                  branch.json
                  rev-0001.html
                  rev-0002.html
              history/
                manifest.json
            es-ES/
              live/
              drafts/
              history/
    pbis/
      batches/
        <batch_id>/
          source.csv
          parsed.json
          normalized.json
          review_state.json
          ai/
            run-001-request.json
            run-001-response.json
    assets/
      original/
      processed/
    templates/
      prompt-packs/
      article-templates/
    cache/
      rendered/
      search/
      diffs/
    logs/
      app.log
      publish.log
```

### 11.3 Why hybrid storage is preferred
A hybrid model gives:
- transactional state and queryability through SQLite,
- easy local inspection and backup through filesystem snapshots,
- resilience if one layer is corrupted,
- simpler future module reuse.

---

## 12. Technical architecture

## 12.1 Stack recommendation
- **Desktop shell:** Electron
- **Frontend:** React + TypeScript
- **State/query layer:** TanStack Query + Zustand or Redux Toolkit
- **Backend inside Electron:** Node.js in the main process plus isolated worker processes
- **Database:** SQLite with FTS5
- **HTML/source editor:** Monaco or CodeMirror
- **Diff engine:** combination of source diff and DOM/block-aware diff
- **Rendered preview:** sandboxed iframe or BrowserView with workspace style pack
- **Secure secret storage:** OS keychain integration
- **Background jobs:** local job runner in Electron main / worker threads

## 12.2 Major subsystems
1. Workspace Manager
2. Zendesk Sync Service
3. PBI Import Service
4. Search and Index Service
5. ACP Orchestrator
6. MCP Tool Server
7. Proposal Engine
8. Review State Manager
9. Draft Branch Manager
10. HTML Validation and Preview Service
11. Publish Service
12. Conflict Resolver
13. Template/Prompt Manager
14. Asset Manager

## 12.3 Process boundaries
Recommended process split:

- **Renderer process**
  - all UI
- **Electron main process**
  - workspace management, IPC routing, job scheduling, secret access
- **Local workers**
  - CSV parsing
  - indexing
  - diff generation
  - HTML sanitization
  - Zendesk sync/publish
  - ACP session drivers
- **MCP server process**
  - separate process so it can be restarted independently and kept cleanly bounded

## 12.4 IPC discipline
All privileged operations should go through typed IPC contracts.

Examples:
- sync workspace
- import PBI batch
- start ACP session
- resume ACP session
- run proposal analysis
- accept proposal
- create draft branch
- publish branches
- resolve conflict
- query article tree

---

## 13. Zendesk integration model

## 13.1 Integration assumptions
Each workspace connects to one Zendesk help center / brand context.

The app must support:
- manual full sync
- manual incremental sync
- article create/update
- section/category create when explicitly approved
- translation sync/publish
- attachment upload
- remote conflict detection

## 13.2 Sync responsibilities
Manual sync should gather:
- categories
- sections
- article metadata
- article HTML body
- locale and translation metadata where applicable
- attachment metadata where relevant

## 13.3 Publish responsibilities
Publish must support:
- create new articles
- update existing articles
- update translations
- create sections/categories if the user accepted a proposal that requires them
- upload assets and replace placeholders/paths

## 13.4 Conflict baseline
Before publish, the app should compare the draft branch base live revision with current Zendesk remote state.

If hashes or relevant update timestamps differ, mark the branch conflicted and block publish until resolved.

## 13.5 Safe deletion / retirement recommendation
Because remote deletion is destructive, the workspace should support a configurable retire strategy:
- default safe mode: mark retired locally and unpublish/archive remotely where possible
- optional hard delete mode: remote delete only after explicit confirmation

---

## 14. Cursor ACP and MCP implementation model

## 14.1 Why ACP is the correct primary integration
ACP supports persistent agent conversations and is a better fit than one-off CLI prompts for:
- batch analysis continuity,
- article-level editing conversations,
- richer local orchestration.

## 14.2 ACP session design
Session keys should be deterministic:

- `workspace:<id>:batch:<batch_id>`
- `workspace:<id>:article:<variant_id>:branch:<branch_id>`

The app should be able to:
- create a session,
- resume a session,
- attach contextual metadata,
- stream partial responses,
- store final normalized output.

## 14.3 Prompt packaging
Each ACP request should be constructed from structured context packets, not ad hoc string concatenation.

A context packet may contain:
- workspace configuration
- article hierarchy summary
- selected article list
- selected article bodies or excerpts
- batch summary
- normalized PBI rows
- prompt/template pack
- output schema requirements
- allowed tool list
- previously returned notes if resuming

## 14.4 MCP tool philosophy
MCP tools should expose read-heavy context retrieval and proposal-intent operations.  
The LLM should have access to:
- discover relevant articles,
- inspect live and draft versions,
- inspect batch PBIs,
- propose new article placement,
- propose edits or retirements.

It should **not** have permission to:
- publish,
- delete live data,
- alter Zendesk directly,
- modify OS-level secrets,
- execute unrestricted local commands.

## 14.5 Output contract
ACP responses should be normalized against a strict JSON schema before any proposal is stored.

If the agent returns malformed data:
1. attempt structured repair locally,
2. if needed, re-ask the agent for schema-conformant output,
3. do not silently coerce ambiguous outputs into accepted proposals.

## 14.6 Agent notes
The agent must be allowed to return notes at:
- batch level
- per-article level
- per-proposal level

These notes are stored and shown to the user as supporting context, not hidden system reasoning.

---

## 15. Recommendation engine design

## 15.1 Two-stage recommendation strategy
The system should not rely on raw LLM reasoning alone.

### Stage A: deterministic local preparation
- parse CSV
- strip HTML
- classify rows
- build keyword/title maps
- search the local KB index for likely candidate articles
- apply user include/exclude scoping
- assemble candidate context package

### Stage B: LLM reasoning through ACP + MCP
The agent:
- evaluates user-facing impact,
- groups changes by article,
- recommends create/edit/retire/no-impact,
- drafts new content or edit patches,
- returns confidence and notes.

This reduces token load, improves reliability, and increases user trust.

## 15.2 Recommendation grouping
Recommendations should be grouped **by article**, because that is the clearest review unit for the user.

A batch may contain many PBIs that map to one article.

## 15.3 Confidence model
Each proposal must include a confidence score.  
Recommended scale:
- 0.00 to 1.00
or
- 0 to 100

The scale should be consistent across the workspace.

## 15.4 Explicit no-impact handling
The app should preserve no-impact decisions in the batch history so users can audit what was intentionally not turned into documentation work.

---

## 16. Review experience design requirements

This is the single most important UX area.

## 16.1 Batch review surface
The batch review surface should feel like a focused workbench, not a spreadsheet.

### Layout recommendation
- Left column: article-group navigation / proposal queue
- Center: rendered content / diff / preview
- Right: PBI evidence, confidence, notes, accept/deny controls
- Top bar: batch name, progress, filters, mode toggle

## 16.2 Required review modes
### New article proposal
- rendered preview
- source view
- category/section placement
- linked PBI evidence
- confidence
- notes
- template indicator

### Existing article edit proposal
- visual rendered diff
- full rendered preview
- source/HTML diff
- change markers in gutter
- linked PBI evidence
- confidence
- notes

## 16.3 Change ledger behavior
In rendered preview mode for existing articles, the UI should show change markers in a left-side ledger or gutter aligned with changed content blocks.

This does not need to represent literal code lines only.  
It can represent:
- changed paragraphs,
- inserted lists,
- removed sections,
- title changes,
- placeholder insertions.

## 16.4 Accept/deny behavior
The review flow should allow:
- accept current proposal
- deny current proposal
- edit current proposal before acceptance
- save as draft branch
- move to next proposal quickly

Bulk accept/deny is intentionally not required in the first version.

---

## 17. Editing model

## 17.1 Manual editing
Users must be able to directly edit:
- title
- body HTML
- category/section placement
- locale variant metadata
- placeholder descriptions
- related article links

## 17.2 AI editing within an article
The article screen must support a local AI conversation panel.

Typical commands:
- “Rewrite this to match the current tone”
- “Turn this into a troubleshooting article”
- “Update this for the Team Dashboard rename”
- “Insert a screenshot placeholder after step 3”
- “Shorten this article by 25%”
- “Create the Spanish variant”

## 17.3 AI acceptance behavior
Even in article-level chat, AI changes should land as:
- a proposed patch,
- a proposed full replacement,
- or a proposed structured section insertion.

User must explicitly accept the change into the branch.

## 17.4 Local edit history
Every manual and accepted AI change should create a new draft revision record.

---

## 18. Search and retrieval

## 18.1 Local search
The app must provide fast local search across:
- article titles
- article body text
- categories
- sections
- PBI IDs
- PBI text
- AI notes
- templates

## 18.2 Search technology
SQLite FTS5 is the recommended baseline.  
It is local, fast, and suitable for this use case.

## 18.3 Search exposure to AI
MCP tools should reuse the same local search/index layer for consistent candidate retrieval.

---

## 19. HTML, rendering, and validation

## 19.1 Supported content style
The system should produce Zendesk-compatible HTML and inline styling consistent with current article patterns.

## 19.2 Preview fidelity
The rendered preview should be a modular Zendesk-like article renderer, not a rough markdown preview.

Recommended approach:
- sandboxed iframe
- workspace-specific base CSS/style pack
- component wrappers for placeholders and local-only overlays

## 19.3 Validation
Before saving draft revisions and before publish, validate:
- supported HTML tags
- inline style safety
- image placeholders
- links
- empty titles
- invalid nesting
- missing alt text where applicable

## 19.4 Placeholder rendering
`<image_placeholder ... />` should render as a distinct visible block in preview/editor mode, not raw literal text.

---

## 20. Versioning and history

## 20.1 Live history
Every live sync and publish should create a preserved local live revision snapshot.

## 20.2 Draft history
Every accepted proposal or manual save should create a draft revision snapshot.

## 20.3 Publish history
After publish, the article family and locale variant should retain:
- publish time
- branch published
- base live revision
- result status
- triggering proposals
- linked PBI IDs

## 20.4 Deletion of history
Users may delete historical revisions locally if they want, but deletion should be explicit and warned because it removes auditability.

---

## 21. Security requirements

Security must be treated as a first-class requirement because the user explicitly identified lack of security as a trust-breaker.

## 21.1 Local-first requirement
All core app state must remain local by default.

## 21.2 Secret storage
Zendesk credentials and any Cursor-related sensitive references should be stored via OS keychain/credential vault, not plain-text files.

## 21.3 No hidden network behavior
The app should not send data to arbitrary external services.

Expected network activity should be limited to:
- user-initiated Zendesk sync/publish
- user-configured local Cursor integration paths or local Cursor-managed communication
- optional update checks if explicitly enabled

## 21.4 Workspace boundaries
Each workspace should isolate:
- local DB
- assets
- prompts
- history
- cached outputs

## 21.5 HTML safety
Because the app stores and previews HTML, preview rendering must be sandboxed and protected against unsafe behavior.

## 21.6 Auditability
Even without a full dashboard, the app should keep local operational logs for:
- sync actions
- publish actions
- AI batch submissions
- proposal accept/deny actions
- conflict outcomes

## 21.7 Failure transparency
If ACP, MCP, Zendesk sync, or publish fails, the app must show explicit failures rather than silently dropping work.

---

## 22. Reliability and error handling

## 22.1 Batch analysis failures
If AI analysis fails midway:
- preserve partial results if safe and schema-valid
- keep the batch resumable
- allow rerun from the same batch

## 22.2 Publish failures
Bulk publish must support partial success handling.

For each selected branch:
- success -> promote to live
- failure -> leave branch intact and show reason

## 22.3 Sync failures
Failed sync should:
- preserve last known live state
- never corrupt existing drafts
- clearly mark workspace sync state as stale

## 22.4 Recovery strategy
All long-running operations should be resumable or safely rerunnable.

---

## 23. Suggested UI surfaces inside KB Vault

1. **Workspace Home / Explorer default**
   - article tree
   - recent drafts
   - recent batches
   - publish queue
2. **PBI Batch Import Wizard**
   - upload
   - parse preview
   - scope selection
   - submit to AI
3. **Batch Review Workbench**
   - proposal carousel/stepper
   - preview/diff/source modes
4. **Article Detail / Branch View**
   - live vs draft
   - editor
   - AI side panel
   - history
5. **Publish Queue**
   - select branches
   - validate
   - publish
6. **Conflict Resolver**
   - three-way compare
7. **Templates & Prompts**
   - prompt packs
   - article templates
8. **Settings**
   - Zendesk connection
   - locales
   - style packs
   - safe mode behaviors

---

## 24. Suggested implementation phases

## Phase 0 — Foundation
Goal: create the local-first shell and workspace infrastructure.

Deliver:
- Electron shell
- React app scaffolding
- workspace creation/switching
- SQLite + filesystem hybrid storage
- typed IPC
- secure secret storage
- basic article explorer shell

## Phase 1 — Zendesk mirror and article repository
Goal: build reliable live article sync and local article storage.

Deliver:
- manual full sync
- manual incremental sync
- category/section/article import
- live revision snapshots
- locale grouping
- article explorer and article detail read views
- local search index

## Phase 2 — PBI import and batch analysis
Goal: import bulk PBI CSVs and generate structured recommendations.

Deliver:
- CSV upload wizard
- parse and normalize pipeline
- scope selection tree
- ACP session orchestration
- MCP tool server
- proposal schema validation
- batch storage
- grouped proposals by article

## Phase 3 — Review workbench
Goal: make proposal review intuitive and trustworthy.

Deliver:
- batch review UI
- rendered preview for creates
- rendered diff + source diff for edits
- confidence and notes
- accept/deny workflow
- accept into draft branch
- linked PBI evidence UI
- change gutter markers

## Phase 4 — Draft editing and article AI
Goal: enable full article authoring and refactoring.

Deliver:
- draft branch model
- source editor
- rendered preview
- AI article chat
- accepted AI patch application
- placeholder handling
- template management
- article-level history

## Phase 5 — Publish and conflict resolution
Goal: ship drafts back to Zendesk safely.

Deliver:
- publish queue
- asset upload handling
- create/update/translation publish
- section/category creation where approved
- conflict detection
- three-way conflict resolver
- publish logs
- live promotion and branch closure

## Phase 6 — Hardening
Goal: make the product safe and dependable.

Deliver:
- validation passes
- better logging
- recovery flows
- stale-sync warnings
- delete safeguards
- performance tuning
- packaging and installer readiness

---

## 25. Acceptance criteria for the whole product

The product is successful when all of the following are true:

1. A user can create a workspace locally and connect it to Zendesk.
2. A user can sync all relevant KB content into the workspace.
3. A user can upload a bulk CSV of PBIs and preview the parsed batch.
4. A user can control which KB articles are eligible for AI analysis.
5. The app can send the batch to Cursor without requiring manual Cursor chat interaction.
6. Cursor can use MCP tools to inspect article context.
7. The app receives structured create/edit/retire/no-impact proposals.
8. The user can review proposals one at a time in a clear article-centric workbench.
9. New article proposals render in a Zendesk-like preview.
10. Edit proposals show both rendered diff and source diff.
11. Accepted proposals create or update draft branches.
12. The user can manually edit drafts or request additional AI changes.
13. The user can select multiple drafts and publish them to Zendesk.
14. Publishing updates the local live version and closes the published draft branch.
15. Conflicts block publish and present a workable resolution flow.
16. English and Spanish article variants can both be managed.
17. All of this functions in a local-first way with no required team backend.

---

## 26. Risks and implementation notes

## 26.1 Zendesk content fidelity risk
Zendesk rendering and Help Center API behavior may not always match perfectly, especially if content blocks or other advanced Guide features are involved. Preview fidelity should target article-body correctness first, not a complete reproduction of all Zendesk chrome.

## 26.2 Structured AI output risk
LLM output must be schema-validated. The app should never treat loosely formatted agent text as ready-to-apply article changes.

## 26.3 Branch explosion risk
Because branching is supported, the UI must keep branch management understandable. Branch creation should be deliberate and branch obsolescence should be clearly surfaced after publish.

## 26.4 Local complexity risk
A local-first Electron app with ACP, MCP, Zendesk sync, HTML preview, draft branching, and diff review is a significant desktop product. Strong process boundaries and typed contracts are important to keep it stable.

---

## 27. Final implementation stance

This product should be built as a **local-first Electron application** with:

- **Cursor ACP** for persistent LLM conversations,
- **MCP** for KB-aware tool access,
- **Zendesk** as the live publishing target,
- **draft branches** as the working unit,
- **proposal review** as the main user workflow,
- **bulk PBI CSV ingestion** as the central automation entry point.

KB Vault should be implemented as a reusable module foundation for future artifact workflows, but the v1 build should stay tightly focused on **automating KB maintenance and creation from bulk PBI uploads**.
