"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpBridgeService = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_net_1 = __importDefault(require("node:net"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const logger_1 = require("./logger");
function resolveSocketPath(appName) {
    if (process.platform === 'win32') {
        return `\\\\.\\pipe\\${appName}-mcp-bridge`;
    }
    return node_path_1.default.join(node_os_1.default.tmpdir(), `${appName}-mcp-bridge.sock`);
}
class McpBridgeService {
    runtime;
    server = null;
    socketPath;
    constructor(runtime, appName = 'kb-vault') {
        this.runtime = runtime;
        this.socketPath = resolveSocketPath(appName);
    }
    getSocketPath() {
        return this.socketPath;
    }
    async start() {
        if (this.server) {
            return;
        }
        if (process.platform !== 'win32' && node_fs_1.default.existsSync(this.socketPath)) {
            node_fs_1.default.unlinkSync(this.socketPath);
        }
        this.server = node_net_1.default.createServer((socket) => {
            let buffer = '';
            socket.on('data', async (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines.map((entry) => entry.trim()).filter(Boolean)) {
                    try {
                        const response = await this.runtime.handleMcpJsonMessage(line);
                        if (response) {
                            socket.write(`${response}\n`);
                        }
                    }
                    catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        logger_1.logger.error('mcp-bridge request failed', { message });
                        socket.write(`${JSON.stringify({
                            jsonrpc: '2.0',
                            id: `${Date.now()}`,
                            error: {
                                code: -32603,
                                message
                            }
                        })}\n`);
                    }
                }
            });
            socket.on('error', (error) => {
                logger_1.logger.error('mcp-bridge socket error', {
                    message: error.message,
                    stack: error.stack
                });
            });
        });
        await new Promise((resolve, reject) => {
            this.server?.once('error', reject);
            this.server?.listen(this.socketPath, () => {
                this.server?.off('error', reject);
                logger_1.logger.info('mcp-bridge listening', { socketPath: this.socketPath });
                resolve();
            });
        });
    }
    async stop() {
        if (!this.server) {
            return;
        }
        await new Promise((resolve) => {
            this.server?.close(() => resolve());
        });
        this.server = null;
        if (process.platform !== 'win32' && node_fs_1.default.existsSync(this.socketPath)) {
            node_fs_1.default.unlinkSync(this.socketPath);
        }
    }
}
exports.McpBridgeService = McpBridgeService;
