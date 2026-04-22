import { BrowserWindow, screen } from 'electron';
import type {
  AiAssistantDetachedWindowMoveRequest,
  AiAssistantDetachedWindowResizeRequest,
  AiAssistantDetachedSurfaceMode,
  AiAssistantPresentationState,
  AiAssistantPresentationTransition,
  AiAssistantRendererWindowRole,
  AiAssistantScreenPoint,
  AiAssistantWindowBounds
} from '@kb-vault/shared-types';
import {
  AI_ASSISTANT_DETACHED_LAUNCHER_WINDOW_SIZE,
  AI_ASSISTANT_DETACHED_PANEL_MIN_WINDOW_SIZE,
  AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE
} from '@kb-vault/shared-types';
import { AssistantPresentationService } from './assistant-presentation-service';
import { logger } from './logger';

const DISPLAY_MARGIN = 20;

type PresentationTrigger = AiAssistantPresentationTransition | { type: 'assistant_reply_received' };

interface AssistantWindowManagerOptions {
  loadRendererWindow: (window: BrowserWindow, role: AiAssistantRendererWindowRole) => void | Promise<void>;
  preloadPath: string;
  presentationService: AssistantPresentationService;
  getMainWindow: () => BrowserWindow | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function asBounds(bounds: Electron.Rectangle): AiAssistantWindowBounds {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  };
}

function toRectangle(bounds: AiAssistantWindowBounds): Electron.Rectangle {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height
  };
}

function clampBoundsToDisplay(bounds: AiAssistantWindowBounds, display: Electron.Display): AiAssistantWindowBounds {
  const { x, y, width, height } = display.workArea;
  const clampedWidth = Math.min(bounds.width, width - DISPLAY_MARGIN * 2);
  const clampedHeight = Math.min(bounds.height, height - DISPLAY_MARGIN * 2);
  return {
    width: clampedWidth,
    height: clampedHeight,
    x: clamp(bounds.x, x + DISPLAY_MARGIN, x + width - clampedWidth - DISPLAY_MARGIN),
    y: clamp(bounds.y, y + DISPLAY_MARGIN, y + height - clampedHeight - DISPLAY_MARGIN)
  };
}

function deriveBoundsFromAnchor(
  point: AiAssistantScreenPoint,
  size: { width: number; height: number },
  display: Electron.Display
): AiAssistantWindowBounds {
  return clampBoundsToDisplay({
    x: Math.round(point.x - size.width / 2),
    y: Math.round(point.y - size.height / 2),
    width: size.width,
    height: size.height
  }, display);
}

function derivePanelBoundsFromLauncher(
  launcherBounds: AiAssistantWindowBounds,
  display: Electron.Display
): AiAssistantWindowBounds {
  return clampBoundsToDisplay({
    x: Math.round(launcherBounds.x + launcherBounds.width - AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE.width),
    y: Math.round(launcherBounds.y + launcherBounds.height - AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE.height),
    width: AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE.width,
    height: AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE.height
  }, display);
}

function deriveLauncherBoundsFromPanel(
  panelBounds: AiAssistantWindowBounds,
  display: Electron.Display
): AiAssistantWindowBounds {
  return clampBoundsToDisplay({
    x: Math.round(panelBounds.x + panelBounds.width - AI_ASSISTANT_DETACHED_LAUNCHER_WINDOW_SIZE.width),
    y: Math.round(panelBounds.y + panelBounds.height - AI_ASSISTANT_DETACHED_LAUNCHER_WINDOW_SIZE.height),
    width: AI_ASSISTANT_DETACHED_LAUNCHER_WINDOW_SIZE.width,
    height: AI_ASSISTANT_DETACHED_LAUNCHER_WINDOW_SIZE.height
  }, display);
}

function getDisplayForState(state: AiAssistantPresentationState, anchorPoint?: AiAssistantScreenPoint): Electron.Display {
  if (anchorPoint) {
    return screen.getDisplayNearestPoint({ x: Math.round(anchorPoint.x), y: Math.round(anchorPoint.y) });
  }
  const displayById = state.detachedDisplayId != null
    ? screen.getAllDisplays().find((display) => display.id === state.detachedDisplayId)
    : undefined;
  return displayById ?? screen.getPrimaryDisplay();
}

export class AssistantWindowManager {
  private detachedWindow: BrowserWindow | null = null;
  private allowDetachedWindowClose = false;
  private isQuitting = false;
  private isApplyingWindowBounds = false;

  constructor(private readonly options: AssistantWindowManagerOptions) {
    this.options.presentationService.subscribe((state, transition) => {
      void this.syncToState(state, transition);
    });
  }

  handleBeforeQuit(): void {
    this.isQuitting = true;
    this.destroyDetachedWindow();
  }

  getDetachedWindow(): BrowserWindow | null {
    return this.detachedWindow && !this.detachedWindow.isDestroyed()
      ? this.detachedWindow
      : null;
  }

  handleMoveRequest(sender: Electron.WebContents, payload: AiAssistantDetachedWindowMoveRequest): void {
    const window = this.getDetachedWindow();
    if (!window || window.webContents.id !== sender.id) {
      return;
    }

    const currentBounds = asBounds(window.getBounds());
    const state = this.options.presentationService.getState();
    const surfaceMode: AiAssistantDetachedSurfaceMode = state.surfaceMode === 'panel' ? 'panel' : 'launcher';
    const display = screen.getDisplayNearestPoint({
      x: Math.round(payload.x),
      y: Math.round(payload.y)
    });
    const clampedBounds = clampBoundsToDisplay({
      ...currentBounds,
      x: Math.round(payload.x),
      y: Math.round(payload.y)
    }, display);

    if (clampedBounds.x === currentBounds.x && clampedBounds.y === currentBounds.y) {
      return;
    }

    this.isApplyingWindowBounds = true;
    try {
      window.setPosition(clampedBounds.x, clampedBounds.y, false);
    } finally {
      this.isApplyingWindowBounds = false;
    }

    this.options.presentationService.transition({
      type: 'update_detached_bounds',
      surfaceMode,
      bounds: clampedBounds,
      displayId: display.id
    });
  }

  handleResizeRequest(sender: Electron.WebContents, payload: AiAssistantDetachedWindowResizeRequest): void {
    const window = this.getDetachedWindow();
    if (!window || window.webContents.id !== sender.id) {
      return;
    }

    const state = this.options.presentationService.getState();
    if (state.surfaceMode !== 'panel') {
      return;
    }

    const currentBounds = asBounds(window.getBounds());
    const display = screen.getDisplayMatching(toRectangle(currentBounds));
    const maxWidth = Math.max(
      AI_ASSISTANT_DETACHED_PANEL_MIN_WINDOW_SIZE.width,
      display.workArea.width - DISPLAY_MARGIN * 2
    );
    const maxHeight = Math.max(
      AI_ASSISTANT_DETACHED_PANEL_MIN_WINDOW_SIZE.height,
      display.workArea.height - DISPLAY_MARGIN * 2
    );
    const nextWidth = clamp(
      Math.round(payload.width),
      AI_ASSISTANT_DETACHED_PANEL_MIN_WINDOW_SIZE.width,
      maxWidth
    );
    const nextHeight = clamp(
      Math.round(payload.height ?? currentBounds.height),
      AI_ASSISTANT_DETACHED_PANEL_MIN_WINDOW_SIZE.height,
      maxHeight
    );
    const nextBounds = clampBoundsToDisplay({
      x: payload.anchor === 'bottom_right'
        ? currentBounds.x + currentBounds.width - nextWidth
        : currentBounds.x,
      y: payload.anchor === 'bottom_right'
        ? currentBounds.y + currentBounds.height - nextHeight
        : currentBounds.y,
      width: nextWidth,
      height: nextHeight
    }, display);

    if (
      nextBounds.x === currentBounds.x
      && nextBounds.y === currentBounds.y
      && nextBounds.width === currentBounds.width
      && nextBounds.height === currentBounds.height
    ) {
      return;
    }

    this.isApplyingWindowBounds = true;
    try {
      window.setBounds(toRectangle(nextBounds), false);
    } finally {
      this.isApplyingWindowBounds = false;
    }

    this.options.presentationService.transition({
      type: 'update_detached_bounds',
      surfaceMode: 'panel',
      bounds: nextBounds,
      displayId: display.id
    });
  }

  handleMoveEnd(sender: Electron.WebContents): void {
    const window = this.getDetachedWindow();
    if (!window || window.webContents.id !== sender.id) {
      return;
    }
  }

  private async syncToState(state: AiAssistantPresentationState, transition: PresentationTrigger): Promise<void> {
    if (
      transition.type === 'set_embedded_launcher_position'
      || transition.type === 'mark_read'
      || transition.type === 'assistant_reply_received'
      || transition.type === 'update_detached_bounds'
    ) {
      return;
    }

    if (state.dockMode === 'embedded') {
      this.destroyDetachedWindow();
      return;
    }

    const bounds = this.resolveBoundsForTransition(state, transition);
    const window = await this.ensureDetachedWindow();
    this.applyWindowMode(window, state.surfaceMode === 'panel' ? 'panel' : 'launcher', bounds);

    if (!window.isVisible()) {
      window.show();
    }
    if (state.surfaceMode === 'panel') {
      window.focus();
    }
  }

  private resolveBoundsForTransition(
    state: AiAssistantPresentationState,
    transition: PresentationTrigger
  ): AiAssistantWindowBounds {
    const anchorPoint =
      transition.type === 'detach_launcher' || transition.type === 'detach_panel'
        ? transition.anchorPoint
        : undefined;
    const display = getDisplayForState(state, anchorPoint);

    if (state.surfaceMode === 'panel') {
      if (transition.type === 'detach_panel' && anchorPoint) {
        return deriveBoundsFromAnchor(anchorPoint, AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE, display);
      }
      if (transition.type === 'open_detached_panel') {
        const launcherBounds = this.getDetachedWindow()
          ? asBounds(this.getDetachedWindow()!.getBounds())
          : state.detachedLauncherBounds;
        if (launcherBounds) {
          return derivePanelBoundsFromLauncher(launcherBounds, display);
        }
      }
      if (state.detachedPanelBounds) {
        return clampBoundsToDisplay(state.detachedPanelBounds, display);
      }
      if (state.detachedLauncherBounds) {
        return derivePanelBoundsFromLauncher(state.detachedLauncherBounds, display);
      }
      return clampBoundsToDisplay({
        x: display.workArea.x + display.workArea.width - AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE.width - DISPLAY_MARGIN,
        y: display.workArea.y + display.workArea.height - AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE.height - DISPLAY_MARGIN,
        width: AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE.width,
        height: AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE.height
      }, display);
    }

    if (transition.type === 'detach_launcher' && anchorPoint) {
      return deriveBoundsFromAnchor(anchorPoint, AI_ASSISTANT_DETACHED_LAUNCHER_WINDOW_SIZE, display);
    }
    if (transition.type === 'collapse_detached_to_launcher') {
      const panelBounds = this.getDetachedWindow()
        ? asBounds(this.getDetachedWindow()!.getBounds())
        : state.detachedPanelBounds;
      if (panelBounds) {
        return deriveLauncherBoundsFromPanel(panelBounds, display);
      }
    }
    if (state.detachedLauncherBounds) {
      return clampBoundsToDisplay(state.detachedLauncherBounds, display);
    }
    if (state.detachedPanelBounds) {
      return deriveLauncherBoundsFromPanel(state.detachedPanelBounds, display);
    }
    return clampBoundsToDisplay({
      x: display.workArea.x + display.workArea.width - AI_ASSISTANT_DETACHED_LAUNCHER_WINDOW_SIZE.width - DISPLAY_MARGIN,
      y: display.workArea.y + display.workArea.height - AI_ASSISTANT_DETACHED_LAUNCHER_WINDOW_SIZE.height - DISPLAY_MARGIN,
      width: AI_ASSISTANT_DETACHED_LAUNCHER_WINDOW_SIZE.width,
      height: AI_ASSISTANT_DETACHED_LAUNCHER_WINDOW_SIZE.height
    }, display);
  }

  private async ensureDetachedWindow(): Promise<BrowserWindow> {
    const existing = this.getDetachedWindow();
    if (existing) {
      return existing;
    }

    const window = new BrowserWindow({
      width: AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE.width,
      height: AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE.height,
      minWidth: AI_ASSISTANT_DETACHED_PANEL_MIN_WINDOW_SIZE.width,
      minHeight: AI_ASSISTANT_DETACHED_PANEL_MIN_WINDOW_SIZE.height,
      show: false,
      title: 'KnowledgeBase Assistant',
      autoHideMenuBar: true,
      frame: false,
      transparent: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.detachedWindow = window;
    this.allowDetachedWindowClose = false;

    window.on('close', (event) => {
      if (this.allowDetachedWindowClose || this.isQuitting) {
        return;
      }
      event.preventDefault();
      logger.info('assistant-window.native-close-reattach');
      this.options.presentationService.transition({
        type: 'reattach_embedded_closed',
        reason: 'native_window_close'
      });
    });

    window.on('closed', () => {
      this.detachedWindow = null;
      this.allowDetachedWindowClose = false;
    });

    const persistBounds = () => {
      if (this.isApplyingWindowBounds) {
        return;
      }
      const currentWindow = this.getDetachedWindow();
      if (!currentWindow) {
        return;
      }
      const state = this.options.presentationService.getState();
      const surfaceMode: AiAssistantDetachedSurfaceMode = state.surfaceMode === 'panel' ? 'panel' : 'launcher';
      const bounds = asBounds(currentWindow.getBounds());
      const display = screen.getDisplayMatching(toRectangle(bounds));
      this.options.presentationService.transition({
        type: 'update_detached_bounds',
        surfaceMode,
        bounds,
        displayId: display.id
      });
    };

    window.on('move', persistBounds);
    window.on('resize', persistBounds);

    await this.options.loadRendererWindow(window, 'assistant_detached');
    return window;
  }

  private applyWindowMode(
    window: BrowserWindow,
    surfaceMode: AiAssistantDetachedSurfaceMode,
    bounds: AiAssistantWindowBounds
  ): void {
    this.isApplyingWindowBounds = true;
    try {
      if (surfaceMode === 'launcher') {
        window.setMinimumSize(AI_ASSISTANT_DETACHED_LAUNCHER_WINDOW_SIZE.width, AI_ASSISTANT_DETACHED_LAUNCHER_WINDOW_SIZE.height);
        window.setResizable(false);
      } else {
        window.setMinimumSize(AI_ASSISTANT_DETACHED_PANEL_MIN_WINDOW_SIZE.width, AI_ASSISTANT_DETACHED_PANEL_MIN_WINDOW_SIZE.height);
        window.setResizable(true);
      }
      window.setBounds(toRectangle(bounds), true);
      logger.info('assistant-window.apply-mode', {
        surfaceMode,
        bounds
      });
    } finally {
      this.isApplyingWindowBounds = false;
    }
  }

  private destroyDetachedWindow(): void {
    const window = this.getDetachedWindow();
    if (!window) {
      return;
    }
    this.allowDetachedWindowClose = true;
    window.close();
  }
}
