import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { AppUpdatePreferences } from '@kb-vault/shared-types';
import { AppUpdateService, type UpdaterLike } from '../src/main/services/update-service';

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  forceDevUpdateConfig = false;
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  quitAndInstallCallCount = 0;

  nextVersion = '0.2.0';
  nextReleaseNotes = 'Improved updater flow.';

  async checkForUpdates(): Promise<void> {
    this.emit('checking-for-update');
    this.emit('update-available', {
      version: this.nextVersion,
      releaseName: `KB Vault ${this.nextVersion}`,
      releaseDate: '2026-04-22T00:00:00.000Z',
      releaseNotes: this.nextReleaseNotes
    });
  }

  async downloadUpdate(): Promise<void> {
    this.emit('download-progress', { percent: 42 });
    this.emit('update-downloaded', {
      version: this.nextVersion,
      releaseName: `KB Vault ${this.nextVersion}`,
      releaseDate: '2026-04-22T00:00:00.000Z',
      releaseNotes: this.nextReleaseNotes
    });
  }

  quitAndInstall(): void {
    this.quitAndInstallCallCount += 1;
    this.emit('before-quit-for-update');
    this.emit('quit-and-install');
  }
}

function createLoggerSpy() {
  const entries: Array<{ level: 'info' | 'warn' | 'error'; message: string; payload: unknown[] }> = [];
  return {
    entries,
    logger: {
      info(message: string, ...payload: unknown[]) {
        entries.push({ level: 'info', message, payload });
      },
      warn(message: string, ...payload: unknown[]) {
        entries.push({ level: 'warn', message, payload });
      },
      error(message: string, ...payload: unknown[]) {
        entries.push({ level: 'error', message, payload });
      }
    }
  };
}

test.describe('app update service', () => {
  test('checks automatically by default and suppresses repeat automatic prompts for the same dismissed version', async () => {
    const updater = new FakeUpdater();
    let storedPreferences: AppUpdatePreferences = {};
    const service = new AppUpdateService({
      updater,
      currentVersion: '0.1.0',
      isUpdateSupported: true,
      startupDelayMs: 60_000,
      recurringIntervalMs: 60_000,
      getPreferences: () => storedPreferences,
      setPreferences: (nextPreferences) => {
        storedPreferences = nextPreferences;
      }
    });

    service.initialize();

    expect(service.getState().autoCheckEnabled).toBe(true);

    await service.checkForUpdates('automatic');
    expect(service.getState().status).toBe('available');
    expect(service.getState().shouldShowModal).toBe(true);
    expect(service.getState().updateInfo?.version).toBe('0.2.0');

    service.dismissModal();
    expect(service.getState().shouldShowModal).toBe(false);
    expect(storedPreferences.dismissedVersion).toBe('0.2.0');

    await service.checkForUpdates('automatic');
    expect(service.getState().shouldShowModal).toBe(false);

    await service.checkForUpdates('manual');
    expect(service.getState().shouldShowModal).toBe(true);

    service.dispose();
  });

  test('tracks download progress and marks the update as ready to install', async () => {
    const updater = new FakeUpdater();
    const service = new AppUpdateService({
      updater,
      currentVersion: '0.1.0',
      isUpdateSupported: true,
      startupDelayMs: 60_000,
      recurringIntervalMs: 60_000,
      getPreferences: () => ({}),
      setPreferences: () => undefined
    });

    service.initialize();
    await service.checkForUpdates('manual');
    await service.downloadUpdate();

    expect(service.getState().status).toBe('downloaded');
    expect(service.getState().downloadProgressPercent).toBe(100);
    expect(service.getState().downloadedVersion).toBe('0.2.0');
    expect(service.getState().shouldShowModal).toBe(true);

    service.dispose();
  });

  test('prepares app shutdown before install and keeps install-on-quit fallback enabled', async () => {
    const updater = new FakeUpdater();
    const lifecycleEvents: string[] = [];
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-update-service-'));
    const executablePath = path.join(
      tempRoot,
      'Applications',
      'KnowledgeBase.app',
      'Contents',
      'MacOS',
      'KnowledgeBase'
    );
    fs.mkdirSync(path.dirname(executablePath), { recursive: true });
    fs.writeFileSync(executablePath, '');
    const service = new AppUpdateService({
      updater,
      currentVersion: '0.1.0',
      isUpdateSupported: true,
      startupDelayMs: 60_000,
      recurringIntervalMs: 60_000,
      getPreferences: () => ({}),
      setPreferences: () => undefined,
      executablePath,
      platform: 'darwin',
      onBeforeQuitForUpdate: () => {
        lifecycleEvents.push('prepare-for-quit');
      }
    });

    try {
      service.initialize();
      await service.checkForUpdates('manual');
      await service.downloadUpdate();

      expect(updater.autoInstallOnAppQuit).toBe(true);

      service.quitAndInstall();

      expect(updater.quitAndInstallCallCount).toBe(1);
      expect(lifecycleEvents).toEqual(['prepare-for-quit']);

      service.dispose();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('shows a clear macOS install error when the app bundle location is not writable', async () => {
    const updater = new FakeUpdater();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-update-service-'));
    const lockedApplicationsPath = path.join(tempRoot, 'Applications');
    const executablePath = path.join(
      lockedApplicationsPath,
      'KnowledgeBase.app',
      'Contents',
      'MacOS',
      'KnowledgeBase'
    );
    fs.mkdirSync(path.dirname(executablePath), { recursive: true });
    fs.writeFileSync(executablePath, '');
    fs.chmodSync(lockedApplicationsPath, 0o555);

    try {
      const service = new AppUpdateService({
        updater,
        currentVersion: '0.1.0',
        isUpdateSupported: true,
        startupDelayMs: 60_000,
        recurringIntervalMs: 60_000,
        getPreferences: () => ({}),
        setPreferences: () => undefined,
        executablePath,
        platform: 'darwin'
      });

      service.initialize();
      await service.checkForUpdates('manual');
      await service.downloadUpdate();

      service.quitAndInstall();

      expect(updater.quitAndInstallCallCount).toBe(0);
      expect(service.getState().status).toBe('error');
      expect(service.getState().errorMessage).toContain(lockedApplicationsPath);

      service.dispose();
    } finally {
      fs.chmodSync(lockedApplicationsPath, 0o755);
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('logs bundle diagnostics when a relaunched app is still on the previous version', async () => {
    const updater = new FakeUpdater();
    const { entries, logger } = createLoggerSpy();
    let storedPreferences: AppUpdatePreferences = {
      installAttemptVersion: '0.2.0',
      installAttemptedAt: '2026-04-22T20:22:52.094Z'
    };
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-update-service-'));
    const executablePath = path.join(
      tempRoot,
      'Applications',
      'KnowledgeBase.app',
      'Contents',
      'MacOS',
      'KnowledgeBase'
    );
    fs.mkdirSync(path.dirname(executablePath), { recursive: true });
    fs.writeFileSync(executablePath, '');

    try {
      const service = new AppUpdateService({
        updater,
        currentVersion: '0.1.0',
        isUpdateSupported: true,
        startupDelayMs: 60_000,
        recurringIntervalMs: 60_000,
        getPreferences: () => storedPreferences,
        setPreferences: (nextPreferences) => {
          storedPreferences = nextPreferences;
        },
        executablePath,
        platform: 'darwin',
        logger
      });

      service.initialize();
      await service.checkForUpdates('automatic');

      expect(service.getState().status).toBe('available');
      expect(service.getState().errorMessage).toContain('did not replace');
      expect(storedPreferences.installAttemptVersion).toBeNull();

      const pendingLog = entries.find((entry) => entry.message === 'app-update-service.install-attempt-pending-after-relaunch');
      expect(pendingLog).toBeTruthy();

      const failureLog = entries.find((entry) => entry.message === 'app-update-service.install-attempt-did-not-apply');
      expect(failureLog).toBeTruthy();
      expect(failureLog?.payload[0]).toMatchObject({
        currentVersion: '0.1.0',
        attemptedVersion: '0.2.0',
        availableVersion: '0.2.0',
        bundlePath: path.join(tempRoot, 'Applications', 'KnowledgeBase.app')
      });

      service.dispose();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
