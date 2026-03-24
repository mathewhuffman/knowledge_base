import { jsx as _jsx } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppRoute } from '@kb-vault/shared-types';
const OPTIMISTIC_MESSAGE_PREFIX = 'optimistic:';
function normalizeMessages(messages) {
    const seen = new Set();
    const deduped = [];
    for (const message of messages) {
        const key = message.id || `${message.role}:${message.createdAtUtc}:${message.content}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        deduped.push(message);
    }
    return deduped;
}
const AssistantContext = createContext(null);
function sessionSortValue(session) {
    return new Date(session.lastMessageAtUtc ?? session.createdAtUtc).getTime();
}
function sortSessionsChronologically(sessions) {
    return [...sessions].sort((left, right) => {
        const delta = sessionSortValue(right) - sessionSortValue(left);
        if (delta !== 0)
            return delta;
        return new Date(right.createdAtUtc).getTime() - new Date(left.createdAtUtc).getTime();
    });
}
const ROUTE_LABELS = {
    [AppRoute.WORKSPACE_SWITCHER]: 'Workspace Switcher',
    [AppRoute.KB_VAULT_HOME]: 'KB Vault Home',
    [AppRoute.ARTICLE_EXPLORER]: 'Article Explorer',
    [AppRoute.PBI_BATCHES]: 'PBI Batches',
    [AppRoute.PROPOSAL_REVIEW]: 'Proposal Review',
    [AppRoute.DRAFTS]: 'Drafts',
    [AppRoute.PUBLISH_QUEUE]: 'Publish Queue',
    [AppRoute.TEMPLATES_AND_PROMPTS]: 'Templates & Prompts',
    [AppRoute.SETTINGS]: 'Settings'
};
export function AiAssistantProvider({ activeRoute, workspaceId, onOpenProposalReview, children }) {
    const [open, setOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [registration, setRegistration] = useState(null);
    const [session, setSession] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [messages, setMessages] = useState([]);
    const [artifact, setArtifact] = useState(null);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState(null);
    const applyActionsRef = useRef();
    const applyWorkingStatePatchRef = useRef();
    const sessionRef = useRef(null);
    useEffect(() => {
        applyActionsRef.current = registration?.applyUiActions;
    }, [registration]);
    useEffect(() => {
        applyWorkingStatePatchRef.current = registration?.applyWorkingStatePatch;
    }, [registration]);
    useEffect(() => {
        sessionRef.current = session;
    }, [session]);
    const fallbackContext = useMemo(() => {
        if (!workspaceId)
            return null;
        return {
            workspaceId,
            route: activeRoute,
            routeLabel: ROUTE_LABELS[activeRoute],
            subject: {
                type: 'workspace',
                id: workspaceId
            },
            workingState: {
                kind: 'none',
                payload: null
            },
            capabilities: {
                canChat: true,
                canCreateProposal: false,
                canPatchProposal: false,
                canPatchDraft: false,
                canPatchTemplate: false,
                canUseUnsavedWorkingState: false
            },
            backingData: {
                route: activeRoute
            }
        };
    }, [activeRoute, workspaceId]);
    const routeContext = registration?.context ?? fallbackContext;
    useEffect(() => {
        if (!window.kbv?.invoke) {
            return;
        }
        if (!registration?.context.workspaceId || !registration.context.subject?.id || !registration.context.workingState) {
            return;
        }
        const entityType = registration.context.subject.type;
        if (entityType !== 'template_pack' && entityType !== 'proposal' && entityType !== 'draft_branch') {
            return;
        }
        void window.kbv.invoke('app.workingState.register', {
            workspaceId: registration.context.workspaceId,
            route: registration.context.route,
            entityType,
            entityId: registration.context.subject.id,
            versionToken: registration.context.workingState.versionToken,
            currentValues: registration.context.workingState.payload
        });
        return () => {
            void window.kbv.invoke('app.workingState.unregister', {
                workspaceId: registration.context.workspaceId,
                route: registration.context.route,
                entityType,
                entityId: registration.context.subject?.id
            });
        };
    }, [registration]);
    useEffect(() => {
        if (!window.kbv?.emitAppWorkingStateEvents) {
            return;
        }
        const unsubscribe = window.kbv.emitAppWorkingStateEvents((event) => {
            const current = registration;
            if (!current?.context.subject?.id) {
                return;
            }
            if (current.context.workspaceId !== event.workspaceId
                || current.context.route !== event.route
                || current.context.subject.type !== event.entityType
                || current.context.subject.id !== event.entityId) {
                return;
            }
            applyWorkingStatePatchRef.current?.(event.appliedPatch, event);
        });
        return () => unsubscribe();
    }, [registration]);
    const runUiActions = useCallback((actions) => {
        if (actions.length === 0)
            return;
        for (const action of actions) {
            if (action.type === 'show_proposal_created') {
                onOpenProposalReview?.(action.proposalId);
            }
        }
        applyActionsRef.current?.(actions);
    }, [onOpenProposalReview]);
    const upsertSession = useCallback((nextSession) => {
        if (!nextSession)
            return;
        setSessions((current) => {
            const remaining = current.filter((sessionItem) => sessionItem.id !== nextSession.id);
            return sortSessionsChronologically([nextSession, ...remaining]);
        });
    }, []);
    const removeSession = useCallback((sessionId) => {
        setSessions((current) => current.filter((sessionItem) => sessionItem.id !== sessionId));
    }, []);
    const loadSessionList = useCallback(async (workspaceIdToLoad) => {
        const response = await window.kbv.invoke('ai.assistant.session.list', {
            workspaceId: workspaceIdToLoad
        });
        if (!response.ok || !response.data) {
            throw new Error(response.error?.message ?? 'Failed to load assistant history.');
        }
        setSessions(sortSessionsChronologically(response.data.sessions ?? []));
        return response.data;
    }, []);
    const hydrateSession = useCallback(async (workspaceIdToLoad, sessionId) => {
        const response = await window.kbv.invoke('ai.assistant.session.get', {
            workspaceId: workspaceIdToLoad,
            sessionId: sessionId ?? undefined
        });
        if (!response.ok) {
            throw new Error(response.error?.message ?? 'Failed to load assistant session.');
        }
        setSession(response.data?.session ?? null);
        upsertSession(response.data?.session ?? null);
        setMessages(normalizeMessages(response.data?.messages ?? []));
        setArtifact(response.data?.artifact ?? null);
        return response.data?.session ?? null;
    }, [upsertSession]);
    const refreshWorkspaceAssistant = useCallback(async (workspaceIdToLoad, preferredSessionId) => {
        const list = await loadSessionList(workspaceIdToLoad);
        const targetSessionId = preferredSessionId ?? list.activeSessionId ?? null;
        const currentSession = await hydrateSession(workspaceIdToLoad, targetSessionId);
        if (!currentSession && list.sessions.length === 0) {
            const created = await window.kbv.invoke('ai.assistant.session.create', {
                workspaceId: workspaceIdToLoad
            });
            if (!created.ok || !created.data) {
                throw new Error(created.error?.message ?? 'Failed to create assistant session.');
            }
            setSession(created.data.session ?? null);
            upsertSession(created.data.session ?? null);
            setMessages(created.data.messages ?? []);
            setArtifact(created.data.artifact ?? null);
        }
    }, [hydrateSession, loadSessionList, upsertSession]);
    useEffect(() => {
        if (!workspaceId) {
            setSession(null);
            setSessions([]);
            setMessages([]);
            setArtifact(null);
            setSending(false);
            setHistoryOpen(false);
            return;
        }
        setLoading(true);
        setError(null);
        void refreshWorkspaceAssistant(workspaceId)
            .catch((err) => {
            setError(err instanceof Error ? err.message : String(err));
            setSession(null);
            setSessions([]);
            setMessages([]);
            setArtifact(null);
            setSending(false);
        })
            .finally(() => setLoading(false));
    }, [refreshWorkspaceAssistant, workspaceId]);
    const createSession = useCallback(async () => {
        if (!routeContext)
            return;
        setLoading(true);
        setError(null);
        try {
            const response = await window.kbv.invoke('ai.assistant.session.create', {
                workspaceId: routeContext.workspaceId
            });
            if (!response.ok || !response.data) {
                setError(response.error?.message ?? 'Failed to create assistant session.');
                return;
            }
            setSession(response.data.session ?? null);
            upsertSession(response.data.session ?? null);
            setMessages(normalizeMessages(response.data.messages ?? []));
            setArtifact(response.data.artifact ?? null);
            await loadSessionList(routeContext.workspaceId);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setLoading(false);
        }
    }, [loadSessionList, routeContext, upsertSession]);
    const deleteSession = useCallback(async (sessionId) => {
        if (!routeContext)
            return;
        setLoading(true);
        setError(null);
        try {
            const response = await window.kbv.invoke('ai.assistant.session.delete', {
                workspaceId: routeContext.workspaceId,
                sessionId
            });
            if (!response.ok) {
                setError(response.error?.message ?? 'Failed to delete assistant session.');
                return;
            }
            removeSession(sessionId);
            setSession(response.data?.session ?? null);
            if (response.data?.session) {
                upsertSession(response.data.session);
            }
            setMessages(normalizeMessages(response.data?.messages ?? []));
            setArtifact(response.data?.artifact ?? null);
            await loadSessionList(routeContext.workspaceId);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setLoading(false);
        }
    }, [loadSessionList, removeSession, routeContext, upsertSession]);
    const openSession = useCallback(async (sessionId) => {
        if (!routeContext)
            return;
        setLoading(true);
        setError(null);
        try {
            const response = await window.kbv.invoke('ai.assistant.session.open', {
                workspaceId: routeContext.workspaceId,
                sessionId
            });
            if (!response.ok || !response.data) {
                setError(response.error?.message ?? 'Failed to open assistant session.');
                return;
            }
            setSession(response.data.session ?? null);
            upsertSession(response.data.session ?? null);
            setMessages(normalizeMessages(response.data.messages ?? []));
            setArtifact(response.data.artifact ?? null);
            await loadSessionList(routeContext.workspaceId);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setLoading(false);
        }
    }, [loadSessionList, routeContext, upsertSession]);
    const sendMessage = useCallback(async (message) => {
        const trimmedMessage = message.trim();
        if (!routeContext || !trimmedMessage || sending)
            return;
        const targetSessionId = session?.id ?? null;
        const optimisticMessage = {
            id: `${OPTIMISTIC_MESSAGE_PREFIX}${Date.now()}`,
            sessionId: targetSessionId ?? 'pending-session',
            workspaceId: routeContext.workspaceId,
            role: 'user',
            messageKind: 'chat',
            content: trimmedMessage,
            createdAtUtc: new Date().toISOString()
        };
        setMessages((current) => [...current, optimisticMessage]);
        setSending(true);
        setError(null);
        try {
            const response = await window.kbv.invoke('ai.assistant.message.send', {
                workspaceId: routeContext.workspaceId,
                sessionId: targetSessionId ?? undefined,
                context: routeContext,
                message: trimmedMessage
            });
            if (!response.ok || !response.data) {
                setMessages((current) => current.filter((item) => item.id !== optimisticMessage.id));
                setError(response.error?.message ?? 'Failed to send assistant message.');
                return;
            }
            upsertSession(response.data.session);
            await loadSessionList(routeContext.workspaceId);
            const currentSession = sessionRef.current;
            const shouldHydrateCurrent = currentSession?.id === response.data.session.id
                || (!currentSession && !targetSessionId)
                || currentSession?.id === targetSessionId;
            if (shouldHydrateCurrent) {
                setSession(response.data.session);
                setMessages(normalizeMessages(response.data.messages ?? []));
                setArtifact(response.data.artifact ?? null);
                runUiActions(response.data.uiActions ?? []);
            }
        }
        catch (err) {
            setMessages((current) => current.filter((item) => item.id !== optimisticMessage.id));
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setSending(false);
        }
    }, [loadSessionList, routeContext, runUiActions, sending, session?.id, upsertSession]);
    const resetSession = useCallback(async () => {
        if (!routeContext || !session)
            return;
        setLoading(true);
        setError(null);
        try {
            const response = await window.kbv.invoke('ai.assistant.session.reset', {
                workspaceId: routeContext.workspaceId,
                sessionId: session.id
            });
            if (!response.ok || !response.data) {
                setError(response.error?.message ?? 'Failed to reset assistant session.');
                return;
            }
            setSession(response.data.session ?? null);
            upsertSession(response.data.session ?? null);
            setMessages(normalizeMessages(response.data.messages ?? []));
            setArtifact(response.data.artifact ?? null);
            if (response.data.messages.length === 0 && response.data.session?.id) {
                removeSession(response.data.session.id);
            }
            else {
                await loadSessionList(routeContext.workspaceId);
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setLoading(false);
        }
    }, [loadSessionList, removeSession, routeContext, session, upsertSession]);
    const handleArtifactDecision = useCallback(async (method) => {
        if (!routeContext || !session || !artifact)
            return;
        setLoading(true);
        setError(null);
        try {
            const response = await window.kbv.invoke(method, {
                workspaceId: routeContext.workspaceId,
                sessionId: session.id,
                artifactId: artifact.id
            });
            if (!response.ok || !response.data) {
                setError(response.error?.message ?? 'Failed to update assistant artifact.');
                return;
            }
            setSession(response.data.session ?? null);
            upsertSession(response.data.session ?? null);
            setMessages(normalizeMessages(response.data.messages ?? []));
            setArtifact(response.data.artifact ?? null);
            runUiActions(response.data.uiActions ?? []);
            await loadSessionList(routeContext.workspaceId);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setLoading(false);
        }
    }, [artifact, loadSessionList, routeContext, runUiActions, session, upsertSession]);
    const registerView = useCallback((next) => {
        setRegistration(next);
        return () => {
            setRegistration((current) => (current?.key === next.key ? null : current));
        };
    }, []);
    const value = useMemo(() => ({
        open,
        setOpen,
        historyOpen,
        setHistoryOpen,
        routeContext,
        session,
        sessions,
        messages,
        artifact,
        loading,
        sending,
        error,
        sendMessage,
        resetSession,
        createSession,
        openSession,
        deleteSession,
        applyArtifact: () => handleArtifactDecision('ai.assistant.artifact.apply'),
        rejectArtifact: () => handleArtifactDecision('ai.assistant.artifact.reject'),
        registerView
    }), [
        artifact,
        createSession,
        deleteSession,
        error,
        handleArtifactDecision,
        historyOpen,
        loading,
        sending,
        messages,
        open,
        openSession,
        registerView,
        resetSession,
        routeContext,
        sendMessage,
        session,
        sessions
    ]);
    return _jsx(AssistantContext.Provider, { value: value, children: children });
}
export function useAiAssistant() {
    const value = useContext(AssistantContext);
    if (!value) {
        throw new Error('useAiAssistant must be used within AiAssistantProvider');
    }
    return value;
}
export function useRegisterAiAssistantView(config) {
    const { registerView } = useAiAssistant();
    const applyRef = useRef(config.applyUiActions);
    const applyWorkingStatePatchRef = useRef(config.applyWorkingStatePatch);
    useEffect(() => {
        applyRef.current = config.applyUiActions;
    }, [config.applyUiActions]);
    useEffect(() => {
        applyWorkingStatePatchRef.current = config.applyWorkingStatePatch;
    }, [config.applyWorkingStatePatch]);
    const registrationKey = useMemo(() => {
        const subject = config.context.subject;
        return [
            config.context.workspaceId,
            config.context.route,
            subject?.type ?? 'none',
            subject?.id ?? 'none'
        ].join(':');
    }, [config.context]);
    const contextSignature = JSON.stringify(config.context);
    useEffect(() => {
        if (!config.enabled)
            return;
        const applyUiActions = (actions) => applyRef.current?.(actions);
        const applyWorkingStatePatch = (patch, event) => applyWorkingStatePatchRef.current?.(patch, event);
        return registerView({
            key: registrationKey,
            context: config.context,
            applyUiActions,
            applyWorkingStatePatch
        });
    }, [config.enabled, contextSignature, registerView, registrationKey]);
}
