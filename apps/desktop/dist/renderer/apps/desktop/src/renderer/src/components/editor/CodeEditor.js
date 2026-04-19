import { jsx as _jsx } from "react/jsx-runtime";
import { useCallback } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
const BASE_OPTIONS = {
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    wrappingIndent: 'same',
    lineNumbers: 'on',
    glyphMargin: false,
    folding: true,
    renderLineHighlight: 'line',
    tabSize: 2,
    insertSpaces: true,
    detectIndentation: false,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "var(--font-mono, 'SF Mono', 'Fira Code', monospace)",
    padding: { top: 16, bottom: 16 },
    contextmenu: true,
    smoothScrolling: true,
    overviewRulerBorder: false,
};
const THEME_NAME = 'kb-vault-light';
const monacoEnvironment = globalThis;
if (!monacoEnvironment.MonacoEnvironment) {
    monacoEnvironment.MonacoEnvironment = {
        getWorker(_moduleId, label) {
            if (label === 'html' || label === 'handlebars' || label === 'razor') {
                return new htmlWorker();
            }
            return new editorWorker();
        },
    };
}
loader.config({ monaco });
export function CodeEditor({ value, language = 'html', readOnly = false, onChange, }) {
    const handleMount = useCallback((editor, monaco) => {
        monaco.editor.defineTheme(THEME_NAME, {
            base: 'vs',
            inherit: true,
            rules: [],
            colors: {
                'editor.background': '#ffffff',
                'editorLineNumber.foreground': '#94a3b8',
                'editorLineNumber.activeForeground': '#334155',
                'editor.lineHighlightBackground': '#f8fafc',
                'editorGutter.background': '#ffffff',
                'editor.selectionBackground': '#dbeafe',
                'editor.inactiveSelectionBackground': '#e2e8f0',
            },
        });
        monaco.editor.setTheme(THEME_NAME);
        editor.updateOptions({
            readOnly,
            domReadOnly: readOnly,
        });
    }, [readOnly]);
    return (_jsx("div", { className: "code-editor", children: _jsx(Editor, { height: "100%", defaultLanguage: language, language: language, value: value, onChange: (nextValue) => onChange?.(nextValue ?? ''), onMount: handleMount, options: {
                ...BASE_OPTIONS,
                readOnly,
                domReadOnly: readOnly,
            } }) }));
}
