import { EventEmitter } from 'node:events';
import { expect, test } from '@playwright/test';
import type { AppUpdatePreferences } from '@kb-vault/shared-types';
import { AppUpdateService, type UpdaterLike } from '../src/main/services/update-service';

class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  forceDevUpdateConfig = false;
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

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
    this.emit('quit-and-install');
  }
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
});
