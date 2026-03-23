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
    }
];
function getMigrationStatements() {
    return exports.migrations;
}
