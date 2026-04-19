import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  AgentHealthCheckResponse,
  BatchAnalysisInspectionResponse,
  BatchAnalysisEventStreamResponse,
  BatchAnalysisRuntimeStatus,
  AgentSessionRecord,
  AgentTranscriptLine,
  AgentToolCallAudit,
  AgentStreamingPayload,
  BatchAnalysisSnapshotResponse,
  KbAccessMode,
  KbAccessHealth,
  PersistedAgentAnalysisRun,
  PersistedAgentAnalysisRunResponse,
  WorkspaceSettingsRecord,
  RpcResponse,
} from '@kb-vault/shared-types';
import { CliHealthFailure, KB_ACCESS_MODES, isKbAccessMode } from '@kb-vault/shared-types';
import { Badge } from './Badge';
import { StatusChip } from './StatusChip';
import { ProviderBadge, RuntimeIndicator, RunHistoryBadge } from './ProviderBadge';
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
  IconServer,
} from './icons';
import { useIpc, useIpcMutation } from '../hooks/useIpc';
import { BatchAnalysisInspector } from './batch-analysis/BatchAnalysisInspector';

function parseModeFromUnknown(value: unknown): KbAccessMode | null {
  return isKbAccessMode(value) ? value : null;
}

function parseRuntimeStatusFromUnknown(value: unknown): BatchAnalysisRuntimeStatus | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<BatchAnalysisRuntimeStatus>;
  if (typeof candidate.workspaceId !== 'string' || typeof candidate.batchId !== 'string') {
    return null;
  }
  return {
    workspaceId: candidate.workspaceId,
    batchId: candidate.batchId,
    iterationId: typeof candidate.iterationId === 'string' ? candidate.iterationId : undefined,
    iteration: typeof candidate.iteration === 'number' ? candidate.iteration : undefined,
    iterationStatus: candidate.iterationStatus,
    stage: candidate.stage,
    role: candidate.role,
    agentModelId: typeof candidate.agentModelId === 'string' ? candidate.agentModelId : undefined,
    sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : undefined,
    approvedPlanId: typeof candidate.approvedPlanId === 'string' ? candidate.approvedPlanId : undefined,
    lastReviewVerdict: candidate.lastReviewVerdict,
    outstandingDiscoveredWorkCount: typeof candidate.outstandingDiscoveredWorkCount === 'number' ? candidate.outstandingDiscoveredWorkCount : 0,
    activeQuestionSetId: typeof candidate.activeQuestionSetId === 'string' ? candidate.activeQuestionSetId : undefined,
    activeQuestionSetStatus: candidate.activeQuestionSetStatus,
    pausedForUserInput: Boolean(candidate.pausedForUserInput),
    unansweredRequiredQuestionCount: typeof candidate.unansweredRequiredQuestionCount === 'number' ? candidate.unansweredRequiredQuestionCount : 0,
    executionCounts: candidate.executionCounts ?? {
      total: 0,
      create: 0,
      edit: 0,
      retire: 0,
      noImpact: 0,
      executed: 0,
      blocked: 0,
      rejected: 0,
    },
    stageStartedAtUtc: typeof candidate.stageStartedAtUtc === 'string' ? candidate.stageStartedAtUtc : undefined,
    stageEndedAtUtc: typeof candidate.stageEndedAtUtc === 'string' ? candidate.stageEndedAtUtc : undefined,
    updatedAtUtc: typeof candidate.updatedAtUtc === 'string' ? candidate.updatedAtUtc : undefined,
    latestEventId: typeof candidate.latestEventId === 'string' ? candidate.latestEventId : undefined,
    latestEventType: candidate.latestEventType,
  };
}

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

function persistedRunStatusChip(status: string): { status: 'active' | 'live' | 'pending' | 'retired' | 'conflicted'; label: string } {
  switch (status) {
    case 'running': return { status: 'active', label: 'Running' };
    case 'complete': return { status: 'live', label: 'Complete' };
    case 'failed': return { status: 'conflicted', label: 'Failed' };
    case 'canceled': return { status: 'retired', label: 'Canceled' };
    default: return { status: 'pending', label: status };
  }
}

function sessionTypeLabel(type: AgentSessionRecord['type']): string {
  if (type === 'batch_analysis') {
    return 'Batch Analysis';
  }
  if (type === 'assistant_chat') {
    return 'Assistant Chat';
  }
  return 'Article Edit';
}

function sessionTypeBadgeVariant(type: AgentSessionRecord['type']): 'primary' | 'neutral' {
  return type === 'batch_analysis' ? 'primary' : 'neutral';
}

function runtimeBadgeVariant(mode: KbAccessMode): 'primary' | 'warning' {
  return mode === 'cli' ? 'warning' : 'primary';
}

function runtimeBadgeLabel(mode: KbAccessMode, expanded = false): string {
  if (mode === 'mcp') {
    return expanded ? 'MCP Runtime' : 'MCP';
  }
  if (mode === 'cli') {
    return expanded ? 'CLI Runtime' : 'CLI';
  }
  return expanded ? 'Direct Runtime' : 'Direct';
}

/* ---------- Failure copy & recovery guidance ---------- */

function cliFailureMessage(code: CliHealthFailure | undefined): string {
  switch (code) {
    case CliHealthFailure.BINARY_NOT_FOUND:
      return 'The KB CLI binary could not be found on this machine.';
    case CliHealthFailure.BINARY_NOT_EXECUTABLE:
      return 'The KB CLI binary exists but cannot be executed. Check file permissions.';
    case CliHealthFailure.LOOPBACK_NOT_RUNNING:
      return 'The CLI loopback service is not running. It may need to be started.';
    case CliHealthFailure.LOOPBACK_UNREACHABLE:
      return 'The CLI loopback service is running but not responding to connections.';
    case CliHealthFailure.LOOPBACK_UNHEALTHY:
      return 'The CLI loopback service is reachable but reporting an unhealthy state.';
    case CliHealthFailure.AUTH_TOKEN_MISSING:
      return 'Authentication token is missing. The loopback service requires a valid token.';
    case CliHealthFailure.HEALTH_PROBE_TIMEOUT:
      return 'Health check timed out waiting for a response from the CLI service.';
    case CliHealthFailure.HEALTH_PROBE_FAILED:
      return 'Health probe returned an unexpected error from the CLI service.';
    case CliHealthFailure.HEALTH_PROBE_REJECTED:
      return 'The CLI service rejected the health probe. Check authentication and configuration.';
    default:
      return '';
  }
}

function cliFailureRecovery(code: CliHealthFailure | undefined): string[] {
  switch (code) {
    case CliHealthFailure.BINARY_NOT_FOUND:
      return ['Verify the KB CLI is installed', 'Check that the binary path is correct in workspace settings'];
    case CliHealthFailure.BINARY_NOT_EXECUTABLE:
      return ['Run chmod +x on the CLI binary', 'Reinstall the KB CLI if permissions cannot be fixed'];
    case CliHealthFailure.LOOPBACK_NOT_RUNNING:
    case CliHealthFailure.LOOPBACK_UNREACHABLE:
      return ['Restart the application to re-launch the loopback service', 'Check that no other process is using the loopback port'];
    case CliHealthFailure.LOOPBACK_UNHEALTHY:
      return ['Restart the application', 'Check application logs for service errors'];
    case CliHealthFailure.AUTH_TOKEN_MISSING:
      return ['Restart the application to regenerate the auth token', 'Check workspace configuration'];
    case CliHealthFailure.HEALTH_PROBE_TIMEOUT:
      return ['The service may be overloaded — wait a moment and re-check', 'Restart the application if timeouts persist'];
    case CliHealthFailure.HEALTH_PROBE_FAILED:
    case CliHealthFailure.HEALTH_PROBE_REJECTED:
      return ['Re-check agent health after a few seconds', 'Restart the application if the issue persists'];
    default:
      return [];
  }
}

function providerStatusSummary(health: KbAccessHealth): string {
  if (health.ok) {
    return health.message ?? 'Healthy and ready';
  }
  const failMsg = cliFailureMessage(health.failureCode);
  if (failMsg && health.message && health.message !== failMsg) {
    return `${failMsg} Details: ${health.message}`;
  }
  return failMsg || health.message || 'Unavailable — run a health check for details';
}

function acpTransportSummary(health: KbAccessHealth): { ok: boolean; detail: string } {
  if (health.mode !== 'cli') {
    return { ok: true, detail: 'Not applicable' };
  }
  if (health.acpReachable === true) {
    return {
      ok: true,
      detail: health.baseUrl
        ? `ACP transport reachable via ${health.baseUrl}`
        : 'ACP transport reachable'
    };
  }
  if (health.acpReachable === false) {
    return {
      ok: false,
      detail: 'ACP transport not reachable'
    };
  }
  if (health.ok) {
    return {
      ok: true,
      detail: health.baseUrl ? `Loopback URL: ${health.baseUrl}` : 'Loopback URL not reported'
    };
  }
  return {
    ok: false,
    detail: health.baseUrl ? `Loopback URL: ${health.baseUrl}` : 'No transport status reported'
  };
}

function mcpBridgeSummary(health: KbAccessHealth): { ok: boolean; detail: string } {
  if (health.mode !== 'mcp') {
    return { ok: true, detail: 'Not applicable' };
  }
  if (!health.bridgeConfigPresent) {
    return {
      ok: false,
      detail: 'Bridge configuration is incomplete or missing'
    };
  }
  if (health.bridgeReachable) {
    return {
      ok: true,
      detail: health.bridgeSocketPath
        ? `Bridge reachable via ${health.bridgeSocketPath}`
        : 'Bridge is reachable'
    };
  }
  return {
    ok: false,
    detail: health.bridgeSocketPath
      ? `Bridge not reachable at ${health.bridgeSocketPath}`
      : 'Bridge is not reachable'
  };
}

function mcpToolsetSummary(health: KbAccessHealth): { ok: boolean; detail: string } {
  if (health.mode !== 'mcp') {
    return { ok: true, detail: 'Not applicable' };
  }
  if (health.toolsetReady) {
    return {
      ok: true,
      detail: `${health.registeredToolNames?.length ?? 0} MCP tools registered and verified`
    };
  }
  if (health.bridgeConfigPresent && health.bridgeReachable === false) {
    return {
      ok: false,
      detail: 'Tool availability cannot be verified until the bridge responds'
    };
  }
  if (health.missingToolNames && health.missingToolNames.length > 0) {
    return {
      ok: false,
      detail: `Missing tools: ${health.missingToolNames.join(', ')}`
    };
  }
  return {
    ok: false,
    detail: 'Toolset verification did not complete'
  };
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

function parseSessionUpdatePayload(raw: string): {
  updateType: string | null;
  contentType: string | null;
  contentText: string | null;
  parsed: any;
} | null {
  try {
    const parsed = JSON.parse(raw);
    return {
      updateType: typeof parsed?.update?.sessionUpdate === 'string' ? parsed.update.sessionUpdate : null,
      contentType: typeof parsed?.update?.content?.type === 'string' ? parsed.update.content.type : null,
      contentText: typeof parsed?.update?.content?.text === 'string' ? parsed.update.content.text : null,
      parsed,
    };
  } catch {
    return null;
  }
}

function isHiddenSessionUpdateType(updateType: string | null): boolean {
  return updateType === 'agent_thought_chunk';
}

function shouldDisplayTranscriptLine(line: AgentTranscriptLine): boolean {
  if (line.event !== 'session_update') {
    return true;
  }

  const parsed = parseSessionUpdatePayload(line.payload);
  if (!parsed) {
    return true;
  }

  return !isHiddenSessionUpdateType(parsed.updateType);
}

function shouldDisplayStreamingEvent(evt: AgentStreamingPayload): boolean {
  if (evt.kind !== 'progress' || !evt.data) {
    return true;
  }

  try {
    const parsed = evt.data as { update?: { sessionUpdate?: unknown } };
    const updateType = typeof parsed?.update?.sessionUpdate === 'string' ? parsed.update.sessionUpdate : null;
    return !isHiddenSessionUpdateType(updateType);
  } catch {
    return true;
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

function summarizeAcpToolInput(title: string, rawInput: unknown): string {
  if (!rawInput || typeof rawInput !== 'object') {
    return title;
  }

  const input = rawInput as Record<string, unknown>;
  const candidateString = (
    input.command
    ?? input.cmd
    ?? input.commandLine
    ?? input.filePath
    ?? input.path
    ?? input.uri
    ?? input.target
  );

  if (typeof candidateString === 'string' && candidateString.trim()) {
    return candidateString.trim();
  }

  if (typeof input.args === 'string' && input.args.trim()) {
    return `${title}: ${input.args.trim()}`;
  }

  if (Array.isArray(input.args) && input.args.length > 0) {
    const joined = input.args
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ');
    if (joined) {
      return `${title}: ${joined}`;
    }
  }

  if (typeof input.pattern === 'string' && input.pattern.trim()) {
    return `${title}: ${input.pattern.trim()}`;
  }

  if (typeof input.query === 'string' && input.query.trim()) {
    return `${title}: ${input.query.trim()}`;
  }

  return title;
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

interface LegacyAgentHealthCheckResponse {
  checkedAtUtc: string;
  cursorInstalled: boolean;
  acpReachable: boolean;
  mcpRunning: boolean;
  requiredConfigPresent: boolean;
  cursorBinaryPath?: string;
  issues: string[];
}

function isProviderHealthResponse(
  value: AgentHealthCheckResponse | LegacyAgentHealthCheckResponse | null
): value is AgentHealthCheckResponse {
  return Boolean(value && typeof value === 'object' && 'providers' in value && 'selectedMode' in value);
}

const INITIAL_HEALTH_RETRY_ATTEMPTS = 3;
const INITIAL_HEALTH_RETRY_DELAY_MS = 700;

function shouldRetryInitialHealthCheck(health: AgentHealthCheckResponse | LegacyAgentHealthCheckResponse | null): boolean {
  if (!health) {
    return true;
  }

  if (isProviderHealthResponse(health)) {
    return !health.providers.mcp.ok && !health.providers.cli.ok;
  }

  return !health.cursorInstalled && !health.acpReachable && !health.mcpRunning && !health.requiredConfigPresent;
}

export function HealthStatusPanel({ workspaceId }: HealthStatusPanelProps) {
  const healthQuery = useIpc<AgentHealthCheckResponse | LegacyAgentHealthCheckResponse>('agent.health.check');
  const [lastCheck, setLastCheck] = useState<AgentHealthCheckResponse | LegacyAgentHealthCheckResponse | null>(null);
  const [initialCheckPending, setInitialCheckPending] = useState(true);
  const healthRequestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const runCheck = useCallback(async (withStartupRetries = false) => {
    const requestId = healthRequestIdRef.current + 1;
    healthRequestIdRef.current = requestId;
    if (withStartupRetries && mountedRef.current) {
      setInitialCheckPending(true);
    }

    const maxAttempts = withStartupRetries ? INITIAL_HEALTH_RETRY_ATTEMPTS : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const data = await healthQuery.execute({ workspaceId });
      if (!mountedRef.current || requestId !== healthRequestIdRef.current) {
        return;
      }

      if (data) {
        setLastCheck(data);
        if (withStartupRetries) {
          setInitialCheckPending(false);
        }
      }

      const needsRetry = withStartupRetries
        && attempt < maxAttempts - 1
        && shouldRetryInitialHealthCheck(data);
      if (!needsRetry) {
        break;
      }

      await new Promise((resolve) => window.setTimeout(resolve, INITIAL_HEALTH_RETRY_DELAY_MS));
      if (!mountedRef.current || requestId !== healthRequestIdRef.current) {
        return;
      }
    }

    if (withStartupRetries && mountedRef.current && requestId === healthRequestIdRef.current) {
      setInitialCheckPending(false);
    }
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLastCheck(null);
    void runCheck(true);
  }, [runCheck]);

  const health = lastCheck;
  const providerHealth = health && isProviderHealthResponse(health) ? health : null;
  const legacyHealth = health && !isProviderHealthResponse(health) ? health : null;
  const allGood = providerHealth
    ? providerHealth.availableModes.includes(providerHealth.selectedMode)
    : legacyHealth
      ? legacyHealth.cursorInstalled && legacyHealth.acpReachable && legacyHealth.mcpRunning && legacyHealth.requiredConfigPresent
      : false;

  const activeProvider = providerHealth ? providerHealth.providers[providerHealth.selectedMode] : null;
  const inactiveProviders = providerHealth
    ? KB_ACCESS_MODES
        .filter((mode) => mode !== providerHealth.selectedMode)
        .map((mode) => providerHealth.providers[mode])
    : [];

  return (
    <div className="card agent-health-card" role="region" aria-label="Agent health status">
      <div className="card-header">
        <span className="card-header-title">
          <span style={{ display: 'inline-flex', marginRight: 6 }} aria-hidden="true">
            <IconActivity size={14} />
          </span>
          Agent Health
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {health && (
            <Badge variant={allGood ? 'success' : 'warning'}>
              {allGood ? 'All Systems Go' : 'Attention Needed'}
            </Badge>
          )}
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => void runCheck()}
            disabled={healthQuery.loading}
            title="Re-check health"
            aria-label="Re-check agent health"
          >
            <IconRefreshCw size={14} className={healthQuery.loading ? 'agent-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="card-body" aria-live="polite" aria-atomic="true">
        {(initialCheckPending || (healthQuery.loading && !health)) ? (
          <LoadingState message="Checking agent runtime health..." />
        ) : healthQuery.error && !health ? (
          <ErrorState
            title="Unable to check health"
            description={`The health check could not complete: ${healthQuery.error}. This may be a temporary issue.`}
            action={<button className="btn btn-primary btn-sm" onClick={() => void runCheck()}>Try Again</button>}
          />
        ) : health ? (
          <div className="agent-health-grid">
            {providerHealth ? (
              <>
                <KbAccessModeToggle
                  workspaceId={workspaceId}
                  currentMode={providerHealth.selectedMode}
                  availableModes={providerHealth.availableModes}
                  onModeChanged={runCheck}
                />
                <HealthCheckItem
                  label="Provider Selection"
                  ok
                  detail={`Strict mode: KB Vault will only use ${providerHealth.selectedMode.toUpperCase()} until you switch providers manually.`}
                />
                {activeProvider && (
                  <HealthCheckItem
                    label={`${providerHealth.selectedMode.toUpperCase()} Provider (selected)`}
                    ok={activeProvider.ok}
                    detail={providerStatusSummary(activeProvider)}
                    failureCode={activeProvider.failureCode}
                    recoverySteps={!activeProvider.ok ? cliFailureRecovery(activeProvider.failureCode) : []}
                  />
                )}
                {activeProvider && activeProvider.mode === 'cli' && (
                  <HealthCheckItem
                    label="ACP Transport (selected)"
                    ok={acpTransportSummary(activeProvider).ok}
                    detail={acpTransportSummary(activeProvider).detail}
                    failureCode={acpTransportSummary(activeProvider).ok ? undefined : activeProvider.failureCode}
                    recoverySteps={
                      acpTransportSummary(activeProvider).ok
                        ? []
                        : cliFailureRecovery(activeProvider.failureCode)
                    }
                  />
                )}
                {activeProvider && activeProvider.mode === 'mcp' && (
                  <HealthCheckItem
                    label="MCP Bridge (selected)"
                    ok={mcpBridgeSummary(activeProvider).ok}
                    detail={mcpBridgeSummary(activeProvider).detail}
                  />
                )}
                {activeProvider && activeProvider.mode === 'mcp' && (
                  <HealthCheckItem
                    label="MCP Toolset (selected)"
                    ok={mcpToolsetSummary(activeProvider).ok}
                    detail={mcpToolsetSummary(activeProvider).detail}
                  />
                )}
                {inactiveProviders.map((provider) => (
                  <HealthCheckItem
                    key={`provider-${provider.mode}`}
                    label={`${runtimeBadgeLabel(provider.mode)} Provider (manual switch only)`}
                    ok={provider.ok}
                    detail={providerStatusSummary(provider)}
                    failureCode={provider.failureCode}
                    recoverySteps={[]}
                  />
                ))}
                {inactiveProviders
                  .filter((provider) => provider.mode === 'cli')
                  .map((provider) => (
                    <HealthCheckItem
                      key={`transport-${provider.mode}`}
                      label="ACP Transport (manual switch only)"
                      ok={acpTransportSummary(provider).ok}
                      detail={acpTransportSummary(provider).detail}
                      failureCode={acpTransportSummary(provider).ok ? undefined : provider.failureCode}
                      recoverySteps={[]}
                    />
                  ))}
              </>
            ) : legacyHealth ? (
              <>
                <HealthCheckItem
                  label="Cursor CLI"
                  ok={legacyHealth.cursorInstalled}
                  detail={legacyHealth.cursorBinaryPath ?? 'Not found'}
                />
                <HealthCheckItem
                  label="ACP Reachable"
                  ok={legacyHealth.acpReachable}
                  detail={legacyHealth.acpReachable ? 'Connected' : 'Cannot reach ACP transport'}
                />
                <HealthCheckItem
                  label="MCP Server"
                  ok={legacyHealth.mcpRunning}
                  detail={legacyHealth.mcpRunning ? 'Running' : 'Not running'}
                />
                <HealthCheckItem
                  label="Configuration"
                  ok={legacyHealth.requiredConfigPresent}
                  detail={legacyHealth.requiredConfigPresent ? 'All required config present' : 'Missing required configuration'}
                />
              </>
            ) : null}

            {health.issues.length > 0 && (
              <div className="agent-health-issues" role="alert">
                <div className="agent-health-issues-heading">
                  <span aria-hidden="true"><IconAlertCircle size={12} /></span>
                  <span>{health.issues.length === 1 ? '1 Issue Detected' : `${health.issues.length} Issues Detected`}</span>
                </div>
                {health.issues.map((issue, i) => (
                  <div key={i} className="agent-health-issue-item">{issue}</div>
                ))}
              </div>
            )}

            {health.checkedAtUtc && (
              <div className="agent-health-timestamp" aria-label={`Last health check at ${formatTimestamp(health.checkedAtUtc)}`}>
                Last checked: {formatTimestamp(health.checkedAtUtc)}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ================================================================== */
/* KbAccessModeToggle                                                  */
/* ================================================================== */

interface KbAccessModeToggleProps {
  workspaceId: string;
  currentMode: KbAccessMode;
  availableModes: KbAccessMode[];
  onModeChanged: () => Promise<void> | void;
}

type ModeSwitchPhase = 'idle' | 'confirming' | 'switching' | 'verifying' | 'success' | 'failed';

function KbAccessModeToggle({ workspaceId, currentMode, availableModes, onModeChanged }: KbAccessModeToggleProps) {
  const updateSettings = useIpcMutation<WorkspaceSettingsRecord>('workspace.settings.update');
  const [pendingMode, setPendingMode] = useState<KbAccessMode | null>(null);
  const [switchPhase, setSwitchPhase] = useState<ModeSwitchPhase>('idle');
  const [switchError, setSwitchError] = useState<string | null>(null);

  const modeDescriptions: Record<KbAccessMode, { label: string; helper: string; icon: string }> = {
    direct: {
      label: 'Direct (App-Owned)',
      helper: 'Recommended default. Uses the app-owned direct executor contract for assistant chat, article edit, and batch analysis.',
      icon: 'zap',
    },
    mcp: {
      label: 'MCP (Model Context Protocol)',
      helper: 'Optional advanced mode for MCP-backed KB tools and compatibility workflows. KB Vault will not auto-switch providers.',
      icon: 'server',
    },
    cli: {
      label: 'CLI (Command Line)',
      helper: 'Optional advanced mode for CLI-backed KB access and debugging. KB Vault will use CLI only when you select it.',
      icon: 'terminal',
    },
  };

  const phaseLabel: Record<ModeSwitchPhase, string> = {
    idle: '',
    confirming: 'Confirm mode change',
    switching: 'Saving new mode...',
    verifying: 'Refreshing provider health...',
    success: 'Mode switched successfully',
    failed: 'Mode switch failed',
  };

  const handleSelect = (mode: KbAccessMode) => {
    if (mode === currentMode) return;
    setPendingMode(mode);
    setSwitchPhase('confirming');
    setSwitchError(null);
  };

  const confirmSwitch = async () => {
    if (!pendingMode) return;
    setSwitchPhase('switching');
    setSwitchError(null);
    try {
      await updateSettings.mutate({ workspaceId, kbAccessMode: pendingMode });
      setSwitchPhase('verifying');
      await Promise.resolve(onModeChanged());
      setSwitchPhase('success');
      // Auto-dismiss success after a moment
      setTimeout(() => {
        setSwitchPhase('idle');
        setPendingMode(null);
      }, 1500);
    } catch (err) {
      setSwitchPhase('failed');
      setSwitchError(err instanceof Error ? err.message : 'An unexpected error occurred while switching modes.');
    }
  };

  const cancelSwitch = () => {
    setSwitchPhase('idle');
    setPendingMode(null);
    setSwitchError(null);
  };

  const retrySwitch = () => {
    setSwitchError(null);
    void confirmSwitch();
  };

  const isBusy = switchPhase === 'switching' || switchPhase === 'verifying';

  return (
    <div className="agent-mode-toggle" role="group" aria-label="KB access mode selector">
      <div className="agent-mode-toggle-label" id="mode-toggle-label">
        KB Access Mode
      </div>

      <div className="agent-mode-toggle-buttons" role="radiogroup" aria-labelledby="mode-toggle-label">
        {KB_ACCESS_MODES.map((mode) => {
          const isSelected = mode === currentMode;
          const isAvailable = availableModes.includes(mode);
          return (
            <button
              key={mode}
              className={`btn agent-mode-btn ${isSelected ? 'btn-primary agent-mode-btn--active' : 'btn-secondary'}`}
              role="radio"
              aria-checked={isSelected}
              aria-disabled={isBusy || undefined}
              onClick={() => !isBusy && handleSelect(mode)}
              disabled={isBusy}
              title={modeDescriptions[mode].helper}
            >
              <span className="agent-mode-btn-icon" aria-hidden="true">
                {mode === 'mcp'
                  ? <IconServer size={12} />
                  : mode === 'cli'
                    ? <IconTerminal size={12} />
                    : <IconZap size={12} />}
              </span>
              {mode.toUpperCase()}
              {isSelected && (
                <span className="agent-mode-btn-check" aria-hidden="true">
                  <IconCheckCircle size={12} />
                </span>
              )}
              {!isAvailable && (
                <span className="agent-mode-btn-unavail">(offline)</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="agent-mode-toggle-helper">
        {modeDescriptions[currentMode].helper}
      </div>

      {/* Transition panel — shown during confirm, switching, verifying, success, or failed */}
      {switchPhase !== 'idle' && pendingMode && (
        <div
          className={`agent-mode-switch-panel agent-mode-switch-panel--${switchPhase}`}
          role="alertdialog"
          aria-label={phaseLabel[switchPhase]}
          aria-live="assertive"
        >
          {/* Phase: confirming */}
          {switchPhase === 'confirming' && (
            <>
              <div className="agent-mode-switch-header">
                <span aria-hidden="true"><IconAlertCircle size={14} /></span>
                <span className="agent-mode-switch-title">
                  Switch to {modeDescriptions[pendingMode].label}?
                </span>
              </div>
              <p className="agent-mode-switch-body">
                Future agent sessions will use the {pendingMode.toUpperCase()} provider exactly as selected.
                Any running sessions will keep their current mode until they finish, and KB Vault will not auto-switch providers.
              </p>
              {!availableModes.includes(pendingMode) && (
                <div className="agent-mode-switch-warning" role="alert">
                  <span aria-hidden="true"><IconAlertCircle size={12} /></span>
                  <span>
                    The {pendingMode.toUpperCase()} provider is currently offline.
                    New sessions will fail preflight until it becomes healthy.
                    KB Vault will not auto-switch to the other provider.
                  </span>
                </div>
              )}
              <div className="agent-mode-switch-actions">
                <button className="btn btn-secondary btn-sm" onClick={cancelSwitch}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={confirmSwitch}>
                  Switch to {pendingMode.toUpperCase()}
                </button>
              </div>
            </>
          )}

          {/* Phase: switching / verifying */}
          {(switchPhase === 'switching' || switchPhase === 'verifying') && (
            <div className="agent-mode-switch-progress">
              <div className="spinner" aria-hidden="true" />
              <div className="agent-mode-switch-progress-text">
                <span className="agent-mode-switch-progress-label">
                  {switchPhase === 'switching' ? 'Saving mode preference...' : 'Refreshing provider health...'}
                </span>
                <span className="agent-mode-switch-progress-sub">
                  Switching to {pendingMode.toUpperCase()}
                </span>
              </div>
            </div>
          )}

          {/* Phase: success */}
          {switchPhase === 'success' && (
            <div className="agent-mode-switch-result agent-mode-switch-result--success">
              <span aria-hidden="true"><IconCheckCircle size={16} /></span>
              <span>Switched to {pendingMode.toUpperCase()} mode. New sessions will use this provider only.</span>
            </div>
          )}

          {/* Phase: failed */}
          {switchPhase === 'failed' && (
            <>
              <div className="agent-mode-switch-result agent-mode-switch-result--failed" role="alert">
                <span aria-hidden="true"><IconXCircle size={16} /></span>
                <div>
                  <div className="agent-mode-switch-error-title">Could not switch modes</div>
                  <div className="agent-mode-switch-error-detail">
                    {switchError ?? 'The mode change did not complete. Your previous mode is still active.'}
                  </div>
                </div>
              </div>
              <div className="agent-mode-switch-actions">
                <button className="btn btn-secondary btn-sm" onClick={cancelSwitch}>Dismiss</button>
                <button className="btn btn-primary btn-sm" onClick={retrySwitch}>Try Again</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function HealthCheckItem({ label, ok, detail, failureCode, recoverySteps }: {
  label: string;
  ok: boolean;
  detail: string;
  failureCode?: CliHealthFailure;
  recoverySteps?: string[];
}) {
  return (
    <div className={`agent-health-item ${!ok ? 'agent-health-item--failed' : ''}`} role="status" aria-label={`${label}: ${ok ? 'healthy' : 'unhealthy'}`}>
      <div className="agent-health-item-indicator" aria-hidden="true">
        {ok ? (
          <IconCheckCircle size={16} className="agent-health-ok" />
        ) : (
          <IconXCircle size={16} className="agent-health-fail" />
        )}
      </div>
      <div className="agent-health-item-content">
        <div className="agent-health-item-label">{label}</div>
        <div className="agent-health-item-detail">{detail}</div>
        {!ok && failureCode && (
          <div className="agent-health-item-failure-code">
            Error: {failureCode}
          </div>
        )}
        {recoverySteps && recoverySteps.length > 0 && (
          <div className="agent-health-recovery" role="note" aria-label="Recovery steps">
            <div className="agent-health-recovery-title">How to fix:</div>
            <ol className="agent-health-recovery-steps">
              {recoverySteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        )}
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
          <button className="btn btn-ghost btn-icon" onClick={load} title="Refresh sessions" aria-label="Refresh session list">
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
            description="Sessions are created automatically when you run analysis, chat, or edit an article with AI."
          />
        ) : (
          <div className="agent-session-list">
            {sessions.map((session) => {
              const chipProps = sessionStatusChip(session.status);
              const canCloseSession = !(
                session.type === 'batch_analysis'
                && (session.status === 'running' || session.status === 'starting')
              );
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
                      <Badge variant={sessionTypeBadgeVariant(session.type)}>
                        {sessionTypeLabel(session.type)}
                      </Badge>
                      <ProviderBadge
                        mode={session.kbAccessMode}
                        size="inline"
                        live={session.status === 'running' || session.status === 'starting'}
                      />
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
                    {session.status !== 'closed' && canCloseSession && (
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
  const [activeTab, setActiveTab] = useState<'transcript' | 'kb_tools' | 'acp_tools'>('transcript');
  const transcriptQuery = useIpc<{ workspaceId: string; sessionId: string; lines: AgentTranscriptLine[] }>('agent.transcript.get');
  const toolsQuery = useIpc<AgentToolCallAudit[]>('agent.tool.calls');

  useEffect(() => {
    transcriptQuery.execute({ workspaceId, sessionId: session.id, limit: 200 });
    toolsQuery.execute({ workspaceId, sessionId: session.id });
  }, [workspaceId, session.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (session.kbAccessMode !== 'mcp' && activeTab === 'kb_tools') {
      setActiveTab('transcript');
    }
  }, [activeTab, session.kbAccessMode]);

  const chipProps = sessionStatusChip(session.status);
  const transcriptLines = transcriptQuery.data?.lines ?? [];
  const toolCalls = normalizeToolCalls(toolsQuery.data);
  const acpToolCalls = useMemo(() => extractAcpToolCalls(transcriptLines), [transcriptLines]);

  return (
    <div className="agent-session-detail">
      <div className="agent-session-detail-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          &larr; Sessions
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Badge variant={sessionTypeBadgeVariant(session.type)}>
            {sessionTypeLabel(session.type)}
          </Badge>
          <ProviderBadge
            mode={session.kbAccessMode}
            size="detail"
            expanded
            live={session.status === 'running' || session.status === 'starting'}
          />
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
          <span className="agent-meta-label">Runtime</span>
          <RuntimeIndicator mode={session.kbAccessMode} status={session.status} />
        </div>
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
        {session.kbAccessMode === 'mcp' && (
          <button
            className={`tab-item ${activeTab === 'kb_tools' ? 'active' : ''}`}
            onClick={() => setActiveTab('kb_tools')}
          >
            <IconTool size={12} />
            KB Tools ({toolCalls.length})
          </button>
        )}
        <button
          className={`tab-item ${activeTab === 'acp_tools' ? 'active' : ''}`}
          onClick={() => setActiveTab('acp_tools')}
        >
          <IconTool size={12} />
          ACP Tools ({acpToolCalls.length})
        </button>
      </div>

      <div className="agent-session-detail-body">
        {activeTab === 'transcript' ? (
          <TranscriptView lines={transcriptLines} loading={transcriptQuery.loading} error={transcriptQuery.error} />
        ) : activeTab === 'kb_tools' ? (
          <ToolCallsView calls={toolCalls} loading={toolsQuery.loading} error={toolsQuery.error} mode={session.kbAccessMode} />
        ) : (
          <AcpToolCallsView calls={acpToolCalls} loading={transcriptQuery.loading} error={transcriptQuery.error} />
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
  const mergedLines = useMemo(
    () => mergeTranscriptLines(lines).filter((line) => shouldDisplayTranscriptLine(line)),
    [lines],
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mergedLines.length]);

  if (loading && mergedLines.length === 0) return <LoadingState message="Loading transcript..." />;
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

    const parsedPayload = parseSessionUpdatePayload(line.payload);
    if (!parsedPayload) {
      merged.push(line);
      continue;
    }

    const { parsed, updateType, contentType, contentText } = parsedPayload;
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

    const previousParsedPayload = parseSessionUpdatePayload(previous.payload);
    if (!previousParsedPayload) {
      merged.push(line);
      continue;
    }

    const previousParsed = previousParsedPayload.parsed;
    const previousType = previousParsedPayload.updateType;
    const previousContentType = previousParsedPayload.contentType;
    const previousText = previousParsedPayload.contentText;

    if (previousType !== updateType || previousContentType !== 'text' || previousText === null) {
      merged.push(line);
      continue;
    }

    previousParsed.update.content.text = `${previousText}${contentText}`;
    previous.payload = JSON.stringify(previousParsed);
    previous.atUtc = line.atUtc;
  }

  return merged;
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

function ToolCallsView({
  calls,
  loading,
  error,
  mode,
}: {
  calls: AgentToolCallAudit[];
  loading: boolean;
  error: string | null;
  mode: KbAccessMode;
}) {
  if (loading && calls.length === 0) return <LoadingState message="Loading tool calls..." />;
  if (error) return <ErrorState title="Tool calls unavailable" description={error} />;
  if (calls.length === 0) {
    return (
      <EmptyState
        icon={<IconTool size={32} />}
        title="No tool calls"
        description={
          mode === 'mcp'
            ? 'KB MCP tool calls made by the agent will appear here.'
            : mode === 'cli'
              ? 'CLI runtime does not attach KB MCP tools. Inspect the transcript or ACP tools for `kb` command activity.'
              : 'Direct runtime keeps KB execution app-owned. Inspect the transcript or ACP tools for direct action and continuation details.'
        }
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
  if (loading && calls.length === 0) return <LoadingState message="Loading ACP tool calls..." />;
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
            <code className="agent-tool-call-name">{summarizeAcpToolInput(call.title, call.rawInput)}</code>
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
  workerStageBudgetMinutes?: number;
  startOnOpen?: boolean;
  onComplete?: () => void;
}

export function AnalysisJobRunner({
  workspaceId,
  batchId,
  workerStageBudgetMinutes,
  startOnOpen,
  onComplete,
}: AnalysisJobRunnerProps) {
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
  const [currentRunMode, setCurrentRunMode] = useState<KbAccessMode | null>(null);
  const [currentRunModel, setCurrentRunModel] = useState<string | null>(null);
  const [stickyHistorySessionId, setStickyHistorySessionId] = useState<string | null>(null);
  const [persistedRun, setPersistedRun] = useState<PersistedAgentAnalysisRun | null>(null);
  const [persistedOrchestration, setPersistedOrchestration] = useState<BatchAnalysisSnapshotResponse | null>(null);
  const [persistedInspection, setPersistedInspection] = useState<BatchAnalysisInspectionResponse | null>(null);
  const [persistedRuntimeStatus, setPersistedRuntimeStatus] = useState<BatchAnalysisRuntimeStatus | null>(null);
  const [persistedEventStream, setPersistedEventStream] = useState<BatchAnalysisEventStreamResponse | null>(null);
  const [liveRuntimeStatus, setLiveRuntimeStatus] = useState<BatchAnalysisRuntimeStatus | null>(null);
  const [persistedTranscriptLines, setPersistedTranscriptLines] = useState<AgentTranscriptLine[]>([]);
  const [persistedHistoryLoading, setPersistedHistoryLoading] = useState(false);
  const [persistedHistoryError, setPersistedHistoryError] = useState<string | null>(null);
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

  const refreshPersistedHistory = useCallback(async () => {
    setPersistedHistoryLoading(true);
    setPersistedHistoryError(null);
    try {
      const [response, inspectionResponse, runtimeResponse, eventStreamResponse] = await Promise.all([
        window.kbv.invoke<PersistedAgentAnalysisRunResponse>('agent.analysis.latest', {
          workspaceId,
          batchId,
          limit: 0,
        }) as Promise<RpcResponse<PersistedAgentAnalysisRunResponse>>,
        window.kbv.invoke<BatchAnalysisInspectionResponse>('batch.analysis.inspection.get', {
          workspaceId,
          batchId,
        }) as Promise<RpcResponse<BatchAnalysisInspectionResponse>>,
        window.kbv.invoke<BatchAnalysisRuntimeStatus | null>('batch.analysis.runtime.get', {
          workspaceId,
          batchId,
        }) as Promise<RpcResponse<BatchAnalysisRuntimeStatus | null>>,
        window.kbv.invoke<BatchAnalysisEventStreamResponse>('batch.analysis.events.get', {
          workspaceId,
          batchId,
          limit: 250,
        }) as Promise<RpcResponse<BatchAnalysisEventStreamResponse>>,
      ]);

      if (response.ok && response.data) {
        setPersistedRun(response.data.run);
        setPersistedOrchestration(response.data.orchestration ?? null);
        setPersistedInspection(inspectionResponse.ok ? (inspectionResponse.data ?? null) : null);
        setPersistedRuntimeStatus(runtimeResponse.ok ? (runtimeResponse.data ?? null) : null);
        setPersistedEventStream(eventStreamResponse.ok ? (eventStreamResponse.data ?? null) : null);
        setPersistedTranscriptLines(response.data.lines ?? []);
        return;
      }

      setPersistedRun(null);
      setPersistedOrchestration(null);
      setPersistedInspection(null);
      setPersistedRuntimeStatus(null);
      setPersistedEventStream(null);
      setPersistedTranscriptLines([]);
      setPersistedHistoryError(response.error?.message ?? 'Saved analysis unavailable');
    } catch (err) {
      setPersistedRun(null);
      setPersistedOrchestration(null);
      setPersistedInspection(null);
      setPersistedRuntimeStatus(null);
      setPersistedEventStream(null);
      setPersistedTranscriptLines([]);
      setPersistedHistoryError(err instanceof Error ? err.message : String(err));
    } finally {
      setPersistedHistoryLoading(false);
    }
  }, [batchId, workspaceId]);

  useEffect(() => {
    void refreshSessions();
    void refreshPersistedHistory();

    const handler = (event: { id: string; command: string; state: string; progress: number; message?: string }) => {
      if (event.command !== 'agent.analysis.run') return;
      const metadata = (event as {
        metadata?: {
          batchId?: unknown;
          workspaceId?: unknown;
          kbAccessMode?: unknown;
          agentModelId?: unknown;
          orchestration?: unknown;
        };
      }).metadata;
      const eventBatchId = typeof metadata?.batchId === 'string' ? metadata.batchId : null;
      const eventWorkspaceId = typeof metadata?.workspaceId === 'string' ? metadata.workspaceId : workspaceId;
      const matchesCurrentBatch = eventBatchId === batchId && eventWorkspaceId === workspaceId;
      if (!matchesCurrentBatch && (!jobIdRef.current || event.id !== jobIdRef.current)) return;
      if (matchesCurrentBatch && event.id !== jobIdRef.current) {
        jobIdRef.current = event.id;
        setJobId(event.id);
        terminalStateHandledRef.current = false;
      }
      if (terminalStateHandledRef.current && (event.state === 'SUCCEEDED' || event.state === 'FAILED' || event.state === 'CANCELED')) {
        return;
      }

      const eventMode = parseModeFromUnknown(metadata?.kbAccessMode);
      if (eventMode) {
        setCurrentRunMode(eventMode);
      }
      const eventModel = metadata?.agentModelId;
      if (typeof eventModel === 'string' && eventModel.trim()) {
        setCurrentRunModel(eventModel.trim());
      }
      const orchestration = parseRuntimeStatusFromUnknown(
        metadata?.orchestration
      );
      if (orchestration) {
        setLiveRuntimeStatus(orchestration);
        if (orchestration.agentModelId?.trim()) {
          setCurrentRunModel(orchestration.agentModelId.trim());
        }
        if (orchestration.sessionId?.trim()) {
          setResolvedSessionId(orchestration.sessionId.trim());
        }
      }

      setJobState(event.state);
      setProgress(event.progress);
      let payloadSessionId: string | null = null;

      // Parse streaming payload from message
      if (event.message) {
        try {
          const payload = JSON.parse(event.message) as AgentStreamingPayload;
          if (shouldDisplayStreamingEvent(payload)) {
            setEvents((prev) => [...prev, payload]);
          }
          if (payload.kind === 'session_started' && payload.data && typeof payload.data === 'object') {
            const sessionPayload = (payload.data as { session?: { kbAccessMode?: KbAccessMode } }).session;
            if (isKbAccessMode(sessionPayload?.kbAccessMode)) {
              setCurrentRunMode(sessionPayload.kbAccessMode);
            }
          }
          if (payload.sessionId) {
            payloadSessionId = payload.sessionId;
            setResolvedSessionId(payload.sessionId);
          }
          if (payload.kind === 'progress' && payload.data) {
            const sessionUpdatePayload = JSON.stringify(payload.data);
            const nextLine: AgentTranscriptLine = {
              atUtc: payload.atUtc,
              direction: 'from_agent',
              event: 'session_update',
              payload: sessionUpdatePayload,
            };
            if (shouldDisplayTranscriptLine(nextLine)) {
              setLiveTranscriptLines((prev) => {
                const lastLine = prev[prev.length - 1];
                if (lastLine && lastLine.event === nextLine.event && lastLine.payload === nextLine.payload) {
                  return prev;
                }
                return [...prev, nextLine];
              });
            }
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
        if (payloadSessionId) {
          setStickyHistorySessionId(payloadSessionId);
        }
        setLiveRuntimeStatus(null);
        void refreshSessions();
        void refreshPersistedHistory();
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
  }, [batchId, onComplete, refreshHistory, refreshPersistedHistory, refreshSessions, workspaceId]);

  const latestBatchSession = useMemo(() => {
    const allSessions = sessionListData;
    const batchSessions = allSessions.filter((session) => session.type === 'batch_analysis' && session.batchId === batchId);
    return batchSessions.sort((a, b) => b.updatedAtUtc.localeCompare(a.updatedAtUtc))[0] ?? null;
  }, [batchId, sessionListData]);
  const activeLiveSessionId = resolvedSessionId ?? latestBatchSession?.id ?? null;
  const activeSession = useMemo(
    () => (activeLiveSessionId ? sessionListData.find((session) => session.id === activeLiveSessionId) ?? latestBatchSession : latestBatchSession),
    [activeLiveSessionId, latestBatchSession, sessionListData]
  );
  const hasLiveHistory = liveTranscriptLines.length > 0 || liveToolCalls.length > 0;
  const shouldUseLiveHistory = Boolean(
    activeLiveSessionId
      && activeSession
      && (
        activeSession.status === 'running'
        || activeSession.status === 'starting'
        || (stickyHistorySessionId === activeLiveSessionId && hasLiveHistory)
      )
  );
  const displaySessionId = (shouldUseLiveHistory ? activeLiveSessionId : null) ?? persistedRun?.sessionId ?? persistedRun?.id ?? activeLiveSessionId ?? null;
  const runtimeMode = (shouldUseLiveHistory ? activeSession?.kbAccessMode : null) ?? currentRunMode ?? persistedRun?.kbAccessMode ?? activeSession?.kbAccessMode ?? null;
  const runtimeModel = currentRunModel ?? persistedRun?.agentModelId ?? null;
  const orchestrationIteration = liveRuntimeStatus ?? persistedRuntimeStatus ?? persistedOrchestration?.latestIteration ?? null;
  const inspectionCounts = persistedInspection ? {
    plans: persistedInspection.plans.length,
    reviews: persistedInspection.reviews.length,
    amendments: persistedInspection.amendments.length,
    finalReviews: persistedInspection.finalReviews.length,
    transcriptLinks: persistedInspection.transcriptLinks.length,
    stageEvents: persistedEventStream?.events.length ?? 0,
  } : null;
  const transcriptLines = shouldUseLiveHistory
    ? liveTranscriptLines
    : (persistedTranscriptLines.length > 0 ? persistedTranscriptLines : liveTranscriptLines);
  const toolCalls = shouldUseLiveHistory
    ? liveToolCalls
    : ((persistedRun?.toolCalls?.length ?? 0) > 0 ? (persistedRun?.toolCalls ?? []) : liveToolCalls);
  const historyLoadingState = shouldUseLiveHistory ? historyLoading : persistedHistoryLoading;
  const historyErrorState = shouldUseLiveHistory ? historyError : persistedHistoryError;
  const persistedRawOutput = persistedRun?.rawOutput ?? [];

  useEffect(() => {
    if (latestBatchSession?.id) {
      setResolvedSessionId((current) => current ?? latestBatchSession.id);
    }
  }, [latestBatchSession]);

  useEffect(() => {
    if (runtimeMode !== 'mcp' && historyTab === 'kb_tools') {
      setHistoryTab('transcript');
    }
  }, [historyTab, runtimeMode]);

  useEffect(() => {
    if (!activeLiveSessionId) {
      setLiveTranscriptLines([]);
      setLiveToolCalls([]);
      setStickyHistorySessionId(null);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    void refreshHistory(activeLiveSessionId);
  }, [activeLiveSessionId, refreshHistory]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  const startJob = async () => {
    setError(null);
    setEvents([]);
    setCurrentRunMode(null);
    setCurrentRunModel(null);
    setLiveRuntimeStatus(null);
    setStickyHistorySessionId(null);
    terminalStateHandledRef.current = false;
    setJobState('QUEUED');
    setProgress(0);

    try {
      const response = await window.kbv.startJob('agent.analysis.run', {
        workspaceId,
        batchId,
        workerStageBudgetMinutes,
      });
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
  const acpToolCalls = useMemo(() => extractAcpToolCalls(transcriptLines), [transcriptLines]);
  const visibleTranscriptLines = useMemo(
    () => mergeTranscriptLines(transcriptLines).filter((line) => shouldDisplayTranscriptLine(line)),
    [transcriptLines],
  );
  const visibleEvents = useMemo(
    () => events.filter((evt) => shouldDisplayStreamingEvent(evt)),
    [events],
  );
  const hasHistory = Boolean(activeLiveSessionId || persistedRun);
  const shouldShowStartButton = !isRunning && !(startOnOpen && !hasHistory && !isDone);
  const canCopy =
    visibleTranscriptLines.length > 0
    || toolCalls.length > 0
    || visibleEvents.length > 0
    || persistedRawOutput.length > 0
    || (persistedEventStream?.events.length ?? 0) > 0;

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
    if (activeSession) {
      chunks.push(`Session: ${activeSession.id}`);
      chunks.push(`Status: ${sessionStatusChip(activeSession.status).label}`);
      chunks.push(`Runtime: ${runtimeBadgeLabel(activeSession.kbAccessMode, true)}`);
      if (activeSession.createdAtUtc) {
        chunks.push(`Created: ${formatTimestamp(activeSession.createdAtUtc)}`);
      }
      if (activeSession.updatedAtUtc) {
        chunks.push(`Updated: ${formatTimestamp(activeSession.updatedAtUtc)}`);
      }
      if (runtimeModel) {
        chunks.push(`Model: ${runtimeModel}`);
      }
    } else if (persistedRun) {
      chunks.push(`Saved run: ${persistedRun.id}`);
      if (persistedRun.sessionId) {
        chunks.push(`Session: ${persistedRun.sessionId}`);
      }
      chunks.push(`Status: ${persistedRunStatusChip(persistedRun.status).label}`);
      if (persistedRun.kbAccessMode) {
        chunks.push(`Runtime: ${runtimeBadgeLabel(persistedRun.kbAccessMode, true)}`);
      }
      if (persistedRun.startedAtUtc) {
        chunks.push(`Started: ${formatTimestamp(persistedRun.startedAtUtc)}`);
      }
      if (persistedRun.endedAtUtc) {
        chunks.push(`Ended: ${formatTimestamp(persistedRun.endedAtUtc)}`);
      }
      if (persistedRun.agentModelId) {
        chunks.push(`Model: ${persistedRun.agentModelId}`);
      }
    }
    if (jobState) {
      chunks.push(`Current state: ${jobState}`);
    }
    if (progress > 0) {
      chunks.push(`Progress: ${progress}%`);
    }
    if (orchestrationIteration) {
      chunks.push(`Iteration: ${orchestrationIteration.iteration}`);
      chunks.push(`Stage: ${orchestrationIteration.stage}`);
      chunks.push(`Role: ${orchestrationIteration.role}`);
      chunks.push(`Outstanding discoveries: ${orchestrationIteration.outstandingDiscoveredWorkCount}`);
    }
    if (inspectionCounts) {
      chunks.push(`Plans tracked: ${inspectionCounts.plans}`);
      chunks.push(`Reviews tracked: ${inspectionCounts.reviews}`);
      chunks.push(`Amendments tracked: ${inspectionCounts.amendments}`);
      chunks.push(`Final reviews tracked: ${inspectionCounts.finalReviews}`);
      chunks.push(`Transcript links tracked: ${inspectionCounts.transcriptLinks}`);
      chunks.push(`Stage events tracked: ${inspectionCounts.stageEvents}`);
    }

    chunks.push('');
    chunks.push('Transcript');
    chunks.push('----------');
    if (visibleTranscriptLines.length === 0) {
      chunks.push('No transcript lines');
    } else {
      visibleTranscriptLines.forEach((line) => {
        chunks.push(`[${formatTimestamp(line.atUtc)}] ${line.direction} ${line.event}`);
        chunks.push(formatPayload(line.payload));
      });
    }

    chunks.push('');
    chunks.push('Result Output');
    chunks.push('--------------');
    if (persistedRawOutput.length === 0) {
      chunks.push('No persisted result output');
    } else {
      persistedRawOutput.forEach((line) => {
        chunks.push(line);
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
    if (visibleEvents.length === 0) {
      chunks.push('No events yet');
    } else {
      visibleEvents.forEach((evt) => {
        const suffix = evt.message ? `: ${evt.message}` : '';
        chunks.push(`[${formatTimestamp(evt.atUtc)}] ${evt.kind}${suffix}`);
      });
    }

    chunks.push('');
    chunks.push('Stage Events');
    chunks.push('------------');
    if (!persistedEventStream || persistedEventStream.events.length === 0) {
      chunks.push('No persisted stage events');
    } else {
      persistedEventStream.events.forEach((event) => {
        chunks.push(`[${formatTimestamp(event.createdAtUtc)}] ${event.eventType} ${event.stage} ${event.role}`);
        if (event.summary) {
          chunks.push(`Summary: ${event.summary}`);
        }
        if (event.lastReviewVerdict) {
          chunks.push(`Verdict: ${event.lastReviewVerdict}`);
        }
        if (event.details) {
          chunks.push(formatPayload(JSON.stringify(event.details, null, 2)));
        }
        chunks.push('');
      });
    }

    return chunks.join('\n');
  }, [activeSession, batchId, inspectionCounts, jobState, orchestrationIteration, persistedEventStream, persistedRawOutput, persistedRun, progress, toolCalls, visibleEvents, visibleTranscriptLines]);

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
              <span className="agent-meta-label">Last saved analysis</span>
              <code className="agent-meta-value">{displaySessionId}</code>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {runtimeMode && (
                <ProviderBadge
                  mode={runtimeMode}
                  size="detail"
                  expanded
                  live={activeSession?.status === 'running' || activeSession?.status === 'starting'}
                />
              )}
              <Badge
                variant={
                  activeSession
                    ? (activeSession.status === 'running' || activeSession.status === 'idle' ? 'success' : 'neutral')
                    : persistedRun?.status === 'complete'
                      ? 'success'
                      : persistedRun?.status === 'failed'
                        ? 'danger'
                        : persistedRun?.status === 'canceled'
                          ? 'warning'
                          : 'neutral'
                }
              >
                {activeSession
                  ? sessionStatusChip(activeSession.status).label
                  : persistedRun
                    ? persistedRunStatusChip(persistedRun.status).label
                    : 'Unknown'}
              </Badge>
            </div>
          </div>

          <div className="agent-session-detail-meta">
            {runtimeMode && (
              <div className="agent-meta-pair">
                <span className="agent-meta-label">Runtime</span>
                <RuntimeIndicator
                  mode={runtimeMode}
                  status={activeSession?.status ?? 'idle'}
                />
              </div>
            )}
            {activeSession?.createdAtUtc && (
              <div className="agent-meta-pair">
                <span className="agent-meta-label">Created</span>
                <span className="agent-meta-value">{formatTimestamp(activeSession.createdAtUtc)}</span>
              </div>
            )}
            {!activeSession && persistedRun?.startedAtUtc && (
              <div className="agent-meta-pair">
                <span className="agent-meta-label">Started</span>
                <span className="agent-meta-value">{formatTimestamp(persistedRun.startedAtUtc)}</span>
              </div>
            )}
            {latestBatchSession?.updatedAtUtc && (
              <div className="agent-meta-pair">
                <span className="agent-meta-label">Updated</span>
                <span className="agent-meta-value">{formatTimestamp(latestBatchSession.updatedAtUtc)}</span>
              </div>
            )}
            {runtimeModel && (
              <div className="agent-meta-pair">
                <span className="agent-meta-label">Model</span>
                <span className="agent-meta-value" style={{ fontFamily: 'var(--font-mono)' }}>{runtimeModel}</span>
              </div>
            )}
            {!persistedInspection && orchestrationIteration?.iteration != null && (
              <div className="agent-meta-pair">
                <span className="agent-meta-label">Iteration</span>
                <span className="agent-meta-value">{orchestrationIteration.iteration}</span>
              </div>
            )}
            {!persistedInspection && orchestrationIteration?.stage && (
              <div className="agent-meta-pair">
                <span className="agent-meta-label">Stage</span>
                <span className="agent-meta-value">{orchestrationIteration.stage}</span>
              </div>
            )}
            {!persistedInspection && orchestrationIteration?.role && (
              <div className="agent-meta-pair">
                <span className="agent-meta-label">Role</span>
                <span className="agent-meta-value">{orchestrationIteration.role}</span>
              </div>
            )}
            {!persistedInspection && orchestrationIteration && (
              <div className="agent-meta-pair">
                <span className="agent-meta-label">Discoveries</span>
                <span className="agent-meta-value">{orchestrationIteration.outstandingDiscoveredWorkCount}</span>
              </div>
            )}
            {!persistedInspection && inspectionCounts && (
              <div className="agent-meta-pair">
                <span className="agent-meta-label">Artifacts</span>
                <span className="agent-meta-value">
                  {inspectionCounts.plans} plans, {inspectionCounts.reviews} reviews, {inspectionCounts.finalReviews} finals, {inspectionCounts.stageEvents} stage events
                </span>
              </div>
            )}
            {!activeSession && persistedRun?.endedAtUtc && (
              <div className="agent-meta-pair">
                <span className="agent-meta-label">Ended</span>
                <span className="agent-meta-value">{formatTimestamp(persistedRun.endedAtUtc)}</span>
              </div>
            )}
          </div>

          {/* Multi-stage batch analysis inspector */}
          {persistedInspection && (
            <BatchAnalysisInspector
              inspection={persistedInspection}
              runtimeStatus={liveRuntimeStatus ?? persistedRuntimeStatus}
              eventStream={persistedEventStream}
              isRunning={isRunning}
              onRefresh={refreshPersistedHistory}
            />
          )}

          <div className="tab-bar">
            <button
              className={`tab-item ${historyTab === 'transcript' ? 'active' : ''}`}
              onClick={() => setHistoryTab('transcript')}
            >
              <IconTerminal size={12} />
              Transcript ({transcriptLines.length})
            </button>
            {runtimeMode === 'mcp' && (
              <button
                className={`tab-item ${historyTab === 'kb_tools' ? 'active' : ''}`}
                onClick={() => setHistoryTab('kb_tools')}
              >
                <IconTool size={12} />
                KB Tools ({toolCalls.length})
              </button>
            )}
            <button
              className={`tab-item ${historyTab === 'acp_tools' ? 'active' : ''}`}
              onClick={() => setHistoryTab('acp_tools')}
            >
              <IconTool size={12} />
              ACP Tools ({acpToolCalls.length})
            </button>
          </div>

          <div className="agent-session-detail-body">
            {historyTab === 'transcript' ? (
              <TranscriptView
                lines={transcriptLines}
                loading={historyLoadingState}
                error={historyErrorState}
              />
            ) : historyTab === 'kb_tools' ? (
              <ToolCallsView
                calls={toolCalls}
                loading={historyLoadingState}
                error={historyErrorState}
                mode={runtimeMode ?? 'direct'}
              />
            ) : (
              <AcpToolCallsView
                calls={acpToolCalls}
                loading={historyLoadingState}
                error={historyErrorState}
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
        {shouldShowStartButton && !autoStartPending && !isDone && (
          <button className="btn btn-primary" onClick={startJob}>
            <IconPlay size={14} />
            {hasHistory ? 'Run Again' : 'Run Analysis'}
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
      {visibleEvents.length > 0 && (
        <div className="agent-job-event-log analysis-copyable" ref={scrollRef}>
          {visibleEvents.map((evt, i) => (
            <div key={i} className="agent-job-event">
              <Badge variant={streamingKindBadge(evt.kind)}>
                {evt.kind}
              </Badge>
              <span className="agent-job-event-time">{formatTimestamp(evt.atUtc)}</span>
              {evt.message && <span className="agent-job-event-msg">{evt.message}</span>}
              {evt.kind === 'tool_call' && Boolean(evt.data) && (
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
    <div className="agent-unavailable-banner" role="alert" aria-label="Cursor is not available">
      <div className="agent-unavailable-icon" aria-hidden="true">
        <IconWifiOff size={24} />
      </div>
      <div className="agent-unavailable-content">
        <div className="agent-unavailable-title">Cursor Is Not Available</div>
        <div className="agent-unavailable-desc">
          KB Vault needs Cursor with ACP (Agent Control Protocol) enabled to run AI analysis and editing.
          This is required for both MCP and CLI access modes.
        </div>
        <div className="agent-unavailable-steps" role="list" aria-label="Steps to resolve">
          <div className="agent-unavailable-step" role="listitem">1. Install or update Cursor to the latest version</div>
          <div className="agent-unavailable-step" role="listitem">2. Open Cursor Settings and enable ACP transport</div>
          <div className="agent-unavailable-step" role="listitem">3. Return here and click "Re-check health" above</div>
        </div>
      </div>
    </div>
  );
}
