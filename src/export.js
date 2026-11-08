'use strict';
// "Export HTML": one self-contained file. The page CSS, the code colors and KaTeX (with its fonts as data: URLs) are
// inlined, local pictures become data: URLs, and the file has no script at all. Its own CSP blocks every network load.
const fs = require('fs');
const path = require('path');

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif' };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let katexCssCache = null;

function katexCss(mediaDir) {
  if (katexCssCache) return katexCssCache;
  const dir = path.join(mediaDir, 'katex');
  let css = fs.readFileSync(path.join(dir, 'katex.min.css'), 'utf8');
  // Keep only the woff2 font of each face, inlined.
  css = css.replace(/src:([^;}]*)/g, (m, list) => {
    const w2 = /url\((fonts\/[^)]+\.woff2)\)/.exec(list);
    if (!w2) return m;
    try { return `src:url(data:font/woff2;base64,${fs.readFileSync(path.join(dir, w2[1])).toString('base64')}) format("woff2")`; } catch { return m; }
  });
  katexCssCache = css;
  return css;
}

/** o: { body, title, mediaDir, root, style } -> full HTML text */
function exportDocument(o) {
  const pageCss = fs.readFileSync(path.join(o.mediaDir, 'preview.css'), 'utf8');
  let body = String(o.body)
    .replace(/ data-line="\d+"/g, '')
    .replace(/<button[^>]*class="copy-btn"[^>]*>[^<]*<\/button>/g, '');
  // Pictures: the webview URL becomes a data: URL read from data-path (only files inside the workspace were linked).
  body = body.replace(/<img\b([^>]*?)\bsrc="([^"]*)"([^>]*?)\bdata-path="([^"]*)"([^>]*)>/g, (m, a, src, b, p, c) => {
    const file = p.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const ext = (path.extname(file).slice(1) || '').toLowerCase();
    try {
      if (o.root && !path.resolve(file).startsWith(path.resolve(o.root))) return `<img${a}alt="picture outside the workspace"${b}${c}>`;
      const st = fs.statSync(file);
      if (!MIME[ext] || st.size > 10 * 1048576) return `<img${a}src=""${b}${c}>`;
      return `<img${a}src="data:${MIME[ext]};base64,${fs.readFileSync(file).toString('base64')}"${b}${c}>`;
    } catch { return `<img${a}src=""${b}${c}>`; }
  });
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="RST Preview for VS Code">
<title>${esc(o.title)}</title>
<style>${katexCss(o.mediaDir)}</style>
<style>${pageCss}</style>
</head>
<body class="exported style-${o.style === 'vscode' ? 'vscode' : 'github'}">
<article class="rst-body">
${body}
</article>
</body>
</html>
`;
}

module.exports = { exportDocument };
