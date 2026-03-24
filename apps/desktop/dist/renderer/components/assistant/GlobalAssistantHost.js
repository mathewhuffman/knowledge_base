import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
export function AssistantPanelContent({ embedded = false }) {
    const { routeContext, session, sessions, messages, artifact, loading, sending, error, historyOpen, setHistoryOpen, sendMessage, resetSession, createSession, openSession, deleteSession, applyArtifact, rejectArtifact } = useAiAssistant();
    const isStale = useMemo(() => {
        if (!artifact || artifact.status !== 'pending')
            return false;
        if (!routeContext?.workingState?.versionToken)
            return false;
        if (!artifact.baseVersionToken)
            return false;
        return artifact.baseVersionToken !== routeContext.workingState.versionToken;
    }, [artifact, routeContext]);
    const showArtifact = artifact
        && artifact.artifactType !== 'informational_response'
        && (artifact.status === 'pending' || artifact.status === 'applied');
    const showTranscript = messages.length > 0;
    return (_jsxs("aside", { className: [
            'ai-panel',
            embedded && 'ai-panel--embedded',
            historyOpen && 'ai-panel--history-open'
        ].filter(Boolean).join(' '), role: "complementary", "aria-label": "AI Assistant", children: [_jsx("div", { className: `ai-panel__history-sidebar${historyOpen ? ' open' : ''}`, children: _jsx("div", { className: "ai-panel__history-sidebar-inner", children: _jsx(AssistantHistoryList, { sessions: sessions, activeSessionId: session?.id, loading: loading, onOpen: (sessionId) => void openSession(sessionId), onDelete: (sessionId) => void deleteSession(sessionId), onNewChat: () => void createSession(), onClose: () => setHistoryOpen(false) }) }) }), _jsxs("div", { className: "ai-panel__chat", children: [_jsx(AssistantHeader, { context: routeContext, session: session, artifact: artifact, loading: loading, historyOpen: historyOpen, sessionCount: sessions.length, onCreateSession: () => void createSession(), onToggleHistory: () => setHistoryOpen(!historyOpen) }), _jsxs("div", { className: "ai-panel__body", children: [showArtifact && artifact && (_jsx("div", { className: "ai-panel__artifact-slot", children: _jsx(AssistantArtifactCard, { artifact: artifact, stale: isStale, loading: loading, onApply: () => void applyArtifact(), onReject: () => void rejectArtifact() }) })), showTranscript ? (_jsx(AssistantTranscript, { messages: messages, loading: sending })) : (!loading && _jsx(AssistantEmptyState, { context: routeContext })), loading && !showTranscript && (_jsxs("div", { className: "ai-panel__loading", role: "status", "aria-label": "Loading", children: [_jsxs("div", { className: "ai-typing ai-typing--large", children: [_jsx("span", {}), _jsx("span", {}), _jsx("span", {})] }), _jsx("span", { children: "Starting assistant..." })] }))] }), error && (_jsxs("div", { className: "ai-panel__error", role: "alert", children: [_jsx(IconAlertCircle, { size: 14 }), _jsx("span", { children: error }), _jsx("button", { type: "button", className: "ai-panel__error-retry", onClick: () => void resetSession(), title: "Reset and retry", children: _jsx(IconRefreshCw, { size: 12 }) })] })), _jsx(AssistantComposer, { context: routeContext, loading: sending, onSend: sendMessage })] })] }));
}
export function GlobalAssistantHost() {
    const { open, setOpen, messages, loading, sending } = useAiAssistant();
    const hasUnread = useMemo(() => {
        if (open)
            return false;
        if (messages.length === 0)
            return false;
        const last = messages[messages.length - 1];
        return last.role === 'assistant';
    }, [open, messages]);
    const handleToggle = useCallback(() => setOpen(!open), [open, setOpen]);
    return (_jsxs(_Fragment, { children: [_jsx(AssistantLauncher, { open: open, loading: loading || sending, hasUnread: hasUnread, onToggle: handleToggle }), open && _jsx(AssistantPanelContent, {})] }));
}
