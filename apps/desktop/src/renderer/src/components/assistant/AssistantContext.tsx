import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AppRoute,
  type AiArtifactRecord,
  type AiAssistantArtifactDecisionResponse,
  type AiAssistantSessionGetResponse,
  type AiAssistantSessionListResponse,
  type AiAssistantTurnResponse,
  type AiAssistantUiAction,
  type AiMessageRecord,
  type AiSessionRecord,
  type AiViewContext,
  type AppWorkingStatePatchAppliedEvent
} from '@kb-vault/shared-types';

const OPTIMISTIC_MESSAGE_PREFIX = 'optimistic:';

function normalizeMessages(messages: AiMessageRecord[]): AiMessageRecord[] {
  const seen = new Set<string>();
  const deduped: AiMessageRecord[] = [];
  for (const message of messages) {
    const key = message.id || `${message.role}:${message.createdAtUtc}:${message.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(message);
  }
  return deduped;
}

type RouteRegistration = {
  key: string;
  context: AiViewContext;
  applyUiActions?: (actions: AiAssistantUiAction[]) => void;
  applyWorkingStatePatch?: (patch: Record<string, unknown>, event: AppWorkingStatePatchAppliedEvent) => void;
};

type AssistantContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  hasUnread: boolean;
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
  routeContext: AiViewContext | null;
  session: AiSessionRecord | null;
  sessions: AiSessionRecord[];
  messages: AiMessageRecord[];
  artifact: AiArtifactRecord | null;
  loading: boolean;
  sending: boolean;
  error: string | null;
  sendMessage: (message: string) => Promise<void>;
  resetSession: () => Promise<void>;
  createSession: () => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  applyArtifact: () => Promise<void>;
  rejectArtifact: () => Promise<void>;
  registerView: (registration: RouteRegistration) => () => void;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

function sessionSortValue(session: AiSessionRecord): number {
  return new Date(session.lastMessageAtUtc ?? session.createdAtUtc).getTime();
}

function sortSessionsChronologically(sessions: AiSessionRecord[]): AiSessionRecord[] {
  return [...sessions].sort((left, right) => {
    const delta = sessionSortValue(right) - sessionSortValue(left);
    if (delta !== 0) return delta;
    return new Date(right.createdAtUtc).getTime() - new Date(left.createdAtUtc).getTime();
  });
}

const ROUTE_LABELS: Record<AppRoute, string> = {
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

export function AiAssistantProvider({
  activeRoute,
  workspaceId,
  onOpenProposalReview,
  children
}: {
  activeRoute: AppRoute;
  workspaceId?: string;
  onOpenProposalReview?: (proposalId: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [lastSeenAssistantMessageId, setLastSeenAssistantMessageId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [registration, setRegistration] = useState<RouteRegistration | null>(null);
  const [session, setSession] = useState<AiSessionRecord | null>(null);
  const [sessions, setSessions] = useState<AiSessionRecord[]>([]);
  const [messages, setMessages] = useState<AiMessageRecord[]>([]);
  const [artifact, setArtifact] = useState<AiArtifactRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applyActionsRef = useRef<RouteRegistration['applyUiActions']>();
  const applyWorkingStatePatchRef = useRef<RouteRegistration['applyWorkingStatePatch']>();
  const sessionRef = useRef<AiSessionRecord | null>(null);

  useEffect(() => {
    applyActionsRef.current = registration?.applyUiActions;
  }, [registration]);

  useEffect(() => {
    applyWorkingStatePatchRef.current = registration?.applyWorkingStatePatch;
  }, [registration]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const fallbackContext = useMemo<AiViewContext | null>(() => {
    if (!workspaceId) return null;
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

  const latestAssistantMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'assistant') {
        return messages[index].id;
      }
    }
    return null;
  }, [messages]);

  const hasUnread = useMemo(() => (
    latestAssistantMessageId !== null && latestAssistantMessageId !== lastSeenAssistantMessageId
  ), [lastSeenAssistantMessageId, latestAssistantMessageId]);

  useEffect(() => {
    if (!open || !latestAssistantMessageId) return;
    setLastSeenAssistantMessageId((current) => (
      current === latestAssistantMessageId ? current : latestAssistantMessageId
    ));
  }, [latestAssistantMessageId, open]);

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
      if (
        current.context.workspaceId !== event.workspaceId
        || current.context.route !== event.route
        || current.context.subject.type !== event.entityType
        || current.context.subject.id !== event.entityId
      ) {
        return;
      }
      applyWorkingStatePatchRef.current?.(event.appliedPatch, event);
    });
    return () => unsubscribe();
  }, [registration]);

  const runUiActions = useCallback((actions: AiAssistantUiAction[]) => {
    if (actions.length === 0) return;
    for (const action of actions) {
      if (action.type === 'show_proposal_created') {
        onOpenProposalReview?.(action.proposalId);
      }
    }
    applyActionsRef.current?.(actions);
  }, [onOpenProposalReview]);

  const upsertSession = useCallback((nextSession: AiSessionRecord | null) => {
    if (!nextSession) return;
    setSessions((current) => {
      const remaining = current.filter((sessionItem) => sessionItem.id !== nextSession.id);
      return sortSessionsChronologically([nextSession, ...remaining]);
    });
  }, []);

  const removeSession = useCallback((sessionId: string) => {
    setSessions((current) => current.filter((sessionItem) => sessionItem.id !== sessionId));
  }, []);

  const loadSessionList = useCallback(async (workspaceIdToLoad: string) => {
    const response = await window.kbv.invoke<AiAssistantSessionListResponse>('ai.assistant.session.list', {
      workspaceId: workspaceIdToLoad
    });
    if (!response.ok || !response.data) {
      throw new Error(response.error?.message ?? 'Failed to load assistant history.');
    }
    setSessions(sortSessionsChronologically(response.data.sessions ?? []));
    return response.data;
  }, []);

  const hydrateSession = useCallback(async (workspaceIdToLoad: string, sessionId?: string | null) => {
    const response = await window.kbv.invoke<AiAssistantSessionGetResponse>('ai.assistant.session.get', {
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

  const refreshWorkspaceAssistant = useCallback(async (workspaceIdToLoad: string, preferredSessionId?: string | null) => {
    const list = await loadSessionList(workspaceIdToLoad);
    const targetSessionId = preferredSessionId ?? list.activeSessionId ?? null;
    const currentSession = await hydrateSession(workspaceIdToLoad, targetSessionId);
    if (!currentSession && list.sessions.length === 0) {
      const created = await window.kbv.invoke<AiAssistantSessionGetResponse>('ai.assistant.session.create', {
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
      setLastSeenAssistantMessageId(null);
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
        setLastSeenAssistantMessageId(null);
        setSending(false);
      })
      .finally(() => setLoading(false));
  }, [refreshWorkspaceAssistant, workspaceId]);

  const createSession = useCallback(async () => {
    if (!routeContext) return;
    setLoading(true);
    setError(null);
    try {
      const response = await window.kbv.invoke<AiAssistantSessionGetResponse>('ai.assistant.session.create', {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [loadSessionList, routeContext, upsertSession]);

  const deleteSession = useCallback(async (sessionId: string) => {
    if (!routeContext) return;
    setLoading(true);
    setError(null);
    try {
      const response = await window.kbv.invoke<AiAssistantSessionGetResponse>('ai.assistant.session.delete', {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [loadSessionList, removeSession, routeContext, upsertSession]);

  const openSession = useCallback(async (sessionId: string) => {
    if (!routeContext) return;
    setLoading(true);
    setError(null);
    try {
      const response = await window.kbv.invoke<AiAssistantSessionGetResponse>('ai.assistant.session.open', {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [loadSessionList, routeContext, upsertSession]);

  const sendMessage = useCallback(async (message: string) => {
    const trimmedMessage = message.trim();
    if (!routeContext || !trimmedMessage || sending) return;

    const targetSessionId = session?.id ?? null;

    const optimisticMessage: AiMessageRecord = {
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
      const response = await window.kbv.invoke<AiAssistantTurnResponse>('ai.assistant.message.send', {
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
      const shouldHydrateCurrent =
        currentSession?.id === response.data.session.id
        || (!currentSession && !targetSessionId)
        || currentSession?.id === targetSessionId;
      if (shouldHydrateCurrent) {
        setSession(response.data.session);
        setMessages(normalizeMessages(response.data.messages ?? []));
        setArtifact(response.data.artifact ?? null);
        runUiActions(response.data.uiActions ?? []);
      }
    } catch (err) {
      setMessages((current) => current.filter((item) => item.id !== optimisticMessage.id));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [loadSessionList, routeContext, runUiActions, sending, session?.id, upsertSession]);

  const resetSession = useCallback(async () => {
    if (!routeContext || !session) return;
    setLoading(true);
    setError(null);
    try {
      const response = await window.kbv.invoke<AiAssistantSessionGetResponse>('ai.assistant.session.reset', {
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
      } else {
        await loadSessionList(routeContext.workspaceId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [loadSessionList, removeSession, routeContext, session, upsertSession]);

  const handleArtifactDecision = useCallback(async (method: 'ai.assistant.artifact.apply' | 'ai.assistant.artifact.reject') => {
    if (!routeContext || !session || !artifact) return;
    setLoading(true);
    setError(null);
    try {
      const response = await window.kbv.invoke<AiAssistantArtifactDecisionResponse>(method, {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [artifact, loadSessionList, routeContext, runUiActions, session, upsertSession]);

  const registerView = useCallback((next: RouteRegistration) => {
    setRegistration(next);
    return () => {
      setRegistration((current) => (current?.key === next.key ? null : current));
    };
  }, []);

  const value = useMemo<AssistantContextValue>(() => ({
    open,
    setOpen,
    hasUnread,
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
    hasUnread,
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

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAiAssistant() {
  const value = useContext(AssistantContext);
  if (!value) {
    throw new Error('useAiAssistant must be used within AiAssistantProvider');
  }
  return value;
}

export function useRegisterAiAssistantView(config: {
  enabled: boolean;
  context: AiViewContext;
  applyUiActions?: (actions: AiAssistantUiAction[]) => void;
  applyWorkingStatePatch?: (patch: Record<string, unknown>, event: AppWorkingStatePatchAppliedEvent) => void;
}) {
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
    if (!config.enabled) return;
    const applyUiActions = (actions: AiAssistantUiAction[]) => applyRef.current?.(actions);
    const applyWorkingStatePatch = (patch: Record<string, unknown>, event: AppWorkingStatePatchAppliedEvent) =>
      applyWorkingStatePatchRef.current?.(patch, event);
    return registerView({
      key: registrationKey,
      context: config.context,
      applyUiActions,
      applyWorkingStatePatch
    });
  }, [config.enabled, contextSignature, registerView, registrationKey]);
}
