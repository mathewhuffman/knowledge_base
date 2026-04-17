import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { Modal } from './Modal';
const LOCALE_OPTIONS = [
    { value: 'en-us', label: 'English (en-US)' },
    { value: 'es-es', label: 'Spanish (es-ES)' },
    { value: 'fr-fr', label: 'French (fr-FR)' },
    { value: 'de-de', label: 'German (de-DE)' },
    { value: 'pt-br', label: 'Portuguese (pt-BR)' },
    { value: 'ja-jp', label: 'Japanese (ja-JP)' },
];
export function CreateWorkspaceModal({ open, onClose, onCreate, loading, error }) {
    const [name, setName] = useState('');
    const [zendeskSubdomain, setZendeskSubdomain] = useState('');
    const [defaultLocale, setDefaultLocale] = useState('en-us');
    const [enabledLocales, setEnabledLocales] = useState(['en-us']);
    const handleToggleLocale = (locale) => {
        if (locale === defaultLocale)
            return; // can't disable default
        setEnabledLocales((prev) => prev.includes(locale) ? prev.filter((l) => l !== locale) : [...prev, locale]);
    };
    const handleSubmit = async (event) => {
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
    return (_jsx(Modal, { open: open, onClose: onClose, title: "Create Workspace", footer: _jsx(_Fragment, { children: _jsx("button", { className: "btn btn-secondary", onClick: onClose, disabled: loading, children: "Cancel" }) }), children: _jsxs("form", { onSubmit: handleSubmit, style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }, children: [_jsxs("div", { children: [_jsxs("label", { style: { display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }, children: ["Workspace Name ", _jsx("span", { style: { color: 'var(--color-danger)' }, children: "*" })] }), _jsx("input", { className: "input", value: name, onChange: (e) => setName(e.target.value), placeholder: "e.g. Acme Help Center", autoFocus: true }), _jsx("div", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }, children: "A friendly name for this help center workspace" })] }), _jsxs("div", { children: [_jsxs("label", { style: { display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }, children: ["Zendesk Subdomain ", _jsx("span", { style: { color: 'var(--color-danger)' }, children: "*" })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 0 }, children: [_jsx("input", { className: "input", value: zendeskSubdomain, onChange: (e) => setZendeskSubdomain(e.target.value), placeholder: "your-company", style: { borderTopRightRadius: 0, borderBottomRightRadius: 0 } }), _jsx("span", { style: {
                                        padding: 'var(--space-2) var(--space-3)',
                                        background: 'var(--color-bg-muted)',
                                        border: '1px solid var(--color-border-strong)',
                                        borderLeft: 'none',
                                        borderRadius: '0 var(--radius-md) var(--radius-md) 0',
                                        fontSize: 'var(--text-sm)',
                                        color: 'var(--color-text-secondary)',
                                        whiteSpace: 'nowrap',
                                    }, children: ".zendesk.com" })] })] }), _jsxs("div", { children: [_jsx("label", { style: { display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-1)' }, children: "Default Locale" }), _jsx("select", { className: "select", value: defaultLocale, onChange: (e) => {
                                setDefaultLocale(e.target.value);
                                // Ensure default is always enabled
                                if (!enabledLocales.includes(e.target.value)) {
                                    setEnabledLocales((prev) => [...prev, e.target.value]);
                                }
                            }, children: LOCALE_OPTIONS.map((opt) => (_jsx("option", { value: opt.value, children: opt.label }, opt.value))) })] }), _jsxs("div", { children: [_jsx("label", { style: { display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-2)' }, children: "Enabled Locales" }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }, children: LOCALE_OPTIONS.map((opt) => (_jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', cursor: 'pointer' }, children: [_jsx("input", { type: "checkbox", checked: enabledLocales.includes(opt.value), onChange: () => handleToggleLocale(opt.value), disabled: opt.value === defaultLocale }), _jsx("span", { children: opt.label }), opt.value === defaultLocale && (_jsx("span", { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }, children: "(default)" }))] }, opt.value))) })] }), error && (_jsx("div", { style: { padding: 'var(--space-3)', background: 'var(--color-danger-bg)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', color: 'var(--color-danger)' }, children: error })), _jsx("div", { style: { display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }, children: _jsx("button", { className: "btn btn-primary", type: "submit", disabled: !isValid || loading, children: loading ? 'Creating...' : 'Create Workspace' }) })] }) }));
}
