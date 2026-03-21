export interface SQLite {
    all<T>(sql: string, params?: Record<string, unknown>): T[];
    get<T>(sql: string, params?: Record<string, unknown>): T | undefined;
    run(sql: string, params?: Record<string, unknown>): {
        changes: number;
        lastInsertRowid: unknown;
    };
    exec(sql: string): void;
    prepare(sql: string): {
        all: <T>(params?: Record<string, unknown>) => T[];
        get: <T>(params?: Record<string, unknown>) => T | undefined;
        run: (params?: Record<string, unknown>) => {
            changes: number;
            lastInsertRowid: unknown;
        };
    };
    close(): void;
}
export interface OpenOptions {
    dbPath: string;
}
export declare function openDatabase({ dbPath }: OpenOptions): SQLite;
