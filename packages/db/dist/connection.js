"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.openDatabase = openDatabase;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const node_util_1 = require("node:util");
function safePragma(db, pragma) {
    try {
        db.pragma(pragma);
    }
    catch (error) {
        console.error('[sqlite-pragma]', {
            pragma,
            errorName: error?.name,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
            errorDetails: (0, node_util_1.inspect)(error, { depth: 3, compact: false })
        });
    }
}
function openDatabase({ dbPath }) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(dbPath), { recursive: true });
    const db = new better_sqlite3_1.default(dbPath);
    safePragma(db, 'journal_mode = WAL');
    safePragma(db, 'foreign_keys = ON');
    return wrapDatabase(db);
}
function wrapDatabase(db) {
    return {
        all(sql, params = {}) {
            return db.prepare(sql).all(params);
        },
        get(sql, params = {}) {
            return db.prepare(sql).get(params);
        },
        run(sql, params = {}) {
            const result = db.prepare(sql).run(params);
            return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
        },
        exec(sql) {
            db.exec(sql);
        },
        prepare(sql) {
            const stmt = db.prepare(sql);
            return {
                all(params = {}) {
                    return stmt.all(params);
                },
                get(params = {}) {
                    return stmt.get(params);
                },
                run(params = {}) {
                    const result = stmt.run(params);
                    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
                }
            };
        },
        close() {
            db.close();
        }
    };
}
