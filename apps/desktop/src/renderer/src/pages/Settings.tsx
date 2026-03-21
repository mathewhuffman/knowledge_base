import { useState, useEffect } from 'react';
import type { WorkspaceSettingsRecord, RepositoryStructurePayload } from '@kb-vault/shared-types';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { Badge } from '../components/Badge';
import { StatusChip } from '../components/StatusChip';
import { IconSettings } from '../components/icons';
import { useWorkspace } from '../context/WorkspaceContext';
import { useIpc } from '../hooks/useIpc';
import { useIpcMutation } from '../hooks/useIpc';

const LOCALE_OPTIONS = [
  { value: 'en-us', label: 'English (en-US)' },
  { value: 'es-es', label: 'Spanish (es-ES)' },
  { value: 'fr-fr', label: 'French (fr-FR)' },
  { value: 'de-de', label: 'German (de-DE)' },
  { value: 'pt-br', label: 'Portuguese (pt-BR)' },
  { value: 'ja-jp', label: 'Japanese (ja-JP)' },
];

export const Settings = () => {
  const { activeWorkspace } = useWorkspace();
  const settingsQuery = useIpc<WorkspaceSettingsRecord>('workspace.settings.get');
  const repoQuery = useIpc<RepositoryStructurePayload>('workspace.repository.info');
  const settingsMutation = useIpcMutation<WorkspaceSettingsRecord>('workspace.settings.update');

  const [activeSection, setActiveSection] = useState('zendesk');

  // Form state for locale settings
  const [defaultLocale, setDefaultLocale] = useState('');
  const [enabledLocales, setEnabledLocales] = useState<string[]>([]);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (activeWorkspace) {
      settingsQuery.execute({ workspaceId: activeWorkspace.id });
      repoQuery.execute({ workspaceId: activeWorkspace.id });
    }
  }, [activeWorkspace?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync form state from fetched settings
  useEffect(() => {
    if (settingsQuery.data) {
      setDefaultLocale(settingsQuery.data.defaultLocale);
      setEnabledLocales(settingsQuery.data.enabledLocales);
    }
  }, [settingsQuery.data]);

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

  const sections = [
    { id: 'zendesk', label: 'Zendesk Connection' },
    { id: 'locales', label: 'Locales' },
    { id: 'ai', label: 'AI Runtime' },
    { id: 'workspace', label: 'Workspace' },
    { id: 'storage', label: 'Storage' },
    { id: 'about', label: 'About' },
  ];

  if (!activeWorkspace) {
    return (
      <>
        <PageHeader title="Settings" subtitle="No workspace selected" />
        <div className="route-content">
          <EmptyState
            icon={<IconSettings size={48} />}
            title="No workspace open"
            description="Open a workspace to configure its settings."
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settings" subtitle={activeWorkspace.name} />
      <div className="route-content" style={{ display: 'flex', gap: 'var(--space-6)' }}>
        <div style={{ width: 180, flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {sections.map((s) => (
              <button key={s.id} className={`btn ${activeSection === s.id ? 'btn-secondary' : 'btn-ghost'} btn-sm`} style={{ justifyContent: 'flex-start', width: '100%' }} onClick={() => setActiveSection(s.id)}>{s.label}</button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, maxWidth: 600 }}>
          {activeSection === 'zendesk' && (
            <div>
              <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-4)' }}>Zendesk Connection</h3>
              <div className="card card-padded" style={{ marginBottom: 'var(--space-4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                  <span style={{ fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-sm)' }}>Connection Status</span>
                  <StatusChip status="pending" label="Not synced" />
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                  {settingsQuery.data?.zendeskSubdomain
                    ? `${settingsQuery.data.zendeskSubdomain}.zendesk.com`
                    : 'No subdomain configured'}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }}>Subdomain</label>
                  <input className="input" defaultValue={settingsQuery.data?.zendeskSubdomain ?? ''} placeholder="your-company" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }}>Email</label>
                  <input className="input" placeholder="your-email@company.com" />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }}>API Token</label>
                  <input className="input" type="password" placeholder="Zendesk API token" />
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>Stored securely in your OS keychain</div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button className="btn btn-secondary">Test Connection</button>
                  <button className="btn btn-primary">Save</button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'locales' && (
            <div>
              <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-4)' }}>Locale Configuration</h3>

              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }}>Default Locale</label>
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
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-2)' }}>Enabled Locales</label>
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
                {saveSuccess && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-success)' }}>Saved!</span>}
                {settingsMutation.error && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-danger)' }}>{settingsMutation.error}</span>}
              </div>
            </div>
          )}

          {activeSection === 'ai' && (
            <div>
              <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-4)' }}>AI Runtime</h3>
              <div className="card card-padded">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                  <span style={{ fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-sm)' }}>Cursor ACP</span>
                  <StatusChip status="pending" label="Not configured" />
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>Cursor ACP integration will be configured in Batch 6.</div>
              </div>
            </div>
          )}

          {activeSection === 'workspace' && (
            <div>
              <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-4)' }}>Workspace Settings</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }}>Workspace Name</label>
                  <input className="input" defaultValue={activeWorkspace.name} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }}>Storage Path</label>
                  <input className="input" readOnly value={activeWorkspace.path} style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }}>State</label>
                  <StatusChip status={activeWorkspace.state === 'active' ? 'active' : 'retired'} label={activeWorkspace.state} />
                </div>
              </div>
            </div>
          )}

          {activeSection === 'storage' && (
            <div>
              <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-4)' }}>Local Repository Structure</h3>
              {repoQuery.loading ? (
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Loading...</div>
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
              <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-4)' }}>About KB Vault</h3>
              <div className="card card-padded">
                <div style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}><strong>Version:</strong> 0.1.0</div>
                <div style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}><strong>Workspace ID:</strong> {activeWorkspace.id}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>Local-first Electron desktop application for automating Zendesk KB maintenance from bulk PBI uploads.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
