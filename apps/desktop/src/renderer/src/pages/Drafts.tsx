import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { IconGitBranch } from '../components/icons';

export const Drafts = () => {
  const drafts = [
    { id: 'br-001', article: 'Create & Edit Chat Channels', branch: 'batch-42-update', base: 'rev-0003', status: 'active' as const, locale: 'en-US', updated: '2 hours ago' },
    { id: 'br-002', article: 'Team Dashboard Tile Assignment', branch: 'new-article', base: 'N/A', status: 'draft' as const, locale: 'en-US', updated: '3 hours ago' },
    { id: 'br-003', article: 'Getting Started Guide', branch: 'batch-42-edit', base: 'rev-0012', status: 'active' as const, locale: 'en-US', updated: '1 day ago' },
    { id: 'br-004', article: 'Role Permissions', branch: 'conflict-fix', base: 'rev-0005', status: 'conflicted' as const, locale: 'en-US', updated: '3 days ago' },
    { id: 'br-005', article: 'Chat Notifications', branch: 'batch-41-update', base: 'rev-0002', status: 'pending' as const, locale: 'es-ES', updated: '5 days ago' },
  ];

  return (
    <>
      <PageHeader
        title="Drafts"
        subtitle={`${drafts.length} active draft branches`}
      />
      <div className="route-content">
        {drafts.length === 0 ? (
          <EmptyState
            icon={<IconGitBranch size={48} />}
            title="No draft branches"
            description="Accept proposals from a batch review or create a draft branch from any article to start editing."
          />
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Branch</th>
                  <th>Base</th>
                  <th>Locale</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.id} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 'var(--weight-medium)' }}>{d.article}</td>
                    <td><code style={{ fontSize: 'var(--text-xs)', background: 'var(--color-bg-muted)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>{d.branch}</code></td>
                    <td style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>{d.base}</td>
                    <td><Badge variant="neutral">{d.locale}</Badge></td>
                    <td><StatusChip status={d.status} /></td>
                    <td style={{ color: 'var(--color-text-secondary)' }}>{d.updated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};
