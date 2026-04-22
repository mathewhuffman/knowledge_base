"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppUpdateService = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const electron_1 = require("electron");
const electronUpdater = __importStar(require("electron-updater"));
const logger_1 = require("./logger");
const STARTUP_AUTO_CHECK_DELAY_MS = 5_000;
const RECURRING_AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
function getAutoUpdater() {
    const { autoUpdater } = electronUpdater;
    return autoUpdater;
}
function normalizeReleaseNotes(releaseNotes) {
    if (typeof releaseNotes === 'string') {
        const note = releaseNotes.trim();
        return note ? [{ note }] : [];
    }
    if (!Array.isArray(releaseNotes)) {
        return [];
    }
    const notes = [];
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
function normalizeUpdateInfo(info) {
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
function normalizePreferences(preferences) {
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
function resolveUpdateSupport() {
    if (electron_1.app?.isPackaged) {
        return true;
    }
    return process.env.KBV_ENABLE_DEV_UPDATES === '1'
        && node_fs_1.default.existsSync(node_path_1.default.join(process.cwd(), 'dev-app-update.yml'));
}
function buildInitialState(currentVersion, preferences, isUpdateSupported) {
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
class AppUpdateService {
    updater;
    currentVersion;
    getStoredPreferences;
    persistPreferences;
    startupDelayMs;
    recurringIntervalMs;
    isUpdateSupported;
    log;
    onBeforeQuitForUpdate;
    preferences;
    state;
    initialized = false;
    lastCheckSource = null;
    recurringTimer = null;
    startupTimer = null;
    checkPromise = null;
    downloadPromise = null;
    preparedForQuitAndInstall = false;
    subscribers = new Set();
    constructor(options) {
        this.updater = options.updater ?? getAutoUpdater();
        this.currentVersion = options.currentVersion ?? electron_1.app?.getVersion?.() ?? '0.0.0';
        this.getStoredPreferences = options.getPreferences;
        this.persistPreferences = options.setPreferences;
        this.startupDelayMs = options.startupDelayMs ?? STARTUP_AUTO_CHECK_DELAY_MS;
        this.recurringIntervalMs = options.recurringIntervalMs ?? RECURRING_AUTO_CHECK_INTERVAL_MS;
        this.isUpdateSupported = options.isUpdateSupported ?? resolveUpdateSupport();
        this.log = options.logger ?? logger_1.logger;
        this.onBeforeQuitForUpdate = options.onBeforeQuitForUpdate;
        this.preferences = normalizePreferences(this.getStoredPreferences());
        this.state = buildInitialState(this.currentVersion, this.preferences, this.isUpdateSupported);
        if (this.isUpdateSupported) {
            this.updater.autoDownload = false;
            this.updater.autoInstallOnAppQuit = true;
            this.updater.logger = this.log;
            if (!electron_1.app?.isPackaged) {
                this.updater.forceDevUpdateConfig = true;
            }
        }
    }
    initialize() {
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
            const info = rawInfo;
            const normalized = normalizeUpdateInfo(info);
            const shouldShowModal = Boolean(normalized
                && (this.lastCheckSource === 'manual' || this.preferences.dismissedVersion !== normalized.version));
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
            const progress = rawProgress;
            this.updateState({
                status: 'downloading',
                downloadProgressPercent: Math.max(0, Math.min(100, Math.round(progress.percent ?? 0))),
                errorMessage: null
            });
        });
        this.updater.on('update-downloaded', (rawInfo) => {
            const info = rawInfo;
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
            const error = rawError;
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
    dispose() {
        this.clearTimers();
        this.subscribers.clear();
    }
    getState() {
        return this.state;
    }
    subscribe(listener) {
        this.subscribers.add(listener);
        return () => {
            this.subscribers.delete(listener);
        };
    }
    async checkForUpdates(source = 'manual') {
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
            .catch((error) => {
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
    async downloadUpdate() {
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
            .catch((error) => {
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
    async setAutoCheckEnabled(enabled) {
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
    dismissModal() {
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
    quitAndInstall() {
        if (!this.isUpdateSupported || this.state.status !== 'downloaded') {
            return;
        }
        this.prepareForQuitAndInstall('user-request');
        this.updater.quitAndInstall(false, true);
    }
    refreshAutoCheckSchedule() {
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
    clearTimers() {
        if (this.startupTimer) {
            clearTimeout(this.startupTimer);
            this.startupTimer = null;
        }
        if (this.recurringTimer) {
            clearInterval(this.recurringTimer);
            this.recurringTimer = null;
        }
    }
    updateState(next) {
        this.state = {
            ...this.state,
            ...next
        };
        this.subscribers.forEach((listener) => {
            listener(this.state);
        });
    }
    prepareForQuitAndInstall(reason) {
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
}
exports.AppUpdateService = AppUpdateService;
