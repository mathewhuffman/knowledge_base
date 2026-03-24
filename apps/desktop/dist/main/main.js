"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const workspace_root_1 = require("./config/workspace-root");
const config_loader_1 = require("./config/config-loader");
const logger_1 = require("./services/logger");
const command_bus_1 = require("./services/command-bus");
const job_runner_1 = require("./services/job-runner");
const shared_types_1 = require("@kb-vault/shared-types");
const command_registry_1 = require("./services/command-registry");
const mcp_bridge_service_1 = require("./services/mcp-bridge-service");
const app_preferences_1 = require("./services/app-preferences");
const commandBus = new command_bus_1.CommandBus();
const jobs = new job_runner_1.JobRegistry();
let mcpBridge = null;
let kbCliLoopback = null;
function registerIpcHandlers() {
    electron_1.ipcMain.handle(shared_types_1.IPC_CHANNELS.INVOKE, async (_event, request) => {
        const startedAt = Date.now();
        logger_1.logger.info('IPC invoke', {
            requestId: request?.requestId,
            method: request?.method
        });
        const response = await commandBus.execute(request);
        const elapsedMs = Date.now() - startedAt;
        logger_1.logger.info('IPC response', {
            requestId: request?.requestId,
            method: request?.method,
            elapsedMs,
            ok: response.ok
        });
        return response;
    });
    electron_1.ipcMain.handle(shared_types_1.IPC_CHANNELS.JOB_INVOKE, async (_event, payload) => {
        logger_1.logger.info('JOB invoke', { command: payload?.command });
        return jobs.start(payload.command, payload.input);
    });
    electron_1.ipcMain.handle(shared_types_1.IPC_CHANNELS.JOB_CANCEL, async (_event, payload) => {
        const jobId = payload?.jobId;
        logger_1.logger.info('JOB cancel', { jobId });
        return jobs.cancel(jobId);
    });
    jobs.setEmitter((event) => {
        electron_1.BrowserWindow.getAllWindows().forEach((win) => {
            win.webContents.send(shared_types_1.IPC_CHANNELS.JOB_EVENT, event);
        });
    });
}
async function bootstrapApp() {
    const config = (0, config_loader_1.loadConfig)();
    const workspaceRoot = (0, workspace_root_1.resolveAppWorkspaceRoot)(process.env.KB_VAULT_WORKSPACE_ROOT, config);
    const appRoot = electron_1.app.isPackaged ? electron_1.app.getAppPath() : process.cwd();
    logger_1.logger.info('Booting KB Vault', {
        workspaceRoot,
        featureFlags: config.featureFlags,
        environment: process.env.NODE_ENV ?? 'development'
    });
    commandBus.register('system.boot', async () => {
        return {
            ok: true,
            data: {
                workspaceRoot,
                appVersion: electron_1.app.getVersion(),
                environment: process.env.NODE_ENV ?? 'development',
                featureFlags: config.featureFlags,
                defaultWorkspaceRoot: workspace_root_1.DEFAULT_WORKSPACE_ROOT,
                uiPreferences: {
                    sidebarCollapsed: (0, app_preferences_1.getSidebarCollapsedPreference)()
                }
            }
        };
    });
    commandBus.register('system.preferences.setSidebarCollapsed', async (payload) => {
        const collapsed = payload?.collapsed === true;
        (0, app_preferences_1.setSidebarCollapsedPreference)(collapsed);
        return {
            ok: true,
            data: {
                sidebarCollapsed: collapsed
            }
        };
    });
    commandBus.register('system.migrate', async () => {
        return {
            ok: true,
            data: {
                status: 'migrations_dispatched',
                startedAt: new Date().toISOString()
            }
        };
    });
    commandBus.register('system.ping', async () => ({
        ok: true,
        data: {
            alive: true,
            now: new Date().toISOString()
        }
    }));
    process.env.KBV_ACP_CWD = appRoot;
    const emitAppWorkingStateEvent = (event) => {
        electron_1.BrowserWindow.getAllWindows().forEach((win) => {
            win.webContents.send(shared_types_1.IPC_CHANNELS.APP_WORKING_STATE_EVENT, event);
        });
    };
    const { agentRuntime, kbCliLoopback: cliLoopback, kbCliRuntime } = (0, command_registry_1.registerCoreCommands)(commandBus, jobs, workspaceRoot, emitAppWorkingStateEvent);
    kbCliLoopback = cliLoopback;
    mcpBridge = new mcp_bridge_service_1.McpBridgeService(agentRuntime);
    await mcpBridge.start();
    await cliLoopback.start();
    kbCliRuntime.applyProcessEnv();
    const bridgeSocketPath = mcpBridge.getSocketPath();
    const bridgeScriptPath = node_path_1.default.join(appRoot, 'dist', 'main', 'mcp-bridge-client.js');
    const nodeBinary = process.env.KBV_NODE_BINARY ?? 'node';
    agentRuntime.setMcpServerConfigs([
        {
            type: 'stdio',
            name: 'kb-vault',
            command: nodeBinary,
            args: [bridgeScriptPath],
            env: [
                {
                    name: 'KBV_MCP_BRIDGE_SOCKET_PATH',
                    value: bridgeSocketPath
                }
            ]
        }
    ]);
}
function createWindow() {
    const appRoot = electron_1.app.isPackaged ? electron_1.app.getAppPath() : process.cwd();
    const window = new electron_1.BrowserWindow({
        width: 1280,
        height: 860,
        title: 'KB Vault',
        webPreferences: {
            preload: node_path_1.default.join(appRoot, 'dist', 'preload', 'index.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    window.webContents.on('console-message', (_event, level, message, lineNumber, sourceId) => {
        if (message.includes('Third-party cookie will be blocked')) {
            return;
        }
        logger_1.logger.info('renderer-console', {
            level,
            sourceId,
            lineNumber,
            message
        });
    });
    if (electron_1.app.isPackaged) {
        const packagedRenderer = node_path_1.default.join(appRoot, 'dist', 'renderer', 'index.html');
        window.loadFile(packagedRenderer);
    }
    else {
        const rendererDist = node_path_1.default.join(appRoot, 'dist', 'renderer', 'index.html');
        const rendererSource = node_path_1.default.join(appRoot, 'index.html');
        const viteUrl = process.env.VITE_DEV_SERVER_URL;
        if (viteUrl) {
            logger_1.logger.info('Loading renderer from VITE_DEV_SERVER_URL', { viteUrl });
            window.loadURL(viteUrl);
        }
        else if (node_fs_1.default.existsSync(rendererDist)) {
            window.loadFile(rendererDist);
        }
        else {
            window.loadFile(rendererSource);
        }
    }
    if (!electron_1.app.isPackaged) {
        window.webContents.openDevTools({ mode: 'detach' });
    }
}
electron_1.app.whenReady().then(async () => {
    await bootstrapApp();
    registerIpcHandlers();
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', () => {
    void mcpBridge?.stop();
    void kbCliLoopback?.stop();
});
