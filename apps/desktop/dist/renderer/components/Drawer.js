import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { IconX } from './icons';
export function Drawer({ open, onClose, title, children, footer, variant = 'default' }) {
    if (!open)
        return null;
    const drawerClass = `drawer${variant === 'wide' ? ' drawer--wide' : variant === 'fullscreen' ? ' drawer--fullscreen' : ''}`;
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "drawer-backdrop", onClick: onClose }), _jsxs("aside", { className: drawerClass, role: "dialog", "aria-modal": "true", "aria-label": title, children: [_jsxs("div", { className: "drawer-header", children: [_jsx("h2", { className: "drawer-title", children: title }), _jsx("button", { className: "btn btn-ghost btn-icon", onClick: onClose, "aria-label": "Close", children: _jsx(IconX, { size: 16 }) })] }), _jsx("div", { className: "drawer-body", children: children }), footer && _jsx("div", { className: "drawer-footer", children: footer })] })] }));
}
