import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  AgentHealthCheckResponse,
  AgentSessionRecord,
  AgentTranscriptLine,
  AgentToolCallAudit,
  AgentStreamingPayload,
  RpcResponse,
} from '@kb-vault/shared-types';
import { Badge } from './Badge';
import { StatusChip } from './StatusChip';
import { LoadingState } from './LoadingState';
import { ErrorState } from './ErrorState';
import { EmptyState } from './EmptyState';
import {
  IconCheckCircle,
  IconAlertCircle,
  IconActivity,
  IconTerminal,
  IconPlay,
  IconSquare,
  IconRefreshCw,
  IconClock,
  IconTool,
  IconXCircle,
  IconX,
  IconWifi,
  IconWifiOff,
  IconChevronRight,
  IconZap,
} from './icons';
import { useIpc, useIpcMutation } from '../hooks/useIpc';

/* ---------- Helpers ---------- */

function formatTimestamp(utc: string): string {
  try {
    return new Date(utc).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return utc;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function sessionStatusChip(status: string): { status: 'active' | 'live' | 'pending' | 'retired' | 'conflicted'; label: string } {
  switch (status) {
    case 'starting': return { status: 'pending', label: 'Starting' };
    case 'running': return { status: 'active', label: 'Running' };
    case 'idle': return { status: 'live', label: 'Idle' };
    case 'closed': return { status: 'retired', label: 'Closed' };
    case 'error': return { status: 'conflicted', label: 'Error' };
    default: return { status: 'pending', label: status };
  }
}

function streamingKindBadge(kind: AgentStreamingPayload['kind']): 'primary' | 'success' | 'warning' | 'danger' | 'neutral' {
  switch (kind) {
    case 'session_started': return 'primary';
    case 'progress': return 'primary';
    case 'tool_call': return 'neutral';
    case 'tool_response': return 'neutral';
    case 'result': return 'success';
    case 'warning': return 'warning';
    case 'error': return 'danger';
    case 'timeout': return 'danger';
    case 'canceled': return 'warning';
    default: return 'neutral';
  }
}

type AgentToolCallListResponse = {
  workspaceId?: string;
  sessionId?: string;
  toolCalls: AgentToolCallAudit[];
};

function normalizeToolCalls(data: unknown): AgentToolCallAudit[] {
  if (Array.isArray(data)) {
    return data as AgentToolCallAudit[];
  }
  if (data && typeof data === 'object' && 'toolCalls' in data) {
    const payload = data as AgentToolCallListResponse;
    return Array.isArray(payload.toolCalls) ? payload.toolCalls : [];
  }
  return [];
}

interface AcpToolCallRecord {
  toolCallId: string;
  title: string;
  kind: string;
  status: string;
  atUtc: string;
  rawInput?: unknown;
  rawOutput?: unknown;
}

function extractAcpToolCalls(lines: AgentTranscriptLine[]): AcpToolCallRecord[] {
  const toolCalls = new Map<string, AcpToolCallRecord>();

  for (const line of lines) {
    if (line.event !== 'session_update') {
      continue;
    }

    try {
      const parsed = JSON.parse(line.payload) as {
        update?: {
          sessionUpdate?: string;
          toolCallId?: string;
          title?: string;
          kind?: string;
          status?: string;
          rawInput?: unknown;
          rawOutput?: unknown;
        };
      };
      const update = parsed.update;
      if (!update?.toolCallId) {
        continue;
      }

      const existing = toolCalls.get(update.toolCallId) ?? {
        toolCallId: update.toolCallId,
        title: update.title ?? 'Tool',
        kind: update.kind ?? 'unknown',
        status: update.status ?? 'pending',
        atUtc: line.atUtc,
        rawInput: update.rawInput,
      };

      toolCalls.set(update.toolCallId, {
        ...existing,
        title: update.title ?? existing.title,
        kind: update.kind ?? existing.kind,
        status: update.status ?? existing.status,
        atUtc: line.atUtc,
        rawInput: update.rawInput ?? existing.rawInput,
        rawOutput: update.rawOutput ?? existing.rawOutput,
      });
    } catch {
      continue;
    }
  }

  return Array.from(toolCalls.values()).sort((a, b) => a.atUtc.localeCompare(b.atUtc));
}

/* ================================================================== */
/* HealthStatusPanel                                                   */
/* ================================================================== */

interface HealthStatusPanelProps {
  workspaceId: string;
}

export function HealthStatusPanel({ workspaceId }: HealthStatusPanelProps) {
  const healthQuery = useIpc<AgentHealthCheckResponse>('agent.health.check');
  const [lastCheck, setLastCheck] = useState<AgentHealthCheckResponse | null>(null);

  const runCheck = useCallback(() => {
    healthQuery.execute({ workspaceId }).then((data) => {
      if (data) setLastCheck(data);
    });
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const health = lastCheck;
  const allGood = health && health.cursorInstalled && health.acpReachable && health.mcpRunning && health.requiredConfigPresent;

  return (
    <div className="card agent-health-card">
      <div className="card-header">
        <span className="card-header-title">
          <IconActivity size={14} style={{ marginRight: 6 }} />
          Agent Health
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {health && (
            <Badge variant={allGood ? 'success' : 'warning'}>
              {allGood ? 'All Systems Go' : 'Issues Detected'}
            </Badge>
          )}
          <button
            className="btn btn-ghost btn-icon"
            onClick={runCheck}
            disabled={healthQuery.loading}
            title="Re-check health"
            aria-label="Re-check agent health"
          >
            <IconRefreshCw size={14} className={healthQuery.loading ? 'agent-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="card-body">
        {healthQuery.loading && !health ? (
          <LoadingState message="Checking agent runtime..." />
        ) : healthQuery.error && !health ? (
          <ErrorState
            title="Health check failed"
            description={healthQuery.error}
            action={<button className="btn btn-primary btn-sm" onClick={runCheck}>Retry</button>}
          />
        ) : health ? (
          <div className="agent-health-grid">
            <HealthCheckItem
              label="Cursor CLI"
              ok={health.cursorInstalled}
              detail={health.cursorBinaryPath ?? 'Not found'}
            />
            <HealthCheckItem
              label="ACP Reachable"
              ok={health.acpReachable}
              detail={health.acpReachable ? 'Connected' : 'Cannot reach ACP transport'}
            />
            <HealthCheckItem
              label="MCP Server"
              ok={health.mcpRunning}
              detail={health.mcpRunning ? 'Running' : 'Not running'}
            />
            <HealthCheckItem
              label="Configuration"
              ok={health.requiredConfigPresent}
              detail={health.requiredConfigPresent ? 'All required config present' : 'Missing required configuration'}
            />

            {health.issues.length > 0 && (
              <div className="agent-health-issues">
                <div className="agent-health-issues-heading">
                  <IconAlertCircle size={12} />
                  Issues
                </div>
                {health.issues.map((issue, i) => (
                  <div key={i} className="agent-health-issue-item">{issue}</div>
                ))}
              </div>
            )}

            {health.checkedAtUtc && (
              <div className="agent-health-timestamp">
                Last checked: {formatTimestamp(health.checkedAtUtc)}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HealthCheckItem({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="agent-health-item">
      <div className="agent-health-item-indicator">
        {ok ? (
          <IconCheckCircle size={16} className="agent-health-ok" />
        ) : (
          <IconXCircle size={16} className="agent-health-fail" />
        )}
      </div>
      <div className="agent-health-item-content">
        <div className="agent-health-item-label">{label}</div>
        <div className="agent-health-item-detail">{detail}</div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* SessionListPanel                                                    */
/* ================================================================== */

interface SessionListPanelProps {
  workspaceId: string;
  onSelectSession?: (session: AgentSessionRecord) => void;
}

export function SessionListPanel({ workspaceId, onSelectSession }: SessionListPanelProps) {
  const sessionsQuery = useIpc<{ workspaceId: string; sessions: AgentSessionRecord[] }>('agent.session.list');
  const closeMutation = useIpcMutation<AgentSessionRecord>('agent.session.close');
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(() => {
    sessionsQuery.execute({ workspaceId, includeClosed: showClosed });
  }, [workspaceId, showClosed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  const sessions = useMemo(() => {
    const data = sessionsQuery.data;
    if (!data) return [];
    return Array.isArray(data.sessions) ? data.sessions : [];
  }, [sessionsQuery.data]);

  const handleClose = async (sessionId: string) => {
    await closeMutation.mutate({ workspaceId, sessionId });
    load();
  };

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-header-title">Sessions</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <label className="agent-toggle-label">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
            />
            <span>Show closed</span>
          </label>
          <button className="btn btn-ghost btn-icon" onClick={load} title="Refresh sessions">
            <IconRefreshCw size={14} />
          </button>
        </div>
      </div>
      <div className="card-body">
        {sessionsQuery.loading ? (
          <LoadingState message="Loading sessions..." />
        ) : sessionsQuery.error ? (
          <ErrorState title="Failed to load sessions" description={sessionsQuery.error} />
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={<IconZap size={32} />}
            title="No sessions"
            description="Sessions are created automatically when you run analysis or edit an article with AI."
          />
        ) : (
          <div className="agent-session-list">
            {sessions.map((session) => {
              const chipProps = sessionStatusChip(session.status);
              return (
                <div
                  key={session.id}
                  className="agent-session-row"
                  onClick={() => onSelectSession?.(session)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') onSelectSession?.(session); }}
                >
                  <div className="agent-session-row-main">
                    <div className="agent-session-row-type">
                      {session.type === 'batch_analysis' ? (
                        <Badge variant="primary">Batch Analysis</Badge>
                      ) : (
                        <Badge variant="neutral">Article Edit</Badge>
                      )}
                    </div>
                    <StatusChip status={chipProps.status} label={chipProps.label} />
                  </div>
                  <div className="agent-session-row-meta">
                    <span className="agent-session-row-id" title={session.id}>
                      {session.id.slice(0, 8)}...
                    </span>
                    {session.batchId && (
                      <span className="agent-session-row-tag">Batch: {session.batchId.slice(0, 8)}</span>
                    )}
                    <span className="agent-session-row-time">
                      <IconClock size={10} />
                      {formatTimestamp(session.createdAtUtc)}
                    </span>
                  </div>
                  <div className="agent-session-row-actions">
                    {session.status !== 'closed' && (
                      <button
                        className="btn btn-ghost btn-icon btn-xs"
                        onClick={(e) => { e.stopPropagation(); void handleClose(session.id); }}
                        title="Close session"
                      >
                        <IconX size={12} />
                      </button>
                    )}
                    <IconChevronRight size={14} className="agent-session-row-chevron" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* SessionDetailPanel                                                  */
/* ================================================================== */

interface SessionDetailPanelProps {
  workspaceId: string;
  session: AgentSessionRecord;
  onBack: () => void;
}

export function SessionDetailPanel({ workspaceId, session, onBack }: SessionDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<'transcript' | 'tools'>('transcript');
  const transcriptQuery = useIpc<{ workspaceId: string; sessionId: string; lines: AgentTranscriptLine[] }>('agent.transcript.get');
  const toolsQuery = useIpc<AgentToolCallAudit[]>('agent.tool.calls');

  useEffect(() => {
    transcriptQuery.execute({ workspaceId, sessionId: session.id, limit: 200 });
    toolsQuery.execute({ workspaceId, sessionId: session.id });
  }, [workspaceId, session.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const chipProps = sessionStatusChip(session.status);
  const transcriptLines = transcriptQuery.data?.lines ?? [];
  const toolCalls = normalizeToolCalls(toolsQuery.data);

  return (
    <div className="agent-session-detail">
      <div className="agent-session-detail-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          &larr; Sessions
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Badge variant={session.type === 'batch_analysis' ? 'primary' : 'neutral'}>
            {session.type === 'batch_analysis' ? 'Batch Analysis' : 'Article Edit'}
          </Badge>
          <StatusChip status={chipProps.status} label={chipProps.label} />
        </div>
      </div>

      <div className="agent-session-detail-meta">
        <div className="agent-meta-pair">
          <span className="agent-meta-label">Session ID</span>
          <code className="agent-meta-value">{session.id}</code>
        </div>
        {session.batchId && (
          <div className="agent-meta-pair">
            <span className="agent-meta-label">Batch</span>
            <code className="agent-meta-value">{session.batchId}</code>
          </div>
        )}
        {session.locale && (
          <div className="agent-meta-pair">
            <span className="agent-meta-label">Locale</span>
            <span className="agent-meta-value">{session.locale}</span>
          </div>
        )}
        <div className="agent-meta-pair">
          <span className="agent-meta-label">Created</span>
          <span className="agent-meta-value">{formatTimestamp(session.createdAtUtc)}</span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        <button
          className={`tab-item ${activeTab === 'transcript' ? 'active' : ''}`}
          onClick={() => setActiveTab('transcript')}
        >
          <IconTerminal size={12} />
          Transcript ({transcriptLines.length})
        </button>
        <button
          className={`tab-item ${activeTab === 'tools' ? 'active' : ''}`}
          onClick={() => setActiveTab('tools')}
        >
          <IconTool size={12} />
          Tool Calls ({toolCalls.length})
        </button>
      </div>

      <div className="agent-session-detail-body">
        {activeTab === 'transcript' ? (
          <TranscriptView lines={transcriptLines} loading={transcriptQuery.loading} error={transcriptQuery.error} />
        ) : (
          <ToolCallsView calls={toolCalls} loading={toolsQuery.loading} error={toolsQuery.error} />
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* TranscriptView                                                      */
/* ================================================================== */

function TranscriptView({ lines, loading, error }: { lines: AgentTranscriptLine[]; loading: boolean; error: string | null }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const mergedLines = useMemo(() => mergeTranscriptLines(lines), [lines]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mergedLines.length]);

  if (loading) return <LoadingState message="Loading transcript..." />;
  if (error) return <ErrorState title="Transcript unavailable" description={error} />;
  if (mergedLines.length === 0) {
    return (
      <EmptyState
        icon={<IconTerminal size={32} />}
        title="No transcript yet"
        description="Transcript lines will appear once the session processes messages."
      />
    );
  }

  return (
    <div className="agent-transcript analysis-copyable" ref={scrollRef}>
      {mergedLines.map((line, i) => (
        <div key={i} className={`agent-transcript-line agent-transcript-line--${line.direction}`}>
          <div className="agent-transcript-line-header">
            <span className="agent-transcript-line-time">{formatTimestamp(line.atUtc)}</span>
            <Badge
              variant={line.direction === 'to_agent' ? 'primary' : line.direction === 'from_agent' ? 'success' : 'neutral'}
            >
              {line.direction === 'to_agent' ? 'To Agent' : line.direction === 'from_agent' ? 'From Agent' : 'System'}
            </Badge>
            <span className="agent-transcript-line-event">{line.event}</span>
          </div>
          <pre className="agent-transcript-line-payload">{formatPayload(line.payload)}</pre>
        </div>
      ))}
    </div>
  );
}

function mergeTranscriptLines(lines: AgentTranscriptLine[]): AgentTranscriptLine[] {
  const merged: AgentTranscriptLine[] = [];

  for (const line of lines) {
    if (line.event !== 'session_update') {
      merged.push(line);
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(line.payload);
    } catch {
      merged.push(line);
      continue;
    }

    const updateType = parsed?.update?.sessionUpdate;
    const contentType = parsed?.update?.content?.type;
    const contentText = typeof parsed?.update?.content?.text === 'string' ? parsed.update.content.text : '';
    const mergeable = (updateType === 'agent_thought_chunk' || updateType === 'agent_message_chunk') && contentType === 'text';

    if (!mergeable || !contentText) {
      merged.push(line);
      continue;
    }

    const previous = merged[merged.length - 1];
    if (!previous || previous.direction !== line.direction || previous.event !== 'session_update') {
      merged.push(line);
      continue;
    }

    let previousParsed: any;
    try {
      previousParsed = JSON.parse(previous.payload);
    } catch {
      merged.push(line);
      continue;
    }

    const previousType = previousParsed?.update?.sessionUpdate;
    const previousContentType = previousParsed?.update?.content?.type;
    const previousText =
      typeof previousParsed?.update?.content?.text === 'string' ? previousParsed.update.content.text : null;

    if (previousType !== updateType || previousContentType !== 'text' || previousText === null) {
      merged.push(line);
      continue;
    }

    previousParsed.update.content.text = appendStreamingText(previousText, contentText);
    previous.payload = JSON.stringify(previousParsed);
    previous.atUtc = line.atUtc;
  }

  return merged;
}

function appendStreamingText(existing: string, next: string): string {
  if (!next) {
    return existing;
  }
  if (!existing) {
    return next;
  }
  if (existing.endsWith(next)) {
    return existing;
  }
  if (next.startsWith(existing)) {
    return next;
  }

  const maxOverlap = Math.min(existing.length, next.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (existing.slice(-overlap) === next.slice(0, overlap)) {
      return `${existing}${next.slice(overlap)}`;
    }
  }

  return `${existing}${next}`;
}

function formatPayload(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

/* ================================================================== */
/* ToolCallsView                                                       */
/* ================================================================== */

function ToolCallsView({ calls, loading, error }: { calls: AgentToolCallAudit[]; loading: boolean; error: string | null }) {
  if (loading) return <LoadingState message="Loading tool calls..." />;
  if (error) return <ErrorState title="Tool calls unavailable" description={error} />;
  if (calls.length === 0) {
    return (
      <EmptyState
        icon={<IconTool size={32} />}
        title="No tool calls"
        description="MCP tool calls made by the agent will appear here."
      />
    );
  }

  return (
    <div className="agent-tool-calls analysis-copyable">
      {calls.map((call, i) => (
        <div key={i} className={`agent-tool-call-item ${call.allowed ? '' : 'agent-tool-call-item--denied'}`}>
          <div className="agent-tool-call-header">
            <code className="agent-tool-call-name">{call.toolName}</code>
            <Badge variant={call.allowed ? 'success' : 'danger'}>{call.allowed ? 'Allowed' : 'Denied'}</Badge>
            <span className="agent-tool-call-time">{formatTimestamp(call.calledAtUtc)}</span>
          </div>
          {call.reason && (
            <div className="agent-tool-call-reason">{call.reason}</div>
          )}
          <pre className="agent-tool-call-args">{formatPayload(typeof call.args === 'string' ? call.args : JSON.stringify(call.args))}</pre>
        </div>
      ))}
    </div>
  );
}

function AcpToolCallsView({ calls, loading, error }: { calls: AcpToolCallRecord[]; loading: boolean; error: string | null }) {
  if (loading) return <LoadingState message="Loading ACP tool calls..." />;
  if (error) return <ErrorState title="ACP tool calls unavailable" description={error} />;
  if (calls.length === 0) {
    return (
      <EmptyState
        icon={<IconTool size={32} />}
        title="No ACP tool calls"
        description="Cursor-native ACP tool calls will appear here."
      />
    );
  }

  return (
    <div className="agent-tool-calls analysis-copyable">
      {calls.map((call) => (
        <div key={call.toolCallId} className="agent-tool-call-item">
          <div className="agent-tool-call-header">
            <code className="agent-tool-call-name">{call.title}</code>
            <Badge variant={call.status === 'completed' ? 'success' : call.status === 'in_progress' ? 'primary' : 'neutral'}>
              {call.status}
            </Badge>
            <span className="agent-tool-call-time">{formatTimestamp(call.atUtc)}</span>
          </div>
          <div className="agent-tool-call-reason">Kind: {call.kind}</div>
          {call.rawInput !== undefined && (
            <pre className="agent-tool-call-args">{formatPayload(JSON.stringify(call.rawInput))}</pre>
          )}
          {call.rawOutput !== undefined && (
            <pre className="agent-tool-call-args">{formatPayload(JSON.stringify(call.rawOutput))}</pre>
          )}
        </div>
      ))}
    </div>
  );
}

/* ================================================================== */
/* AnalysisJobRunner — inline run-analysis experience                   */
/* ================================================================== */

interface AnalysisJobRunnerProps {
  workspaceId: string;
  batchId: string;
  startOnOpen?: boolean;
  onComplete?: () => void;
}

export function AnalysisJobRunner({ workspaceId, batchId, startOnOpen, onComplete }: AnalysisJobRunnerProps) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobState, setJobState] = useState<string>('');
  const [progress, setProgress] = useState(0);
  const [events, setEvents] = useState<AgentStreamingPayload[]>([]);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [historyTab, setHistoryTab] = useState<'transcript' | 'kb_tools' | 'acp_tools'>('transcript');
  const [sessionListLoading, setSessionListLoading] = useState(false);
  const [autoStartPending, setAutoStartPending] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [liveTranscriptLines, setLiveTranscriptLines] = useState<AgentTranscriptLine[]>([]);
  const [liveToolCalls, setLiveToolCalls] = useState<AgentToolCallAudit[]>([]);
  const [sessionListData, setSessionListData] = useState<AgentSessionRecord[]>([]);
  const [resolvedSessionId, setResolvedSessionId] = useState<string | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const terminalStateHandledRef = useRef(false);
  const sessionListInFlightRef = useRef(false);
  const autoStartIssuedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Subscribe to job events
  const refreshSessions = useCallback(async () => {
    if (sessionListInFlightRef.current) {
      return;
    }
    sessionListInFlightRef.current = true;
    setSessionListLoading(true);
    try {
      const response = await window.kbv.invoke<{ workspaceId: string; sessions: AgentSessionRecord[] }>('agent.session.list', {
        workspaceId,
        includeClosed: true,
      }) as RpcResponse<{ workspaceId: string; sessions: AgentSessionRecord[] }>;
      if (response.ok && response.data) {
        setSessionListData(Array.isArray(response.data.sessions) ? response.data.sessions : []);
      }
    } finally {
      sessionListInFlightRef.current = false;
      setSessionListLoading(false);
    }
  }, [workspaceId]);

  const refreshHistory = useCallback(async (sessionId: string, silent = false) => {
    if (!silent) {
      setHistoryLoading(true);
    }
    setHistoryError(null);
    try {
      const [transcriptResponse, toolsResponse] = await Promise.all([
        window.kbv.invoke<{ workspaceId: string; sessionId: string; lines: AgentTranscriptLine[] }>('agent.transcript.get', {
          workspaceId,
          sessionId,
          limit: 200,
        }) as Promise<RpcResponse<{ workspaceId: string; sessionId: string; lines: AgentTranscriptLine[] }>>,
        window.kbv.invoke<AgentToolCallAudit[]>('agent.tool.calls', {
          workspaceId,
          sessionId,
        }) as Promise<RpcResponse<AgentToolCallAudit[]>>,
      ]);

      if (transcriptResponse.ok && transcriptResponse.data) {
        setLiveTranscriptLines(transcriptResponse.data.lines ?? []);
      }
      if (toolsResponse.ok && toolsResponse.data !== undefined) {
        setLiveToolCalls(normalizeToolCalls(toolsResponse.data));
      }

      if (!transcriptResponse.ok) {
        setHistoryError(transcriptResponse.error?.message ?? 'Transcript unavailable');
      } else if (!toolsResponse.ok) {
        setHistoryError(toolsResponse.error?.message ?? 'Tool calls unavailable');
      }
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : String(err));
      if (!silent) {
        setLiveTranscriptLines([]);
        setLiveToolCalls([]);
      }
    } finally {
      if (!silent) {
        setHistoryLoading(false);
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    void refreshSessions();

    const handler = (event: { id: string; command: string; state: string; progress: number; message?: string }) => {
      if (event.command !== 'agent.analysis.run') return;
      if (!jobIdRef.current || event.id !== jobIdRef.current) return;
      if (terminalStateHandledRef.current && (event.state === 'SUCCEEDED' || event.state === 'FAILED' || event.state === 'CANCELED')) {
        return;
      }

      setJobState(event.state);
      setProgress(event.progress);
      let payloadSessionId: string | null = null;

      // Parse streaming payload from message
      if (event.message) {
        try {
          const payload = JSON.parse(event.message) as AgentStreamingPayload;
          setEvents((prev) => [...prev, payload]);
          if (payload.sessionId) {
            payloadSessionId = payload.sessionId;
            setResolvedSessionId(payload.sessionId);
          }
          if (payload.kind === 'progress' && payload.data) {
            const sessionUpdatePayload = JSON.stringify(payload.data);
            setLiveTranscriptLines((prev) => {
              const nextLine: AgentTranscriptLine = {
                atUtc: payload.atUtc,
                direction: 'from_agent',
                event: 'session_update',
                payload: sessionUpdatePayload,
              };
              const lastLine = prev[prev.length - 1];
              if (lastLine && lastLine.event === nextLine.event && lastLine.payload === nextLine.payload) {
                return prev;
              }
              return [...prev, nextLine];
            });
          }
        } catch {
          // Non-JSON message, still useful
          setEvents((prev) => [...prev, {
            sessionId: '',
            kind: 'progress',
            message: event.message,
            atUtc: new Date().toISOString(),
          }]);
        }
      }

      if (event.state === 'SUCCEEDED' || event.state === 'FAILED' || event.state === 'CANCELED') {
        terminalStateHandledRef.current = true;
        void refreshSessions();
        if (payloadSessionId) {
          void refreshHistory(payloadSessionId, true);
        }
        onComplete?.();
      }
    };
    const unsubscribe = window.kbv.emitJobEvents(handler);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [refreshHistory, refreshSessions, workspaceId]);

  const latestBatchSession = useMemo(() => {
    const allSessions = sessionListData;
    const batchSessions = allSessions.filter((session) => session.type === 'batch_analysis' && session.batchId === batchId);
    return batchSessions.sort((a, b) => b.updatedAtUtc.localeCompare(a.updatedAtUtc))[0] ?? null;
  }, [batchId, sessionListData]);
  const activeSessionId = resolvedSessionId ?? latestBatchSession?.id ?? null;

  useEffect(() => {
    if (latestBatchSession?.id) {
      setResolvedSessionId((current) => current ?? latestBatchSession.id);
    }
  }, [latestBatchSession]);

  useEffect(() => {
    if (!activeSessionId) {
      setLiveTranscriptLines([]);
      setLiveToolCalls([]);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    void refreshHistory(activeSessionId);
  }, [activeSessionId, refreshHistory]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  const startJob = async () => {
    setError(null);
    setEvents([]);
    terminalStateHandledRef.current = false;
    setJobState('QUEUED');
    setProgress(0);

    try {
      const response = await window.kbv.startJob('agent.analysis.run', { workspaceId, batchId });
      if (response.jobId) {
        setJobId(response.jobId);
        jobIdRef.current = response.jobId;
        void refreshSessions();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start analysis');
      setJobState('');
    }
  };

  const cancelJob = async () => {
    if (!jobId) return;
    setCanceling(true);
    try {
      await window.kbv.cancelJob(jobId);
    } finally {
      setCanceling(false);
    }
  };

  const isRunning = jobState === 'RUNNING' || jobState === 'QUEUED';
  const isDone = jobState === 'SUCCEEDED' || jobState === 'FAILED' || jobState === 'CANCELED';
  const transcriptLines = liveTranscriptLines;
  const mergedTranscriptLines = useMemo(() => mergeTranscriptLines(transcriptLines), [transcriptLines]);
  const toolCalls = liveToolCalls;
  const acpToolCalls = useMemo(() => extractAcpToolCalls(transcriptLines), [transcriptLines]);
  const hasHistory = Boolean(activeSessionId);
  const canManuallyStart = !startOnOpen && !hasHistory;
  const canCopy = transcriptLines.length > 0 || toolCalls.length > 0 || events.length > 0;

  useEffect(() => {
    if (!startOnOpen) {
      return;
    }
    if (autoStartIssuedRef.current) {
      return;
    }
    if (hasHistory) {
      return;
    }
    if (isDone || isRunning) {
      return;
    }
    if (sessionListLoading) {
      return;
    }

    autoStartIssuedRef.current = true;
    setAutoStartPending(true);
    void startJob().finally(() => {
      setAutoStartPending(false);
    });
  }, [startOnOpen, hasHistory, isDone, isRunning, sessionListLoading, startJob]);

  const copyText = useCallback(() => {
    const chunks: string[] = [];
    chunks.push(`Batch: ${batchId}`);
    if (latestBatchSession) {
      chunks.push(`Session: ${latestBatchSession.id}`);
      chunks.push(`Status: ${sessionStatusChip(latestBatchSession.status).label}`);
      if (latestBatchSession.createdAtUtc) {
        chunks.push(`Created: ${formatTimestamp(latestBatchSession.createdAtUtc)}`);
      }
      if (latestBatchSession.updatedAtUtc) {
        chunks.push(`Updated: ${formatTimestamp(latestBatchSession.updatedAtUtc)}`);
      }
    }
    if (jobState) {
      chunks.push(`Current state: ${jobState}`);
    }
    if (progress > 0) {
      chunks.push(`Progress: ${progress}%`);
    }

    chunks.push('');
    chunks.push('Transcript');
    chunks.push('----------');
    if (mergedTranscriptLines.length === 0) {
      chunks.push('No transcript lines');
    } else {
      mergedTranscriptLines.forEach((line) => {
        chunks.push(`[${formatTimestamp(line.atUtc)}] ${line.direction} ${line.event}`);
        chunks.push(formatPayload(line.payload));
      });
    }

    chunks.push('');
    chunks.push('Tool Calls');
    chunks.push('----------');
    if (toolCalls.length === 0) {
      chunks.push('No tool calls');
    } else {
      toolCalls.forEach((call) => {
        chunks.push(`${call.toolName} (${call.allowed ? 'allowed' : 'denied'})`);
        if (call.reason) {
          chunks.push(`Reason: ${call.reason}`);
        }
        chunks.push(`Arguments: ${formatPayload(typeof call.args === 'string' ? call.args : JSON.stringify(call.args))}`);
        chunks.push('');
      });
    }

    chunks.push('');
    chunks.push('Events');
    chunks.push('----------');
    if (events.length === 0) {
      chunks.push('No events yet');
    } else {
      events.forEach((evt) => {
        const suffix = evt.message ? `: ${evt.message}` : '';
        chunks.push(`[${formatTimestamp(evt.atUtc)}] ${evt.kind}${suffix}`);
      });
    }

    return chunks.join('\n');
  }, [batchId, events, jobState, latestBatchSession, mergedTranscriptLines, progress, toolCalls]);

  const copyAnalysisContents = useCallback(() => {
    if (!canCopy) {
      return;
    }
    void navigator.clipboard.writeText(copyText()).then(
      () => {
        setCopyStatus('Copied');
      },
      () => {
        setCopyStatus('Copy failed');
      },
    );
    window.setTimeout(() => setCopyStatus(null), 1500);
  }, [canCopy, copyText]);

  return (
    <div className="agent-job-runner analysis-copyable">
      {hasHistory && (
        <div className="agent-session-detail">
          <div className="agent-session-detail-header">
            <span className="agent-meta-pair">
              <span className="agent-meta-label">Last analysis session</span>
              <code className="agent-meta-value">{activeSessionId}</code>
            </span>
            <Badge variant={latestBatchSession?.status === 'running' || latestBatchSession?.status === 'idle' ? 'success' : 'neutral'}>
              {latestBatchSession ? sessionStatusChip(latestBatchSession.status).label : 'Unknown'}
            </Badge>
          </div>

          <div className="agent-session-detail-meta">
            {latestBatchSession?.createdAtUtc && (
              <div className="agent-meta-pair">
                <span className="agent-meta-label">Created</span>
                <span className="agent-meta-value">{formatTimestamp(latestBatchSession.createdAtUtc)}</span>
              </div>
            )}
            {latestBatchSession?.updatedAtUtc && (
              <div className="agent-meta-pair">
                <span className="agent-meta-label">Updated</span>
                <span className="agent-meta-value">{formatTimestamp(latestBatchSession.updatedAtUtc)}</span>
              </div>
            )}
          </div>

          <div className="tab-bar">
            <button
              className={`tab-item ${historyTab === 'transcript' ? 'active' : ''}`}
              onClick={() => setHistoryTab('transcript')}
            >
              <IconTerminal size={12} />
              Transcript ({transcriptLines.length})
            </button>
            <button
              className={`tab-item ${historyTab === 'kb_tools' ? 'active' : ''}`}
              onClick={() => setHistoryTab('kb_tools')}
            >
              <IconTool size={12} />
              KB Tool Calls ({toolCalls.length})
            </button>
            <button
              className={`tab-item ${historyTab === 'acp_tools' ? 'active' : ''}`}
              onClick={() => setHistoryTab('acp_tools')}
            >
              <IconTool size={12} />
              ACP Tool Calls ({acpToolCalls.length})
            </button>
          </div>

          <div className="agent-session-detail-body">
            {historyTab === 'transcript' ? (
              <TranscriptView
                lines={transcriptLines}
                loading={historyLoading || sessionListLoading}
                error={historyError}
              />
            ) : historyTab === 'kb_tools' ? (
              <ToolCallsView
                calls={toolCalls}
                loading={historyLoading}
                error={historyError}
              />
            ) : (
              <AcpToolCallsView
                calls={acpToolCalls}
                loading={historyLoading}
                error={historyError}
              />
            )}
          </div>
        </div>
      )}

      <div className="agent-job-copy-row">
        <button className="btn btn-ghost btn-sm" onClick={copyAnalysisContents} disabled={!canCopy}>
          Copy analysis contents
        </button>
        {copyStatus && <span className="agent-job-copy-status">{copyStatus}</span>}
      </div>

      {/* Controls */}
      <div className="agent-job-runner-controls">
        {canManuallyStart && !isRunning && !isDone && (
          <button className="btn btn-primary" onClick={startJob}>
            <IconPlay size={14} />
            Run Analysis
          </button>
        )}
        {startOnOpen && !isRunning && !isDone && autoStartPending && (
          <span className="agent-job-status">Starting analysis...</span>
        )}
        {isRunning && (
          <>
            <Badge variant="primary">{jobState}</Badge>
            <button className="btn btn-danger btn-sm" onClick={cancelJob} disabled={canceling}>
              <IconSquare size={12} />
              {canceling ? 'Canceling...' : 'Cancel'}
            </button>
          </>
        )}
        {isDone && (
          <>
            <Badge variant={jobState === 'SUCCEEDED' ? 'success' : jobState === 'CANCELED' ? 'warning' : 'danger'}>
              {jobState}
            </Badge>
            <button className="btn btn-ghost btn-sm" onClick={startJob}>
              <IconRefreshCw size={12} />
              Run Again
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="agent-job-error">
          <IconAlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* Progress */}
      {jobState && (
        <div className="agent-job-progress-section">
          <div className="agent-job-progress-header">
            <span className="agent-job-progress-label">
              {jobState === 'SUCCEEDED' ? 'Analysis complete' :
               jobState === 'FAILED' ? 'Analysis failed' :
               jobState === 'CANCELED' ? 'Analysis canceled' :
               'Analyzing batch...'}
            </span>
            <span className="agent-job-progress-pct">{progress}%</span>
          </div>
          <div className="progress-bar" style={{ height: 6 }}>
            <div
              className="progress-bar-fill"
              style={{
                width: `${progress}%`,
                background: jobState === 'FAILED'
                  ? 'var(--color-danger)'
                  : jobState === 'CANCELED'
                    ? 'var(--color-warning)'
                    : jobState === 'SUCCEEDED'
                      ? 'var(--color-success)'
                      : undefined,
              }}
            />
          </div>
        </div>
      )}

      {/* Streaming event log */}
      {events.length > 0 && (
        <div className="agent-job-event-log analysis-copyable" ref={scrollRef}>
          {events.map((evt, i) => (
            <div key={i} className="agent-job-event">
              <Badge variant={streamingKindBadge(evt.kind)}>
                {evt.kind}
              </Badge>
              <span className="agent-job-event-time">{formatTimestamp(evt.atUtc)}</span>
              {evt.message && <span className="agent-job-event-msg">{evt.message}</span>}
              {evt.kind === 'tool_call' && evt.data && (
                <code className="agent-job-event-data">
                  {typeof evt.data === 'object' ? JSON.stringify(evt.data) : String(evt.data)}
                </code>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* CursorUnavailableBanner                                             */
/* ================================================================== */

export function CursorUnavailableBanner() {
  return (
    <div className="agent-unavailable-banner">
      <div className="agent-unavailable-icon">
        <IconWifiOff size={24} />
      </div>
      <div className="agent-unavailable-content">
        <div className="agent-unavailable-title">Cursor Not Available</div>
        <div className="agent-unavailable-desc">
          KB Vault requires Cursor with ACP enabled to run AI analysis and editing.
          Ensure Cursor is installed and the ACP transport is accessible.
        </div>
        <div className="agent-unavailable-steps">
          <div className="agent-unavailable-step">1. Install or update Cursor</div>
          <div className="agent-unavailable-step">2. Enable ACP in Cursor settings</div>
          <div className="agent-unavailable-step">3. Return here and re-check health</div>
        </div>
      </div>
    </div>
  );
}
