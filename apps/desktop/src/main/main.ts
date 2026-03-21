import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { resolveAppWorkspaceRoot, DEFAULT_WORKSPACE_ROOT } from './config/workspace-root';
import { loadConfig } from './config/config-loader';
import { logger } from './services/logger';
import { CommandBus } from './services/command-bus';
import { JobRegistry } from './services/job-runner';
import { IPC_CHANNELS, type RpcRequest, type RpcResponse, type JobEvent } from '@kb-vault/shared-types';
import { registerCoreCommands } from './services/command-registry';

const commandBus = new CommandBus();
const jobs = new JobRegistry();

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

  jobs.setEmitter((event: JobEvent) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC_CHANNELS.JOB_EVENT, event);
    });
  });
}

function bootstrapApp() {
  const config = loadConfig();
  const workspaceRoot = resolveAppWorkspaceRoot(process.env.KB_VAULT_WORKSPACE_ROOT, config);

  logger.info('Booting KB Vault', {
    workspaceRoot,
    featureFlags: config.featureFlags,
    environment: process.env.NODE_ENV ?? 'development'
  });

  commandBus.register('system.boot', async () => {
    return {
      ok: true,
      data: {
        workspaceRoot,
        appVersion: app.getVersion(),
        environment: process.env.NODE_ENV ?? 'development',
        featureFlags: config.featureFlags,
        defaultWorkspaceRoot: DEFAULT_WORKSPACE_ROOT
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

  registerCoreCommands(commandBus, jobs, workspaceRoot);
}

function createWindow() {
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

  window.webContents.on('console-message', (_event, level, message, lineNumber, sourceId) => {
    logger.info('renderer-console', {
      level,
      sourceId,
      lineNumber,
      message
    });
  });

  if (app.isPackaged) {
    const packagedRenderer = path.join(appRoot, 'dist', 'renderer', 'index.html');
    window.loadFile(packagedRenderer);
  } else {
    const rendererDist = path.join(appRoot, 'dist', 'renderer', 'index.html');
    const rendererSource = path.join(appRoot, 'index.html');
    const viteUrl = process.env.VITE_DEV_SERVER_URL;

    if (viteUrl) {
      logger.info('Loading renderer from VITE_DEV_SERVER_URL', { viteUrl });
      window.loadURL(viteUrl);
    } else if (fs.existsSync(rendererDist)) {
      window.loadFile(rendererDist);
    } else {
      window.loadFile(rendererSource);
    }
  }

  if (!app.isPackaged) {
    window.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  bootstrapApp();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
