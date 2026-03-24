import { useMemo, useCallback } from 'react';
import { useAiAssistant } from './AssistantContext';
import { AssistantLauncher } from './AssistantLauncher';
import { AssistantHeader } from './AssistantHeader';
import { AssistantTranscript } from './AssistantTranscript';
import { AssistantArtifactCard } from './AssistantArtifactCard';
import { AssistantComposer } from './AssistantComposer';
import { AssistantEmptyState } from './AssistantEmptyState';
import { AssistantHistoryList } from './AssistantHistoryList';
import { IconAlertCircle, IconRefreshCw } from '../icons';

export function AssistantPanelContent({ embedded = false }: { embedded?: boolean }) {
  const {
    routeContext,
    session,
    sessions,
    messages,
    artifact,
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
    rejectArtifact
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
  const showTranscript = messages.length > 0;

  return (
    <aside
      className={[
        'ai-panel',
        embedded && 'ai-panel--embedded',
        historyOpen && 'ai-panel--history-open'
      ].filter(Boolean).join(' ')}
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
              />
            </div>
          )}

          {showTranscript ? (
            <AssistantTranscript messages={messages} loading={sending} />
          ) : (
            !loading && <AssistantEmptyState context={routeContext} />
          )}

          {loading && !showTranscript && (
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
  const { open, setOpen, messages, loading, sending } = useAiAssistant();

  const hasUnread = useMemo(() => {
    if (open) return false;
    if (messages.length === 0) return false;
    const last = messages[messages.length - 1];
    return last.role === 'assistant';
  }, [open, messages]);

  const handleToggle = useCallback(() => setOpen(!open), [open, setOpen]);

  return (
    <>
      <AssistantLauncher
        open={open}
        loading={loading || sending}
        hasUnread={hasUnread}
        onToggle={handleToggle}
      />

      {open && <AssistantPanelContent />}
    </>
  );
}
