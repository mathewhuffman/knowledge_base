/**
 * ProviderBadge — visual indicator for MCP vs CLI runtime provider.
 *
 * Designed for use in session lists, session details, run history, and
 * batch analysis views. Each provider gets a distinct icon, color, and
 * optional description tooltip so users can immediately identify which
 * runtime powered a given session or run.
 *
 * Variants:
 *   - "inline"  — compact pill for lists and row-level display
 *   - "detail"  — slightly larger with descriptive subtext, for headers
 *   - "dot"     — minimal colored dot + label for dense tables
 */

import type { KbAccessMode } from '@kb-vault/shared-types';
import { IconServer, IconTerminal } from './icons';

/* ---------- Types ---------- */

type ProviderBadgeSize = 'inline' | 'detail' | 'dot';

interface ProviderBadgeProps {
  mode: KbAccessMode;
  size?: ProviderBadgeSize;
  /** Show expanded label like "MCP Runtime" instead of just "MCP" */
  expanded?: boolean;
  /** Show a pulsing dot when the provider is actively running */
  live?: boolean;
  className?: string;
}

/* ---------- Config ---------- */

const providerConfig: Record<KbAccessMode, {
  label: string;
  expandedLabel: string;
  description: string;
  cssModifier: string;
}> = {
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

export function ProviderBadge({ mode, size = 'inline', expanded = false, live = false, className }: ProviderBadgeProps) {
  const config = providerConfig[mode];
  const label = expanded ? config.expandedLabel : config.label;
  const iconSize = size === 'detail' ? 14 : size === 'dot' ? 0 : 12;

  if (size === 'dot') {
    return (
      <span
        className={`provider-dot provider-dot--${config.cssModifier} ${className ?? ''}`}
        title={config.description}
      >
        <span className={`provider-dot-indicator ${live ? 'provider-dot-indicator--live' : ''}`} />
        <span className="provider-dot-label">{label}</span>
      </span>
    );
  }

  return (
    <span
      className={`provider-badge provider-badge--${config.cssModifier} provider-badge--${size} ${live ? 'provider-badge--live' : ''} ${className ?? ''}`}
      title={config.description}
    >
      <span className="provider-badge-icon">
        {mode === 'mcp' ? <IconServer size={iconSize} /> : <IconTerminal size={iconSize} />}
      </span>
      <span className="provider-badge-label">{label}</span>
      {live && <span className="provider-badge-pulse" />}
    </span>
  );
}

/* ---------- RuntimeIndicator — session-level status with provider ---------- */

interface RuntimeIndicatorProps {
  mode: KbAccessMode;
  status: string; // AgentSessionStatus
  duration?: number; // ms
  className?: string;
}

const statusDisplay: Record<string, { label: string; color: string }> = {
  starting: { label: 'Starting', color: 'var(--color-warning)' },
  running: { label: 'Running', color: 'var(--color-success)' },
  idle: { label: 'Idle', color: 'var(--color-text-muted)' },
  closed: { label: 'Closed', color: 'var(--gray-400)' },
  error: { label: 'Error', color: 'var(--color-danger)' },
};

export function RuntimeIndicator({ mode, status, duration, className }: RuntimeIndicatorProps) {
  const statusInfo = statusDisplay[status] ?? { label: status, color: 'var(--color-text-muted)' };
  const isActive = status === 'running' || status === 'starting';

  return (
    <span className={`runtime-indicator ${className ?? ''}`}>
      <ProviderBadge mode={mode} size="inline" live={isActive} />
      <span className="runtime-indicator-status" style={{ color: statusInfo.color }}>
        {isActive && <span className="runtime-indicator-dot" style={{ background: statusInfo.color }} />}
        {statusInfo.label}
      </span>
      {duration !== undefined && duration > 0 && (
        <span className="runtime-indicator-duration">
          {formatDurationCompact(duration)}
        </span>
      )}
    </span>
  );
}

function formatDurationCompact(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

/* ---------- RunHistoryBadge — compact badge for completed runs ---------- */

interface RunHistoryBadgeProps {
  mode: KbAccessMode;
  result: 'ok' | 'error' | 'timeout' | 'canceled';
  durationMs?: number;
  className?: string;
}

const resultConfig: Record<string, { label: string; cssModifier: string }> = {
  ok: { label: 'Completed', cssModifier: 'success' },
  error: { label: 'Failed', cssModifier: 'danger' },
  timeout: { label: 'Timed out', cssModifier: 'warning' },
  canceled: { label: 'Canceled', cssModifier: 'warning' },
};

export function RunHistoryBadge({ mode, result, durationMs, className }: RunHistoryBadgeProps) {
  const resultInfo = resultConfig[result] ?? { label: result, cssModifier: 'neutral' };

  return (
    <span className={`run-history-badge ${className ?? ''}`}>
      <ProviderBadge mode={mode} size="dot" />
      <span className={`run-history-badge-result run-history-badge-result--${resultInfo.cssModifier}`}>
        {resultInfo.label}
      </span>
      {durationMs !== undefined && durationMs > 0 && (
        <span className="run-history-badge-duration">{formatDurationCompact(durationMs)}</span>
      )}
    </span>
  );
}
