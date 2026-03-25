"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrations = void 0;
exports.getMigrationStatements = getMigrationStatements;
exports.migrations = [
    {
        version: 1,
        name: '0001_workspace_bootstrap',
        description: 'Create workspace and local repository tables for batch-2 domain model.',
        sql: `
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS workspace_settings (
        workspace_id TEXT PRIMARY KEY,
        zendesk_subdomain TEXT NOT NULL,
        zendesk_brand_id TEXT,
        default_locale TEXT NOT NULL,
        enabled_locales TEXT NOT NULL,
        conflict_strategy TEXT DEFAULT 'none',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS article_families (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        external_key TEXT NOT NULL,
        title TEXT NOT NULL,
        section_id TEXT,
        category_id TEXT,
        retired_at TEXT
      );

      CREATE TABLE IF NOT EXISTS locale_variants (
        id TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        status TEXT NOT NULL,
        retired_at TEXT
      );

      CREATE TABLE IF NOT EXISTS revisions (
        id TEXT PRIMARY KEY,
        locale_variant_id TEXT NOT NULL,
        revision_type TEXT NOT NULL,
        branch_id TEXT,
        workspace_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content_hash TEXT,
        source_revision_id TEXT,
        revision_number INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS draft_branches (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        locale_variant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        base_revision_id TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        retired_at TEXT
      );

      CREATE TABLE IF NOT EXISTS pbi_batches (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        source_file_name TEXT NOT NULL,
        source_row_count INTEGER NOT NULL,
        imported_at TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pbi_records (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        source_row_number INTEGER NOT NULL,
        external_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT
      );

      CREATE TABLE IF NOT EXISTS ai_runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        prompt_template TEXT,
        transcript_path TEXT
      );

      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        action TEXT NOT NULL,
        locale_variant_id TEXT,
        branch_id TEXT,
        status TEXT NOT NULL,
        rationale TEXT,
        generated_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS proposal_pbi_links (
        proposal_id TEXT NOT NULL,
        pbi_id TEXT NOT NULL,
        relation TEXT,
        PRIMARY KEY (proposal_id, pbi_id)
      );

      CREATE TABLE IF NOT EXISTS publish_jobs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_by TEXT,
        enqueued_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        branch_ids TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS publish_records (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        zendesk_article_id TEXT,
        result TEXT,
        published_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        locale_variant_id TEXT,
        original_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size_bytes INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        checksum TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS placeholders (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        marker TEXT NOT NULL,
        raw_description TEXT NOT NULL,
        inserted_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS template_packs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        language TEXT NOT NULL,
        prompt_template TEXT NOT NULL,
        tone_rules TEXT NOT NULL,
        examples TEXT,
        active INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS article_lineage (
        id TEXT PRIMARY KEY,
        locale_variant_id TEXT NOT NULL,
        predecessor_revision_id TEXT NOT NULL,
        successor_revision_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `
    },
    {
        version: 2,
        name: '0002_zendesk_sync_state',
        description: 'Add Zendesk credential and sync state storage for batch-3 read integration.',
        sql: `
      CREATE TABLE IF NOT EXISTS zendesk_credentials (
        workspace_id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        encrypted_api_token TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS zendesk_sync_checkpoints (
        workspace_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        last_synced_at TEXT,
        cursor TEXT,
        synced_articles INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, locale)
      );

      CREATE TABLE IF NOT EXISTS zendesk_sync_runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        state TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        synced_articles INTEGER NOT NULL DEFAULT 0,
        skipped_articles INTEGER NOT NULL DEFAULT 0,
        created_families INTEGER NOT NULL DEFAULT 0,
        created_variants INTEGER NOT NULL DEFAULT 0,
        created_revisions INTEGER NOT NULL DEFAULT 0,
        remote_error TEXT,
        cursor_summary TEXT,
        updated_at TEXT NOT NULL
      );
    `
    },
    {
        version: 3,
        name: '0003_fix_sync_tables_fk',
        description: 'Fix legacy FK references from workspace tables to non-existent workspaces in per-workspace databases.',
        sql: `
      PRAGMA foreign_keys = OFF;

      DROP TABLE IF EXISTS zendesk_sync_checkpoints_v3;
      CREATE TABLE zendesk_sync_checkpoints_v3 (
        workspace_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        last_synced_at TEXT,
        cursor TEXT,
        synced_articles INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, locale)
      );

      DROP TABLE IF EXISTS zendesk_sync_runs_v3;
      CREATE TABLE zendesk_sync_runs_v3 (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        state TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        synced_articles INTEGER NOT NULL DEFAULT 0,
        skipped_articles INTEGER NOT NULL DEFAULT 0,
        created_families INTEGER NOT NULL DEFAULT 0,
        created_variants INTEGER NOT NULL DEFAULT 0,
        created_revisions INTEGER NOT NULL DEFAULT 0,
        remote_error TEXT,
        cursor_summary TEXT,
        updated_at TEXT NOT NULL
      );

      INSERT INTO zendesk_sync_checkpoints_v3 (
        workspace_id, locale, last_synced_at, cursor, synced_articles, updated_at
      )
      SELECT workspace_id, locale, last_synced_at, cursor, synced_articles, updated_at
      FROM zendesk_sync_checkpoints
      WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'zendesk_sync_checkpoints');

      INSERT INTO zendesk_sync_runs_v3 (
        id, workspace_id, mode, state, started_at, ended_at, synced_articles,
        skipped_articles, created_families, created_variants, created_revisions, remote_error, cursor_summary, updated_at
      )
      SELECT id, workspace_id, mode, state, started_at, ended_at, synced_articles,
             skipped_articles, created_families, created_variants, created_revisions, remote_error, cursor_summary, updated_at
      FROM zendesk_sync_runs
      WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'zendesk_sync_runs');

      DROP TABLE IF EXISTS zendesk_sync_checkpoints;
      ALTER TABLE zendesk_sync_checkpoints_v3 RENAME TO zendesk_sync_checkpoints;

      DROP TABLE IF EXISTS zendesk_sync_runs;
      ALTER TABLE zendesk_sync_runs_v3 RENAME TO zendesk_sync_runs;

      PRAGMA foreign_keys = ON;
    `
    },
    {
        version: 4,
        name: '0004_batch5_pbi_import_enhancements',
        description: 'Extend batch model for PBI batch 5 import normalization, validation, and scoping metadata.',
        sql: `
      ALTER TABLE pbi_batches ADD COLUMN source_path TEXT NOT NULL DEFAULT '';
      ALTER TABLE pbi_batches ADD COLUMN source_format TEXT NOT NULL DEFAULT 'csv';
      ALTER TABLE pbi_batches ADD COLUMN candidate_row_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE pbi_batches ADD COLUMN ignored_row_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE pbi_batches ADD COLUMN malformed_row_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE pbi_batches ADD COLUMN duplicate_row_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE pbi_batches ADD COLUMN scoped_row_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE pbi_batches ADD COLUMN scope_mode TEXT NOT NULL DEFAULT 'all';
      ALTER TABLE pbi_batches ADD COLUMN scope_payload TEXT;

      ALTER TABLE pbi_records ADD COLUMN state TEXT;
      ALTER TABLE pbi_records ADD COLUMN work_item_type TEXT;
      ALTER TABLE pbi_records ADD COLUMN title1 TEXT;
      ALTER TABLE pbi_records ADD COLUMN title2 TEXT;
      ALTER TABLE pbi_records ADD COLUMN title3 TEXT;
      ALTER TABLE pbi_records ADD COLUMN raw_description TEXT;
      ALTER TABLE pbi_records ADD COLUMN raw_acceptance_criteria TEXT;
      ALTER TABLE pbi_records ADD COLUMN description_text TEXT;
      ALTER TABLE pbi_records ADD COLUMN acceptance_criteria_text TEXT;
      ALTER TABLE pbi_records ADD COLUMN parent_external_id TEXT;
      ALTER TABLE pbi_records ADD COLUMN parent_record_id TEXT;
      ALTER TABLE pbi_records ADD COLUMN validation_status TEXT NOT NULL DEFAULT 'candidate';
      ALTER TABLE pbi_records ADD COLUMN validation_reason TEXT;
    `
    },
    {
        version: 5,
        name: '0005_agent_access_mode',
        description: 'Track workspace kb access mode and default to MCP.',
        sql: `
      ALTER TABLE workspace_settings ADD COLUMN kb_access_mode TEXT NOT NULL DEFAULT 'mcp';
    `
    },
    {
        version: 6,
        name: '0006_persist_agent_analysis_runs',
        description: 'Persist batch analysis session details and tool-call audit for restart-safe history.',
        sql: `
      ALTER TABLE ai_runs ADD COLUMN session_id TEXT;
      ALTER TABLE ai_runs ADD COLUMN kb_access_mode TEXT NOT NULL DEFAULT 'mcp';
      ALTER TABLE ai_runs ADD COLUMN tool_calls_json TEXT;
      ALTER TABLE ai_runs ADD COLUMN message TEXT;
    `
    },
    {
        version: 7,
        name: '0007_agent_run_raw_output',
        description: 'Persist raw agent run output for non-MCP runtime inspection.',
        sql: `
      ALTER TABLE ai_runs ADD COLUMN raw_output_json TEXT;
    `
    },
    {
        version: 8,
        name: '0008_batch7_proposal_review_model',
        description: 'Extend proposals for structured review state, rich metadata, and persisted diff artifacts.',
        sql: `
      ALTER TABLE proposals ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending_review';
      ALTER TABLE proposals ADD COLUMN queue_order INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE proposals ADD COLUMN family_id TEXT;
      ALTER TABLE proposals ADD COLUMN source_revision_id TEXT;
      ALTER TABLE proposals ADD COLUMN target_title TEXT;
      ALTER TABLE proposals ADD COLUMN target_locale TEXT;
      ALTER TABLE proposals ADD COLUMN confidence_score REAL;
      ALTER TABLE proposals ADD COLUMN rationale_summary TEXT;
      ALTER TABLE proposals ADD COLUMN ai_notes TEXT;
      ALTER TABLE proposals ADD COLUMN suggested_placement_json TEXT;
      ALTER TABLE proposals ADD COLUMN source_html_path TEXT;
      ALTER TABLE proposals ADD COLUMN proposed_html_path TEXT;
      ALTER TABLE proposals ADD COLUMN metadata_json TEXT;
      ALTER TABLE proposals ADD COLUMN decision_payload_json TEXT;
      ALTER TABLE proposals ADD COLUMN decided_at TEXT;
      ALTER TABLE proposals ADD COLUMN agent_session_id TEXT;

      UPDATE proposals
      SET review_status = CASE
        WHEN status = 'accept' THEN 'accepted'
        WHEN status = 'deny' THEN 'denied'
        WHEN status = 'apply_to_branch' THEN 'applied_to_branch'
        WHEN status = 'create_branch' THEN 'accepted'
        WHEN status = 'defer' THEN 'deferred'
        ELSE 'pending_review'
      END
      WHERE review_status IS NULL OR review_status = '';

      UPDATE proposals
      SET queue_order = (
        SELECT COUNT(*)
        FROM proposals p2
        WHERE p2.batch_id = proposals.batch_id
          AND p2.generated_at <= proposals.generated_at
      )
      WHERE queue_order = 0;
    `
    },
    {
        version: 9,
        name: '0009_article_relations_graph',
        description: 'Persist article relation graph runs, edges, evidence, and manual overrides.',
        sql: `
      CREATE TABLE IF NOT EXISTS article_relation_runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual_refresh',
        triggered_by TEXT,
        agent_session_id TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        summary_json TEXT
      );

      CREATE TABLE IF NOT EXISTS article_relations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        left_family_id TEXT NOT NULL,
        right_family_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        direction TEXT NOT NULL DEFAULT 'bidirectional',
        strength_score REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        origin TEXT NOT NULL DEFAULT 'inferred',
        run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS article_relation_evidence (
        id TEXT PRIMARY KEY,
        relation_id TEXT NOT NULL,
        evidence_type TEXT NOT NULL,
        source_ref TEXT,
        snippet TEXT,
        weight REAL NOT NULL DEFAULT 0,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS article_relation_overrides (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        left_family_id TEXT NOT NULL,
        right_family_id TEXT NOT NULL,
        override_type TEXT NOT NULL,
        relation_type TEXT NOT NULL DEFAULT '',
        note TEXT,
        created_by TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_article_relations_workspace_left
        ON article_relations(workspace_id, left_family_id, status, strength_score DESC);

      CREATE INDEX IF NOT EXISTS idx_article_relations_workspace_right
        ON article_relations(workspace_id, right_family_id, status, strength_score DESC);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_article_relations_unique_edge
        ON article_relations(workspace_id, left_family_id, right_family_id, relation_type, origin);

      CREATE INDEX IF NOT EXISTS idx_article_relation_evidence_relation
        ON article_relation_evidence(relation_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_article_relation_overrides_unique
        ON article_relation_overrides(workspace_id, left_family_id, right_family_id, override_type, relation_type);
    `
    },
    {
        version: 10,
        name: '0010_batch8_draft_editor_state',
        description: 'Persist draft branch head state, autosave metadata, and revision commit history for batch-8 editing flows.',
        sql: `
      ALTER TABLE draft_branches ADD COLUMN head_revision_id TEXT;
      ALTER TABLE draft_branches ADD COLUMN autosave_enabled INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE draft_branches ADD COLUMN last_autosaved_at TEXT;
      ALTER TABLE draft_branches ADD COLUMN last_manual_saved_at TEXT;
      ALTER TABLE draft_branches ADD COLUMN change_summary TEXT;
      ALTER TABLE draft_branches ADD COLUMN editor_state_json TEXT;

      CREATE TABLE IF NOT EXISTS draft_revision_commits (
        revision_id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        commit_kind TEXT NOT NULL,
        commit_message TEXT,
        created_at TEXT NOT NULL
      );

      UPDATE draft_branches
      SET head_revision_id = (
        SELECT r.id
        FROM revisions r
        WHERE r.branch_id = draft_branches.id
        ORDER BY r.revision_number DESC
        LIMIT 1
      )
      WHERE head_revision_id IS NULL OR head_revision_id = '';

      INSERT OR IGNORE INTO draft_revision_commits (
        revision_id, branch_id, workspace_id, commit_kind, commit_message, created_at
      )
      SELECT r.id,
             r.branch_id,
             r.workspace_id,
             'system',
             'Backfilled draft revision history',
             r.created_at
      FROM revisions r
      WHERE r.branch_id IS NOT NULL;
    `
    },
    {
        version: 11,
        name: '0011_batch9_article_ai_and_templates',
        description: 'Persist article AI chat sessions/messages and richer template pack metadata for batch-9 flows.',
        sql: `
      CREATE TABLE IF NOT EXISTS article_ai_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        locale_variant_id TEXT NOT NULL,
        branch_id TEXT,
        target_type TEXT NOT NULL DEFAULT 'live_article',
        current_revision_id TEXT NOT NULL,
        current_html TEXT NOT NULL,
        pending_html TEXT,
        pending_summary TEXT,
        pending_rationale TEXT,
        pending_metadata_json TEXT,
        template_pack_id TEXT,
        runtime_session_id TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS article_ai_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        role TEXT NOT NULL,
        message_kind TEXT NOT NULL DEFAULT 'chat',
        preset_action TEXT,
        content TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );

      ALTER TABLE template_packs ADD COLUMN template_type TEXT;
      ALTER TABLE template_packs ADD COLUMN description TEXT;
      ALTER TABLE template_packs ADD COLUMN analysis_json TEXT;

      UPDATE template_packs
      SET template_type = COALESCE(template_type, 'standard_how_to')
      WHERE template_type IS NULL OR template_type = '';
    `
    },
    {
        version: 12,
        name: '0012_global_ai_assistant',
        description: 'Add generic route-aware AI assistant sessions, messages, and artifacts.',
        sql: `
      CREATE TABLE IF NOT EXISTS ai_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        route TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        runtime_session_id TEXT,
        latest_artifact_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        role TEXT NOT NULL,
        message_kind TEXT NOT NULL DEFAULT 'chat',
        content TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_artifacts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        base_version_token TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        payload_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        applied_at TEXT,
        rejected_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_sessions_scope
        ON ai_sessions(workspace_id, route, COALESCE(entity_type, ''), COALESCE(entity_id, ''));

      CREATE INDEX IF NOT EXISTS idx_ai_messages_session_created
        ON ai_messages(session_id, created_at);

      CREATE INDEX IF NOT EXISTS idx_ai_artifacts_session_created
        ON ai_artifacts(session_id, created_at DESC);
    `
    },
    {
        version: 13,
        name: '0013_global_ai_history_threads',
        description: 'Promote AI assistant sessions to workspace-scoped threads with active and history states.',
        sql: `
      DROP INDEX IF EXISTS idx_ai_sessions_scope;

      ALTER TABLE ai_sessions ADD COLUMN title TEXT;
      ALTER TABLE ai_sessions ADD COLUMN entity_title TEXT;
      ALTER TABLE ai_sessions ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'closed';
      ALTER TABLE ai_sessions ADD COLUMN last_message_at TEXT;
      ALTER TABLE ai_sessions ADD COLUMN closed_at TEXT;
      ALTER TABLE ai_sessions ADD COLUMN archived_at TEXT;

      UPDATE ai_sessions
      SET title = COALESCE(NULLIF(title, ''), 'Imported chat'),
          lifecycle_status = CASE
            WHEN lifecycle_status IS NULL OR lifecycle_status = '' THEN 'closed'
            ELSE lifecycle_status
          END,
          last_message_at = COALESCE(
            last_message_at,
            (
              SELECT MAX(created_at)
              FROM ai_messages
              WHERE ai_messages.session_id = ai_sessions.id
            ),
            updated_at
          ),
          closed_at = CASE
            WHEN lifecycle_status = 'closed' AND closed_at IS NULL THEN updated_at
            ELSE closed_at
          END;

      CREATE INDEX IF NOT EXISTS idx_ai_sessions_lifecycle
        ON ai_sessions(workspace_id, lifecycle_status, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_ai_sessions_last_message
        ON ai_sessions(workspace_id, last_message_at DESC, updated_at DESC);
    `
    },
    {
        version: 14,
        name: '0014_workspace_agent_model_preference',
        description: 'Persist workspace-scoped ACP model preferences.',
        sql: `
      SELECT 1;
    `
    },
    {
        version: 15,
        name: '0015_ai_runs_agent_model',
        description: 'Persist the model used for batch analysis runs.',
        sql: `
      SELECT 1;
    `
    },
    {
        version: 16,
        name: '0016_batch_analysis_orchestration',
        description: 'Persist multi-stage batch analysis orchestration artifacts and iteration state.',
        sql: `
      CREATE TABLE IF NOT EXISTS batch_analysis_iterations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        role TEXT NOT NULL,
        summary TEXT,
        agent_model_id TEXT,
        session_id TEXT,
        approved_plan_id TEXT,
        last_review_verdict TEXT,
        outstanding_discovered_work_count INTEGER NOT NULL DEFAULT 0,
        execution_counts_json TEXT NOT NULL DEFAULT '{"total":0,"create":0,"edit":0,"retire":0,"noImpact":0,"executed":0,"blocked":0,"rejected":0}',
        started_at TEXT NOT NULL,
        ended_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_batch_analysis_iterations_batch_iteration
        ON batch_analysis_iterations(workspace_id, batch_id, iteration);

      CREATE INDEX IF NOT EXISTS idx_batch_analysis_iterations_stage
        ON batch_analysis_iterations(workspace_id, batch_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS batch_analysis_plans (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        iteration_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        stage TEXT NOT NULL,
        role TEXT NOT NULL,
        verdict TEXT NOT NULL,
        plan_version INTEGER NOT NULL,
        summary TEXT NOT NULL,
        coverage_json TEXT NOT NULL,
        open_questions_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        supersedes_plan_id TEXT,
        source_discovery_ids_json TEXT,
        agent_model_id TEXT,
        session_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_batch_analysis_plans_iteration
        ON batch_analysis_plans(iteration_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS batch_analysis_plan_items (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        iteration_id TEXT NOT NULL,
        plan_item_id TEXT NOT NULL,
        pbi_ids_json TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_article_id TEXT,
        target_family_id TEXT,
        target_title TEXT NOT NULL,
        reason TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        confidence REAL NOT NULL,
        depends_on_json TEXT,
        execution_status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_batch_analysis_plan_items_plan
        ON batch_analysis_plan_items(plan_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS batch_analysis_reviews (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        iteration_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        stage TEXT NOT NULL,
        role TEXT NOT NULL,
        verdict TEXT NOT NULL,
        summary TEXT NOT NULL,
        did_account_for_every_pbi INTEGER NOT NULL DEFAULT 0,
        has_missing_creates INTEGER NOT NULL DEFAULT 0,
        has_missing_edits INTEGER NOT NULL DEFAULT 0,
        has_target_issues INTEGER NOT NULL DEFAULT 0,
        has_overlap_or_conflict INTEGER NOT NULL DEFAULT 0,
        found_additional_article_work INTEGER NOT NULL DEFAULT 0,
        under_scoped_kb_impact INTEGER NOT NULL DEFAULT 0,
        delta_json TEXT,
        plan_id TEXT,
        agent_model_id TEXT,
        session_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_batch_analysis_reviews_iteration
        ON batch_analysis_reviews(iteration_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS batch_analysis_worker_reports (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        iteration_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        stage TEXT NOT NULL,
        role TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        plan_id TEXT,
        executed_items_json TEXT NOT NULL,
        blocker_notes_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        agent_model_id TEXT,
        session_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_batch_analysis_worker_reports_iteration
        ON batch_analysis_worker_reports(iteration_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS batch_analysis_discovered_work (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        iteration_id TEXT NOT NULL,
        worker_report_id TEXT NOT NULL,
        discovery_id TEXT NOT NULL,
        discovered_action TEXT NOT NULL,
        suspected_target TEXT NOT NULL,
        reason TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        linked_pbi_ids_json TEXT NOT NULL,
        confidence REAL NOT NULL,
        requires_plan_amendment INTEGER NOT NULL DEFAULT 1,
        status TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_batch_analysis_discovered_work_iteration
        ON batch_analysis_discovered_work(iteration_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS batch_analysis_final_reviews (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        iteration_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        stage TEXT NOT NULL,
        role TEXT NOT NULL,
        verdict TEXT NOT NULL,
        summary TEXT NOT NULL,
        all_pbis_mapped INTEGER NOT NULL DEFAULT 0,
        plan_execution_complete INTEGER NOT NULL DEFAULT 0,
        has_missing_article_changes INTEGER NOT NULL DEFAULT 0,
        has_unresolved_discovered_work INTEGER NOT NULL DEFAULT 0,
        delta_json TEXT,
        plan_id TEXT,
        worker_report_id TEXT,
        agent_model_id TEXT,
        session_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_batch_analysis_final_reviews_iteration
        ON batch_analysis_final_reviews(iteration_id, created_at DESC);
    `
    },
    {
        version: 17,
        name: '0017_batch_analysis_amendments',
        description: 'Persist worker-discovery amendment records and approval state.',
        sql: `
      CREATE TABLE IF NOT EXISTS batch_analysis_amendments (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        iteration_id TEXT NOT NULL,
        approved_plan_id TEXT,
        source_worker_report_id TEXT NOT NULL,
        source_discovery_ids_json TEXT NOT NULL,
        proposed_plan_id TEXT,
        review_id TEXT,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_batch_analysis_amendments_iteration
        ON batch_analysis_amendments(iteration_id, updated_at DESC);
    `
    },
    {
        version: 18,
        name: '0018_batch_analysis_stage_events',
        description: 'Persist batch analysis runtime stage transitions and status events.',
        sql: `
      CREATE TABLE IF NOT EXISTS batch_analysis_stage_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        iteration_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        stage TEXT NOT NULL,
        role TEXT NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT,
        summary TEXT,
        session_id TEXT,
        agent_model_id TEXT,
        approved_plan_id TEXT,
        last_review_verdict TEXT,
        outstanding_discovered_work_count INTEGER NOT NULL DEFAULT 0,
        execution_counts_json TEXT NOT NULL DEFAULT '{"total":0,"create":0,"edit":0,"retire":0,"noImpact":0,"executed":0,"blocked":0,"rejected":0}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_batch_analysis_stage_events_batch
        ON batch_analysis_stage_events(workspace_id, batch_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_batch_analysis_stage_events_iteration
        ON batch_analysis_stage_events(iteration_id, created_at ASC);
    `
    },
    {
        version: 19,
        name: '0019_batch_analysis_stage_event_details',
        description: 'Store structured trigger details for batch analysis stage events.',
        sql: `
      ALTER TABLE batch_analysis_stage_events
        ADD COLUMN details_json TEXT;
    `
    }
];
function getMigrationStatements() {
    return exports.migrations;
}
