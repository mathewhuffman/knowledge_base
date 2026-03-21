export interface Migration {
  version: number;
  name: string;
  description: string;
  sql: string;
}

export const migrations: Migration[] = [
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
  }
  ,
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
  }
];

export function getMigrationStatements(): Migration[] {
  return migrations;
}
