'use strict';
// The preview page. Strict CSP: nothing remote, scripts only by nonce, no connect, frames, workers, forms or objects.
// style-src allows inline style elements only by nonce; element styles are set from script (CSSOM), not attributes.
const crypto = require('crypto');
const { footerHtml, FOOTER_CSS } = require('./support');

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function csp(cspSource, nonce) {
  return [
    "default-src 'none'",
    `img-src ${cspSource} blob: data:`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `font-src ${cspSource} data:`,
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'", "frame-src 'none'", "worker-src 'none'", "media-src 'none'", "object-src 'none'",
    "form-action 'none'", "base-uri 'none'",
  ].join('; ');
}

/** o: { cspSource, scriptUri, styleUri, katexUri, katexCss, title, style, fontSize, showSupportLinks, nonce? } */
function buildHtml(o) {
  const nonce = o.nonce || crypto.randomBytes(16).toString('base64');
  const footer = footerHtml('rstPreview', o.showSupportLinks !== false, '');
  const fs = o.fontSize ? `:root{--rst-font-size:${Number(o.fontSize)}px}` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${esc(csp(o.cspSource, nonce))}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${esc(o.katexCss)}">
<link rel="stylesheet" href="${esc(o.styleUri)}">
<style nonce="${esc(nonce)}">${fs}${footer ? FOOTER_CSS + '\n.zovo-support{flex:0 0 auto;text-align:right;border-top:1px solid var(--vscode-panel-border,rgba(128,128,128,.35))}' : ''}</style>
<title>${esc(o.title || 'RST Preview')}</title>
</head>
<body class="style-${o.style === 'github' ? 'github' : 'vscode'}">
<div id="app">
  <div id="toolbar" role="toolbar" aria-label="RST Preview">
    <button id="outlineBtn" aria-pressed="false" title="Show the sections of this file">Outline</button>
    <span class="grp" role="group" aria-label="Style">
      <button id="styleVscode" class="seg" title="Colors and fonts of your VS Code theme">VS Code</button><button id="styleGithub" class="seg" title="The look of a README.rst on GitHub (light or dark with your theme)">GitHub</button>
    </span>
    <button id="exportBtn" title="Save one self-contained HTML file (pictures, math and code colors included)">Export HTML</button>
    <button id="sourceBtn" title="Show the RST source (double-click a paragraph does the same at that line)">Source</button>
    <span id="status" aria-live="polite"></span>
  </div>
  <div id="problem" class="hidden" role="alert"></div>
  <div id="main">
    <nav id="outline" class="hidden" aria-label="Sections"></nav>
    <div id="scroller" tabindex="0">
      <article id="content" class="rst-body" aria-label="Rendered reStructuredText"><p class="loading">Rendering…</p></article>
    </div>
  </div>
  ${footer}
</div>
<script nonce="${nonce}" src="${esc(o.katexUri)}"></script>
<script nonce="${nonce}" src="${esc(o.scriptUri)}"></script>
</body>
</html>`;
}

module.exports = { buildHtml, csp, esc };
