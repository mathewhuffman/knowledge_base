import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Badge } from '../components/Badge';
import { Kbd } from '../components/Kbd';
import { IconCheckCircle } from '../components/icons';

export const ProposalReview = () => {
  const [currentIndex] = useState(0);

  const proposals = [
    {
      id: 'prop-001',
      type: 'EDIT_ARTICLE',
      article: 'Create & Edit Chat Channels',
      confidence: 0.87,
      pbiCount: 3,
      summary: 'Update steps 4-6 to reflect new channel creation flow with Team Dashboard integration.',
    },
    {
      id: 'prop-002',
      type: 'CREATE_ARTICLE',
      article: 'Team Dashboard Tile Assignment',
      confidence: 0.92,
      pbiCount: 2,
      summary: 'New article covering tile assignment and customization in the redesigned Team Dashboard.',
    },
    {
      id: 'prop-003',
      type: 'NO_IMPACT',
      article: 'Getting Started Guide',
      confidence: 0.95,
      pbiCount: 1,
      summary: 'Backend optimization PBI — no user-facing documentation changes needed.',
    },
  ];

  const typeVariant = (t: string) => {
    if (t === 'CREATE_ARTICLE') return 'success' as const;
    if (t === 'EDIT_ARTICLE') return 'primary' as const;
    if (t === 'RETIRE_ARTICLE') return 'danger' as const;
    return 'neutral' as const;
  };

  const typeLabel = (t: string) => {
    if (t === 'CREATE_ARTICLE') return 'Create';
    if (t === 'EDIT_ARTICLE') return 'Edit';
    if (t === 'RETIRE_ARTICLE') return 'Retire';
    return 'No Impact';
  };

  const current = proposals[currentIndex];

  return (
    <>
      <PageHeader
        title="Proposal Review"
        subtitle={`Sprint 42 PBIs — ${proposals.length} proposals`}
        actions={
          <div className="flex items-center gap-3">
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
              {currentIndex + 1} of {proposals.length}
            </span>
            <div className="progress-bar" style={{ width: 100 }}>
              <div className="progress-bar-fill" style={{ width: `${((currentIndex + 1) / proposals.length) * 100}%` }} />
            </div>
          </div>
        }
      />
      <div className="route-content">
        {proposals.length === 0 ? (
          <EmptyState
            icon={<IconCheckCircle size={48} />}
            title="No proposals to review"
            description="Import a PBI batch and run analysis to generate proposals for your KB articles."
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 280px', gap: 'var(--space-4)', height: '100%' }}>
            {/* Left: proposal queue */}
            <div className="card" style={{ overflow: 'auto' }}>
              <div className="card-header">
                <span className="card-header-title">Proposals</span>
              </div>
              <div style={{ padding: 'var(--space-2)' }}>
                {proposals.map((p, i) => (
                  <div
                    key={p.id}
                    style={{
                      padding: 'var(--space-3)',
                      borderRadius: 'var(--radius-md)',
                      background: i === currentIndex ? 'var(--color-primary-subtle)' : 'transparent',
                      cursor: 'pointer',
                      marginBottom: 2,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                      <Badge variant={typeVariant(p.type)}>{typeLabel(p.type)}</Badge>
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)' }}>{p.article}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Center: preview area */}
            <div className="card">
              <div className="card-header">
                <span className="card-header-title">{current.article}</span>
                <Badge variant={typeVariant(current.type)}>{typeLabel(current.type)}</Badge>
              </div>
              <div className="card-body">
                <div className="panel" style={{ minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                    Article preview / diff will render here
                  </span>
                </div>

                <div className="tab-bar" style={{ marginTop: 'var(--space-4)' }}>
                  <div className="tab-item active">Preview</div>
                  <div className="tab-item">Diff</div>
                  <div className="tab-item">Source</div>
                </div>
              </div>
            </div>

            {/* Right: evidence + actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className="card card-padded">
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 'var(--space-2)' }}>Confidence</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <div className="progress-bar" style={{ flex: 1 }}>
                    <div className="progress-bar-fill" style={{ width: `${current.confidence * 100}%` }} />
                  </div>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>
                    {Math.round(current.confidence * 100)}%
                  </span>
                </div>
              </div>

              <div className="card card-padded">
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 'var(--space-2)' }}>AI Summary</div>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)', lineHeight: 'var(--leading-normal)' }}>
                  {current.summary}
                </p>
              </div>

              <div className="card card-padded">
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 'var(--space-2)' }}>
                  Triggering PBIs ({current.pbiCount})
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  PBI evidence will display here
                </div>
              </div>

              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <button className="btn btn-primary" style={{ width: '100%' }}>Accept</button>
                <button className="btn btn-danger" style={{ width: '100%' }}>Deny</button>
                <button className="btn btn-secondary" style={{ width: '100%' }}>Defer</button>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
                  <Kbd keys="A" /> <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>accept</span>
                  <Kbd keys="D" /> <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>deny</span>
                  <Kbd keys="S" /> <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>skip</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
