import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/Badge';
import { IconPlus, IconLayout } from '../components/icons';

export const TemplatesAndPrompts = () => {
  const [activeTab, setActiveTab] = useState<'templates' | 'prompts'>('templates');

  const templates = [
    { name: 'Standard How-To', type: 'how-to', articles: 64, desc: 'Step-by-step instructional article format' },
    { name: 'FAQ', type: 'faq', articles: 23, desc: 'Question-and-answer format for common issues' },
    { name: 'Troubleshooting', type: 'troubleshooting', articles: 18, desc: 'Problem-solution format with diagnostics' },
    { name: 'Policy / Notice', type: 'policy', articles: 12, desc: 'Informational policy or notice format' },
    { name: 'Feature Overview', type: 'overview', articles: 25, desc: 'High-level feature introduction and summary' },
  ];

  return (
    <>
      <PageHeader
        title="Templates & Prompts"
        subtitle="Manage AI generation templates and style guidance"
        actions={
          <button className="btn btn-primary">
            <IconPlus size={14} />
            New Template
          </button>
        }
      />
      <div className="route-content">
        <div className="tab-bar" style={{ marginBottom: 'var(--space-5)' }}>
          <button className={`tab-item ${activeTab === 'templates' ? 'active' : ''}`} onClick={() => setActiveTab('templates')}>
            Article Templates
          </button>
          <button className={`tab-item ${activeTab === 'prompts' ? 'active' : ''}`} onClick={() => setActiveTab('prompts')}>
            Prompt Packs
          </button>
        </div>

        {activeTab === 'templates' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
            {templates.map((t) => (
              <div key={t.name} className="card card-interactive card-padded">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'var(--color-bg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <IconLayout size={18} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', marginBottom: 2 }}>{t.name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>{t.desc}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <Badge variant="neutral">{t.type}</Badge>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{t.articles} articles use this</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'prompts' && (
          <div className="panel" style={{ textAlign: 'center', padding: 'var(--space-10)' }}>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)' }}>
              Prompt packs control how the AI generates and edits articles.
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Prompt pack management will be available after Batch 9.
            </div>
          </div>
        )}
      </div>
    </>
  );
};
