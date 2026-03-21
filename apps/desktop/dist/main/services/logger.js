"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
class Logger {
    logFile = node_path_1.default.join(node_os_1.default.tmpdir(), 'kb-vault', 'app.log');
    constructor() {
        const dir = node_path_1.default.dirname(this.logFile);
        if (!node_fs_1.default.existsSync(dir)) {
            node_fs_1.default.mkdirSync(dir, { recursive: true });
        }
    }
    write(level, message, details) {
        const payload = `${new Date().toISOString()} [${level}] ${message} ${details ? JSON.stringify(details) : ''}\n`;
        node_fs_1.default.appendFileSync(this.logFile, payload, 'utf8');
        if (level === 'error') {
            console.error(message, details ?? '');
        }
        else if (level === 'warn') {
            console.warn(message, details ?? '');
        }
        else {
            console.log(message, details ?? '');
        }
    }
    info(message, details) {
        this.write('info', message, details);
    }
    warn(message, details) {
        this.write('warn', message, details);
    }
    error(message, details) {
        this.write('error', message, details);
    }
}
exports.logger = new Logger();
