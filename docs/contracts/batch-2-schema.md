# Batch 2 Schema (Domain model)

## Workspace model
- `workspaces`: metadata, settings, path, state
- `article_families`: KB families shared across locales
- `locale_variants`: locale-scoped article variants
- `revisions`: article snapshots (live draft/revision lineage)
- `draft_branches`: branch metadata anchored to live revisions
- `pbi_batches`: imported CSV upload batches
- `pbi_records`: PBI rows linked to a batch
- `ai_runs`: proposal generation runs
- `proposals`: AI outputs for create/edit/retire/no-impact
- `proposal_pbi_links`: many-to-many proposal↔PBI
- `publish_jobs`: publish job containers
- `publish_records`: published revision snapshots
- `assets`: local asset placeholders and metadata
- `template_packs`: prompt/template definitions
- `article_lineage`: previous/successor revision graph
- `placeholders`: image placeholder metadata records
- `migration_state`: per-workspace migration tracking

## Core status enums
- `WorkspaceState`: active / inactive / conflicted
- `RevisionState`: live / draft_branch / obsolete / retired
- `RevisionStatus`: open / promoted / failed / deleted
- `ProposalAction`: create / edit / retire / no_impact
- `ProposalDecision`: accept / deny / defer / apply_to_branch / create_branch
- `PublishStatus`: queued / running / completed / failed / canceled

## Shared payload types now in `@kb-vault/shared-types`
- `WorkspaceRecord`, `WorkspaceCreateRequest`, `WorkspaceListItem`
- `WorkspaceSettingsRecord`, `WorkspaceSettingsUpdateRequest`
- `WorkspaceRoutePayload`, `WorkspaceQueryPayload`
- `ArticleFamilyRecord`, `LocaleVariantRecord`, `RevisionRecord`
- `ArticleFamilyCreateRequest`, `ArticleFamilyUpdateRequest`
- `LocaleVariantCreateRequest`, `LocaleVariantUpdateRequest`
- `RevisionCreateRequest`, `RevisionUpdateRequest`
- `DraftBranchRecord`, `PBIBatchRecord`, `PBIRecord`
- `AiRunRecord`, `ProposalRecord`, `ProposalPbi`, `PublishJobRecord`, `PublishRecord`
- `AssetRecord`, `PlaceholderRecord`, `TemplatePackRecord`, `ArticleLineageRecord`
- `ExplorerNode`, `SearchPayload`, `SearchResponse`, `RevisionHistoryResponse`
- `RepositoryStructurePayload`, `FileStorageConvention`
