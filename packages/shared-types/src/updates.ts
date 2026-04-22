export type AppUpdateCheckSource = 'automatic' | 'manual';

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not_available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface AppUpdateReleaseNotesEntry {
  version?: string | null;
  note: string;
}

export interface AppUpdateInfo {
  version: string;
  releaseName?: string | null;
  releaseDate?: string | null;
  releaseNotes: AppUpdateReleaseNotesEntry[];
}

export interface AppUpdatePreferences {
  autoCheckEnabled?: boolean;
  dismissedVersion?: string | null;
  lastCheckedAt?: string | null;
  installAttemptVersion?: string | null;
  installAttemptedAt?: string | null;
}

export interface AppUpdateState {
  currentVersion: string;
  autoCheckEnabled: boolean;
  isUpdateSupported: boolean;
  status: AppUpdateStatus;
  lastCheckedAt?: string | null;
  checkSource?: AppUpdateCheckSource | null;
  updateInfo?: AppUpdateInfo | null;
  downloadedVersion?: string | null;
  downloadProgressPercent?: number | null;
  errorMessage?: string | null;
  shouldShowModal: boolean;
}

export interface AppUpdateCheckRequest {
  source?: AppUpdateCheckSource;
}

export interface AppUpdateSetAutoCheckRequest {
  enabled: boolean;
}

export interface AppUpdateStateChangedEvent {
  state: AppUpdateState;
}
