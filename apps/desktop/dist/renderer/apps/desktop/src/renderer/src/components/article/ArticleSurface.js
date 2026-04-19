import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef } from 'react';
import Quill from 'quill';
import quillSnowCss from 'quill/dist/quill.snow.css?raw';
import { buildArticlePreviewDocument, buildArticlePreviewStyles, normalizePreviewHtml } from '../../utils/previewDocument';
/* Register a custom Quill blot so <hr> elements survive clipboard conversion */
const BlockEmbed = Quill.import('blots/block/embed');
class HorizontalRuleBlot extends BlockEmbed {
    static blotName = 'hr';
    static tagName = 'hr';
}
Quill.register('formats/hr', HorizontalRuleBlot, true);
const QUILL_TOOLBAR_OPTIONS = [
    [{ header: [1, 2, 3, false] }],
    [{ font: [] }, { size: ['small', false, 'large', 'huge'] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ color: [] }, { background: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ align: [] }],
    ['blockquote', 'code-block'],
    ['link', 'image', 'video'],
    ['clean'],
];
const QUILL_EDITOR_EXTRA_CSS = `
  :host {
    display: block;
    width: 100%;
    height: 100%;
    background: #ffffff;
  }

  #kbv-zendesk-preview-host {
    height: 100%;
    min-height: 0;
    width: 100%;
    max-width: 100%;
    padding: 0;
    margin: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .article-surface__quill-shell {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .article-surface__quill-shell .ql-toolbar.ql-snow {
    position: sticky;
    top: 0;
    z-index: 2;
    background: linear-gradient(180deg, #ffffff, #fbfdff);
    border-top: none;
    border-bottom: 1px solid #d7deea;
    border-left: none;
    border-right: none;
    border-radius: 16px 16px 0 0;
  }

  .article-surface__quill-shell .ql-container.ql-snow {
    border-top: none;
    border-bottom: 1px solid #d7deea;
    border-left: none;
    border-right: none;
    border-radius: 0 0 16px 16px;
    min-height: 0;
    height: 100%;
    flex: 1 1 auto;
    overflow-y: auto;
    background:
      linear-gradient(180deg, rgba(15, 23, 42, 0.02), rgba(15, 23, 42, 0)),
      #ffffff;
  }

  .article-surface__quill-shell .ql-editor {
    min-height: 100%;
    padding: 16px clamp(16px, 3vw, 32px) 48px;
    font-size: 16px;
    line-height: 1.6;
  }

  .article-surface__quill-shell .ql-editor hr {
    display: block;
    border: none;
    border-top: 1px solid #d7deea;
    margin: 1em 0;
    height: 0;
  }

  .article-surface__quill-shell .ql-editor.ql-blank::before {
    color: #94a3b8;
    font-style: normal;
    left: 32px;
    right: 32px;
  }

  .article-surface__quill-shell .ql-tooltip {
    z-index: 3;
  }
`;
function joinClassNames(...values) {
    return values.filter(Boolean).join(' ');
}
function getNormalizedEditorHtml(value) {
    const normalized = normalizePreviewHtml(value);
    return normalized || '<p><br></p>';
}
export function ArticleModeToggle({ mode, onChange, label = 'Mode', className, compact = false, }) {
    return (_jsxs("div", { className: joinClassNames('article-mode-toggle', compact && 'article-mode-toggle--compact', className), children: [!compact && _jsx("span", { className: "article-mode-toggle__label", children: label }), _jsxs("div", { className: "article-mode-toggle__buttons", role: "tablist", "aria-label": `${label} toggle`, children: [_jsx("button", { type: "button", role: "tab", "aria-selected": mode === 'preview', className: `article-mode-toggle__button${mode === 'preview' ? ' article-mode-toggle__button--active' : ''}`, onClick: () => onChange('preview'), children: "Preview" }), _jsx("button", { type: "button", role: "tab", "aria-selected": mode === 'edit', className: `article-mode-toggle__button${mode === 'edit' ? ' article-mode-toggle__button--active' : ''}`, onClick: () => onChange('edit'), children: "Edit" })] })] }));
}
export function ArticleSurface({ html, title, styleCss, mode, className, emptyMessage = 'No content available', onChange, savedHtml, onSave, onRestore, saving = false, error, }) {
    const shadowHostRef = useRef(null);
    const quillRef = useRef(null);
    const quillStyleRef = useRef(null);
    const syncGuardRef = useRef(false);
    const isDirty = typeof savedHtml === 'string' ? html !== savedHtml : false;
    const previewDocument = useMemo(() => buildArticlePreviewDocument(html, title, styleCss), [html, styleCss, title]);
    useEffect(() => {
        const host = shadowHostRef.current;
        if (!host)
            return;
        const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
        let styleElement = shadowRoot.querySelector('style[data-kbv-quill-style]');
        let mountElement = shadowRoot.querySelector('div[data-kbv-quill-mount]');
        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.setAttribute('data-kbv-quill-style', 'true');
            shadowRoot.appendChild(styleElement);
        }
        if (!mountElement) {
            mountElement = document.createElement('div');
            mountElement.setAttribute('data-kbv-quill-mount', 'true');
            mountElement.style.height = '100%';
            mountElement.style.minHeight = '0';
            mountElement.style.overflow = 'visible';
            shadowRoot.appendChild(mountElement);
        }
        quillStyleRef.current = styleElement;
        styleElement.textContent = `${quillSnowCss}\n${buildArticlePreviewStyles(styleCss, QUILL_EDITOR_EXTRA_CSS)}`;
        if (!quillRef.current) {
            mountElement.innerHTML = '';
            const wrapper = document.createElement('div');
            wrapper.className = 'article-surface__quill-shell';
            const articleHost = document.createElement('div');
            articleHost.id = 'kbv-zendesk-preview-host';
            const editorMount = document.createElement('div');
            articleHost.appendChild(editorMount);
            wrapper.appendChild(articleHost);
            mountElement.appendChild(wrapper);
            const quill = new Quill(editorMount, {
                theme: 'snow',
                modules: {
                    toolbar: QUILL_TOOLBAR_OPTIONS,
                },
                placeholder: 'Start editing...',
            });
            const initialHtml = getNormalizedEditorHtml(html);
            const initialDelta = quill.clipboard.convert({ html: initialHtml, text: '' });
            quill.setContents(initialDelta, 'silent');
            quill.on('text-change', (_delta, _oldDelta, source) => {
                if (syncGuardRef.current || source !== 'user')
                    return;
                onChange?.(quill.root.innerHTML);
            });
            quillRef.current = quill;
        }
        else if (quillStyleRef.current) {
            quillStyleRef.current.textContent = `${quillSnowCss}\n${buildArticlePreviewStyles(styleCss, QUILL_EDITOR_EXTRA_CSS)}`;
        }
    }, [html, onChange, styleCss]);
    useEffect(() => {
        const quill = quillRef.current;
        if (!quill)
            return;
        const nextHtml = getNormalizedEditorHtml(html);
        if (quill.root.innerHTML === nextHtml)
            return;
        syncGuardRef.current = true;
        const nextDelta = quill.clipboard.convert({ html: nextHtml, text: '' });
        quill.setContents(nextDelta, 'silent');
        syncGuardRef.current = false;
    }, [html]);
    if (!normalizePreviewHtml(html) && mode === 'preview') {
        return (_jsx("div", { className: "html-preview", style: { textAlign: 'center', color: 'var(--color-text-muted)' }, children: emptyMessage }));
    }
    return (_jsxs("div", { className: joinClassNames('article-surface', className, mode === 'edit' && 'article-surface--edit'), children: [_jsxs("div", { className: "detail-preview-frame-card proposal-review-preview-frame-card article-surface__frame-card", children: [_jsx("iframe", { className: joinClassNames('detail-preview-frame', 'proposal-review-preview-frame', mode !== 'preview' && 'article-surface__panel--hidden'), title: title, srcDoc: previewDocument, sandbox: "allow-same-origin" }), _jsx("div", { ref: shadowHostRef, className: joinClassNames('article-surface__shadow-host', mode !== 'edit' && 'article-surface__panel--hidden') })] }), mode === 'edit' && (error || isDirty) && (_jsxs("div", { className: "article-surface__footer", children: [_jsx("div", { className: "article-surface__footer-start", children: error ? _jsx("span", { className: "article-surface__error", children: error }) : _jsx("span", { className: "article-surface__status", children: isDirty ? 'Unsaved changes' : 'Saved' }) }), _jsxs("div", { className: "article-surface__footer-end", children: [isDirty && onRestore && (_jsx("button", { type: "button", className: "btn btn-ghost", onClick: onRestore, disabled: saving || !isDirty, children: "Restore" })), isDirty && onSave && (_jsx("button", { type: "button", className: "btn btn-primary", onClick: onSave, disabled: saving || !isDirty, children: saving ? 'Saving...' : 'Save' }))] })] }))] }));
}
