import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Badge } from '../components/Badge';
import { IconUpload, IconPlus } from '../components/icons';

export const PBI = () => {
  const batches = [
    { id: 'batch-042', name: 'Sprint 42 PBIs', date: 'Mar 19, 2026', rows: 47, candidates: 38, status: 'REVIEW_IN_PROGRESS', proposals: 12 },
    { id: 'batch-041', name: 'Sprint 41 PBIs', date: 'Mar 12, 2026', rows: 32, candidates: 28, status: 'REVIEW_COMPLETE', proposals: 9 },
    { id: 'batch-hf1', name: 'Hotfix batch', date: 'Mar 10, 2026', rows: 5, candidates: 5, status: 'REVIEW_COMPLETE', proposals: 3 },
  ];

  const statusVariant = (s: string) => {
    if (s === 'REVIEW_COMPLETE') return 'success' as const;
    if (s === 'REVIEW_IN_PROGRESS') return 'warning' as const;
    if (s === 'ANALYZED') return 'primary' as const;
    return 'neutral' as const;
  };

  const statusLabel = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());

  return (
    <>
      <PageHeader
        title="PBI Batches"
        subtitle="Import and analyze bulk product backlog items"
        actions={
          <button className="btn btn-primary">
            <IconPlus size={14} />
            Import Batch
          </button>
        }
      />
      <div className="route-content">
        {batches.length === 0 ? (
          <EmptyState
            icon={<IconUpload size={48} />}
            title="No batches imported"
            description="Upload a CSV export from Azure DevOps to start analyzing product backlog items against your KB articles."
            action={<button className="btn btn-primary">Import CSV</button>}
          />
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Date</th>
                  <th>Rows</th>
                  <th>Candidates</th>
                  <th>Proposals</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 'var(--weight-medium)' }}>{b.name}</td>
                    <td style={{ color: 'var(--color-text-secondary)' }}>{b.date}</td>
                    <td>{b.rows}</td>
                    <td>{b.candidates}</td>
                    <td>{b.proposals}</td>
                    <td><Badge variant={statusVariant(b.status)}>{statusLabel(b.status)}</Badge></td>
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
