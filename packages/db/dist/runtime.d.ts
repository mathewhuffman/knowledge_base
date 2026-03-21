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
export declare function openCatalogDatabase(rootPath: string): import("./connection").SQLite;
export declare function openWorkspaceDatabase(dbPath: string): import("./connection").SQLite;
export declare function ensureCatalogSchema(dbPath: string): import("./connection").SQLite;
export declare function getCatalogMigrationVersion(dbPath: string): number;
export declare function getLatestCatalogVersion(db: ReturnType<typeof ensureCatalogSchema>): number;
export declare function getWorkspaceMigrationVersion(dbPath: string): number;
export declare function ensureWorkspaceMigrations(dbPath: string): {
    priorVersion: number;
    appliedVersion: number;
    migrationCount: number;
    repaired: boolean;
};
export declare function applyWorkspaceMigrations(dbPath: string): {
    priorVersion: number;
    appliedVersion: number;
    migrationCount: number;
    repaired: boolean;
};
export declare function recreateSafeDatabase(dbPath: string): boolean;
