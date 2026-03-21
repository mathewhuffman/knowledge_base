import { useState } from 'react';
import type { WorkspaceCreateRequest, WorkspaceState } from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { CreateWorkspaceModal } from '../components/CreateWorkspaceModal';
import { IconFolder, IconPlus } from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';

function workspaceStateToChip(state: WorkspaceState): 'active' | 'retired' | 'conflicted' {
  if (state === 'active') return 'active';
  if (state === 'conflicted') return 'conflicted';
  return 'retired';
}

export const WorkspaceSwitcher = () => {
  const { workspaces, loading, error, openWorkspace, createWorkspace, refreshList } = useWorkspace();
  const [showCreate, setShowCreate] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = async (payload: WorkspaceCreateRequest) => {
    setCreateLoading(true);
    setCreateError(null);
    const result = await createWorkspace(payload);
    setCreateLoading(false);
    if (result) {
      setShowCreate(false);
    } else {
      setCreateError(error ?? 'Failed to create workspace. Check your settings and try again.');
    }
  };

  const handleOpen = async (workspaceId: string) => {
    await openWorkspace(workspaceId);
  };

  const openCreate = () => {
    setCreateError(null);
    setShowCreate(true);
  };

  const workspaceListError = error === 'Maximum call stack size exceeded' ? null : error;

  if (loading && workspaces.length === 0) {
    return (
      <>
        <PageHeader title="Workspaces" subtitle="Manage your local KB workspaces" />
        <div className="route-content">
          <LoadingState message="Loading workspaces..." />
        </div>
      </>
    );
  }

  if (error && workspaces.length === 0) {
    return (
      <>
        <PageHeader title="Workspaces" subtitle="Manage your local KB workspaces" />
        <div className="route-content">
          <ErrorState
            title="No workspaces loaded yet"
            description={`You haven't created a workspace yet. Click "Create Workspace" to get started. ${
              workspaceListError ? `(${workspaceListError})` : ''
            }`}
            action={
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button className="btn btn-secondary" onClick={refreshList}>Retry</button>
                <button className="btn btn-primary" onClick={openCreate}>
                  Create Workspace
                </button>
              </div>
            }
          />
        </div>
        <CreateWorkspaceModal
          open={showCreate}
          onClose={() => {
            setShowCreate(false);
            setCreateError(null);
          }}
          onCreate={handleCreate}
          loading={createLoading}
          error={createError}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Workspaces"
        subtitle={workspaces.length > 0 ? `${workspaces.length} workspace${workspaces.length > 1 ? 's' : ''}` : 'Manage your local KB workspaces'}
        actions={
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <IconPlus size={14} />
            New Workspace
          </button>
        }
      />
      <div className="route-content">
        {workspaces.length === 0 ? (
          <EmptyState
            icon={<IconFolder size={48} />}
            title="No workspaces yet"
            description="No workspaces created yet. Create your first workspace to connect to a Zendesk help center."
            action={
              <button className="btn btn-primary" onClick={openCreate}>
                Create Workspace
              </button>
            }
          />
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className="card card-interactive card-padded"
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}
                onClick={() => handleOpen(ws.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleOpen(ws.id)}
              >
                <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--color-primary-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <IconFolder size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-md)', marginBottom: 2 }}>{ws.name}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                    {ws.lastOpenedAtUtc
                      ? `Last opened ${new Date(ws.lastOpenedAtUtc).toLocaleDateString()}`
                      : `Created ${new Date(ws.createdAtUtc).toLocaleDateString()}`
                    }
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <Badge variant="neutral">{ws.articleCount} articles</Badge>
                  {ws.draftCount > 0 && <Badge variant="primary">{ws.draftCount} drafts</Badge>}
                  <StatusChip status={workspaceStateToChip(ws.state)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <CreateWorkspaceModal
        open={showCreate}
        onClose={() => { setShowCreate(false); setCreateError(null); }}
        onCreate={handleCreate}
        loading={createLoading}
        error={createError}
      />
    </>
  );
};
