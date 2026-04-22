import fs from 'node:fs';
import os from 'node:os';
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
  installAttemptVersion: string | null;
  installAttemptedAt: string | null;
};

type FileStatDetails = {
  exists: boolean;
  mode: string | null;
  uid: number | null;
  gid: number | null;
  mtimeMs: number | null;
};

type InstallTargetDiagnostics = {
  executablePath: string;
  executableRealPath: string | null;
  executableWritable: boolean | null;
  bundlePath: string | null;
  bundleRealPath: string | null;
  bundleWritable: boolean | null;
  bundleExists: boolean;
  bundleParentPath: string | null;
  bundleParentWritable: boolean | null;
  bundleParentExists: boolean;
  launchedFromMountedVolume: boolean;
  launchedFromApplications: boolean;
  launchedFromUserApplications: boolean;
  appIsInApplicationsFolder: boolean | null;
  processUid: number | null;
  processGid: number | null;
  executableDetails: FileStatDetails;
  bundleDetails: FileStatDetails;
  bundleParentDetails: FileStatDetails;
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
      : null,
    installAttemptVersion:
      typeof preferences?.installAttemptVersion === 'string' && preferences.installAttemptVersion.trim()
        ? preferences.installAttemptVersion.trim()
        : null,
    installAttemptedAt: typeof preferences?.installAttemptedAt === 'string' && preferences.installAttemptedAt.trim()
      ? preferences.installAttemptedAt
      : null
  };
}

function isWritable(targetPath: string | null): boolean | null {
  if (!targetPath) {
    return null;
  }

  try {
    fs.accessSync(targetPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveRealPath(targetPath: string | null): string | null {
  if (!targetPath) {
    return null;
  }

  try {
    return fs.realpathSync(targetPath);
  } catch {
    return null;
  }
}

function readStatDetails(targetPath: string | null): FileStatDetails {
  if (!targetPath) {
    return {
      exists: false,
      mode: null,
      uid: null,
      gid: null,
      mtimeMs: null
    };
  }

  try {
    const stats = fs.statSync(targetPath);
    return {
      exists: true,
      mode: `0${(stats.mode & 0o777).toString(8)}`,
      uid: typeof stats.uid === 'number' ? stats.uid : null,
      gid: typeof stats.gid === 'number' ? stats.gid : null,
      mtimeMs: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : null
    };
  } catch {
    return {
      exists: false,
      mode: null,
      uid: null,
      gid: null,
      mtimeMs: null
    };
  }
}

function compareVersions(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

function collectInstallTargetDiagnostics(
  executablePath: string,
  isInApplicationsFolder: boolean | null
): InstallTargetDiagnostics {
  const normalizedExecutablePath = path.resolve(executablePath);
  const bundlePath = resolveInstalledBundlePath(normalizedExecutablePath);
  const bundleParentPath = bundlePath ? path.dirname(bundlePath) : null;
  const bundleRealPath = resolveRealPath(bundlePath);
  const executableRealPath = resolveRealPath(normalizedExecutablePath);
  const userApplicationsPath = path.join(os.homedir(), 'Applications');

  return {
    executablePath: normalizedExecutablePath,
    executableRealPath,
    executableWritable: isWritable(normalizedExecutablePath),
    bundlePath,
    bundleRealPath,
    bundleWritable: isWritable(bundlePath),
    bundleExists: Boolean(bundlePath && fs.existsSync(bundlePath)),
    bundleParentPath,
    bundleParentWritable: isWritable(bundleParentPath),
    bundleParentExists: Boolean(bundleParentPath && fs.existsSync(bundleParentPath)),
    launchedFromMountedVolume: Boolean(bundlePath?.startsWith('/Volumes/')),
    launchedFromApplications: Boolean(bundlePath?.startsWith('/Applications/')),
    launchedFromUserApplications: Boolean(bundlePath?.startsWith(userApplicationsPath)),
    appIsInApplicationsFolder: isInApplicationsFolder,
    processUid: typeof process.getuid === 'function' ? process.getuid() : null,
    processGid: typeof process.getgid === 'function' ? process.getgid() : null,
    executableDetails: readStatDetails(normalizedExecutablePath),
    bundleDetails: readStatDetails(bundlePath),
    bundleParentDetails: readStatDetails(bundleParentPath)
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
    this.preferences = this.reconcileInstallAttemptState(this.preferences);
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
      const installAttemptFailure = normalized ? this.consumeFailedInstallAttempt(normalized.version) : null;
      const shouldShowModal = Boolean(
        normalized
        && (
          Boolean(installAttemptFailure)
          || this.lastCheckSource === 'manual'
          || this.preferences.dismissedVersion !== normalized.version
        )
      );
      this.preparedForQuitAndInstall = false;

      this.updateState({
        status: 'available',
        updateInfo: normalized,
        downloadedVersion: null,
        downloadProgressPercent: null,
        errorMessage: installAttemptFailure,
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

    const installDiagnostics = this.buildInstallDiagnostics();
    const installIssue = this.resolveInstallabilityIssue();
    if (installIssue) {
      this.log.warn('app-update-service.install-preflight-failed', {
        issue: installIssue,
        ...installDiagnostics
      });
      this.updateState({
        status: 'error',
        errorMessage: installIssue,
        shouldShowModal: true
      });
      return;
    }

    this.recordInstallAttempt(this.state.downloadedVersion ?? this.state.updateInfo?.version ?? null);
    this.log.info('app-update-service.install-diagnostics', {
      phase: 'quit_and_install',
      ...installDiagnostics,
      attemptedVersion: this.preferences.installAttemptVersion,
      attemptedAt: this.preferences.installAttemptedAt
    });
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
      downloadedVersion: this.state.downloadedVersion ?? this.state.updateInfo?.version ?? null,
      attemptedVersion: this.preferences.installAttemptVersion,
      attemptedAt: this.preferences.installAttemptedAt,
      ...this.buildInstallDiagnostics()
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

  private reconcileInstallAttemptState(preferences: NormalizedUpdatePreferences): NormalizedUpdatePreferences {
    if (!preferences.installAttemptVersion) {
      return preferences;
    }

    if (compareVersions(this.currentVersion, preferences.installAttemptVersion) >= 0) {
      const nextPreferences = {
        ...preferences,
        installAttemptVersion: null,
        installAttemptedAt: null
      };
      this.persistPreferences(nextPreferences);
      this.log.info('app-update-service.install-attempt-applied', {
        currentVersion: this.currentVersion,
        installedVersion: preferences.installAttemptVersion,
        attemptedAt: preferences.installAttemptedAt,
        ...this.buildInstallDiagnostics()
      });
      return nextPreferences;
    }

    this.log.warn('app-update-service.install-attempt-pending-after-relaunch', {
      currentVersion: this.currentVersion,
      attemptedVersion: preferences.installAttemptVersion,
      attemptedAt: preferences.installAttemptedAt,
      ...this.buildInstallDiagnostics()
    });

    return preferences;
  }

  private consumeFailedInstallAttempt(availableVersion: string): string | null {
    const attemptedVersion = this.preferences.installAttemptVersion;
    if (!attemptedVersion || attemptedVersion !== availableVersion) {
      return null;
    }

    const attemptedAt = this.preferences.installAttemptedAt;
    this.preferences = {
      ...this.preferences,
      installAttemptVersion: null,
      installAttemptedAt: null
    };
    this.persistPreferences(this.preferences);

    this.log.warn('app-update-service.install-attempt-did-not-apply', {
      currentVersion: this.currentVersion,
      attemptedVersion,
      attemptedAt,
      availableVersion,
      ...this.buildInstallDiagnostics()
    });

    return this.buildInstallFailureMessage(attemptedVersion);
  }

  private recordInstallAttempt(version: string | null): void {
    if (!version) {
      return;
    }

    this.preferences = {
      ...this.preferences,
      installAttemptVersion: version,
      installAttemptedAt: new Date().toISOString()
    };
    this.persistPreferences(this.preferences);
  }

  private buildInstallFailureMessage(targetVersion: string): string {
    const bundlePath = resolveInstalledBundlePath(this.executablePath);
    if (bundlePath) {
      return `KnowledgeBase restarted, but version ${targetVersion} did not replace ${bundlePath}. Check the updater logs for the recorded bundle diagnostics, close any duplicate KnowledgeBase copies, and reinstall the latest DMG manually if needed.`;
    }

    return `KnowledgeBase restarted, but version ${targetVersion} did not replace the installed app bundle. Check the updater logs for the recorded bundle diagnostics and reinstall the latest DMG manually if needed.`;
  }

  private buildInstallDiagnostics(): InstallTargetDiagnostics {
    let isInApplicationsFolder: boolean | null = null;
    if (this.platform === 'darwin' && typeof app?.isInApplicationsFolder === 'function') {
      try {
        isInApplicationsFolder = app.isInApplicationsFolder();
      } catch {
        isInApplicationsFolder = null;
      }
    }

    return collectInstallTargetDiagnostics(this.executablePath, isInApplicationsFolder);
  }
}
