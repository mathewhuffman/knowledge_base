export function normalizePreviewHtml(rawHtml?: string | null): string {
  if (!rawHtml) return '';

  const withoutScripts = rawHtml.replace(/<script[\s\S]*?<\/script>/gi, '');

  const bodyMatch = withoutScripts.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[1]) return bodyMatch[1].trim();

  const articleBody = withoutScripts.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleBody?.[1]) return articleBody[1].trim();

  return withoutScripts.trim();
}

type PreviewDocumentOptions = {
  extraCss?: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildArticlePreviewDocument(
  rawHtml: string,
  previewTitle: string,
  styleCss: string,
  options?: PreviewDocumentOptions
): string {
  const articleBody = normalizePreviewHtml(rawHtml) || '<p>No preview content found.</p>';
  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'; font-src 'self' data: https:; media-src https:; connect-src https:; frame-src 'none'; script-src 'none';"
    />
    <title>${escapeHtml(previewTitle)}</title>
    <style>${buildArticlePreviewStyles(styleCss, options?.extraCss)}</style>
  </head>
  <body>
    <main id="kbv-zendesk-preview-host">${articleBody}</main>
  </body>
</html>
  `.trim();
}

export function buildArticlePreviewStyles(styleCss: string, extraCss = ''): string {
  return `
      :root {
        --kbv-default-bg: #ffffff;
      }

      html,
      body {
        margin: 0;
        padding: 0;
        width: 100%;
        min-height: auto;
        height: auto;
      }

      body {
        background: #ffffff;
        color: var(--kbv-zendesk-preview-color_text, #1a202c);
        font-size: 16px;
        font-family: var(--kbv-zendesk-preview-text_font, 'Inter', 'Segoe UI', Arial, sans-serif);
        line-height: 1.6;
      }

      body,
      #kbv-zendesk-preview-host,
      #kbv-zendesk-preview-host :is(p, li, td, th, span, div, blockquote, figcaption, a, strong, em) {
        font-family: var(--kbv-zendesk-preview-text_font, 'Inter', 'Segoe UI', Arial, sans-serif);
      }

      #kbv-zendesk-preview-host :is(h1, h2, h3, h4, h5, h6) {
        font-family: var(--kbv-zendesk-preview-heading_font, 'Inter', 'Segoe UI', Arial, sans-serif);
      }

      #kbv-zendesk-preview-host {
        width: min(1120px, 100%);
        max-width: 100%;
        margin: 0 auto;
        padding: 16px clamp(16px, 3vw, 32px) 8px;
        box-sizing: border-box;
        background: var(--kbv-default-bg);
        min-height: auto;
        color: var(--kbv-zendesk-preview-color_text, #1a202c);
      }

      #kbv-zendesk-preview-host > :first-child {
        margin-top: 0;
      }

      #kbv-zendesk-preview-host > :last-child {
        margin-bottom: 0;
      }

      #kbv-zendesk-preview-host img,
      #kbv-zendesk-preview-host figure img {
        width: auto;
        max-width: 100% !important;
        max-height: min(520px, 60vh) !important;
        height: auto;
        display: inline-block;
      }

      #kbv-zendesk-preview-host .header,
      #kbv-zendesk-preview-host .hero {
        height: auto;
        max-width: 100%;
      }

      #kbv-zendesk-preview-host .hero img,
      #kbv-zendesk-preview-host .hero picture img,
      #kbv-zendesk-preview-host [class*="hero"] img,
      #kbv-zendesk-preview-host .article-header img,
      #kbv-zendesk-preview-host header img,
      #kbv-zendesk-preview-host > figure img,
      #kbv-zendesk-preview-host > .wysiwyg-image img,
      #kbv-zendesk-preview-host > :first-child:is(figure, .wysiwyg-image) img {
        display: block;
        width: min(100%, 980px) !important;
        max-width: 100% !important;
        max-height: none !important;
        height: auto !important;
        object-fit: contain !important;
        margin-left: auto;
        margin-right: auto;
      }

      #kbv-zendesk-preview-host > figure,
      #kbv-zendesk-preview-host > .wysiwyg-image,
      #kbv-zendesk-preview-host > :first-child:is(figure, .wysiwyg-image) {
        margin-left: auto;
        margin-right: auto;
        max-width: min(100%, 980px);
      }

      #kbv-zendesk-preview-host table {
        width: 100%;
      }

      #kbv-zendesk-preview-host pre,
      #kbv-zendesk-preview-host code {
        white-space: pre-wrap;
        word-break: break-word;
      }

      ${styleCss}
      ${extraCss}
  `.trim();
}
