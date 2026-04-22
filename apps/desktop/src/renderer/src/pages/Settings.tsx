import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  AppUpdateState,
  WorkspaceSettingsRecord,
  RepositoryStructurePayload,
  ZendeskCredentialRecord,
  ZendeskSyncRunRecord,
  ZendeskCategoryRecord,
  ZendeskSectionRecord,
  ZendeskSearchArticleRecord,
  AgentRuntimeOptionsResponse,
  AgentRuntimeModelOption,
} from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { LoadingState } from '../components/LoadingState';
import { HealthStatusPanel, SessionListPanel, SessionDetailPanel } from '../components/AgentRuntimePanel';
import type { AgentSessionRecord } from '@kb-vault/shared-types';
import { IconSettings, IconSearch, IconRefreshCw, IconCheckCircle, IconAlertCircle, IconFolder } from '../components/icons';
import { useAppUpdate } from '../context/AppUpdateContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc, useIpcMutation } from '../hooks/useIpc';
import { isMacPlatform } from '../utils/platform';

const LOCALE_OPTIONS = [
  { value: 'en-us', label: 'English (en-US)' },
  { value: 'es-es', label: 'Spanish (es-ES)' },
  { value: 'fr-fr', label: 'French (fr-FR)' },
  { value: 'de-de', label: 'German (de-DE)' },
  { value: 'pt-br', label: 'Portuguese (pt-BR)' },
  { value: 'ja-jp', label: 'Japanese (ja-JP)' },
];

const ACP_MODEL_OPTIONS: AgentRuntimeModelOption[] = [
  { id: 'composer-2[fast=true]', provider: 'Cursor', name: 'Composer 2', costs: { inputUsdPerMillion: 0.5, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.2, outputUsdPerMillion: 2.5 } },
  { id: 'composer-1.5[]', provider: 'Cursor', name: 'Composer 1.5', costs: { inputUsdPerMillion: 3.5, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.35, outputUsdPerMillion: 17.5 } },
  { id: 'gpt-5.3-codex[reasoning=medium,fast=false]', provider: 'OpenAI', name: 'Codex 5.3', costs: { inputUsdPerMillion: 1.75, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.175, outputUsdPerMillion: 14 } },
  { id: 'gpt-5.4[reasoning=medium,context=272k,fast=false]', provider: 'OpenAI', name: 'GPT-5.4', costs: { inputUsdPerMillion: 2.5, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.25, outputUsdPerMillion: 15 } },
  { id: 'claude-sonnet-4-6[thinking=true,context=200k,effort=medium]', provider: 'Anthropic', name: 'Sonnet 4.6', costs: { inputUsdPerMillion: null, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: null, outputUsdPerMillion: null } },
  { id: 'claude-opus-4-6[thinking=true,context=200k,effort=high,fast=false]', provider: 'Anthropic', name: 'Opus 4.6', costs: { inputUsdPerMillion: null, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: null, outputUsdPerMillion: null } },
  { id: 'claude-opus-4-5[thinking=true]', provider: 'Anthropic', name: 'Opus 4.5', costs: { inputUsdPerMillion: null, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: null, outputUsdPerMillion: null } },
  { id: 'gpt-5.2[reasoning=medium,fast=false]', provider: 'OpenAI', name: 'GPT-5.2', costs: { inputUsdPerMillion: 1.75, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.175, outputUsdPerMillion: 14 } },
  { id: 'gemini-3.1-pro[]', provider: 'Google', name: 'Gemini 3.1 Pro', costs: { inputUsdPerMillion: null, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: null, outputUsdPerMillion: null } },
  { id: 'gpt-5.4-mini[reasoning=medium]', provider: 'OpenAI', name: 'GPT-5.4 Mini', costs: { inputUsdPerMillion: 0.75, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.075, outputUsdPerMillion: 4.5 } },
  { id: 'gpt-5.4-nano[reasoning=medium]', provider: 'OpenAI', name: 'GPT-5.4 Nano', costs: { inputUsdPerMillion: 0.2, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.02, outputUsdPerMillion: 1.25 } },
  { id: 'claude-haiku-4-5[thinking=true]', provider: 'Anthropic', name: 'Haiku 4.5', costs: { inputUsdPerMillion: null, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: null, outputUsdPerMillion: null } },
  { id: 'gpt-5.3-codex-spark[reasoning=medium]', provider: 'OpenAI', name: 'Codex 5.3 Spark', costs: { inputUsdPerMillion: null, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: null, outputUsdPerMillion: null } },
  { id: 'grok-4-20[thinking=true]', provider: 'xAI', name: 'Grok 4.20', costs: { inputUsdPerMillion: 2, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.2, outputUsdPerMillion: 6 } },
  { id: 'claude-sonnet-4-5[thinking=true,context=200k]', provider: 'Anthropic', name: 'Sonnet 4.5', costs: { inputUsdPerMillion: null, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: null, outputUsdPerMillion: null } },
  { id: 'gpt-5.2-codex[reasoning=medium,fast=false]', provider: 'OpenAI', name: 'Codex 5.2', costs: { inputUsdPerMillion: 1.75, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.175, outputUsdPerMillion: 14 } },
  { id: 'gpt-5.1-codex-max[reasoning=medium,fast=false]', provider: 'OpenAI', name: 'Codex 5.1 Max', costs: { inputUsdPerMillion: 1.25, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.125, outputUsdPerMillion: 10 } },
  { id: 'gpt-5.1[reasoning=medium]', provider: 'OpenAI', name: 'GPT-5.1', costs: { inputUsdPerMillion: null, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: null, outputUsdPerMillion: null } },
  { id: 'gemini-3-pro[]', provider: 'Google', name: 'Gemini 3 Pro', costs: { inputUsdPerMillion: null, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: null, outputUsdPerMillion: null } },
  { id: 'gemini-3-flash[]', provider: 'Google', name: 'Gemini 3 Flash', costs: { inputUsdPerMillion: null, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: null, outputUsdPerMillion: null } },
  { id: 'gpt-5.1-codex-mini[reasoning=medium]', provider: 'OpenAI', name: 'Codex 5.1 Mini', costs: { inputUsdPerMillion: 0.25, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.025, outputUsdPerMillion: 2 } },
  { id: 'claude-sonnet-4[thinking=false,context=200k]', provider: 'Anthropic', name: 'Sonnet 4', costs: { inputUsdPerMillion: null, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: null, outputUsdPerMillion: null } },
  { id: 'gpt-5-mini[]', provider: 'OpenAI', name: 'GPT-5 Mini', costs: { inputUsdPerMillion: 0.25, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.025, outputUsdPerMillion: 2 } },
  { id: 'gemini-2.5-flash[]', provider: 'Google', name: 'Gemini 2.5 Flash', costs: { inputUsdPerMillion: null, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: null, outputUsdPerMillion: null } },
  { id: 'kimi-k2.5[]', provider: 'Moonshot', name: 'Kimi K2.5', costs: { inputUsdPerMillion: 0.6, cacheWriteUsdPerMillion: null, cacheReadUsdPerMillion: 0.1, outputUsdPerMillion: 3 } },
];

/* ------------------------------------------------------------------ */
/* Connection test result type                                         */
/* ------------------------------------------------------------------ */
interface ConnectionTestResult {
  ok: boolean;
  status: number;
  workspaceId: string;
  checkedAtUtc: string;
}

type ConnectionTestState = 'idle' | 'testing' | 'success' | 'failed';

/* ------------------------------------------------------------------ */
/* Sync state helpers                                                  */
/* ------------------------------------------------------------------ */
type SyncJobState = '' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';

function syncStateBadgeVariant(state: SyncJobState): 'primary' | 'success' | 'danger' | 'warning' | 'neutral' {
  switch (state) {
    case 'QUEUED': return 'warning';
    case 'RUNNING': return 'primary';
    case 'SUCCEEDED': return 'success';
    case 'FAILED': return 'danger';
    case 'CANCELED': return 'neutral';
    default: return 'neutral';
  }
}

function isUpToDateSyncMessage(message?: string | null): boolean {
  if (!message) {
    return false;
  }

  const normalized = message.trim().toLowerCase();
  return normalized === 'article family update requires at least one field';
}

function formatRelativeTime(utc: string): string {
  const diff = Date.now() - new Date(utc).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function appUpdateBadgeVariant(state: AppUpdateState | null): 'neutral' | 'primary' | 'success' | 'warning' | 'danger' {
  if (state?.errorMessage && state.status === 'available') {
    return 'warning';
  }

  switch (state?.status) {
    case 'checking':
    case 'downloading':
      return 'primary';
    case 'downloaded':
      return 'success';
    case 'available':
      return 'warning';
    case 'error':
      return 'danger';
    case 'not_available':
      return 'success';
    default:
      return 'neutral';
  }
}

function appUpdateBadgeLabel(state: AppUpdateState | null): string {
  if (state?.errorMessage && state.status === 'available') {
    return 'Needs attention';
  }

  switch (state?.status) {
    case 'checking':
      return 'Checking';
    case 'available':
      return 'Update available';
    case 'not_available':
      return 'Up to date';
    case 'downloading':
      return 'Downloading';
    case 'downloaded':
      return 'Ready to install';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

/* ================================================================== */
/* ZendeskCredentialSection                                            */
/* ================================================================== */
function ZendeskCredentialSection({
  workspaceId,
  subdomain,
  credential,
  credentialLoading,
  onCredentialsSaved,
}: {
  workspaceId: string;
  subdomain: string | undefined;
  credential: ZendeskCredentialRecord | null;
  credentialLoading: boolean;
  onCredentialsSaved: () => void;
}) {
  const saveMutation = useIpcMutation<ZendeskCredentialRecord>('zendesk.credentials.save');
  const [email, setEmail] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setEmail(credential?.email ?? '');
    setApiToken('');
  }, [credential]);

  const handleSave = async () => {
    setSaveSuccess(false);
    const result = await saveMutation.mutate({ workspaceId, email, apiToken });
    if (result) {
      setSaveSuccess(true);
      setApiToken('');
      onCredentialsSaved();
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
      <div className="card-header">
        <span className="card-header-title">Credentials</span>
        <StatusChip
          status={credential ? 'active' : 'pending'}
          label={credentialLoading ? 'Loading...' : credential ? 'Configured' : 'Not configured'}
        />
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div>
          <label className="settings-label">Subdomain</label>
          <div className="settings-value-readonly">
            {subdomain ? `${subdomain}.zendesk.com` : 'Not configured — set in workspace creation'}
          </div>
        </div>

        <div>
          <label className="settings-label">Email</label>
          <input
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your-email@company.com"
          />
        </div>

        <div>
          <label className="settings-label">API Token</label>
          <input
            className="input"
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder={credential?.hasApiToken ? 'Token saved — enter new value to update' : 'Zendesk API token'}
          />
          <div className="settings-hint">Stored securely in your OS keychain via Electron safeStorage</div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saveMutation.loading || !email.trim() || !apiToken.trim()}
          >
            {saveMutation.loading ? 'Saving...' : 'Save Credentials'}
          </button>
          {saveSuccess && (
            <span className="settings-inline-success">
              <IconCheckCircle size={14} /> Saved
            </span>
          )}
          {saveMutation.error && (
            <span className="settings-inline-error">{saveMutation.error}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* ZendeskConnectionTestSection                                        */
/* ================================================================== */
function ZendeskConnectionTestSection({ workspaceId }: { workspaceId: string }) {
  const testMutation = useIpcMutation<ConnectionTestResult>('zendesk.connection.test');
  const [testState, setTestState] = useState<ConnectionTestState>('idle');
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const handleTest = async () => {
    setTestState('testing');
    setTestResult(null);
    const result = await testMutation.mutate({ workspaceId });
    if (result) {
      setTestResult(result);
      setTestState(result.ok ? 'success' : 'failed');
    } else {
      setTestState('failed');
    }
  };

  return (
    <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
      <div className="card-header">
        <span className="card-header-title">Connection Test</span>
        {testState === 'success' && <Badge variant="success">Connected</Badge>}
        {testState === 'failed' && <Badge variant="danger">Failed</Badge>}
      </div>
      <div className="card-body">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button
            className="btn btn-secondary"
            onClick={handleTest}
            disabled={testState === 'testing'}
          >
            {testState === 'testing' ? (
              <>
                <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                Testing...
              </>
            ) : (
              'Test Connection'
            )}
          </button>

          {testState === 'success' && testResult && (
            <div className="settings-test-result settings-test-result--success">
              <IconCheckCircle size={16} />
              <div>
                <div style={{ fontWeight: 'var(--weight-medium)' }}>Connection successful</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                  HTTP {testResult.status} at {new Date(testResult.checkedAtUtc).toLocaleTimeString()}
                </div>
              </div>
            </div>
          )}

          {testState === 'failed' && (
            <div className="settings-test-result settings-test-result--failed">
              <IconAlertCircle size={16} />
              <div>
                <div style={{ fontWeight: 'var(--weight-medium)' }}>Connection failed</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                  {testMutation.error
                    ? testMutation.error
                    : testResult
                      ? `HTTP ${testResult.status} — check credentials and subdomain`
                      : 'Unable to reach Zendesk API'}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* ZendeskSyncSection                                                  */
/* ================================================================== */
function ZendeskSyncSection({ workspaceId }: { workspaceId: string }) {
  const latestSyncQuery = useIpc<ZendeskSyncRunRecord | null>('zendesk.sync.getLatest');

  const [syncMode, setSyncMode] = useState<'full' | 'incremental'>('full');
  const [syncJobId, setSyncJobId] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncState, setSyncState] = useState<SyncJobState>('');
  const [syncCanceling, setSyncCanceling] = useState(false);

  const syncJobIdRef = useRef<string | null>(null);
  const { execute: executeLatestSync } = latestSyncQuery;

  useEffect(() => {
    executeLatestSync({ workspaceId });
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Job event listener
  useEffect(() => {
    const handler = (event: { id: string; command: string; state: string; progress: number; message?: string }) => {
      if (event.command !== 'zendesk.sync.run') return;
      if (syncJobIdRef.current && event.id !== syncJobIdRef.current) return;

      const st = event.state as SyncJobState;
      setSyncState(st);
      setSyncProgress(event.progress);
      setSyncMessage(event.message ?? '');

      if (st === 'SUCCEEDED' || st === 'FAILED' || st === 'CANCELED') {
        executeLatestSync({ workspaceId });
      }
    };
    const unsubscribe = window.kbv.emitJobEvents(handler);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [executeLatestSync, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunSync = async () => {
    const response = await window.kbv.startJob('zendesk.sync.run', { workspaceId, mode: syncMode });
    if (response.jobId) {
      setSyncJobId(response.jobId);
      syncJobIdRef.current = response.jobId;
      setSyncState('QUEUED');
      setSyncProgress(0);
      setSyncMessage(`Queued ${syncMode} sync...`);
    }
  };

  const handleCancelSync = async () => {
    if (!syncJobId) return;
    setSyncCanceling(true);
    try {
      const response = await window.kbv.cancelJob(syncJobId);
      if (response?.state === 'CANCELED') {
        setSyncState('CANCELED');
        setSyncMessage('Sync canceled.');
      }
    } finally {
      setSyncCanceling(false);
    }
  };

  const isRunning = syncState === 'RUNNING' || syncState === 'QUEUED';
  const latestSync = latestSyncQuery.data;
  const currentSyncIsUpToDate = isUpToDateSyncMessage(syncMessage);
  const latestSyncIsUpToDate = isUpToDateSyncMessage(latestSync?.remoteError);
  const latestSyncBadgeVariant = latestSyncIsUpToDate
    ? 'success'
    : syncStateBadgeVariant((latestSync?.state as SyncJobState) ?? '');
  const latestSyncBadgeLabel = latestSyncIsUpToDate ? 'UP TO DATE' : latestSync?.state;

  return (
    <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
      <div className="card-header">
        <span className="card-header-title">Sync</span>
        {latestSync && (
          <Badge variant={latestSyncBadgeVariant}>
            {latestSyncBadgeLabel}
          </Badge>
        )}
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <select
            className="select"
            style={{ width: 'auto', minWidth: 140 }}
            value={syncMode}
            onChange={(e) => setSyncMode(e.target.value as 'full' | 'incremental')}
            disabled={isRunning}
          >
            <option value="full">Full Sync</option>
            <option value="incremental">Incremental Sync</option>
          </select>
          <button className="btn btn-primary" onClick={handleRunSync} disabled={isRunning}>
            <IconRefreshCw size={14} />
            {isRunning ? 'Syncing...' : 'Run Sync'}
          </button>
          {isRunning && (
            <button className="btn btn-danger btn-sm" onClick={handleCancelSync} disabled={syncCanceling}>
              {syncCanceling ? 'Canceling...' : 'Cancel'}
            </button>
          )}
        </div>

        {/* Progress bar — visible when a sync is active */}
        {syncState && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                {currentSyncIsUpToDate ? 'You’re up to date' : (syncMessage || syncState)}
              </span>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)' }}>
                {syncProgress}%
              </span>
            </div>
            <div className="progress-bar" style={{ height: 6 }}>
              <div
                className="progress-bar-fill"
                style={{
                  width: `${syncProgress}%`,
                  background: currentSyncIsUpToDate
                    ? 'var(--color-success)'
                    : syncState === 'FAILED' || syncState === 'CANCELED'
                    ? 'var(--color-danger)'
                    : syncState === 'SUCCEEDED'
                      ? 'var(--color-success)'
                      : undefined,
                }}
              />
            </div>
            {currentSyncIsUpToDate ? (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', marginTop: 'var(--space-1)' }}>
                No article family changes were needed for this sync.
              </div>
            ) : (
              (syncState === 'FAILED' || syncState === 'CANCELED') && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-danger)', marginTop: 'var(--space-1)' }}>
                  {syncState === 'FAILED' ? 'Sync failed — check credentials and network connection' : 'Sync was canceled'}
                </div>
              )
            )}
          </div>
        )}

        {/* Latest sync summary */}
        {latestSync ? (
          <div className="panel" style={{ padding: 'var(--space-3)' }}>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 'var(--space-2)' }}>
              Last Sync
            </div>
            <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
              <SyncStat label="Articles" value={latestSync.syncedArticles} />
              <SyncStat label="Skipped" value={latestSync.skippedArticles} />
              <SyncStat label="Families" value={latestSync.createdFamilies} />
              <SyncStat label="Variants" value={latestSync.createdVariants} />
              <SyncStat label="Revisions" value={latestSync.createdRevisions} />
              <SyncStat
                label="Mode"
                value={latestSync.mode}
                isText
              />
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              {latestSync.startedAtUtc && <span>Started {formatRelativeTime(latestSync.startedAtUtc)}</span>}
              {latestSync.endedAtUtc && <span>Completed {formatRelativeTime(latestSync.endedAtUtc)}</span>}
            </div>
            {latestSync.cursorSummary && Object.keys(latestSync.cursorSummary).length > 0 && (
              <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                Locale cursors: {Object.entries(latestSync.cursorSummary).map(([loc, cur]) => `${loc}:${cur}`).join(', ')}
              </div>
            )}
            {latestSync.remoteError && (
              latestSyncIsUpToDate ? (
                <div
                  style={{
                    marginTop: 'var(--space-2)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(34, 197, 94, 0.10)',
                    border: '1px solid rgba(34, 197, 94, 0.35)',
                    color: 'var(--color-text)'
                  }}
                >
                  <IconCheckCircle size={14} />
                  <div>
                    <div style={{ fontWeight: 'var(--weight-medium)' }}>You&apos;re up to date</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                      No article family changes were needed for this sync.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="settings-error-banner" style={{ marginTop: 'var(--space-2)' }}>
                  <IconAlertCircle size={14} />
                  <div>
                    <div style={{ fontWeight: 'var(--weight-medium)' }}>Remote error</div>
                    <div>{latestSync.remoteError}</div>
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', padding: 'var(--space-3)' }}>
            No sync history yet. Run a full sync to pull your Zendesk content.
          </div>
        )}
      </div>
    </div>
  );
}

function SyncStat({ label, value, isText }: { label: string; value: number | string; isText?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>{label}</div>
      <div style={{ fontSize: isText ? 'var(--text-sm)' : 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', textTransform: isText ? 'capitalize' : undefined }}>
        {value}
      </div>
    </div>
  );
}

/* ================================================================== */
/* ZendeskTaxonomyBrowser                                              */
/* ================================================================== */
function ZendeskTaxonomyBrowser({ workspaceId }: { workspaceId: string }) {
  const categoriesQuery = useIpc<ZendeskCategoryRecord[]>('zendesk.categories.list');
  const sectionsQuery = useIpc<ZendeskSectionRecord[]>('zendesk.sections.list');
  const searchQuery = useIpc<ZendeskSearchArticleRecord[]>('zendesk.articles.search');

  const [locale, setLocale] = useState('en-us');
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState('');
  const [activeTab, setActiveTab] = useState<'browse' | 'search'>('browse');

  const loadCategories = useCallback(() => {
    categoriesQuery.execute({ workspaceId, locale });
  }, [workspaceId, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    if (selectedCategoryId !== null) {
      sectionsQuery.execute({ workspaceId, locale, categoryId: selectedCategoryId });
    }
  }, [selectedCategoryId, workspaceId, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search debounce
  useEffect(() => {
    if (activeTab !== 'search' || searchText.trim().length < 2) return;
    const timer = setTimeout(() => {
      searchQuery.execute({ workspaceId, locale, query: searchText.trim() });
    }, 400);
    return () => clearTimeout(timer);
  }, [searchText, workspaceId, locale, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
      <div className="card-header">
        <span className="card-header-title">Zendesk Content Browser</span>
        <select
          className="select"
          style={{ width: 'auto', minWidth: 120, padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-xs)' }}
          value={locale}
          onChange={(e) => {
            setLocale(e.target.value);
            setSelectedCategoryId(null);
          }}
        >
          {LOCALE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Tab bar */}
      <div className="tab-bar">
        <button
          className={`tab-item ${activeTab === 'browse' ? 'active' : ''}`}
          onClick={() => setActiveTab('browse')}
        >
          Browse
        </button>
        <button
          className={`tab-item ${activeTab === 'search' ? 'active' : ''}`}
          onClick={() => setActiveTab('search')}
        >
          Search Articles
        </button>
      </div>

      <div className="card-body">
        {activeTab === 'browse' ? (
          <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
            {/* Categories list */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="settings-section-label">Categories</div>
              {categoriesQuery.loading ? (
                <div style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                </div>
              ) : categoriesQuery.error ? (
                <div className="settings-inline-error" style={{ padding: 'var(--space-2)' }}>
                  {categoriesQuery.error}
                </div>
              ) : !categoriesQuery.data || categoriesQuery.data.length === 0 ? (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', padding: 'var(--space-2)' }}>
                  No categories found. Run a sync first.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {categoriesQuery.data.map((cat) => (
                    <button
                      key={cat.id}
                      className={`btn ${selectedCategoryId === cat.id ? 'btn-secondary' : 'btn-ghost'} btn-sm`}
                      style={{ justifyContent: 'flex-start', width: '100%' }}
                      onClick={() => setSelectedCategoryId(cat.id)}
                    >
                      <IconFolder size={12} />
                      <span style={{ flex: 1, textAlign: 'left' }}>{cat.name}</span>
                      {cat.position !== undefined && (
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>#{cat.position}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Sections list */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="settings-section-label">Sections</div>
              {selectedCategoryId === null ? (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', padding: 'var(--space-2)' }}>
                  Select a category to view sections
                </div>
              ) : sectionsQuery.loading ? (
                <div style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                </div>
              ) : sectionsQuery.error ? (
                <div className="settings-inline-error" style={{ padding: 'var(--space-2)' }}>
                  {sectionsQuery.error}
                </div>
              ) : !sectionsQuery.data || sectionsQuery.data.length === 0 ? (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', padding: 'var(--space-2)' }}>
                  No sections in this category
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {sectionsQuery.data.map((sec) => (
                    <div
                      key={sec.id}
                      className="btn btn-ghost btn-sm"
                      style={{ justifyContent: 'flex-start', width: '100%', cursor: 'default' }}
                    >
                      <span style={{ flex: 1, textAlign: 'left' }}>{sec.name}</span>
                      {sec.position !== undefined && (
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>#{sec.position}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Search tab */
          <div>
            <div style={{ position: 'relative', marginBottom: 'var(--space-3)' }}>
              <input
                className="input"
                placeholder="Search Zendesk articles..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                style={{ paddingLeft: 32 }}
              />
              <IconSearch
                size={14}
                className=""
              />
            </div>

            {searchText.trim().length < 2 ? (
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', padding: 'var(--space-4)' }}>
                Type at least 2 characters to search
              </div>
            ) : searchQuery.loading ? (
              <div style={{ padding: 'var(--space-4)', textAlign: 'center' }}>
                <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
              </div>
            ) : searchQuery.error ? (
              <div className="settings-inline-error" style={{ padding: 'var(--space-2)' }}>
                {searchQuery.error}
              </div>
            ) : !searchQuery.data || searchQuery.data.length === 0 ? (
              <EmptyState
                icon={<IconSearch size={32} />}
                title="No results"
                description={`No articles matching "${searchText}" in ${locale}`}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)' }}>
                  {searchQuery.data.length} result{searchQuery.data.length !== 1 ? 's' : ''}
                </div>
                {searchQuery.data.map((article) => (
                  <div
                    key={article.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      padding: 'var(--space-2) var(--space-3)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--text-sm)',
                      background: 'var(--color-bg-subtle)',
                    }}
                  >
                    <span style={{ flex: 1, fontWeight: 'var(--weight-medium)' }}>{article.title}</span>
                    <Badge variant="neutral">{article.locale}</Badge>
                    {article.updatedAtUtc && (
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                        {formatRelativeTime(article.updatedAtUtc)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatModelCost(model: AgentRuntimeModelOption): string {
  const fmt = (value: number | null) => (value == null ? '-' : `$${value.toFixed(3).replace(/\.?0+$/, '')}`);
  const costs = model.costs;
  return `In ${fmt(costs.inputUsdPerMillion)} · CW ${fmt(costs.cacheWriteUsdPerMillion)} · CR ${fmt(costs.cacheReadUsdPerMillion)} · Out ${fmt(costs.outputUsdPerMillion)} /M tok`;
}

/* ================================================================== */
/* Main Settings page                                                  */
/* ================================================================== */
export const Settings = () => {
  const isMac = isMacPlatform();
  const { activeWorkspace } = useWorkspace();
  const {
    state: appUpdateState,
    loading: appUpdateLoading,
    checkForUpdates,
    setAutoCheckEnabled
  } = useAppUpdate();
  const settingsQuery = useIpc<WorkspaceSettingsRecord>('workspace.settings.get');
  const repoQuery = useIpc<RepositoryStructurePayload>('workspace.repository.info');
  const settingsMutation = useIpcMutation<WorkspaceSettingsRecord>('workspace.settings.update');
  const credentialsQuery = useIpc<ZendeskCredentialRecord | null>('zendesk.credentials.get');
  const runtimeOptionsQuery = useIpc<AgentRuntimeOptionsResponse>('agent.runtime.options.get');

  const [activeSection, setActiveSection] = useState(activeWorkspace ? 'zendesk' : 'application');
  const [selectedSession, setSelectedSession] = useState<AgentSessionRecord | null>(null);

  // Form state for locale settings
  const [defaultLocale, setDefaultLocale] = useState('');
  const [enabledLocales, setEnabledLocales] = useState<string[]>([]);
  const [agentModelId, setAgentModelId] = useState('');
  const [acpModelId, setAcpModelId] = useState('');
  const [zendeskPermissionGroupId, setZendeskPermissionGroupId] = useState('');
  const [zendeskLiveUserSegmentId, setZendeskLiveUserSegmentId] = useState('');
  const [zendeskNotifySubscribers, setZendeskNotifySubscribers] = useState(false);
  const [zendeskAllowSectionCreation, setZendeskAllowSectionCreation] = useState(true);
  const [zendeskAllowCategoryCreation, setZendeskAllowCategoryCreation] = useState(true);
  const [zendeskRetirementStrategy, setZendeskRetirementStrategy] = useState<'archive'>('archive');
  const [zendeskPlaceholderAssetPolicy, setZendeskPlaceholderAssetPolicy] = useState<'block' | 'upload'>('upload');
  const [zendeskRequireLiveConfirmation, setZendeskRequireLiveConfirmation] = useState(true);
  const [zendeskBlockLiveOnWarnings, setZendeskBlockLiveOnWarnings] = useState(true);
  const [zendeskFallbackCategoryName, setZendeskFallbackCategoryName] = useState('KnowledgeBase Imports');
  const [zendeskFallbackSectionName, setZendeskFallbackSectionName] = useState('Unsorted');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [publishSaveSuccess, setPublishSaveSuccess] = useState(false);
  const [runtimeSaveSuccess, setRuntimeSaveSuccess] = useState(false);
  const [runtimeValidationError, setRuntimeValidationError] = useState('');
  const [acpRuntimeSaveSuccess, setAcpRuntimeSaveSuccess] = useState(false);
  const [acpRuntimeValidationError, setAcpRuntimeValidationError] = useState('');
  const sections = activeWorkspace
    ? [
        { id: 'zendesk', label: 'Zendesk Connection' },
        { id: 'locales', label: 'Locales' },
        { id: 'publish', label: 'Publish' },
        { id: 'ai', label: 'AI Runtime' },
        { id: 'application', label: 'Updates' },
        { id: 'workspace', label: 'Workspace' },
        { id: 'storage', label: 'Storage' },
        { id: 'about', label: 'About' },
      ]
    : [
        { id: 'application', label: 'Updates' },
        { id: 'about', label: 'About' },
      ];

  useEffect(() => {
    if (activeWorkspace) {
      settingsQuery.execute({ workspaceId: activeWorkspace.id });
      repoQuery.execute({ workspaceId: activeWorkspace.id });
      credentialsQuery.execute({ workspaceId: activeWorkspace.id });
      runtimeOptionsQuery.execute({ workspaceId: activeWorkspace.id });
    }
  }, [activeWorkspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (settingsQuery.data) {
      setDefaultLocale(settingsQuery.data.defaultLocale);
      setEnabledLocales(settingsQuery.data.enabledLocales);
      setAgentModelId(settingsQuery.data.agentModelId ?? '');
      setAcpModelId(settingsQuery.data.acpModelId ?? '');
      setZendeskPermissionGroupId(settingsQuery.data.zendeskPermissionGroupId ?? '');
      setZendeskLiveUserSegmentId(settingsQuery.data.zendeskLiveUserSegmentId ?? '');
      setZendeskNotifySubscribers(settingsQuery.data.zendeskNotifySubscribers);
      setZendeskAllowSectionCreation(settingsQuery.data.zendeskAllowSectionCreation);
      setZendeskAllowCategoryCreation(settingsQuery.data.zendeskAllowCategoryCreation);
      setZendeskRetirementStrategy(settingsQuery.data.zendeskRetirementStrategy);
      setZendeskPlaceholderAssetPolicy(settingsQuery.data.zendeskPlaceholderAssetPolicy);
      setZendeskRequireLiveConfirmation(settingsQuery.data.zendeskRequireLiveConfirmation);
      setZendeskBlockLiveOnWarnings(settingsQuery.data.zendeskBlockLiveOnWarnings);
      setZendeskFallbackCategoryName(settingsQuery.data.zendeskFallbackCategoryName);
      setZendeskFallbackSectionName(settingsQuery.data.zendeskFallbackSectionName);
    }
  }, [settingsQuery.data]);

  useEffect(() => {
    const options = runtimeOptionsQuery.data;
    if (!options || settingsQuery.data?.agentModelId || settingsQuery.data?.acpModelId || agentModelId) {
      return;
    }
    const fallbackModelId = options.currentModelId ?? options.modelCatalog?.[0]?.id ?? '';
    if (fallbackModelId) {
      setAgentModelId(fallbackModelId);
    }
  }, [agentModelId, runtimeOptionsQuery.data, settingsQuery.data?.acpModelId, settingsQuery.data?.agentModelId]);

  useEffect(() => {
    if (!sections.some((section) => section.id === activeSection)) {
      setActiveSection(sections[0]?.id ?? 'application');
    }
  }, [activeSection, sections]);

  const handleToggleLocale = (locale: string) => {
    if (locale === defaultLocale) return;
    setEnabledLocales((prev) =>
      prev.includes(locale) ? prev.filter((l) => l !== locale) : [...prev, locale],
    );
  };

  const handleSaveLocales = async () => {
    if (!activeWorkspace) return;
    setSaveSuccess(false);
    const result = await settingsMutation.mutate({
      workspaceId: activeWorkspace.id,
      defaultLocale,
      enabledLocales,
    });
    if (result) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    }
  };

  const handleSavePublishSettings = async () => {
    if (!activeWorkspace) return;
    setPublishSaveSuccess(false);
    const result = await settingsMutation.mutate({
      workspaceId: activeWorkspace.id,
      zendeskPermissionGroupId: zendeskPermissionGroupId.trim() || null,
      zendeskLiveUserSegmentId: zendeskLiveUserSegmentId.trim() || null,
      zendeskNotifySubscribers,
      zendeskAllowSectionCreation,
      zendeskAllowCategoryCreation,
      zendeskRetirementStrategy,
      zendeskPlaceholderAssetPolicy,
      zendeskRequireLiveConfirmation,
      zendeskBlockLiveOnWarnings,
      zendeskFallbackCategoryName: zendeskFallbackCategoryName.trim(),
      zendeskFallbackSectionName: zendeskFallbackSectionName.trim(),
    });
    if (result) {
      setPublishSaveSuccess(true);
      setTimeout(() => setPublishSaveSuccess(false), 2000);
    }
  };

  const handleCredentialsSaved = () => {
    if (activeWorkspace) {
      credentialsQuery.execute({ workspaceId: activeWorkspace.id });
    }
  };

  const handleRefreshRuntimeOptions = () => {
    if (activeWorkspace) {
      runtimeOptionsQuery.execute({ workspaceId: activeWorkspace.id });
    }
  };

  const handleSaveAgentRuntime = async () => {
    if (!activeWorkspace) {
      return;
    }

    setRuntimeValidationError('');
    setRuntimeSaveSuccess(false);
    if (!agentModelId.trim()) {
      setRuntimeValidationError('Select a model before saving.');
      return;
    }

    const savedModelId = settingsQuery.data?.agentModelId ?? '';
    if (agentModelId === savedModelId) {
      setRuntimeSaveSuccess(true);
      setTimeout(() => setRuntimeSaveSuccess(false), 2000);
      return;
    }

    const result = await settingsMutation.mutate({
      workspaceId: activeWorkspace.id,
      agentModelId
    });
    if (result) {
      settingsQuery.execute({ workspaceId: activeWorkspace.id });
      runtimeOptionsQuery.execute({ workspaceId: activeWorkspace.id });
      setRuntimeSaveSuccess(true);
      setTimeout(() => setRuntimeSaveSuccess(false), 2000);
    }
  };

  const handleSaveAcpRuntime = async () => {
    if (!activeWorkspace) {
      return;
    }

    setAcpRuntimeValidationError('');
    setAcpRuntimeSaveSuccess(false);
    if (!acpModelId.trim()) {
      setAcpRuntimeValidationError('Select an ACP model before saving.');
      return;
    }

    const savedAcpModelId = settingsQuery.data?.acpModelId ?? '';
    if (acpModelId === savedAcpModelId) {
      setAcpRuntimeSaveSuccess(true);
      setTimeout(() => setAcpRuntimeSaveSuccess(false), 2000);
      return;
    }

    const result = await settingsMutation.mutate({
      workspaceId: activeWorkspace.id,
      acpModelId
    });
    if (result) {
      settingsQuery.execute({ workspaceId: activeWorkspace.id });
      setAcpRuntimeSaveSuccess(true);
      setTimeout(() => setAcpRuntimeSaveSuccess(false), 2000);
    }
  };

  const selectedModel = runtimeOptionsQuery.data?.modelCatalog?.find((model) => model.id === agentModelId);
  const modelOptions = runtimeOptionsQuery.data?.modelCatalog ?? [];
  const selectedAcpModel = ACP_MODEL_OPTIONS.find((model) => model.id === acpModelId) ?? null;

  return (
    <>
      <PageHeader title="Settings" subtitle={activeWorkspace?.name ?? 'Application'} />
      <div className="route-content" style={{ display: 'flex', gap: 'var(--space-6)' }}>
        {/* Section nav */}
        <div style={{ width: 180, flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {sections.map((s) => (
              <button
                key={s.id}
                className={`btn ${activeSection === s.id ? 'btn-secondary' : 'btn-ghost'} btn-sm`}
                style={{ justifyContent: 'flex-start', width: '100%' }}
                onClick={() => setActiveSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, maxWidth: 680 }}>
          {!activeWorkspace && (
            <div className="card card-padded" style={{ marginBottom: 'var(--space-4)' }}>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                Workspace-specific settings become available after you open a workspace. App updates and version info remain available here anytime.
              </div>
            </div>
          )}

          {activeSection === 'zendesk' && activeWorkspace && (
            <div>
              <h3 className="settings-heading">Zendesk Connection</h3>

              <ZendeskCredentialSection
                workspaceId={activeWorkspace.id}
                subdomain={settingsQuery.data?.zendeskSubdomain}
                credential={credentialsQuery.data ?? null}
                credentialLoading={credentialsQuery.loading}
                onCredentialsSaved={handleCredentialsSaved}
              />

              <ZendeskConnectionTestSection workspaceId={activeWorkspace.id} />

              <ZendeskSyncSection workspaceId={activeWorkspace.id} />

              <ZendeskTaxonomyBrowser workspaceId={activeWorkspace.id} />
            </div>
          )}

          {activeSection === 'locales' && activeWorkspace && (
            <div>
              <h3 className="settings-heading">Locale Configuration</h3>

              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label className="settings-label">Default Locale</label>
                <select className="select" value={defaultLocale} onChange={(e) => {
                  setDefaultLocale(e.target.value);
                  if (!enabledLocales.includes(e.target.value)) {
                    setEnabledLocales((prev) => [...prev, e.target.value]);
                  }
                }}>
                  {LOCALE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label className="settings-label" style={{ marginBottom: 'var(--space-2)' }}>Enabled Locales</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {LOCALE_OPTIONS.map((opt) => (
                    <div key={opt.value} className="card card-padded" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <input
                          type="checkbox"
                          checked={enabledLocales.includes(opt.value)}
                          onChange={() => handleToggleLocale(opt.value)}
                          disabled={opt.value === defaultLocale}
                        />
                        <div>
                          <div style={{ fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-sm)' }}>{opt.label}</div>
                          {opt.value === defaultLocale && (
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>Default source locale</div>
                          )}
                        </div>
                      </div>
                      {opt.value === defaultLocale ? (
                        <Badge variant="primary">Default</Badge>
                      ) : enabledLocales.includes(opt.value) ? (
                        <Badge variant="success">Enabled</Badge>
                      ) : (
                        <Badge variant="neutral">Disabled</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <button className="btn btn-primary" onClick={handleSaveLocales} disabled={settingsMutation.loading}>
                  {settingsMutation.loading ? 'Saving...' : 'Save Locales'}
                </button>
                {saveSuccess && (
                  <span className="settings-inline-success">
                    <IconCheckCircle size={14} /> Saved
                  </span>
                )}
                {settingsMutation.error && <span className="settings-inline-error">{settingsMutation.error}</span>}
              </div>
            </div>
          )}

          {activeSection === 'publish' && activeWorkspace && (
            <div>
              <h3 className="settings-heading">Publish Defaults</h3>

              <div className="card card-padded" style={{ marginBottom: 'var(--space-4)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <div>
                    <label className="settings-label">Permission Group ID</label>
                    <input
                      className="input"
                      value={zendeskPermissionGroupId}
                      onChange={(e) => setZendeskPermissionGroupId(e.target.value)}
                      placeholder="Leave blank to use Zendesk default"
                    />
                    <div className="settings-hint" style={{ marginTop: 'var(--space-1)' }}>
                      Leave blank if you want Zendesk to use its default Help Center management permission group.
                    </div>
                  </div>

                  <div>
                    <label className="settings-label">Live User Segment ID</label>
                    <input
                      className="input"
                      value={zendeskLiveUserSegmentId}
                      onChange={(e) => setZendeskLiveUserSegmentId(e.target.value)}
                      placeholder="Leave blank for fully public live articles"
                    />
                    <div className="settings-hint" style={{ marginTop: 'var(--space-1)' }}>
                      Blank means live articles publish as public. Set a Zendesk user segment id only if you want a restricted audience later.
                    </div>
                  </div>

                  <div>
                    <label className="settings-label">Fallback Category Name</label>
                    <input
                      className="input"
                      value={zendeskFallbackCategoryName}
                      onChange={(e) => setZendeskFallbackCategoryName(e.target.value)}
                    />
                    <div className="settings-hint" style={{ marginTop: 'var(--space-1)' }}>
                      Used when a new article has no mapped Zendesk category and category auto-create is enabled.
                    </div>
                  </div>

                  <div>
                    <label className="settings-label">Fallback Section Name</label>
                    <input
                      className="input"
                      value={zendeskFallbackSectionName}
                      onChange={(e) => setZendeskFallbackSectionName(e.target.value)}
                    />
                    <div className="settings-hint" style={{ marginTop: 'var(--space-1)' }}>
                      Used when a new article has no mapped Zendesk section and section auto-create is enabled.
                    </div>
                  </div>

                  <div>
                    <label className="settings-label">Retirement Behavior</label>
                    <select
                      className="select"
                      value={zendeskRetirementStrategy}
                      onChange={(e) => setZendeskRetirementStrategy(e.target.value as 'archive')}
                    >
                      <option value="archive">Hide by archiving the Zendesk article</option>
                    </select>
                  </div>

                  <div>
                    <label className="settings-label">Placeholder Asset Policy</label>
                    <select
                      className="select"
                      value={zendeskPlaceholderAssetPolicy}
                      onChange={(e) => setZendeskPlaceholderAssetPolicy(e.target.value as 'block' | 'upload')}
                    >
                      <option value="upload">Upload placeholder image tags/data to Zendesk</option>
                      <option value="block">Block publish when placeholders remain</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {[
                      {
                        checked: zendeskNotifySubscribers,
                        onChange: () => setZendeskNotifySubscribers((value) => !value),
                        label: 'Notify subscribers on live publish',
                        detail: 'Currently off per your preference.'
                      },
                      {
                        checked: zendeskAllowCategoryCreation,
                        onChange: () => setZendeskAllowCategoryCreation((value) => !value),
                        label: 'Allow category auto-create',
                        detail: 'Lets KnowledgeBase create missing Zendesk categories during publish.'
                      },
                      {
                        checked: zendeskAllowSectionCreation,
                        onChange: () => setZendeskAllowSectionCreation((value) => !value),
                        label: 'Allow section auto-create',
                        detail: 'Lets KnowledgeBase create missing Zendesk sections during publish.'
                      },
                      {
                        checked: zendeskRequireLiveConfirmation,
                        onChange: () => setZendeskRequireLiveConfirmation((value) => !value),
                        label: 'Require confirmation before live publish',
                        detail: 'Shows a confirmation gate before pushing selected branches live.'
                      },
                      {
                        checked: zendeskBlockLiveOnWarnings,
                        onChange: () => setZendeskBlockLiveOnWarnings((value) => !value),
                        label: 'Block live publish when warnings exist',
                        detail: 'Draft publish can still proceed, but live publish must be warning-free.'
                      }
                    ].map((option) => (
                      <label
                        key={option.label}
                        className="card card-padded"
                        style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', cursor: 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          checked={option.checked}
                          onChange={option.onChange}
                          style={{ marginTop: 2 }}
                        />
                        <div>
                          <div style={{ fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-sm)' }}>{option.label}</div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 4 }}>{option.detail}</div>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <button className="btn btn-primary" onClick={handleSavePublishSettings} disabled={settingsMutation.loading}>
                      {settingsMutation.loading ? 'Saving...' : 'Save Publish Defaults'}
                    </button>
                    {publishSaveSuccess && (
                      <span className="settings-inline-success">
                        <IconCheckCircle size={14} /> Saved
                      </span>
                    )}
                    {settingsMutation.error && <span className="settings-inline-error">{settingsMutation.error}</span>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'ai' && activeWorkspace && (
            <div>
              <h3 className="settings-heading">AI Runtime</h3>
              <div className="card card-padded" style={{ marginBottom: 'var(--space-4)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                      <label className="settings-label" style={{ marginBottom: 0 }}>Preferred model</label>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={handleRefreshRuntimeOptions}
                        disabled={runtimeOptionsQuery.loading}
                        title="Refresh available models"
                      >
                        <IconRefreshCw size={12} />
                      </button>
                    </div>
                    {runtimeOptionsQuery.loading ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) 0' }}>
                        <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>Loading models...</span>
                      </div>
                    ) : modelOptions.length > 0 ? (
                      <>
                        <select
                          className="select"
                          value={agentModelId}
                          onChange={(e) => setAgentModelId(e.target.value)}
                        >
                          <option value="" disabled>Select preferred model...</option>
                          {modelOptions.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.provider !== 'Unknown' ? `${model.provider} - ${model.name}` : model.name}
                            </option>
                          ))}
                        </select>
                        {selectedModel && (
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)', fontFamily: 'var(--font-mono)' }}>
                            {formatModelCost(selectedModel)}
                          </div>
                        )}
                        <div className="settings-hint" style={{ marginTop: 'var(--space-2)' }}>
                          Optional override. ACP is now the default session model unless you explicitly save a different preferred model.
                        </div>
                      </>
                    ) : (
                      <div className="settings-hint">
                        No agent models were discovered. KnowledgeBase will try <code>agent --list-models</code>, <code>agent models</code>, and an ACP runtime probe. Check that your local agent runtime is installed and reachable.
                      </div>
                    )}
                    {!runtimeOptionsQuery.loading && runtimeOptionsQuery.error && (
                      <div className="settings-inline-error" style={{ marginTop: 'var(--space-2)' }}>
                        {runtimeOptionsQuery.error}
                      </div>
                    )}
                  </div>

                    {runtimeValidationError && (
                      <span className="settings-inline-error">{runtimeValidationError}</span>
                    )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <button className="btn btn-primary" onClick={handleSaveAgentRuntime} disabled={settingsMutation.loading || runtimeOptionsQuery.loading || modelOptions.length === 0}>
                      {settingsMutation.loading ? 'Saving...' : 'Save AI Model'}
                    </button>
                    {runtimeSaveSuccess && (
                      <span className="settings-inline-success">
                        <IconCheckCircle size={14} /> Saved
                      </span>
                    )}
                    {settingsMutation.error && <span className="settings-inline-error">{settingsMutation.error}</span>}
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                      <label className="settings-label" style={{ marginBottom: 0 }}>ACP Model</label>
                    </div>
                    <select
                      className="select"
                      value={acpModelId}
                      onChange={(e) => setAcpModelId(e.target.value)}
                    >
                      <option value="" disabled>Select ACP model...</option>
                      {ACP_MODEL_OPTIONS.map((model) => (
                        <option key={model.id} value={model.id}>
                          {`${model.name} (${model.id})`}
                        </option>
                      ))}
                    </select>
                    {selectedAcpModel && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)', fontFamily: 'var(--font-mono)' }}>
                        {formatModelCost(selectedAcpModel)}
                      </div>
                    )}
                    <div className="settings-hint" style={{ marginTop: 'var(--space-2)' }}>
                      Uses the exact ACP <code>modelId</code> value when creating agent sessions.
                    </div>
                  </div>

                  {acpRuntimeValidationError && (
                    <span className="settings-inline-error">{acpRuntimeValidationError}</span>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <button className="btn btn-primary" onClick={handleSaveAcpRuntime} disabled={settingsMutation.loading}>
                      {settingsMutation.loading ? 'Saving...' : 'Save ACP Model'}
                    </button>
                    {acpRuntimeSaveSuccess && (
                      <span className="settings-inline-success">
                        <IconCheckCircle size={14} /> Saved
                      </span>
                    )}
                    {settingsMutation.error && <span className="settings-inline-error">{settingsMutation.error}</span>}
                  </div>
                </div>
              </div>
              <HealthStatusPanel workspaceId={activeWorkspace.id} />
              {selectedSession ? (
                <SessionDetailPanel
                  workspaceId={activeWorkspace.id}
                  session={selectedSession}
                  onBack={() => setSelectedSession(null)}
                />
              ) : (
                <SessionListPanel
                  workspaceId={activeWorkspace.id}
                  onSelectSession={setSelectedSession}
                />
              )}
            </div>
          )}

          {activeSection === 'application' && (
            <div>
              <h3 className="settings-heading">Application Updates</h3>
              <div className="card card-padded">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)' }}>
                        Current version
                      </div>
                      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)' }}>
                        {appUpdateState?.currentVersion ?? 'Loading...'}
                      </div>
                    </div>
                    <Badge variant={appUpdateBadgeVariant(appUpdateState)}>
                      {appUpdateLoading ? 'Loading...' : appUpdateBadgeLabel(appUpdateState)}
                    </Badge>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                    <div>
                      <div className="settings-label" style={{ marginBottom: 'var(--space-1)' }}>Automatically check for updates</div>
                      <div className="settings-hint" style={{ marginBottom: 0 }}>
                        Enabled by default. KnowledgeBase checks on launch and periodically while the app stays open.
                      </div>
                    </div>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
                      <input
                        type="checkbox"
                        checked={appUpdateState?.autoCheckEnabled ?? true}
                        onChange={(e) => {
                          void setAutoCheckEnabled(e.target.checked);
                        }}
                        disabled={appUpdateLoading}
                      />
                      <span>{appUpdateState?.autoCheckEnabled ?? true ? 'On' : 'Off'}</span>
                    </label>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-primary"
                      onClick={() => void checkForUpdates()}
                      disabled={appUpdateLoading || appUpdateState?.status === 'checking' || !appUpdateState?.isUpdateSupported}
                    >
                      {appUpdateState?.status === 'checking' ? 'Checking...' : 'Check for Updates'}
                    </button>
                    {appUpdateState?.lastCheckedAt ? (
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                        Last checked {new Date(appUpdateState.lastCheckedAt).toLocaleString()}
                      </span>
                    ) : null}
                  </div>

                  {!appUpdateState?.isUpdateSupported && (
                    <div className="settings-hint" style={{ marginBottom: 0 }}>
                      Update checks work in packaged builds. The release workflow publishes installer assets and update metadata to GitHub Releases.
                    </div>
                  )}

                  {appUpdateState?.status === 'available' && appUpdateState.updateInfo && (
                    <div className="settings-test-result settings-test-result--success">
                      <IconCheckCircle size={16} />
                      <div>
                        <div style={{ fontWeight: 'var(--weight-medium)' }}>
                          Version {appUpdateState.updateInfo.version} is available
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                          The update popup includes release notes and download controls.
                        </div>
                      </div>
                    </div>
                  )}

                  {appUpdateState?.status === 'downloaded' && (
                    <div className="settings-test-result settings-test-result--success">
                      <IconCheckCircle size={16} />
                      <div>
                        <div style={{ fontWeight: 'var(--weight-medium)' }}>Update downloaded</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                          {isMac
                            ? "Choose Quit and Install from the update popup when you are ready. If KnowledgeBase doesn't reopen automatically, open it from /Applications."
                            : 'Restart KnowledgeBase from the update popup when you are ready to install it.'}
                        </div>
                      </div>
                    </div>
                  )}

                  {appUpdateState?.status === 'error' && appUpdateState.errorMessage && (
                    <div className="settings-test-result settings-test-result--failed">
                      <IconAlertCircle size={16} />
                      <div>
                        <div style={{ fontWeight: 'var(--weight-medium)' }}>Update check failed</div>
                        <div className="update-copyable-text" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                          {appUpdateState.errorMessage}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeSection === 'workspace' && activeWorkspace && (
            <div>
              <h3 className="settings-heading">Workspace Settings</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div>
                  <label className="settings-label">Workspace Name</label>
                  <input className="input" defaultValue={activeWorkspace.name} />
                </div>
                <div>
                  <label className="settings-label">Storage Path</label>
                  <input className="input" readOnly value={activeWorkspace.path} style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }} />
                </div>
                <div>
                  <label className="settings-label">State</label>
                  <StatusChip status={activeWorkspace.state === 'active' ? 'active' : 'retired'} label={activeWorkspace.state} />
                </div>
              </div>
            </div>
          )}

          {activeSection === 'storage' && activeWorkspace && (
            <div>
              <h3 className="settings-heading">Local Repository Structure</h3>
              {repoQuery.loading ? (
                <LoadingState message="Loading..." />
              ) : repoQuery.data ? (
                <div className="card card-padded">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Root</span>
                      <code style={{ fontSize: 'var(--text-xs)', background: 'var(--color-bg-muted)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>{repoQuery.data.rootPath}</code>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Database</span>
                      <code style={{ fontSize: 'var(--text-xs)', background: 'var(--color-bg-muted)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>{repoQuery.data.dbPath}</code>
                    </div>
                    {repoQuery.data.storage && Object.entries(repoQuery.data.storage).map(([key, path]) => (
                      <div key={key} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{key}</span>
                        <code style={{ fontSize: 'var(--text-xs)', background: 'var(--color-bg-muted)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>{path}</code>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>No repository info available.</div>
              )}
            </div>
          )}

          {activeSection === 'about' && (
            <div>
              <h3 className="settings-heading">About KnowledgeBase</h3>
              <div className="card card-padded">
                <div style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}><strong>Version:</strong> {appUpdateState?.currentVersion ?? 'Loading...'}</div>
                {activeWorkspace && (
                  <div style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}><strong>Workspace ID:</strong> {activeWorkspace.id}</div>
                )}
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>Local-first Electron desktop application for automating Zendesk KB maintenance from bulk PBI uploads.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
