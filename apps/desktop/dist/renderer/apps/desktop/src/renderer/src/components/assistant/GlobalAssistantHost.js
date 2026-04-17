import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from 'react';
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
const AI_PROPOSAL_DISMISS_DELAY_MS = 10_000;
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
function getDefaultLauncherPosition() {
    return {
        left: window.innerWidth - AI_LAUNCHER_SIZE - AI_LAUNCHER_MARGIN,
        top: window.innerHeight - AI_LAUNCHER_SIZE - AI_LAUNCHER_MARGIN
    };
}
function clampLauncherPosition(position) {
    return {
        left: clamp(position.left, AI_PANEL_MIN_MARGIN, window.innerWidth - AI_LAUNCHER_SIZE - AI_PANEL_MIN_MARGIN),
        top: clamp(position.top, AI_PANEL_MIN_MARGIN, window.innerHeight - AI_LAUNCHER_SIZE - AI_PANEL_MIN_MARGIN)
    };
}
function loadLauncherPosition() {
    try {
        const raw = window.localStorage.getItem(AI_LAUNCHER_POSITION_KEY);
        if (!raw)
            return getDefaultLauncherPosition();
        const parsed = JSON.parse(raw);
        if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') {
            return getDefaultLauncherPosition();
        }
        return clampLauncherPosition({ left: parsed.left, top: parsed.top });
    }
    catch {
        return getDefaultLauncherPosition();
    }
}
function extractMessageArtifactMeta(message) {
    const metadata = message.metadata;
    if (!metadata || typeof metadata !== 'object') {
        return {};
    }
    const artifactId = typeof metadata.artifactId === 'string' ? metadata.artifactId : undefined;
    const artifactType = typeof metadata.artifactType === 'string'
        ? metadata.artifactType
        : undefined;
    return { artifactId, artifactType };
}
export function AssistantPanelContent({ embedded = false, style, onClose, launcherPosition, onLauncherPositionChange }) {
    const { routeContext, session, sessions, messages, artifact, pendingTurn, loading, sending, error, historyOpen, setHistoryOpen, sendMessage, resetSession, createSession, openSession, deleteSession, applyArtifact, rejectArtifact, rerunLastMessage } = useAiAssistant();
    const isStale = useMemo(() => {
        if (!artifact || artifact.status !== 'pending')
            return false;
        if (!routeContext?.workingState?.versionToken)
            return false;
        if (!artifact.baseVersionToken)
            return false;
        return artifact.baseVersionToken !== routeContext.workingState.versionToken;
    }, [artifact, routeContext]);
    const [dismissedArtifactIds, setDismissedArtifactIds] = useState([]);
    const dismissArtifactCard = useCallback((artifactId) => {
        setDismissedArtifactIds((current) => (current.includes(artifactId) ? current : [...current, artifactId]));
    }, []);
    useEffect(() => {
        if (!artifact) {
            return;
        }
        const shouldAutoDismiss = (artifact.artifactType === 'proposal_candidate' && (artifact.status === 'applied' || artifact.status === 'rejected'))
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
        && (artifact.artifactType === 'proposal_candidate'
            ? artifact.status !== 'superseded'
            : (artifact.status === 'pending' || artifact.status === 'applied'));
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
    return (_jsxs("aside", { className: [
            'ai-panel',
            embedded && 'ai-panel--embedded',
            historyOpen && 'ai-panel--history-open'
        ].filter(Boolean).join(' '), style: style, role: "complementary", "aria-label": "AI Assistant", children: [_jsx("div", { className: `ai-panel__history-sidebar${historyOpen ? ' open' : ''}`, children: _jsx("div", { className: "ai-panel__history-sidebar-inner", children: _jsx(AssistantHistoryList, { sessions: sessions, activeSessionId: session?.id, loading: loading, onOpen: (sessionId) => void openSession(sessionId), onDelete: (sessionId) => void deleteSession(sessionId), onNewChat: () => void createSession(), onClose: () => setHistoryOpen(false) }) }) }), _jsxs("div", { className: "ai-panel__chat", children: [_jsx(AssistantHeader, { context: routeContext, session: session, artifact: artifact, loading: loading, historyOpen: historyOpen, sessionCount: sessions.length, onCreateSession: () => void createSession(), onToggleHistory: () => setHistoryOpen(!historyOpen), onClose: () => onClose?.(), launcherPosition: launcherPosition, onLauncherPositionChange: onLauncherPositionChange }), _jsxs("div", { className: "ai-panel__body", children: [showArtifact && artifact && (_jsx("div", { className: "ai-panel__artifact-slot", children: _jsx(AssistantArtifactCard, { artifact: artifact, stale: isStale, loading: loading, onDismiss: () => dismissArtifactCard(artifact.id), onApply: () => void applyArtifact(), onReject: () => void rejectArtifact(), onRerun: () => void rerunLastMessage() }) })), showTranscript ? (_jsx(AssistantTranscript, { messages: transcriptMessages, pendingTurn: pendingTurn, loading: sending })) : (!(loading || pendingTurn) && _jsx(AssistantEmptyState, { context: routeContext })), loading && !showTranscript && !pendingTurn && (_jsxs("div", { className: "ai-panel__loading", role: "status", "aria-label": "Loading", children: [_jsxs("div", { className: "ai-typing ai-typing--large", children: [_jsx("span", {}), _jsx("span", {}), _jsx("span", {})] }), _jsx("span", { children: "Starting assistant..." })] }))] }), error && (_jsxs("div", { className: "ai-panel__error", role: "alert", children: [_jsx(IconAlertCircle, { size: 14 }), _jsx("span", { children: error }), _jsx("button", { type: "button", className: "ai-panel__error-retry", onClick: () => void resetSession(), title: "Reset and retry", children: _jsx(IconRefreshCw, { size: 12 }) })] })), _jsx(AssistantComposer, { context: routeContext, loading: sending, onSend: sendMessage })] })] }));
}
export function GlobalAssistantHost() {
    const { open, setOpen, hasUnread, loading, sending, historyOpen } = useAiAssistant();
    const [launcherPosition, setLauncherPosition] = useState(() => loadLauncherPosition());
    const handleToggle = useCallback(() => setOpen(!open), [open, setOpen]);
    const handlePositionChange = useCallback((position) => {
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
    const launcherStyle = useMemo(() => ({
        left: `${launcherPosition.left}px`,
        top: `${launcherPosition.top}px`,
        right: 'auto',
        bottom: 'auto'
    }), [launcherPosition.left, launcherPosition.top]);
    const panelStyle = useMemo(() => {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const closedPanelWidth = Math.min(AI_PANEL_WIDTH_CLOSED, viewportWidth - 48);
        const panelHeight = Math.min(AI_PANEL_MAX_HEIGHT, viewportHeight * 0.72);
        const panelRightEdge = clamp(launcherPosition.left + AI_LAUNCHER_SIZE, AI_PANEL_MIN_MARGIN + closedPanelWidth, viewportWidth - AI_PANEL_MIN_MARGIN);
        return {
            left: 'auto',
            top: `${clamp(launcherPosition.top - panelHeight - AI_PANEL_GAP, AI_PANEL_MIN_MARGIN, viewportHeight - panelHeight - AI_PANEL_MIN_MARGIN)}px`,
            right: `${viewportWidth - panelRightEdge}px`,
            bottom: 'auto'
        };
    }, [launcherPosition.left, launcherPosition.top]);
    return (_jsxs(_Fragment, { children: [_jsx(AssistantLauncher, { open: open, loading: loading || sending, hasUnread: hasUnread, positionStyle: launcherStyle, position: launcherPosition, onPositionChange: handlePositionChange, onToggle: handleToggle }), open && (_jsx(AssistantPanelContent, { style: panelStyle, onClose: () => setOpen(false), launcherPosition: launcherPosition, onLauncherPositionChange: handlePositionChange }))] }));
}
