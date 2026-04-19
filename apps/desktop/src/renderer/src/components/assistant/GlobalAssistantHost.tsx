import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE,
  AI_ASSISTANT_LAUNCHER_BUTTON_SIZE,
  type AiArtifactType,
  type AiMessageRecord
} from '@kb-vault/shared-types';
import { useAiAssistant } from './AssistantContext';
import { AssistantLauncher } from './AssistantLauncher';
import { AssistantHeader } from './AssistantHeader';
import { AssistantTranscript } from './AssistantTranscript';
import { AssistantArtifactCard } from './AssistantArtifactCard';
import { AssistantComposer } from './AssistantComposer';
import { AssistantEmptyState } from './AssistantEmptyState';
import { AssistantHistoryList } from './AssistantHistoryList';
import { IconAlertCircle, IconArrowUpRight, IconPanelRight, IconRefreshCw } from '../icons';

const AI_LAUNCHER_SIZE = AI_ASSISTANT_LAUNCHER_BUTTON_SIZE;
const AI_LAUNCHER_MARGIN = 24;
const AI_PANEL_GAP = 12;
const AI_PANEL_MIN_MARGIN = 24;
const AI_PANEL_WIDTH_CLOSED = 420;
const AI_PANEL_WIDTH_HISTORY = 700;
const AI_PANEL_MAX_HEIGHT = 740;
const AI_DETACHED_HISTORY_WIDTH_DELTA = AI_PANEL_WIDTH_HISTORY - AI_PANEL_WIDTH_CLOSED;
const AI_PROPOSAL_DISMISS_DELAY_MS = 10_000;

type LauncherPosition = {
  left: number;
  top: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getDefaultLauncherPosition(): LauncherPosition {
  return {
    left: window.innerWidth - AI_LAUNCHER_SIZE - AI_LAUNCHER_MARGIN,
    top: window.innerHeight - AI_LAUNCHER_SIZE - AI_LAUNCHER_MARGIN
  };
}

function clampLauncherPosition(position: LauncherPosition): LauncherPosition {
  return {
    left: clamp(position.left, AI_PANEL_MIN_MARGIN, window.innerWidth - AI_LAUNCHER_SIZE - AI_PANEL_MIN_MARGIN),
    top: clamp(position.top, AI_PANEL_MIN_MARGIN, window.innerHeight - AI_LAUNCHER_SIZE - AI_PANEL_MIN_MARGIN)
  };
}

function extractMessageArtifactMeta(message: AiMessageRecord): {
  artifactId?: string;
  artifactType?: AiArtifactType;
} {
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }

  const artifactId = typeof metadata.artifactId === 'string' ? metadata.artifactId : undefined;
  const artifactType = typeof metadata.artifactType === 'string'
    ? metadata.artifactType as AiArtifactType
    : undefined;
  return { artifactId, artifactType };
}

function useDetachedWindowDrag(): (position: { x: number; y: number }) => void {
  const frameRef = useRef<number | null>(null);
  const pendingPositionRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => () => {
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  return useCallback((position: { x: number; y: number }) => {
    pendingPositionRef.current = position;
    if (frameRef.current != null) {
      return;
    }
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const nextPosition = pendingPositionRef.current;
      pendingPositionRef.current = null;
      if (nextPosition) {
        window.kbv?.moveAssistantWindow?.(nextPosition);
      }
    });
  }, []);
}

function finishDetachedWindowDrag(): void {
  window.kbv?.finishAssistantWindowDrag?.();
}

function resizeDetachedWindow(payload: { width: number; height?: number }): void {
  window.kbv?.resizeAssistantWindow?.({
    ...payload,
    anchor: 'bottom_right'
  });
}

function AssistantDockAction({
  mode,
  onAction
}: {
  mode: 'out' | 'in';
  onAction: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleClick = useCallback(() => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    void onAction()
      .catch((detachError: unknown) => {
        setError(detachError instanceof Error ? detachError.message : String(detachError));
      })
      .finally(() => {
        setBusy(false);
      });
  }, [busy, onAction]);

  const isPopOut = mode === 'out';
  const title = isPopOut ? 'Pop out the assistant' : 'Pop the assistant back into the app';
  const icon = isPopOut ? <IconArrowUpRight size={12} /> : <IconPanelRight size={12} />;

  return (
    <>
      <button
        type="button"
        className={[
          'ai-header__detach',
          busy && 'ai-header__detach--busy'
        ].filter(Boolean).join(' ')}
        onClick={handleClick}
        title={title}
        aria-label={title}
      >
        {icon}
      </button>
      {error && (
        <div className="ai-header__detach-error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}

export function AssistantPanelContent({
  hostMode = 'embedded',
  style,
  dragHandle,
  onWindowDrag,
  onWindowDragEnd,
  onClose
}: {
  hostMode?: 'embedded' | 'detached';
  style?: CSSProperties;
  dragHandle?: ReactNode;
  onWindowDrag?: (position: { x: number; y: number }) => void;
  onWindowDragEnd?: () => void;
  onClose?: () => void;
}) {
  const {
    routeContext,
    session,
    sessions,
    messages,
    artifact,
    pendingTurn,
    loading,
    sending,
    error,
    historyOpen,
    setHistoryOpen,
    sendMessage,
    resetSession,
    createSession,
    openSession,
    deleteSession,
    applyArtifact,
    rejectArtifact,
    rerunLastMessage
  } = useAiAssistant();

  const isStale = useMemo(() => {
    if (!artifact || artifact.status !== 'pending') return false;
    if (!routeContext?.workingState?.versionToken) return false;
    if (!artifact.baseVersionToken) return false;
    return artifact.baseVersionToken !== routeContext.workingState.versionToken;
  }, [artifact, routeContext]);

  const [dismissedArtifactIds, setDismissedArtifactIds] = useState<string[]>([]);

  const dismissArtifactCard = useCallback((artifactId: string) => {
    setDismissedArtifactIds((current) => (
      current.includes(artifactId) ? current : [...current, artifactId]
    ));
  }, []);

  useEffect(() => {
    if (!artifact) {
      return;
    }
    const shouldAutoDismiss =
      (artifact.artifactType === 'proposal_candidate' && (artifact.status === 'applied' || artifact.status === 'rejected'))
      || (artifact.artifactType === 'proposal_patch' && artifact.status === 'applied');
    if (!shouldAutoDismiss) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      dismissArtifactCard(artifact.id);
    }, AI_PROPOSAL_DISMISS_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [artifact, dismissArtifactCard]);

  const showArtifact = artifact
    && artifact.artifactType !== 'informational_response'
    && !dismissedArtifactIds.includes(artifact.id)
    && (
      artifact.artifactType === 'proposal_candidate'
        ? artifact.status !== 'superseded'
        : (artifact.status === 'pending' || artifact.status === 'applied')
    );
  const transcriptMessages = useMemo(() => {
    if (!artifact) {
      return messages;
    }

    return messages.filter((message) => {
      if (message.messageKind !== 'artifact') {
        return true;
      }

      const { artifactId, artifactType } = extractMessageArtifactMeta(message);
      if (!artifactId || artifactId !== artifact.id) {
        return true;
      }

      return artifactType === 'informational_response';
    });
  }, [artifact, messages]);
  const showTranscript = transcriptMessages.length > 0 || Boolean(pendingTurn);

  return (
    <aside
      className={[
        'ai-panel',
        hostMode === 'embedded' && 'ai-panel--embedded',
        hostMode === 'detached' && 'ai-panel--detached',
        historyOpen && 'ai-panel--history-open'
      ].filter(Boolean).join(' ')}
      style={style}
      role="complementary"
      aria-label="AI Assistant"
    >
      <div className={`ai-panel__history-sidebar${historyOpen ? ' open' : ''}`}>
        <div className="ai-panel__history-sidebar-inner">
          <AssistantHistoryList
            sessions={sessions}
            activeSessionId={session?.id}
            loading={loading}
            onOpen={(sessionId) => void openSession(sessionId)}
            onDelete={(sessionId) => void deleteSession(sessionId)}
            onNewChat={() => void createSession()}
            onClose={() => setHistoryOpen(false)}
          />
        </div>
      </div>

      <div className="ai-panel__chat">
        <AssistantHeader
          context={routeContext}
          session={session}
          artifact={artifact}
          loading={loading}
          historyOpen={historyOpen}
          sessionCount={sessions.length}
          dragHandle={dragHandle}
          onWindowDrag={onWindowDrag}
          onWindowDragEnd={onWindowDragEnd}
          onCreateSession={() => void createSession()}
          onToggleHistory={() => setHistoryOpen(!historyOpen)}
          onClose={() => onClose?.()}
        />

        <div className="ai-panel__body">
          {showArtifact && artifact && (
            <div className="ai-panel__artifact-slot">
              <AssistantArtifactCard
                artifact={artifact}
                stale={isStale}
                loading={loading}
                onDismiss={() => dismissArtifactCard(artifact.id)}
                onApply={() => void applyArtifact()}
                onReject={() => void rejectArtifact()}
                onRerun={() => void rerunLastMessage()}
              />
            </div>
          )}

          {showTranscript ? (
            <AssistantTranscript messages={transcriptMessages} pendingTurn={pendingTurn} loading={sending} />
          ) : (
            !(loading || pendingTurn) && <AssistantEmptyState context={routeContext} />
          )}

          {loading && !showTranscript && !pendingTurn && (
            <div className="ai-panel__loading" role="status" aria-label="Loading">
              <div className="ai-typing ai-typing--large">
                <span /><span /><span />
              </div>
              <span>Starting assistant...</span>
            </div>
          )}
        </div>

        {error && (
          <div className="ai-panel__error" role="alert">
            <IconAlertCircle size={14} />
            <span>{error}</span>
            <button
              type="button"
              className="ai-panel__error-retry"
              onClick={() => void resetSession()}
              title="Reset and retry"
            >
              <IconRefreshCw size={12} />
            </button>
          </div>
        )}

        <AssistantComposer
          context={routeContext}
          loading={sending}
          onSend={sendMessage}
        />
      </div>
    </aside>
  );
}

export function GlobalAssistantHost() {
  const {
    presentation,
    open,
    setOpen,
    hasUnread,
    loading,
    sending,
    historyOpen,
    embeddedLauncherPosition,
    setEmbeddedLauncherPosition,
    detachPanel
  } = useAiAssistant();

  const launcherPosition = useMemo(
    () => clampLauncherPosition(embeddedLauncherPosition ?? getDefaultLauncherPosition()),
    [embeddedLauncherPosition]
  );

  useEffect(() => {
    if (
      embeddedLauncherPosition?.left !== launcherPosition.left
      || embeddedLauncherPosition?.top !== launcherPosition.top
    ) {
      void setEmbeddedLauncherPosition(launcherPosition);
    }
  }, [embeddedLauncherPosition?.left, embeddedLauncherPosition?.top, launcherPosition, setEmbeddedLauncherPosition]);

  useEffect(() => {
    const handleResize = () => {
      const clamped = clampLauncherPosition(launcherPosition);
      if (clamped.left !== launcherPosition.left || clamped.top !== launcherPosition.top) {
        void setEmbeddedLauncherPosition(clamped);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [launcherPosition, setEmbeddedLauncherPosition]);

  const handleToggle = useCallback(() => setOpen(!open), [open, setOpen]);

  const handlePositionChange = useCallback((position: LauncherPosition) => {
    void setEmbeddedLauncherPosition(clampLauncherPosition(position));
  }, [setEmbeddedLauncherPosition]);

  const launcherStyle = useMemo<CSSProperties>(() => ({
    left: `${launcherPosition.left}px`,
    top: `${launcherPosition.top}px`,
    right: 'auto',
    bottom: 'auto'
  }), [launcherPosition.left, launcherPosition.top]);

  const panelLayout = useMemo(() => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const panelWidth = Math.min(historyOpen ? AI_PANEL_WIDTH_HISTORY : AI_PANEL_WIDTH_CLOSED, viewportWidth - 48);
    const panelHeight = Math.min(AI_PANEL_MAX_HEIGHT, viewportHeight * 0.72);
    const panelRightEdge = clamp(
      launcherPosition.left + AI_LAUNCHER_SIZE,
      AI_PANEL_MIN_MARGIN + panelWidth,
      viewportWidth - AI_PANEL_MIN_MARGIN
    );
    const top = clamp(
      launcherPosition.top - panelHeight - AI_PANEL_GAP,
      AI_PANEL_MIN_MARGIN,
      viewportHeight - panelHeight - AI_PANEL_MIN_MARGIN
    );

    return {
      viewportWidth,
      top,
      panelRightEdge
    };
  }, [historyOpen, launcherPosition.left, launcherPosition.top]);

  const panelStyle = useMemo<CSSProperties>(() => {
    return {
      left: 'auto',
      top: `${panelLayout.top}px`,
      right: `${panelLayout.viewportWidth - panelLayout.panelRightEdge}px`,
      bottom: 'auto'
    };
  }, [panelLayout]);

  const handlePopOut = useCallback(async () => {
    const detachedWidth = AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE.width + (historyOpen ? AI_DETACHED_HISTORY_WIDTH_DELTA : 0);
    const detachedHeight = AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE.height;
    const detachedX = window.screenX + panelLayout.panelRightEdge - detachedWidth;
    const detachedY = window.screenY + panelLayout.top;

    await detachPanel({
      x: detachedX + detachedWidth / 2,
      y: detachedY + detachedHeight / 2
    });
  }, [detachPanel, historyOpen, panelLayout.panelRightEdge, panelLayout.top]);

  if (presentation.dockMode === 'detached') {
    return null;
  }

  return (
    <>
      <AssistantLauncher
        open={open}
        loading={loading || sending}
        hasUnread={hasUnread}
        positionStyle={launcherStyle}
        position={launcherPosition}
        onPositionChange={handlePositionChange}
        onToggle={handleToggle}
      />

      {open && (
        <AssistantPanelContent
          hostMode="embedded"
          style={panelStyle}
          dragHandle={(
            <AssistantDockAction mode="out" onAction={handlePopOut} />
          )}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function DetachedAssistantWindowHost() {
  const {
    presentation,
    open,
    setOpen,
    hasUnread,
    loading,
    sending,
    historyOpen,
    reattachEmbeddedOpen
  } = useAiAssistant();
  const moveDetachedWindow = useDetachedWindowDrag();

  useLayoutEffect(() => {
    if (presentation.dockMode !== 'detached' || !open || presentation.surfaceMode !== 'panel') {
      return;
    }
    const targetWidth = AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE.width + (historyOpen ? AI_DETACHED_HISTORY_WIDTH_DELTA : 0);
    const currentWidth = presentation.detachedPanelBounds?.width ?? AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE.width;
    if (currentWidth === targetWidth) {
      return;
    }

    resizeDetachedWindow({
      width: targetWidth
    });
  }, [historyOpen, open, presentation.detachedPanelBounds?.width, presentation.dockMode, presentation.surfaceMode]);

  const handlePopIn = useCallback(async () => {
    await reattachEmbeddedOpen();
  }, [reattachEmbeddedOpen]);

  if (presentation.dockMode !== 'detached') {
    return null;
  }

  return (
    <div className="assistant-window">
      <div
        className={[
          'assistant-window__panel-shell',
          open ? 'assistant-window__panel-shell--visible' : 'assistant-window__panel-shell--hidden'
        ].join(' ')}
        aria-hidden={!open}
      >
        <AssistantPanelContent
          hostMode="detached"
          dragHandle={(
            <AssistantDockAction mode="in" onAction={handlePopIn} />
          )}
          onWindowDrag={moveDetachedWindow}
          onWindowDragEnd={finishDetachedWindowDrag}
          onClose={() => setOpen(false)}
        />
      </div>
      <div className="assistant-window__launcher-slot">
        <AssistantLauncher
          open={open}
          loading={loading || sending}
          hasUnread={hasUnread}
          onWindowDrag={moveDetachedWindow}
          onWindowDragEnd={finishDetachedWindowDrag}
          onToggle={() => setOpen(!open)}
        />
      </div>
    </div>
  );
}
