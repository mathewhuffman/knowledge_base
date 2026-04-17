import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function Kbd({ keys }) {
    const parts = keys.split('+');
    return (_jsx("span", { style: { display: 'inline-flex', gap: 2, alignItems: 'center' }, children: parts.map((key, i) => (_jsxs("span", { children: [_jsx("kbd", { className: "kbd", children: key }), i < parts.length - 1 && _jsx("span", { style: { fontSize: 10, color: 'var(--gray-400)', margin: '0 1px' }, children: "+" })] }, i))) }));
}
