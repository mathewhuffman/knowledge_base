import { type FormEvent, useState } from 'react';
import { Modal } from './Modal';
import type { WorkspaceCreateRequest } from '@kb-vault/shared-types';

interface CreateWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: WorkspaceCreateRequest) => Promise<void>;
  loading?: boolean;
  error?: string | null;
}

const LOCALE_OPTIONS = [
  { value: 'en-us', label: 'English (en-US)' },
  { value: 'es-es', label: 'Spanish (es-ES)' },
  { value: 'fr-fr', label: 'French (fr-FR)' },
  { value: 'de-de', label: 'German (de-DE)' },
  { value: 'pt-br', label: 'Portuguese (pt-BR)' },
  { value: 'ja-jp', label: 'Japanese (ja-JP)' },
];

export function CreateWorkspaceModal({ open, onClose, onCreate, loading, error }: CreateWorkspaceModalProps) {
  const [name, setName] = useState('');
  const [zendeskSubdomain, setZendeskSubdomain] = useState('');
  const [defaultLocale, setDefaultLocale] = useState('en-us');
  const [enabledLocales, setEnabledLocales] = useState<string[]>(['en-us']);

  const handleToggleLocale = (locale: string) => {
    if (locale === defaultLocale) return; // can't disable default
    setEnabledLocales((prev) =>
      prev.includes(locale) ? prev.filter((l) => l !== locale) : [...prev, locale],
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    console.log('[renderer] create-workspace submit', {
      name: name.trim(),
      zendeskSubdomain: zendeskSubdomain.trim(),
      defaultLocale,
      enabledLocales
    });
    await onCreate({
      name: name.trim(),
      zendeskSubdomain: zendeskSubdomain.trim(),
      defaultLocale,
      enabledLocales,
    });
  };

  const isValid = name.trim().length > 0 && zendeskSubdomain.trim().length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Workspace"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {/* Workspace Name */}
        <div>
          <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }}>
            Workspace Name <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Help Center"
            autoFocus
          />
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
            A friendly name for this help center workspace
          </div>
        </div>

        {/* Zendesk Subdomain */}
        <div>
          <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }}>
            Zendesk Subdomain <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            <input
              className="input"
              value={zendeskSubdomain}
              onChange={(e) => setZendeskSubdomain(e.target.value)}
              placeholder="your-company"
              style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
            />
            <span style={{
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--color-bg-muted)',
              border: '1px solid var(--color-border-strong)',
              borderLeft: 'none',
              borderRadius: '0 var(--radius-md) var(--radius-md) 0',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'nowrap',
            }}>
              .zendesk.com
            </span>
          </div>
        </div>

        {/* Default Locale */}
        <div>
          <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }}>
            Default Locale
          </label>
          <select
            className="select"
            value={defaultLocale}
            onChange={(e) => {
              setDefaultLocale(e.target.value);
              // Ensure default is always enabled
              if (!enabledLocales.includes(e.target.value)) {
                setEnabledLocales((prev) => [...prev, e.target.value]);
              }
            }}
          >
            {LOCALE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Enabled Locales */}
        <div>
          <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-2)' }}>
            Enabled Locales
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {LOCALE_OPTIONS.map((opt) => (
              <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={enabledLocales.includes(opt.value)}
                  onChange={() => handleToggleLocale(opt.value)}
                  disabled={opt.value === defaultLocale}
                />
                <span>{opt.label}</span>
                {opt.value === defaultLocale && (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>(default)</span>
                )}
              </label>
            ))}
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div style={{ padding: 'var(--space-3)', background: 'var(--color-danger-bg)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', color: 'var(--color-danger)' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <button className="btn btn-primary" type="submit" disabled={!isValid || loading}>
            {loading ? 'Creating...' : 'Create Workspace'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
