import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { IconX } from './icons';
export function Modal({ open, onClose, title, children, footer, className }) {
    if (!open)
        return null;
    return (_jsx("div", { className: "modal-backdrop", onClick: onClose, children: _jsxs("div", { className: `modal ${className ?? ''}`.trim(), onClick: (e) => e.stopPropagation(), role: "dialog", "aria-modal": "true", "aria-label": title, children: [_jsxs("div", { className: "modal-header", children: [_jsx("h2", { className: "modal-title", children: title }), _jsx("button", { className: "btn btn-ghost btn-icon", onClick: onClose, "aria-label": "Close", children: _jsx(IconX, { size: 16 }) })] }), _jsx("div", { className: "modal-body", children: children }), footer && _jsx("div", { className: "modal-footer", children: footer })] }) }));
}
