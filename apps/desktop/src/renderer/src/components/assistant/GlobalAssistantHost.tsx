import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useAiAssistant } from './AssistantContext';
import { AssistantLauncher } from './AssistantLauncher';
import { AssistantHeader } from './AssistantHeader';
import { AssistantTranscript } from './AssistantTranscript';
import { AssistantArtifactCard } from './AssistantArtifactCard';
import { AssistantComposer } from './AssistantComposer';
import { AssistantEmptyState } from './AssistantEmptyState';
import { AssistantHistoryList } from './AssistantHistoryList';
import { IconAlertCircle, IconRefreshCw } from '../icons';

const AI_LAUNCHER_SIZE = 48;
const AI_LAUNCHER_MARGIN = 24;
const AI_PANEL_GAP = 12;
const AI_PANEL_MIN_MARGIN = 24;
const AI_PANEL_WIDTH_CLOSED = 420;
const AI_PANEL_WIDTH_HISTORY = 700;
const AI_PANEL_MAX_HEIGHT = 740;
const AI_LAUNCHER_POSITION_KEY = 'kbv:ai-launcher-position';

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

function loadLauncherPosition(): LauncherPosition {
  try {
    const raw = window.localStorage.getItem(AI_LAUNCHER_POSITION_KEY);
    if (!raw) return getDefaultLauncherPosition();
    const parsed = JSON.parse(raw) as Partial<LauncherPosition>;
    if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') {
      return getDefaultLauncherPosition();
    }
    return clampLauncherPosition({ left: parsed.left, top: parsed.top });
  } catch {
    return getDefaultLauncherPosition();
  }
}

export function AssistantPanelContent({
  embedded = false,
  style,
  onClose,
  launcherPosition,
  onLauncherPositionChange
}: {
  embedded?: boolean;
  style?: CSSProperties;
  onClose?: () => void;
  launcherPosition: LauncherPosition;
  onLauncherPositionChange: (position: LauncherPosition) => void;
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

  const showArtifact = artifact
    && artifact.artifactType !== 'informational_response'
    && (artifact.status === 'pending' || artifact.status === 'applied');
  const showTranscript = messages.length > 0 || Boolean(pendingTurn);

  return (
    <aside
      className={[
        'ai-panel',
        embedded && 'ai-panel--embedded',
        historyOpen && 'ai-panel--history-open'
      ].filter(Boolean).join(' ')}
      style={style}
      role="complementary"
      aria-label="AI Assistant"
    >
      {/* History sidebar — slides in from the left */}
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

      {/* Main chat column */}
      <div className="ai-panel__chat">
        <AssistantHeader
          context={routeContext}
          session={session}
          artifact={artifact}
          loading={loading}
          historyOpen={historyOpen}
          sessionCount={sessions.length}
          onCreateSession={() => void createSession()}
          onToggleHistory={() => setHistoryOpen(!historyOpen)}
          onClose={() => onClose?.()}
          launcherPosition={launcherPosition}
          onLauncherPositionChange={onLauncherPositionChange}
        />

        <div className="ai-panel__body">
          {showArtifact && artifact && (
            <div className="ai-panel__artifact-slot">
              <AssistantArtifactCard
                artifact={artifact}
                stale={isStale}
                loading={loading}
                onApply={() => void applyArtifact()}
                onReject={() => void rejectArtifact()}
                onRerun={() => void rerunLastMessage()}
              />
            </div>
          )}

          {showTranscript ? (
            <AssistantTranscript messages={messages} pendingTurn={pendingTurn} loading={sending} />
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
  const { open, setOpen, hasUnread, loading, sending, historyOpen } = useAiAssistant();
  const [launcherPosition, setLauncherPosition] = useState<LauncherPosition>(() => loadLauncherPosition());

  const handleToggle = useCallback(() => setOpen(!open), [open, setOpen]);

  const handlePositionChange = useCallback((position: LauncherPosition) => {
    setLauncherPosition(clampLauncherPosition(position));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(AI_LAUNCHER_POSITION_KEY, JSON.stringify(launcherPosition));
  }, [launcherPosition]);

  useEffect(() => {
    const handleResize = () => {
      setLauncherPosition((current) => clampLauncherPosition(current));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const launcherStyle = useMemo<CSSProperties>(() => ({
    left: `${launcherPosition.left}px`,
    top: `${launcherPosition.top}px`,
    right: 'auto',
    bottom: 'auto'
  }), [launcherPosition.left, launcherPosition.top]);

  const panelStyle = useMemo<CSSProperties>(() => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const closedPanelWidth = Math.min(AI_PANEL_WIDTH_CLOSED, viewportWidth - 48);
    const panelHeight = Math.min(AI_PANEL_MAX_HEIGHT, viewportHeight * 0.72);
    const panelRightEdge = clamp(
      launcherPosition.left + AI_LAUNCHER_SIZE,
      AI_PANEL_MIN_MARGIN + closedPanelWidth,
      viewportWidth - AI_PANEL_MIN_MARGIN
    );

    return {
      left: 'auto',
      top: `${clamp(
        launcherPosition.top - panelHeight - AI_PANEL_GAP,
        AI_PANEL_MIN_MARGIN,
        viewportHeight - panelHeight - AI_PANEL_MIN_MARGIN
      )}px`,
      right: `${viewportWidth - panelRightEdge}px`,
      bottom: 'auto'
    };
  }, [launcherPosition.left, launcherPosition.top]);

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
          style={panelStyle}
          onClose={() => setOpen(false)}
          launcherPosition={launcherPosition}
          onLauncherPositionChange={handlePositionChange}
        />
      )}
    </>
  );
}
