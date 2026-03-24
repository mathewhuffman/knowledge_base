import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { IconZap, IconX } from '../icons';
export function AssistantLauncher({ open, loading, hasUnread, onToggle }) {
    return (_jsxs("button", { type: "button", className: [
            'ai-launcher',
            open && 'ai-launcher--open',
            loading && 'ai-launcher--busy',
            hasUnread && !open && 'ai-launcher--unread'
        ]
            .filter(Boolean)
            .join(' '), onClick: onToggle, title: open ? 'Close AI assistant' : 'Open AI assistant', "aria-label": open ? 'Close AI assistant' : 'Open AI assistant', "aria-expanded": open, children: [loading && _jsx("span", { className: "ai-launcher__pulse", "aria-hidden": "true" }), hasUnread && !open && _jsx("span", { className: "ai-launcher__badge", "aria-label": "New assistant response" }), _jsx("span", { className: "ai-launcher__icon", children: open ? _jsx(IconX, { size: 18 }) : _jsx(IconZap, { size: 18 }) })] }));
}
