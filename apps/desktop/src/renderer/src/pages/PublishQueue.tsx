import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Badge } from '../components/Badge';
import { IconSend } from '../components/icons';

export const PublishQueue = () => {
  const queue = [
    { id: 'br-002', article: 'Team Dashboard Tile Assignment', branch: 'new-article', type: 'Create', locale: 'en-US', valid: true },
    { id: 'br-001', article: 'Create & Edit Chat Channels', branch: 'batch-42-update', type: 'Update', locale: 'en-US', valid: true },
    { id: 'br-003', article: 'Getting Started Guide', branch: 'batch-42-edit', type: 'Update', locale: 'en-US', valid: false },
  ];

  const validCount = queue.filter(q => q.valid).length;

  return (
    <>
      <PageHeader
        title="Publish Queue"
        subtitle={`${queue.length} branches selected`}
        actions={
          <button className="btn btn-primary" disabled={validCount === 0}>
            <IconSend size={14} />
            Publish {validCount} to Zendesk
          </button>
        }
      />
      <div className="route-content">
        {queue.length === 0 ? (
          <EmptyState
            icon={<IconSend size={48} />}
            title="Nothing to publish"
            description="Mark draft branches as ready, then add them here to publish to Zendesk."
          />
        ) : (
          <>
            <div className="panel" style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Badge variant="success">{validCount} ready</Badge>
              {queue.length - validCount > 0 && (
                <Badge variant="warning">{queue.length - validCount} has warnings</Badge>
              )}
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginLeft: 'auto' }}>
                Pre-publish validation will run before pushing to Zendesk
              </span>
            </div>

            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th>Article</th>
                    <th>Branch</th>
                    <th>Type</th>
                    <th>Locale</th>
                    <th>Valid</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((q) => (
                    <tr key={q.id}>
                      <td><input type="checkbox" defaultChecked={q.valid} /></td>
                      <td style={{ fontWeight: 'var(--weight-medium)' }}>{q.article}</td>
                      <td><code style={{ fontSize: 'var(--text-xs)', background: 'var(--color-bg-muted)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>{q.branch}</code></td>
                      <td><Badge variant={q.type === 'Create' ? 'success' : 'primary'}>{q.type}</Badge></td>
                      <td><Badge variant="neutral">{q.locale}</Badge></td>
                      <td>{q.valid ? <Badge variant="success">Pass</Badge> : <Badge variant="warning">Warnings</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
};
