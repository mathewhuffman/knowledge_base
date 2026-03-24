import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AppRoute } from '@kb-vault/shared-types';
import { IconHome, IconFolder, IconUpload, IconCheckCircle, IconGitBranch, IconSend, IconLayout, IconSettings, IconChevronDown, } from './icons';
const mainNav = [
    { id: AppRoute.KB_VAULT_HOME, label: 'Home', icon: _jsx(IconHome, {}) },
    { id: AppRoute.ARTICLE_EXPLORER, label: 'Articles', icon: _jsx(IconFolder, {}) },
    { id: AppRoute.PBI_BATCHES, label: 'PBI Batches', icon: _jsx(IconUpload, {}) },
    { id: AppRoute.PROPOSAL_REVIEW, label: 'Proposal Review', icon: _jsx(IconCheckCircle, {}) },
    { id: AppRoute.DRAFTS, label: 'Drafts', icon: _jsx(IconGitBranch, {}) },
    { id: AppRoute.PUBLISH_QUEUE, label: 'Publish Queue', icon: _jsx(IconSend, {}) },
];
const toolsNav = [
    { id: AppRoute.TEMPLATES_AND_PROMPTS, label: 'Templates & Prompts', icon: _jsx(IconLayout, {}) },
    { id: AppRoute.SETTINGS, label: 'Settings', icon: _jsx(IconSettings, {}) },
];
export function Sidebar({ activeRoute, onNavigate, workspaceName, isConnected }) {
    return (_jsxs("aside", { className: "sidebar", role: "navigation", "aria-label": "Main navigation", children: [_jsx("div", { className: "sidebar-header", children: _jsxs("div", { className: "sidebar-logo", children: [_jsx("div", { className: "sidebar-logo-icon", "aria-hidden": "true", children: "KB" }), _jsx("span", { className: "sidebar-logo-text", children: "KB Vault" })] }) }), _jsxs("button", { className: "workspace-selector", onClick: () => onNavigate(AppRoute.WORKSPACE_SWITCHER), "aria-label": "Switch workspace", children: [_jsx("span", { className: "workspace-selector-dot", style: { background: isConnected ? undefined : 'var(--gray-500)' } }), _jsx("span", { className: "workspace-selector-name", children: workspaceName || 'No workspace' }), _jsx(IconChevronDown, { size: 12, className: "workspace-selector-chevron" })] }), _jsxs("nav", { className: "sidebar-nav", children: [_jsxs("div", { className: "nav-section", children: [_jsx("div", { className: "nav-section-label", children: "Workflow" }), mainNav.map((item) => (_jsxs("button", { className: `nav-item ${activeRoute === item.id ? 'active' : ''}`, onClick: () => onNavigate(item.id), "aria-current": activeRoute === item.id ? 'page' : undefined, children: [_jsx("span", { className: "nav-item-icon", children: item.icon }), _jsx("span", { className: "nav-item-label", children: item.label }), item.badge && _jsx("span", { className: "nav-item-badge", children: item.badge })] }, item.id)))] }), _jsxs("div", { className: "nav-section", style: { marginTop: 'var(--space-2)' }, children: [_jsx("div", { className: "nav-section-label", children: "Tools" }), toolsNav.map((item) => (_jsxs("button", { className: `nav-item ${activeRoute === item.id ? 'active' : ''}`, onClick: () => onNavigate(item.id), "aria-current": activeRoute === item.id ? 'page' : undefined, children: [_jsx("span", { className: "nav-item-icon", children: item.icon }), _jsx("span", { className: "nav-item-label", children: item.label })] }, item.id)))] })] }), _jsx("div", { className: "sidebar-footer", children: _jsxs("div", { className: "sidebar-footer-item", children: [_jsx("span", { className: "status-chip-dot", style: {
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: isConnected ? 'var(--color-success)' : 'var(--gray-500)',
                            } }), _jsx("span", { style: { fontSize: 'var(--text-xs)', opacity: 0.6 }, children: isConnected ? 'Connected' : 'Offline' })] }) })] }));
}
