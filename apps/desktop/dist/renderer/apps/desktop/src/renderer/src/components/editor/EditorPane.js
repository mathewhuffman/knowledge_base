import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function EditorPane({ children, footerStart, footerEnd, className }) {
    return (_jsxs("div", { className: `editor-pane ${className ?? ''}`.trim(), children: [_jsx("div", { className: "editor-pane__body", children: children }), (footerStart || footerEnd) && (_jsxs("div", { className: "editor-pane__footer", children: [_jsx("div", { className: "editor-pane__footer-start", children: footerStart }), _jsx("div", { className: "editor-pane__footer-end", children: footerEnd })] }))] }));
}
