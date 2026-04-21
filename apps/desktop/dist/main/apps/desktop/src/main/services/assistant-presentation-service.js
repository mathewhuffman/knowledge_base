"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssistantPresentationService = void 0;
const logger_1 = require("./logger");
function resolvePresentationStateValue(dockMode, surfaceMode) {
    if (dockMode === 'embedded') {
        return surfaceMode === 'panel' ? 'embedded_open' : 'embedded_closed';
    }
    return surfaceMode === 'panel' ? 'detached_panel' : 'detached_launcher';
}
function buildPresentationState(current, overrides) {
    const dockMode = overrides.dockMode ?? current.dockMode;
    const surfaceMode = overrides.surfaceMode ?? current.surfaceMode;
    return {
        ...current,
        ...overrides,
        dockMode,
        surfaceMode,
        state: resolvePresentationStateValue(dockMode, surfaceMode),
        updatedAtUtc: new Date().toISOString()
    };
}
class AssistantPresentationService {
    persistPreferences;
    state;
    listeners = new Set();
    constructor(initialPreferences, persistPreferences) {
        this.persistPreferences = persistPreferences;
        this.state = {
            dockMode: 'embedded',
            surfaceMode: 'closed',
            state: 'embedded_closed',
            hasUnread: false,
            updatedAtUtc: new Date().toISOString(),
            embeddedLauncherPosition: initialPreferences.embeddedLauncherPosition,
            detachedLauncherBounds: initialPreferences.detachedLauncherBounds,
            detachedPanelBounds: initialPreferences.detachedPanelBounds,
            detachedDisplayId: initialPreferences.detachedDisplayId,
            lastDetachedSurfaceMode: initialPreferences.lastDetachedSurfaceMode ?? 'launcher'
        };
    }
    getState() {
        return { ...this.state };
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    transition(transition) {
        const current = this.state;
        let next = current;
        switch (transition.type) {
            case 'open_embedded_panel':
                next = buildPresentationState(current, {
                    dockMode: 'embedded',
                    surfaceMode: 'panel',
                    hasUnread: false
                });
                break;
            case 'close_embedded_panel':
                next = buildPresentationState(current, {
                    dockMode: 'embedded',
                    surfaceMode: 'closed'
                });
                break;
            case 'reattach_embedded_open':
                next = buildPresentationState(current, {
                    dockMode: 'embedded',
                    surfaceMode: 'panel',
                    hasUnread: false
                });
                break;
            case 'set_embedded_launcher_position':
                next = buildPresentationState(current, {
                    embeddedLauncherPosition: transition.position
                });
                break;
            case 'detach_launcher':
                next = buildPresentationState(current, {
                    dockMode: 'detached',
                    surfaceMode: 'launcher',
                    lastDetachedSurfaceMode: 'launcher'
                });
                break;
            case 'detach_panel':
                next = buildPresentationState(current, {
                    dockMode: 'detached',
                    surfaceMode: 'panel',
                    hasUnread: false,
                    lastDetachedSurfaceMode: 'panel'
                });
                break;
            case 'open_detached_panel':
                next = buildPresentationState(current, {
                    dockMode: 'detached',
                    surfaceMode: 'panel',
                    hasUnread: false,
                    lastDetachedSurfaceMode: 'panel'
                });
                break;
            case 'collapse_detached_to_launcher':
                next = buildPresentationState(current, {
                    dockMode: 'detached',
                    surfaceMode: 'launcher',
                    lastDetachedSurfaceMode: 'launcher'
                });
                break;
            case 'reattach_embedded_closed':
                next = buildPresentationState(current, {
                    dockMode: 'embedded',
                    surfaceMode: 'closed'
                });
                break;
            case 'update_detached_bounds':
                next = buildPresentationState(current, {
                    detachedDisplayId: transition.displayId ?? current.detachedDisplayId,
                    detachedLauncherBounds: transition.surfaceMode === 'launcher'
                        ? transition.bounds
                        : current.detachedLauncherBounds,
                    detachedPanelBounds: transition.surfaceMode === 'panel'
                        ? transition.bounds
                        : current.detachedPanelBounds
                });
                break;
            case 'mark_read':
                next = buildPresentationState(current, {
                    hasUnread: false
                });
                break;
            default:
                next = current;
                break;
        }
        this.commit(next, transition);
        return this.getState();
    }
    handleAssistantReplyFinished() {
        const shouldMarkUnread = this.state.surfaceMode !== 'panel';
        const next = buildPresentationState(this.state, {
            hasUnread: shouldMarkUnread ? true : false
        });
        this.commit(next, { type: 'assistant_reply_received' });
        return this.getState();
    }
    commit(next, transition) {
        this.state = next;
        this.persistPreferences({
            embeddedLauncherPosition: next.embeddedLauncherPosition,
            detachedLauncherBounds: next.detachedLauncherBounds,
            detachedPanelBounds: next.detachedPanelBounds,
            detachedDisplayId: next.detachedDisplayId,
            lastDetachedSurfaceMode: next.lastDetachedSurfaceMode
        });
        logger_1.logger.info('assistant-presentation.transition', {
            transition: transition.type,
            dockMode: next.dockMode,
            surfaceMode: next.surfaceMode,
            state: next.state,
            hasUnread: next.hasUnread
        });
        this.emit(next, transition);
    }
    emit(state, transition) {
        for (const listener of this.listeners) {
            listener({ ...state }, transition);
        }
    }
}
exports.AssistantPresentationService = AssistantPresentationService;
