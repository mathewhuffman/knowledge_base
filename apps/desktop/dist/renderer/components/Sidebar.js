import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useRef, useEffect } from 'react';
import { AppRoute } from '@kb-vault/shared-types';
import { IconHome, IconFolder, IconUpload, IconCheckCircle, IconGitBranch, IconSend, IconLayout, IconSettings, IconChevronDown, IconChevronLeft, IconChevronRight, } from './icons';
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
/* Tiny tooltip that appears on hover when the sidebar is collapsed */
function NavTooltip({ label, anchorRef }) {
    const [pos, setPos] = useState({ top: 0, visible: false });
    useEffect(() => {
        const el = anchorRef.current;
        if (!el)
            return;
        const rect = el.getBoundingClientRect();
        setPos({ top: rect.top + rect.height / 2, visible: true });
    }, [anchorRef]);
    if (!pos.visible)
        return null;
    return (_jsx("div", { className: "sidebar-tooltip", style: { top: pos.top }, children: label }));
}
function CollapsibleNavItem({ item, isActive, collapsed, onNavigate, }) {
    const [hovered, setHovered] = useState(false);
    const ref = useRef(null);
    return (_jsxs(_Fragment, { children: [_jsxs("button", { ref: ref, className: `nav-item ${isActive ? 'active' : ''} ${collapsed ? 'nav-item--collapsed' : ''}`, onClick: () => onNavigate(item.id), onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false), "aria-current": isActive ? 'page' : undefined, "aria-label": collapsed ? item.label : undefined, children: [_jsx("span", { className: "nav-item-icon", children: item.icon }), _jsx("span", { className: "nav-item-label", children: item.label }), item.badge && _jsx("span", { className: "nav-item-badge", children: item.badge })] }), collapsed && hovered && _jsx(NavTooltip, { label: item.label, anchorRef: ref })] }));
}
export function Sidebar({ activeRoute, onNavigate, workspaceName, isConnected, collapsed, onToggleCollapse }) {
    const [hasToggled, setHasToggled] = useState(false);
    // Track that the user has toggled at least once (prevents animation on mount)
    const handleToggle = () => {
        if (!hasToggled)
            setHasToggled(true);
        onToggleCollapse();
    };
    return (_jsxs(_Fragment, { children: [_jsxs("aside", { className: `sidebar ${collapsed ? 'sidebar--collapsed' : ''}`, role: "navigation", "aria-label": "Main navigation", "data-has-toggled": hasToggled || undefined, children: [_jsx("svg", { className: "sidebar-goo-defs", "aria-hidden": "true", children: _jsx("defs", { children: _jsxs("filter", { id: "goo-filter", children: [_jsx("feGaussianBlur", { in: "SourceGraphic", stdDeviation: "6", result: "blur" }), _jsx("feColorMatrix", { in: "blur", mode: "matrix", values: "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7", result: "goo" }), _jsx("feComposite", { in: "SourceGraphic", in2: "goo", operator: "atop" })] }) }) }), _jsx("div", { className: "sidebar-header", children: _jsxs("div", { className: "sidebar-logo", children: [_jsx("div", { className: "sidebar-logo-icon", "aria-hidden": "true", children: "KB" }), _jsx("span", { className: "sidebar-logo-text", children: "KB Vault" })] }) }), !collapsed ? (_jsxs("button", { className: "workspace-selector", onClick: () => onNavigate(AppRoute.WORKSPACE_SWITCHER), "aria-label": "Switch workspace", children: [_jsx("span", { className: "workspace-selector-dot", style: { background: isConnected ? undefined : 'var(--gray-500)' } }), _jsx("span", { className: "workspace-selector-name", children: workspaceName || 'No workspace' }), _jsx(IconChevronDown, { size: 12, className: "workspace-selector-chevron" })] })) : null, _jsxs("nav", { className: "sidebar-nav", children: [_jsxs("div", { className: "nav-section", children: [_jsx("div", { className: "nav-section-label", children: "Workflow" }), mainNav.map((item) => (_jsx(CollapsibleNavItem, { item: item, isActive: activeRoute === item.id, collapsed: collapsed, onNavigate: onNavigate }, item.id)))] }), _jsxs("div", { className: "nav-section", style: { marginTop: 'var(--space-2)' }, children: [_jsx("div", { className: "nav-section-label", children: "Tools" }), toolsNav.map((item) => (_jsx(CollapsibleNavItem, { item: item, isActive: activeRoute === item.id, collapsed: collapsed, onNavigate: onNavigate }, item.id)))] })] }), _jsx("div", { className: "sidebar-footer", children: _jsxs("div", { className: "sidebar-footer-item", children: [_jsx("span", { className: "status-chip-dot", style: {
                                        width: 6,
                                        height: 6,
                                        borderRadius: '50%',
                                        background: isConnected ? 'var(--color-success)' : 'var(--gray-500)',
                                    } }), _jsx("span", { className: "sidebar-footer-label", style: { fontSize: 'var(--text-xs)', opacity: 0.6 }, children: isConnected ? 'Connected' : 'Offline' })] }) })] }), _jsx("button", { className: `sidebar-collapse-btn ${collapsed ? 'sidebar-collapse-btn--collapsed' : ''}`, onClick: handleToggle, "aria-label": collapsed ? 'Expand sidebar' : 'Collapse sidebar', children: collapsed ? _jsx(IconChevronRight, { size: 18 }) : _jsx(IconChevronLeft, { size: 18 }) })] }));
}
