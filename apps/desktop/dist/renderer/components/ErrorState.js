import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { IconAlertCircle } from './icons';
export function ErrorState({ title = 'Something went wrong', description, action, }) {
    return (_jsxs("div", { className: "error-state", children: [_jsx("div", { className: "error-state-icon", children: _jsx(IconAlertCircle, { size: 48 }) }), _jsx("h3", { className: "error-state-title", children: title }), description && _jsx("p", { className: "error-state-desc", children: description }), action] }));
}
