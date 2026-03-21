import path from 'node:path';
import { openDatabase } from './connection';
import { getMigrationStatements } from './migrations';
import fs from 'node:fs';

const CATALOG_DB = path.join('.meta', 'catalog.sqlite');
const CATALOG_SQL = `
  CREATE TABLE IF NOT EXISTS migration_state (
    id INTEGER PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_opened_at TEXT,
    zendesk_subdomain TEXT NOT NULL,
    zendesk_brand_id TEXT,
    default_locale TEXT NOT NULL,
    enabled_locales TEXT NOT NULL,
    state TEXT NOT NULL
  );
`;

export interface CatalogWorkspaceRow {
  id: string;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  zendesk_subdomain: string;
  zendesk_brand_id: string | null;
  default_locale: string;
  enabled_locales: string;
  state: string;
}

export interface MigrationStateRow {
  id: number;
  version: number;
  updated_at: string;
}

export interface WorkspaceMigrationState {
  version: number;
  updatedAt: string;
}

const MIGRATION_STATE_TABLE = `
  CREATE TABLE IF NOT EXISTS migration_state (
    id INTEGER PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
`;

export function openCatalogDatabase(rootPath: string) {
  const absolutePath = path.join(rootPath, CATALOG_DB);
  return openSafeDatabase(absolutePath);
}

export function openWorkspaceDatabase(dbPath: string) {
  return openSafeDatabase(dbPath);
}

export function ensureCatalogSchema(dbPath: string) {
  const catalog = openSafeDatabase(dbPath);
  try {
    catalog.exec(CATALOG_SQL);
    const state = catalog.get<MigrationStateRow>(`SELECT version FROM migration_state ORDER BY id DESC LIMIT 1`);
    if (!state) {
      catalog.run(`INSERT INTO migration_state (id, version, updated_at) VALUES (1, 0, datetime('now'))`);
    }
    return catalog;
  } catch (error) {
    catalog.close();
    throw error;
  }
}

export function getCatalogMigrationVersion(dbPath: string) {
  const catalog = ensureCatalogSchema(dbPath);
  try {
    const row = catalog.get<{ version: number }>(`SELECT version FROM migration_state ORDER BY id DESC LIMIT 1`);
    return row?.version ?? 0;
  } finally {
    catalog.close();
  }
}

export function getLatestCatalogVersion(db: ReturnType<typeof ensureCatalogSchema>) {
  const row = db.get<MigrationStateRow>(`SELECT version FROM migration_state ORDER BY id DESC LIMIT 1`);
  return row?.version ?? 0;
}

export function getWorkspaceMigrationVersion(dbPath: string): number {
  const db = openSafeDatabase(dbPath);
  try {
    ensureWorkspaceMigrationState(db);
    const row = db.get<WorkspaceMigrationState>(`SELECT version, updated_at AS updatedAt FROM migration_state`);
    return row?.version ?? 0;
  } finally {
    db.close();
  }
}

export function ensureWorkspaceMigrations(dbPath: string): {
  priorVersion: number;
  appliedVersion: number;
  migrationCount: number;
  repaired: boolean;
} {
  const db = openSafeDatabase(dbPath);
  try {
    const priorVersion = getWorkspaceMigrationVersionFromDb(db);
    const migrations = getMigrationStatements();
    const latestVersion = migrations.length > 0 ? migrations[migrations.length - 1].version : 0;

    if (priorVersion > latestVersion) {
      return {
        priorVersion,
        appliedVersion: priorVersion,
        migrationCount: 0,
        repaired: false
      };
    }

    if (priorVersion >= latestVersion) {
      return {
        priorVersion,
        appliedVersion: latestVersion,
        migrationCount: 0,
        repaired: false
      };
    }

    for (const migration of migrations) {
      if (migration.version <= priorVersion) {
        continue;
      }
      db.exec(migration.sql);
    }

    ensureWorkspaceMigrationStateTable(db);
    db.run(`INSERT OR REPLACE INTO migration_state (id, version, updated_at) VALUES (1, @version, datetime('now'))`, {
      version: latestVersion
    });

    return {
      priorVersion,
      appliedVersion: latestVersion,
      migrationCount: Math.max(latestVersion - priorVersion, 0),
      repaired: false
    };
  } finally {
    db.close();
  }
}

export function applyWorkspaceMigrations(dbPath: string) {
  return ensureWorkspaceMigrations(dbPath);
}

export function recreateSafeDatabase(dbPath: string) {
  if (fs.existsSync(dbPath)) {
    const backupPath = `${dbPath}.corrupt.${Date.now()}`;
    fs.renameSync(dbPath, backupPath);
  }
  const db = openDatabase({ dbPath });
  db.close();
  return true;
}

function getWorkspaceMigrationVersionFromDb(db: ReturnType<typeof openSafeDatabase>): number {
  ensureWorkspaceMigrationStateTable(db);
  const migrationRow = db.get<{ version: number }>(`SELECT version FROM migration_state LIMIT 1`);
  if (!migrationRow) {
    return 0;
  }
  return migrationRow.version;
}

function ensureWorkspaceMigrationStateTable(db: ReturnType<typeof openSafeDatabase>) {
  db.exec(MIGRATION_STATE_TABLE);
  const row = db.get<{ version: number }>(`SELECT version FROM migration_state LIMIT 1`);
  if (!row) {
    db.run(`INSERT INTO migration_state (id, version, updated_at) VALUES (1, 0, datetime('now'))`);
  }
}

function ensureWorkspaceMigrationState(db: ReturnType<typeof openSafeDatabase>) {
  ensureWorkspaceMigrationStateTable(db);
}

function openSafeDatabase(dbPath: string) {
  try {
    return openDatabase({ dbPath });
  } catch (error) {
    console.error('[sqlite-open] openSafeDatabase initial attempt failed, attempting recreate', {
      dbPath,
      errorName: (error as { name?: string })?.name,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined
    });
    recreateSafeDatabase(dbPath);
    return openDatabase({ dbPath });
  }
}
