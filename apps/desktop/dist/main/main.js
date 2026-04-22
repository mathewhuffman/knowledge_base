"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const node_tls_1 = __importDefault(require("node:tls"));
function splitPemCertificates(pemBundle) {
    const matches = pemBundle.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    return matches?.map((certificate) => certificate.trim()).filter(Boolean) ?? [];
}
function loadMacSystemCertificates() {
    const tlsWithSystemCerts = node_tls_1.default;
    if (typeof tlsWithSystemCerts.getCACertificates === 'function') {
        return tlsWithSystemCerts.getCACertificates('system');
    }
    const pemBundle = (0, node_child_process_1.execSync)('security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain 2>/dev/null; ' +
        'security find-certificate -a -p /Library/Keychains/System.keychain 2>/dev/null; ' +
        'security find-certificate -a -p ~/Library/Keychains/login.keychain-db 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
    return splitPemCertificates(pemBundle);
}
// On macOS, Electron's main-process fetch may not trust enterprise root CAs
// installed in the system keychain. Merge those certificates into Node's
// default CA set before any network requests run.
try {
    if (process.platform === 'darwin') {
        const tlsWithSystemCerts = node_tls_1.default;
        if (typeof tlsWithSystemCerts.setDefaultCACertificates === 'function') {
            const defaultCertificates = typeof tlsWithSystemCerts.getCACertificates === 'function'
                ? tlsWithSystemCerts.getCACertificates('default')
                : node_tls_1.default.rootCertificates;
            const systemCertificates = loadMacSystemCertificates();
            if (systemCertificates.length > 0) {
                tlsWithSystemCerts.setDefaultCACertificates(Array.from(new Set([...defaultCertificates, ...systemCertificates])));
            }
        }
    }
}
catch {
    // Non-fatal: continue with default CA store
}
const shared_types_1 = require("@kb-vault/shared-types");
const workspace_root_1 = require("./config/workspace-root");
const config_loader_1 = require("./config/config-loader");
const logger_1 = require("./services/logger");
const command_bus_1 = require("./services/command-bus");
const job_runner_1 = require("./services/job-runner");
const command_registry_1 = require("./services/command-registry");
const mcp_bridge_service_1 = require("./services/mcp-bridge-service");
const app_preferences_1 = require("./services/app-preferences");
const assistant_presentation_service_1 = require("./services/assistant-presentation-service");
const assistant_view_context_service_1 = require("./services/assistant-view-context-service");
const assistant_window_manager_1 = require("./services/assistant-window-manager");
const commandBus = new command_bus_1.CommandBus();
const jobs = new job_runner_1.JobRegistry();
let mcpBridge = null;
let kbCliLoopback = null;
let mainWindow = null;
let assistantWindowManager = null;
function broadcast(channel, payload) {
    electron_1.BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
            window.webContents.send(channel, payload);
        }
    });
}
function loadRendererWindow(window, role) {
    const appRoot = electron_1.app.isPackaged ? electron_1.app.getAppPath() : process.cwd();
    const rendererDist = node_path_1.default.join(appRoot, 'dist', 'renderer', 'index.html');
    const rendererSource = node_path_1.default.join(appRoot, 'index.html');
    const packagedRenderer = rendererDist;
    const viteUrl = process.env.VITE_DEV_SERVER_URL;
    if (electron_1.app.isPackaged) {
        void window.loadFile(packagedRenderer, {
            query: { windowRole: role }
        });
        return;
    }
    if (viteUrl) {
        const url = new URL(viteUrl);
        url.searchParams.set('windowRole', role);
        logger_1.logger.info('Loading renderer from VITE_DEV_SERVER_URL', { viteUrl: url.toString(), role });
        void window.loadURL(url.toString());
        return;
    }
    if (node_fs_1.default.existsSync(rendererDist)) {
        void window.loadFile(rendererDist, {
            query: { windowRole: role }
        });
        return;
    }
    void window.loadFile(rendererSource, {
        query: { windowRole: role }
    });
}
function createMainWindow() {
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
    mainWindow = window;
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
    window.on('closed', () => {
        if (mainWindow === window) {
            mainWindow = null;
        }
    });
    loadRendererWindow(window, 'main');
    if (!electron_1.app.isPackaged) {
        window.webContents.openDevTools({ mode: 'detach' });
    }
    return window;
}
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
    electron_1.ipcMain.on(shared_types_1.IPC_CHANNELS.AI_ASSISTANT_WINDOW_MOVE, (event, payload) => {
        assistantWindowManager?.handleMoveRequest(event.sender, payload);
    });
    electron_1.ipcMain.on(shared_types_1.IPC_CHANNELS.AI_ASSISTANT_WINDOW_RESIZE, (event, payload) => {
        assistantWindowManager?.handleResizeRequest(event.sender, payload);
    });
    electron_1.ipcMain.on(shared_types_1.IPC_CHANNELS.AI_ASSISTANT_WINDOW_DRAG_END, (event) => {
        assistantWindowManager?.handleMoveEnd(event.sender);
    });
    jobs.setEmitter((event) => {
        broadcast(shared_types_1.IPC_CHANNELS.JOB_EVENT, event);
    });
}
async function bootstrapApp() {
    const config = (0, config_loader_1.loadConfig)();
    const workspaceRoot = (0, workspace_root_1.resolveAppWorkspaceRoot)(process.env.KB_VAULT_WORKSPACE_ROOT, config);
    const appRoot = electron_1.app.isPackaged ? electron_1.app.getAppPath() : process.cwd();
    const assistantPresentationService = new assistant_presentation_service_1.AssistantPresentationService((0, app_preferences_1.getAssistantPresentationPreferences)(), app_preferences_1.setAssistantPresentationPreferences);
    const assistantViewContextService = new assistant_view_context_service_1.AssistantViewContextService();
    logger_1.logger.info('Booting KB Vault', {
        workspaceRoot,
        featureFlags: config.featureFlags,
        environment: process.env.NODE_ENV ?? 'development'
    });
    assistantPresentationService.subscribe((state) => {
        const event = { state };
        broadcast(shared_types_1.IPC_CHANNELS.AI_ASSISTANT_PRESENTATION_EVENT, event);
    });
    assistantViewContextService.subscribe((event) => {
        broadcast(shared_types_1.IPC_CHANNELS.AI_ASSISTANT_CONTEXT_EVENT, event);
    });
    assistantWindowManager = new assistant_window_manager_1.AssistantWindowManager({
        loadRendererWindow,
        preloadPath: node_path_1.default.join(appRoot, 'dist', 'preload', 'index.js'),
        presentationService: assistantPresentationService,
        getMainWindow: () => mainWindow
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
                    sidebarCollapsed: (0, app_preferences_1.getStoredSidebarCollapsedPreference)() ?? undefined
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
        broadcast(shared_types_1.IPC_CHANNELS.APP_WORKING_STATE_EVENT, event);
    };
    const emitAiAssistantEvent = (event) => {
        if (event.kind === 'turn_finished' && event.messageId) {
            assistantPresentationService.handleAssistantReplyFinished();
        }
        broadcast(shared_types_1.IPC_CHANNELS.AI_ASSISTANT_EVENT, event);
    };
    const dispatchAppNavigation = (event) => {
        const window = mainWindow;
        if (!window || window.isDestroyed()) {
            return;
        }
        if (window.isMinimized()) {
            window.restore();
        }
        window.show();
        window.focus();
        window.webContents.send(shared_types_1.IPC_CHANNELS.APP_NAVIGATION_EVENT, event);
    };
    const { agentRuntime, kbCliLoopback: cliLoopback, kbCliRuntime } = (0, command_registry_1.registerCoreCommands)(commandBus, jobs, workspaceRoot, emitAppWorkingStateEvent, emitAiAssistantEvent, assistantPresentationService, assistantViewContextService, dispatchAppNavigation);
    kbCliLoopback = cliLoopback;
    mcpBridge = new mcp_bridge_service_1.McpBridgeService(agentRuntime);
    await mcpBridge.start();
    await cliLoopback.start();
    kbCliRuntime.applyProcessEnv();
    const bridgeSocketPath = mcpBridge.getSocketPath();
    const bridgeScriptPath = node_path_1.default.join(appRoot, 'dist', 'main', 'mcp-bridge-client.js');
    const nodeBinary = process.env.KBV_NODE_BINARY ?? 'node';
    process.env.KBV_MCP_BRIDGE_SOCKET_PATH = bridgeSocketPath;
    process.env.KBV_MCP_BRIDGE_SCRIPT = bridgeScriptPath;
    process.env.KBV_NODE_BINARY = nodeBinary;
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
electron_1.app.whenReady().then(async () => {
    await bootstrapApp();
    registerIpcHandlers();
    createMainWindow();
    electron_1.app.on('activate', () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            createMainWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', () => {
    assistantWindowManager?.handleBeforeQuit();
    void mcpBridge?.stop();
    void kbCliLoopback?.stop();
});
