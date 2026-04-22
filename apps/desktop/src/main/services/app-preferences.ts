import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { AiAssistantPresentationPreferences, AppUpdatePreferences } from '@kb-vault/shared-types';
import { logger } from './logger';

type AppPreferences = {
  ui?: {
    sidebarCollapsed?: boolean;
    assistant?: AiAssistantPresentationPreferences;
  };
  updates?: AppUpdatePreferences;
};

function getPreferencesPath(): string {
  return path.join(app.getPath('userData'), 'preferences.json');
}

function readPreferences(): AppPreferences {
  const filePath = getPreferencesPath();

  try {
    if (!fs.existsSync(filePath)) {
      logger.info('app-preferences.read.missing', { filePath });
      return {};
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as AppPreferences;
    logger.info('app-preferences.read.success', {
      filePath,
      sidebarCollapsed: parsed?.ui?.sidebarCollapsed ?? null,
      assistantPreferences: Boolean(parsed?.ui?.assistant)
    });
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    logger.error('app-preferences.read.failed', {
      filePath,
      error: String(error)
    });
    return {};
  }
}

function writePreferences(preferences: AppPreferences): void {
  const filePath = getPreferencesPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(preferences, null, 2), 'utf8');
  logger.info('app-preferences.write.success', {
    filePath,
    sidebarCollapsed: preferences.ui?.sidebarCollapsed ?? null,
    assistantPreferences: Boolean(preferences.ui?.assistant)
  });
}

export function getSidebarCollapsedPreference(): boolean {
  const collapsed = readPreferences().ui?.sidebarCollapsed === true;
  logger.info('app-preferences.getSidebarCollapsedPreference', { collapsed });
  return collapsed;
}

export function getStoredSidebarCollapsedPreference(): boolean | null {
  const value = readPreferences().ui?.sidebarCollapsed;
  const collapsed = typeof value === 'boolean' ? value : null;
  logger.info('app-preferences.getStoredSidebarCollapsedPreference', { collapsed });
  return collapsed;
}

export function setSidebarCollapsedPreference(collapsed: boolean): void {
  logger.info('app-preferences.setSidebarCollapsedPreference.begin', { collapsed });
  const preferences = readPreferences();
  writePreferences({
    ...preferences,
    ui: {
      ...preferences.ui,
      sidebarCollapsed: collapsed
    }
  });
}

export function getAssistantPresentationPreferences(): AiAssistantPresentationPreferences {
  const preferences = readPreferences().ui?.assistant;
  if (!preferences || typeof preferences !== 'object') {
    logger.info('app-preferences.getAssistantPresentationPreferences.empty');
    return {};
  }

  logger.info('app-preferences.getAssistantPresentationPreferences.success', {
    hasEmbeddedLauncherPosition: Boolean(preferences.embeddedLauncherPosition),
    hasDetachedLauncherBounds: Boolean(preferences.detachedLauncherBounds),
    hasDetachedPanelBounds: Boolean(preferences.detachedPanelBounds),
    detachedDisplayId: preferences.detachedDisplayId ?? null,
    lastDetachedSurfaceMode: preferences.lastDetachedSurfaceMode ?? null
  });

  return preferences;
}

export function setAssistantPresentationPreferences(nextPreferences: AiAssistantPresentationPreferences): void {
  logger.info('app-preferences.setAssistantPresentationPreferences.begin', {
    hasEmbeddedLauncherPosition: Boolean(nextPreferences.embeddedLauncherPosition),
    hasDetachedLauncherBounds: Boolean(nextPreferences.detachedLauncherBounds),
    hasDetachedPanelBounds: Boolean(nextPreferences.detachedPanelBounds),
    detachedDisplayId: nextPreferences.detachedDisplayId ?? null,
    lastDetachedSurfaceMode: nextPreferences.lastDetachedSurfaceMode ?? null
  });

  const preferences = readPreferences();
  writePreferences({
    ...preferences,
    ui: {
      ...preferences.ui,
      assistant: nextPreferences
    }
  });
}

export function getAppUpdatePreferences(): AppUpdatePreferences {
  const preferences = readPreferences().updates;
  if (!preferences || typeof preferences !== 'object') {
    logger.info('app-preferences.getAppUpdatePreferences.empty');
    return {};
  }

  logger.info('app-preferences.getAppUpdatePreferences.success', {
    autoCheckEnabled: preferences.autoCheckEnabled ?? null,
    dismissedVersion: preferences.dismissedVersion ?? null,
    lastCheckedAt: preferences.lastCheckedAt ?? null,
    installAttemptVersion: preferences.installAttemptVersion ?? null,
    installAttemptedAt: preferences.installAttemptedAt ?? null
  });

  return preferences;
}

export function setAppUpdatePreferences(nextPreferences: AppUpdatePreferences): void {
  logger.info('app-preferences.setAppUpdatePreferences.begin', {
    autoCheckEnabled: nextPreferences.autoCheckEnabled ?? null,
    dismissedVersion: nextPreferences.dismissedVersion ?? null,
    lastCheckedAt: nextPreferences.lastCheckedAt ?? null,
    installAttemptVersion: nextPreferences.installAttemptVersion ?? null,
    installAttemptedAt: nextPreferences.installAttemptedAt ?? null
  });

  const preferences = readPreferences();
  writePreferences({
    ...preferences,
    updates: nextPreferences
  });
}
