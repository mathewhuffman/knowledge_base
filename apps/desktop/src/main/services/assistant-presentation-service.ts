import type {
  AiAssistantPresentationPreferences,
  AiAssistantPresentationState,
  AiAssistantPresentationStateValue,
  AiAssistantPresentationTransition
} from '@kb-vault/shared-types';
import { logger } from './logger';

type AssistantPresentationListener = (
  state: AiAssistantPresentationState,
  transition: AiAssistantPresentationTransition | { type: 'assistant_reply_received' }
) => void;

function resolvePresentationStateValue(
  dockMode: AiAssistantPresentationState['dockMode'],
  surfaceMode: AiAssistantPresentationState['surfaceMode']
): AiAssistantPresentationStateValue {
  if (dockMode === 'embedded') {
    return surfaceMode === 'panel' ? 'embedded_open' : 'embedded_closed';
  }
  return surfaceMode === 'panel' ? 'detached_panel' : 'detached_launcher';
}

function buildPresentationState(
  current: AiAssistantPresentationState,
  overrides: Partial<AiAssistantPresentationState>
): AiAssistantPresentationState {
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

export class AssistantPresentationService {
  private state: AiAssistantPresentationState;
  private readonly listeners = new Set<AssistantPresentationListener>();

  constructor(
    initialPreferences: AiAssistantPresentationPreferences,
    private readonly persistPreferences: (preferences: AiAssistantPresentationPreferences) => void
  ) {
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

  getState(): AiAssistantPresentationState {
    return { ...this.state };
  }

  subscribe(listener: AssistantPresentationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  transition(transition: AiAssistantPresentationTransition): AiAssistantPresentationState {
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

  handleAssistantReplyFinished(): AiAssistantPresentationState {
    const shouldMarkUnread = this.state.surfaceMode !== 'panel';
    const next = buildPresentationState(this.state, {
      hasUnread: shouldMarkUnread ? true : false
    });
    this.commit(next, { type: 'assistant_reply_received' });
    return this.getState();
  }

  private commit(
    next: AiAssistantPresentationState,
    transition: AiAssistantPresentationTransition | { type: 'assistant_reply_received' }
  ): void {
    this.state = next;
    this.persistPreferences({
      embeddedLauncherPosition: next.embeddedLauncherPosition,
      detachedLauncherBounds: next.detachedLauncherBounds,
      detachedPanelBounds: next.detachedPanelBounds,
      detachedDisplayId: next.detachedDisplayId,
      lastDetachedSurfaceMode: next.lastDetachedSurfaceMode
    });
    logger.info('assistant-presentation.transition', {
      transition: transition.type,
      dockMode: next.dockMode,
      surfaceMode: next.surfaceMode,
      state: next.state,
      hasUnread: next.hasUnread
    });
    this.emit(next, transition);
  }

  private emit(
    state: AiAssistantPresentationState,
    transition: AiAssistantPresentationTransition | { type: 'assistant_reply_received' }
  ): void {
    for (const listener of this.listeners) {
      listener({ ...state }, transition);
    }
  }
}
