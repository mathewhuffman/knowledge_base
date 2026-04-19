import { expect, test } from '@playwright/test';
import { AssistantPresentationService } from '../src/main/services/assistant-presentation-service';

test.describe('assistant presentation service', () => {
  test('supports embedded and detached presentation transitions', () => {
    let persisted: Record<string, unknown> = {};
    const service = new AssistantPresentationService({}, (nextPreferences) => {
      persisted = nextPreferences as Record<string, unknown>;
    });

    expect(service.getState().state).toBe('embedded_closed');

    service.transition({ type: 'set_embedded_launcher_position', position: { left: 112, top: 224 } });
    service.transition({ type: 'open_embedded_panel' });
    expect(service.getState().state).toBe('embedded_open');

    service.transition({ type: 'detach_launcher', anchorPoint: { x: 800, y: 600 } });
    expect(service.getState().state).toBe('detached_launcher');
    expect(service.getState().lastDetachedSurfaceMode).toBe('launcher');

    service.transition({
      type: 'update_detached_bounds',
      surfaceMode: 'launcher',
      bounds: { x: 760, y: 560, width: 156, height: 120 },
      displayId: 2
    });
    service.transition({ type: 'open_detached_panel' });
    expect(service.getState().state).toBe('detached_panel');
    expect(service.getState().lastDetachedSurfaceMode).toBe('panel');

    service.transition({
      type: 'update_detached_bounds',
      surfaceMode: 'panel',
      bounds: { x: 520, y: 180, width: 460, height: 760 },
      displayId: 2
    });
    service.transition({ type: 'collapse_detached_to_launcher' });
    expect(service.getState().state).toBe('detached_launcher');
    expect(service.getState().lastDetachedSurfaceMode).toBe('launcher');

    service.transition({ type: 'reattach_embedded_open', reason: 'drag_reenter' });
    expect(service.getState().state).toBe('embedded_open');

    service.transition({ type: 'reattach_embedded_closed', reason: 'native_window_close' });
    expect(service.getState().state).toBe('embedded_closed');
    expect(service.getState().embeddedLauncherPosition).toEqual({ left: 112, top: 224 });
    expect(persisted).toMatchObject({
      embeddedLauncherPosition: { left: 112, top: 224 },
      detachedLauncherBounds: { x: 760, y: 560, width: 156, height: 120 },
      detachedPanelBounds: { x: 520, y: 180, width: 460, height: 760 },
      detachedDisplayId: 2,
      lastDetachedSurfaceMode: 'launcher'
    });
  });

  test('tracks unread state based on the visible surface', () => {
    const service = new AssistantPresentationService({}, () => undefined);

    service.handleAssistantReplyFinished();
    expect(service.getState().hasUnread).toBe(true);

    service.transition({ type: 'open_embedded_panel' });
    expect(service.getState().hasUnread).toBe(false);

    service.handleAssistantReplyFinished();
    expect(service.getState().hasUnread).toBe(false);

    service.transition({ type: 'close_embedded_panel' });
    service.handleAssistantReplyFinished();
    expect(service.getState().hasUnread).toBe(true);

    service.transition({ type: 'detach_panel', anchorPoint: { x: 400, y: 400 } });
    expect(service.getState().hasUnread).toBe(false);

    service.transition({ type: 'collapse_detached_to_launcher' });
    service.handleAssistantReplyFinished();
    expect(service.getState().hasUnread).toBe(true);
  });
});
