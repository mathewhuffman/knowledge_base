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
const node_child_process_1 = require("node:child_process");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_url_1 = require("node:url");
const electron_1 = require("electron");
const electronUpdater = __importStar(require("electron-updater"));
const logger_1 = require("./logger");
const STARTUP_AUTO_CHECK_DELAY_MS = 5_000;
const RECURRING_AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SHIPIT_BUNDLE_IDENTIFIER = 'com.kbvault.desktop';
const SHIPIT_SERVICE_LABEL = `${SHIPIT_BUNDLE_IDENTIFIER}.ShipIt`;
const MAX_DIAGNOSTIC_SNIPPET_LENGTH = 4_000;
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
            : null,
        installAttemptVersion: typeof preferences?.installAttemptVersion === 'string' && preferences.installAttemptVersion.trim()
            ? preferences.installAttemptVersion.trim()
            : null,
        installAttemptedAt: typeof preferences?.installAttemptedAt === 'string' && preferences.installAttemptedAt.trim()
            ? preferences.installAttemptedAt
            : null
    };
}
function isWritable(targetPath) {
    if (!targetPath) {
        return null;
    }
    try {
        node_fs_1.default.accessSync(targetPath, node_fs_1.default.constants.W_OK);
        return true;
    }
    catch {
        return false;
    }
}
function resolveRealPath(targetPath) {
    if (!targetPath) {
        return null;
    }
    try {
        return node_fs_1.default.realpathSync(targetPath);
    }
    catch {
        return null;
    }
}
function readStatDetails(targetPath) {
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
        const stats = node_fs_1.default.statSync(targetPath);
        return {
            exists: true,
            mode: `0${(stats.mode & 0o777).toString(8)}`,
            uid: typeof stats.uid === 'number' ? stats.uid : null,
            gid: typeof stats.gid === 'number' ? stats.gid : null,
            mtimeMs: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : null
        };
    }
    catch {
        return {
            exists: false,
            mode: null,
            uid: null,
            gid: null,
            mtimeMs: null
        };
    }
}
function compareVersions(left, right) {
    return left.localeCompare(right, undefined, {
        numeric: true,
        sensitivity: 'base'
    });
}
function collectInstallTargetDiagnostics(executablePath, isInApplicationsFolder) {
    const normalizedExecutablePath = node_path_1.default.resolve(executablePath);
    const bundlePath = resolveInstalledBundlePath(normalizedExecutablePath);
    const bundleParentPath = bundlePath ? node_path_1.default.dirname(bundlePath) : null;
    const bundleRealPath = resolveRealPath(bundlePath);
    const executableRealPath = resolveRealPath(normalizedExecutablePath);
    const userApplicationsPath = node_path_1.default.join(node_os_1.default.homedir(), 'Applications');
    return {
        executablePath: normalizedExecutablePath,
        executableRealPath,
        executableWritable: isWritable(normalizedExecutablePath),
        autoRunAppAfterInstall: null,
        bundlePath,
        bundleRealPath,
        bundleWritable: isWritable(bundlePath),
        bundleExists: Boolean(bundlePath && node_fs_1.default.existsSync(bundlePath)),
        bundleParentPath,
        bundleParentWritable: isWritable(bundleParentPath),
        bundleParentExists: Boolean(bundleParentPath && node_fs_1.default.existsSync(bundleParentPath)),
        launchedFromMountedVolume: Boolean(bundlePath?.startsWith('/Volumes/')),
        launchedFromApplications: Boolean(bundlePath?.startsWith('/Applications/')),
        launchedFromUserApplications: Boolean(bundlePath?.startsWith(userApplicationsPath)),
        appIsInApplicationsFolder: isInApplicationsFolder,
        processUid: typeof process.getuid === 'function' ? process.getuid() : null,
        processGid: typeof process.getgid === 'function' ? process.getgid() : null,
        executableDetails: readStatDetails(normalizedExecutablePath),
        bundleDetails: readStatDetails(bundlePath),
        bundleParentDetails: readStatDetails(bundleParentPath),
        bundleXattrs: null,
        shipItState: null,
        stagedBundleXattrs: null,
        shipItLaunchd: null
    };
}
function truncateDiagnosticSnippet(value) {
    if (!value) {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    if (trimmed.length <= MAX_DIAGNOSTIC_SNIPPET_LENGTH) {
        return trimmed;
    }
    return `${trimmed.slice(0, MAX_DIAGNOSTIC_SNIPPET_LENGTH - 1)}…`;
}
function readXattrValue(targetPath, attributeName) {
    try {
        const result = (0, node_child_process_1.spawnSync)('xattr', ['-p', attributeName, targetPath], {
            encoding: null
        });
        if (result.status !== 0 || !result.stdout) {
            return null;
        }
        return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
    }
    catch {
        return null;
    }
}
function collectXattrDiagnostics(targetPath) {
    if (!targetPath) {
        return null;
    }
    const resolvedPath = node_path_1.default.resolve(targetPath);
    if (!node_fs_1.default.existsSync(resolvedPath)) {
        return {
            path: resolvedPath,
            exists: false,
            names: [],
            quarantine: null,
            provenanceBytes: null,
            maclBytes: null
        };
    }
    let names = [];
    try {
        const result = (0, node_child_process_1.spawnSync)('xattr', [resolvedPath], {
            encoding: 'utf8'
        });
        if (result.status === 0 && result.stdout) {
            names = result.stdout
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
        }
    }
    catch {
        names = [];
    }
    const quarantine = readXattrValue(resolvedPath, 'com.apple.quarantine');
    const provenance = readXattrValue(resolvedPath, 'com.apple.provenance');
    const macl = readXattrValue(resolvedPath, 'com.apple.macl');
    return {
        path: resolvedPath,
        exists: true,
        names,
        quarantine: quarantine ? quarantine.toString('utf8').trim() : null,
        provenanceBytes: provenance?.length ?? null,
        maclBytes: macl?.length ?? null
    };
}
function resolveShipItStatePath() {
    return node_path_1.default.join(node_os_1.default.homedir(), 'Library', 'Caches', `${SHIPIT_BUNDLE_IDENTIFIER}.ShipIt`, 'ShipItState.plist');
}
function fileUrlToPathSafe(urlValue) {
    if (!urlValue) {
        return null;
    }
    try {
        const parsed = new URL(urlValue);
        if (parsed.protocol !== 'file:') {
            return null;
        }
        return (0, node_url_1.fileURLToPath)(parsed);
    }
    catch {
        return null;
    }
}
function collectShipItStateDiagnostics() {
    const statePath = resolveShipItStatePath();
    if (!node_fs_1.default.existsSync(statePath)) {
        return {
            statePath,
            exists: false,
            launchAfterInstallation: null,
            updateBundleURL: null,
            targetBundleURL: null,
            bundleIdentifier: null,
            useUpdateBundleName: null,
            stagedBundlePath: null,
            parseError: null,
            rawSnippet: null
        };
    }
    let rawText = '';
    try {
        rawText = node_fs_1.default.readFileSync(statePath, 'utf8');
    }
    catch {
        rawText = '';
    }
    let parsedState = null;
    let parseError = null;
    try {
        const plutilResult = (0, node_child_process_1.spawnSync)('plutil', ['-convert', 'json', '-o', '-', statePath], {
            encoding: 'utf8'
        });
        const jsonText = plutilResult.status === 0 && plutilResult.stdout
            ? plutilResult.stdout
            : rawText;
        parsedState = JSON.parse(jsonText);
    }
    catch (error) {
        parseError = error instanceof Error ? error.message : String(error);
    }
    const updateBundleURL = typeof parsedState?.updateBundleURL === 'string' ? parsedState.updateBundleURL : null;
    return {
        statePath,
        exists: true,
        launchAfterInstallation: typeof parsedState?.launchAfterInstallation === 'boolean' ? parsedState.launchAfterInstallation : null,
        updateBundleURL,
        targetBundleURL: typeof parsedState?.targetBundleURL === 'string' ? parsedState.targetBundleURL : null,
        bundleIdentifier: typeof parsedState?.bundleIdentifier === 'string' ? parsedState.bundleIdentifier : null,
        useUpdateBundleName: typeof parsedState?.useUpdateBundleName === 'boolean' ? parsedState.useUpdateBundleName : null,
        stagedBundlePath: fileUrlToPathSafe(updateBundleURL),
        parseError,
        rawSnippet: truncateDiagnosticSnippet(rawText)
    };
}
function collectLaunchdServiceDiagnostics() {
    if (typeof process.getuid !== 'function') {
        return null;
    }
    const servicePath = `gui/${process.getuid()}/${SHIPIT_SERVICE_LABEL}`;
    try {
        const result = (0, node_child_process_1.spawnSync)('launchctl', ['print', servicePath], {
            encoding: 'utf8'
        });
        const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
        return {
            label: SHIPIT_SERVICE_LABEL,
            servicePath,
            present: result.status === 0,
            exitCode: typeof result.status === 'number' ? result.status : null,
            snippet: truncateDiagnosticSnippet(output)
        };
    }
    catch (error) {
        return {
            label: SHIPIT_SERVICE_LABEL,
            servicePath,
            present: false,
            exitCode: null,
            snippet: truncateDiagnosticSnippet(error instanceof Error ? error.message : String(error))
        };
    }
}
function resolveUpdateSupport() {
    if (electron_1.app?.isPackaged) {
        return true;
    }
    return process.env.KBV_ENABLE_DEV_UPDATES === '1'
        && node_fs_1.default.existsSync(node_path_1.default.join(process.cwd(), 'dev-app-update.yml'));
}
function resolveInstalledBundlePath(executablePath) {
    let currentPath = node_path_1.default.resolve(executablePath);
    while (true) {
        if (currentPath.endsWith('.app')) {
            return currentPath;
        }
        const parentPath = node_path_1.default.dirname(currentPath);
        if (parentPath === currentPath) {
            return null;
        }
        currentPath = parentPath;
    }
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
    executablePath;
    platform;
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
        this.executablePath = options.executablePath ?? electron_1.app?.getPath?.('exe') ?? process.execPath;
        this.platform = options.platform ?? process.platform;
        this.preferences = normalizePreferences(this.getStoredPreferences());
        this.preferences = this.reconcileInstallAttemptState(this.preferences);
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
            const installAttemptFailure = normalized ? this.consumeFailedInstallAttempt(normalized.version) : null;
            const shouldShowModal = Boolean(normalized
                && (Boolean(installAttemptFailure)
                    || this.lastCheckSource === 'manual'
                    || this.preferences.dismissedVersion !== normalized.version));
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
        this.log.info('app-update-service.quit-and-install-dispatched', {
            attemptedVersion: this.preferences.installAttemptVersion,
            attemptedAt: this.preferences.installAttemptedAt,
            shipItLaunchd: installDiagnostics.shipItLaunchd,
            shipItState: installDiagnostics.shipItState
        });
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
            downloadedVersion: this.state.downloadedVersion ?? this.state.updateInfo?.version ?? null,
            attemptedVersion: this.preferences.installAttemptVersion,
            attemptedAt: this.preferences.installAttemptedAt,
            ...this.buildInstallDiagnostics()
        });
        this.onBeforeQuitForUpdate?.();
    }
    resolveInstallabilityIssue() {
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
        const bundleParentPath = node_path_1.default.dirname(bundlePath);
        try {
            node_fs_1.default.accessSync(bundleParentPath, node_fs_1.default.constants.W_OK);
        }
        catch {
            return `KnowledgeBase cannot install updates because ${bundleParentPath} is not writable for this account. Move the app to ~/Applications or reinstall it so this user owns the app, then try again.`;
        }
        return null;
    }
    reconcileInstallAttemptState(preferences) {
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
    consumeFailedInstallAttempt(availableVersion) {
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
    recordInstallAttempt(version) {
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
    buildInstallFailureMessage(targetVersion) {
        const bundlePath = resolveInstalledBundlePath(this.executablePath);
        if (this.platform === 'darwin') {
            if (bundlePath) {
                return `KnowledgeBase closed for the ${targetVersion} update, but that version was not active afterward. The update handoff may not have completed, or macOS may have blocked the updated app from reopening automatically. Check the updater logs for the recorded bundle diagnostics, then reopen KnowledgeBase from ${bundlePath} or reinstall the latest DMG manually if needed.`;
            }
            return `KnowledgeBase closed for the ${targetVersion} update, but that version was not active afterward. The update handoff may not have completed, or macOS may have blocked the updated app from reopening automatically. Check the updater logs for the recorded bundle diagnostics, then reopen KnowledgeBase from /Applications or reinstall the latest DMG manually if needed.`;
        }
        if (bundlePath) {
            return `KnowledgeBase restarted, but version ${targetVersion} did not replace ${bundlePath}. Check the updater logs for the recorded bundle diagnostics, close any duplicate KnowledgeBase copies, and reinstall the latest DMG manually if needed.`;
        }
        return `KnowledgeBase restarted, but version ${targetVersion} did not replace the installed app bundle. Check the updater logs for the recorded bundle diagnostics and reinstall the latest DMG manually if needed.`;
    }
    buildInstallDiagnostics() {
        let isInApplicationsFolder = null;
        if (this.platform === 'darwin' && typeof electron_1.app?.isInApplicationsFolder === 'function') {
            try {
                isInApplicationsFolder = electron_1.app.isInApplicationsFolder();
            }
            catch {
                isInApplicationsFolder = null;
            }
        }
        const diagnostics = {
            ...collectInstallTargetDiagnostics(this.executablePath, isInApplicationsFolder),
            autoRunAppAfterInstall: typeof this.updater.autoRunAppAfterInstall === 'boolean'
                ? this.updater.autoRunAppAfterInstall
                : null
        };
        if (this.platform !== 'darwin') {
            return diagnostics;
        }
        const shipItState = collectShipItStateDiagnostics();
        return {
            ...diagnostics,
            bundleXattrs: collectXattrDiagnostics(diagnostics.bundlePath),
            shipItState,
            stagedBundleXattrs: collectXattrDiagnostics(shipItState?.stagedBundlePath ?? null),
            shipItLaunchd: collectLaunchdServiceDiagnostics()
        };
    }
}
exports.AppUpdateService = AppUpdateService;
