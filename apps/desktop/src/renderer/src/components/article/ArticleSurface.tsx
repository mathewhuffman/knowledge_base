import { useEffect, useMemo, useRef, useState } from 'react';
import Quill from 'quill';
import quillSnowCss from 'quill/dist/quill.snow.css?raw';
import { buildArticlePreviewDocument, buildArticlePreviewStyles, normalizePreviewHtml } from '../../utils/previewDocument';

/* Register a custom Quill blot so <hr> elements survive clipboard conversion */
const BlockEmbed = Quill.import('blots/block/embed') as unknown as new (...args: unknown[]) => {
  statics?: Record<string, unknown>;
};

class HorizontalRuleBlot extends BlockEmbed {
  static blotName = 'hr';
  static tagName = 'hr';
}

Quill.register('formats/hr', HorizontalRuleBlot as unknown as Record<string, unknown>, true);

export type ArticleSurfaceMode = 'preview' | 'edit';

type ArticleSurfaceProps = {
  html: string;
  title: string;
  styleCss: string;
  mode: ArticleSurfaceMode;
  className?: string;
  emptyMessage?: string;
  onChange?: (nextHtml: string) => void;
  savedHtml?: string;
  onSave?: () => void;
  onRestore?: () => void;
  saving?: boolean;
  error?: string | null;
};

type ArticleModeToggleProps = {
  mode: ArticleSurfaceMode;
  onChange: (mode: ArticleSurfaceMode) => void;
  label?: string;
  className?: string;
  compact?: boolean;
};

const QUILL_TOOLBAR_OPTIONS: unknown[] = [
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

function joinClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function getNormalizedEditorHtml(value: string): string {
  const normalized = normalizePreviewHtml(value);
  return normalized || '<p><br></p>';
}

export function ArticleModeToggle({
  mode,
  onChange,
  label = 'Mode',
  className,
  compact = false,
}: ArticleModeToggleProps) {
  return (
    <div className={joinClassNames('article-mode-toggle', compact && 'article-mode-toggle--compact', className)}>
      {!compact && <span className="article-mode-toggle__label">{label}</span>}
      <div className="article-mode-toggle__buttons" role="tablist" aria-label={`${label} toggle`}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'preview'}
          className={`article-mode-toggle__button${mode === 'preview' ? ' article-mode-toggle__button--active' : ''}`}
          onClick={() => onChange('preview')}
        >
          Preview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'edit'}
          className={`article-mode-toggle__button${mode === 'edit' ? ' article-mode-toggle__button--active' : ''}`}
          onClick={() => onChange('edit')}
        >
          Edit
        </button>
      </div>
    </div>
  );
}

export function ArticleSurface({
  html,
  title,
  styleCss,
  mode,
  className,
  emptyMessage = 'No content available',
  onChange,
  savedHtml,
  onSave,
  onRestore,
  saving = false,
  error,
}: ArticleSurfaceProps) {
  const shadowHostRef = useRef<HTMLDivElement | null>(null);
  const quillRef = useRef<Quill | null>(null);
  const quillStyleRef = useRef<HTMLStyleElement | null>(null);
  const syncGuardRef = useRef(false);
  const isDirty = typeof savedHtml === 'string' ? html !== savedHtml : false;

  const previewDocument = useMemo(
    () => buildArticlePreviewDocument(html, title, styleCss),
    [html, styleCss, title]
  );

  useEffect(() => {
    const host = shadowHostRef.current;
    if (!host) return;

    const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: 'open' });

    let styleElement = shadowRoot.querySelector('style[data-kbv-quill-style]') as HTMLStyleElement | null;
    let mountElement = shadowRoot.querySelector('div[data-kbv-quill-mount]') as HTMLDivElement | null;

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
        if (syncGuardRef.current || source !== 'user') return;
        onChange?.(quill.root.innerHTML);
      });

      quillRef.current = quill;
    } else if (quillStyleRef.current) {
      quillStyleRef.current.textContent = `${quillSnowCss}\n${buildArticlePreviewStyles(styleCss, QUILL_EDITOR_EXTRA_CSS)}`;
    }
  }, [html, onChange, styleCss]);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;

    const nextHtml = getNormalizedEditorHtml(html);
    if (quill.root.innerHTML === nextHtml) return;

    syncGuardRef.current = true;
    const nextDelta = quill.clipboard.convert({ html: nextHtml, text: '' });
    quill.setContents(nextDelta, 'silent');
    syncGuardRef.current = false;
  }, [html]);

  if (!normalizePreviewHtml(html) && mode === 'preview') {
    return (
      <div className="html-preview" style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={joinClassNames('article-surface', className, mode === 'edit' && 'article-surface--edit')}>
      <div className="detail-preview-frame-card proposal-review-preview-frame-card article-surface__frame-card">
        <iframe
          className={joinClassNames(
            'detail-preview-frame',
            'proposal-review-preview-frame',
            mode !== 'preview' && 'article-surface__panel--hidden'
          )}
          title={title}
          srcDoc={previewDocument}
          sandbox="allow-same-origin"
        />
        <div
          ref={shadowHostRef}
          className={joinClassNames(
            'article-surface__shadow-host',
            mode !== 'edit' && 'article-surface__panel--hidden'
          )}
        />
      </div>

      {mode === 'edit' && (error || isDirty) && (
        <div className="article-surface__footer">
          <div className="article-surface__footer-start">
            {error ? <span className="article-surface__error">{error}</span> : <span className="article-surface__status">{isDirty ? 'Unsaved changes' : 'Saved'}</span>}
          </div>
          <div className="article-surface__footer-end">
            {isDirty && onRestore && (
              <button type="button" className="btn btn-ghost" onClick={onRestore} disabled={saving || !isDirty}>
                Restore
              </button>
            )}
            {isDirty && onSave && (
              <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving || !isDirty}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
