’m treating Cursor ACP as the persistent agent runtime and MCP as the tool surface for KB-aware retrieval and proposal actions. That matches Cursor’s documented split: ACP runs Cursor CLI as an ACP server over stdio with JSON-RPC, while MCP is for external tools and data sources; Cursor CLI also respects the same rules system and MCP configuration used by the editor. Zendesk’s Help Center API is already organized around categories, sections, and articles, and supports list, search, and incremental article export flows, which is why this plan centers on a local sync layer and a main-process Zendesk client.

Rules that apply to every batch
Codex rules

Codex owns:

architecture
Electron main/preload/IPC
local database and filesystem model
Zendesk client
ACP client/session manager
MCP server
proposal parsing
diff engine
versioning
publishing
tests
migrations
docs
functional renderer wiring only

Codex does not own:

visual design
layout polish
interaction design
design system choices
final UI composition
animations
styling decisions
empty state copy polish
review carousel UX polish

Codex may build:

route files
hooks
stores
data loaders
typed component props
placeholder containers
accessibility scaffolding
test IDs
unstyled primitives

Codex must end every batch by writing:

docs/batches/codex-batch-<n>.md
docs/claude-handoff/batch-<n>.md
docs/contracts/batch-<n>-ipc.md
docs/contracts/batch-<n>-schema.md
docs/contracts/batch-<n>-payloads.md

Each Codex handoff must include:

what was built
files added/changed
DB schema or migration changes
IPC endpoints added/changed
background jobs added
sample payloads
renderer hooks available for Claude
known limitations
exact places Claude should plug UI into
Claude rules

Claude owns:

all UI/UX
design system
screen composition
panel layout
review flow interaction design
editor layout
visual diff treatment
change gutter visualization
preview/source toggle UX
form design
empty/loading/error states
keyboard affordances
polish

Claude should consume Codex contracts, not reinvent them.

Claude must end every batch by writing:

docs/batches/claude-batch-<n>.md
docs/design-handoff/batch-<n>.md

Each Claude batch doc should include:

components created
view states covered
interaction decisions
accessibility considerations
open backend gaps discovered
Recommended implementation baseline

Use this unless you intentionally change it before Batch 1 starts:

Electron + TypeScript
React renderer + Vite
Electron main process for all Zendesk, ACP, MCP, filesystem, and credential access
Preload bridge + typed IPC
SQLite for metadata, relationships, proposal state, history, and indexing
Filesystem for article HTML snapshots, raw imports, AI transcripts, diffs, assets, and cache
Monorepo layout:
apps/desktop
packages/shared-types
packages/db
packages/zendesk-client
packages/agent-runtime
packages/mcp-server
packages/diff-engine
packages/html-preview
Secure credential storage in OS keychain, not plain text
Monaco for source/HTML editing
Sanitized iframe or isolated preview renderer for Zendesk-like article rendering
Drizzle ORM or equivalent for migrations and typed DB access
Zod for IPC payload validation
Vitest + Playwright for automated tests
Build sequence

There are 12 paired batches. If you run them in order, you get:

usable local shell by Batch 2
local KB sync and browse by Batch 4
end-to-end bulk PBI proposal flow by Batch 7
full draft/edit workflow by Batch 9
Zendesk publish + conflicts by Batch 10
multilingual/history/assets hardening by Batch 11
production hardening by Batch 12
Batch 1 — Foundation, repo shape, contracts, and app shell
Codex Batch 1

Build the application foundation.

What Codex needs to build:

Electron monorepo scaffold
main / preload / renderer split
package boundaries listed above
typed IPC transport layer
shared error model
logging framework
config loader
environment handling
feature flag support
workspace root resolver
app-level route map for:
Workspace Switcher
KB Vault Home
Article Explorer
PBI Batches
Proposal Review
Drafts
Publish Queue
Templates & Prompts
Settings
minimal unstyled route containers
app boot sequence
update-safe migration runner
central command bus / job runner abstraction
standard result envelope for all backend operations

Codex must define:

directory structure
naming conventions
IPC naming scheme
error taxonomy
job state taxonomy
event bus / subscription model for long-running jobs

Codex must not do:

polished nav
visual theming
layout design
spacing/styling decisions

Codex deliverables:

running desktop shell
typed IPC framework
base docs
test harness
one smoke test that launches app and loads shell

Codex handoff to Claude must include:

route list
preload API shape
shell layout regions available
stubbed job state objects
how renderer receives live job updates

Definition of done:

app launches
renderer can call typed backend methods
background jobs can emit progress events
route skeletons exist
docs are written
Claude Batch 1

Design and build the visual app shell.

Claude should build:

design tokens
core desktop layout
left nav
workspace switcher visual treatment
page header system
panel/card language
empty/loading/error states
common button/input/select styles
modal/drawer treatment
badge and status chip system
keyboard hint styling

Claude must not change backend contracts.

Definition of done:

app shell feels like a real product
all root routes have polished placeholder layouts
UI foundation is reusable for later batches
Batch 2 — Workspace model, local repository model, and persistent storage
Codex Batch 2

Build the local-first domain model.

What Codex needs to build:

workspace entity
local workspace creation/open/delete
workspace settings storage
SQLite schema for:
workspaces
Zendesk connection metadata
categories
sections
article families
locale variants
live revisions
draft branches
draft revisions
PBI batches
PBI records
AI runs
proposals
proposal-PBI links
publish jobs
publish records
assets
placeholders
template packs
article lineage
migrations
repository layer
blob storage service for article HTML
file storage conventions
full-text search indexing strategy
retention rules for history and deleted artifacts
local path structure per workspace

Codex should also lock in article lifecycle semantics:

live revision
draft branch
obsolete branch
published branch
retired status
delete action

Codex must expose:

CRUD APIs for workspace and article metadata
queries for explorer trees
search endpoints
history retrieval endpoints
workspace-local filesystem structure

Definition of done:

workspace can be created and reopened
local DB initializes cleanly
filesystem structure is created
article family / locale / revision model is queryable
search index scaffold exists

Codex handoff to Claude must include:

DB entity map
query contracts for explorer
status enums
sample article tree payloads
workspace settings payloads
Claude Batch 2

Build the workspace setup and local data UX.

Claude should build:

create workspace flow
open existing workspace flow
settings forms for default locale and enabled locales
local repository status views
workspace detail page
article explorer shell using real batch-2 query payloads
badges for:
live only
has drafts
retired
conflicted
history available

Definition of done:

user can visually create/open a workspace
explorer tree feels structured and navigable
workspace settings feel coherent and local-first
Batch 3 — Zendesk connection, sync engine, and live mirror ingestion

Zendesk’s Help Center API responses are permission-filtered, locales are string-based, and the API surface already includes categories, sections, articles, search, and incremental article export. Rate limits are plan-based, with Help Center limits matching Support API tiers but counted separately, which is why this batch needs throttling, checkpointing, and resumable sync jobs.

Codex Batch 3

Build all read-side Zendesk integration.

What Codex needs to build:

secure Zendesk credential setup
OS keychain storage
connection test flow
Zendesk main-process client
support for:
categories
sections
articles
article search
incremental article sync
locale-aware article retrieval
article metadata sync
sync checkpoints
full sync job
incremental sync job
retry/backoff/throttle logic
cancellation support
mapping remote Zendesk objects into local live revisions
deleted/renamed remote object handling
sync audit logs
conflict baseline tracking when local drafts exist
background notifications/events for job progress

Codex must define:

sync job state machine
idempotency behavior
“last synced at” semantics
how live revisions are created from remote content
how draft branches are marked stale/conflicted after sync

Codex deliverables:

working sync from Zendesk into local workspace
deterministic remote-to-local mapping
tests with mocked Zendesk responses
documentation on API client usage and limits

Codex handoff to Claude must include:

connection test contract
sync progress event model
sync result summary payload
remote error mapping payloads
article tree hydration behavior after sync

Definition of done:

user can connect a workspace to Zendesk
initial sync works
incremental sync works
live article content lands locally
sync failures are recoverable
Claude Batch 3

Build the Zendesk connection and sync UX.

Claude should build:

Zendesk credential entry UI
secure connection test screen
manual sync trigger UI
sync progress view
sync result summary view
connection error states
rate-limit / retry / auth-expired error presentations
article explorer sync badges and freshness indicators

Definition of done:

Zendesk setup feels trustworthy
sync progress is understandable
errors are visible and actionable
Batch 4 — Article explorer, rendered preview, source view, and history read surfaces
Codex Batch 4

Build the read-side article experience.

What Codex needs to build:

explorer query service
category / section / article tree resolver
article detail query service
locale variant resolver
live vs draft selection logic
source HTML retrieval
preview rendering pipeline
HTML sanitization
placeholder parser for custom tags like <image_placeholder>
search query engine over title/body/metadata
filters:
live only
has drafts
retired
conflicted
recently changed
untranslated / stale translation
history retrieval
publish log read access
PBI lineage read access

Codex should provide:

renderer-safe HTML payloads
preview frame API
source/preview toggle support
history timeline payloads

Definition of done:

user can browse the synced KB locally
user can open an article
user can switch locale
user can inspect source HTML
user can see history and lineage data

Codex handoff to Claude must include:

explorer payload
search payload
article detail payload
preview renderer contract
history item payload
placeholder rendering tokens
Claude Batch 4

Build the polished article browsing experience.

Claude should build:

article explorer tree UI
filter rail
search bar behavior
article detail page layout
breadcrumb treatment
locale switcher UX
preview/source toggle UI
history timeline panel
PBI lineage panel
publish history panel
placeholder visual blocks in preview

Definition of done:

the KB can be explored cleanly
preview and source feel first-class
history is readable, not buried
Batch 5 — PBI batch import, parsing, normalization, and article scoping
Codex Batch 5

Build the ingestion pipeline.

What Codex needs to build:

batch entity creation
file ingest pipeline for:
CSV
optional HTML-based import adapter if your ADO export format requires it
raw file preservation
PBI parser
field mapping engine
validation engine
HTML preservation for description and acceptance criteria
stripped text generation for analysis/search
parent-child relationship builder
duplicate detection
malformed row classification
default ignore rules for clearly technical tasks
normalized storage of parsed records
batch summary generator
article scoping engine:
analyze all
analyze all except selected
analyze only selected
tree/file-list data for scoping picker
preflight payload builder for agent submission

Codex must also build:

stable batch IDs
status machine:
imported
scoped
submitted
analyzed
review in progress
review complete
archived

Codex handoff to Claude must include:

parsed batch summary payload
invalid row payload
duplicate row payload
scoping payload
preflight summary payload

Definition of done:

a user can upload a PBI batch
parser preserves raw and normalized forms
bad rows are surfaced, not dropped
scoping rules are enforced before AI submission
Claude Batch 5

Build the batch import workflow UI.

Claude should build:

upload wizard
field mapping step if needed
parse results summary
invalid row review view
duplicate review view
scoping tree/file browser
counts and warnings
clear final preflight confirmation step

This should feel extremely intuitive because this is the start of the automation chain.

Definition of done:

user can confidently upload and prepare a batch
scoping is visible and controlled
trust is improved before AI analysis starts
Batch 6 — Cursor ACP runtime, session manager, and local MCP tool server

Cursor’s CLI ACP mode is the persistent integration surface here, and MCP is the right place to expose your KB tools back to the agent. Cursor’s CLI also respects the project/editor rules and MCP configuration, which makes this the clean way to keep users out of Cursor while still using enterprise-approved agent behavior.

Codex Batch 6

Build the entire LLM runtime layer.

What Codex needs to build:

ACP client manager in Electron main
child-process lifecycle for Cursor ACP
stdio JSON-RPC transport
persistent session registry
session types:
batch analysis session
article edit session
request envelope builder
response collector
timeout/retry/error recovery logic
streaming/event handling
cancellation
raw transcript storage
sanitized local agent logs
MCP server process
MCP tool registry
tool auth/permissions
tool schemas
tool implementations

Required MCP tools:

search_kb
get_article
get_article_family
get_locale_variant
find_related_articles
list_categories
list_sections
list_article_templates
get_template
get_batch_context
get_pbi
get_pbi_subset
get_article_history
propose_create_kb
propose_edit_kb
propose_retire_kb
record_agent_notes

Codex must also build:

prompt assembly service
workspace-specific system prompt support
template pack injection
locale injection
article scope enforcement before tool calls
session resume mapping
local health checks:
Cursor installed?
ACP reachable?
MCP running?
required config present?

Codex handoff to Claude must include:

ACP status payload
session lifecycle payload
streaming event payload
tool-call audit payload
agent-note payload
error state payloads

Definition of done:

app can talk to Cursor without the user touching Cursor
agent can call KB tools through MCP
sessions persist and resume
failures are surfaced cleanly
Claude Batch 6

Build the LLM runtime UX.

Claude should build:

Cursor/agent health status UI
“run analysis” submit experience
processing state UI
streaming progress states
agent note presentation
tool-call activity surface
cancel/retry UX
“Cursor not available” fallback state
session badge/timeline presentation

Definition of done:

the AI runtime feels native to KB Vault
users never need to open Cursor
job states are understandable
Batch 7 — Proposal schema, proposal ingestion, and the core review flow
Codex Batch 7

Build the structured proposal engine.

What Codex needs to build:

proposal schema
proposal persistence
parser from agent output into normalized proposals
grouped-by-article review model
proposal linkage to triggering PBIs
confidence score storage
AI note storage
rationale summary storage
suggested placement storage
proposal validation
proposal state machine:
pending review
accepted
denied
deferred
applied to branch
archived
navigation model for next/previous proposal
proposal queue ordering
summary counts
initial diff engine for:
full HTML diff
rendered content diff data
change region map
left-gutter change metadata for renderer
proposal acceptance hooks:
create new draft branch
apply to existing branch
mark article retired
no-impact archive

Codex must ensure:

proposal review is always one-at-a-time
grouped-by-article navigation remains simple
all decisions are recorded

Codex handoff to Claude must include:

proposal payload
grouped review payload
diff payload
change-gutter payload
accept/deny action contracts
placement override contract

Definition of done:

a batch can be analyzed into structured proposals
proposals are grouped by article
review navigation works
accept/deny is persistent and traceable
Claude Batch 7

Build the main review experience.

Claude should build two major review views.

For new article proposals:

rendered Zendesk-like preview
source/HTML toggle
suggested placement panel
triggering PBI evidence panel
confidence + notes panel
accept / deny / edit now / save to draft actions

For edit proposals:

rendered visual diff
full rendered preview
source/HTML diff
left-side change ledger/gutter
triggering PBI evidence panel
confidence + notes panel
accept / deny / apply to existing draft / create new branch actions

Claude should make the navigation feel like a carousel / stepper / slider flow, because that matches your stated preference.

Definition of done:

review is the strongest surface in the app
users can move quickly without losing context
proposed creates and edits are easy to trust or reject
Batch 8 — Draft branches, branch lifecycle, and manual editing foundation
Codex Batch 8

Build the working draft system.

What Codex needs to build:

branch creation
branch naming/defaulting
base live revision anchoring
draft revision commits
autosave
undo/redo model
branch status transitions:
active
ready to publish
conflicted
published
obsolete
discarded
obsolete sibling handling after publish
branch deletion/discard
live vs draft compare queries
proposal application into branch
validation warnings:
invalid HTML
unsupported tags
unresolved placeholders
missing placement
locale issues
editor state persistence
local change summary generation

Codex should also build:

Monaco integration plumbing
preview/source synchronized editing model
draft metadata APIs
branch lineage logs
merged-branch history log on live article after publish later

Codex handoff to Claude must include:

branch selector payload
editor payload
validation warning payload
autosave state payload
obsolete/conflicted branch payloads

Definition of done:

user can create and edit branches
accepted proposals land in branches
manual editing works
draft status and validation are reliable
Claude Batch 8

Build the draft editing UX.

Claude should build:

draft editor layout
branch switcher
live/draft compare header
preview/source split behavior
validation warning rail
autosave status display
branch metadata display
discard/revert flows
obsolete branch resolution prompts

Definition of done:

draft editing feels focused and safe
users can understand branch state at a glance
manual editing is not awkward compared to AI flow
Batch 9 — Article-level AI editing, template packs, and prompt management
Codex Batch 9

Build the article-scoped AI refinement loop.

What Codex needs to build:

article-level ACP session lifecycle
request types:
rewrite for tone
shorten
expand
restructure
convert to troubleshooting
align to template
update locale
insert image placeholders
article-scoped context packing
branch-aware prompt assembly
AI patch proposal storage
full rewrite proposal storage
accept/reject patch application
template pack CRUD
template type support:
standard how-to
FAQ
troubleshooting
policy / notice
feature overview
tone/style guidance storage
AI-assisted template analysis
AI-generated template improvement proposals
locale-aware prompt behavior for English and Spanish

Codex handoff to Claude must include:

article AI session payload
patch proposal payload
rewrite proposal payload
template CRUD payloads
preset action payloads
locale-aware edit request payloads

Definition of done:

user can open any article/draft and ask AI to improve it
AI edits still return as proposals or patches
templates and prompt packs are editable locally
Claude Batch 9

Build the article AI and template UX.

Claude should build:

article AI chat sidebar
quick action presets
prompt composer
proposal preview inside article context
accept/reject controls
template library views
create/edit template screens
style guide editing screens
locale-sensitive template flows
side-by-side context panels if useful

Definition of done:

article-level AI help feels fast and controlled
templates are understandable and editable by non-engineers
Batch 10 — Publish pipeline, Zendesk write-side sync, and conflict resolution

Zendesk’s article APIs cover article retrieval and incremental change detection, and Help Center rate limits vary by plan, so write-side publishing needs batching, retry behavior, and prepublish checks. Zendesk’s article attachment/media docs also note a 20 MB attachment limit, so asset validation needs to happen before publish.

Codex Batch 10

Build the write-side pipeline.

What Codex needs to build:

publish queue
multi-select publish job
deterministic publish ordering
prepublish validation
sync-before-publish check
remote live refresh before write
conflict detection using:
base live revision
current remote revision
local draft head
create/update article publish flows
locale-specific publish flows
retirement publish flow
optional create-category/create-section flow when accepted in local review
asset upload pipeline
placeholder resolution pipeline
post-publish local promotion:
branch becomes new live revision
active draft closes
publish log attached to article
sibling branches marked obsolete if based on old live
partial failure handling
publish rollback rules where possible
publish audit logs

Codex must build conflict resolution data:

base
remote live
local draft
rendered conflict regions
source conflict regions
merge output save path

Codex handoff to Claude must include:

publish queue payload
validation report payload
publish result payload
conflict object payload
merge action contracts
asset upload result payload

Definition of done:

user can select multiple drafts and publish them
conflicts block publish correctly
successful publish promotes draft to live
publish logs are attached to article history
Claude Batch 10

Build the publish and conflict UX.

Claude should build:

publish queue screen
prepublish validation checklist UI
bulk publish confirmation UI
per-article publish status presentation
failure recovery UI
conflict resolution experience with:
base / remote / local views
rendered preview conflict mode
source diff conflict mode
merge/accept-local/accept-remote controls
retirement confirmation flow
post-publish success state

Definition of done:

bulk publish feels safe
conflicts feel resolvable, not scary
users understand exactly what happened after publish
Batch 11 — Locale variants, assets, image placeholders, and durable history
Codex Batch 11

Build the multilingual and history-complete model.

What Codex needs to build:

locale variant management for English and Spanish
locale switch/query APIs across explorer, article detail, drafts, and publish
translation freshness markers
source-locale linkage
asset library
local asset import
asset metadata extraction
placeholder-to-asset binding
asset reuse between drafts
history timeline consolidation:
live revisions
draft revisions
publish records
accepted proposals
triggering PBIs
merged branch logs
user deletion of old historical versions
user deletion of retired articles
safe soft-delete → permanent delete flow
cross-locale lineage tracking

Codex handoff to Claude must include:

locale timeline payload
translation freshness payload
asset library payload
placeholder binding payload
history timeline payload
delete confirmation payloads

Definition of done:

English and Spanish are first-class
image placeholders can be resolved
history and lineage are durable and browseable
user can prune old history safely
Claude Batch 11

Build the locale, asset, and history UX.

Claude should build:

locale switcher refinements
translation freshness presentation
asset browser
placeholder resolution UI
drag/select asset flow
image metadata presentation
history timeline UI
merged branch record display
safe delete confirmations for:
old revisions
discarded branches
retired articles

Definition of done:

multilingual behavior is obvious
asset handling feels integrated
history feels rich, not technical
Batch 12 — Security hardening, offline resilience, QA, packaging, and production readiness
Codex Batch 12

Build the production-readiness pass.

What Codex needs to build:

secrets hardening audit
redactable logging
crash recovery
workspace corruption detection
DB repair/reindex helpers
offline mode handling
“Cursor unavailable” degraded mode handling
“Zendesk unavailable” degraded mode handling
end-to-end test suite
performance profiling
large-batch stress testing
packaging/build scripts
installer generation
workspace export/import backup
versioned upgrade/migration tests
final developer docs
final operator docs
troubleshooting docs

Codex must also produce:

threat model summary
local data handling summary
secret storage summary
support runbook
recovery runbook

Definition of done:

app is stable on real batch sizes
failures don’t corrupt local state
packaging is reproducible
docs are complete enough for handoff
Claude Batch 12

Build the final UX hardening pass.

Claude should build:

onboarding polish
security reassurance surfaces
offline/degraded mode visuals
recovery and retry states
final consistency pass across all screens
accessibility pass
keyboard flow pass
empty-state polish
final QA visual pass
settings/help/troubleshooting layouts

Definition of done:

the app feels production-ready
trust and safety are visible in the UX
failure states feel intentional, not broken
What Codex should output after every batch

This is mandatory.

Every Codex batch must end with a handoff doc that Claude can directly consume. Use this structure:

docs/claude-handoff/batch-<n>.md

Include:

What was built
Files added/changed
New DB tables/migrations
New IPC endpoints
New background jobs
Renderer hooks now available
Sample payloads
Known limitations
What Claude should build on top of this
What Claude must not change
Any TODO markers intentionally left in renderer
Test coverage added

Codex should also include:

sample JSON fixtures for every new payload
screenshots only if useful for structural reference, not design
explicit notes about any contract instability
What Claude should output after every batch

Use this structure:

docs/design-handoff/batch-<n>.md

Include:

Screens designed
Components created
Interaction patterns introduced
Accessibility considerations
States covered
Known backend gaps
Any requested contract changes
Any intentionally deferred polish
The shortest practical execution order

If you want the most efficient build sequence, do it like this:

Batch 1
Batch 2
Batch 3
Batch 4
Batch 5
Batch 6
Batch 7
At this point you have the core: upload PBI batch, send to Cursor, receive proposals, review them.
Batch 8
Batch 9
Batch 10
At this point you have the full end-to-end workflow.
Batch 11
Batch 12
The three milestone checkpoints
Milestone A

After Batch 4:

local-first app shell
workspaces
Zendesk sync
article browsing
preview/source/history read
Milestone B

After Batch 7:

bulk PBI upload
article scoping
Cursor ACP + MCP runtime
structured create/edit/retire/no-impact proposals
one-at-a-time proposal review
Milestone C

After Batch 10:

draft branches
manual editing
article-level AI editing
bulk publish to Zendesk
conflict resolution
live promotion after publish

This batch plan is intentionally centered on the product you actually want now: KB maintenance and creation automation from bulk PBI uploads, not dashboards, not teams, and not a generic collaboration platform.

When you want, I’ll turn this into a copy-pasteable execution packet with each batch rewritten as a direct prompt for Codex Batch 1 / Claude Batch 1 / Codex Batch 2 / Claude Batch 2 and so on.