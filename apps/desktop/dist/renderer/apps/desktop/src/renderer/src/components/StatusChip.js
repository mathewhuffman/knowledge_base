import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const defaultLabels = {
    live: 'Live',
    draft: 'Draft',
    conflicted: 'Conflicted',
    retired: 'Retired',
    pending: 'Pending',
    active: 'Active',
};
export function StatusChip({ status, label }) {
    return (_jsxs("span", { className: "status-chip", children: [_jsx("span", { className: `status-chip-dot ${status}` }), _jsx("span", { children: label || defaultLabels[status] })] }));
}
