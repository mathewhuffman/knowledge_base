import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function EmptyState({ icon, title, description, action }) {
    return (_jsxs("div", { className: "empty-state", children: [icon && _jsx("div", { className: "empty-state-icon", children: icon }), _jsx("h3", { className: "empty-state-title", children: title }), description && _jsx("p", { className: "empty-state-desc", children: description }), action] }));
}
