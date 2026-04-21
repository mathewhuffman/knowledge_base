import { useEffect } from 'react';
import { DraftBranchStatus, type DraftBranchListResponse, type DraftBranchSummary } from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/Badge';
import { IconAlertCircle, IconCheckCircle, IconGitBranch, IconSend } from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc } from '../hooks/useIpc';

function summarizeValidation(branch: DraftBranchSummary): {
  badge: 'success' | 'warning' | 'danger' | 'primary';
  label: string;
  detail: string;
} {
  const { errors, warnings, infos } = branch.validationSummary;
  if (errors > 0) {
    return {
      badge: 'danger',
      label: 'Blocked',
      detail: `${errors} error${errors === 1 ? '' : 's'}`
    };
  }
  if (warnings > 0) {
    return {
      badge: 'warning',
      label: 'Warnings',
      detail: `${warnings} warning${warnings === 1 ? '' : 's'}`
    };
  }
  if (infos > 0) {
    return {
      badge: 'primary',
      label: 'Info',
      detail: `${infos} note${infos === 1 ? '' : 's'}`
    };
  }
  return {
    badge: 'success',
    label: 'Pass',
    detail: 'No validation issues'
  };
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const PublishQueue = () => {
  const { activeWorkspace } = useWorkspace();
  const listQuery = useIpc<DraftBranchListResponse>('draft.branch.list');
  const { execute: executeList } = listQuery;

  useEffect(() => {
    if (!activeWorkspace) return;
    void executeList({ workspaceId: activeWorkspace.id });
  }, [activeWorkspace, executeList]);

  if (!activeWorkspace) {
    return (
      <>
        <PageHeader title="Publish Queue" subtitle="Open a workspace to review ready drafts." />
        <div className="route-content">
          <EmptyState
            icon={<IconSend size={48} />}
            title="No workspace selected"
            description="Choose a workspace to load publish-ready draft branches."
          />
        </div>
      </>
    );
  }

  if (listQuery.loading && !listQuery.data) {
    return (
      <>
        <PageHeader title="Publish Queue" subtitle="Loading ready branches" />
        <div className="route-content">
          <LoadingState message="Collecting draft branches that are marked ready to publish." />
        </div>
      </>
    );
  }

  if (listQuery.error && !listQuery.data) {
    return (
      <>
        <PageHeader title="Publish Queue" subtitle="Unable to load publish queue" />
        <div className="route-content">
          <ErrorState title="Publish queue loading failed" description={listQuery.error} />
        </div>
      </>
    );
  }

  const queue = (listQuery.data?.branches ?? []).filter((branch) => branch.status === DraftBranchStatus.READY_TO_PUBLISH);
  const cleanCount = queue.filter((branch) => branch.validationSummary.errors === 0 && branch.validationSummary.warnings === 0).length;
  const warningCount = queue.filter((branch) => branch.validationSummary.errors === 0 && branch.validationSummary.warnings > 0).length;
  const blockedCount = queue.filter((branch) => branch.validationSummary.errors > 0).length;

  return (
    <>
      <PageHeader
        title="Publish Queue"
        subtitle={`${queue.length} ready branch${queue.length === 1 ? '' : 'es'} in ${activeWorkspace.name}`}
        actions={
          <button className="btn btn-primary" disabled title="Zendesk publishing is not wired yet.">
            <IconSend size={14} />
            Publish to Zendesk
          </button>
        }
      />
      <div className="route-content">
        {queue.length === 0 ? (
          <EmptyState
            icon={<IconGitBranch size={48} />}
            title="Nothing in the queue"
            description="Mark draft branches as ready in Drafts and they will appear here automatically."
          />
        ) : (
          <>
            <div className="panel" style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <Badge variant="success">{cleanCount} clean</Badge>
              {warningCount > 0 && (
                <Badge variant="warning">{warningCount} with warnings</Badge>
              )}
              {blockedCount > 0 && (
                <Badge variant="danger">{blockedCount} blocked</Badge>
              )}
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginLeft: 'auto' }}>
                Queue data is live. Zendesk publish calls still need the write-side integration.
              </span>
            </div>

            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Article</th>
                    <th>Branch</th>
                    <th>Locale</th>
                    <th>Revision</th>
                    <th>Validation</th>
                    <th>Last Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((branch) => {
                    const validation = summarizeValidation(branch);
                    return (
                      <tr key={branch.id}>
                        <td>
                          <div style={{ fontWeight: 'var(--weight-medium)' }}>{branch.familyTitle}</div>
                          {branch.changeSummary && (
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 4 }}>
                              {branch.changeSummary}
                            </div>
                          )}
                        </td>
                        <td>
                          <code style={{ fontSize: 'var(--text-xs)', background: 'var(--color-bg-muted)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>
                            {branch.name}
                          </code>
                        </td>
                        <td><Badge variant="neutral">{branch.locale}</Badge></td>
                        <td>
                          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                            base r{branch.baseRevisionNumber ?? '—'}{' -> '}head r{branch.headRevisionNumber}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                            <Badge variant={validation.badge}>{validation.label}</Badge>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                              {validation.badge === 'danger'
                                ? <IconAlertCircle size={12} />
                                : <IconCheckCircle size={12} />}
                              {validation.detail}
                            </span>
                          </div>
                        </td>
                        <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                          {relativeTime(branch.updatedAtUtc)}
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
    </>
  );
};
