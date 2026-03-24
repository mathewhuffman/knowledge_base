import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AppRoute,
  type AiArtifactRecord,
  type AiAssistantArtifactDecisionResponse,
  type AiAssistantSessionGetResponse,
  type AiAssistantTurnResponse,
  type AiAssistantUiAction,
  type AiMessageRecord,
  type AiSessionRecord,
  type AiViewContext
} from '@kb-vault/shared-types';

const OPTIMISTIC_MESSAGE_PREFIX = 'optimistic:';

type RouteRegistration = {
  key: string;
  context: AiViewContext;
  applyUiActions?: (actions: AiAssistantUiAction[]) => void;
};

type AssistantContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  routeContext: AiViewContext | null;
  session: AiSessionRecord | null;
  messages: AiMessageRecord[];
  artifact: AiArtifactRecord | null;
  loading: boolean;
  error: string | null;
  sendMessage: (message: string) => Promise<void>;
  resetSession: () => Promise<void>;
  applyArtifact: () => Promise<void>;
  rejectArtifact: () => Promise<void>;
  registerView: (registration: RouteRegistration) => () => void;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

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
  const [registration, setRegistration] = useState<RouteRegistration | null>(null);
  const [session, setSession] = useState<AiSessionRecord | null>(null);
  const [messages, setMessages] = useState<AiMessageRecord[]>([]);
  const [artifact, setArtifact] = useState<AiArtifactRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applyActionsRef = useRef<RouteRegistration['applyUiActions']>();

  useEffect(() => {
    applyActionsRef.current = registration?.applyUiActions;
  }, [registration]);

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

  const runUiActions = useCallback((actions: AiAssistantUiAction[]) => {
    if (actions.length === 0) return;
    for (const action of actions) {
      if (action.type === 'show_proposal_created') {
        onOpenProposalReview?.(action.proposalId);
      }
    }
    applyActionsRef.current?.(actions);
  }, [onOpenProposalReview]);

  const loadSession = useCallback(async (context: AiViewContext | null) => {
    if (!context) {
      setSession(null);
      setMessages([]);
      setArtifact(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await window.kbv.invoke<AiAssistantSessionGetResponse>('ai.assistant.session.get', {
        workspaceId: context.workspaceId,
        route: context.route,
        entityType: context.subject?.type,
        entityId: context.subject?.id
      });
      if (!response.ok) {
        setError(response.error?.message ?? 'Failed to load assistant session.');
        setSession(null);
        setMessages([]);
        setArtifact(null);
        return;
      }
      setSession(response.data?.session ?? null);
      setMessages(response.data?.messages ?? []);
      setArtifact(response.data?.artifact ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession(routeContext);
  }, [routeContext?.workspaceId, routeContext?.route, routeContext?.subject?.type, routeContext?.subject?.id, loadSession]);

  const sendMessage = useCallback(async (message: string) => {
    const trimmedMessage = message.trim();
    if (!routeContext || !trimmedMessage) return;

    const optimisticMessage: AiMessageRecord = {
      id: `${OPTIMISTIC_MESSAGE_PREFIX}${Date.now()}`,
      sessionId: session?.id ?? 'pending-session',
      workspaceId: routeContext.workspaceId,
      role: 'user',
      messageKind: 'chat',
      content: trimmedMessage,
      createdAtUtc: new Date().toISOString()
    };

    setMessages((current) => [...current, optimisticMessage]);
    setLoading(true);
    setError(null);
    try {
      const response = await window.kbv.invoke<AiAssistantTurnResponse>('ai.assistant.message.send', {
        workspaceId: routeContext.workspaceId,
        context: routeContext,
        message: trimmedMessage
      });
      if (!response.ok || !response.data) {
        setMessages((current) => current.filter((item) => item.id !== optimisticMessage.id));
        setError(response.error?.message ?? 'Failed to send assistant message.');
        return;
      }
      setSession(response.data.session);
      setMessages(response.data.messages);
      setArtifact(response.data.artifact ?? null);
      runUiActions(response.data.uiActions);
    } catch (err) {
      setMessages((current) => current.filter((item) => item.id !== optimisticMessage.id));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [routeContext, runUiActions, session?.id]);

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
      setMessages(response.data.messages ?? []);
      setArtifact(response.data.artifact ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [routeContext, session]);

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
      setMessages(response.data.messages ?? []);
      setArtifact(response.data.artifact ?? null);
      runUiActions(response.data.uiActions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [artifact, routeContext, runUiActions, session]);

  const registerView = useCallback((next: RouteRegistration) => {
    setRegistration(next);
    return () => {
      setRegistration((current) => (current?.key === next.key ? null : current));
    };
  }, []);

  const value = useMemo<AssistantContextValue>(() => ({
    open,
    setOpen,
    routeContext,
    session,
    messages,
    artifact,
    loading,
    error,
    sendMessage,
    resetSession,
    applyArtifact: () => handleArtifactDecision('ai.assistant.artifact.apply'),
    rejectArtifact: () => handleArtifactDecision('ai.assistant.artifact.reject'),
    registerView
  }), [artifact, error, handleArtifactDecision, loading, messages, open, registerView, resetSession, routeContext, sendMessage, session]);

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
}) {
  const { registerView } = useAiAssistant();
  const applyRef = useRef(config.applyUiActions);

  useEffect(() => {
    applyRef.current = config.applyUiActions;
  }, [config.applyUiActions]);

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
    return registerView({
      key: registrationKey,
      context: config.context,
      applyUiActions
    });
  }, [config.enabled, contextSignature, registerView, registrationKey]);
}
