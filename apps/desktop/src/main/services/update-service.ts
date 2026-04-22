import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import * as electronUpdater from 'electron-updater';
import type { ProgressInfo, UpdateInfo } from 'electron-updater';
import type {
  AppUpdateCheckSource,
  AppUpdateInfo,
  AppUpdatePreferences,
  AppUpdateReleaseNotesEntry,
  AppUpdateState
} from '@kb-vault/shared-types';
import { logger } from './logger';

const STARTUP_AUTO_CHECK_DELAY_MS = 5_000;
const RECURRING_AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  forceDevUpdateConfig?: boolean;
  logger?: Pick<typeof logger, 'info' | 'warn' | 'error'> | null;
  on(event: string, listener: (...args: unknown[]) => void): this;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

interface AppUpdateServiceOptions {
  updater?: UpdaterLike;
  currentVersion?: string;
  getPreferences: () => AppUpdatePreferences;
  setPreferences: (preferences: AppUpdatePreferences) => void;
  logger?: Pick<typeof logger, 'info' | 'warn' | 'error'>;
  startupDelayMs?: number;
  recurringIntervalMs?: number;
  isUpdateSupported?: boolean;
  onBeforeQuitForUpdate?: () => void;
  executablePath?: string;
  platform?: NodeJS.Platform;
}

type NormalizedUpdatePreferences = {
  autoCheckEnabled: boolean;
  dismissedVersion: string | null;
  lastCheckedAt: string | null;
};

function getAutoUpdater(): UpdaterLike {
  const { autoUpdater } = electronUpdater;
  return autoUpdater;
}

function normalizeReleaseNotes(releaseNotes: UpdateInfo['releaseNotes']): AppUpdateReleaseNotesEntry[] {
  if (typeof releaseNotes === 'string') {
    const note = releaseNotes.trim();
    return note ? [{ note }] : [];
  }

  if (!Array.isArray(releaseNotes)) {
    return [];
  }

  const notes: AppUpdateReleaseNotesEntry[] = [];
  for (const entry of releaseNotes) {
    const note = typeof entry?.note === 'string' ? entry.note.trim() : '';
    if (!note) {
      continue;
    }

    notes.push({
      version: typeof entry?.version === 'string' ? entry.version : null,
      note
    });
  }

  return notes;
}

function normalizeUpdateInfo(info: UpdateInfo | null | undefined): AppUpdateInfo | null {
  if (!info?.version) {
    return null;
  }

  return {
    version: info.version,
    releaseName: typeof info.releaseName === 'string' ? info.releaseName : null,
    releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : null,
    releaseNotes: normalizeReleaseNotes(info.releaseNotes)
  };
}

function normalizePreferences(preferences: AppUpdatePreferences | null | undefined): NormalizedUpdatePreferences {
  return {
    autoCheckEnabled: preferences?.autoCheckEnabled !== false,
    dismissedVersion: typeof preferences?.dismissedVersion === 'string' && preferences.dismissedVersion.trim()
      ? preferences.dismissedVersion.trim()
      : null,
    lastCheckedAt: typeof preferences?.lastCheckedAt === 'string' && preferences.lastCheckedAt.trim()
      ? preferences.lastCheckedAt
      : null
  };
}

function resolveUpdateSupport(): boolean {
  if (app?.isPackaged) {
    return true;
  }

  return process.env.KBV_ENABLE_DEV_UPDATES === '1'
    && fs.existsSync(path.join(process.cwd(), 'dev-app-update.yml'));
}

function resolveInstalledBundlePath(executablePath: string): string | null {
  let currentPath = path.resolve(executablePath);

  while (true) {
    if (currentPath.endsWith('.app')) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }
    currentPath = parentPath;
  }
}

function buildInitialState(
  currentVersion: string,
  preferences: NormalizedUpdatePreferences,
  isUpdateSupported: boolean
): AppUpdateState {
  return {
    currentVersion,
    autoCheckEnabled: preferences.autoCheckEnabled,
    isUpdateSupported,
    status: 'idle',
    lastCheckedAt: preferences.lastCheckedAt,
    checkSource: null,
    updateInfo: null,
    downloadedVersion: null,
    downloadProgressPercent: null,
    errorMessage: null,
    shouldShowModal: false
  };
}

export class AppUpdateService {
  private readonly updater: UpdaterLike;
  private readonly currentVersion: string;
  private readonly getStoredPreferences: () => AppUpdatePreferences;
  private readonly persistPreferences: (preferences: AppUpdatePreferences) => void;
  private readonly startupDelayMs: number;
  private readonly recurringIntervalMs: number;
  private readonly isUpdateSupported: boolean;
  private readonly log: Pick<typeof logger, 'info' | 'warn' | 'error'>;
  private readonly onBeforeQuitForUpdate?: () => void;
  private readonly executablePath: string;
  private readonly platform: NodeJS.Platform;

  private preferences: NormalizedUpdatePreferences;
  private state: AppUpdateState;
  private initialized = false;
  private lastCheckSource: AppUpdateCheckSource | null = null;
  private recurringTimer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private checkPromise: Promise<AppUpdateState> | null = null;
  private downloadPromise: Promise<AppUpdateState> | null = null;
  private preparedForQuitAndInstall = false;
  private readonly subscribers = new Set<(state: AppUpdateState) => void>();

  constructor(options: AppUpdateServiceOptions) {
    this.updater = options.updater ?? getAutoUpdater();
    this.currentVersion = options.currentVersion ?? app?.getVersion?.() ?? '0.0.0';
    this.getStoredPreferences = options.getPreferences;
    this.persistPreferences = options.setPreferences;
    this.startupDelayMs = options.startupDelayMs ?? STARTUP_AUTO_CHECK_DELAY_MS;
    this.recurringIntervalMs = options.recurringIntervalMs ?? RECURRING_AUTO_CHECK_INTERVAL_MS;
    this.isUpdateSupported = options.isUpdateSupported ?? resolveUpdateSupport();
    this.log = options.logger ?? logger;
    this.onBeforeQuitForUpdate = options.onBeforeQuitForUpdate;
    this.executablePath = options.executablePath ?? app?.getPath?.('exe') ?? process.execPath;
    this.platform = options.platform ?? process.platform;
    this.preferences = normalizePreferences(this.getStoredPreferences());
    this.state = buildInitialState(this.currentVersion, this.preferences, this.isUpdateSupported);

    if (this.isUpdateSupported) {
      this.updater.autoDownload = false;
      this.updater.autoInstallOnAppQuit = true;
      this.updater.logger = this.log;
      if (!app?.isPackaged) {
        this.updater.forceDevUpdateConfig = true;
      }
    }
  }

  initialize(): void {
    if (this.initialized || !this.isUpdateSupported) {
      return;
    }

    this.initialized = true;

    this.updater.on('checking-for-update', () => {
      this.updateState({
        status: 'checking',
        errorMessage: null,
        downloadProgressPercent: null,
        downloadedVersion: null
      });
    });

    this.updater.on('update-available', (rawInfo) => {
      const info = rawInfo as UpdateInfo;
      const normalized = normalizeUpdateInfo(info);
      const shouldShowModal = Boolean(
        normalized
        && (this.lastCheckSource === 'manual' || this.preferences.dismissedVersion !== normalized.version)
      );
      this.preparedForQuitAndInstall = false;

      this.updateState({
        status: 'available',
        updateInfo: normalized,
        downloadedVersion: null,
        downloadProgressPercent: null,
        errorMessage: null,
        shouldShowModal
      });
    });

    this.updater.on('update-not-available', () => {
      this.preparedForQuitAndInstall = false;
      this.updateState({
        status: 'not_available',
        updateInfo: null,
        downloadedVersion: null,
        downloadProgressPercent: null,
        errorMessage: null,
        shouldShowModal: false
      });
    });

    this.updater.on('download-progress', (rawProgress) => {
      const progress = rawProgress as ProgressInfo;
      this.updateState({
        status: 'downloading',
        downloadProgressPercent: Math.max(0, Math.min(100, Math.round(progress.percent ?? 0))),
        errorMessage: null
      });
    });

    this.updater.on('update-downloaded', (rawInfo) => {
      const info = rawInfo as UpdateInfo;
      const normalized = normalizeUpdateInfo(info);
      this.preparedForQuitAndInstall = false;
      this.updateState({
        status: 'downloaded',
        updateInfo: normalized,
        downloadedVersion: normalized?.version ?? null,
        downloadProgressPercent: 100,
        errorMessage: null,
        shouldShowModal: true
      });
    });

    this.updater.on('error', (rawError) => {
      const error = rawError as Error;
      this.log.error('app-update-service.error', {
        message: error.message,
        stack: error.stack
      });

      this.updateState({
        status: 'error',
        errorMessage: error.message || 'Update check failed.',
        downloadProgressPercent: null
      });
    });

    this.updater.on('before-quit-for-update', () => {
      this.prepareForQuitAndInstall('updater-event');
    });

    this.refreshAutoCheckSchedule();
  }

  dispose(): void {
    this.clearTimers();
    this.subscribers.clear();
  }

  getState(): AppUpdateState {
    return this.state;
  }

  subscribe(listener: (state: AppUpdateState) => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  async checkForUpdates(source: AppUpdateCheckSource = 'manual'): Promise<AppUpdateState> {
    if (!this.isUpdateSupported) {
      this.updateState({
        status: 'error',
        checkSource: source,
        errorMessage: 'Update checks are available only in packaged builds.',
        shouldShowModal: false
      });
      return this.state;
    }

    if (this.checkPromise) {
      return this.checkPromise;
    }

    this.lastCheckSource = source;
    const checkedAt = new Date().toISOString();
    this.preferences = {
      ...this.preferences,
      lastCheckedAt: checkedAt
    };
    this.persistPreferences(this.preferences);

    this.updateState({
      status: 'checking',
      lastCheckedAt: checkedAt,
      checkSource: source,
      errorMessage: null,
      downloadProgressPercent: null,
      downloadedVersion: null,
      shouldShowModal: false
    });

    this.checkPromise = this.updater
      .checkForUpdates()
      .then(() => this.state)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.updateState({
          status: 'error',
          errorMessage: message,
          shouldShowModal: false
        });
        return this.state;
      })
      .finally(() => {
        this.checkPromise = null;
      });

    return this.checkPromise;
  }

  async downloadUpdate(): Promise<AppUpdateState> {
    if (!this.isUpdateSupported) {
      this.updateState({
        status: 'error',
        errorMessage: 'Update downloads are available only in packaged builds.',
        shouldShowModal: false
      });
      return this.state;
    }

    if (!this.state.updateInfo?.version) {
      this.updateState({
        status: 'error',
        errorMessage: 'No update is available to download.',
        shouldShowModal: false
      });
      return this.state;
    }

    if (this.downloadPromise) {
      return this.downloadPromise;
    }

    this.updateState({
      status: 'downloading',
      downloadProgressPercent: this.state.downloadProgressPercent ?? 0,
      errorMessage: null,
      shouldShowModal: true
    });

    this.downloadPromise = this.updater
      .downloadUpdate()
      .then(() => this.state)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.updateState({
          status: 'error',
          errorMessage: message,
          shouldShowModal: true
        });
        return this.state;
      })
      .finally(() => {
        this.downloadPromise = null;
      });

    return this.downloadPromise;
  }

  async setAutoCheckEnabled(enabled: boolean): Promise<AppUpdateState> {
    this.preferences = {
      ...this.preferences,
      autoCheckEnabled: enabled
    };
    this.persistPreferences(this.preferences);

    this.updateState({
      autoCheckEnabled: enabled
    });

    this.refreshAutoCheckSchedule();

    if (enabled && this.isUpdateSupported) {
      void this.checkForUpdates('automatic');
    }

    return this.state;
  }

  dismissModal(): AppUpdateState {
    if (this.state.updateInfo?.version) {
      this.preferences = {
        ...this.preferences,
        dismissedVersion: this.state.updateInfo.version
      };
      this.persistPreferences(this.preferences);
    }

    this.updateState({
      shouldShowModal: false
    });

    return this.state;
  }

  quitAndInstall(): void {
    if (!this.isUpdateSupported || this.state.status !== 'downloaded') {
      return;
    }

    const installIssue = this.resolveInstallabilityIssue();
    if (installIssue) {
      this.log.warn('app-update-service.install-preflight-failed', {
        executablePath: this.executablePath,
        issue: installIssue
      });
      this.updateState({
        status: 'error',
        errorMessage: installIssue,
        shouldShowModal: true
      });
      return;
    }

    this.prepareForQuitAndInstall('user-request');
    this.updater.quitAndInstall(false, true);
  }

  private refreshAutoCheckSchedule(): void {
    this.clearTimers();

    if (!this.isUpdateSupported || !this.preferences.autoCheckEnabled) {
      return;
    }

    this.startupTimer = setTimeout(() => {
      void this.checkForUpdates('automatic');
    }, this.startupDelayMs);
    this.startupTimer.unref?.();

    this.recurringTimer = setInterval(() => {
      void this.checkForUpdates('automatic');
    }, this.recurringIntervalMs);
    this.recurringTimer.unref?.();
  }

  private clearTimers(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }

    if (this.recurringTimer) {
      clearInterval(this.recurringTimer);
      this.recurringTimer = null;
    }
  }

  private updateState(next: Partial<AppUpdateState>): void {
    this.state = {
      ...this.state,
      ...next
    };
    this.subscribers.forEach((listener) => {
      listener(this.state);
    });
  }

  private prepareForQuitAndInstall(reason: 'user-request' | 'updater-event'): void {
    if (this.preparedForQuitAndInstall) {
      return;
    }

    this.preparedForQuitAndInstall = true;
    this.log.info('app-update-service.prepare-for-quit-and-install', {
      reason,
      currentVersion: this.state.currentVersion,
      downloadedVersion: this.state.downloadedVersion ?? this.state.updateInfo?.version ?? null
    });
    this.onBeforeQuitForUpdate?.();
  }

  private resolveInstallabilityIssue(): string | null {
    if (this.platform !== 'darwin') {
      return null;
    }

    const bundlePath = resolveInstalledBundlePath(this.executablePath);
    if (!bundlePath) {
      return 'KnowledgeBase could not determine the installed app bundle location for this update.';
    }

    if (bundlePath.startsWith('/Volumes/')) {
      return 'KnowledgeBase is running from a mounted volume. Move it to /Applications or ~/Applications, then try the update again.';
    }

    const bundleParentPath = path.dirname(bundlePath);
    try {
      fs.accessSync(bundleParentPath, fs.constants.W_OK);
    } catch {
      return `KnowledgeBase cannot install updates because ${bundleParentPath} is not writable for this account. Move the app to ~/Applications or reinstall it so this user owns the app, then try again.`;
    }

    return null;
  }
}
