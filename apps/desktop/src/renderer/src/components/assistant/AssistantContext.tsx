import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AppRoute,
  type AiArtifactRecord,
  type AiAssistantArtifactDecisionResponse,
  type AiAssistantContextGetResponse,
  type AiAssistantPresentationGetResponse,
  type AiAssistantPresentationState,
  type AiAssistantPresentationTransitionRequest,
  type AiAssistantRendererWindowRole,
  type AiAssistantSessionGetResponse,
  type AiAssistantSessionListResponse,
  type AiAssistantStreamEvent,
  type AiAssistantTurnResponse,
  type AiAssistantUiAction,
  type AiMessageRecord,
  type AiSessionRecord,
  type AiViewContext,
  type AppWorkingStatePatchAppliedEvent
} from '@kb-vault/shared-types';
import { extractStreamedAssistantEnvelope, looksLikeStructuredAssistantStream } from './assistant-streaming';
import { unwrapAssistantDisplayText } from './assistant-streaming';

const OPTIMISTIC_MESSAGE_PREFIX = 'optimistic:';
const ASSISTANT_CONSOLE_PREFIX = '[assistant.chat]';

function logAssistantConsole(label: string, payload: unknown, level: 'log' | 'warn' = 'log') {
  if (level === 'warn') {
    console.warn(`${ASSISTANT_CONSOLE_PREFIX} ${label}`, payload);
    return;
  }
  console.log(`${ASSISTANT_CONSOLE_PREFIX} ${label}`, payload);
}

function normalizeMessages(messages: AiMessageRecord[]): AiMessageRecord[] {
  const seen = new Set<string>();
  const deduped: AiMessageRecord[] = [];
  for (const message of messages) {
    const normalizedMessage = message.role === 'assistant'
      ? {
          ...message,
          content: unwrapAssistantDisplayText(message.content) ?? message.content
        }
      : message;
    const key = normalizedMessage.id || `${normalizedMessage.role}:${normalizedMessage.createdAtUtc}:${normalizedMessage.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalizedMessage);
  }
  return deduped;
}

interface PendingAssistantToolEvent {
  toolCallId?: string;
  toolName?: string;
  toolStatus?: string;
  resourceLabel?: string;
}

function isFilteredAssistantToolName(value: string | undefined): boolean {
  void value;
  return false;
}

export interface PendingAssistantTurn {
  turnId: string;
  sessionId: string;
  startedAtUtc: string;
  rawResponseText: string;
  responseText: string;
  thoughtText: string;
  toolEvents: PendingAssistantToolEvent[];
  hasRenderableFinalResponse: boolean;
  error?: string;
}

function findSharedPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function findChunkOverlap(left: string, right: string): number {
  const maxOverlap = Math.min(left.length, right.length);
  for (let overlap = maxOverlap; overlap >= 12; overlap -= 1) {
    if (left.slice(-overlap) === right.slice(0, overlap)) {
      return overlap;
    }
  }
  return 0;
}

function appendStreamingText(current: string, chunk: string): string {
  if (!chunk && chunk !== '') {
    return current;
  }
  if (!current) {
    return chunk;
  }
  if (current === chunk || current.endsWith(chunk)) {
    return current;
  }
  if (chunk.endsWith(current) || chunk.startsWith(current)) {
    return chunk;
  }
  const sharedPrefix = findSharedPrefixLength(current, chunk);
  if (
    sharedPrefix >= 12
    && sharedPrefix >= Math.floor(Math.min(current.length, chunk.length) * 0.6)
  ) {
    return chunk.length >= current.length ? chunk : current;
  }
  const overlap = findChunkOverlap(current, chunk);
  return overlap > 0 ? `${current}${chunk.slice(overlap)}` : `${current}${chunk}`;
}

function upsertPendingToolEvent(
  current: PendingAssistantToolEvent[],
  event: PendingAssistantToolEvent
): PendingAssistantToolEvent[] {
  if (!event.toolCallId) {
    return [...current, event];
  }
  const next = [...current];
  const index = next.findIndex((item) => item.toolCallId === event.toolCallId);
  if (index === -1) {
    next.push(event);
    return next;
  }
  next[index] = { ...next[index], ...event };
  return next;
}

type RouteRegistration = {
  key: string;
  context: AiViewContext;
  applyUiActions?: (actions: AiAssistantUiAction[]) => void;
  applyWorkingStatePatch?: (patch: Record<string, unknown>, event: AppWorkingStatePatchAppliedEvent) => void;
};

type PublishedContextState = AiAssistantContextGetResponse;

type AssistantContextValue = {
  windowRole: AiAssistantRendererWindowRole;
  presentation: AiAssistantPresentationState;
  open: boolean;
  setOpen: (open: boolean) => void;
  hasUnread: boolean;
  historyOpen: boolean;
  setHistoryOpen: (open: boolean) => void;
  embeddedLauncherPosition?: { left: number; top: number };
  setEmbeddedLauncherPosition: (position: { left: number; top: number }) => Promise<void>;
  detachLauncher: (anchorPoint: { x: number; y: number }) => Promise<void>;
  detachPanel: (anchorPoint: { x: number; y: number }) => Promise<void>;
  reattachEmbeddedOpen: () => Promise<void>;
  reattachEmbeddedClosed: () => Promise<void>;
  routeContext: AiViewContext | null;
  session: AiSessionRecord | null;
  sessions: AiSessionRecord[];
  messages: AiMessageRecord[];
  artifact: AiArtifactRecord | null;
  pendingTurn: PendingAssistantTurn | null;
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
  rerunLastMessage: () => Promise<void>;
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
  [AppRoute.PBI_LIBRARY]: 'PBI Library',
  [AppRoute.PROPOSAL_REVIEW]: 'Proposal Review',
  [AppRoute.DRAFTS]: 'Drafts',
  [AppRoute.PUBLISH_QUEUE]: 'Publish Queue',
  [AppRoute.TEMPLATES_AND_PROMPTS]: 'Templates & Prompts',
  [AppRoute.SETTINGS]: 'Settings'
};

const DEFAULT_PRESENTATION_STATE: AiAssistantPresentationState = {
  dockMode: 'embedded',
  surfaceMode: 'closed',
  state: 'embedded_closed',
  hasUnread: false,
  updatedAtUtc: new Date().toISOString(),
  lastDetachedSurfaceMode: 'launcher'
};

export function AiAssistantProvider({
  windowRole,
  activeRoute,
  workspaceId,
  children
}: {
  windowRole: AiAssistantRendererWindowRole;
  activeRoute?: AppRoute;
  workspaceId?: string;
  children: ReactNode;
}) {
  const [presentation, setPresentation] = useState<AiAssistantPresentationState>(DEFAULT_PRESENTATION_STATE);
  const [publishedContext, setPublishedContext] = useState<PublishedContextState>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [registration, setRegistration] = useState<RouteRegistration | null>(null);
  const [session, setSession] = useState<AiSessionRecord | null>(null);
  const [sessions, setSessions] = useState<AiSessionRecord[]>([]);
  const [messages, setMessages] = useState<AiMessageRecord[]>([]);
  const [artifact, setArtifact] = useState<AiArtifactRecord | null>(null);
  const [pendingTurn, setPendingTurn] = useState<PendingAssistantTurn | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applyActionsRef = useRef<RouteRegistration['applyUiActions']>();
  const applyWorkingStatePatchRef = useRef<RouteRegistration['applyWorkingStatePatch']>();
  const sessionRef = useRef<AiSessionRecord | null>(null);
  const pendingTurnRef = useRef<PendingAssistantTurn | null>(null);

  useEffect(() => {
    applyActionsRef.current = registration?.applyUiActions;
  }, [registration]);

  useEffect(() => {
    applyWorkingStatePatchRef.current = registration?.applyWorkingStatePatch;
  }, [registration]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    pendingTurnRef.current = pendingTurn;
  }, [pendingTurn]);

  const fallbackContext = useMemo<AiViewContext | null>(() => {
    if (windowRole !== 'main' || !workspaceId || !activeRoute) return null;
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
  }, [activeRoute, windowRole, workspaceId]);

  const routeContext = windowRole === 'main'
    ? (registration?.context ?? fallbackContext)
    : (publishedContext.context ?? null);

  const assistantWorkspaceId = routeContext?.workspaceId;
  const open = useMemo(() => (
    windowRole === 'main'
      ? presentation.state === 'embedded_open'
      : presentation.state === 'detached_panel'
  ), [presentation.state, windowRole]);
  const hasUnread = presentation.hasUnread;

  useEffect(() => {
    if (!window.kbv?.invoke) {
      return;
    }

    void window.kbv.invoke<AiAssistantPresentationGetResponse>('ai.assistant.presentation.get')
      .then((response) => {
        if (response.ok && response.data?.state) {
          setPresentation(response.data.state);
        }
      })
      .catch((invokeError: unknown) => {
        console.warn('[assistant.chat] failed to load presentation state', String(invokeError));
      });

    void window.kbv.invoke<AiAssistantContextGetResponse>('ai.assistant.context.current')
      .then((response) => {
        if (response.ok && response.data) {
          setPublishedContext(response.data);
        }
      })
      .catch((invokeError: unknown) => {
        console.warn('[assistant.chat] failed to load published context', String(invokeError));
      });
  }, []);

  useEffect(() => {
    if (!window.kbv?.emitAiAssistantPresentationEvents) {
      return;
    }
    return window.kbv.emitAiAssistantPresentationEvents((event) => {
      setPresentation(event.state);
    });
  }, []);

  useEffect(() => {
    if (!window.kbv?.emitAiAssistantContextEvents) {
      return;
    }
    return window.kbv.emitAiAssistantContextEvents((event) => {
      setPublishedContext(event);
    });
  }, []);

  const routeContextSignature = JSON.stringify(routeContext);

  useEffect(() => {
    if (windowRole !== 'main' || !window.kbv?.invoke) {
      return;
    }
    void window.kbv.invoke('ai.assistant.context.publish', {
      context: routeContext ?? null,
      sourceWindowRole: windowRole
    }).catch((invokeError: unknown) => {
      console.warn('[assistant.chat] failed to publish assistant context', String(invokeError));
    });
  }, [routeContextSignature, routeContext, windowRole]);

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

  useEffect(() => {
    if (!window.kbv?.emitAiAssistantEvents) {
      return;
    }
    const unsubscribe = window.kbv.emitAiAssistantEvents((event) => {
      if (!assistantWorkspaceId || event.workspaceId !== assistantWorkspaceId) {
        return;
      }

      setPendingTurn((current) => {
        if (event.kind === 'turn_started') {
          return {
            turnId: event.turnId,
            sessionId: event.sessionId,
            startedAtUtc: event.atUtc,
            rawResponseText: '',
            responseText: '',
            thoughtText: '',
            toolEvents: [],
            hasRenderableFinalResponse: false
          };
        }

        if (!current || current.turnId !== event.turnId) {
          return current;
        }

        if (event.kind === 'response_chunk' && event.text) {
          const rawResponseText = appendStreamingText(current.rawResponseText, event.text);
          const streamed = extractStreamedAssistantEnvelope(rawResponseText);
          return {
            ...current,
            rawResponseText,
            responseText: streamed.responseText,
            hasRenderableFinalResponse: streamed.hasRenderableFinalResponse,
            error: streamed.hasRenderableFinalResponse ? undefined : current.error
          };
        }

        if (event.kind === 'thought_chunk' && event.text) {
          return {
            ...current,
            thoughtText: appendStreamingText(current.thoughtText, event.text)
          };
        }

        if (event.kind === 'tool_call' || event.kind === 'tool_update') {
          if (isFilteredAssistantToolName(event.toolName)) {
            return current;
          }
          return {
            ...current,
            toolEvents: upsertPendingToolEvent(current.toolEvents, {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              toolStatus: event.toolStatus,
              resourceLabel: event.resourceLabel
            })
          };
        }

        if (event.kind === 'turn_error') {
          logAssistantConsole('turn_error', {
            workspaceId: assistantWorkspaceId,
            turnId: event.turnId,
            sessionId: current.sessionId,
            error: event.error ?? event.message ?? 'Assistant run failed.',
            rawResponseText: current.rawResponseText,
            responseText: current.responseText,
            thoughtText: current.thoughtText,
            toolEvents: current.toolEvents
          }, 'warn');
          if (
            current.hasRenderableFinalResponse
            || (
              current.responseText.trim().length > 0
              && looksLikeStructuredAssistantStream(current.rawResponseText)
            )
          ) {
            return current;
          }
          return {
            ...current,
            error: event.error ?? event.message ?? 'Assistant run failed.'
          };
        }

        if (event.kind === 'turn_finished') {
          return current;
        }

        return current;
      });
    });
    return () => unsubscribe();
  }, [assistantWorkspaceId]);

  const runUiActions = useCallback((actions: AiAssistantUiAction[]) => {
    if (actions.length === 0) return;
    for (const action of actions) {
      if (action.type === 'show_proposal_created') {
        void window.kbv.invoke('app.navigation.dispatch', {
          action: {
            type: 'open_proposal_review',
            proposalId: action.proposalId
          }
        });
      }
    }
    applyActionsRef.current?.(actions);
  }, []);

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
    if (!currentSession && list.sessions.length === 0 && windowRole === 'main') {
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
  }, [hydrateSession, loadSessionList, upsertSession, windowRole]);

  useEffect(() => {
    if (!assistantWorkspaceId) {
      setSession(null);
      setSessions([]);
      setMessages([]);
      setArtifact(null);
      setPendingTurn(null);
      setSending(false);
      setHistoryOpen(false);
      return;
    }
    setLoading(true);
    setError(null);
    void refreshWorkspaceAssistant(assistantWorkspaceId)
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setSession(null);
        setSessions([]);
        setMessages([]);
        setArtifact(null);
        setPendingTurn(null);
        setSending(false);
      })
      .finally(() => setLoading(false));
  }, [assistantWorkspaceId, refreshWorkspaceAssistant]);

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
      setPendingTurn(null);
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
      setPendingTurn(null);
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
      setPendingTurn(null);
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
    const existingAssistantMessageIds = new Set(
      messages
        .filter((messageItem) => messageItem.role === 'assistant')
        .map((messageItem) => messageItem.id)
    );

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
    setPendingTurn(null);
    setSending(true);
    setError(null);
    logAssistantConsole('user_message', {
      workspaceId: routeContext.workspaceId,
      sessionId: targetSessionId,
      route: routeContext.route,
      subject: routeContext.subject,
      message: trimmedMessage
    });
    try {
      const response = await window.kbv.invoke<AiAssistantTurnResponse>('ai.assistant.message.send', {
        workspaceId: routeContext.workspaceId,
        sessionId: targetSessionId ?? undefined,
        context: routeContext,
        message: trimmedMessage
      });
      if (!response.ok || !response.data) {
        logAssistantConsole('send_error', {
          workspaceId: routeContext.workspaceId,
          sessionId: targetSessionId,
          message: trimmedMessage,
          error: response.error?.message ?? 'Failed to send assistant message.',
          pendingTurn: pendingTurnRef.current
        }, 'warn');
        setError(response.error?.message ?? 'Failed to send assistant message.');
        return;
      }
      const normalizedReturnedMessages = normalizeMessages(response.data.messages ?? []);
      const latestPendingTurn = pendingTurnRef.current;
      if (latestPendingTurn) {
        logAssistantConsole('llm_turn_raw', {
          workspaceId: routeContext.workspaceId,
          sessionId: response.data.session.id,
          turnId: latestPendingTurn.turnId,
          rawResponseText: latestPendingTurn.rawResponseText,
          responseText: latestPendingTurn.responseText,
          thoughtText: latestPendingTurn.thoughtText,
          toolEvents: latestPendingTurn.toolEvents,
          error: latestPendingTurn.error
        });
      }
      for (const assistantMessage of normalizedReturnedMessages.filter((messageItem) => (
        messageItem.role === 'assistant' && !existingAssistantMessageIds.has(messageItem.id)
      ))) {
        logAssistantConsole('assistant_message', {
          workspaceId: routeContext.workspaceId,
          sessionId: response.data.session.id,
          messageId: assistantMessage.id,
          messageKind: assistantMessage.messageKind,
          createdAtUtc: assistantMessage.createdAtUtc,
          content: assistantMessage.content,
          metadata: assistantMessage.metadata
        });
      }
      if (response.data.artifact) {
        logAssistantConsole('assistant_artifact', {
          workspaceId: routeContext.workspaceId,
          sessionId: response.data.session.id,
          artifact: response.data.artifact
        });
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
        setMessages(normalizedReturnedMessages);
        setArtifact(response.data.artifact ?? null);
        setPendingTurn(null);
        runUiActions(response.data.uiActions ?? []);
      }
    } catch (err) {
      logAssistantConsole('send_exception', {
        workspaceId: routeContext.workspaceId,
        sessionId: targetSessionId,
        message: trimmedMessage,
        error: err instanceof Error ? err.message : String(err),
        pendingTurn: pendingTurnRef.current
      }, 'warn');
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
      setPendingTurn(null);
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
      setPendingTurn(null);
      runUiActions(response.data.uiActions ?? []);
      await loadSessionList(routeContext.workspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [artifact, loadSessionList, routeContext, runUiActions, session, upsertSession]);

  const rerunLastMessage = useCallback(async () => {
    if (!routeContext || sending) return;
    const lastUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === 'user' && message.messageKind === 'chat' && !message.id.startsWith(OPTIMISTIC_MESSAGE_PREFIX));
    if (!lastUserMessage?.content) {
      return;
    }

    if (artifact && session && artifact.status === 'pending') {
      await handleArtifactDecision('ai.assistant.artifact.reject');
    }

    await sendMessage(lastUserMessage.content);
  }, [artifact, handleArtifactDecision, messages, routeContext, sendMessage, sending, session]);

  const registerView = useCallback((next: RouteRegistration) => {
    setRegistration(next);
    return () => {
      setRegistration((current) => (current?.key === next.key ? null : current));
    };
  }, []);

  const transitionPresentation = useCallback(async (transition: AiAssistantPresentationTransitionRequest['transition']) => {
    if (!window.kbv?.invoke) {
      throw new Error('Assistant IPC bridge is unavailable.');
    }
    const response = await window.kbv.invoke<AiAssistantPresentationGetResponse>('ai.assistant.presentation.transition', {
      transition
    });
    if (!response.ok || !response.data?.state) {
      throw new Error(response.error?.message ?? 'Failed to update assistant presentation.');
    }
    setPresentation(response.data.state);
  }, []);

  const setOpen = useCallback((nextOpen: boolean) => {
    const transition = windowRole === 'main'
      ? { type: nextOpen ? 'open_embedded_panel' : 'close_embedded_panel' } as const
      : { type: nextOpen ? 'open_detached_panel' : 'collapse_detached_to_launcher' } as const;
    void transitionPresentation(transition).catch((transitionError: unknown) => {
      setError((current) => current ?? String(transitionError));
    });
  }, [transitionPresentation, windowRole]);

  const setEmbeddedLauncherPosition = useCallback(async (position: { left: number; top: number }) => {
    await transitionPresentation({
      type: 'set_embedded_launcher_position',
      position
    });
  }, [transitionPresentation]);

  const detachLauncher = useCallback(async (anchorPoint: { x: number; y: number }) => {
    await transitionPresentation({
      type: 'detach_launcher',
      anchorPoint
    });
  }, [transitionPresentation]);

  const detachPanel = useCallback(async (anchorPoint: { x: number; y: number }) => {
    await transitionPresentation({
      type: 'detach_panel',
      anchorPoint
    });
  }, [transitionPresentation]);

  const reattachEmbeddedOpen = useCallback(async () => {
    await transitionPresentation({
      type: 'reattach_embedded_open',
      reason: 'user_request'
    });
  }, [transitionPresentation]);

  const reattachEmbeddedClosed = useCallback(async () => {
    await transitionPresentation({
      type: 'reattach_embedded_closed',
      reason: 'user_request'
    });
  }, [transitionPresentation]);

  const value = useMemo<AssistantContextValue>(() => ({
    windowRole,
    presentation,
    open,
    setOpen,
    hasUnread,
    historyOpen,
    setHistoryOpen,
    embeddedLauncherPosition: presentation.embeddedLauncherPosition,
    setEmbeddedLauncherPosition,
    detachLauncher,
    detachPanel,
    reattachEmbeddedOpen,
    reattachEmbeddedClosed,
    routeContext,
    session,
    sessions,
    messages,
    artifact,
    pendingTurn,
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
    rerunLastMessage,
    registerView
  }), [
    artifact,
    createSession,
    deleteSession,
    detachLauncher,
    detachPanel,
    reattachEmbeddedOpen,
    reattachEmbeddedClosed,
    error,
    handleArtifactDecision,
    historyOpen,
    hasUnread,
    loading,
    sending,
    messages,
    open,
    openSession,
    pendingTurn,
    presentation,
    registerView,
    resetSession,
    routeContext,
    rerunLastMessage,
    sendMessage,
    session,
    sessions,
    setEmbeddedLauncherPosition,
    setOpen,
    windowRole
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
