"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.openCatalogDatabase = openCatalogDatabase;
exports.openWorkspaceDatabase = openWorkspaceDatabase;
exports.ensureCatalogSchema = ensureCatalogSchema;
exports.getCatalogMigrationVersion = getCatalogMigrationVersion;
exports.getLatestCatalogVersion = getLatestCatalogVersion;
exports.getWorkspaceMigrationVersion = getWorkspaceMigrationVersion;
exports.ensureWorkspaceMigrations = ensureWorkspaceMigrations;
exports.applyWorkspaceMigrations = applyWorkspaceMigrations;
exports.recreateSafeDatabase = recreateSafeDatabase;
const node_path_1 = __importDefault(require("node:path"));
const connection_1 = require("./connection");
const migrations_1 = require("./migrations");
const node_fs_1 = __importDefault(require("node:fs"));
const CATALOG_DB = node_path_1.default.join('.meta', 'catalog.sqlite');
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
    state TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0
  );
`;
const MIGRATION_STATE_TABLE = `
  CREATE TABLE IF NOT EXISTS migration_state (
    id INTEGER PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
`;
function openCatalogDatabase(rootPath) {
    const absolutePath = node_path_1.default.join(rootPath, CATALOG_DB);
    return openSafeDatabase(absolutePath);
}
function openWorkspaceDatabase(dbPath) {
    return openSafeDatabase(dbPath);
}
function ensureCatalogSchema(dbPath) {
    const catalog = openSafeDatabase(dbPath);
    try {
        catalog.exec(CATALOG_SQL);
        const state = catalog.get(`SELECT version FROM migration_state ORDER BY id DESC LIMIT 1`);
        if (!state) {
            catalog.run(`INSERT INTO migration_state (id, version, updated_at) VALUES (1, 0, datetime('now'))`);
        }
        return catalog;
    }
    catch (error) {
        catalog.close();
        throw error;
    }
}
function getCatalogMigrationVersion(dbPath) {
    const catalog = ensureCatalogSchema(dbPath);
    try {
        const row = catalog.get(`SELECT version FROM migration_state ORDER BY id DESC LIMIT 1`);
        return row?.version ?? 0;
    }
    finally {
        catalog.close();
    }
}
function getLatestCatalogVersion(db) {
    const row = db.get(`SELECT version FROM migration_state ORDER BY id DESC LIMIT 1`);
    return row?.version ?? 0;
}
function getWorkspaceMigrationVersion(dbPath) {
    const db = openSafeDatabase(dbPath);
    try {
        ensureWorkspaceMigrationState(db);
        const row = db.get(`SELECT version, updated_at AS updatedAt FROM migration_state`);
        return row?.version ?? 0;
    }
    finally {
        db.close();
    }
}
function ensureWorkspaceMigrations(dbPath) {
    const db = openSafeDatabase(dbPath);
    try {
        const priorVersion = getWorkspaceMigrationVersionFromDb(db);
        const migrations = (0, migrations_1.getMigrationStatements)();
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
    }
    finally {
        db.close();
    }
}
function applyWorkspaceMigrations(dbPath) {
    return ensureWorkspaceMigrations(dbPath);
}
function recreateSafeDatabase(dbPath) {
    if (node_fs_1.default.existsSync(dbPath)) {
        const backupPath = `${dbPath}.corrupt.${Date.now()}`;
        node_fs_1.default.renameSync(dbPath, backupPath);
    }
    const db = (0, connection_1.openDatabase)({ dbPath });
    db.close();
    return true;
}
function getWorkspaceMigrationVersionFromDb(db) {
    ensureWorkspaceMigrationStateTable(db);
    const migrationRow = db.get(`SELECT version FROM migration_state LIMIT 1`);
    if (!migrationRow) {
        return 0;
    }
    return migrationRow.version;
}
function ensureWorkspaceMigrationStateTable(db) {
    db.exec(MIGRATION_STATE_TABLE);
    const row = db.get(`SELECT version FROM migration_state LIMIT 1`);
    if (!row) {
        db.run(`INSERT INTO migration_state (id, version, updated_at) VALUES (1, 0, datetime('now'))`);
    }
}
function ensureWorkspaceMigrationState(db) {
    ensureWorkspaceMigrationStateTable(db);
}
function openSafeDatabase(dbPath) {
    try {
        return (0, connection_1.openDatabase)({ dbPath });
    }
    catch (error) {
        console.error('[sqlite-open] openSafeDatabase initial attempt failed, attempting recreate', {
            dbPath,
            errorName: error?.name,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined
        });
        recreateSafeDatabase(dbPath);
        return (0, connection_1.openDatabase)({ dbPath });
    }
}
