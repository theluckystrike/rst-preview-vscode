'use strict';
// HTML escaping, URL checks and an allow-list sanitizer for `.. raw:: html`. No DOM needed, so it runs in the
// extension host and in the unit tests. Scripts, event handlers, styles, frames, forms and unsafe URLs are removed.

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', colon: ':', tab: '\t', newline: '\n' };
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'ftp']);
/**
 * Returns a link target that is safe to put in href, or null. Allowed: http, https, mailto, ftp, relative paths and
 * #anchors. Refused: javascript:, data:, vbscript:, file: and every other scheme, also when hidden with entities,
 * control characters or white space ("java&#9;script:").
 */
function safeHref(url) {
  if (typeof url !== 'string') return null;
  const clean = decodeEntities(url).replace(/[\u0000- \u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\ufeff]/g, '');
  if (!clean) return null;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(clean);
  if (m) return SAFE_SCHEMES.has(m[1].toLowerCase()) ? url.trim() : null;
  if (clean.startsWith('//')) return 'https:' + url.trim();
  if (clean.startsWith('\\\\')) return null; // UNC path
  return url.trim();
}

/** True when the image source can be shown with no network: a data: image. Relative paths are resolved by the host. */
function isDataImage(src) { return /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif|x-icon);/i.test(String(src).trim()); }

const ALLOWED = new Set(('a abbr address article aside b bdi bdo big blockquote br caption center cite code col colgroup dd del details dfn div dl dt em ' +
  'figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q rp rt ruby s samp section small span strike ' +
  'strong sub summary sup table tbody td tfoot th thead time tr tt u ul var wbr').split(' '));
const VOID = new Set(['br', 'hr', 'img', 'col', 'wbr']);
// Removed together with everything inside them.
const DROP = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript', 'noembed', 'template', 'title',
  'textarea', 'select', 'option', 'svg', 'math', 'xmp', 'plaintext', 'head', 'audio', 'video', 'canvas', 'portal', 'fencedframe']);
const ATTRS = new Set(['title', 'class', 'id', 'lang', 'dir', 'align', 'valign', 'colspan', 'rowspan', 'width', 'height', 'alt', 'href', 'src',
  'open', 'start', 'type', 'reversed', 'datetime', 'span', 'scope', 'abbr', 'border', 'cellpadding', 'cellspacing', 'name']);

/**
 * Allow-list sanitizer. opts.resolveSrc(src) maps an <img src> to a webview URL (or null to drop the picture).
 * Returns { html, removed } where removed counts dropped tags and attributes.
 */
function sanitizeHtml(input, opts = {}) {
  const s = String(input);
  let out = '', i = 0, removed = 0;
  const stack = [];
  const text = t => t.replace(/&(?!(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { out += text(s.slice(i)); break; }
    out += text(s.slice(i, lt));
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e < 0 ? s.length : e + 3; continue; }
    if (s[lt + 1] === '!' || s[lt + 1] === '?') { const e = s.indexOf('>', lt); i = e < 0 ? s.length : e + 1; removed++; continue; }
    const end = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/.exec(s.slice(lt, lt + 200));
    if (end) {
      const name = end[1].toLowerCase();
      i = lt + end[0].length;
      if (stack.includes(name)) { while (stack.length) { const t = stack.pop(); out += `</${t}>`; if (t === name) break; } }
      continue;
    }
    const tag = readTag(s, lt);
    if (!tag) { out += '&lt;'; i = lt + 1; continue; }
    i = tag.end;
    const name = tag.name;
    if (DROP.has(name)) {
      removed++;
      if (!tag.selfClosing) {
        const re = new RegExp(`</${name}\\s*>`, 'ig'); re.lastIndex = i;
        const m = re.exec(s); i = m ? m.index + m[0].length : s.length;
      }
      continue;
    }
    if (!ALLOWED.has(name)) { removed++; continue; }
    let attrs = '';
    for (const [k0, v] of tag.attrs) {
      const k = k0.toLowerCase();
      if (!ATTRS.has(k) || /^on/.test(k)) { removed++; continue; }
      let val = v;
      if (k === 'href') { if (name !== 'a') { removed++; continue; } val = safeHref(v); if (val === null) { removed++; continue; } }
      else if (k === 'src') {
        if (name !== 'img') { removed++; continue; }
        val = isDataImage(v) ? v.trim() : (opts.resolveSrc ? opts.resolveSrc(decodeEntities(v)) : null);
        if (!val) { removed++; attrs += ' class="blocked-picture" title="Picture not shown: remote or outside the workspace"'; continue; }
      } else if (k === 'id' || k === 'name') val = 'raw-' + String(v).replace(/[^\w-]/g, '');
      attrs += ` ${k}="${esc(decodeEntities(val))}"`;
    }
    if (name === 'a' && /href=/.test(attrs)) attrs += ' rel="noopener noreferrer"';
    if (VOID.has(name)) { out += `<${name}${attrs}>`; continue; }
    out += `<${name}${attrs}>`;
    if (tag.selfClosing) { out += `</${name}>`; continue; }
    stack.push(name);
    if (stack.length > 200) { removed++; out += `</${stack.pop()}>`; }
  }
  while (stack.length) out += `</${stack.pop()}>`;
  return { html: out, removed };
}

// Reads one start tag at s[lt] === '<'. Quotes in attribute values are respected. null when it is not a tag.
function readTag(s, lt) {
  const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(s.slice(lt, lt + 100));
  if (!m) return null;
  const name = m[1].toLowerCase();
  let i = lt + m[0].length;
  const attrs = [];
  for (let guard = 0; guard < 5000; guard++) {
    while (i < s.length && /[\s/]/.test(s[i]) && !(s[i] === '/' && s[i + 1] === '>')) i++;
    if (i >= s.length) return { name, attrs, end: s.length, selfClosing: false };
    if (s[i] === '>') return { name, attrs, end: i + 1, selfClosing: false };
    if (s[i] === '/' && s[i + 1] === '>') return { name, attrs, end: i + 2, selfClosing: true };
    const a = /^[^\s"'>\/=]+/.exec(s.slice(i, i + 200));
    if (!a) { i++; continue; }
    const key = a[0]; i += key.length;
    while (/\s/.test(s[i] || '')) i++;
    let val = '';
    if (s[i] === '=') {
      i++;
      while (/\s/.test(s[i] || '')) i++;
      if (s[i] === '"' || s[i] === "'") { const q = s[i]; const e = s.indexOf(q, i + 1); val = s.slice(i + 1, e < 0 ? s.length : e); i = e < 0 ? s.length : e + 1; }
      else { const v = /^[^\s>]*/.exec(s.slice(i)); val = v[0]; i += val.length; }
    }
    attrs.push([key, val]);
  }
  return { name, attrs, end: i, selfClosing: false };
}

module.exports = { esc, safeHref, sanitizeHtml, decodeEntities, isDataImage };
