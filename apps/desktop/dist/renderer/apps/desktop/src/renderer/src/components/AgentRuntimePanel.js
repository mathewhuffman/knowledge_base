import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { CliHealthFailure, KB_ACCESS_MODES, isKbAccessMode } from '@kb-vault/shared-types';
import { Badge } from './Badge';
import { StatusChip } from './StatusChip';
import { ProviderBadge, RuntimeIndicator } from './ProviderBadge';
import { LoadingState } from './LoadingState';
import { ErrorState } from './ErrorState';
import { EmptyState } from './EmptyState';
import { IconCheckCircle, IconAlertCircle, IconActivity, IconTerminal, IconPlay, IconSquare, IconRefreshCw, IconClock, IconTool, IconXCircle, IconX, IconWifiOff, IconChevronRight, IconZap, IconServer, } from './icons';
import { useIpc, useIpcMutation } from '../hooks/useIpc';
import { BatchAnalysisInspector } from './batch-analysis/BatchAnalysisInspector';
function parseModeFromUnknown(value) {
    return isKbAccessMode(value) ? value : null;
}
function parseRuntimeStatusFromUnknown(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const candidate = value;
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
function formatTimestamp(utc) {
    try {
        return new Date(utc).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    catch {
        return utc;
    }
}
function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    const secs = Math.floor(ms / 1000);
    if (secs < 60)
        return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins}m ${remSecs}s`;
}
function sessionStatusChip(status) {
    switch (status) {
        case 'starting': return { status: 'pending', label: 'Starting' };
        case 'running': return { status: 'active', label: 'Running' };
        case 'idle': return { status: 'live', label: 'Idle' };
        case 'closed': return { status: 'retired', label: 'Closed' };
        case 'error': return { status: 'conflicted', label: 'Error' };
        default: return { status: 'pending', label: status };
    }
}
function persistedRunStatusChip(status) {
    switch (status) {
        case 'running': return { status: 'active', label: 'Running' };
        case 'complete': return { status: 'live', label: 'Complete' };
        case 'failed': return { status: 'conflicted', label: 'Failed' };
        case 'canceled': return { status: 'retired', label: 'Canceled' };
        default: return { status: 'pending', label: status };
    }
}
function sessionTypeLabel(type) {
    if (type === 'batch_analysis') {
        return 'Batch Analysis';
    }
    if (type === 'assistant_chat') {
        return 'Assistant Chat';
    }
    return 'Article Edit';
}
function sessionTypeBadgeVariant(type) {
    return type === 'batch_analysis' ? 'primary' : 'neutral';
}
function runtimeBadgeVariant(mode) {
    return mode === 'cli' ? 'warning' : 'primary';
}
function runtimeBadgeLabel(mode, expanded = false) {
    if (mode === 'mcp') {
        return expanded ? 'MCP Runtime' : 'MCP';
    }
    if (mode === 'cli') {
        return expanded ? 'CLI Runtime' : 'CLI';
    }
    return expanded ? 'Direct Runtime' : 'Direct';
}
/* ---------- Failure copy & recovery guidance ---------- */
function cliFailureMessage(code) {
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
function cliFailureRecovery(code) {
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
function providerStatusSummary(health) {
    if (health.ok) {
        return health.message ?? 'Healthy and ready';
    }
    const failMsg = cliFailureMessage(health.failureCode);
    if (failMsg && health.message && health.message !== failMsg) {
        return `${failMsg} Details: ${health.message}`;
    }
    return failMsg || health.message || 'Unavailable — run a health check for details';
}
function acpTransportSummary(health) {
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
function mcpBridgeSummary(health) {
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
function mcpToolsetSummary(health) {
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
function parseSessionUpdatePayload(raw) {
    try {
        const parsed = JSON.parse(raw);
        return {
            updateType: typeof parsed?.update?.sessionUpdate === 'string' ? parsed.update.sessionUpdate : null,
            contentType: typeof parsed?.update?.content?.type === 'string' ? parsed.update.content.type : null,
            contentText: typeof parsed?.update?.content?.text === 'string' ? parsed.update.content.text : null,
            parsed,
        };
    }
    catch {
        return null;
    }
}
function isHiddenSessionUpdateType(updateType) {
    return updateType === 'agent_thought_chunk';
}
function shouldDisplayTranscriptLine(line) {
    if (line.event !== 'session_update') {
        return true;
    }
    const parsed = parseSessionUpdatePayload(line.payload);
    if (!parsed) {
        return true;
    }
    return !isHiddenSessionUpdateType(parsed.updateType);
}
function normalizeToolCalls(data) {
    if (Array.isArray(data)) {
        return data;
    }
    if (data && typeof data === 'object' && 'toolCalls' in data) {
        const payload = data;
        return Array.isArray(payload.toolCalls) ? payload.toolCalls : [];
    }
    return [];
}
function summarizeAcpToolInput(title, rawInput) {
    if (!rawInput || typeof rawInput !== 'object') {
        return title;
    }
    const input = rawInput;
    const candidateString = (input.command
        ?? input.cmd
        ?? input.commandLine
        ?? input.filePath
        ?? input.path
        ?? input.uri
        ?? input.target);
    if (typeof candidateString === 'string' && candidateString.trim()) {
        return candidateString.trim();
    }
    if (typeof input.args === 'string' && input.args.trim()) {
        return `${title}: ${input.args.trim()}`;
    }
    if (Array.isArray(input.args) && input.args.length > 0) {
        const joined = input.args
            .filter((value) => typeof value === 'string' && value.trim().length > 0)
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
function extractAcpToolCalls(lines) {
    const toolCalls = new Map();
    for (const line of lines) {
        if (line.event !== 'session_update') {
            continue;
        }
        try {
            const parsed = JSON.parse(line.payload);
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
        }
        catch {
            continue;
        }
    }
    return Array.from(toolCalls.values()).sort((a, b) => a.atUtc.localeCompare(b.atUtc));
}
function isProviderHealthResponse(value) {
    return Boolean(value && typeof value === 'object' && 'providers' in value && 'selectedMode' in value);
}
const INITIAL_HEALTH_RETRY_ATTEMPTS = 3;
const INITIAL_HEALTH_RETRY_DELAY_MS = 700;
function shouldRetryInitialHealthCheck(health) {
    if (!health) {
        return true;
    }
    if (isProviderHealthResponse(health)) {
        return !health.providers.mcp.ok && !health.providers.cli.ok;
    }
    return !health.cursorInstalled && !health.acpReachable && !health.mcpRunning && !health.requiredConfigPresent;
}
export function HealthStatusPanel({ workspaceId }) {
    const healthQuery = useIpc('agent.health.check');
    const [lastCheck, setLastCheck] = useState(null);
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
    return (_jsxs("div", { className: "card agent-health-card", role: "region", "aria-label": "Agent health status", children: [_jsxs("div", { className: "card-header", children: [_jsxs("span", { className: "card-header-title", children: [_jsx("span", { style: { display: 'inline-flex', marginRight: 6 }, "aria-hidden": "true", children: _jsx(IconActivity, { size: 14 }) }), "Agent Health"] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }, children: [health && (_jsx(Badge, { variant: allGood ? 'success' : 'warning', children: allGood ? 'All Systems Go' : 'Attention Needed' })), _jsx("button", { className: "btn btn-ghost btn-icon", onClick: () => void runCheck(), disabled: healthQuery.loading, title: "Re-check health", "aria-label": "Re-check agent health", children: _jsx(IconRefreshCw, { size: 14, className: healthQuery.loading ? 'agent-spin' : '' }) })] })] }), _jsx("div", { className: "card-body", "aria-live": "polite", "aria-atomic": "true", children: (initialCheckPending || (healthQuery.loading && !health)) ? (_jsx(LoadingState, { message: "Checking agent runtime health..." })) : healthQuery.error && !health ? (_jsx(ErrorState, { title: "Unable to check health", description: `The health check could not complete: ${healthQuery.error}. This may be a temporary issue.`, action: _jsx("button", { className: "btn btn-primary btn-sm", onClick: () => void runCheck(), children: "Try Again" }) })) : health ? (_jsxs("div", { className: "agent-health-grid", children: [providerHealth ? (_jsxs(_Fragment, { children: [_jsx(KbAccessModeToggle, { workspaceId: workspaceId, currentMode: providerHealth.selectedMode, availableModes: providerHealth.availableModes, onModeChanged: runCheck }), _jsx(HealthCheckItem, { label: "Provider Selection", ok: true, detail: `Strict mode: KB Vault will only use ${providerHealth.selectedMode.toUpperCase()} until you switch providers manually.` }), activeProvider && (_jsx(HealthCheckItem, { label: `${providerHealth.selectedMode.toUpperCase()} Provider (selected)`, ok: activeProvider.ok, detail: providerStatusSummary(activeProvider), failureCode: activeProvider.failureCode, recoverySteps: !activeProvider.ok ? cliFailureRecovery(activeProvider.failureCode) : [] })), activeProvider && activeProvider.mode === 'cli' && (_jsx(HealthCheckItem, { label: "ACP Transport (selected)", ok: acpTransportSummary(activeProvider).ok, detail: acpTransportSummary(activeProvider).detail, failureCode: acpTransportSummary(activeProvider).ok ? undefined : activeProvider.failureCode, recoverySteps: acpTransportSummary(activeProvider).ok
                                        ? []
                                        : cliFailureRecovery(activeProvider.failureCode) })), activeProvider && activeProvider.mode === 'mcp' && (_jsx(HealthCheckItem, { label: "MCP Bridge (selected)", ok: mcpBridgeSummary(activeProvider).ok, detail: mcpBridgeSummary(activeProvider).detail })), activeProvider && activeProvider.mode === 'mcp' && (_jsx(HealthCheckItem, { label: "MCP Toolset (selected)", ok: mcpToolsetSummary(activeProvider).ok, detail: mcpToolsetSummary(activeProvider).detail })), inactiveProviders.map((provider) => (_jsx(HealthCheckItem, { label: `${runtimeBadgeLabel(provider.mode)} Provider (manual switch only)`, ok: provider.ok, detail: providerStatusSummary(provider), failureCode: provider.failureCode, recoverySteps: [] }, `provider-${provider.mode}`))), inactiveProviders
                                    .filter((provider) => provider.mode === 'cli')
                                    .map((provider) => (_jsx(HealthCheckItem, { label: "ACP Transport (manual switch only)", ok: acpTransportSummary(provider).ok, detail: acpTransportSummary(provider).detail, failureCode: acpTransportSummary(provider).ok ? undefined : provider.failureCode, recoverySteps: [] }, `transport-${provider.mode}`)))] })) : legacyHealth ? (_jsxs(_Fragment, { children: [_jsx(HealthCheckItem, { label: "Cursor CLI", ok: legacyHealth.cursorInstalled, detail: legacyHealth.cursorBinaryPath ?? 'Not found' }), _jsx(HealthCheckItem, { label: "ACP Reachable", ok: legacyHealth.acpReachable, detail: legacyHealth.acpReachable ? 'Connected' : 'Cannot reach ACP transport' }), _jsx(HealthCheckItem, { label: "MCP Server", ok: legacyHealth.mcpRunning, detail: legacyHealth.mcpRunning ? 'Running' : 'Not running' }), _jsx(HealthCheckItem, { label: "Configuration", ok: legacyHealth.requiredConfigPresent, detail: legacyHealth.requiredConfigPresent ? 'All required config present' : 'Missing required configuration' })] })) : null, health.issues.length > 0 && (_jsxs("div", { className: "agent-health-issues", role: "alert", children: [_jsxs("div", { className: "agent-health-issues-heading", children: [_jsx("span", { "aria-hidden": "true", children: _jsx(IconAlertCircle, { size: 12 }) }), _jsx("span", { children: health.issues.length === 1 ? '1 Issue Detected' : `${health.issues.length} Issues Detected` })] }), health.issues.map((issue, i) => (_jsx("div", { className: "agent-health-issue-item", children: issue }, i)))] })), health.checkedAtUtc && (_jsxs("div", { className: "agent-health-timestamp", "aria-label": `Last health check at ${formatTimestamp(health.checkedAtUtc)}`, children: ["Last checked: ", formatTimestamp(health.checkedAtUtc)] }))] })) : null })] }));
}
function KbAccessModeToggle({ workspaceId, currentMode, availableModes, onModeChanged }) {
    const updateSettings = useIpcMutation('workspace.settings.update');
    const [pendingMode, setPendingMode] = useState(null);
    const [switchPhase, setSwitchPhase] = useState('idle');
    const [switchError, setSwitchError] = useState(null);
    const modeDescriptions = {
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
    const phaseLabel = {
        idle: '',
        confirming: 'Confirm mode change',
        switching: 'Saving new mode...',
        verifying: 'Refreshing provider health...',
        success: 'Mode switched successfully',
        failed: 'Mode switch failed',
    };
    const handleSelect = (mode) => {
        if (mode === currentMode)
            return;
        setPendingMode(mode);
        setSwitchPhase('confirming');
        setSwitchError(null);
    };
    const confirmSwitch = async () => {
        if (!pendingMode)
            return;
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
        }
        catch (err) {
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
    return (_jsxs("div", { className: "agent-mode-toggle", role: "group", "aria-label": "KB access mode selector", children: [_jsx("div", { className: "agent-mode-toggle-label", id: "mode-toggle-label", children: "KB Access Mode" }), _jsx("div", { className: "agent-mode-toggle-buttons", role: "radiogroup", "aria-labelledby": "mode-toggle-label", children: KB_ACCESS_MODES.map((mode) => {
                    const isSelected = mode === currentMode;
                    const isAvailable = availableModes.includes(mode);
                    return (_jsxs("button", { className: `btn agent-mode-btn ${isSelected ? 'btn-primary agent-mode-btn--active' : 'btn-secondary'}`, role: "radio", "aria-checked": isSelected, "aria-disabled": isBusy || undefined, onClick: () => !isBusy && handleSelect(mode), disabled: isBusy, title: modeDescriptions[mode].helper, children: [_jsx("span", { className: "agent-mode-btn-icon", "aria-hidden": "true", children: mode === 'mcp'
                                    ? _jsx(IconServer, { size: 12 })
                                    : mode === 'cli'
                                        ? _jsx(IconTerminal, { size: 12 })
                                        : _jsx(IconZap, { size: 12 }) }), mode.toUpperCase(), isSelected && (_jsx("span", { className: "agent-mode-btn-check", "aria-hidden": "true", children: _jsx(IconCheckCircle, { size: 12 }) })), !isAvailable && (_jsx("span", { className: "agent-mode-btn-unavail", children: "(offline)" }))] }, mode));
                }) }), _jsx("div", { className: "agent-mode-toggle-helper", children: modeDescriptions[currentMode].helper }), switchPhase !== 'idle' && pendingMode && (_jsxs("div", { className: `agent-mode-switch-panel agent-mode-switch-panel--${switchPhase}`, role: "alertdialog", "aria-label": phaseLabel[switchPhase], "aria-live": "assertive", children: [switchPhase === 'confirming' && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "agent-mode-switch-header", children: [_jsx("span", { "aria-hidden": "true", children: _jsx(IconAlertCircle, { size: 14 }) }), _jsxs("span", { className: "agent-mode-switch-title", children: ["Switch to ", modeDescriptions[pendingMode].label, "?"] })] }), _jsxs("p", { className: "agent-mode-switch-body", children: ["Future agent sessions will use the ", pendingMode.toUpperCase(), " provider exactly as selected. Any running sessions will keep their current mode until they finish, and KB Vault will not auto-switch providers."] }), !availableModes.includes(pendingMode) && (_jsxs("div", { className: "agent-mode-switch-warning", role: "alert", children: [_jsx("span", { "aria-hidden": "true", children: _jsx(IconAlertCircle, { size: 12 }) }), _jsxs("span", { children: ["The ", pendingMode.toUpperCase(), " provider is currently offline. New sessions will fail preflight until it becomes healthy. KB Vault will not auto-switch to the other provider."] })] })), _jsxs("div", { className: "agent-mode-switch-actions", children: [_jsx("button", { className: "btn btn-secondary btn-sm", onClick: cancelSwitch, children: "Cancel" }), _jsxs("button", { className: "btn btn-primary btn-sm", onClick: confirmSwitch, children: ["Switch to ", pendingMode.toUpperCase()] })] })] })), (switchPhase === 'switching' || switchPhase === 'verifying') && (_jsxs("div", { className: "agent-mode-switch-progress", children: [_jsx("div", { className: "spinner", "aria-hidden": "true" }), _jsxs("div", { className: "agent-mode-switch-progress-text", children: [_jsx("span", { className: "agent-mode-switch-progress-label", children: switchPhase === 'switching' ? 'Saving mode preference...' : 'Refreshing provider health...' }), _jsxs("span", { className: "agent-mode-switch-progress-sub", children: ["Switching to ", pendingMode.toUpperCase()] })] })] })), switchPhase === 'success' && (_jsxs("div", { className: "agent-mode-switch-result agent-mode-switch-result--success", children: [_jsx("span", { "aria-hidden": "true", children: _jsx(IconCheckCircle, { size: 16 }) }), _jsxs("span", { children: ["Switched to ", pendingMode.toUpperCase(), " mode. New sessions will use this provider only."] })] })), switchPhase === 'failed' && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "agent-mode-switch-result agent-mode-switch-result--failed", role: "alert", children: [_jsx("span", { "aria-hidden": "true", children: _jsx(IconXCircle, { size: 16 }) }), _jsxs("div", { children: [_jsx("div", { className: "agent-mode-switch-error-title", children: "Could not switch modes" }), _jsx("div", { className: "agent-mode-switch-error-detail", children: switchError ?? 'The mode change did not complete. Your previous mode is still active.' })] })] }), _jsxs("div", { className: "agent-mode-switch-actions", children: [_jsx("button", { className: "btn btn-secondary btn-sm", onClick: cancelSwitch, children: "Dismiss" }), _jsx("button", { className: "btn btn-primary btn-sm", onClick: retrySwitch, children: "Try Again" })] })] }))] }))] }));
}
function HealthCheckItem({ label, ok, detail, failureCode, recoverySteps }) {
    return (_jsxs("div", { className: `agent-health-item ${!ok ? 'agent-health-item--failed' : ''}`, role: "status", "aria-label": `${label}: ${ok ? 'healthy' : 'unhealthy'}`, children: [_jsx("div", { className: "agent-health-item-indicator", "aria-hidden": "true", children: ok ? (_jsx(IconCheckCircle, { size: 16, className: "agent-health-ok" })) : (_jsx(IconXCircle, { size: 16, className: "agent-health-fail" })) }), _jsxs("div", { className: "agent-health-item-content", children: [_jsx("div", { className: "agent-health-item-label", children: label }), _jsx("div", { className: "agent-health-item-detail", children: detail }), !ok && failureCode && (_jsxs("div", { className: "agent-health-item-failure-code", children: ["Error: ", failureCode] })), recoverySteps && recoverySteps.length > 0 && (_jsxs("div", { className: "agent-health-recovery", role: "note", "aria-label": "Recovery steps", children: [_jsx("div", { className: "agent-health-recovery-title", children: "How to fix:" }), _jsx("ol", { className: "agent-health-recovery-steps", children: recoverySteps.map((step, i) => (_jsx("li", { children: step }, i))) })] }))] })] }));
}
export function SessionListPanel({ workspaceId, onSelectSession }) {
    const sessionsQuery = useIpc('agent.session.list');
    const closeMutation = useIpcMutation('agent.session.close');
    const [showClosed, setShowClosed] = useState(false);
    const load = useCallback(() => {
        sessionsQuery.execute({ workspaceId, includeClosed: showClosed });
    }, [workspaceId, showClosed]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        load();
    }, [load]);
    const sessions = useMemo(() => {
        const data = sessionsQuery.data;
        if (!data)
            return [];
        return Array.isArray(data.sessions) ? data.sessions : [];
    }, [sessionsQuery.data]);
    const handleClose = async (sessionId) => {
        await closeMutation.mutate({ workspaceId, sessionId });
        load();
    };
    return (_jsxs("div", { className: "card", children: [_jsxs("div", { className: "card-header", children: [_jsx("span", { className: "card-header-title", children: "Sessions" }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }, children: [_jsxs("label", { className: "agent-toggle-label", children: [_jsx("input", { type: "checkbox", checked: showClosed, onChange: (e) => setShowClosed(e.target.checked) }), _jsx("span", { children: "Show closed" })] }), _jsx("button", { className: "btn btn-ghost btn-icon", onClick: load, title: "Refresh sessions", "aria-label": "Refresh session list", children: _jsx(IconRefreshCw, { size: 14 }) })] })] }), _jsx("div", { className: "card-body", children: sessionsQuery.loading ? (_jsx(LoadingState, { message: "Loading sessions..." })) : sessionsQuery.error ? (_jsx(ErrorState, { title: "Failed to load sessions", description: sessionsQuery.error })) : sessions.length === 0 ? (_jsx(EmptyState, { icon: _jsx(IconZap, { size: 32 }), title: "No sessions", description: "Sessions are created automatically when you run analysis, chat, or edit an article with AI." })) : (_jsx("div", { className: "agent-session-list", children: sessions.map((session) => {
                        const chipProps = sessionStatusChip(session.status);
                        const canCloseSession = !(session.type === 'batch_analysis'
                            && (session.status === 'running' || session.status === 'starting'));
                        return (_jsxs("div", { className: "agent-session-row", onClick: () => onSelectSession?.(session), role: "button", tabIndex: 0, onKeyDown: (e) => { if (e.key === 'Enter')
                                onSelectSession?.(session); }, children: [_jsxs("div", { className: "agent-session-row-main", children: [_jsxs("div", { className: "agent-session-row-type", children: [_jsx(Badge, { variant: sessionTypeBadgeVariant(session.type), children: sessionTypeLabel(session.type) }), _jsx(ProviderBadge, { mode: session.kbAccessMode, size: "inline", live: session.status === 'running' || session.status === 'starting' })] }), _jsx(StatusChip, { status: chipProps.status, label: chipProps.label })] }), _jsxs("div", { className: "agent-session-row-meta", children: [_jsxs("span", { className: "agent-session-row-id", title: session.id, children: [session.id.slice(0, 8), "..."] }), session.batchId && (_jsxs("span", { className: "agent-session-row-tag", children: ["Batch: ", session.batchId.slice(0, 8)] })), _jsxs("span", { className: "agent-session-row-time", children: [_jsx(IconClock, { size: 10 }), formatTimestamp(session.createdAtUtc)] })] }), _jsxs("div", { className: "agent-session-row-actions", children: [session.status !== 'closed' && canCloseSession && (_jsx("button", { className: "btn btn-ghost btn-icon btn-xs", onClick: (e) => { e.stopPropagation(); void handleClose(session.id); }, title: "Close session", children: _jsx(IconX, { size: 12 }) })), _jsx(IconChevronRight, { size: 14, className: "agent-session-row-chevron" })] })] }, session.id));
                    }) })) })] }));
}
export function SessionDetailPanel({ workspaceId, session, onBack }) {
    const [activeTab, setActiveTab] = useState('transcript');
    const transcriptQuery = useIpc('agent.transcript.get');
    const toolsQuery = useIpc('agent.tool.calls');
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
    return (_jsxs("div", { className: "agent-session-detail", children: [_jsxs("div", { className: "agent-session-detail-header", children: [_jsx("button", { className: "btn btn-ghost btn-sm", onClick: onBack, children: "\u2190 Sessions" }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }, children: [_jsx(Badge, { variant: sessionTypeBadgeVariant(session.type), children: sessionTypeLabel(session.type) }), _jsx(ProviderBadge, { mode: session.kbAccessMode, size: "detail", expanded: true, live: session.status === 'running' || session.status === 'starting' }), _jsx(StatusChip, { status: chipProps.status, label: chipProps.label })] })] }), _jsxs("div", { className: "agent-session-detail-meta", children: [_jsxs("div", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Session ID" }), _jsx("code", { className: "agent-meta-value", children: session.id })] }), session.batchId && (_jsxs("div", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Batch" }), _jsx("code", { className: "agent-meta-value", children: session.batchId })] })), session.locale && (_jsxs("div", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Locale" }), _jsx("span", { className: "agent-meta-value", children: session.locale })] })), _jsxs("div", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Runtime" }), _jsx(RuntimeIndicator, { mode: session.kbAccessMode, status: session.status })] }), _jsxs("div", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Created" }), _jsx("span", { className: "agent-meta-value", children: formatTimestamp(session.createdAtUtc) })] })] }), _jsxs("div", { className: "tab-bar", children: [_jsxs("button", { className: `tab-item ${activeTab === 'transcript' ? 'active' : ''}`, onClick: () => setActiveTab('transcript'), children: [_jsx(IconTerminal, { size: 12 }), "Transcript (", transcriptLines.length, ")"] }), session.kbAccessMode === 'mcp' && (_jsxs("button", { className: `tab-item ${activeTab === 'kb_tools' ? 'active' : ''}`, onClick: () => setActiveTab('kb_tools'), children: [_jsx(IconTool, { size: 12 }), "KB Tools (", toolCalls.length, ")"] })), _jsxs("button", { className: `tab-item ${activeTab === 'acp_tools' ? 'active' : ''}`, onClick: () => setActiveTab('acp_tools'), children: [_jsx(IconTool, { size: 12 }), "ACP Tools (", acpToolCalls.length, ")"] })] }), _jsx("div", { className: "agent-session-detail-body", children: activeTab === 'transcript' ? (_jsx(TranscriptView, { lines: transcriptLines, loading: transcriptQuery.loading, error: transcriptQuery.error })) : activeTab === 'kb_tools' ? (_jsx(ToolCallsView, { calls: toolCalls, loading: toolsQuery.loading, error: toolsQuery.error, mode: session.kbAccessMode })) : (_jsx(AcpToolCallsView, { calls: acpToolCalls, loading: transcriptQuery.loading, error: transcriptQuery.error })) })] }));
}
/* ================================================================== */
/* TranscriptView                                                      */
/* ================================================================== */
function TranscriptView({ lines, loading, error, notice, }) {
    const scrollRef = useRef(null);
    const mergedLines = useMemo(() => buildRenderableTranscriptLines(lines), [lines]);
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [mergedLines.length]);
    if (loading && mergedLines.length === 0)
        return _jsx(LoadingState, { message: "Loading transcript..." });
    if (error)
        return _jsx(ErrorState, { title: "Transcript unavailable", description: error });
    if (mergedLines.length === 0) {
        return (_jsx(EmptyState, { icon: _jsx(IconTerminal, { size: 32 }), title: "No transcript yet", description: "Transcript lines will appear once the session processes messages." }));
    }
    return (_jsxs(_Fragment, { children: [notice && (_jsx("div", { className: "agent-transcript-notice", children: notice })), _jsx("div", { className: "agent-transcript analysis-copyable", ref: scrollRef, children: mergedLines.map((line, i) => (_jsxs("div", { className: `agent-transcript-line agent-transcript-line--${line.direction}`, children: [_jsxs("div", { className: "agent-transcript-line-header", children: [_jsx("span", { className: "agent-transcript-line-time", children: formatTimestamp(line.atUtc) }), _jsx(Badge, { variant: line.direction === 'to_agent' ? 'primary' : line.direction === 'from_agent' ? 'success' : 'neutral', children: line.direction === 'to_agent' ? 'To Agent' : line.direction === 'from_agent' ? 'From Agent' : 'System' }), _jsx("span", { className: "agent-transcript-line-event", children: line.event })] }), _jsx("pre", { className: "agent-transcript-line-payload", children: formatPayload(line.payload) })] }, i))) })] }));
}
function mergeTranscriptLines(lines) {
    const merged = [];
    for (const line of lines) {
        if (line.event !== 'session_update') {
            merged.push({ ...line });
            continue;
        }
        const parsedPayload = parseSessionUpdatePayload(line.payload);
        if (!parsedPayload) {
            merged.push({ ...line });
            continue;
        }
        const { parsed, updateType, contentType, contentText } = parsedPayload;
        const mergeable = (updateType === 'agent_thought_chunk' || updateType === 'agent_message_chunk') && contentType === 'text';
        if (!mergeable || !contentText) {
            merged.push({ ...line });
            continue;
        }
        const previous = merged[merged.length - 1];
        if (!previous || previous.direction !== line.direction || previous.event !== 'session_update') {
            merged.push({ ...line });
            continue;
        }
        const previousParsedPayload = parseSessionUpdatePayload(previous.payload);
        if (!previousParsedPayload) {
            merged.push({ ...line });
            continue;
        }
        const previousParsed = previousParsedPayload.parsed;
        const previousType = previousParsedPayload.updateType;
        const previousContentType = previousParsedPayload.contentType;
        const previousText = previousParsedPayload.contentText;
        if (previousType !== updateType || previousContentType !== 'text' || previousText === null) {
            merged.push({ ...line });
            continue;
        }
        previousParsed.update.content.text = `${previousText}${contentText}`;
        previous.payload = JSON.stringify(previousParsed);
        previous.atUtc = line.atUtc;
    }
    return merged;
}
function buildRenderableTranscriptLines(lines) {
    return mergeTranscriptLines(lines).filter((line) => shouldDisplayTranscriptLine(line));
}
function formatPayload(raw) {
    try {
        const parsed = JSON.parse(raw);
        return JSON.stringify(parsed, null, 2);
    }
    catch {
        return raw;
    }
}
/* ================================================================== */
/* ToolCallsView                                                       */
/* ================================================================== */
function ToolCallsView({ calls, loading, error, mode, }) {
    if (loading && calls.length === 0)
        return _jsx(LoadingState, { message: "Loading tool calls..." });
    if (error)
        return _jsx(ErrorState, { title: "Tool calls unavailable", description: error });
    if (calls.length === 0) {
        return (_jsx(EmptyState, { icon: _jsx(IconTool, { size: 32 }), title: "No tool calls", description: mode === 'mcp'
                ? 'KB MCP tool calls made by the agent will appear here.'
                : mode === 'cli'
                    ? 'CLI runtime does not attach KB MCP tools. Inspect the transcript or ACP tools for `kb` command activity.'
                    : 'Direct runtime keeps KB execution app-owned. Inspect the transcript or ACP tools for direct action and continuation details.' }));
    }
    return (_jsx("div", { className: "agent-tool-calls analysis-copyable", children: calls.map((call, i) => (_jsxs("div", { className: `agent-tool-call-item ${call.allowed ? '' : 'agent-tool-call-item--denied'}`, children: [_jsxs("div", { className: "agent-tool-call-header", children: [_jsx("code", { className: "agent-tool-call-name", children: call.toolName }), _jsx(Badge, { variant: call.allowed ? 'success' : 'danger', children: call.allowed ? 'Allowed' : 'Denied' }), _jsx("span", { className: "agent-tool-call-time", children: formatTimestamp(call.calledAtUtc) })] }), call.reason && (_jsx("div", { className: "agent-tool-call-reason", children: call.reason })), _jsx("pre", { className: "agent-tool-call-args", children: formatPayload(typeof call.args === 'string' ? call.args : JSON.stringify(call.args)) })] }, i))) }));
}
function AcpToolCallsView({ calls, loading, error }) {
    if (loading && calls.length === 0)
        return _jsx(LoadingState, { message: "Loading ACP tool calls..." });
    if (error)
        return _jsx(ErrorState, { title: "ACP tool calls unavailable", description: error });
    if (calls.length === 0) {
        return (_jsx(EmptyState, { icon: _jsx(IconTool, { size: 32 }), title: "No ACP tool calls", description: "Cursor-native ACP tool calls will appear here." }));
    }
    return (_jsx("div", { className: "agent-tool-calls analysis-copyable", children: calls.map((call) => (_jsxs("div", { className: "agent-tool-call-item", children: [_jsxs("div", { className: "agent-tool-call-header", children: [_jsx("code", { className: "agent-tool-call-name", children: summarizeAcpToolInput(call.title, call.rawInput) }), _jsx(Badge, { variant: call.status === 'completed' ? 'success' : call.status === 'in_progress' ? 'primary' : 'neutral', children: call.status }), _jsx("span", { className: "agent-tool-call-time", children: formatTimestamp(call.atUtc) })] }), _jsxs("div", { className: "agent-tool-call-reason", children: ["Kind: ", call.kind] }), call.rawInput !== undefined && (_jsx("pre", { className: "agent-tool-call-args", children: formatPayload(JSON.stringify(call.rawInput)) })), call.rawOutput !== undefined && (_jsx("pre", { className: "agent-tool-call-args", children: formatPayload(JSON.stringify(call.rawOutput)) }))] }, call.toolCallId))) }));
}
const LIVE_TRANSCRIPT_RENDER_LIMIT = 300;
export function AnalysisJobRunner({ workspaceId, batchId, workerStageBudgetMinutes, startOnOpen, onComplete, }) {
    const [jobId, setJobId] = useState(null);
    const [jobState, setJobState] = useState('');
    const [progress, setProgress] = useState(0);
    const [canceling, setCanceling] = useState(false);
    const [error, setError] = useState(null);
    const [copyStatus, setCopyStatus] = useState(null);
    const [historyTab, setHistoryTab] = useState('transcript');
    const [sessionListLoading, setSessionListLoading] = useState(false);
    const [autoStartPending, setAutoStartPending] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState(null);
    const [liveTranscriptLines, setLiveTranscriptLines] = useState([]);
    const [liveToolCalls, setLiveToolCalls] = useState([]);
    const [sessionListData, setSessionListData] = useState([]);
    const [resolvedSessionId, setResolvedSessionId] = useState(null);
    const [currentRunMode, setCurrentRunMode] = useState(null);
    const [currentRunModel, setCurrentRunModel] = useState(null);
    const [stickyHistorySessionId, setStickyHistorySessionId] = useState(null);
    const [persistedRun, setPersistedRun] = useState(null);
    const [persistedOrchestration, setPersistedOrchestration] = useState(null);
    const [persistedInspection, setPersistedInspection] = useState(null);
    const [persistedRuntimeStatus, setPersistedRuntimeStatus] = useState(null);
    const [persistedEventStream, setPersistedEventStream] = useState(null);
    const [liveRuntimeStatus, setLiveRuntimeStatus] = useState(null);
    const [persistedTranscriptLines, setPersistedTranscriptLines] = useState([]);
    const [persistedHistoryLoading, setPersistedHistoryLoading] = useState(false);
    const [persistedHistoryError, setPersistedHistoryError] = useState(null);
    const jobIdRef = useRef(null);
    const terminalStateHandledRef = useRef(false);
    const sessionListInFlightRef = useRef(false);
    const autoStartIssuedRef = useRef(false);
    // Subscribe to job events
    const refreshSessions = useCallback(async () => {
        if (sessionListInFlightRef.current) {
            return;
        }
        sessionListInFlightRef.current = true;
        setSessionListLoading(true);
        try {
            const response = await window.kbv.invoke('agent.session.list', {
                workspaceId,
                includeClosed: true,
            });
            if (response.ok && response.data) {
                setSessionListData(Array.isArray(response.data.sessions) ? response.data.sessions : []);
            }
        }
        finally {
            sessionListInFlightRef.current = false;
            setSessionListLoading(false);
        }
    }, [workspaceId]);
    const refreshHistory = useCallback(async (sessionId, silent = false) => {
        if (!silent) {
            setHistoryLoading(true);
        }
        setHistoryError(null);
        try {
            const [transcriptResponse, toolsResponse] = await Promise.all([
                window.kbv.invoke('agent.transcript.get', {
                    workspaceId,
                    sessionId,
                }),
                window.kbv.invoke('agent.tool.calls', {
                    workspaceId,
                    sessionId,
                }),
            ]);
            if (transcriptResponse.ok && transcriptResponse.data) {
                setLiveTranscriptLines(transcriptResponse.data.lines ?? []);
            }
            if (toolsResponse.ok && toolsResponse.data !== undefined) {
                setLiveToolCalls(normalizeToolCalls(toolsResponse.data));
            }
            if (!transcriptResponse.ok) {
                setHistoryError(transcriptResponse.error?.message ?? 'Transcript unavailable');
            }
            else if (!toolsResponse.ok) {
                setHistoryError(toolsResponse.error?.message ?? 'Tool calls unavailable');
            }
        }
        catch (err) {
            setHistoryError(err instanceof Error ? err.message : String(err));
            if (!silent) {
                setLiveTranscriptLines([]);
                setLiveToolCalls([]);
            }
        }
        finally {
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
                window.kbv.invoke('agent.analysis.latest', {
                    workspaceId,
                    batchId,
                    limit: 0,
                }),
                window.kbv.invoke('batch.analysis.inspection.get', {
                    workspaceId,
                    batchId,
                }),
                window.kbv.invoke('batch.analysis.runtime.get', {
                    workspaceId,
                    batchId,
                }),
                window.kbv.invoke('batch.analysis.events.get', {
                    workspaceId,
                    batchId,
                    limit: 250,
                }),
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
        }
        catch (err) {
            setPersistedRun(null);
            setPersistedOrchestration(null);
            setPersistedInspection(null);
            setPersistedRuntimeStatus(null);
            setPersistedEventStream(null);
            setPersistedTranscriptLines([]);
            setPersistedHistoryError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setPersistedHistoryLoading(false);
        }
    }, [batchId, workspaceId]);
    useEffect(() => {
        void refreshSessions();
        void refreshPersistedHistory();
        const handler = (event) => {
            if (event.command !== 'agent.analysis.run')
                return;
            const metadata = event.metadata;
            const eventBatchId = typeof metadata?.batchId === 'string' ? metadata.batchId : null;
            const eventWorkspaceId = typeof metadata?.workspaceId === 'string' ? metadata.workspaceId : workspaceId;
            const matchesCurrentBatch = eventBatchId === batchId && eventWorkspaceId === workspaceId;
            if (!matchesCurrentBatch && (!jobIdRef.current || event.id !== jobIdRef.current))
                return;
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
            const orchestration = parseRuntimeStatusFromUnknown(metadata?.orchestration);
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
            let payloadSessionId = null;
            // Parse streaming payload from message
            if (event.message) {
                try {
                    const payload = JSON.parse(event.message);
                    if (payload.kind === 'session_started' && payload.data && typeof payload.data === 'object') {
                        const sessionPayload = payload.data.session;
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
                        const nextLine = {
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
                }
                catch {
                    // Ignore non-JSON progress payloads in the live panel. They are still persisted in run history.
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
    const activeSession = useMemo(() => (activeLiveSessionId ? sessionListData.find((session) => session.id === activeLiveSessionId) ?? latestBatchSession : latestBatchSession), [activeLiveSessionId, latestBatchSession, sessionListData]);
    const hasLiveHistory = liveTranscriptLines.length > 0 || liveToolCalls.length > 0;
    const shouldUseLiveHistory = Boolean(activeLiveSessionId
        && activeSession
        && (activeSession.status === 'running'
            || activeSession.status === 'starting'
            || (stickyHistorySessionId === activeLiveSessionId && hasLiveHistory)));
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
    const startJob = async () => {
        setError(null);
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
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to start analysis');
            setJobState('');
        }
    };
    const cancelJob = async () => {
        if (!jobId)
            return;
        setCanceling(true);
        try {
            await window.kbv.cancelJob(jobId);
        }
        finally {
            setCanceling(false);
        }
    };
    const isRunning = jobState === 'RUNNING' || jobState === 'QUEUED';
    const isDone = jobState === 'SUCCEEDED' || jobState === 'FAILED' || jobState === 'CANCELED';
    const acpToolCalls = useMemo(() => historyTab === 'acp_tools' ? extractAcpToolCalls(transcriptLines) : [], [historyTab, transcriptLines]);
    const transcriptViewLines = useMemo(() => (shouldUseLiveHistory && historyTab === 'transcript' && transcriptLines.length > LIVE_TRANSCRIPT_RENDER_LIMIT
        ? transcriptLines.slice(-LIVE_TRANSCRIPT_RENDER_LIMIT)
        : transcriptLines), [historyTab, shouldUseLiveHistory, transcriptLines]);
    const liveTranscriptNotice = shouldUseLiveHistory && historyTab === 'transcript' && transcriptLines.length > LIVE_TRANSCRIPT_RENDER_LIMIT
        ? `Showing the most recent ${LIVE_TRANSCRIPT_RENDER_LIMIT} live transcript updates while analysis is running. Older updates remain available after the run completes.`
        : undefined;
    const hasHistory = Boolean(activeLiveSessionId || persistedRun);
    const shouldShowStartButton = !isRunning && !(startOnOpen && !hasHistory && !isDone);
    const canCopy = transcriptLines.length > 0
        || toolCalls.length > 0
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
        const renderableTranscriptLines = buildRenderableTranscriptLines(transcriptLines);
        const chunks = [];
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
        }
        else if (persistedRun) {
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
        if (renderableTranscriptLines.length === 0) {
            chunks.push('No transcript lines');
        }
        else {
            renderableTranscriptLines.forEach((line) => {
                chunks.push(`[${formatTimestamp(line.atUtc)}] ${line.direction} ${line.event}`);
                chunks.push(formatPayload(line.payload));
            });
        }
        chunks.push('');
        chunks.push('Result Output');
        chunks.push('--------------');
        if (persistedRawOutput.length === 0) {
            chunks.push('No persisted result output');
        }
        else {
            persistedRawOutput.forEach((line) => {
                chunks.push(line);
            });
        }
        chunks.push('');
        chunks.push('Tool Calls');
        chunks.push('----------');
        if (toolCalls.length === 0) {
            chunks.push('No tool calls');
        }
        else {
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
        chunks.push('Stage Events');
        chunks.push('------------');
        if (!persistedEventStream || persistedEventStream.events.length === 0) {
            chunks.push('No persisted stage events');
        }
        else {
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
    }, [activeSession, batchId, inspectionCounts, jobState, orchestrationIteration, persistedEventStream, persistedRawOutput, persistedRun, progress, toolCalls, transcriptLines]);
    const copyAnalysisContents = useCallback(() => {
        if (!canCopy) {
            return;
        }
        void navigator.clipboard.writeText(copyText()).then(() => {
            setCopyStatus('Copied');
        }, () => {
            setCopyStatus('Copy failed');
        });
        window.setTimeout(() => setCopyStatus(null), 1500);
    }, [canCopy, copyText]);
    return (_jsxs("div", { className: "agent-job-runner analysis-copyable", children: [hasHistory && (_jsxs("div", { className: "agent-session-detail", children: [_jsxs("div", { className: "agent-session-detail-header", children: [_jsxs("span", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Last saved analysis" }), _jsx("code", { className: "agent-meta-value", children: displaySessionId })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }, children: [runtimeMode && (_jsx(ProviderBadge, { mode: runtimeMode, size: "detail", expanded: true, live: activeSession?.status === 'running' || activeSession?.status === 'starting' })), _jsx(Badge, { variant: activeSession
                                            ? (activeSession.status === 'running' || activeSession.status === 'idle' ? 'success' : 'neutral')
                                            : persistedRun?.status === 'complete'
                                                ? 'success'
                                                : persistedRun?.status === 'failed'
                                                    ? 'danger'
                                                    : persistedRun?.status === 'canceled'
                                                        ? 'warning'
                                                        : 'neutral', children: activeSession
                                            ? sessionStatusChip(activeSession.status).label
                                            : persistedRun
                                                ? persistedRunStatusChip(persistedRun.status).label
                                                : 'Unknown' })] })] }), _jsxs("div", { className: "agent-session-detail-meta", children: [runtimeMode && (_jsxs("div", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Runtime" }), _jsx(RuntimeIndicator, { mode: runtimeMode, status: activeSession?.status ?? 'idle' })] })), activeSession?.createdAtUtc && (_jsxs("div", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Created" }), _jsx("span", { className: "agent-meta-value", children: formatTimestamp(activeSession.createdAtUtc) })] })), !activeSession && persistedRun?.startedAtUtc && (_jsxs("div", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Started" }), _jsx("span", { className: "agent-meta-value", children: formatTimestamp(persistedRun.startedAtUtc) })] })), latestBatchSession?.updatedAtUtc && (_jsxs("div", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Updated" }), _jsx("span", { className: "agent-meta-value", children: formatTimestamp(latestBatchSession.updatedAtUtc) })] })), runtimeModel && (_jsxs("div", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Model" }), _jsx("span", { className: "agent-meta-value", style: { fontFamily: 'var(--font-mono)' }, children: runtimeModel })] })), !persistedInspection && orchestrationIteration?.iteration != null && (_jsxs("div", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Iteration" }), _jsx("span", { className: "agent-meta-value", children: orchestrationIteration.iteration })] })), !persistedInspection && orchestrationIteration?.stage && (_jsxs("div", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Stage" }), _jsx("span", { className: "agent-meta-value", children: orchestrationIteration.stage })] })), !persistedInspection && orchestrationIteration?.role && (_jsxs("div", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Role" }), _jsx("span", { className: "agent-meta-value", children: orchestrationIteration.role })] })), !persistedInspection && orchestrationIteration && (_jsxs("div", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Discoveries" }), _jsx("span", { className: "agent-meta-value", children: orchestrationIteration.outstandingDiscoveredWorkCount })] })), !persistedInspection && inspectionCounts && (_jsxs("div", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Artifacts" }), _jsxs("span", { className: "agent-meta-value", children: [inspectionCounts.plans, " plans, ", inspectionCounts.reviews, " reviews, ", inspectionCounts.finalReviews, " finals, ", inspectionCounts.stageEvents, " stage events"] })] })), !activeSession && persistedRun?.endedAtUtc && (_jsxs("div", { className: "agent-meta-pair", children: [_jsx("span", { className: "agent-meta-label", children: "Ended" }), _jsx("span", { className: "agent-meta-value", children: formatTimestamp(persistedRun.endedAtUtc) })] }))] }), persistedInspection && (_jsx(BatchAnalysisInspector, { inspection: persistedInspection, runtimeStatus: liveRuntimeStatus ?? persistedRuntimeStatus, eventStream: persistedEventStream, isRunning: isRunning, onRefresh: refreshPersistedHistory })), _jsxs("div", { className: "tab-bar", children: [_jsxs("button", { className: `tab-item ${historyTab === 'transcript' ? 'active' : ''}`, onClick: () => setHistoryTab('transcript'), children: [_jsx(IconTerminal, { size: 12 }), "Transcript (", transcriptLines.length, ")"] }), runtimeMode === 'mcp' && (_jsxs("button", { className: `tab-item ${historyTab === 'kb_tools' ? 'active' : ''}`, onClick: () => setHistoryTab('kb_tools'), children: [_jsx(IconTool, { size: 12 }), "KB Tools (", toolCalls.length, ")"] })), _jsxs("button", { className: `tab-item ${historyTab === 'acp_tools' ? 'active' : ''}`, onClick: () => setHistoryTab('acp_tools'), children: [_jsx(IconTool, { size: 12 }), "ACP Tools", historyTab === 'acp_tools' ? ` (${acpToolCalls.length})` : ''] })] }), _jsx("div", { className: "agent-session-detail-body", children: historyTab === 'transcript' ? (_jsx(TranscriptView, { lines: transcriptViewLines, loading: historyLoadingState, error: historyErrorState, notice: liveTranscriptNotice })) : historyTab === 'kb_tools' ? (_jsx(ToolCallsView, { calls: toolCalls, loading: historyLoadingState, error: historyErrorState, mode: runtimeMode ?? 'direct' })) : (_jsx(AcpToolCallsView, { calls: acpToolCalls, loading: historyLoadingState, error: historyErrorState })) })] })), _jsxs("div", { className: "agent-job-copy-row", children: [_jsx("button", { className: "btn btn-ghost btn-sm", onClick: copyAnalysisContents, disabled: !canCopy, children: "Copy analysis contents" }), copyStatus && _jsx("span", { className: "agent-job-copy-status", children: copyStatus })] }), _jsxs("div", { className: "agent-job-runner-controls", children: [shouldShowStartButton && !autoStartPending && !isDone && (_jsxs("button", { className: "btn btn-primary", onClick: startJob, children: [_jsx(IconPlay, { size: 14 }), hasHistory ? 'Run Again' : 'Run Analysis'] })), startOnOpen && !isRunning && !isDone && autoStartPending && (_jsx("span", { className: "agent-job-status", children: "Starting analysis..." })), isRunning && (_jsxs(_Fragment, { children: [_jsx(Badge, { variant: "primary", children: jobState }), _jsxs("button", { className: "btn btn-danger btn-sm", onClick: cancelJob, disabled: canceling, children: [_jsx(IconSquare, { size: 12 }), canceling ? 'Canceling...' : 'Cancel'] })] })), isDone && (_jsxs(_Fragment, { children: [_jsx(Badge, { variant: jobState === 'SUCCEEDED' ? 'success' : jobState === 'CANCELED' ? 'warning' : 'danger', children: jobState }), _jsxs("button", { className: "btn btn-ghost btn-sm", onClick: startJob, children: [_jsx(IconRefreshCw, { size: 12 }), "Run Again"] })] }))] }), error && (_jsxs("div", { className: "agent-job-error", children: [_jsx(IconAlertCircle, { size: 14 }), _jsx("span", { children: error })] }))] }));
}
/* ================================================================== */
/* CursorUnavailableBanner                                             */
/* ================================================================== */
export function CursorUnavailableBanner() {
    return (_jsxs("div", { className: "agent-unavailable-banner", role: "alert", "aria-label": "Cursor is not available", children: [_jsx("div", { className: "agent-unavailable-icon", "aria-hidden": "true", children: _jsx(IconWifiOff, { size: 24 }) }), _jsxs("div", { className: "agent-unavailable-content", children: [_jsx("div", { className: "agent-unavailable-title", children: "Cursor Is Not Available" }), _jsx("div", { className: "agent-unavailable-desc", children: "KB Vault needs Cursor with ACP (Agent Control Protocol) enabled to run AI analysis and editing. This is required for both MCP and CLI access modes." }), _jsxs("div", { className: "agent-unavailable-steps", role: "list", "aria-label": "Steps to resolve", children: [_jsx("div", { className: "agent-unavailable-step", role: "listitem", children: "1. Install or update Cursor to the latest version" }), _jsx("div", { className: "agent-unavailable-step", role: "listitem", children: "2. Open Cursor Settings and enable ACP transport" }), _jsx("div", { className: "agent-unavailable-step", role: "listitem", children: "3. Return here and click \"Re-check health\" above" })] })] })] }));
}
