import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { IconServer, IconTerminal } from './icons';
/* ---------- Config ---------- */
const providerConfig = {
    mcp: {
        label: 'MCP',
        expandedLabel: 'MCP Runtime',
        description: 'Model Context Protocol — structured KB tool access via MCP server',
        cssModifier: 'mcp',
    },
    cli: {
        label: 'CLI',
        expandedLabel: 'CLI Runtime',
        description: 'Command Line — KB access via CLI loopback with terminal capability',
        cssModifier: 'cli',
    },
};
/* ---------- Component ---------- */
export function ProviderBadge({ mode, size = 'inline', expanded = false, live = false, className }) {
    const config = providerConfig[mode];
    const label = expanded ? config.expandedLabel : config.label;
    const iconSize = size === 'detail' ? 14 : size === 'dot' ? 0 : 12;
    if (size === 'dot') {
        return (_jsxs("span", { className: `provider-dot provider-dot--${config.cssModifier} ${className ?? ''}`, title: config.description, children: [_jsx("span", { className: `provider-dot-indicator ${live ? 'provider-dot-indicator--live' : ''}` }), _jsx("span", { className: "provider-dot-label", children: label })] }));
    }
    return (_jsxs("span", { className: `provider-badge provider-badge--${config.cssModifier} provider-badge--${size} ${live ? 'provider-badge--live' : ''} ${className ?? ''}`, title: config.description, children: [_jsx("span", { className: "provider-badge-icon", children: mode === 'mcp' ? _jsx(IconServer, { size: iconSize }) : _jsx(IconTerminal, { size: iconSize }) }), _jsx("span", { className: "provider-badge-label", children: label }), live && _jsx("span", { className: "provider-badge-pulse" })] }));
}
const statusDisplay = {
    starting: { label: 'Starting', color: 'var(--color-warning)' },
    running: { label: 'Running', color: 'var(--color-success)' },
    idle: { label: 'Idle', color: 'var(--color-text-muted)' },
    closed: { label: 'Closed', color: 'var(--gray-400)' },
    error: { label: 'Error', color: 'var(--color-danger)' },
};
export function RuntimeIndicator({ mode, status, duration, className }) {
    const statusInfo = statusDisplay[status] ?? { label: status, color: 'var(--color-text-muted)' };
    const isActive = status === 'running' || status === 'starting';
    return (_jsxs("span", { className: `runtime-indicator ${className ?? ''}`, children: [_jsx(ProviderBadge, { mode: mode, size: "inline", live: isActive }), _jsxs("span", { className: "runtime-indicator-status", style: { color: statusInfo.color }, children: [isActive && _jsx("span", { className: "runtime-indicator-dot", style: { background: statusInfo.color } }), statusInfo.label] }), duration !== undefined && duration > 0 && (_jsx("span", { className: "runtime-indicator-duration", children: formatDurationCompact(duration) }))] }));
}
function formatDurationCompact(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    const secs = Math.floor(ms / 1000);
    if (secs < 60)
        return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins}m ${remSecs}s`;
}
const resultConfig = {
    ok: { label: 'Completed', cssModifier: 'success' },
    error: { label: 'Failed', cssModifier: 'danger' },
    timeout: { label: 'Timed out', cssModifier: 'warning' },
    canceled: { label: 'Canceled', cssModifier: 'warning' },
};
export function RunHistoryBadge({ mode, result, durationMs, className }) {
    const resultInfo = resultConfig[result] ?? { label: result, cssModifier: 'neutral' };
    return (_jsxs("span", { className: `run-history-badge ${className ?? ''}`, children: [_jsx(ProviderBadge, { mode: mode, size: "dot" }), _jsx("span", { className: `run-history-badge-result run-history-badge-result--${resultInfo.cssModifier}`, children: resultInfo.label }), durationMs !== undefined && durationMs > 0 && (_jsx("span", { className: "run-history-badge-duration", children: formatDurationCompact(durationMs) }))] }));
}
