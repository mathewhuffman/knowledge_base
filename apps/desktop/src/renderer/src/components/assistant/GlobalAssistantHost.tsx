import { useMemo, useCallback } from 'react';
import { useAiAssistant } from './AssistantContext';
import { AssistantLauncher } from './AssistantLauncher';
import { AssistantHeader } from './AssistantHeader';
import { AssistantTranscript } from './AssistantTranscript';
import { AssistantArtifactCard } from './AssistantArtifactCard';
import { AssistantComposer } from './AssistantComposer';
import { AssistantEmptyState } from './AssistantEmptyState';
import { IconAlertCircle, IconRefreshCw } from '../icons';

export function AssistantPanelContent({ embedded = false }: { embedded?: boolean }) {
  const {
    routeContext,
    session,
    messages,
    artifact,
    loading,
    error,
    sendMessage,
    resetSession,
    applyArtifact,
    rejectArtifact
  } = useAiAssistant();

  // Detect stale artifacts by checking if the artifact's base version token
  // differs from the current working state version token
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
    <aside className={`ai-panel${embedded ? ' ai-panel--embedded' : ''}`} role="complementary" aria-label="AI Assistant">
      <AssistantHeader
        context={routeContext}
        session={session}
        artifact={artifact}
        loading={loading}
        onReset={() => void resetSession()}
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
          <AssistantTranscript messages={messages} loading={loading} />
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
        loading={loading}
        onSend={sendMessage}
      />
    </aside>
  );
}

export function GlobalAssistantHost() {
  const { open, setOpen, messages, loading } = useAiAssistant();

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
        loading={loading}
        hasUnread={hasUnread}
        onToggle={handleToggle}
      />

      {open && <AssistantPanelContent />}
    </>
  );
}
