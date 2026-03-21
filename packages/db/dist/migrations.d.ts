export interface Migration {
    version: number;
    name: string;
    description: string;
    sql: string;
}
export declare const migrations: Migration[];
export declare function getMigrationStatements(): Migration[];
