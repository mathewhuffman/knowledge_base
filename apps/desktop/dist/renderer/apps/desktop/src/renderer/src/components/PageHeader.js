import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function PageHeader({ title, subtitle, actions }) {
    return (_jsxs("header", { className: "page-header", children: [_jsxs("div", { className: "page-header-left", children: [_jsx("h1", { className: "page-header-title", children: title }), subtitle && _jsx("span", { className: "page-header-subtitle", children: subtitle })] }), actions && _jsx("div", { className: "page-header-actions", children: actions })] }));
}
