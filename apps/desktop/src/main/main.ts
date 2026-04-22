import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import tls from 'node:tls';

type NodeTlsWithSystemCerts = typeof tls & {
  getCACertificates?: (type?: 'default' | 'bundled' | 'system' | 'extra') => string[];
  setDefaultCACertificates?: (certs: string[]) => void;
};

function splitPemCertificates(pemBundle: string): string[] {
  const matches = pemBundle.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  return matches?.map((certificate) => certificate.trim()).filter(Boolean) ?? [];
}

function loadMacSystemCertificates(): string[] {
  const tlsWithSystemCerts = tls as NodeTlsWithSystemCerts;
  if (typeof tlsWithSystemCerts.getCACertificates === 'function') {
    return tlsWithSystemCerts.getCACertificates('system');
  }

  const pemBundle = execSync(
    'security find-certificate -a -p /System/Library/Keychains/SystemRootCertificates.keychain 2>/dev/null; ' +
    'security find-certificate -a -p /Library/Keychains/System.keychain 2>/dev/null; ' +
    'security find-certificate -a -p ~/Library/Keychains/login.keychain-db 2>/dev/null',
    { encoding: 'utf8', timeout: 5000 }
  );
  return splitPemCertificates(pemBundle);
}

// On macOS, Electron's main-process fetch may not trust enterprise root CAs
// installed in the system keychain. Merge those certificates into Node's
// default CA set before any network requests run.
try {
  if (process.platform === 'darwin') {
    const tlsWithSystemCerts = tls as NodeTlsWithSystemCerts;
    if (typeof tlsWithSystemCerts.setDefaultCACertificates === 'function') {
      const defaultCertificates = typeof tlsWithSystemCerts.getCACertificates === 'function'
        ? tlsWithSystemCerts.getCACertificates('default')
        : tls.rootCertificates;
      const systemCertificates = loadMacSystemCertificates();
      if (systemCertificates.length > 0) {
        tlsWithSystemCerts.setDefaultCACertificates(
          Array.from(new Set([...defaultCertificates, ...systemCertificates]))
        );
      }
    }
  }
} catch {
  // Non-fatal: continue with default CA store
}
import {
  IPC_CHANNELS,
  type AiAssistantContextChangedEvent,
  type AiAssistantDetachedWindowMoveRequest,
  type AiAssistantDetachedWindowResizeRequest,
  type AiAssistantPresentationChangedEvent,
  type AiAssistantStreamEvent,
  type AppNavigationEvent,
  type AppWorkingStatePatchAppliedEvent,
  type JobEvent,
  type RpcRequest,
  type RpcResponse
} from '@kb-vault/shared-types';
import { resolveAppWorkspaceRoot, DEFAULT_WORKSPACE_ROOT } from './config/workspace-root';
import { loadConfig } from './config/config-loader';
import { logger } from './services/logger';
import { CommandBus } from './services/command-bus';
import { JobRegistry } from './services/job-runner';
import { registerCoreCommands } from './services/command-registry';
import { McpBridgeService } from './services/mcp-bridge-service';
import {
  getAssistantPresentationPreferences,
  getStoredSidebarCollapsedPreference,
  setAssistantPresentationPreferences,
  setSidebarCollapsedPreference
} from './services/app-preferences';
import { AssistantPresentationService } from './services/assistant-presentation-service';
import { AssistantViewContextService } from './services/assistant-view-context-service';
import { AssistantWindowManager } from './services/assistant-window-manager';

const commandBus = new CommandBus();
const jobs = new JobRegistry();
let mcpBridge: McpBridgeService | null = null;
let kbCliLoopback: { start: () => Promise<void>; stop: () => Promise<void> } | null = null;
let mainWindow: BrowserWindow | null = null;
let assistantWindowManager: AssistantWindowManager | null = null;

function broadcast(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  });
}

function loadRendererWindow(window: BrowserWindow, role: 'main' | 'assistant_detached'): void {
  const appRoot = app.isPackaged ? app.getAppPath() : process.cwd();
  const rendererDist = path.join(appRoot, 'dist', 'renderer', 'index.html');
  const rendererSource = path.join(appRoot, 'index.html');
  const packagedRenderer = rendererDist;
  const viteUrl = process.env.VITE_DEV_SERVER_URL;

  if (app.isPackaged) {
    void window.loadFile(packagedRenderer, {
      query: { windowRole: role }
    });
    return;
  }

  if (viteUrl) {
    const url = new URL(viteUrl);
    url.searchParams.set('windowRole', role);
    logger.info('Loading renderer from VITE_DEV_SERVER_URL', { viteUrl: url.toString(), role });
    void window.loadURL(url.toString());
    return;
  }

  if (fs.existsSync(rendererDist)) {
    void window.loadFile(rendererDist, {
      query: { windowRole: role }
    });
    return;
  }

  void window.loadFile(rendererSource, {
    query: { windowRole: role }
  });
}

function createMainWindow(): BrowserWindow {
  const appRoot = app.isPackaged ? app.getAppPath() : process.cwd();
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'KB Vault',
    webPreferences: {
      preload: path.join(appRoot, 'dist', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow = window;

  window.webContents.on('console-message', (_event, level, message, lineNumber, sourceId) => {
    if (message.includes('Third-party cookie will be blocked')) {
      return;
    }
    logger.info('renderer-console', {
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

  if (!app.isPackaged) {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  return window;
}

function registerIpcHandlers() {
  ipcMain.handle(IPC_CHANNELS.INVOKE, async (_event: IpcMainInvokeEvent, request: RpcRequest) => {
    const startedAt = Date.now();
    logger.info('IPC invoke', {
      requestId: request?.requestId,
      method: request?.method
    });
    const response = await commandBus.execute(request);
    const elapsedMs = Date.now() - startedAt;
    logger.info('IPC response', {
      requestId: request?.requestId,
      method: request?.method,
      elapsedMs,
      ok: response.ok
    });
    return response;
  });

  ipcMain.handle(IPC_CHANNELS.JOB_INVOKE, async (_event, payload: { command: string; input: unknown }) => {
    logger.info('JOB invoke', { command: payload?.command });
    return jobs.start(payload.command, payload.input as Record<string, unknown>);
  });
  ipcMain.handle(IPC_CHANNELS.JOB_CANCEL, async (_event, payload: { jobId: string }) => {
    const jobId = payload?.jobId;
    logger.info('JOB cancel', { jobId });
    return jobs.cancel(jobId);
  });

  ipcMain.on(IPC_CHANNELS.AI_ASSISTANT_WINDOW_MOVE, (event, payload: AiAssistantDetachedWindowMoveRequest) => {
    assistantWindowManager?.handleMoveRequest(event.sender, payload);
  });
  ipcMain.on(IPC_CHANNELS.AI_ASSISTANT_WINDOW_RESIZE, (event, payload: AiAssistantDetachedWindowResizeRequest) => {
    assistantWindowManager?.handleResizeRequest(event.sender, payload);
  });
  ipcMain.on(IPC_CHANNELS.AI_ASSISTANT_WINDOW_DRAG_END, (event) => {
    assistantWindowManager?.handleMoveEnd(event.sender);
  });

  jobs.setEmitter((event: JobEvent) => {
    broadcast(IPC_CHANNELS.JOB_EVENT, event);
  });
}

async function bootstrapApp() {
  const config = loadConfig();
  const workspaceRoot = resolveAppWorkspaceRoot(process.env.KB_VAULT_WORKSPACE_ROOT, config);
  const appRoot = app.isPackaged ? app.getAppPath() : process.cwd();
  const assistantPresentationService = new AssistantPresentationService(
    getAssistantPresentationPreferences(),
    setAssistantPresentationPreferences
  );
  const assistantViewContextService = new AssistantViewContextService();

  logger.info('Booting KB Vault', {
    workspaceRoot,
    featureFlags: config.featureFlags,
    environment: process.env.NODE_ENV ?? 'development'
  });

  assistantPresentationService.subscribe((state) => {
    const event: AiAssistantPresentationChangedEvent = { state };
    broadcast(IPC_CHANNELS.AI_ASSISTANT_PRESENTATION_EVENT, event);
  });

  assistantViewContextService.subscribe((event: AiAssistantContextChangedEvent) => {
    broadcast(IPC_CHANNELS.AI_ASSISTANT_CONTEXT_EVENT, event);
  });

  assistantWindowManager = new AssistantWindowManager({
    loadRendererWindow,
    preloadPath: path.join(appRoot, 'dist', 'preload', 'index.js'),
    presentationService: assistantPresentationService,
    getMainWindow: () => mainWindow
  });

  commandBus.register('system.boot', async () => {
    return {
      ok: true,
      data: {
        workspaceRoot,
        appVersion: app.getVersion(),
        environment: process.env.NODE_ENV ?? 'development',
        featureFlags: config.featureFlags,
        defaultWorkspaceRoot: DEFAULT_WORKSPACE_ROOT,
        uiPreferences: {
          sidebarCollapsed: getStoredSidebarCollapsedPreference() ?? undefined
        }
      }
    } as RpcResponse;
  });

  commandBus.register('system.preferences.setSidebarCollapsed', async (payload) => {
    const collapsed = (payload as { collapsed?: unknown } | undefined)?.collapsed === true;
    setSidebarCollapsedPreference(collapsed);

    return {
      ok: true,
      data: {
        sidebarCollapsed: collapsed
      }
    } as RpcResponse;
  });

  commandBus.register('system.migrate', async () => {
    return {
      ok: true,
      data: {
        status: 'migrations_dispatched',
        startedAt: new Date().toISOString()
      }
    } as RpcResponse;
  });

  commandBus.register('system.ping', async () => ({
    ok: true,
    data: {
      alive: true,
      now: new Date().toISOString()
    }
  } as RpcResponse));

  process.env.KBV_ACP_CWD = appRoot;

  const emitAppWorkingStateEvent = (event: AppWorkingStatePatchAppliedEvent) => {
    broadcast(IPC_CHANNELS.APP_WORKING_STATE_EVENT, event);
  };

  const emitAiAssistantEvent = (event: AiAssistantStreamEvent) => {
    if (event.kind === 'turn_finished' && event.messageId) {
      assistantPresentationService.handleAssistantReplyFinished();
    }
    broadcast(IPC_CHANNELS.AI_ASSISTANT_EVENT, event);
  };

  const dispatchAppNavigation = (event: AppNavigationEvent) => {
    const window = mainWindow;
    if (!window || window.isDestroyed()) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
    window.webContents.send(IPC_CHANNELS.APP_NAVIGATION_EVENT, event);
  };

  const { agentRuntime, kbCliLoopback: cliLoopback, kbCliRuntime } = registerCoreCommands(
    commandBus,
    jobs,
    workspaceRoot,
    emitAppWorkingStateEvent,
    emitAiAssistantEvent,
    assistantPresentationService,
    assistantViewContextService,
    dispatchAppNavigation
  );
  kbCliLoopback = cliLoopback;
  mcpBridge = new McpBridgeService(agentRuntime);
  await mcpBridge.start();
  await cliLoopback.start();
  kbCliRuntime.applyProcessEnv();

  const bridgeSocketPath = mcpBridge.getSocketPath();
  const bridgeScriptPath = path.join(appRoot, 'dist', 'main', 'mcp-bridge-client.js');
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

app.whenReady().then(async () => {
  await bootstrapApp();
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  assistantWindowManager?.handleBeforeQuit();
  void mcpBridge?.stop();
  void kbCliLoopback?.stop();
});
