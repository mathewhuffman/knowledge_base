import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type DraftBranchListResponse,
  DraftValidationSeverity,
  PublishJobItemState,
  type WorkspaceSettingsRecord,
  type ZendeskPublishJobSnapshot,
  type ZendeskPublishValidationItem,
  type ZendeskPublishValidateResponse,
  type ZendeskRetireQueueItem,
  type ZendeskRetireQueueListResponse
} from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/Badge';
import {
  IconAlertCircle,
  IconArchive,
  IconCheckCircle,
  IconClock,
  IconGitBranch,
  IconRefreshCw,
  IconSend
} from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc } from '../hooks/useIpc';

function relativeTime(iso?: string): string {
  if (!iso) {
    return '—';
  }
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function validationTone(item: ZendeskPublishValidationItem): {
  badge: 'success' | 'warning' | 'danger' | 'primary';
  label: string;
  detail: string;
} {
  const errors = item.issues.filter((issue) => issue.severity === DraftValidationSeverity.ERROR).length;
  const warnings = item.issues.filter((issue) => issue.severity === DraftValidationSeverity.WARNING).length;
  if (errors > 0) {
    return {
      badge: 'danger',
      label: item.issues.some((issue) => issue.code === 'remote_conflict') ? 'Conflict' : 'Blocked',
      detail: `${errors} blocking issue${errors === 1 ? '' : 's'}`
    };
  }
  if (warnings > 0) {
    return {
      badge: 'warning',
      label: 'Warnings',
      detail: `${warnings} warning${warnings === 1 ? '' : 's'}`
    };
  }
  return {
    badge: 'success',
    label: 'Ready',
    detail: 'Ready to publish'
  };
}

function retireTone(item: ZendeskRetireQueueItem): {
  badge: 'success' | 'warning' | 'danger' | 'primary';
  label: string;
  detail: string;
} {
  if (!item.canArchive) {
    return {
      badge: 'danger',
      label: 'Blocked',
      detail: item.blockedReason ?? 'Retire action cannot be archived in Zendesk yet.'
    };
  }
  if (item.remoteRetireStatus === 'running') {
    return {
      badge: 'primary',
      label: 'Running',
      detail: 'Archive action is in progress.'
    };
  }
  if (item.remoteRetireStatus === 'failed') {
    return {
      badge: 'danger',
      label: 'Failed',
      detail: item.remoteRetireMessage ?? 'Last Zendesk archive attempt failed.'
    };
  }
  return {
    badge: 'success',
    label: 'Ready',
    detail: 'Ready to archive in Zendesk'
  };
}

function jobStatusBadge(status: PublishJobItemState): { variant: 'success' | 'warning' | 'danger' | 'neutral' | 'primary'; label: string } {
  switch (status) {
    case PublishJobItemState.SUCCEEDED:
      return { variant: 'success', label: 'Succeeded' };
    case PublishJobItemState.RUNNING:
      return { variant: 'primary', label: 'Running' };
    case PublishJobItemState.BLOCKED:
      return { variant: 'warning', label: 'Blocked' };
    case PublishJobItemState.CONFLICTED:
      return { variant: 'danger', label: 'Conflicted' };
    case PublishJobItemState.FAILED:
      return { variant: 'danger', label: 'Failed' };
    case PublishJobItemState.CANCELED:
      return { variant: 'neutral', label: 'Canceled' };
    case PublishJobItemState.QUEUED:
    default:
      return { variant: 'neutral', label: 'Queued' };
  }
}

export const PublishQueue = () => {
  const { activeWorkspace } = useWorkspace();
  const listQuery = useIpc<DraftBranchListResponse>('draft.branch.list');
  const settingsQuery = useIpc<WorkspaceSettingsRecord>('workspace.settings.get');
  const validationQuery = useIpc<ZendeskPublishValidateResponse>('publish.validate');
  const latestJobQuery = useIpc<ZendeskPublishJobSnapshot>('publish.job.getLatest');
  const retireQuery = useIpc<ZendeskRetireQueueListResponse>('zendesk.retire.queue.list');

  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [selectedRetireProposalIds, setSelectedRetireProposalIds] = useState<string[]>([]);

  const [publishJobId, setPublishJobId] = useState<string | null>(null);
  const [publishState, setPublishState] = useState('');
  const [publishProgress, setPublishProgress] = useState(0);
  const [publishMessage, setPublishMessage] = useState('');
  const [liveConfirmOpen, setLiveConfirmOpen] = useState(false);

  const [retireJobId, setRetireJobId] = useState<string | null>(null);
  const [retireState, setRetireState] = useState('');
  const [retireProgress, setRetireProgress] = useState(0);
  const [retireMessage, setRetireMessage] = useState('');
  const [retireConfirmOpen, setRetireConfirmOpen] = useState(false);

  const publishJobIdRef = useRef<string | null>(null);
  const retireJobIdRef = useRef<string | null>(null);
  const validationSelectionInitRef = useRef(false);
  const retireSelectionInitRef = useRef(false);

  const refresh = async (workspaceId: string) => {
    await Promise.all([
      listQuery.execute({ workspaceId }),
      settingsQuery.execute({ workspaceId }),
      validationQuery.execute({ workspaceId }),
      latestJobQuery.execute({ workspaceId }),
      retireQuery.execute({ workspaceId })
    ]);
  };

  useEffect(() => {
    if (!activeWorkspace) return;
    void refresh(activeWorkspace.id);
  }, [activeWorkspace]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const items = validationQuery.data?.items ?? [];
    const publishableIds = items.filter((item) => item.canPublish).map((item) => item.branchId);
    if (!validationSelectionInitRef.current) {
      validationSelectionInitRef.current = true;
      setSelectedBranchIds(publishableIds);
      return;
    }
    setSelectedBranchIds((previous) => previous.filter((branchId) => items.some((item) => item.branchId === branchId)));
  }, [validationQuery.data?.validatedAtUtc]);

  useEffect(() => {
    const items = retireQuery.data?.items ?? [];
    const archiveableIds = items.filter((item) => item.canArchive).map((item) => item.proposalId);
    if (!retireSelectionInitRef.current) {
      retireSelectionInitRef.current = true;
      setSelectedRetireProposalIds(archiveableIds);
      return;
    }
    setSelectedRetireProposalIds((previous) => previous.filter((proposalId) => items.some((item) => item.proposalId === proposalId)));
  }, [retireQuery.data?.listedAtUtc]);

  useEffect(() => {
    const handler = (event: { id: string; command: string; state: string; progress: number; message?: string }) => {
      if (event.command === 'zendesk.publish.run') {
        if (publishJobIdRef.current && event.id !== publishJobIdRef.current) return;
        setPublishState(event.state);
        setPublishProgress(event.progress);
        setPublishMessage(event.message ?? '');
      } else if (event.command === 'zendesk.retire.run') {
        if (retireJobIdRef.current && event.id !== retireJobIdRef.current) return;
        setRetireState(event.state);
        setRetireProgress(event.progress);
        setRetireMessage(event.message ?? '');
      } else {
        return;
      }

      if (event.state === 'SUCCEEDED' || event.state === 'FAILED' || event.state === 'CANCELED') {
        if (activeWorkspace) {
          void refresh(activeWorkspace.id);
        }
      }
    };
    const unsubscribe = window.kbv.emitJobEvents(handler);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [activeWorkspace]); // eslint-disable-line react-hooks/exhaustive-deps

  const validationItems = validationQuery.data?.items ?? [];
  const publishQueue = validationItems;
  const retireItems = retireQuery.data?.items ?? [];
  const branchMap = useMemo(
    () => new Map((listQuery.data?.branches ?? []).map((branch) => [branch.id, branch])),
    [listQuery.data]
  );

  const selectedPublishable = publishQueue.filter((item) => selectedBranchIds.includes(item.branchId) && item.canPublish);
  const allPublishableIds = publishQueue.filter((item) => item.canPublish).map((item) => item.branchId);

  const selectedRetireItems = retireItems.filter((item) => selectedRetireProposalIds.includes(item.proposalId) && item.canArchive);
  const allArchiveableRetireIds = retireItems.filter((item) => item.canArchive).map((item) => item.proposalId);

  const isPublishRunning = publishState === 'RUNNING' || publishState === 'QUEUED';
  const isRetireRunning = retireState === 'RUNNING' || retireState === 'QUEUED';
  const isBusy = isPublishRunning || isRetireRunning;

  const latestJob = latestJobQuery.data;
  const blockLiveOnWarnings = settingsQuery.data?.zendeskBlockLiveOnWarnings ?? true;
  const requireLiveConfirmation = settingsQuery.data?.zendeskRequireLiveConfirmation ?? true;
  const selectedWarningCount = selectedPublishable.filter((item) => item.issues.some((issue) => issue.severity === DraftValidationSeverity.WARNING)).length;
  const livePublishBlocked = blockLiveOnWarnings && selectedWarningCount > 0;

  const handleToggleBranch = (branchId: string) => {
    setSelectedBranchIds((previous) => (
      previous.includes(branchId)
        ? previous.filter((value) => value !== branchId)
        : [...previous, branchId]
    ));
  };

  const handleToggleAllBranches = () => {
    setSelectedBranchIds((previous) => (
      previous.length === allPublishableIds.length ? [] : allPublishableIds
    ));
  };

  const handleToggleRetireProposal = (proposalId: string) => {
    setSelectedRetireProposalIds((previous) => (
      previous.includes(proposalId)
        ? previous.filter((value) => value !== proposalId)
        : [...previous, proposalId]
    ));
  };

  const handleToggleAllRetire = () => {
    setSelectedRetireProposalIds((previous) => (
      previous.length === allArchiveableRetireIds.length ? [] : allArchiveableRetireIds
    ));
  };

  const handlePublish = async (publishTarget: 'draft' | 'live') => {
    if (!activeWorkspace || selectedPublishable.length === 0) return;
    const response = await window.kbv.startJob('zendesk.publish.run', {
      workspaceId: activeWorkspace.id,
      branchIds: selectedPublishable.map((item) => item.branchId),
      mode: 'selected',
      publishTarget
    });
    if (response.jobId) {
      setPublishJobId(response.jobId);
      publishJobIdRef.current = response.jobId;
      setPublishState('QUEUED');
      setPublishProgress(0);
      setPublishMessage(
        `${publishTarget === 'draft' ? 'Queued draft sync for' : 'Queued live publish for'} ${selectedPublishable.length} branch${selectedPublishable.length === 1 ? '' : 'es'}...`
      );
    }
  };

  const handleArchiveRetires = async () => {
    if (!activeWorkspace || selectedRetireItems.length === 0) return;
    const response = await window.kbv.startJob('zendesk.retire.run', {
      workspaceId: activeWorkspace.id,
      proposalIds: selectedRetireItems.map((item) => item.proposalId)
    });
    if (response.jobId) {
      setRetireJobId(response.jobId);
      retireJobIdRef.current = response.jobId;
      setRetireState('QUEUED');
      setRetireProgress(0);
      setRetireMessage(
        `Queued Zendesk archive for ${selectedRetireItems.length} retire action${selectedRetireItems.length === 1 ? '' : 's'}...`
      );
    }
  };

  if (!activeWorkspace) {
    return (
      <>
        <PageHeader title="Publish Queue" subtitle="Open a workspace to review ready drafts and retire actions." />
        <div className="route-content">
          <EmptyState
            icon={<IconSend size={48} />}
            title="No workspace selected"
            description="Choose a workspace to validate and publish ready draft branches or archive accepted retire actions."
          />
        </div>
      </>
    );
  }

  if ((listQuery.loading || validationQuery.loading || retireQuery.loading) && !listQuery.data && !validationQuery.data && !retireQuery.data) {
    return (
      <>
        <PageHeader title="Publish Queue" subtitle="Loading publish queue" />
        <div className="route-content">
          <LoadingState message="Reviewing draft branches and accepted retire actions for Zendesk." />
        </div>
      </>
    );
  }

  if ((listQuery.error || validationQuery.error || retireQuery.error) && !validationQuery.data && !retireQuery.data) {
    return (
      <>
        <PageHeader title="Publish Queue" subtitle="Unable to load publish queue" />
        <div className="route-content">
          <ErrorState
            title="Publish queue loading failed"
            description={validationQuery.error ?? retireQuery.error ?? listQuery.error ?? 'Unknown publish queue error.'}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Publish Queue"
        subtitle={`${publishQueue.length} queued branch${publishQueue.length === 1 ? '' : 'es'} in ${activeWorkspace.name}`}
        actions={(
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <button className="btn btn-secondary" onClick={() => void refresh(activeWorkspace.id)} disabled={listQuery.loading || validationQuery.loading || settingsQuery.loading || retireQuery.loading || isBusy}>
              <IconRefreshCw size={14} />
              Refresh
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => void handlePublish('draft')}
              disabled={isBusy || selectedPublishable.length === 0}
              title={selectedPublishable.length === 0 ? 'Select at least one publishable branch.' : undefined}
            >
              <IconSend size={14} />
              Publish Draft {selectedPublishable.length > 0 ? `(${selectedPublishable.length})` : ''}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (requireLiveConfirmation) {
                  setLiveConfirmOpen(true);
                  return;
                }
                void handlePublish('live');
              }}
              disabled={isBusy || selectedPublishable.length === 0 || livePublishBlocked}
              title={
                selectedPublishable.length === 0
                  ? 'Select at least one publishable branch.'
                  : livePublishBlocked
                    ? 'Resolve or deselect warning-bearing branches before pushing live.'
                    : undefined
              }
            >
              <IconSend size={14} />
              Push Live {selectedPublishable.length > 0 ? `(${selectedPublishable.length})` : ''}
            </button>
          </div>
        )}
      />
      <div className="route-content">
        {isPublishRunning && (
          <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <div style={{ fontWeight: 'var(--weight-medium)' }}>Zendesk publish in progress</div>
              <Badge variant="primary">{publishState}</Badge>
            </div>
            <div style={{ height: 8, borderRadius: 'var(--radius-pill)', background: 'var(--color-bg-muted)', overflow: 'hidden', marginBottom: 'var(--space-2)' }}>
              <div style={{ width: `${publishProgress}%`, height: '100%', background: 'var(--color-accent)' }} />
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
              {publishMessage || `Job ${publishJobId ?? 'pending'}`}
            </div>
          </div>
        )}

        {isRetireRunning && (
          <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <div style={{ fontWeight: 'var(--weight-medium)' }}>Zendesk retire actions in progress</div>
              <Badge variant="primary">{retireState}</Badge>
            </div>
            <div style={{ height: 8, borderRadius: 'var(--radius-pill)', background: 'var(--color-bg-muted)', overflow: 'hidden', marginBottom: 'var(--space-2)' }}>
              <div style={{ width: `${retireProgress}%`, height: '100%', background: 'var(--color-danger)' }} />
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
              {retireMessage || `Job ${retireJobId ?? 'pending'}`}
            </div>
          </div>
        )}

        {validationQuery.error && validationQuery.data && (
          <div className="panel" style={{ marginBottom: 'var(--space-4)', color: 'var(--color-danger)' }}>
            {validationQuery.error}
          </div>
        )}

        {retireQuery.error && (
          <div className="panel" style={{ marginBottom: 'var(--space-4)', color: 'var(--color-danger)' }}>
            {retireQuery.error}
          </div>
        )}

        {publishQueue.length === 0 ? (
          <EmptyState
            icon={<IconGitBranch size={48} />}
            title="Nothing ready to publish"
            description="Mark draft branches as ready in Drafts and they will appear here after validation."
          />
        ) : (
          <>
            <div className="panel" style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <Badge variant="success">{validationQuery.data?.summary.publishable ?? 0} publishable</Badge>
              {(validationQuery.data?.summary.warnings ?? 0) > 0 && (
                <Badge variant="warning">{validationQuery.data?.summary.warnings} with warnings</Badge>
              )}
              {(validationQuery.data?.summary.blocked ?? 0) > 0 && (
                <Badge variant="danger">{validationQuery.data?.summary.blocked} blocked</Badge>
              )}
              {(validationQuery.data?.summary.conflicts ?? 0) > 0 && (
                <Badge variant="danger">{validationQuery.data?.summary.conflicts} conflicts</Badge>
              )}
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginLeft: 'auto' }}>
                Validated {relativeTime(validationQuery.data?.validatedAtUtc)}
              </span>
            </div>

            <div className="panel" style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
                <input
                  type="checkbox"
                  checked={selectedBranchIds.length > 0 && selectedBranchIds.length === allPublishableIds.length}
                  onChange={() => handleToggleAllBranches()}
                  disabled={allPublishableIds.length === 0 || isBusy}
                />
                Select all publishable
              </label>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                {selectedPublishable.length} selected
              </span>
              {livePublishBlocked && (
                <Badge variant="warning">
                  Live blocked by {selectedWarningCount} warning{selectedWarningCount === 1 ? '' : 's'}
                </Badge>
              )}
            </div>

            <div className="table-wrapper" style={{ marginBottom: 'var(--space-4)' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 44 }} />
                    <th>Article</th>
                    <th>Branch</th>
                    <th>Locale</th>
                    <th>Validation</th>
                    <th>Zendesk</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {publishQueue.map((item) => {
                    const validation = validationTone(item);
                    const branch = branchMap.get(item.branchId);
                    const detailLine = item.issues[0]?.message ?? validation.detail;
                    return (
                      <tr key={item.branchId}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedBranchIds.includes(item.branchId)}
                            onChange={() => handleToggleBranch(item.branchId)}
                            disabled={!item.canPublish || isBusy}
                            aria-label={`Select ${item.familyTitle}`}
                          />
                        </td>
                        <td>
                          <div style={{ fontWeight: 'var(--weight-medium)' }}>{item.familyTitle}</div>
                          {branch?.changeSummary && (
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 4 }}>
                              {branch.changeSummary}
                            </div>
                          )}
                        </td>
                        <td>
                          <code style={{ fontSize: 'var(--text-xs)', background: 'var(--color-bg-muted)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>
                            {item.branchName}
                          </code>
                        </td>
                        <td><Badge variant="neutral">{item.locale}</Badge></td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                            <Badge variant={validation.badge}>{validation.label}</Badge>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                              {validation.badge === 'danger'
                                ? <IconAlertCircle size={12} />
                                : <IconCheckCircle size={12} />}
                              {detailLine}
                            </span>
                          </div>
                        </td>
                        <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                          {item.externalKey ? (
                            <>
                              <div>{item.externalKey}</div>
                              {item.remoteUpdatedAtUtc && (
                                <div style={{ fontSize: 'var(--text-xs)' }}>
                                  Remote {relativeTime(item.remoteUpdatedAtUtc)}
                                </div>
                              )}
                            </>
                          ) : (
                            'New article'
                          )}
                        </td>
                        <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                          {relativeTime(branch?.updatedAtUtc)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="panel" style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
            <div>
              <div style={{ fontWeight: 'var(--weight-medium)' }}>Retire Actions</div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                Accepted retire proposals stay local until you explicitly archive them in Zendesk.
              </div>
            </div>
            <button
              className="btn btn-danger"
              onClick={() => setRetireConfirmOpen(true)}
              disabled={isBusy || selectedRetireItems.length === 0}
              title={selectedRetireItems.length === 0 ? 'Select at least one archive-ready retire action.' : undefined}
            >
              <IconArchive size={14} />
              Archive in Zendesk {selectedRetireItems.length > 0 ? `(${selectedRetireItems.length})` : ''}
            </button>
          </div>

          {retireItems.length === 0 ? (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
              No accepted retire actions are waiting on Zendesk right now.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
                <Badge variant="success">{retireQuery.data?.summary.ready ?? 0} ready</Badge>
                {(retireQuery.data?.summary.failed ?? 0) > 0 && (
                  <Badge variant="danger">{retireQuery.data?.summary.failed} failed</Badge>
                )}
                {(retireQuery.data?.summary.blocked ?? 0) > 0 && (
                  <Badge variant="danger">{retireQuery.data?.summary.blocked} blocked</Badge>
                )}
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginLeft: 'auto' }}>
                  Listed {relativeTime(retireQuery.data?.listedAtUtc)}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
                  <input
                    type="checkbox"
                    checked={selectedRetireProposalIds.length > 0 && selectedRetireProposalIds.length === allArchiveableRetireIds.length}
                    onChange={() => handleToggleAllRetire()}
                    disabled={allArchiveableRetireIds.length === 0 || isBusy}
                  />
                  Select all archive-ready
                </label>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  {selectedRetireItems.length} selected
                </span>
              </div>

              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }} />
                      <th>Article</th>
                      <th>Scope</th>
                      <th>Status</th>
                      <th>Zendesk</th>
                      <th>Retired</th>
                    </tr>
                  </thead>
                  <tbody>
                    {retireItems.map((item) => {
                      const tone = retireTone(item);
                      const detailLine = item.remoteRetireMessage ?? item.blockedReason ?? tone.detail;
                      return (
                        <tr key={item.proposalId}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedRetireProposalIds.includes(item.proposalId)}
                              onChange={() => handleToggleRetireProposal(item.proposalId)}
                              disabled={!item.canArchive || isBusy}
                              aria-label={`Select retire action for ${item.familyTitle}`}
                            />
                          </td>
                          <td>
                            <div style={{ fontWeight: 'var(--weight-medium)' }}>{item.familyTitle}</div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 4 }}>
                              Proposal {item.proposalId.slice(0, 8)}
                            </div>
                          </td>
                          <td>
                            <Badge variant="neutral">{item.locale ?? 'All locales'}</Badge>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                              <Badge variant={tone.badge}>{tone.label}</Badge>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                                {tone.badge === 'danger'
                                  ? <IconAlertCircle size={12} />
                                  : <IconCheckCircle size={12} />}
                                {detailLine}
                              </span>
                            </div>
                          </td>
                          <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                            {item.externalKey ? (
                              <>
                                <div>{item.externalKey}</div>
                                <div style={{ fontSize: 'var(--text-xs)' }}>
                                  Article {item.zendeskArticleId}
                                </div>
                              </>
                            ) : (
                              'Not linked'
                            )}
                          </td>
                          <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                            <div>Local {relativeTime(item.localRetiredAtUtc)}</div>
                            {item.remoteAttemptedAtUtc && (
                              <div style={{ fontSize: 'var(--text-xs)' }}>
                                Remote attempt {relativeTime(item.remoteAttemptedAtUtc)}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {latestJob?.job && (
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <div>
                <div style={{ fontWeight: 'var(--weight-medium)' }}>Latest publish run</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                    <IconClock size={12} />
                    Started {relativeTime(latestJob.job.startedAtUtc ?? latestJob.job.enqueuedAtUtc)}
                  </span>
                </div>
              </div>
              <Badge variant={latestJob.job.status === 'completed' ? 'success' : latestJob.job.status === 'running' ? 'primary' : latestJob.job.status === 'queued' ? 'neutral' : 'danger'}>
                {latestJob.job.status}
              </Badge>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
              <Badge variant="success">{latestJob.summary.succeeded} succeeded</Badge>
              {latestJob.summary.failed > 0 && <Badge variant="danger">{latestJob.summary.failed} failed</Badge>}
              {latestJob.summary.blocked > 0 && <Badge variant="warning">{latestJob.summary.blocked} blocked</Badge>}
              {latestJob.summary.conflicted > 0 && <Badge variant="danger">{latestJob.summary.conflicted} conflicted</Badge>}
              {latestJob.summary.running > 0 && <Badge variant="primary">{latestJob.summary.running} running</Badge>}
              {latestJob.summary.queued > 0 && <Badge variant="neutral">{latestJob.summary.queued} queued</Badge>}
            </div>

            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Article</th>
                    <th>Locale</th>
                    <th>Status</th>
                    <th>Zendesk</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {latestJob.items.map((item) => {
                    const badge = jobStatusBadge(item.status);
                    return (
                      <tr key={item.id}>
                        <td>
                          <div style={{ fontWeight: 'var(--weight-medium)' }}>{item.familyTitle}</div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>{item.branchName}</div>
                        </td>
                        <td><Badge variant="neutral">{item.locale}</Badge></td>
                        <td><Badge variant={badge.variant}>{badge.label}</Badge></td>
                        <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                          {item.zendeskArticleId ?? '—'}
                        </td>
                        <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                          {item.resultMessage ?? item.issues[0]?.message ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      <ConfirmationDialog
        open={liveConfirmOpen}
        onClose={() => setLiveConfirmOpen(false)}
        onConfirm={async () => {
          setLiveConfirmOpen(false);
          await handlePublish('live');
        }}
        title="Push Selected Branches Live?"
        message={(
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div>
              This will publish {selectedPublishable.length} selected branch{selectedPublishable.length === 1 ? '' : 'es'} live to Zendesk.
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
              Live publish is blocked whenever validation warnings are still present.
            </div>
          </div>
        )}
        confirmText="Push Live"
        cancelText="Cancel"
        variant="primary"
        isProcessing={isBusy}
      />
      <ConfirmationDialog
        open={retireConfirmOpen}
        onClose={() => setRetireConfirmOpen(false)}
        onConfirm={async () => {
          setRetireConfirmOpen(false);
          await handleArchiveRetires();
        }}
        title="Archive Selected Retire Actions?"
        message={(
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div>
              This will archive {selectedRetireItems.length} selected retire action{selectedRetireItems.length === 1 ? '' : 's'} in Zendesk.
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
              Archived Zendesk articles can still be restored later from Guide if needed.
            </div>
          </div>
        )}
        confirmText="Archive in Zendesk"
        cancelText="Cancel"
        variant="danger"
        isProcessing={isBusy}
      />
    </>
  );
};
