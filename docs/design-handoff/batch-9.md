# Design Handoff: Batch 9

## Screens Designed

### Article AI Chat Sidebar (Drafts page)
Integrated into the existing right sidebar of the Drafts editor. The AI panel appears below History and provides a complete in-context editing chat experience without leaving the draft view.

Layout (top to bottom):
- **Pending edit card** (conditional) — prominent blue-bordered card with accept/reject actions, shown only when AI has returned a proposed change
- **Running indicator** — pulsing dot animation when AI is processing
- **Chat transcript** — scrollable message history with role-differentiated styling (user messages right-aligned blue, assistant left-aligned neutral, system centered italic)
- **Preset action chips** — pill-shaped quick actions for common operations (Tone, Shorten, Expand, Restructure, etc.)
- **Template selector** — dropdown to optionally bind a template pack to the request
- **Compose area** — resizable textarea with send button, supports Cmd+Enter submit

### Article AI Chat Tab (Article Explorer)
Added as a new tab ("AI Chat") in the Article Explorer detail drawer, positioned third after Preview and Source. This surfaces the same chat experience for live articles — users can start AI conversations directly from the Article Explorer without needing to navigate to the Drafts page first.

Same layout as the Drafts sidebar panel but rendered in the full-width drawer tab area:
- Pending edit card, running indicator, chat transcript, preset chips, template selector, compose area
- Session is keyed to `localeVariantId` so switching locale variants starts a fresh session
- Loading/error/empty states for session initialization

### Templates & Prompts (full page)
Two-panel layout (320px list + fluid editor):
- **Left panel:** Template card list with selected state, active/inactive badge, type badge, language badge, and analysis summary
- **Right panel:** Structured form with labeled fields, active toggle, analysis results card with strengths/gaps/suggestions breakdown, and action bar with save/analyze/delete
- **Delete confirmation** — modal dialog protecting against accidental template deletion

## Components Created / Modified

| Component | Change | Purpose |
|-----------|--------|---------|
| ArticleAiPanel | Rebuilt | Chat sidebar with transcript, presets, compose, pending edit card |
| ArticleAiTab | New | Full AI chat tab for Article Explorer detail drawer |
| TemplatesAndPrompts | Rebuilt | Structured template editor with analysis display and delete confirmation |

## Interaction Patterns

- **Chat-style transcript** — Messages styled by role with auto-scroll to latest, relative timestamps
- **Preset chip bar** — Pill buttons that populate the compose area with a preset prompt; disabled when a pending edit exists (must accept/reject first)
- **Pending edit flow** — Pending card appears at top of AI panel with accept/reject; compose is disabled until the pending edit is resolved
- **Cmd+Enter to submit** — Keyboard shortcut for sending AI requests from compose area
- **Send button** — Compact circular button next to compose textarea
- **Template analysis** — Two-column strengths/gaps display with color-coded dots, priority-labeled suggestions
- **Delete confirmation** — ConfirmationDialog guards template deletion with clear warning text
- **Active toggle** — Checkbox toggle controls whether a template is available to article AI

## Accessibility Considerations

- All form fields have explicit `htmlFor`/`id` label associations
- Preset chips have `title` attributes with full descriptions
- Send button has `title="Submit (Cmd+Enter)"` for discoverability
- Color indicators (role colors, analysis dots) paired with text labels
- Disabled states communicated via opacity and cursor changes
- Chat transcript is keyboard-scrollable with native scroll behavior

## States Covered

### Article AI Panel
- No session (branch not loaded)
- Session idle, no messages (empty hint)
- Session with chat history (scrollable transcript)
- AI running (pulsing indicator, compose disabled)
- Pending edit awaiting decision (accept/reject card, compose disabled)
- Preset selection populates compose
- Template selected/unselected

### Templates & Prompts
- No workspace
- Loading, error, empty list
- Template selected, template editing
- New template creation (no selectedId)
- Analysis available with strengths, gaps, suggestions
- No analysis yet
- Active/inactive toggle
- Delete confirmation dialog
- Busy state during save/analyze/delete

## Open Backend Gaps

- Article AI chat is now available from both the Drafts sidebar and the Article Explorer detail drawer
- Template analysis is heuristic-based per Codex notes; framed as "quality analysis" rather than authoritative scoring
- Monaco editor integration for prompt template editing would improve the authoring experience

## Requested Contract Changes

None — all Batch 9 contracts consumed as-is.

## Intentionally Deferred Polish

- Rich diff preview within the pending edit card (currently shows summary text only; full diff is visible in the editor compare tab)
- Streaming AI response tokens in the transcript (currently shows complete message after AI finishes)
- Template versioning or history (not in scope for v1)
- Drag-and-drop reordering of template packs
