import { jsx as _jsx } from "react/jsx-runtime";
export function Badge({ variant = 'neutral', children }) {
    return _jsx("span", { className: `badge badge-${variant}`, children: children });
}
