const BRAND_STYLES = `
<style id="rh-cookbook-branding">
  :root {
    --rh-primary: #5E3989;
    --rh-primary-dark: #3c2556;
    --rh-accent: #A90533;
    --rh-bg: #f8fafc;
    --rh-light-purple: #f3e9fa;
    --rh-surface: #ffffff;
    --rh-border: #e2e8f0;
    --rh-text: #1e293b;
    --rh-muted: #475569;
  }
  body {
    margin: 0;
    background: var(--rh-bg);
    color: var(--rh-text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .rh-header {
    background: linear-gradient(135deg, var(--rh-primary), var(--rh-primary-dark));
    color: #fff;
    padding: 1rem 1.25rem;
    border-bottom: 4px solid rgba(255,255,255,0.12);
  }
  .rh-header .eyebrow {
    display: inline-block;
    margin-bottom: 0.35rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
    border: 1px solid rgba(255,255,255,0.34);
    border-radius: 999px;
    padding: 0.2rem 0.55rem;
  }
  .rh-header h1 {
    margin: 0;
    font-size: 1.2rem;
    line-height: 1.3;
  }
  .rh-header p {
    margin: 0.25rem 0 0;
    opacity: 0.92;
    font-size: 0.84rem;
  }
  .rh-wrap {
    max-width: 980px;
    margin: 1rem auto;
    background: var(--rh-surface);
    border: 1px solid var(--rh-border);
    border-radius: 10px;
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05);
    padding: 1rem 1.1rem 1.4rem;
  }
  .rh-wrap a { color: var(--rh-accent); }
  @media (max-width: 760px) {
    .rh-wrap {
      margin: 0.6rem;
      padding: 0.85rem 0.75rem 1rem;
    }
  }
</style>`;

const FAVICON_TAG = '<link rel="icon" type="image/png" href="/favicon.png">';

function upgradeInsecureLinks(html) {
  return String(html || '').replace(/(href|src)="http:\/\/([^"]+)"/gi, (full, attr, target) => {
    const lower = String(target || '').toLowerCase();
    if (lower.startsWith('localhost') || lower.startsWith('127.0.0.1') || lower.startsWith('0.0.0.0')) {
      return full;
    }
    return `${attr}="https://${target}"`;
  });
}

function addHeadTags(html, title) {
  let out = String(html || '');
  if (!/<head[\s>]/i.test(out)) {
    out = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${out}</body></html>`;
  }
  if (!/rel=["']icon["']/i.test(out)) {
    out = out.replace(/<\/head>/i, `${FAVICON_TAG}\n</head>`);
  }
  if (!/<title>.*<\/title>/i.test(out) && title) {
    out = out.replace(/<\/head>/i, `<title>${title}</title>\n</head>`);
  }
  if (!/id=["']rh-cookbook-branding["']/i.test(out)) {
    out = out.replace(/<\/head>/i, `${BRAND_STYLES}\n</head>`);
  }
  return out;
}

function hasBrandHeader(html) {
  return /class=["']rh-header["']/i.test(html)
    || /Refuge House, Inc\./i.test(html)
    || /--rh-primary/i.test(html);
}

function applyCookbookBranding(entry, htmlContent) {
  const title = entry?.title ? `${entry.title} - Refuge House` : 'Refuge House Content';
  let html = addHeadTags(upgradeInsecureLinks(htmlContent), title);

  if (hasBrandHeader(html)) return html;

  const header = `
<header class="rh-header">
  <span class="eyebrow">${entry?.kind ? String(entry.kind).toUpperCase() : 'RESOURCE'}</span>
  <h1>${entry?.title || 'Refuge House Resource'}</h1>
  <p>Refuge House, Inc.</p>
</header>
<main class="rh-wrap">`;

  if (/<body[^>]*>/i.test(html)) {
    html = html.replace(/<body([^>]*)>/i, `<body$1>\n${header}`);
    html = html.replace(/<\/body>/i, '</main>\n</body>');
    return html;
  }

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${FAVICON_TAG}${BRAND_STYLES}<title>${title}</title></head><body>${header}${html}</main></body></html>`;
}

module.exports = {
  applyCookbookBranding
};
