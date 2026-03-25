"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSidebarCollapsedPreference = getSidebarCollapsedPreference;
exports.getStoredSidebarCollapsedPreference = getStoredSidebarCollapsedPreference;
exports.setSidebarCollapsedPreference = setSidebarCollapsedPreference;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const electron_1 = require("electron");
const logger_1 = require("./logger");
function getPreferencesPath() {
    return node_path_1.default.join(electron_1.app.getPath('userData'), 'preferences.json');
}
function readPreferences() {
    const filePath = getPreferencesPath();
    try {
        if (!node_fs_1.default.existsSync(filePath)) {
            logger_1.logger.info('app-preferences.read.missing', { filePath });
            return {};
        }
        const raw = node_fs_1.default.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        logger_1.logger.info('app-preferences.read.success', {
            filePath,
            sidebarCollapsed: parsed?.ui?.sidebarCollapsed ?? null
        });
        return parsed && typeof parsed === 'object' ? parsed : {};
    }
    catch (error) {
        logger_1.logger.error('app-preferences.read.failed', {
            filePath,
            error: String(error)
        });
        return {};
    }
}
function writePreferences(preferences) {
    const filePath = getPreferencesPath();
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(filePath), { recursive: true });
    node_fs_1.default.writeFileSync(filePath, JSON.stringify(preferences, null, 2), 'utf8');
    logger_1.logger.info('app-preferences.write.success', {
        filePath,
        sidebarCollapsed: preferences.ui?.sidebarCollapsed ?? null
    });
}
function getSidebarCollapsedPreference() {
    const collapsed = readPreferences().ui?.sidebarCollapsed === true;
    logger_1.logger.info('app-preferences.getSidebarCollapsedPreference', { collapsed });
    return collapsed;
}
function getStoredSidebarCollapsedPreference() {
    const value = readPreferences().ui?.sidebarCollapsed;
    const collapsed = typeof value === 'boolean' ? value : null;
    logger_1.logger.info('app-preferences.getStoredSidebarCollapsedPreference', { collapsed });
    return collapsed;
}
function setSidebarCollapsedPreference(collapsed) {
    logger_1.logger.info('app-preferences.setSidebarCollapsedPreference.begin', { collapsed });
    const preferences = readPreferences();
    writePreferences({
        ...preferences,
        ui: {
            ...preferences.ui,
            sidebarCollapsed: collapsed
        }
    });
}
