import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AI_ASSISTANT_DETACHED_PANEL_WINDOW_SIZE, AI_ASSISTANT_LAUNCHER_BUTTON_SIZE } from '@kb-vault/shared-types';
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
function useDetachedWindowDrag() {
    const frameRef = useRef(null);
    const pendingPositionRef = useRef(null);
    useEffect(() => () => {
        if (frameRef.current != null) {
            window.cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        }
    }, []);
    return useCallback((position) => {
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
function finishDetachedWindowDrag() {
    window.kbv?.finishAssistantWindowDrag?.();
}
function resizeDetachedWindow(payload) {
    window.kbv?.resizeAssistantWindow?.({
        ...payload,
        anchor: 'bottom_right'
    });
}
function AssistantDockAction({ mode, onAction }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const handleClick = useCallback(() => {
        if (busy) {
            return;
        }
        setBusy(true);
        setError(null);
        void onAction()
            .catch((detachError) => {
            setError(detachError instanceof Error ? detachError.message : String(detachError));
        })
            .finally(() => {
            setBusy(false);
        });
    }, [busy, onAction]);
    const isPopOut = mode === 'out';
    const title = isPopOut ? 'Pop out the assistant' : 'Pop the assistant back into the app';
    const icon = isPopOut ? _jsx(IconArrowUpRight, { size: 12 }) : _jsx(IconPanelRight, { size: 12 });
    return (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: [
                    'ai-header__detach',
                    busy && 'ai-header__detach--busy'
                ].filter(Boolean).join(' '), onClick: handleClick, title: title, "aria-label": title, children: icon }), error && (_jsx("div", { className: "ai-header__detach-error", role: "alert", children: error }))] }));
}
export function AssistantPanelContent({ hostMode = 'embedded', style, dragHandle, onWindowDrag, onWindowDragEnd, onClose }) {
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
            hostMode === 'embedded' && 'ai-panel--embedded',
            hostMode === 'detached' && 'ai-panel--detached',
            historyOpen && 'ai-panel--history-open'
        ].filter(Boolean).join(' '), style: style, role: "complementary", "aria-label": "AI Assistant", children: [_jsx("div", { className: `ai-panel__history-sidebar${historyOpen ? ' open' : ''}`, children: _jsx("div", { className: "ai-panel__history-sidebar-inner", children: _jsx(AssistantHistoryList, { sessions: sessions, activeSessionId: session?.id, loading: loading, onOpen: (sessionId) => void openSession(sessionId), onDelete: (sessionId) => void deleteSession(sessionId), onNewChat: () => void createSession(), onClose: () => setHistoryOpen(false) }) }) }), _jsxs("div", { className: "ai-panel__chat", children: [_jsx(AssistantHeader, { context: routeContext, session: session, artifact: artifact, loading: loading, historyOpen: historyOpen, sessionCount: sessions.length, dragHandle: dragHandle, onWindowDrag: onWindowDrag, onWindowDragEnd: onWindowDragEnd, onCreateSession: () => void createSession(), onToggleHistory: () => setHistoryOpen(!historyOpen), onClose: () => onClose?.() }), _jsxs("div", { className: "ai-panel__body", children: [showArtifact && artifact && (_jsx("div", { className: "ai-panel__artifact-slot", children: _jsx(AssistantArtifactCard, { artifact: artifact, stale: isStale, loading: loading, onDismiss: () => dismissArtifactCard(artifact.id), onApply: () => void applyArtifact(), onReject: () => void rejectArtifact(), onRerun: () => void rerunLastMessage() }) })), showTranscript ? (_jsx(AssistantTranscript, { messages: transcriptMessages, pendingTurn: pendingTurn, loading: sending })) : (!(loading || pendingTurn) && _jsx(AssistantEmptyState, { context: routeContext })), loading && !showTranscript && !pendingTurn && (_jsxs("div", { className: "ai-panel__loading", role: "status", "aria-label": "Loading", children: [_jsxs("div", { className: "ai-typing ai-typing--large", children: [_jsx("span", {}), _jsx("span", {}), _jsx("span", {})] }), _jsx("span", { children: "Starting assistant..." })] }))] }), error && (_jsxs("div", { className: "ai-panel__error", role: "alert", children: [_jsx(IconAlertCircle, { size: 14 }), _jsx("span", { children: error }), _jsx("button", { type: "button", className: "ai-panel__error-retry", onClick: () => void resetSession(), title: "Reset and retry", children: _jsx(IconRefreshCw, { size: 12 }) })] })), _jsx(AssistantComposer, { context: routeContext, loading: sending, onSend: sendMessage })] })] }));
}
export function GlobalAssistantHost() {
    const { presentation, open, setOpen, hasUnread, loading, sending, historyOpen, embeddedLauncherPosition, setEmbeddedLauncherPosition, detachPanel } = useAiAssistant();
    const launcherPosition = useMemo(() => clampLauncherPosition(embeddedLauncherPosition ?? getDefaultLauncherPosition()), [embeddedLauncherPosition]);
    useEffect(() => {
        if (embeddedLauncherPosition?.left !== launcherPosition.left
            || embeddedLauncherPosition?.top !== launcherPosition.top) {
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
    const handlePositionChange = useCallback((position) => {
        void setEmbeddedLauncherPosition(clampLauncherPosition(position));
    }, [setEmbeddedLauncherPosition]);
    const launcherStyle = useMemo(() => ({
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
        const panelRightEdge = clamp(launcherPosition.left + AI_LAUNCHER_SIZE, AI_PANEL_MIN_MARGIN + panelWidth, viewportWidth - AI_PANEL_MIN_MARGIN);
        const top = clamp(launcherPosition.top - panelHeight - AI_PANEL_GAP, AI_PANEL_MIN_MARGIN, viewportHeight - panelHeight - AI_PANEL_MIN_MARGIN);
        return {
            viewportWidth,
            top,
            panelRightEdge
        };
    }, [historyOpen, launcherPosition.left, launcherPosition.top]);
    const panelStyle = useMemo(() => {
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
    return (_jsxs(_Fragment, { children: [_jsx(AssistantLauncher, { open: open, loading: loading || sending, hasUnread: hasUnread, positionStyle: launcherStyle, position: launcherPosition, onPositionChange: handlePositionChange, onToggle: handleToggle }), open && (_jsx(AssistantPanelContent, { hostMode: "embedded", style: panelStyle, dragHandle: (_jsx(AssistantDockAction, { mode: "out", onAction: handlePopOut })), onClose: () => setOpen(false) }))] }));
}
export function DetachedAssistantWindowHost() {
    const { presentation, open, setOpen, hasUnread, loading, sending, historyOpen, reattachEmbeddedOpen } = useAiAssistant();
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
    return (_jsxs("div", { className: "assistant-window", children: [_jsx("div", { className: [
                    'assistant-window__panel-shell',
                    open ? 'assistant-window__panel-shell--visible' : 'assistant-window__panel-shell--hidden'
                ].join(' '), "aria-hidden": !open, children: _jsx(AssistantPanelContent, { hostMode: "detached", dragHandle: (_jsx(AssistantDockAction, { mode: "in", onAction: handlePopIn })), onWindowDrag: moveDetachedWindow, onWindowDragEnd: finishDetachedWindowDrag, onClose: () => setOpen(false) }) }), _jsx("div", { className: "assistant-window__launcher-slot", children: _jsx(AssistantLauncher, { open: open, loading: loading || sending, hasUnread: hasUnread, onWindowDrag: moveDetachedWindow, onWindowDragEnd: finishDetachedWindowDrag, onToggle: () => setOpen(!open) }) })] }));
}
